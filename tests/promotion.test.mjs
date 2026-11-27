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
    return {status:res.status,...await res.json()};
  };
  const rows=()=>db.prepare('SELECT * FROM doppio_orders ORDER BY created_at').all();
  const admin=async()=>{
    const req=new Request(origin+'/api/admin/orders');
    const res=await adminOrdersApi(req,env,new URL(req.url));
    return {status:res.status,...await res.json()};
  };
  return {db,env,makeBody,add,rows,admin,close:()=>db.close()};
}
const pizza=(id,qty=1)=>({type:'pizza',id,qty,note:''});
const half=(a,b,qty=1)=>({type:'half',a,b,qty,note:''});

test('uma pizza não dá brinde (também não altera preço)',async()=>{
  const h=createHarness();
  try{
    const result=await h.add(h.makeBody([pizza('calabresa')]));
    assert.equal(result.status,200);
    const [order]=h.rows();
    assert.equal(order.promo_soda_variant,null);
    assert.equal(order.subtotal_cents,4999);
    assert.equal(order.shipping_cents,500);
    assert.equal(order.total_cents,5499);
  }finally{h.close()}
});
test('duas pizzas ativam 1 Pepsi 2L, inclusive qty=2 no mesmo sabor',async()=>{
  const h=createHarness();
  try{
    const result=await h.add(h.makeBody([pizza('calabresa',2)]));
    assert.equal(result.status,200);
    const [row]=h.rows();
    assert.equal(row.promo_soda_variant,'pepsi');
    assert.equal(row.subtotal_cents,9998);
    assert.equal(row.total_cents,10498);
    assert.equal(JSON.parse(row.items_json).length,1);
    const panel=await h.admin();
    assert.equal(panel.status,200);
    assert.equal(panel.orders[0].promoSodaLabel,'Pepsi 2 litros');
  }finally{h.close()}
});
test('Pepsi Zero 2L é gravada e aparece no painel sem cobrar brinde',async()=>{
  const h=createHarness();
  try{
    const result=await h.add(h.makeBody([pizza('calabresa'),pizza('frango')],{promoSodaVariant:'pepsi-zero'}));
    assert.equal(result.status,200);
    const row=h.rows()[0];
    assert.equal(row.promo_soda_variant,'pepsi-zero');
    assert.equal(row.subtotal_cents,10498);
    assert.equal(row.total_cents,10998);
    const panel=await h.admin();
    assert.equal(panel.orders[0].promoSodaLabel,'Pepsi Zero 2 litros');
  }finally{h.close()}
});
test('meio a meio é uma pizza; duas metades NÃO ativam brinde sozinhas',async()=>{
  const h=createHarness();
  try{
    const one=await h.add(h.makeBody([half('calabresa','frango')]));
    assert.equal(one.status,200);
    const two=await h.add(h.makeBody([half('calabresa','frango'),pizza('calabresa')],{promoSodaVariant:'pepsi-zero'}));
    assert.equal(two.status,200);
    const results=h.rows().map(x=>x.promo_soda_variant);
    assert.equal(results.filter(x=>x===null).length,1);
    assert.equal(results.filter(x=>x==='pepsi-zero').length,1);
  }finally{h.close()}
});
test('pizzas doces entram na oferta e nenhuma pizza indisponível pode ser pedida',async()=>{
  const h=createHarness();
  try{
    assert.equal((await h.add(h.makeBody([half('uva-nevada','chocolate-uva'),pizza('uva-nevada')]))).status,200);
    assert.equal(h.rows()[0].promo_soda_variant,'pepsi');
    assert.equal((await h.add(h.makeBody([pizza('chocolate-morango',2)]))).status,422);
    assert.equal(h.rows().length,1);
  }finally{h.close()}
});
test('seis pizzas continuam dando uma garrafa por pedido e sem alteração de valor',async()=>{
  const h=createHarness();
  try{
    const result=await h.add(h.makeBody([pizza('calabresa',6)],{promoSodaVariant:'pepsi-zero'}));
    assert.equal(result.status,200);
    assert.equal(h.rows()[0].total_cents,6*4999+500);
    assert.equal(h.rows()[0].promo_soda_variant,'pepsi-zero');
  }finally{h.close()}
});
test('servidor rejeita brinde forjado com menos de duas pizzas e variante inexistente',async()=>{
  const h=createHarness();
  try{
    const one=await h.add(h.makeBody([pizza('calabresa')],{promoSodaVariant:'pepsi-zero'}));
    assert.equal(one.status,422);
    const fake=await h.add(h.makeBody([pizza('calabresa',2)],{promoSodaVariant:'outra-marca'}));
    assert.equal(fake.status,422);
    assert.equal(h.rows().length,0);
  }finally{h.close()}
});
test('pedido duplicado não gera uma segunda Pepsi, nem um segundo registro',async()=>{
  const h=createHarness();
  try{
    const body=h.makeBody([pizza('calabresa',2)],{promoSodaVariant:'pepsi-zero'});
    const a=await h.add(body),b=await h.add(body);
    assert.equal(a.status,200);assert.equal(b.status,200);
    assert.equal(a.reference,b.reference);assert.equal(h.rows().length,1);
  }finally{h.close()}
});
test('migração adiciona coluna ao banco antigo sem apagar pedidos existentes',async()=>{
  const h=createHarness();
  try{
    h.db.exec("CREATE TABLE doppio_orders (id TEXT PRIMARY KEY,reference TEXT NOT NULL UNIQUE,client_key TEXT NOT NULL UNIQUE,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,status TEXT NOT NULL,customer_name TEXT NOT NULL,cep TEXT NOT NULL,address TEXT NOT NULL,address_number TEXT NOT NULL,complement TEXT NOT NULL,payment TEXT NOT NULL,notes TEXT NOT NULL,items_json TEXT NOT NULL,subtotal_cents INTEGER NOT NULL,shipping_cents INTEGER,total_cents INTEGER,distance_km REAL,has_customization INTEGER NOT NULL DEFAULT 0,ip_key TEXT NOT NULL);");
    h.db.prepare("INSERT INTO doppio_orders (id,reference,client_key,created_at,updated_at,status,customer_name,cep,address,address_number,complement,payment,notes,items_json,subtotal_cents,shipping_cents,total_cents,distance_km,has_customization,ip_key) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run('previous','DP-OLD','old-key',100,100,'concluido','Teste','03904000','Rua Teste','10','','Pix','','[{"type":"pizza","qty":1}]',4999,500,5499,1.5,0,'old-ip');
    await ensureOrdersDb(h.env);
    assert.equal(h.rows().length,1);
    assert.equal(h.rows()[0].reference,'DP-OLD');
    assert.equal(h.rows()[0].promo_soda_variant,null);
    assert.equal((await h.add(h.makeBody([pizza('calabresa',2)]))).status,200);
    assert.equal(h.rows().length,2);
  }finally{h.close()}
});
