/*
 * Importação autenticada de cupons em formato estruturado.
 * Sem upload de imagem ou OCR no Worker; o operador confirma os dados extraídos.
 * 1 despesa + N linhas detalhadas + N movimentos de estoque em transação D1.batch.
 * Idempotência por receiptId: repetir o envio não lança despesas/estoque em dobro.
 */
import {ensureManagementDb} from './management-schema.js';
import {ensureInventoryDb} from './inventory.js';
const send=(data,status=200)=>new Response(JSON.stringify(data),{
  status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}
});
const error=(code,message,status=422)=>send({ok:false,code,message},status);
const rightMoney=n=>Number.isSafeInteger(n)&&n>=0&&n<=100000000;
const goodNumber=n=>typeof n==='number'&&Number.isFinite(n)&&n>0&&n<=1000000&&Math.abs(n*1000-Math.round(n*1000))<1e-6;
const goodText=(s,min,max)=>typeof s==='string'&&s.trim().length>=min&&s.trim().length<=max&&!/[\u0000-\u001f]/.test(s);
const dayValid=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&
  Number.isFinite(Date.parse(s+'T12:00:00Z'))&&new Date(Date.parse(s+'T12:00:00Z')).toISOString().slice(0,10)===s;
const round=n=>Math.round(n*1000)/1000;
const now=()=>Math.floor(Date.now()/1000);
const expenseCategory=new Set(['ingredientes','embalagens','energia','gas','frete','marketing','manutencao','aluguel','taxas','outros']);
const units=new Set(['g','kg','ml','L','un']);
const weight=new Set(['g','kg']),volume=new Set(['ml','L']);
function toStockUnits(qty,unit,targetUnit,bottleLiters=0){
  if(unit===targetUnit)return round(qty);
  if(weight.has(unit)&&weight.has(targetUnit))return round(qty*(unit==='kg'?1000:1)/(targetUnit==='kg'?1000:1));
  if(volume.has(unit)&&volume.has(targetUnit))return round(qty*(unit==='L'?1000:1)/(targetUnit==='L'?1000:1));
  if(unit==='un'&&volume.has(targetUnit)&&goodNumber(bottleLiters))
    return round(qty*bottleLiters*(targetUnit==='ml'?1000:1));
  throw Error('Unidade incompatível para '+targetUnit+'. Revise a correspondência no estoque antes de importar.');
}
function validate(payload){
  if(!payload||typeof payload!=='object'||Array.isArray(payload))throw Error('Arquivo de cupom inválido.');
  if(!goodText(payload.receiptId,8,110)||!/^[a-zA-Z0-9_-]+$/.test(payload.receiptId))
    throw Error('Identificador do cupom inválido.');
  if(!goodText(payload.merchant,2,100)||!dayValid(payload.date))
    throw Error('Fornecedor ou data do cupom inválidos.');
  if(!rightMoney(payload.totalCents)||payload.totalCents<=0||!goodText(payload.paymentMethod,2,40))
    throw Error('Valor total ou forma de pagamento inválidos.');
  if(!expenseCategory.has(payload.expenseCategory||'ingredientes'))
    throw Error('Categoria financeira inválida.');
  if(!Array.isArray(payload.items)||payload.items.length<1||payload.items.length>60)
    throw Error('Cupom deve ter de 1 a 60 produtos.');
  let sum=0;const names=new Set();const items=payload.items.map((line,i)=>{
    if(!line||typeof line!=='object')throw Error('Item de cupom inválido.');
    if(!goodText(line.name,2,100)||!goodText(line.stockName,2,90))
      throw Error('Nome inválido no item '+(i+1));
    if(!units.has(line.unit)||!goodNumber(line.quantity)||!goodNumber(line.packQuantity)||
      !rightMoney(line.packPriceCents)||line.packPriceCents===0||
      !rightMoney(line.lineTotalCents)||line.lineTotalCents===0)
      throw Error('Quantidade ou preço inválido no item '+(i+1));
    if(line.unit==='un'&&!Number.isInteger(line.quantity))
      throw Error('Informe quantidade inteira de garrafas/unidades no item '+(i+1));
    if(line.bottleLiters!==undefined&&(!goodNumber(line.bottleLiters)||line.bottleLiters>100))
      throw Error('Volume da garrafa inválido.');
    if(names.has(line.stockName.toLowerCase()))
      throw Error('Dois produtos usam o mesmo nome de estoque: '+line.stockName);
    names.add(line.stockName.toLowerCase());
    sum+=line.lineTotalCents;
    return {name:line.name.trim(),stockName:line.stockName.trim(),quantity:line.quantity,unit:line.unit,
      packQuantity:line.packQuantity,packPriceCents:line.packPriceCents,
      lineTotalCents:line.lineTotalCents,bottleLiters:line.bottleLiters||0};
  });
  if(sum!==payload.totalCents)throw Error('A soma dos produtos não corresponde ao total do cupom.');
  return {receiptId:payload.receiptId,merchant:payload.merchant.trim(),date:payload.date,
    paymentMethod:payload.paymentMethod.trim(),totalCents:payload.totalCents,
    expenseCategory:payload.expenseCategory||'ingredientes',items};
}
const setup=[
 'CREATE TABLE IF NOT EXISTS doppio_imported_receipts (receipt_id TEXT PRIMARY KEY, merchant TEXT NOT NULL, purchase_date TEXT NOT NULL, payment_method TEXT NOT NULL, total_cents INTEGER NOT NULL, expense_id TEXT NOT NULL, imported_at INTEGER NOT NULL)',
 'CREATE TABLE IF NOT EXISTS doppio_imported_receipt_lines (receipt_id TEXT NOT NULL, line_number INTEGER NOT NULL, product_name TEXT NOT NULL, stock_name TEXT NOT NULL, quantity REAL NOT NULL, unit TEXT NOT NULL, line_total_cents INTEGER NOT NULL, PRIMARY KEY(receipt_id,line_number))'
];
export async function importReceiptApi(request,env,url){
  if(url.pathname!=='/api/admin/management/receipts/import'||request.method!=='POST')
    return error('not_found','Recurso não encontrado.',404);
  if(Number(request.headers.get('content-length')||0)>20000)
    return error('size','Cupom muito grande.');
  let input;
  try{
    if(!(request.headers.get('content-type')||'').includes('application/json'))throw Error('Envie um cupom JSON.');
    const raw=await request.text();
    if(raw.length>20000)throw Error('Cupom muito grande.');
    input=validate(JSON.parse(raw));
  }catch(e){return error('validation',e.message);}
  try{
    await ensureManagementDb(env);
    await ensureInventoryDb(env);
    for(const sql of setup)await env.DOPPIO_DB.prepare(sql).run();
    const old=await env.DOPPIO_DB.prepare('SELECT receipt_id,total_cents FROM doppio_imported_receipts WHERE receipt_id=?').bind(input.receiptId).first();
    if(old){
      if(old.total_cents!==input.totalCents)return error('conflict','Este identificador já foi usado em uma compra de valor diferente.',409);
      return send({ok:true,alreadyImported:true,receiptId:input.receiptId,totalCents:old.total_cents});
    }
    const all=await env.DOPPIO_DB.prepare('SELECT id,name,unit,pack_qty,pack_price_cents,active FROM stock_ingredients').all();
    const existing=all.results||[],created=now(),expenseId=crypto.randomUUID();
    const statements=[
      env.DOPPIO_DB.prepare('INSERT INTO doppio_imported_receipts(receipt_id,merchant,purchase_date,payment_method,total_cents,expense_id,imported_at) VALUES(?,?,?,?,?,?,?)')
        .bind(input.receiptId,input.merchant,input.date,input.paymentMethod,input.totalCents,expenseId,created),
      env.DOPPIO_DB.prepare('INSERT INTO doppio_management_expenses(id,expense_date,category,description,amount_cents,paid_at) VALUES(?,?,?,?,?,?)')
        .bind(expenseId,input.date,input.expenseCategory,
          ('Compra de estoque — '+input.merchant+' — '+input.receiptId).slice(0,160),
          input.totalCents,Math.floor(Date.parse(input.date+'T12:00:00Z')/1000))
    ];
    let newIngredients=0;
    for(const [i,item] of input.items.entries()){
      const found=existing.find(row=>row.name.toLocaleLowerCase('pt-BR')===item.stockName.toLocaleLowerCase('pt-BR'));
      if(found&&found.active===0)throw Error('Ingrediente arquivado: '+item.stockName+'. Reative no estoque antes de importar.');
      const targetUnit=found?.unit||item.unit;
      const quantity=toStockUnits(item.quantity,item.unit,targetUnit,item.bottleLiters);
      const packQty=toStockUnits(item.packQuantity,item.unit,targetUnit,item.bottleLiters);
      const ingredientId=found?.id||crypto.randomUUID();
      if(!found){
        newIngredients++;
        statements.push(env.DOPPIO_DB.prepare('INSERT INTO stock_ingredients(id,name,unit,pack_qty,pack_price_cents,minimum_qty,opening_qty,active,created_at,updated_at) VALUES(?,?,?,?,?,0,0,1,?,?)')
          .bind(ingredientId,item.stockName,item.unit,packQty,item.packPriceCents,created,created));
      }else{
        statements.push(env.DOPPIO_DB.prepare('UPDATE stock_ingredients SET pack_qty=?,pack_price_cents=?,updated_at=? WHERE id=? AND active=1')
          .bind(packQty,item.packPriceCents,created,ingredientId));
      }
      statements.push(env.DOPPIO_DB.prepare('INSERT INTO doppio_imported_receipt_lines(receipt_id,line_number,product_name,stock_name,quantity,unit,line_total_cents) VALUES(?,?,?,?,?,?,?)')
        .bind(input.receiptId,i+1,item.name,item.stockName,item.quantity,item.unit,item.lineTotalCents));
      statements.push(env.DOPPIO_DB.prepare('INSERT INTO stock_movements(id,ingredient_id,kind,delta_qty,notes,created_at) VALUES(?,?,?,?,?,?)')
        .bind(crypto.randomUUID(),ingredientId,'entrada',quantity,
          ('Cupom '+input.receiptId+' · '+input.date+' · '+input.merchant).slice(0,160),created));
    }
    // D1.batch aplica todos os comandos em transação, sem despesa ou estoque parcial.
    await env.DOPPIO_DB.batch(statements);
    return send({ok:true,alreadyImported:false,receiptId:input.receiptId,totalCents:input.totalCents,
      expenseEntries:1,stockMovements:input.items.length,newIngredients},201);
  }catch(e){
    console.error('[Doppio receipt import]',e?.message||String(e));
    if(/UNIQUE|constraint|already exists/i.test(String(e?.message||''))){
      return error('duplicate','Cupom já importado ou produto duplicado. Atualize e confira o estoque.',409);
    }
    return error('import_error','Importação não concluída. Nenhum lançamento parcial deve ser salvo; confira os dados e tente novamente.',503);
  }
}
