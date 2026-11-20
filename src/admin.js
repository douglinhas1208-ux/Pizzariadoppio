import {adminOrdersApi,createOrder,adminReportsApi} from './orders.js';
import {adminPhotoApi} from './images.js';
/*
 * Doppio Admin — API segura (Cloudflare Workers + D1).
 * Nenhuma senha ou chave é mantida no repositório.
 * Proteção: secrets no Workers, rate limit de login no D1,
 * sessão HMAC HttpOnly, SameSite=Strict, verificação de origem e revisão otimista.
 */
const COOKIE='doppio_admin';
const SESSION_SECONDS=8*60*60;
const enc=new TextEncoder();
const SWEET_PRODUCTS=[
  {id:'chocolate-morango',name:'Chocolate com Morango',description:'Pizza doce de chocolate com morangos.',ingredients:['Massa','Chocolate','Morango'],category:'Doces',image:'assets/chocolate-morango-catalogo.avif',price:56.99,available:true,tag:'Doce',halfAllowed:true},
  {id:'uva-nevada',name:'Uva Nevada (Ninho com Uva)',description:'Pizza doce de creme de Ninho com uvas.',ingredients:['Massa','Creme de Ninho','Uva'],category:'Doces',image:'assets/uva-nevada-catalogo.avif',price:56.99,available:true,tag:'Doce',halfAllowed:true}
];
const CATALOG_VERSION=6;
const SWEET_IDS=new Set(SWEET_PRODUCTS.map(p=>p.id));
// Metades são agrupadas em doces ou salgadas no checkout e revalidadas no servidor.
const DEFAULT_STATE={
  revision:0,
  catalogVersion:CATALOG_VERSION,
  acceptingOrders:true,
  scheduleEnabled:false,
  weeklyHours:Array.from({length:7},()=>({enabled:false,start:'',end:''})),
  openDays:'Sexta, sábado e domingo',
  openHours:'18h às 23h',
  etaMinutes:40,
  products:[
    {id:'frango',name:'Frango com Catupiry',description:'Frango e Catupiry.',ingredients:['Massa','Molho de tomate','Frango','Catupiry','Azeitonas'],category:'Clássicas',image:'assets/frango-real.avif',price:54.99,available:true,tag:'Clássica'},
    {id:'brocolis',name:'Brócolis com Bacon',description:'Brócolis, bacon e Catupiry.',ingredients:['Massa','Molho de tomate','Brócolis','Bacon','Catupiry'],category:'Clássicas',image:'assets/brocolis.webp',price:54.99,available:true,tag:'Clássica'},
    {id:'calabresa',name:'Calabresa',description:'Calabresa e cebola.',ingredients:['Massa','Molho de tomate','Calabresa','Cebola','Azeitonas'],category:'Clássicas',image:'assets/calabresa-real.avif',price:49.99,available:true,tag:'Clássica'},
    {id:'mussarela',name:'Mussarela',description:'Mussarela, tomate e azeitonas.',ingredients:['Massa','Molho de tomate','Mussarela','Tomate','Azeitonas'],category:'Clássicas',image:'assets/mussarela.webp',price:49.99,available:true,tag:'Clássica'},
    ...SWEET_PRODUCTS.map(p=>({...p}))
  ]
};
function j(data,status=200,headers={}){
  return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer',...headers}});
}
const error=(code,message,status=400)=>j({ok:false,code,message},status);
// Apenas flags de prontidão; nunca inclui nomes de contas, valores, tamanhos ou hashes de secrets.
const setupChecks=env=>({
  database:Boolean(env.DOPPIO_DB),
  password:typeof env.ADMIN_PASSWORD==='string'&&env.ADMIN_PASSWORD.length>=16,
  sessionSecret:typeof env.ADMIN_SESSION_SECRET==='string'&&env.ADMIN_SESSION_SECRET.length>=32
});
const isSetup=env=>Object.values(setupChecks(env)).every(Boolean);
let dbReady;
async function ensureDb(env){
  if(!dbReady){
    dbReady=env.DOPPIO_DB.exec(
      'CREATE TABLE IF NOT EXISTS admin_state (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL, updated_at INTEGER NOT NULL);'
      +'CREATE TABLE IF NOT EXISTS admin_login_locks (ip_key TEXT PRIMARY KEY, failures INTEGER NOT NULL, last_attempt INTEGER NOT NULL, locked_until INTEGER NOT NULL DEFAULT 0);'
    ).catch(e=>{dbReady=null;throw e;});
  }
  await dbReady;
}
const b64url=bytes=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
function fromB64(text){
  if(!/^[A-Za-z0-9_-]{1,2048}$/.test(text))throw Error('invalid_b64');
  const bin=atob(text.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-text.length%4)%4));
  return Uint8Array.from(bin,ch=>ch.charCodeAt(0));
}
async function keyFrom(secret){return crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);}
async function issueSession(env){
  const now=Math.floor(Date.now()/1000);
  const body=b64url(enc.encode(JSON.stringify({scope:'admin',iat:now,exp:now+SESSION_SECONDS,v:1})));
  const sig=await crypto.subtle.sign('HMAC',await keyFrom(env.ADMIN_SESSION_SECRET),enc.encode(body));
  return body+'.'+b64url(new Uint8Array(sig));
}
async function validSession(req,env){
  const cookie=(req.headers.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='));
  if(!cookie)return false;
  const value=cookie.slice(COOKIE.length+1);
  const [body,sig,...extra]=value.split('.');
  if(!body||!sig||extra.length||body.length>1024)return false;
  try{
    const ok=await crypto.subtle.verify('HMAC',await keyFrom(env.ADMIN_SESSION_SECRET),fromB64(sig),enc.encode(body));
    if(!ok)return false;
    const payload=JSON.parse(new TextDecoder().decode(fromB64(body)));
    const now=Math.floor(Date.now()/1000);
    return payload.scope==='admin'&&payload.v===1&&Number.isInteger(payload.iat)&&Number.isInteger(payload.exp)
      &&payload.iat<=now+60&&payload.exp>now&&payload.exp<=payload.iat+SESSION_SECONDS;
  }catch(_){return false;}
}
function cookieHeader(token,clear=false){
  return COOKIE+'='+(clear?'':token)+'; Path=/; HttpOnly; Secure; SameSite=Strict; '+(clear?'Max-Age=0':'Max-Age='+SESSION_SECONDS);
}
async function comparePassword(input,expected){
  if(typeof input!=='string'||input.length<1||input.length>256)return false;
  const [x,y]=await Promise.all([crypto.subtle.digest('SHA-256',enc.encode(input)),crypto.subtle.digest('SHA-256',enc.encode(expected))]);
  let diff=0;const a=new Uint8Array(x),b=new Uint8Array(y);
  for(let i=0;i<a.length;i++)diff|=a[i]^b[i];
  return diff===0;
}
async function identifyIP(req,env){
  const ip=req.headers.get('cf-connecting-ip')||'unknown';
  const hash=await crypto.subtle.digest('SHA-256',enc.encode(ip+'|'+env.ADMIN_SESSION_SECRET));
  return b64url(new Uint8Array(hash).slice(0,18));
}
async function readBody(req,max=45000){
  if((Number(req.headers.get('content-length'))||0)>max)throw Error('excess_body');
  if(!(req.headers.get('content-type')||'').toLowerCase().startsWith('application/json'))throw Error('content_type');
  const text=await req.text();
  if(text.length>max)throw Error('excess_body');
  return JSON.parse(text);
}
function validText(v,max,min=0){return typeof v==='string'&&v.trim().length>=min&&v.length<=max&&!/[\u0000-\u001f\u007f]/.test(v);}

const WEEKDAYS=['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
const WEEKKEYS=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const isClock=v=>typeof v==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v);
const clockMin=v=>Number(v.slice(0,2))*60+Number(v.slice(3,5));
const friendlyClock=v=>v.endsWith(':00')?Number(v.slice(0,2))+'h':Number(v.slice(0,2))+'h'+v.slice(3);
// Exceção apenas em 20/11/2026; não muda a sexta-feira das próximas semanas.
const SPECIAL_FRIDAY='2026-11-20';
const localDateKey=at=>{const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(at);const part=x=>parts.find(v=>v.type===x)?.value;return [part('year'),part('month'),part('day')].join('-');};
function scheduleFrom(raw){
  const scheduleEnabled=raw.scheduleEnabled===true;
  const input=Array.isArray(raw.weeklyHours)&&raw.weeklyHours.length===7?raw.weeklyHours:null;
  const weeklyHours=(input||Array.from({length:7},()=>({enabled:false,start:'',end:''}))).map((row,i)=>{
    if(!row||typeof row!=='object'||typeof row.enabled!=='boolean')throw Error('Confira os dias de abertura.');
    const start=row.start||'',end=row.end||'';
    if(typeof start!=='string'||typeof end!=='string'||start.length>5||end.length>5)throw Error('Horário inválido em '+WEEKDAYS[i]+'.');
    if(row.enabled&&(!isClock(start)||!isClock(end)||start===end))throw Error('Defina abertura e fechamento diferentes em '+WEEKDAYS[i]+'.');
    if(!row.enabled&&((start&&!isClock(start))||(end&&!isClock(end))))throw Error('Horário inválido em '+WEEKDAYS[i]+'.');
    return {enabled:row.enabled,start,end};
  });
  if(scheduleEnabled&&!weeklyHours.some(day=>day.enabled))throw Error('Escolha ao menos um dia e seus horários antes de ativar o automático.');
  return {scheduleEnabled,weeklyHours};
}
function resolveStoreStatus(state,at=new Date()){
  if(state.acceptingOrders===false)return {acceptingOrders:false,status:'paused',nextOpening:null,scheduleEnabled:state.scheduleEnabled===true};
  if(state.scheduleEnabled!==true)return {acceptingOrders:true,status:'manual',nextOpening:null,scheduleEnabled:false};
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(at);
  const get=type=>parts.find(p=>p.type===type)?.value;
  const dayIndex=WEEKKEYS.indexOf(get('weekday'));
  if(dayIndex<0)throw Error('Dia local desconhecido');
  const current=Number(get('hour'))*60+Number(get('minute'));
  const hours=state.weeklyHours;
  const isSpecialFriday=dayIndex===5&&localDateKey(at)===SPECIAL_FRIDAY;
  const today=isSpecialFriday?{...hours[dayIndex],start:'19:00'}:hours[dayIndex],yesterday=hours[(dayIndex+6)%7];
  const todayOpen=today.enabled&&(clockMin(today.start)<clockMin(today.end)
    ? current>=clockMin(today.start)&&current<clockMin(today.end)
    : current>=clockMin(today.start));
  const previousOvernight=yesterday.enabled&&clockMin(yesterday.end)<clockMin(yesterday.start)
    &&current<clockMin(yesterday.end);
  if(todayOpen||previousOvernight)return {acceptingOrders:true,status:'open',nextOpening:null,scheduleEnabled:true};
  let nextOpening=null;
  for(let offset=0;offset<=7;offset++){
    const index=(dayIndex+offset)%7,record=offset===0?today:hours[index];
    if(record.enabled&&(offset>0||clockMin(record.start)>current)){
      nextOpening=WEEKDAYS[index]+' às '+friendlyClock(record.start);
      break;
    }
  }
  return {acceptingOrders:false,status:'closed',nextOpening,scheduleEnabled:true};
}
export async function publicStoreStatus(env){
  if(!env.DOPPIO_DB)return j({ok:true,...resolveStoreStatus(DEFAULT_STATE)});
  try{
    await ensureDb(env);
    const raw=await stateRow(env);
    const state=validateState(raw,raw.revision);
    return j({ok:true,...resolveStoreStatus(state)});
  }catch(_){
    return error('store_status_unavailable','Não foi possível verificar o funcionamento da pizzaria agora.',503);
  }
}

function validateState(raw,revision){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Estrutura inválida.');
  if(typeof raw.acceptingOrders!=='boolean')throw Error('Status da pizzaria inválido.');
  if(!validText(raw.openDays,90,2)||!validText(raw.openHours,60))throw Error('Dias ou horário inválidos.');
  if(!Number.isInteger(raw.etaMinutes)||raw.etaMinutes<10||raw.etaMinutes>240)throw Error('Prazo estimado deve ser entre 10 e 240 minutos.');
  const schedule=scheduleFrom(raw);
  if(!Array.isArray(raw.products)||raw.products.length<1||raw.products.length>30)throw Error('Cadastre entre 1 e 30 sabores.');
  const ids=new Set();
  const products=raw.products.map(p=>{
    if(!p||typeof p!=='object')throw Error('Pizza inválida.');
    if(typeof p.id!=='string'||!/^[a-z0-9][a-z0-9-]{1,39}$/.test(p.id)||ids.has(p.id))throw Error('Identificador de sabor inválido ou duplicado.');
    ids.add(p.id);
    if(!validText(p.name,70,2)||!validText(p.description,240)||!validText(p.category,50,2)||!validText(p.tag,36)||!validText(p.image,180,5))throw Error('Preencha corretamente as informações dos sabores.');
    if(!/^(?:assets\/[A-Za-z0-9/_-]+\.(?:webp|avif|png|jpe?g)|assets\/doce-(?:morango|uva)\.svg|api\/photo\/[a-f0-9-]{36})$/i.test(p.image)||p.image.includes('..'))throw Error('A foto deve ser uma imagem cadastrada da pizzaria.');
    if(p.price!==null&&(!Number.isFinite(p.price)||p.price<1||p.price>500||Math.abs(p.price*100-Math.round(p.price*100))>1e-6))throw Error('Informe um preço válido (R$ 1 a R$ 500) ou deixe em branco para publicar como preço pendente.');
    if(typeof p.available!=='boolean')throw Error('Disponibilidade inválida.');
    if(!Array.isArray(p.ingredients)||p.ingredients.length>16||!p.ingredients.every(v=>validText(v,50,1)))throw Error('Ingredientes inválidos.');
    return {id:p.id,name:p.name.trim(),description:p.description.trim(),ingredients:p.ingredients.map(x=>x.trim()),category:p.category.trim(),image:p.image,price:p.price===null?null:Math.round(p.price*100)/100,available:p.available,tag:p.tag.trim(),halfAllowed:p.halfAllowed!==false};
  });
  return {revision,catalogVersion:Number.isInteger(raw.catalogVersion)?raw.catalogVersion:0,acceptingOrders:raw.acceptingOrders,...schedule,openDays:raw.openDays.trim(),openHours:raw.openHours.trim(),etaMinutes:raw.etaMinutes,products};
}
async function stateRow(env){
  await ensureDb(env);
  for(let attempt=0;attempt<4;attempt++){
    let row=await env.DOPPIO_DB.prepare('SELECT revision,data FROM admin_state WHERE id=1').first();
    if(!row){
      await env.DOPPIO_DB.prepare('INSERT OR IGNORE INTO admin_state (id,revision,data,updated_at) VALUES (1,0,?,?)')
        .bind(JSON.stringify(DEFAULT_STATE),Math.floor(Date.now()/1000)).run();
      continue;
    }
    const state=JSON.parse(row.data);
    state.revision=row.revision;
    if((state.catalogVersion||0)>=CATALOG_VERSION)return state;
    if(!Array.isArray(state.products))throw Error('invalid_products');
    const ids=new Set(state.products.map(p=>p.id));
    for(const p of SWEET_PRODUCTS){
      const current=state.products.find(item=>item.id===p.id);
      if(!current)state.products.push({...p});
      else {if(current.price===54.99||current.price===null)current.price=56.99;current.halfAllowed=true;current.category='Doces';if(p.id==='chocolate-morango'&&current.image==='assets/doce-morango.svg')current.image='assets/chocolate-morango-catalogo.avif';if(p.id==='uva-nevada'&&['assets/doce-uva.svg','assets/uva-nevada-foto-real.avif'].includes(current.image))current.image='assets/uva-nevada-catalogo.avif';}
    }
    state.catalogVersion=CATALOG_VERSION;
    const nextRevision=row.revision+1;
    const updated=await env.DOPPIO_DB.prepare('UPDATE admin_state SET revision=?,data=?,updated_at=? WHERE id=1 AND revision=?')
      .bind(nextRevision,JSON.stringify({...state,revision:nextRevision}),Math.floor(Date.now()/1000),row.revision).run();
    if(updated.meta?.changes===1){state.revision=nextRevision;return state;}
  }
  throw Error('catalog_migration_conflict');
}
async function login(req,env){
  let data;
  try{data=await readBody(req,1500);}catch(_){return error('invalid_request','Dados de acesso inválidos.',400);}
  const ip=await identifyIP(req,env),now=Math.floor(Date.now()/1000);
  const prior=await env.DOPPIO_DB.prepare('SELECT failures,last_attempt,locked_until FROM admin_login_locks WHERE ip_key=?').bind(ip).first();
  if(prior && Number(prior.locked_until)>now)return error('temporarily_locked','Muitas tentativas. Tente novamente em 15 minutos.',429);
  const valid=await comparePassword(data.password,env.ADMIN_PASSWORD);
  if(!valid){
    const count=prior&&now-Number(prior.last_attempt)<900?Number(prior.failures)+1:1;
    const locked=count>=6?now+900:0;
    await env.DOPPIO_DB.prepare('INSERT INTO admin_login_locks (ip_key,failures,last_attempt,locked_until) VALUES (?,?,?,?) ON CONFLICT(ip_key) DO UPDATE SET failures=excluded.failures,last_attempt=excluded.last_attempt,locked_until=excluded.locked_until')
      .bind(ip,count,now,locked).run();
    return error('invalid_credentials',locked?'Muitas tentativas. Aguarde 15 minutos.':'Senha incorreta.',locked?429:401);
  }
  await env.DOPPIO_DB.prepare('DELETE FROM admin_login_locks WHERE ip_key=?').bind(ip).run();
  const token=await issueSession(env);
  return j({ok:true,authenticated:true},200,{'set-cookie':cookieHeader(token)});
}
export async function adminApi(request,env,url){
  if(url.pathname==='/api/admin/status'&&request.method==='GET'){
    const checks=setupChecks(env);
    if(!isSetup(env))return j({ok:true,ready:false,checks,message:'Há configurações pendentes no Cloudflare.'});
    try{await ensureDb(env);return j({ok:true,ready:true,checks});}
    catch(_){return j({ok:true,ready:false,checks,databaseError:true,message:'Não foi possível acessar o banco D1.'});}
  }
  if(!isSetup(env))return error('admin_setup_required','Painel administrativo ainda não ativado. Configure D1 e credenciais no Cloudflare.',503);
  if(!['GET','POST','PUT','DELETE'].includes(request.method))return error('method_not_allowed','Método não permitido.',405);
  if(request.method!=='GET' && request.headers.get('origin')!==url.origin)return error('origin','Origem não autorizada.',403);
  try{await ensureDb(env);}catch(_){return error('database_unavailable','Banco de dados indisponível.',503);}
  if(url.pathname==='/api/admin/login'&&request.method==='POST')return login(request,env);
  const authed=await validSession(request,env);
  if(!authed)return error('unauthorized','Entre novamente para continuar.',401);
  if(url.pathname==='/api/admin/me'&&request.method==='GET')return j({ok:true,authenticated:true});
  if(url.pathname==='/api/admin/orders'||url.pathname.startsWith('/api/admin/orders/'))return adminOrdersApi(request,env,url);
  if(url.pathname==='/api/admin/reports')return adminReportsApi(request,env,url);
  if(url.pathname==='/api/admin/images'||url.pathname.startsWith('/api/admin/images/'))return adminPhotoApi(request,env,url);
  if(url.pathname==='/api/admin/logout'&&request.method==='POST')return j({ok:true},200,{'set-cookie':cookieHeader('',true)});
  if(url.pathname==='/api/admin/state'&&request.method==='GET'){
    try{return j({ok:true,state:await stateRow(env)});}
    catch(_){return error('database_error','Não foi possível carregar os dados.',503);}
  }
  if(url.pathname==='/api/admin/state'&&request.method==='PUT'){
    let input;
    try{input=await readBody(request);}catch(_){return error('invalid_request','Dados do painel inválidos ou muito grandes.',400);}
    const version=input?.expectedRevision;
    if(!Number.isInteger(version)||version<0)return error('invalid_revision','Recarregue o painel e tente novamente.',400);
    let state;
    try{state=validateState(input.state,version+1);}catch(e){return error('invalid_state',e.message,422);}
    try{
      await stateRow(env);
      const saved=await env.DOPPIO_DB.prepare('UPDATE admin_state SET revision=revision+1,data=?,updated_at=? WHERE id=1 AND revision=?')
        .bind(JSON.stringify(state),Math.floor(Date.now()/1000),version).run();
      if(!saved.meta || saved.meta.changes!==1)return error('conflict','Os dados foram alterados em outra janela. Atualize o painel antes de salvar.',409);
      return j({ok:true,state});
    }catch(_){return error('database_error','Não foi possível salvar as alterações.',503);}
  }
  return error('not_found','Recurso não encontrado.',404);
}
export async function publicCreateOrder(request,env,url){
  if(request.method!=='POST')return error('method_not_allowed','Use POST.',405);
  if(!env.DOPPIO_DB)return error('database_unavailable','Registro de pedidos temporariamente indisponível.',503);
  try{
    const raw=await stateRow(env);
    const catalog=validateState(raw,raw.revision||0);
    return createOrder(request,env,url,catalog,resolveStoreStatus(catalog));
  }catch(_){
    return error('database_error','Não foi possível registrar a solicitação.',503);
  }
}
export async function publicCatalogScript(env){
  const headers={'content-type':'application/javascript; charset=utf-8','cache-control':'no-store, max-age=0','x-content-type-options':'nosniff'};
  if(!env.DOPPIO_DB)return new Response('/* Configuração pública padrão mantida. */',{headers});
  try{
    await ensureDb(env);
    const raw=await stateRow(env);
    const overlay=validateState(raw,raw.revision);
    const current=resolveStoreStatus(overlay);
    const isSpecialFriday=localDateKey(new Date())===SPECIAL_FRIDAY;
    const scheduled=overlay.scheduleEnabled?overlay.weeklyHours.map((day,i)=>day.enabled?WEEKDAYS[i].slice(0,3)+(isSpecialFriday&&i===5?' (hoje)':'')+' '+friendlyClock(isSpecialFriday&&i===5?'19:00':day.start)+'–'+friendlyClock(day.end):null).filter(Boolean):[];
    const business={
      openDays:scheduled.length?'Horários programados':overlay.openDays,
      openHours:scheduled.length?scheduled.join(' · '):(overlay.openHours||null),
      etaMinutes:overlay.etaMinutes,
      acceptingOrders:current.acceptingOrders,
      storeStatus:current.status,
      nextOpening:current.nextOpening,
      scheduleEnabled:current.scheduleEnabled
    };
    const escaped=JSON.stringify({business,products:overlay.products}).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
    return new Response('(()=>{const s='+escaped+';if(window.DOPPIO_CONFIG){Object.assign(window.DOPPIO_CONFIG.business,s.business);window.DOPPIO_CONFIG.products=s.products;}})();',{headers});
  }catch(_){
    // Falha de banco com binding ativo: não aceitar pedidos com catálogo possivelmente desatualizado.
    return new Response('if(window.DOPPIO_CONFIG){window.DOPPIO_CONFIG.business.acceptingOrders=false;}',{headers});
  }
}
