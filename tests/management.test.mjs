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
  db.exec('CREATE TABLE doppio_orders (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,status TEXT NOT NULL,items_json TEXT NOT NULL,subtotal_cents INTEGER NOT NULL,shipping_cents INTEGER,total_cents INTEGER,paid_amount_cents INTEGER,ip_key TEXT NOT NULL DEFAULT \'\');');
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

test('sem migração, API prepara tabelas e mantém dados operacionais',async()=>{
  const h=setup();
  try{
    const result=await h.call('/summary?month=2026-11');
    assert.equal(result.status,200);
    assert.equal(result.sales.ordersTotal,0);
    assert.equal(h.db.prepare("SELECT COUNT(*) AS n FROM doppio_orders").get().n,0);
  }finally{h.close();}
});

test('migração automática importa pedidos existentes antes do primeiro acesso',async()=>{
  const h=setup();
  try{
    h.add('antes',period-150*86400,'concluido',[2,1],16000,500,16500,16500);
    const result=await h.call('/summary?month=2026-06');
    assert.equal(result.status,200);
    assert.equal(h.db.prepare("SELECT pizza_quantity AS n FROM doppio_management_sales WHERE order_id='antes'").get().n,3);
    const later=await h.call('/summary?month=2026-06');
    assert.equal(later.status,200);
    assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM doppio_management_sales').get().n,1);
    assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM doppio_orders').get().n,1);
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


test('despesas podem ser editadas sem duplicação, preservando auditoria',async()=>{
  const h=setup();
  try{
    const posted=await h.call('/expenses','POST',{date:'2026-11-20',category:'ingredientes',
      description:'Tomate',amountCents:1500,paidDate:null});
    assert.equal(posted.status,201);
    assert.equal(posted.revision,0);
    let summary=await h.call('/summary?month=2026-11');
    assert.equal(summary.expenses.bookedCents,1500);
    const id=posted.id;
    const updated=await h.call('/expenses/'+id,'PUT',{expectedRevision:0,date:'2026-11-20',
      category:'embalagens',description:'Caixas de pizza',amountCents:2500,paidDate:'2026-11-20'});
    assert.equal(updated.status,200);
    assert.equal(updated.revision,1);
    summary=await h.call('/summary?month=2026-11');
    assert.equal(summary.expenses.bookedCents,2500);
    assert.equal(summary.expenses.paidCents,2500);
    assert.equal(summary.expenses.count,1);
    assert.equal(summary.expenses.rows[0].revision,1);
    assert.equal(summary.expenses.rows[0].category,'embalagens');
    const events=h.db.prepare('SELECT action,previous_json,current_json FROM doppio_management_expense_audit WHERE expense_id=? ORDER BY rowid').all(id);
    assert.deepEqual(events.map(x=>x.action),['created','updated']);
    assert.equal(JSON.parse(events[1].previous_json).amountCents,1500);
    assert.equal(JSON.parse(events[1].current_json).amountCents,2500);
  }finally{h.close();}
});

test('exclusão lógica retira despesa dos totais, preserva auditoria e não altera pedidos',async()=>{
  const h=setup();
  try{
    h.add('p1',period,'concluido',[1],10000,0,10000,10000);
    const entry=await h.call('/expenses','POST',{date:'2026-11-20',
      category:'gas',description:'Botijão de gás',amountCents:12500});
    assert.equal(entry.status,201);
    const removed=await h.call('/expenses/'+entry.id,'DELETE',{expectedRevision:0});
    assert.equal(removed.status,200);
    assert.equal(removed.archived,true);
    const summary=await h.call('/summary?month=2026-11');
    assert.equal(summary.expenses.bookedCents,0);
    assert.equal(summary.expenses.count,0);
    assert.equal(summary.sales.ordersTotal,1);
    assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM doppio_orders').get().n,1);
    assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM doppio_management_expenses').get().n,1);
    const events=h.db.prepare('SELECT action FROM doppio_management_expense_audit WHERE expense_id=? ORDER BY rowid').all(entry.id);
    assert.deepEqual(events.map(x=>x.action),['created','archived']);
    const repeat=await h.call('/expenses/'+entry.id,'DELETE',{expectedRevision:0});
    assert.equal(repeat.status,404);
  }finally{h.close();}
});

test('edição simultânea e valores inválidos são rejeitados sem alterar histórico',async()=>{
  const h=setup();
  try{
    const entry=await h.call('/expenses','POST',{date:'2026-11-19',
      category:'energia',description:'Conta de energia',amountCents:16000});
    assert.equal(entry.status,201);
    const first=await h.call('/expenses/'+entry.id,'PUT',{expectedRevision:0,date:'2026-11-19',
      category:'energia',description:'Conta corrigida',amountCents:14000});
    assert.equal(first.status,200);
    const stale=await h.call('/expenses/'+entry.id,'PUT',{expectedRevision:0,date:'2026-11-19',
      category:'energia',description:'Valor antigo',amountCents:18000});
    assert.equal(stale.status,409);
    const invalid=await h.call('/expenses/'+entry.id,'PUT',{expectedRevision:1,date:'2026-02-30',
      category:'energia',description:'Data inválida',amountCents:15000});
    assert.equal(invalid.status,422);
    const after=await h.call('/summary?month=2026-11');
    assert.equal(after.expenses.rows[0].description,'Conta corrigida');
    assert.equal(after.expenses.bookedCents,14000);
    assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM doppio_management_expense_audit').get().n,2);
  }finally{h.close();}
});



test('migração mantém lançamento antigo e permite corrigi-lo',async()=>{
  const h=setup();
  try{
    // Reproduz banco que já tinha despesas antes da versão de edição.
    h.db.exec(migration);
    const oldId='33333333-3333-4333-a333-333333333333';
    h.db.prepare('INSERT INTO doppio_management_expenses(id,expense_date,category,description,amount_cents,paid_at) VALUES (?,?,?,?,?,?)')
      .run(oldId,'2026-11-18','ingredientes','Compra antiga',7500,null);
    const before=await h.call('/summary?month=2026-11');
    assert.equal(before.status,200);
    assert.equal(before.expenses.count,1);
    assert.equal(before.expenses.rows[0].revision,0);
    assert.equal(before.expenses.bookedCents,7500);
    const change=await h.call('/expenses/'+oldId,'PUT',{
      expectedRevision:0,date:'2026-11-18',category:'ingredientes',
      description:'Compra antiga corrigida',amountCents:7000,paidDate:null
    });
    assert.equal(change.status,200);
    const after=await h.call('/summary?month=2026-11');
    assert.equal(after.expenses.bookedCents,7000);
    assert.equal(after.expenses.rows[0].description,'Compra antiga corrigida');
    const audit=h.db.prepare('SELECT action FROM doppio_management_expense_audit WHERE expense_id=?').all(oldId);
    assert.deepEqual(audit.map(x=>x.action),['updated']);
    assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM doppio_management_expenses').get().n,1);
  }finally{h.close();}
});
