/*
 * Doppio Pizzas: estoque e custos administrativos.
 * Todas as rotas são chamadas após autenticação no adminApi.
 * Estoque = saldo inicial + movimentações (histórico permanente e auditável).
 * Não descontar pré-pedidos: registrar saídas após confirmação/preparo.
 */
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{
  'content-type':'application/json; charset=utf-8','cache-control':'no-store',
  'x-content-type-options':'nosniff','referrer-policy':'no-referrer'
}});
const error=(code,message,status=400)=>reply({ok:false,code,message},status);
const inventoryReady=new WeakMap();
export async function ensureInventoryDb(env){
  if(!env.DOPPIO_DB)throw Error('D1 indisponível');
  let dbPromise=inventoryReady.get(env.DOPPIO_DB);
  if(!dbPromise){
    dbPromise=env.DOPPIO_DB.exec(
      'CREATE TABLE IF NOT EXISTS stock_ingredients ('
      +'id TEXT PRIMARY KEY,name TEXT NOT NULL COLLATE NOCASE UNIQUE,unit TEXT NOT NULL,'
      +'pack_qty REAL NOT NULL,pack_price_cents INTEGER NOT NULL,minimum_qty REAL NOT NULL,'
      +'opening_qty REAL NOT NULL,active INTEGER NOT NULL DEFAULT 1,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);'
      +'CREATE TABLE IF NOT EXISTS stock_movements ('
      +'id TEXT PRIMARY KEY,ingredient_id TEXT NOT NULL,kind TEXT NOT NULL,delta_qty REAL NOT NULL,'
      +'notes TEXT NOT NULL DEFAULT \'\',created_at INTEGER NOT NULL,'
      +'FOREIGN KEY(ingredient_id) REFERENCES stock_ingredients(id));'
      +'CREATE INDEX IF NOT EXISTS stock_movements_ingredient_idx ON stock_movements(ingredient_id,created_at DESC);'
      +'CREATE TABLE IF NOT EXISTS stock_recipe ('
      +'product_id TEXT NOT NULL,ingredient_id TEXT NOT NULL,quantity REAL NOT NULL,'
      +'PRIMARY KEY(product_id,ingredient_id),'
      +'FOREIGN KEY(ingredient_id) REFERENCES stock_ingredients(id));'
    ).catch(e=>{inventoryReady.delete(env.DOPPIO_DB);throw e;});
    inventoryReady.set(env.DOPPIO_DB,dbPromise);
  }
  await dbPromise;
}
async function body(req,max=15000){
  if(!(req.headers.get('content-type')||'').toLowerCase().startsWith('application/json'))throw Error('Envie dados em JSON.');
  if(Number(req.headers.get('content-length')||0)>max)throw Error('Dados muito grandes.');
  const raw=await req.text();
  if(raw.length>max)throw Error('Dados muito grandes.');
  const obj=JSON.parse(raw);
  if(!obj||typeof obj!=='object'||Array.isArray(obj))throw Error('Dados inválidos.');
  return obj;
}
const text=(v,max=100,min=0)=>typeof v==='string'&&v.trim().length>=min&&v.trim().length<=max&&!/[\u0000-\u001f]/.test(v);
const num=(v,min=0,max=1000000)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max&&Math.abs(v*1000-Math.round(v*1000))<0.00001;
const cents=v=>Number.isInteger(v)&&v>=0&&v<=100000000;
const ids=v=>typeof v==='string'&&/^[a-f0-9-]{36}$/i.test(v);
const rounded=v=>Math.round(v*1000)/1000;
const now=()=>Math.floor(Date.now()/1000);
const units=new Set(['g','kg','ml','L','un']);
function row(x){
  return {id:x.id,name:x.name,unit:x.unit,packQty:x.pack_qty,packPriceCents:x.pack_price_cents,
    minimumQty:x.minimum_qty,openingQty:x.opening_qty,quantity:rounded(x.quantity),
    active:Boolean(x.active),createdAt:x.created_at,updatedAt:x.updated_at};
}
async function list(env){
  const [a,b,c,d]=await Promise.all([
    env.DOPPIO_DB.prepare('SELECT i.*,i.opening_qty+COALESCE(m.delta,0) AS quantity FROM stock_ingredients i LEFT JOIN (SELECT ingredient_id,SUM(delta_qty) AS delta FROM stock_movements GROUP BY ingredient_id) m ON m.ingredient_id=i.id ORDER BY i.active DESC,i.name COLLATE NOCASE').all(),
    env.DOPPIO_DB.prepare('SELECT m.id,m.ingredient_id,m.kind,m.delta_qty,m.notes,m.created_at,i.name AS ingredient_name,i.unit FROM stock_movements m JOIN stock_ingredients i ON i.id=m.ingredient_id ORDER BY m.created_at DESC,m.rowid DESC LIMIT 80').all(),
    env.DOPPIO_DB.prepare('SELECT product_id,ingredient_id,quantity FROM stock_recipe ORDER BY product_id,ingredient_id').all(),
    env.DOPPIO_DB.prepare('SELECT data FROM admin_state WHERE id=1').first()
  ]);
  const products=JSON.parse(d?.data||'{}').products||[];
  return reply({ok:true,items:(a.results||[]).map(row),
    movements:(b.results||[]).map(m=>({id:m.id,ingredientId:m.ingredient_id,
      ingredientName:m.ingredient_name,unit:m.unit,kind:m.kind,deltaQty:m.delta_qty,
      notes:m.notes,createdAt:m.created_at})),
    recipes:(c.results||[]).map(r=>({productId:r.product_id,ingredientId:r.ingredient_id,quantity:r.quantity})),
    products:products.map(p=>({id:p.id,name:p.name,category:p.category,price:p.price,available:p.available}))});
}
function fields(input,create=false){
  const name=String(input.name||'').trim();
  if(!text(name,90,2))throw Error('Informe o nome do ingrediente (2 a 90 caracteres).');
  if(!num(input.packQty,0.001,1000000))throw Error('Informe a quantidade correta da embalagem comprada.');
  if(!cents(input.packPriceCents))throw Error('Informe o preço da embalagem em centavos, sem valores negativos.');
  if(!num(input.minimumQty,0,1000000))throw Error('Informe a quantidade mínima de estoque.');
  if(create){
    if(!units.has(input.unit))throw Error('Escolha uma unidade válida.');
    if(!num(input.openingQty,0,1000000))throw Error('Informe o saldo inicial em unidades de estoque.');
  }else if(typeof input.active!=='boolean')throw Error('Indique se o item está ativo.');
  return {name,packQty:rounded(input.packQty),packPriceCents:input.packPriceCents,
    minimumQty:rounded(input.minimumQty),...(create?{unit:input.unit,openingQty:rounded(input.openingQty)}:{active:input.active})};
}
async function createIngredient(req,env){
  let x;try{x=fields(await body(req),true);}catch(e){return error('validation',e.message,422);}
  const n=await env.DOPPIO_DB.prepare('SELECT COUNT(*) AS n FROM stock_ingredients').first();
  if(Number(n.n)>=300)return error('limit','Limite de 300 ingredientes.',422);
  try{
    const id=crypto.randomUUID(),at=now();
    await env.DOPPIO_DB.prepare('INSERT INTO stock_ingredients(id,name,unit,pack_qty,pack_price_cents,minimum_qty,opening_qty,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,1,?,?)')
      .bind(id,x.name,x.unit,x.packQty,x.packPriceCents,x.minimumQty,x.openingQty,at,at).run();
    return reply({ok:true,id},201);
  }catch(e){return /UNIQUE/i.test(String(e.message))?error('duplicate','Já existe ingrediente com esse nome.',409):error('database','Não foi possível cadastrar o ingrediente.',503);}
}
async function updateIngredient(req,env,id){
  let x;try{x=fields(await body(req));}catch(e){return error('validation',e.message,422);}
  try{
    const updated=await env.DOPPIO_DB.prepare('UPDATE stock_ingredients SET name=?,pack_qty=?,pack_price_cents=?,minimum_qty=?,active=?,updated_at=? WHERE id=?')
      .bind(x.name,x.packQty,x.packPriceCents,x.minimumQty,x.active?1:0,now(),id).run();
    if(!updated.meta?.changes)return error('not_found','Ingrediente não encontrado.',404);
    return reply({ok:true});
  }catch(e){return /UNIQUE/i.test(String(e.message))?error('duplicate','Já existe ingrediente com esse nome.',409):error('database','Não foi possível salvar o ingrediente.',503);}
}
async function createMovement(req,env){
  let x;try{x=await body(req);}catch(e){return error('invalid_request',e.message,400);}
  const kind=String(x.kind||'');
  const sign={entrada:1,consumo:-1,perda:-1,ajuste_mais:1,ajuste_menos:-1}[kind];
  if(!sign)return error('kind','Escolha entrada, consumo, perda ou ajuste.',422);
  if(!ids(x.ingredientId))return error('ingredient','Ingrediente inválido.',422);
  if(!num(x.quantity,0.001,1000000))return error('quantity','Informe quantidade maior que zero, até 3 casas decimais.',422);
  if(!text(x.notes||'',160))return error('notes','Observação muito longa.',422);
  const quantity=rounded(x.quantity),delta=rounded(quantity*sign);
  try{
    // Único INSERT condicionado ao saldo atual. A movimentação é a fonte do estoque,
    // evitando a dupla gravação de saldo + histórico.
    const result=await env.DOPPIO_DB.prepare(
      'INSERT INTO stock_movements (id,ingredient_id,kind,delta_qty,notes,created_at) '
      +'SELECT ?,i.id,?,?,?,? FROM stock_ingredients i WHERE i.id=? AND i.active=1 '
      +'AND i.opening_qty+COALESCE((SELECT SUM(delta_qty) FROM stock_movements WHERE ingredient_id=i.id),0)+?>=-0.00001'
    ).bind(crypto.randomUUID(),kind,delta,String(x.notes||'').trim(),now(),x.ingredientId,delta).run();
    if(!result.meta?.changes)return error('insufficient','Sem saldo suficiente, ou ingrediente arquivado. Revise o estoque.',409);
    return reply({ok:true});
  }catch(_){return error('database','Não foi possível registrar a movimentação.',503);}
}
async function saveRecipe(req,env,productId){
  let x;try{x=await body(req);}catch(e){return error('invalid_request',e.message,400);}
  if(!Array.isArray(x.lines)||x.lines.length>50)return error('lines','Informe até 50 ingredientes por pizza.',422);
  const entries=new Set();
  for(const r of x.lines){
    if(!r||!ids(r.ingredientId)||!num(r.quantity,0.001,1000000)||entries.has(r.ingredientId))
      return error('lines','Confira ingredientes duplicados e quantidades.',422);
    entries.add(r.ingredientId);
  }
  try{
    const catalog=await env.DOPPIO_DB.prepare('SELECT data FROM admin_state WHERE id=1').first();
    const products=JSON.parse(catalog?.data||'{}').products||[];
    if(!products.some(p=>p.id===productId))return error('product','Pizza não encontrada no cardápio.',404);
    if(entries.size){
      const placeholders=[...entries].map(()=>'?').join(',');
      const known=await env.DOPPIO_DB.prepare('SELECT id FROM stock_ingredients WHERE active=1 AND id IN ('+placeholders+')').bind(...entries).all();
      if((known.results||[]).length!==entries.size)return error('ingredient','Escolha apenas ingredientes ativos.',422);
    }
    const statements=[env.DOPPIO_DB.prepare('DELETE FROM stock_recipe WHERE product_id=?').bind(productId),
      ...x.lines.map(r=>env.DOPPIO_DB.prepare('INSERT INTO stock_recipe(product_id,ingredient_id,quantity) VALUES(?,?,?)')
        .bind(productId,r.ingredientId,rounded(r.quantity)))];
    await env.DOPPIO_DB.batch(statements);
    return reply({ok:true});
  }catch(_){return error('database','Não foi possível salvar a ficha técnica.',503);}
}
export async function inventoryApi(request,env,url){
  try{await ensureInventoryDb(env);}catch(_){return error('database','Não foi possível preparar o banco de estoque.',503);}
  const p=url.pathname;
  if(p==='/api/admin/inventory'&&request.method==='GET'){
    try{return await list(env);}catch(_){return error('database','Não foi possível carregar o estoque.',503);}
  }
  if(p==='/api/admin/inventory/items'&&request.method==='POST')return createIngredient(request,env);
  const item=p.match(/^\/api\/admin\/inventory\/items\/([a-f0-9-]{36})$/i);
  if(item&&request.method==='PUT')return updateIngredient(request,env,item[1]);
  if(p==='/api/admin/inventory/movements'&&request.method==='POST')return createMovement(request,env);
  const recipe=p.match(/^\/api\/admin\/inventory\/recipes\/([a-z0-9][a-z0-9-]{1,39})$/);
  if(recipe&&request.method==='PUT')return saveRecipe(request,env,recipe[1]);
  return error('not_found','Recurso de estoque não encontrado.',404);
}
