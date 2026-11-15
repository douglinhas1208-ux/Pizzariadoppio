import {adminApi,publicCatalogScript,publicStoreStatus,publicCreateOrder} from './admin.js';
import {expireOrders} from './orders.js';
import {servePhoto} from './images.js';
/*
 * Doppio Pizzas — cálculo de frete no Cloudflare Worker.
 * Segredo ORS_API_KEY: somente no Cloudflare, jamais no GitHub.
 * Distância de percurso viário, não raio em linha reta.
 */
const ORS = 'https://api.heigit.org';
const SHOP = 'Rua Firmino Morgado, 60, Jardim Brasília, São Paulo, SP, Brasil';
// Coordenadas da pizzaria confirmadas por marcador do Google Maps: [longitude, latitude]
const SHOP_COORDS = [-46.4938778,-23.5532045];
const MAX_KM = 5;
const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: {'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}
});
const normalize = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\b(rua|av|avenida|travessa|numero|n|do|da|de|dos|das)\b/g,' ').replace(/\s+/g,' ').trim();
const validCoord = point => Array.isArray(point) && point.length===2 && point.every(Number.isFinite) && point[0]>-48 && point[0]<-45 && point[1]>-25 && point[1]<-22;
const siteError = (code, message, status=400, details={}) => json({ok:false,code,message,...details},status);
async function getJSON(uri,options={},ms=9500) {
  const res=await fetch(uri,{...options,signal:AbortSignal.timeout(ms),headers:{accept:'application/json',...(options.headers||{})}});
  let data;try{data=await res.json()}catch(_){data=null}
  if (!res.ok) {
    const e=new Error('upstream '+res.status);
    e.status=res.status;
    throw e;
  }
  return data;
}
async function cepLookup(cep) {
  let result=null;
  try {
    result=await getJSON('https://viacep.com.br/ws/'+cep+'/json/',{},5500);
    if(result?.logradouro && result.localidade && result.uf && !result.erro) {
      return {cep,street:result.logradouro,neighborhood:result.bairro||'',city:result.localidade,state:result.uf};
    }
  } catch (_) { /* tentar segundo fornecedor de CEP */ }
  try {
    result=await getJSON('https://brasilapi.com.br/api/cep/v1/'+cep,{},6500);
    if(result?.street && result.city && result.state) {
      return {cep,street:result.street,neighborhood:result.neighborhood||'',city:result.city,state:result.state};
    }
  } catch (_) { /* endereço não encontrado ou fornecedores temporariamente indisponíveis */ }
  return null;
}
function geocodeInfo(feature,street,number) {
  const p=feature.properties||{};
  const coord=feature.geometry?.coordinates;
  if(!validCoord(coord))return null;
  const searched=normalize(street);
  const found=normalize(p.street || p.name || '');
  const label=normalize(p.label);
  const words=searched.split(' ').filter(x=>x.length>2);
  const similarity=words.length && words.every(x=>found.includes(x) || label.includes(x));
  if(!similarity)return null;
  const n=String(p.housenumber||'').trim();
  const sameNumber=n===String(number);
  const fullAddress=p.layer==='address' && sameNumber;
  return {point:coord,quality:fullAddress?'number':'street',label:p.label||'',layer:p.layer||'',housenumber:n,confidence:typeof p.confidence==='number'?p.confidence:null};
}
// CEP identifica a rua ou trecho de rua: nunca afirmar precisão de uma residência.
async function geocodeByCep(apiKey,address) {
  const {street,neighborhood,city,state}=address;
  const queries=[
    [street,neighborhood,city,state,'Brasil'].filter(Boolean).join(', '),
    [street,city,state,'Brasil'].filter(Boolean).join(', ')
  ];
  let matches=[];
  for(const searchText of queries){
    const uri=new URL(ORS+'/pelias/v1/search');
    uri.searchParams.set('text',searchText);
    uri.searchParams.set('size','10');
    uri.searchParams.set('boundary.country','BRA');
    uri.searchParams.set('focus.point.lat',String(SHOP_COORDS[1]));
    uri.searchParams.set('focus.point.lon',String(SHOP_COORDS[0]));
    const data=await getJSON(uri.toString(),{headers:{Authorization:apiKey}},9500);
    const points=(data.features||[]).map(f=>geocodeInfo(f,street,'')).filter(Boolean);
    matches.push(...points.filter(m=>haversine(SHOP_COORDS,m.point)<25));
    if(matches.some(m=>m.layer==='street'))break;
  }
  matches.sort((a,b)=>(b.layer==='street'?1:0)-(a.layer==='street'?1:0)
    || (b.confidence||0)-(a.confidence||0)
    || haversine(SHOP_COORDS,a.point)-haversine(SHOP_COORDS,b.point));
  return matches[0]||null;
}
function haversine(a,b) {
  const toRad=x=>x*Math.PI/180;
  const dlat=toRad(b[1]-a[1]),dlon=toRad(b[0]-a[0]);
  const h=Math.sin(dlat/2)**2+Math.cos(toRad(a[1]))*Math.cos(toRad(b[1]))*Math.sin(dlon/2)**2;
  return 12742*Math.asin(Math.min(1,Math.sqrt(h)));
}
async function route(apiKey,origin,dest) {
  const response=await getJSON(ORS+'/openrouteservice/v2/directions/driving-car/json',{
    method:'POST',
    headers:{Authorization:apiKey,'content-type':'application/json'},
    body:JSON.stringify({coordinates:[origin,dest],instructions:false,geometry:false})
  },11000);
  const meters=response.routes?.[0]?.summary?.distance;
  if(!Number.isFinite(meters) || meters<0)throw new Error('route_malformed');
  return meters;
}
async function antiAbuse(request,url) {
  const origin=request.headers.get('origin');
  if(origin && origin!==url.origin)return false;
  const ip=request.headers.get('cf-connecting-ip');
  if(!ip)return true;
  try {
    const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(ip));
    const sig=Array.from(new Uint8Array(bytes)).slice(0,10).map(b=>b.toString(16).padStart(2,'0')).join('');
    const cacheKey=new Request(url.origin+'/__ors_rate_'+sig);
    const existing=await caches.default.match(cacheKey);
    if(existing)return false;
    await caches.default.put(cacheKey,new Response('1',{headers:{'cache-control':'public, max-age=4'}}));
  } catch(_){/* não interromper pedidos por indisponibilidade transitória do cache */}
  return true;
}
async function frete(request,env,url) {
  if(!env.ORS_API_KEY)return siteError('unconfigured','Serviço de rotas em configuração.',503);
  if(!await antiAbuse(request,url))return siteError('rate_limit','Aguarde alguns segundos antes de recalcular.',429);
  const size=Number(request.headers.get('content-length')||0);
  if(size>900)return siteError('payload','Dados de endereço excessivos.',413);
  let input;
  try {input=await request.json()}catch(_){return siteError('json','Dados inválidos.')}
  const cep=String(input?.cep||'').replace(/\D/g,'');
  if(!/^\d{8}$/.test(cep))return siteError('invalid_cep','Informe um CEP válido com oito dígitos.');
  try {
    let stage='cep';
    const address=await cepLookup(cep);
    if(!address)return siteError('cep_not_found','CEP não localizado. Confira os oito dígitos.',422);
    if(address.state!=='SP')return siteError('outside_state','CEP fora da região de entrega.',422);
    const originPoint=SHOP_COORDS;
    if(!validCoord(originPoint))return siteError('origin_setup','Ponto de saída não configurado.',503);
    stage='destination';
    const candidate=await geocodeByCep(env.ORS_API_KEY,address);
    if(!candidate)return siteError('cep_unmapped','A rua desse CEP não foi encontrada no mapa de rotas. Frete a confirmar pela pizzaria.',422,{address});
    const destination=candidate.point;
    if(haversine(originPoint,destination)>MAX_KM+2){
      return siteError('outside_area','Endereço fora da área de entrega de até 5 km.',422,{address});
    }
    stage='route';
    const meters=await route(env.ORS_API_KEY,originPoint,destination);
    const km=meters/1000;
    if(km>MAX_KM+1e-6)return siteError('outside_area','Distância de referência do CEP acima de 5 km. Consulte a pizzaria se estiver perto do limite.',422,{address,distanceKm:Math.round(km*100)/100});
    // Arredonda a distância para cima ao centésimo de km para não ocultar ultrapassagem de faixa.
    const billedKm=Math.ceil(km*100-1e-9)/100;
    const fee=5+Math.max(0,Math.ceil(billedKm-2-1e-9));
    return json({ok:true,address,distanceMeters:Math.round(meters),distanceKm:billedKm,fee,precision:'referencia_do_cep',estimated:true,origin:'Rua Firmino Morgado, 60',destination:{lon:destination[0],lat:destination[1]},routeMode:'driving-car'});
  } catch(e) {
    if(e.status===403 || e.status===401)return siteError('provider_access','O serviço de rotas recusou a chave. Confira o plano e a ativação da API.',503);
    return siteError('provider_unavailable_'+stage,'Não foi possível consultar o serviço de '+stage+' agora.',503,{upstreamStatus:typeof e.status==='number'?e.status:null});
  }
}
export default {
  async fetch(request,env) {
    const url=new URL(request.url);
    if(url.pathname.startsWith('/api/photo/'))return servePhoto(request,env,url);
    if(url.pathname==='/api/order')return publicCreateOrder(request,env,url);
    if(url.pathname==='/api/store-status'){
      if(request.method!=='GET')return siteError('method','Use GET.',405);
      return publicStoreStatus(env);
    }
    if(url.pathname==='/api/public-config.js'){
      if(request.method!=='GET')return siteError('method','Use GET.',405);
      return publicCatalogScript(env);
    }
    if(url.pathname.startsWith('/api/admin/'))return adminApi(request,env,url);
    if(url.pathname==='/api/status'){
      return json({service:'doppio-frete',configured:Boolean(env.ORS_API_KEY)});
    }
    if(url.pathname==='/api/cep'){
      if(request.method!=='GET')return siteError('method','Use GET.',405);
      const cep=String(url.searchParams.get('cep')||'').replace(/\D/g,'');
      if(!/^\d{8}$/.test(cep))return siteError('invalid_cep','Digite um CEP com oito números.');
      try {
        const address=await cepLookup(cep);
        return address?json({ok:true,address}):siteError('cep_not_found','CEP não localizado.',422);
      }catch(_){return siteError('cep_unavailable','Não foi possível consultar o CEP agora.',503)}
    }
    if(url.pathname==='/api/frete'){
      if(request.method!=='POST')return siteError('method','Use POST.',405);
      return frete(request,env,url);
    }
    if(url.pathname.startsWith('/api/'))return siteError('not_found','Rota não encontrada.',404);
    return env.ASSETS.fetch(request);
  },
  async scheduled(_event,env,ctx){
    ctx.waitUntil(expireOrders(env));
  }
};
