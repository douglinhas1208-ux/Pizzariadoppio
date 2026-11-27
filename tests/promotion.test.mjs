/* Homologação da promoção Doppio: Node 22+ e SQLite em memória. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {createOrder,adminOrdersApi,ensureOrdersDb} from '../src/orders.js';

const origin='https://cardapio.doppio.test';
const shop={products:[
  {id:'calabresa',name:'Calabresa',price:49.99,available:true,category:'Clássicas',halfAllowed:true},
  {id:'frango',name:'Frango com Catupiry',price:54.99,available:true,category:'Clássicas',halfAllowed:true},
  {id:'uva-nevada',name:'Uva Nevada',price:56.99,available:true,category:'Doces',halfAllowed:true},
  {id:'chocolate-uva',name:'Chocolate com Uva',price:56.99,available:true,category:'Doces',halfAllowed:true},
  {id:'chocolate-morango',name:'Chocolate com Morango',price:56.99,available:false,category:'Doces',halfAllowed:false}
]};
function createHarness(){
  const db=new DatabaseSync(':memory:');
  const make=(sql,args=[])=>({
    bind(...values){return make(sql,values)},
    first:async()=>db.prepare(sql).get(...args)||null,
    all:async()=>({results:db.prepare(sql).all(...args)}),
    run:async()=>({meta:{changes:db.prepare(sql).run(...args).changes}})
  });
  const env={DOPPIO_DB:{prepare:sql=>make(sql),exec:async sql=>db.exec(sql)},ADMIN_SESSION_SECRET:'test-secret-'.repeat(5)};
  const makeBody=(items,props={})=>({
    clientKey:randomUUID(),name:'Cliente Exemplo',phone:'11988887777',
    cep:'03904000',address:'Rua Teste Jardim Brasilia Sao Paulo',
    number:'25',complement:'',payment:'Pix',notes:'',items,
    shippingFee:5,distanceKm:1.5,...props
  });
  const add=async input=>{
    const req=new Request(origin+'/api/order',{
      method:'POST',headers:{origin,'content-type':'application/json','cf-connecting-ip':'10.0.0.1'},
      body:JSON.stringify(input)
    });
    const res=await createOrder(req,env,new URL(req.url),shop,{acceptingOrders:true});
    return {httpStatus:res.status,...await res.json()};
  };
  const rows=()=>db.prepare('SELECT * FROM doppio_orders ORDER BY created_at').all();
  const admin=async()=>{
    const req=new Request(origin+'/api/admin/orders');
    const res=await adminOrdersApi(req,env,new URL(req.url));
    return {httpStatus:res.status,...await res.json()};
  };
  return {db,env,makeBody,add,rows,admin,close:()=>db.close()};
}
const pizza=(id,qty=1)=>({type:'pizza',id,qty,note:''});
const half=(a,b,qty=1)=>({type:'half',a,b,qty,note:''});

test('uma pizza não recebe refrigerante e mantém preço',async()=>{
 const h=createHarness();try{
  const r=await h.add(h.makeBody([pizza('calabresa')]));
  assert.equal(r.httpStatus,200);
  assert.equal(h.rows()[0].promo_soda_variant,null);
  assert.equal(h.rows()[0].total_cents,5499);
 }finally{h.close()}
});
test('duas pizzas continuam com preço normal e sem brinde',async()=>{
 const h=createHarness();try{
  const r=await h.add(h.makeBody([pizza('calabresa',2)]));
  assert.equal(r.httpStatus,200);
  assert.equal(h.rows()[0].total_cents,10498);
  assert.equal(h.rows()[0].promo_soda_variant,null);
  const admin=await h.admin();
  assert.equal(admin.orders[0].promoSodaLabel,null);
 }finally{h.close()}
});
test('página antiga que manda Pepsi Zero não impede novo pedido e não ganha brinde',async()=>{
 const h=createHarness();try{
  const r=await h.add(h.makeBody([pizza('calabresa'),pizza('frango')],{promoSodaVariant:'pepsi-zero'}));
  assert.equal(r.httpStatus,200);
  assert.equal(h.rows()[0].promo_soda_variant,null);
  assert.equal(h.rows()[0].total_cents,10998);
 }finally{h.close()}
});
test('pedidos com meio a meio, doces e seis pizzas não ativam promoção',async()=>{
 const h=createHarness();try{
  for(const items of [[half('calabresa','frango'),pizza('frango')],[pizza('uva-nevada'),pizza('chocolate-uva')],[pizza('calabresa',6)]]){
   const r=await h.add(h.makeBody(items));
   assert.equal(r.httpStatus,200);
  }
  assert.equal(h.rows().length,3);
  h.rows().forEach(row=>assert.equal(row.promo_soda_variant,null));
  assert.equal((await h.add(h.makeBody([pizza('chocolate-morango',2)]))).httpStatus,422);
 }finally{h.close()}
});
test('pedidos antigos com refrigerante mantêm a informação no painel',async()=>{
 const h=createHarness();try{
  const r=await h.add(h.makeBody([pizza('calabresa',2)]));
  assert.equal(r.httpStatus,200);
  h.db.prepare('UPDATE doppio_orders SET promo_soda_variant=? WHERE reference=?').run('pepsi-zero',r.reference);
  const admin=await h.admin();
  assert.equal(admin.orders[0].promoSodaLabel,'Pepsi Zero 2 litros');
  assert.equal(admin.orders[0].totalCents,10498);
 }finally{h.close()}
});
test('repetir pedido antigo com opção Pepsi não duplica solicitações nem cria brinde',async()=>{
 const h=createHarness();try{
  const body=h.makeBody([pizza('calabresa',2)],{promoSodaVariant:'pepsi'});
  const first=await h.add(body),second=await h.add(body);
  assert.equal(first.httpStatus,200);assert.equal(second.httpStatus,200);
  assert.equal(first.reference,second.reference);
  assert.equal(h.rows().length,1);
  assert.equal(h.rows()[0].promo_soda_variant,null);
 }finally{h.close()}
});
test('migração preserva pedidos antigos sem alterar valores nem ativar promoção',async()=>{
 const h=createHarness();try{
  h.db.exec("CREATE TABLE doppio_orders (id TEXT PRIMARY KEY,reference TEXT NOT NULL UNIQUE,client_key TEXT NOT NULL UNIQUE,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,status TEXT NOT NULL,customer_name TEXT NOT NULL,cep TEXT NOT NULL,address TEXT NOT NULL,address_number TEXT NOT NULL,complement TEXT NOT NULL,payment TEXT NOT NULL,notes TEXT NOT NULL,items_json TEXT NOT NULL,subtotal_cents INTEGER NOT NULL,shipping_cents INTEGER,total_cents INTEGER,distance_km REAL,has_customization INTEGER NOT NULL DEFAULT 0,ip_key TEXT NOT NULL);");
  h.db.prepare("INSERT INTO doppio_orders (id,reference,client_key,created_at,updated_at,status,customer_name,cep,address,address_number,complement,payment,notes,items_json,subtotal_cents,shipping_cents,total_cents,distance_km,has_customization,ip_key) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run('old','DP-OLD','key-old',100,100,'concluido','Teste','03904000','Rua','10','','Pix','','[{"type":"pizza","qty":1}]',4999,500,5499,1.5,0,'old-ip');
  await ensureOrdersDb(h.env);
  assert.equal(h.rows().length,1);
  assert.equal(h.rows()[0].reference,'DP-OLD');
  assert.equal(h.rows()[0].promo_soda_variant,null);
  assert.equal((await h.add(h.makeBody([pizza('calabresa',2)]))).httpStatus,200);
  assert.equal(h.rows().length,2);
 }finally{h.close()}
});
