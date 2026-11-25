/* Gestão empresarial da Doppio — módulo experimental, sem dados de clientes. */
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const brl=c=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(c||0)/100);
const num=v=>new Intl.NumberFormat('pt-BR',{maximumFractionDigits:0}).format(Number(v||0));
const getBrazilDate=()=>{
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const pick=t=>parts.find(p=>p.type===t)?.value||'';
  return [pick('year'),pick('month'),pick('day')].join('-');
};
const parseMoney=s=>{
  const raw=String(s||'').trim().replace(/^R\$\s*/i,'');
  const normalized=raw.includes(',')?raw.replace(/\./g,'').replace(',','.'):raw;
  if(!/^\d{1,9}(?:\.\d{1,2})?$/.test(normalized))return null;
  const n=Number(normalized);
  return Number.isFinite(n)&&n<=1000000?Math.round(n*100):null;
};
const moneyInput=c=>(Number(c||0)/100).toFixed(2).replace('.',',');
let loadedMonth=null,loading=false,store=null;
function status(message,error=false){
  const el=$('management-status');
  el.textContent=message;
  el.classList.toggle('stock-error',error);
}
async function endpoint(path,options={}){
  const response=await fetch('/api/admin/management'+path,{
    credentials:'same-origin',cache:'no-store',...options,
    headers:{...(options.body?{'content-type':'application/json'}:{}),...(options.headers||{})}
  });
  let out;try{out=await response.json();}catch(_){throw Error('O servidor retornou uma resposta inválida.');}
  if(!response.ok||!out.ok)throw Error(out.message||'Não foi possível carregar a gestão financeira.');
  return out;
}
function metrics(data){
  const s=data.sales,e=data.expenses;
  const cards=[
    ['Pedidos confirmados',num(s.confirmedOrders),'Pedindo preparo, entrega ou concluídos'],
    ['Pizzas vendidas',num(s.pizzasSold),'Quantidade total, não número de pedidos'],
    ['Vendas estimadas',brl(s.grossSalesCents),'Pizzas + frete da loja, quando aplicável'],
    ['Despesas cadastradas',brl(e.bookedCents),'Inclui despesas ainda não pagas'],
    ['Recebimentos informados',brl(s.paymentsRecordedCents),'Não equivale a caixa conciliado'],
    ['Saldo parcial',brl(data.partialBalanceCents),'Não representa lucro líquido']
  ];
  $('management-metrics').innerHTML=cards.map(([label,value,sub])=>
    '<article class="mgmt-metric"><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong><small>'+esc(sub)+'</small></article>').join('');
  $('management-orders').innerHTML=
    '<span><b>'+num(s.ordersTotal)+'</b> pedidos solicitados</span>'+
    '<span><b>'+num(s.pendingOrders)+'</b> aguardando</span>'+
    '<span><b>'+num(s.canceledOrders)+'</b> cancelados</span>'+
    '<span><b>'+brl(s.foodSalesCents)+'</b> vendas de pizzas</span>'+
    '<span><b>'+brl(s.shippingSalesCents)+'</b> frete da pizzaria</span>';
  const warning=$('management-alert');
  warning.hidden=!s.canceledPaymentsCents;
  if(s.canceledPaymentsCents)warning.textContent=
    'Atenção: '+brl(s.canceledPaymentsCents)+' de pagamentos anotados estão vinculados a pedidos cancelados. Confira reembolsos e recebimentos antes de fechar o caixa.';
  const g=data.goal||{};
  $('management-goal-form').elements.revenue.value=moneyInput(g.revenueTargetCents);
  $('management-goal-form').elements.profit.value=moneyInput(g.profitTargetCents);
  $('management-goal-form').elements.pizzas.value=String(g.pizzaTarget||0);
  $('management-goal-progress').textContent=
    (g.revenueTargetCents?('Meta de vendas: '+Math.round(s.grossSalesCents/g.revenueTargetCents*100)+'% · '):'Meta de vendas não definida · ')+
    (g.pizzaTarget?('Meta de pizzas: '+Math.round(s.pizzasSold/g.pizzaTarget*100)+'%'):'Meta de pizzas não definida');
  $('management-expenses').innerHTML=data.expenses.rows.length
    ?data.expenses.rows.map(e=>'<tr><td>'+esc(e.date.split('-').reverse().join('/'))+'</td>'+
      '<td>'+esc({ingredientes:'Ingredientes',embalagens:'Embalagens',energia:'Energia',gas:'Gás',frete:'Transporte',marketing:'Marketing',manutencao:'Manutenção',aluguel:'Aluguel',taxas:'Taxas',outros:'Outros'}[e.category]||e.category)+'</td>'+
      '<td>'+esc(e.description)+'</td><td>'+brl(e.amountCents)+'</td>'+
      '<td>'+(e.paidAt?'Pago (informado)':'Não informado')+'</td></tr>').join('')
    :'<tr><td colspan="5" class="stock-empty">Nenhuma despesa lançada para este mês.</td></tr>';
}
async function load(force=false){
  const month=$('management-month')?.value;
  if(!month||loading||(!force&&month===loadedMonth&&store))return;
  loading=true;
  status('Carregando informações do mês…');
  try{
    const data=await endpoint('/summary?month='+encodeURIComponent(month));
    store=data;loadedMonth=month;
    metrics(data);$('management-content').hidden=false;
    status('Dados de gestão carregados. Vendas e recebimentos são indicadores preliminares até a conciliação financeira.');
  }catch(e){
    $('management-content').hidden=true;loadedMonth=null;store=null;
    status(e.message,true);
  }finally{loading=false;}
}
$('management-month').value=getBrazilDate().slice(0,7);
$('management-expense-date').value=getBrazilDate();
$('management-month').addEventListener('change',()=>load(true));
$('management-refresh').addEventListener('click',()=>load(true));
$('management-expense-form').addEventListener('submit',async event=>{
  event.preventDefault();
  const form=event.currentTarget,d=new FormData(form);
  const cents=parseMoney(d.get('amount'));
  if(cents===null||cents<=0)return status('Informe o valor da despesa em reais, por exemplo 35,90.',true);
  try{
    await endpoint('/expenses',{method:'POST',body:JSON.stringify({
      date:String(d.get('date')||''),category:String(d.get('category')||''),
      description:String(d.get('description')||''),amountCents:cents,paidDate:d.get('paidDate')||null
    })});
    form.elements.description.value='';form.elements.amount.value='';form.elements.paidDate.value='';
    await load(true);status('Despesa cadastrada. Nenhum pedido foi alterado.');
  }catch(e){status(e.message,true);}
});
$('management-goal-form').addEventListener('submit',async event=>{
  event.preventDefault();
  const d=new FormData(event.currentTarget);
  const revenue=parseMoney(d.get('revenue')),profit=parseMoney(d.get('profit'));
  const pizzas=Number(d.get('pizzas'));
  if(revenue===null||profit===null||!Number.isInteger(pizzas)||pizzas<0)
    return status('Confira valores e quantidade das metas.',true);
  try{
    await endpoint('/goals',{method:'PUT',body:JSON.stringify({
      month:$('management-month').value,revenueTargetCents:revenue,
      profitTargetCents:profit,pizzaTarget:pizzas
    })});
    await load(true);status('Metas salvas. A meta de lucro exige conciliação dos custos antes de ser avaliada.');
  }catch(e){status(e.message,true);}
});
window.addEventListener('doppio:management:visible',()=>{void load();});
window.addEventListener('doppio:admin-ready',()=>{
  if($('admin-dashboard')?.dataset.view==='management')void load();
});
if($('admin-dashboard')?.dataset.view==='management'&&!$('admin-dashboard').hidden)void load();
})();
