import {ensureManagementDb} from './management-schema.js';
/*
 * Doppio Pizzas — gestão empresarial (pré-produção).
 * Requer migrations/management-draft.sql aplicada em BANCO DE TESTE.
 * Não lê nem expõe informações pessoais de clientes.
 * Receita estimada de vendas ≠ recebimento bancário; estornos ficam pendentes
 * de um livro de caixa conciliado, a ser implantado antes da produção.
 */
const send=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{
  'content-type':'application/json; charset=utf-8',
  'cache-control':'no-store, max-age=0','x-content-type-options':'nosniff'
}});
const fail=(code,message,status=400)=>send({ok:false,code,message},status);
const categoryNames=new Set(['ingredientes','embalagens','energia','gas','frete','marketing','manutencao','aluguel','taxas','outros']);
const monthOK=s=>typeof s==='string'&&/^20\d{2}-(0[1-9]|1[0-2])$/.test(s);
const dateOK=s=>{
  if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;
  const parsed=Date.parse(s+'T12:00:00Z');
  return Number.isFinite(parsed)&&new Date(parsed).toISOString().slice(0,10)===s;
};
const isCents=(n,zero=false)=>Number.isSafeInteger(n)&&n>=(zero?0:1)&&n<=100000000;
const isCount=n=>Number.isSafeInteger(n)&&n>=0&&n<=1000000;
const dayStamp=s=>Math.floor(Date.parse(s+'T12:00:00Z')/1000);
const str=(v,min,max)=>typeof v==='string'&&v.trim().length>=min&&v.trim().length<=max&&!/[\u0000-\u001f]/.test(v);
const now=()=>Math.floor(Date.now()/1000);
function monthFromRequest(url){
  const m=url.searchParams.get('month');
  if(!monthOK(m))throw Error('Informe um mês no formato AAAA-MM.');
  return m;
}
function bounds(m){
  const [y,mo]=m.split('-').map(Number);
  return [Math.floor(Date.UTC(y,mo-1,1,3)/1000),Math.floor(Date.UTC(y,mo,1,3)/1000)];
}
async function jsonBody(request,max=4000){
  if(!(request.headers.get('content-type')||'').toLowerCase().startsWith('application/json'))throw Error('Envie dados em JSON.');
  if(Number(request.headers.get('content-length')||0)>max)throw Error('Dados muito grandes.');
  const raw=await request.text();
  if(raw.length>max)throw Error('Dados muito grandes.');
  const item=JSON.parse(raw);
  if(!item||Array.isArray(item)||typeof item!=='object')throw Error('Dados inválidos.');
  return item;
}
async function getSummary(env,month){
  const [start,end]=bounds(month),q=env.DOPPIO_DB.prepare.bind(env.DOPPIO_DB);
  const [sales,expenses,goal,details]=await Promise.all([
    q("SELECT COUNT(*) AS orders_total,"+
      "COALESCE(SUM(CASE WHEN status='novo' THEN 1 ELSE 0 END),0) AS pending_orders,"+
      "COALESCE(SUM(CASE WHEN status='cancelado' THEN 1 ELSE 0 END),0) AS canceled_orders,"+
      "COALESCE(SUM(CASE WHEN status IN ('preparo','entrega','concluido') THEN 1 ELSE 0 END),0) AS confirmed_orders,"+
      "COALESCE(SUM(CASE WHEN status IN ('preparo','entrega','concluido') THEN pizza_quantity ELSE 0 END),0) AS pizzas_sold,"+
      "COALESCE(SUM(pizza_quantity),0) AS pizzas_requested,"+
      "COALESCE(SUM(CASE WHEN status IN ('preparo','entrega','concluido') THEN subtotal_cents ELSE 0 END),0) AS food_sales_cents,"+
      "COALESCE(SUM(CASE WHEN status IN ('preparo','entrega','concluido') THEN COALESCE(shipping_cents,0) ELSE 0 END),0) AS shipping_sales_cents,"+
      "COALESCE(SUM(CASE WHEN status IN ('preparo','entrega','concluido') THEN COALESCE(total_cents,subtotal_cents+COALESCE(shipping_cents,0)) ELSE 0 END),0) AS gross_sales_cents,"+
      "COALESCE(SUM(CASE WHEN status IN ('preparo','entrega','concluido') THEN COALESCE(paid_amount_cents,0) ELSE 0 END),0) AS payments_recorded_cents,"+
      "COALESCE(SUM(CASE WHEN status='cancelado' THEN COALESCE(paid_amount_cents,0) ELSE 0 END),0) AS canceled_payments_cents "+
      "FROM doppio_management_sales WHERE order_created_at>=? AND order_created_at<?").bind(start,end).first(),
    q("SELECT COALESCE(SUM(amount_cents),0) AS booked_expenses_cents,"+
      "COALESCE(SUM(CASE WHEN paid_at IS NOT NULL THEN amount_cents ELSE 0 END),0) AS paid_expenses_cents,"+
      "COUNT(*) AS expense_entries FROM doppio_management_expenses WHERE expense_date>=? AND expense_date<?")
      .bind(month+'-01',nextMonth(month)+'-01').first(),
    q('SELECT revenue_target_cents,profit_target_cents,pizza_target,operating_weekdays FROM doppio_management_goals WHERE month=?').bind(month).first(),
    q("SELECT id,expense_date,category,description,amount_cents,paid_at FROM doppio_management_expenses "+
      "WHERE expense_date>=? AND expense_date<? ORDER BY expense_date DESC,id DESC LIMIT 200")
      .bind(month+'-01',nextMonth(month)+'-01').all()
  ]);
  const s=sales||{},e=expenses||{};
  const salesCents=Number(s.gross_sales_cents||0);
  const bookedCents=Number(e.booked_expenses_cents||0);
  // Apenas indicador parcial: não inclui custo de receita/ingrediente nem impostos.
  const partialBalanceCents=salesCents-bookedCents;
  const rows=(details.results||[]).map(x=>({
    id:x.id,date:x.expense_date,category:x.category,description:x.description,
    amountCents:x.amount_cents,paidAt:x.paid_at
  }));
  return send({ok:true,month,timezone:'America/Sao_Paulo',
    sales:{ordersTotal:Number(s.orders_total||0),confirmedOrders:Number(s.confirmed_orders||0),
      pendingOrders:Number(s.pending_orders||0),canceledOrders:Number(s.canceled_orders||0),
      pizzasSold:Number(s.pizzas_sold||0),pizzasRequested:Number(s.pizzas_requested||0),
      foodSalesCents:Number(s.food_sales_cents||0),shippingSalesCents:Number(s.shipping_sales_cents||0),
      grossSalesCents:salesCents,paymentsRecordedCents:Number(s.payments_recorded_cents||0),
      canceledPaymentsCents:Number(s.canceled_payments_cents||0)},
    expenses:{bookedCents,paidCents:Number(e.paid_expenses_cents||0),count:Number(e.expense_entries||0),rows},
    goal:goal?{month,revenueTargetCents:goal.revenue_target_cents,
      profitTargetCents:goal.profit_target_cents,pizzaTarget:goal.pizza_target,
      operatingWeekdays:JSON.parse(goal.operating_weekdays)}:null,
    partialBalanceCents,
    warnings:[
      'Saldo parcial = vendas de pedidos confirmados − despesas lançadas. Não é lucro líquido nem fluxo de caixa.',
      'Valores recebidos são registros cumulativos nos pedidos, não lançamentos bancários conciliados.',
      'Pagamentos vinculados a pedidos cancelados requerem conferência manual; não representam receita consolidada.',
      'Custos de ingredientes, impostos, taxas, estornos e datas dos recebimentos ainda exigem conciliação.'
    ]});
}
function nextMonth(month){const [y,m]=month.split('-').map(Number);return (m===12?y+1:y)+'-'+String(m===12?1:m+1).padStart(2,'0');}
async function postExpense(request,env){
  let x;try{x=await jsonBody(request);}catch(e){return fail('validation',e.message,422);}
  if(!dateOK(x.date))return fail('date','Informe a data da despesa no formato AAAA-MM-DD.',422);
  if(!categoryNames.has(x.category))return fail('category','Categoria de despesa inválida.',422);
  if(!str(x.description,2,160))return fail('description','Descrição deve ter entre 2 e 160 caracteres.',422);
  if(!isCents(x.amountCents))return fail('amount','Informe um valor positivo em centavos.',422);
  if(x.paidDate!==null&&x.paidDate!==undefined&&!dateOK(x.paidDate))
    return fail('paid_date','Data de pagamento inválida.',422);
  try{
    const id=crypto.randomUUID();
    await env.DOPPIO_DB.prepare('INSERT INTO doppio_management_expenses(id,expense_date,category,description,amount_cents,paid_at) VALUES (?,?,?,?,?,?)')
      .bind(id,x.date,x.category,x.description.trim(),x.amountCents,x.paidDate?dayStamp(x.paidDate):null).run();
    return send({ok:true,id},201);
  }catch(_){return fail('database','Não foi possível cadastrar a despesa.',503);}
}
async function putGoal(request,env){
  let x;try{x=await jsonBody(request);}catch(e){return fail('validation',e.message,422);}
  if(!monthOK(x.month))return fail('month','Informe mês válido no formato AAAA-MM.',422);
  if(!isCents(x.revenueTargetCents,true)||!isCents(x.profitTargetCents,true)||!isCount(x.pizzaTarget))
    return fail('goal','Metas precisam ser valores não negativos.',422);
  // Dias operacionais permitidos. Sexta, sábado, domingo por padrão.
  const days=[5,6,0];
  try{
    await env.DOPPIO_DB.prepare("INSERT INTO doppio_management_goals (month,revenue_target_cents,profit_target_cents,pizza_target,operating_weekdays) VALUES (?,?,?,?,?) "+
      "ON CONFLICT(month) DO UPDATE SET revenue_target_cents=excluded.revenue_target_cents,profit_target_cents=excluded.profit_target_cents,pizza_target=excluded.pizza_target,operating_weekdays=excluded.operating_weekdays")
      .bind(x.month,x.revenueTargetCents,x.profitTargetCents,x.pizzaTarget,JSON.stringify(days)).run();
    return send({ok:true,month:x.month});
  }catch(_){return fail('database','Não foi possível salvar metas.',503);}
}
export async function managementApi(request,env,url){
  if(!['GET','POST','PUT'].includes(request.method))return fail('method','Método não permitido.',405);
  try{await ensureManagementDb(env);}
  catch(_){return fail('migration','Não foi possível preparar a gestão. Pedidos existentes não foram modificados.',503);}
  const p=url.pathname;
  if(p==='/api/admin/management/summary'&&request.method==='GET'){
    let month;try{month=monthFromRequest(url);}catch(e){return fail('month',e.message,422);}
    try{return await getSummary(env,month);}catch(_){return fail('database','Não foi possível gerar o resumo gerencial.',503);}
  }
  if(p==='/api/admin/management/expenses'&&request.method==='POST')return postExpense(request,env);
  if(p==='/api/admin/management/goals'&&request.method==='PUT')return putGoal(request,env);
  return fail('not_found','Recurso de gestão não encontrado.',404);
}
