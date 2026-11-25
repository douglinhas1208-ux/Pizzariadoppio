/*
 * Testes de homologação da Gestão Doppio.
 * Execução local: node --test tests/management.test.mjs (Node 22+)
 * SQLite em memória; NÃO conecta ao D1 real da pizzaria.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {managementApi} from '../src/management.js';

const migration=readFileSync(new URL('../migrations/management-draft.sql',import.meta.url),'utf8');
const reference='https://localhost/api/admin/management';
function setup(){
  const db=new DatabaseSync(':memory:');
  db.exec('CREATE TABLE doppio_orders (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,status TEXT NOT NULL,items_json TEXT NOT NULL,subtotal_cents INTEGER NOT NULL,shipping_cents INTEGER,total_cents INTEGER,paid_amount_cents INTEGER);');
  const prep=(sql,values=[])=>({
    bind(...args){return prep(sql,args);},
    first:async()=>db.prepare(sql).get(...values)||null,
    all:async()=>({results:db.prepare(sql).all(...values)}),
    run:async()=>({meta:{changes:db.prepare(sql).run(...values).changes}})
  });
  const env={DOPPIO_DB:{prepare:sql=>prep(sql),exec:async sql=>db.exec(sql)}};
  const call=async(path,method='GET',payload)=>{
    const url=new URL(reference+path);
    const request=new Request(url,{method,headers:{'content-type':'application/json'},
      ...(payload===undefined?{}:{body:JSON.stringify(payload)})});
    const response=await managementApi(request,env,url);
    return {status:response.status,...await response.json()};
  };
  const add=(id,createdAt,status,quantities,subtotal,shipping,total,paid)=>{
    const items=JSON.stringify(quantities.map(q=>({qty:q})));
    db.prepare('INSERT INTO doppio_orders(id,created_at,updated_at,status,items_json,subtotal_cents,shipping_cents,total_cents,paid_amount_cents) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(id,createdAt,createdAt,status,items,subtotal,shipping,total,paid);
  };
  return {db,env,call,add,close:()=>db.close()};
}
const period=Date.parse('2026-11-20T12:00:00Z')/1000;

test('sem migração, API rejeita sem acessar produção',async()=>{
  const h=setup();
  try{
    const result=await h.call('/summary?month=2026-11');
    assert.equal(result.status,503);
    assert.equal(result.code,'not_migrated');
  }finally{h.close();}
});

test('sincroniza histórico, status e recebimentos sem duplicar',()=>{
  const h=setup();
  try{
    h.db.exec(migration);
    h.add('old',period-150*86400,'concluido',[1,2],10000,500,10500,10500);
    h.add('now',period,'novo',[2,1],12000,500,12500,0);
    assert.equal(h.db.prepare("SELECT pizza_quantity FROM doppio_management_sales WHERE order_id='now'").get().pizza_quantity,3);
    h.db.prepare("UPDATE doppio_orders SET status='preparo',paid_amount_cents=7000,updated_at=? WHERE id='now'").run(period+1);
    const changed=h.db.prepare("SELECT status,paid_amount_cents FROM doppio_management_sales WHERE order_id='now'").get();
    assert.equal(changed.status,'preparo');assert.equal(changed.paid_amount_cents,7000);
    h.db.exec(migration);
    assert.equal(h.db.prepare('SELECT count(*) AS n FROM doppio_management_sales').get().n,2);
    h.db.prepare("DELETE FROM doppio_orders WHERE id='old'").run();
    assert.equal(h.db.prepare("SELECT count(*) AS n FROM doppio_management_sales WHERE order_id='old'").get().n,1);
  }finally{h.close();}
});

test('resumo considera confirmados e destaca cancelados com pagamento',async()=>{
  const h=setup();
  try{
    h.db.exec(migration);
    h.add('a',period,'preparo',[2],10000,500,10500,5000);
    h.add('b',period,'novo',[1],5000,500,5500,null);
    h.add('c',period,'cancelado',[3],30000,null,null,2000);
    const r=await h.call('/summary?month=2026-11');
    assert.equal(r.status,200);
    assert.equal(r.sales.ordersTotal,3);assert.equal(r.sales.pizzasSold,2);
    assert.equal(r.sales.grossSalesCents,10500);
    assert.equal(r.sales.canceledPaymentsCents,2000);
    assert.equal(r.sales.paymentsRecordedCents,5000);
  }finally{h.close();}
});

test('cadastro de despesas e metas não modifica pedidos',async()=>{
  const h=setup();
  try{
    h.db.exec(migration);
    h.add('a',period,'concluido',[1],10000,500,10500,10500);
    const expense=await h.call('/expenses','POST',{
      date:'2026-11-20',category:'ingredientes',description:'Mussarela',
      amountCents:3000,paidDate:'2026-11-20'
    });
    assert.equal(expense.status,201);
    const goal=await h.call('/goals','PUT',{
      month:'2026-11',revenueTargetCents:50000,profitTargetCents:12000,pizzaTarget:20
    });
    assert.equal(goal.status,200);
    const r=await h.call('/summary?month=2026-11');
    assert.equal(r.expenses.bookedCents,3000);
    assert.equal(r.partialBalanceCents,7500);
    assert.equal(r.goal.pizzaTarget,20);
    assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM doppio_orders').get().n,1);
  }finally{h.close();}
});

test('validação bloqueia valores, datas e metas inválidos',async()=>{
  const h=setup();
  try{
    h.db.exec(migration);
    const baseline={date:'2026-11-20',category:'ingredientes',description:'Mussarela',amountCents:100};
    for(const bad of [{...baseline,amountCents:-1},{...baseline,date:'2026-02-30'},{...baseline,category:'qualquer'}]){
      const result=await h.call('/expenses','POST',bad);
      assert.equal(result.status,422,JSON.stringify(bad));
    }
    const goal=await h.call('/goals','PUT',{month:'2026-11',revenueTargetCents:300,profitTargetCents:-10,pizzaTarget:2});
    assert.equal(goal.status,422);
    assert.equal(h.db.prepare('SELECT count(*) AS n FROM doppio_management_expenses').get().n,0);
  }finally{h.close();}
});
