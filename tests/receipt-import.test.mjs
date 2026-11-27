/* Importação de cupons: Node.js 22+, SQLite isolado em memória. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {importReceiptApi} from '../src/receipt-import.js';
import {managementApi} from '../src/management.js';

const base='https://doppio.test';
function harness(){
 const db=new DatabaseSync(':memory:');
 const make=(sql,args=[])=>({
  sql,args,
  bind(...values){return make(sql,values);},
  first:async()=>db.prepare(sql).get(...args)||null,
  all:async()=>({results:db.prepare(sql).all(...args)}),
  run:async()=>({meta:db.prepare(sql).run(...args)})
 });
 const env={DOPPIO_DB:{
  prepare:sql=>make(sql),
  exec:async sql=>db.exec(sql),
  batch:async statements=>{
    db.exec('BEGIN');
    try{
      const result=statements.map(stmt=>({meta:db.prepare(stmt.sql).run(...stmt.args)}));
      db.exec('COMMIT');
      return result;
    }catch(e){db.exec('ROLLBACK');throw e}
  }
 }};
 const call=async(payload,method='POST')=>{
  const url=new URL(base+'/api/admin/management/receipts/import');
  const req=new Request(url,{method,headers:{origin:base,'content-type':'application/json'},body:JSON.stringify(payload)});
  const response=await importReceiptApi(req,env,url);
  return {httpStatus:response.status,...await response.json()};
 };
 const summary=async()=>{
  const url=new URL(base+'/api/admin/management/summary?month=2026-11');
  const req=new Request(url);const response=await managementApi(req,env,url);
  return {httpStatus:response.status,...await response.json()};
 };
 return {db,env,call,summary,close:()=>db.close()};
}
function sample(){
 return {
  receiptId:'TEST-NFCE-12345-20261127',merchant:'Mercado Teste',
  date:'2026-11-27',paymentMethod:'Cartão de crédito',expenseCategory:'ingredientes',totalCents:2485,
  items:[
    {name:'Queijo 1 kg',stockName:'Queijo',quantity:1,unit:'kg',packQuantity:1,packPriceCents:1000,lineTotalCents:1000},
    {name:'Refrigerante 2 L',stockName:'Refrigerante 2 L',quantity:3,unit:'un',packQuantity:1,packPriceCents:495,lineTotalCents:1485,bottleLiters:2}
  ]
 }
}
test('um cupom gera uma única despesa e entradas distintas de estoque',async()=>{
 const h=harness();try{
  const response=await h.call(sample());
  assert.equal(response.httpStatus,201);
  assert.equal(response.expenseEntries,1);
  assert.equal(response.stockMovements,2);
  assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM doppio_management_expenses').get().n,1);
  assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM doppio_imported_receipt_lines').get().n,2);
  assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM stock_movements').get().n,2);
  const sum=await h.summary();
  assert.equal(sum.httpStatus,200);
  assert.equal(sum.expenses.bookedCents,2485);
  assert.equal(sum.expenses.paidCents,2485);
  assert.equal(h.db.prepare('SELECT quantity FROM stock_recipe LIMIT 1').get()?.quantity,undefined);
 }finally{h.close()}
});
test('reenvio do mesmo cupom não duplica estoque, despesa ou auditoria',async()=>{
 const h=harness();try{
  assert.equal((await h.call(sample())).httpStatus,201);
  const again=await h.call(sample());assert.equal(again.httpStatus,200);
  assert.equal(again.alreadyImported,true);
  assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM stock_movements').get().n,2);
  assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM doppio_management_expenses').get().n,1);
  assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM doppio_management_expense_audit').get().n,1);
 }finally{h.close()}
});
test('usa ingrediente já existente e converte kg para g corretamente',async()=>{
 const h=harness();try{
  await h.env.DOPPIO_DB.exec("CREATE TABLE IF NOT EXISTS stock_ingredients (id TEXT PRIMARY KEY,name TEXT NOT NULL COLLATE NOCASE UNIQUE,unit TEXT NOT NULL,pack_qty REAL NOT NULL,pack_price_cents INTEGER NOT NULL,minimum_qty REAL NOT NULL,opening_qty REAL NOT NULL,active INTEGER NOT NULL DEFAULT 1,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL)");
  h.db.prepare('INSERT INTO stock_ingredients VALUES(?,?,?,?,?,?,?,?,?,?)')
   .run('a-existing','Queijo','g',1000,800,100,400,1,1,1);
  const imported=await h.call(sample());
  assert.equal(imported.httpStatus,201);
  assert.equal(imported.newIngredients,1);
  assert.equal(h.db.prepare("SELECT count(*) AS n FROM stock_ingredients WHERE name='Queijo'").get().n,1);
  assert.equal(h.db.prepare("SELECT delta_qty FROM stock_movements WHERE ingredient_id='a-existing'").get().delta_qty,1000);
  assert.equal(h.db.prepare("SELECT pack_qty FROM stock_ingredients WHERE id='a-existing'").get().pack_qty,1000);
 }finally{h.close()}
});
test('soma errada impede lançamento de qualquer registro',async()=>{
 const h=harness();try{
  const invalid=sample();invalid.totalCents=2500;
  const out=await h.call(invalid);
  assert.equal(out.httpStatus,422);
  assert.equal(h.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='doppio_imported_receipts'").get().n,0);
 }finally{h.close()}
});
test('erro durante batch reverte a operação completa',async()=>{
 const h=harness();try{
  const bad=sample();bad.items[1].stockName='Queijo';
  const out=await h.call(bad);assert.equal(out.httpStatus,422);
  const valid=sample();valid.items[1].stockName='Refrigerante 2 L';
  const first=await h.call(valid);assert.equal(first.httpStatus,201);
  const check=h.db.prepare('SELECT COUNT(*) AS n FROM doppio_imported_receipts').get();
  assert.equal(check.n,1);
 }finally{h.close()}
});
