/*
 * Doppio Pizzas — solicitações de pedido.
 * Pedidos gerados no checkout são PRÉ-PEDIDOS: abrir o WhatsApp não comprova envio
 * nem aceitação. Somente admins autenticados acessam dados pessoais.
 */
const STATUSES=['novo','preparo','entrega','concluido','cancelado'];
const STATUS_LABELS={
  novo:'Aguardando confirmação',
  preparo:'Em preparação',
  entrega:'Saiu para entrega',
  concluido:'Concluído',
  cancelado:'Cancelado'
};
const KEEP_DAYS=90;
let readyPromise=null;
const json=(obj,status=200)=>new Response(JSON.stringify(obj),{
  status,headers:{
    'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store, max-age=0',
    'x-content-type-options':'nosniff',
    'referrer-policy':'no-referrer'
  }
});
const bad=(code,message,status=400)=>json({ok:false,code,message},status);
const goodText=(value,max,min=0)=>typeof value==='string'&&value.trim().length>=min&&value.trim().length<=max&&
  !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
const trim=(value,max=300)=>String(value||'').trim().slice(0,max);
const cents=n=>Math.round(n*100);
async function ensureOrdersDb(env){
  if(!env.DOPPIO_DB)throw Error('database_unavailable');
  if(!readyPromise){
    readyPromise=env.DOPPIO_DB.exec(
      'CREATE TABLE IF NOT EXISTS doppio_orders ('
      +'id TEXT PRIMARY KEY, reference TEXT NOT NULL UNIQUE, client_key TEXT NOT NULL UNIQUE,'
      +'created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, status TEXT NOT NULL,'
      +'customer_name TEXT NOT NULL, cep TEXT NOT NULL, address TEXT NOT NULL,'
      +'address_number TEXT NOT NULL, complement TEXT NOT NULL, payment TEXT NOT NULL, notes TEXT NOT NULL,'
      +'items_json TEXT NOT NULL, subtotal_cents INTEGER NOT NULL, shipping_cents INTEGER,'
      +'total_cents INTEGER, distance_km REAL, has_customization INTEGER NOT NULL DEFAULT 0,'
      +'ip_key TEXT NOT NULL);'
      +'CREATE INDEX IF NOT EXISTS doppio_orders_created_idx ON doppio_orders(created_at DESC);'
      +'CREATE INDEX IF NOT EXISTS doppio_orders_ip_idx ON doppio_orders(ip_key,created_at);'
    ).catch(e=>{readyPromise=null;throw e;});
  }
  await readyPromise;
}
export async function expireOrders(env){
  if(!env.DOPPIO_DB)return;
  await ensureOrdersDb(env);
  await env.DOPPIO_DB.prepare('DELETE FROM doppio_orders WHERE created_at < ?')
    .bind(Math.floor(Date.now()/1000)-KEEP_DAYS*86400).run();
}
async function parseBody(req,max=12000){
  const type=(req.headers.get('content-type')||'').toLowerCase();
  if(!type.startsWith('application/json'))throw Error('invalid_type');
  const size=Number(req.headers.get('content-length')||0);
  if(size>max)throw Error('too_large');
  const text=await req.text();
  if(text.length>max)throw Error('too_large');
  return JSON.parse(text);
}
async function hashClient(req,env){
  const ip=req.headers.get('cf-connecting-ip')||'unknown';
  const data=new TextEncoder().encode(ip+'|'+env.ADMIN_SESSION_SECRET);
  const digest=await crypto.subtle.digest('SHA-256',data);
  return Array.from(new Uint8Array(digest).slice(0,20),v=>v.toString(16).padStart(2,'0')).join('');
}
function validateOrder(input,shop){
  if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Revise os dados do pedido.');
  if(!/^[a-f0-9-]{36}$/i.test(input.clientKey||''))throw Error('Atualize o carrinho e tente novamente.');
  if(!goodText(input.name,70,2))throw Error('Informe seu nome.');
  if(!/^\d{8}$/.test(input.cep||''))throw Error('Informe um CEP válido.');
  if(!goodText(input.address,230,7))throw Error('Confira o endereço de entrega.');
  if(!/^[0-9]{1,6}[a-zA-Z]?$/.test(input.number||''))throw Error('Informe o número do endereço.');
  if(!goodText(input.complement||'',65)||!goodText(input.payment||'',80,2)||!goodText(input.notes||'',300))throw Error('Confira pagamento, complemento e observações.');
  if(!Array.isArray(input.items)||!input.items.length||input.items.length>40)throw Error('Adicione até 40 pizzas diferentes.');
  const catalog=new Map(shop.products.filter(p=>p.available).map(p=>[p.id,p]));
  let sum=0,count=0,hasCustomization=false;
  const items=input.items.map(item=>{
    if(!item||!Number.isInteger(item.qty)||item.qty<1||item.qty>99)throw Error('Quantidade de pizza inválida.');
    if(!goodText(item.note||'',180))throw Error('Observação do item muito grande.');
    const note=trim(item.note,180);
    let name,unitCents;
    if(item.type==='pizza'){
      const p=catalog.get(item.id);
      if(!p||!Number.isFinite(p.price))throw Error('Um sabor não está mais disponível. Atualize o cardápio.');
      name=p.name;unitCents=cents(p.price);
    }else if(item.type==='half'){
      const a=catalog.get(item.a),b=catalog.get(item.b);
      if(!a||!b||a.id===b.id||!Number.isFinite(a.price)||!Number.isFinite(b.price))throw Error('Uma das metades não está mais disponível.');
      name='Meio a meio: '+a.name+' / '+b.name;
      unitCents=Math.round((cents(a.price)+cents(b.price))/2);
    }else throw Error('Tipo de pizza inválido.');
    count+=item.qty;
    if(count>120)throw Error('Quantidade máxima de 120 pizzas por solicitação.');
    const itemCents=unitCents*item.qty;
    sum+=itemCents;
    if(note)hasCustomization=true;
    return {type:item.type,name,qty:item.qty,note,unitCents,itemCents};
  });
  let shippingCents=null,distanceKm=null;
  if(input.shippingFee!==null&&input.shippingFee!==undefined){
    if(typeof input.shippingFee!=='number'||!Number.isFinite(input.shippingFee)||input.shippingFee<5||input.shippingFee>10||Math.abs(input.shippingFee*100-cents(input.shippingFee))>1e-5)
      throw Error('Frete inválido. Recalcule no carrinho.');
    shippingCents=cents(input.shippingFee);
    if(typeof input.distanceKm==='number'&&Number.isFinite(input.distanceKm)&&input.distanceKm>=0&&input.distanceKm<=10.01){
      distanceKm=Math.round(input.distanceKm*100)/100;
      const expectedFee=5+Math.max(0,Math.ceil(distanceKm-5-1e-9));
      if(shippingCents!==expectedFee*100)throw Error('Frete desatualizado. Recalcule o CEP.');
    }
  }
  return {
    clientKey:input.clientKey.toLowerCase(),customerName:trim(input.name,70),cep:input.cep,
    address:trim(input.address,230),number:trim(input.number,7),complement:trim(input.complement,65),
    payment:trim(input.payment,80),notes:trim(input.notes,300),
    items,subtotalCents:sum,shippingCents,
    totalCents:shippingCents===null?null:sum+shippingCents,
    distanceKm,hasCustomization
  };
}
function publicReceipt(row){
  return {ok:true,reference:row.reference,status:'novo',label:STATUS_LABELS.novo,registered:true,
    notice:'Solicitação registrada no painel. A pizzaria ainda precisa confirmar o pedido pelo WhatsApp.'};
}
export async function createOrder(req,env,url,shop,store){
  if(req.method!=='POST')return bad('method','Use POST.',405);
  if(req.headers.get('origin')!==url.origin)return bad('origin','Origem não autorizada.',403);
  if(!env.DOPPIO_DB||typeof env.ADMIN_SESSION_SECRET!=='string')return bad('not_ready','Registro de pedidos temporariamente indisponível.',503);
  if(!store.acceptingOrders)return bad('closed','A pizzaria não está recebendo pedidos neste horário.',409);
  let input,order;
  try{
    input=await parseBody(req,12000);
    order=validateOrder(input,shop);
  }catch(e){return bad('invalid_order',e.message||'Revise seu pedido.',422);}
  try{
    await ensureOrdersDb(env);
    const previous=await env.DOPPIO_DB.prepare('SELECT reference,ip_key FROM doppio_orders WHERE client_key=?')
      .bind(order.clientKey).first();
    const ipKey=await hashClient(req,env);
    if(previous){
      if(previous.ip_key!==ipKey)return bad('duplicate','Atualize o carrinho e tente novamente.',409);
      return json(publicReceipt(previous));
    }
    const now=Math.floor(Date.now()/1000);
    const recent=await env.DOPPIO_DB.prepare('SELECT COUNT(*) AS n FROM doppio_orders WHERE ip_key=? AND created_at>?')
      .bind(ipKey,now-900).first();
    if(Number(recent?.n||0)>=8)return bad('rate_limit','Muitas solicitações recentes. Entre em contato pelo WhatsApp.',429);
    const id=crypto.randomUUID();
    const reference='DP-'+new Date().toISOString().slice(0,10).replace(/-/g,'')+'-'+id.slice(0,8).toUpperCase();
    await env.DOPPIO_DB.prepare('INSERT INTO doppio_orders '
      +'(id,reference,client_key,created_at,updated_at,status,customer_name,cep,address,address_number,complement,payment,notes,items_json,subtotal_cents,shipping_cents,total_cents,distance_km,has_customization,ip_key) '
      +'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(id,reference,order.clientKey,now,now,'novo',order.customerName,order.cep,order.address,order.number,
        order.complement,order.payment,order.notes,JSON.stringify(order.items),order.subtotalCents,
        order.shippingCents,order.totalCents,order.distanceKm,order.hasCustomization?1:0,ipKey).run();
    return json(publicReceipt({reference}));
  }catch(e){
    if(String(e?.message||'').includes('UNIQUE constraint failed')){
      const existing=await env.DOPPIO_DB.prepare('SELECT reference FROM doppio_orders WHERE client_key=?')
        .bind(order.clientKey).first();
      if(existing)return json(publicReceipt(existing));
    }
    return bad('database_error','Não foi possível registrar a solicitação neste momento.',503);
  }
}
function safeOrder(row){
  return {
    id:row.id,reference:row.reference,status:row.status,createdAt:Number(row.created_at),
    updatedAt:Number(row.updated_at),customerName:row.customer_name,cep:row.cep,
    address:row.address,number:row.address_number,complement:row.complement,
    payment:row.payment,notes:row.notes,items:JSON.parse(row.items_json),
    subtotalCents:row.subtotal_cents,shippingCents:row.shipping_cents,totalCents:row.total_cents,
    distanceKm:row.distance_km,hasCustomization:!!row.has_customization
  };
}
export async function adminOrdersApi(req,env,url){
  if(req.method!=='GET'&&req.method!=='PUT'&&req.method!=='DELETE')return bad('method','Método não permitido.',405);
  try{await ensureOrdersDb(env);}catch(_){return bad('database_error','Banco de pedidos indisponível.',503);}
  if(url.pathname==='/api/admin/orders'&&req.method==='GET'){
    try{
      await expireOrders(env);
      const [rows,groups]=await Promise.all([
        env.DOPPIO_DB.prepare('SELECT id,reference,status,created_at,updated_at,customer_name,cep,address,address_number,complement,payment,notes,items_json,subtotal_cents,shipping_cents,total_cents,distance_km,has_customization FROM doppio_orders ORDER BY created_at DESC LIMIT 100').all(),
        env.DOPPIO_DB.prepare('SELECT status,COUNT(*) AS total FROM doppio_orders GROUP BY status').all()
      ]);
      const stats=Object.fromEntries(STATUSES.map(status=>[status,0]));
      for(const row of groups.results||[])if(Object.hasOwn(stats,row.status))stats[row.status]=Number(row.total);
      return json({ok:true,orders:(rows.results||[]).map(safeOrder),stats,limit:100,
        retentionDays:KEEP_DAYS,labels:STATUS_LABELS});
    }catch(_){return bad('database_error','Não foi possível carregar os pedidos.',503);}
  }
  const match=/^\/api\/admin\/orders\/([0-9a-f-]{36})$/.exec(url.pathname);
  if(!match)return bad('not_found','Pedido não encontrado.',404);
  if(req.method==='DELETE'){
    try{
      const result=await env.DOPPIO_DB.prepare('DELETE FROM doppio_orders WHERE id=?').bind(match[1]).run();
      if(!result.meta||!result.meta.changes)return bad('not_found','Pedido não encontrado.',404);
      return json({ok:true,deleted:true});
    }catch(_){return bad('database_error','Não foi possível excluir o pedido.',503);}
  }
  if(req.method!=='PUT')return bad('method','Use PUT.',405);
  let input;
  try{input=await parseBody(req,1200);}catch(_){return bad('invalid_request','Dados inválidos.',400);}
  if(!STATUSES.includes(input?.status))return bad('invalid_status','Escolha um status válido.',422);
  try{
    const now=Math.floor(Date.now()/1000);
    const result=await env.DOPPIO_DB.prepare('UPDATE doppio_orders SET status=?,updated_at=? WHERE id=?')
      .bind(input.status,now,match[1]).run();
    if(!result.meta||!result.meta.changes)return bad('not_found','Pedido não encontrado.',404);
    return json({ok:true,status:input.status,label:STATUS_LABELS[input.status]});
  }catch(_){return bad('database_error','Não foi possível atualizar o pedido.',503);}
}
