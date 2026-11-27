/* Gestão empresarial Doppio — despesas rápidas com edições auditáveis. */
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const brl=c=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(c||0)/100);
const num=v=>new Intl.NumberFormat('pt-BR',{maximumFractionDigits:0}).format(Number(v||0));
const categoryNames={ingredientes:'Ingredientes',embalagens:'Embalagens',gas:'Gás',energia:'Energia',frete:'Entrega',marketing:'Publicidade',manutencao:'Manutenção',aluguel:'Aluguel',taxas:'Taxas',outros:'Outros'};
const categoryIcons={ingredientes:'🥬',embalagens:'📦',gas:'🔥',energia:'💡',frete:'🛵',marketing:'📣',manutencao:'🔧',aluguel:'🏠',taxas:'💳',outros:'🧾'};
const formatDay=s=>String(s||'').split('-').reverse().join('/');
const getBrazilDate=()=>{
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const find=t=>parts.find(p=>p.type===t)?.value||'';
  return [find('year'),find('month'),find('day')].join('-');
};
const parseMoney=s=>{
  const raw=String(s||'').trim().replace(/^R\$\s*/i,'');
  const normalized=raw.includes(',')?raw.replace(/\./g,'').replace(',','.'):raw;
  if(!/^\d{1,9}(?:\.\d{1,2})?$/.test(normalized))return null;
  const amount=Number(normalized);
  return Number.isFinite(amount)&&amount<=1000000?Math.round(amount*100):null;
};
const moneyInput=c=>(Number(c||0)/100).toFixed(2).replace('.',',');
const paymentDay=timestamp=>timestamp?new Date(Number(timestamp)*1000).toISOString().slice(0,10):'';
let loadedMonth=null,loading=false,store=null,editing=null,busy=false,pendingArchiveId=null;
function status(message,error=false){
  const el=$('management-status');
  el.textContent=message;
  el.classList.toggle('stock-error',error);
}
async function endpoint(path,options={}){
  const res=await fetch('/api/admin/management'+path,{
    credentials:'same-origin',cache:'no-store',...options,
    headers:{...(options.body?{'content-type':'application/json'}:{}),...(options.headers||{})}
  });
  let data;try{data=await res.json();}catch(_){throw Error('O servidor retornou uma resposta inválida.');}
  if(!res.ok||!data.ok)throw Error(data.message||'Não foi possível concluir a operação.');
  return data;
}
function categoryChips(){
  const chosen=$('management-expense-form').elements.category.value;
  document.querySelectorAll('#management-category-quick [data-category]').forEach(button=>{
    const active=button.dataset.category===chosen;
    button.classList.toggle('active',active);
    button.setAttribute('aria-pressed',String(active));
  });
}
function paymentDetails(){
  $('management-payment-details').hidden=$('management-expense-payment').value==='pending';
}
function resetExpenseForm(){
  const form=$('management-expense-form');
  form.reset();
  form.elements.date.value=getBrazilDate();
  form.elements.paymentStatus.value='paid';
  form.elements.category.value='ingredientes';
  form.elements.paidDate.value='';
  $('management-payment-details').open=false;
  $('management-expense-form-title').textContent='+ Nova despesa';
  $('management-expense-form-help').textContent='Ex.: comprei R$ 35,90 de queijo hoje.';
  $('management-expense-submit').textContent='+ Adicionar despesa';
  $('management-expense-cancel').hidden=true;
  editing=null;paymentDetails();categoryChips();
}
function matchesExpense(row,search){
  const normalize=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  return normalize(row.description+' '+(categoryNames[row.category]||row.category)).includes(normalize(search.trim()));
}
function renderExpenses(){
  if(!store)return;
  const d=store.expenses,rows=Array.isArray(d.rows)?d.rows:[];
  $('management-expense-summary').innerHTML=
    '<div><small>Total no mês</small><strong>'+brl(d.bookedCents)+'</strong></div>'+
    '<div><small>Já paguei</small><strong>'+brl(d.paidCents)+'</strong></div>'+
    '<div><small>A pagar</small><strong>'+brl(Math.max(0,d.bookedCents-d.paidCents))+'</strong></div>';
  const search=$('management-expense-search').value;
  const filter=$('management-expense-filter').value;
  const filtered=rows.filter(item=>matchesExpense(item,search)&&(
    filter==='all'||(filter==='paid'?item.paidAt!=null:item.paidAt==null)));
  $('management-expense-count').textContent=filtered.length+' de '+d.count+' despesas'+(d.count>200?' (até 200 mais recentes)':'');
  $('management-expenses').innerHTML=filtered.length?filtered.map(item=>{
    const paid=item.paidAt!=null;
    const confirm=pendingArchiveId===item.id;
    return '<article class="mgmt-expense-item" data-expense-id="'+esc(item.id)+'">'+
      '<div class="mgmt-expense-icon" aria-hidden="true">'+(categoryIcons[item.category]||'🧾')+'</div>'+
      '<div class="mgmt-expense-info"><strong>'+esc(item.description)+'</strong>'+
        '<small>'+esc(categoryNames[item.category]||item.category)+' · '+esc(formatDay(item.date))+'</small>'+
        '<span class="mgmt-pay-tag '+(paid?'paid':'pending')+'">'+(paid?'✓ Pago (informado)':'◷ A pagar')+'</span></div>'+
      '<div class="mgmt-expense-right"><strong>'+brl(item.amountCents)+'</strong>'+
       '<div class="mgmt-expense-actions">'+
        '<button type="button" data-expense-action="edit" data-id="'+esc(item.id)+'">Editar</button>'+
        '<button type="button" class="mgmt-danger" data-expense-action="archive" data-id="'+esc(item.id)+'">Excluir</button>'+
       '</div></div>'+
      (confirm?'<div class="mgmt-expense-confirm"><span>Excluir <b>'+esc(item.description)+'</b>? Ele sai dos totais, mas fica no histórico.</span>'+
        '<button type="button" data-expense-action="confirm" data-id="'+esc(item.id)+'">Sim, excluir</button>'+
        '<button type="button" data-expense-action="cancel" data-id="'+esc(item.id)+'">Cancelar</button></div>':'')+
      '</article>';
  }).join(''):'<p class="mgmt-expense-empty">'+(rows.length?'Nenhuma despesa corresponde à busca.':'Nenhuma despesa neste mês. Cadastre a primeira acima!')+'</p>';
}
function renderMetrics(data){
  const s=data.sales,e=data.expenses;
  const cards=[
    ['Pedidos confirmados',num(s.confirmedOrders),'Pedidos em preparo, entrega ou concluídos'],
    ['Pizzas vendidas',num(s.pizzasSold),'Quantidade total, não pedidos'],
    ['Vendas estimadas',brl(s.grossSalesCents),'Pizzas + frete da loja, se houver'],
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
  renderExpenses();
}
async function load(force=false){
  const month=$('management-month')?.value;
  if(!month||loading||(!force&&month===loadedMonth&&store))return;
  loading=true;status('Carregando informações do mês…');
  try{
    const data=await endpoint('/summary?month='+encodeURIComponent(month));
    store=data;loadedMonth=month;pendingArchiveId=null;
    renderMetrics(data);
    $('management-content').hidden=false;
    status('Despesas carregadas. Vendas e recebimentos ainda são indicadores preliminares.');
  }catch(e){
    $('management-content').hidden=true;loadedMonth=null;store=null;status(e.message,true);
  }finally{loading=false;}
}
function editExpense(id){
  const item=store?.expenses?.rows?.find(x=>x.id===id);
  if(!item)return status('Atualize os lançamentos para editar esta despesa.',true);
  const form=$('management-expense-form');
  editing={id:item.id,revision:item.revision};
  pendingArchiveId=null;
  form.elements.description.value=item.description;
  form.elements.amount.value=moneyInput(item.amountCents);
  form.elements.category.value=item.category;
  form.elements.date.value=item.date;
  const paid=item.paidAt!=null;
  form.elements.paymentStatus.value=paid?'paid':'pending';
  const paidOn=paymentDay(item.paidAt);
  form.elements.paidDate.value=paid&&paidOn!==item.date?paidOn:'';
  $('management-payment-details').open=paid&&paidOn!==item.date;
  $('management-expense-form-title').textContent='✎ Corrigir despesa';
  $('management-expense-form-help').textContent='Ajuste os dados e salve. O histórico de alterações será mantido.';
  $('management-expense-submit').textContent='Salvar alteração';
  $('management-expense-cancel').hidden=false;
  categoryChips();paymentDetails();renderExpenses();
  form.scrollIntoView({behavior:'smooth',block:'center'});
  form.elements.description.focus({preventScroll:true});
}
$('management-month').value=getBrazilDate().slice(0,7);
resetExpenseForm();
$('management-month').addEventListener('change',()=>{
  if(!editing){
    const month=$('management-month').value;
    $('management-expense-date').value=month===getBrazilDate().slice(0,7)?getBrazilDate():month+'-01';
  }
  pendingArchiveId=null;void load(true);
});
$('management-refresh').addEventListener('click',()=>load(true));
$('management-expense-form').elements.category.addEventListener('change',categoryChips);
$('management-expense-payment').addEventListener('change',paymentDetails);
document.querySelectorAll('#management-category-quick [data-category]').forEach(button=>
  button.addEventListener('click',()=>{
    $('management-expense-form').elements.category.value=button.dataset.category;
    categoryChips();
  }));
$('management-expense-search').addEventListener('input',renderExpenses);
$('management-expense-filter').addEventListener('change',renderExpenses);
$('management-expense-cancel').addEventListener('click',()=>{
  resetExpenseForm();status('Edição cancelada. A despesa não foi alterada.');
});
$('management-expenses').addEventListener('click',async event=>{
  const button=event.target.closest('[data-expense-action]');
  if(!button||busy)return;
  const id=button.dataset.id,action=button.dataset.expenseAction;
  if(action==='edit')return editExpense(id);
  if(action==='archive'){pendingArchiveId=id;renderExpenses();return;}
  if(action==='cancel'){pendingArchiveId=null;renderExpenses();return;}
  if(action!=='confirm')return;
  const row=store?.expenses?.rows?.find(x=>x.id===id);
  if(!row)return status('Atualize o mês. Este lançamento não aparece mais na lista.',true);
  busy=true;button.disabled=true;
  try{
    await endpoint('/expenses/'+encodeURIComponent(row.id),{
      method:'DELETE',body:JSON.stringify({expectedRevision:row.revision})
    });
    if(editing?.id===id)resetExpenseForm();
    pendingArchiveId=null;
    await load(true);
    status('Despesa excluída dos totais. O histórico foi preservado.');
  }catch(e){status(e.message,true);button.disabled=false;}
  finally{busy=false;}
});
$('management-expense-form').addEventListener('submit',async event=>{
  event.preventDefault();
  if(busy)return;
  const form=event.currentTarget,d=new FormData(form);
  const cents=parseMoney(d.get('amount'));
  if(cents===null||cents<=0)return status('Informe o valor da despesa em reais, como 35,90.',true);
  const date=String(d.get('date')||'');
  const payload={
    date,category:String(d.get('category')||''),description:String(d.get('description')||''),
    amountCents:cents,paidDate:d.get('paymentStatus')==='paid'?(String(d.get('paidDate')||'')||date):null
  };
  const currentEdit=editing?{...editing}:null;
  busy=true;$('management-expense-submit').disabled=true;
  try{
    if(currentEdit){
      await endpoint('/expenses/'+encodeURIComponent(currentEdit.id),{
        method:'PUT',body:JSON.stringify({...payload,expectedRevision:currentEdit.revision})
      });
    }else await endpoint('/expenses',{method:'POST',body:JSON.stringify(payload)});
    const message=currentEdit?'Despesa corrigida com sucesso.':'Despesa registrada com sucesso!';
    resetExpenseForm();
    if(date.slice(0,7)!==$('management-month').value)$('management-month').value=date.slice(0,7);
    await load(true);
    status(message);
  }catch(e){status(e.message,true);}
  finally{busy=false;$('management-expense-submit').disabled=false;}
});
$('management-goal-form').addEventListener('submit',async event=>{
  event.preventDefault();
  const d=new FormData(event.currentTarget);
  const revenue=parseMoney(d.get('revenue')),profit=parseMoney(d.get('profit'));
  const pizzas=Number(d.get('pizzas'));
  if(revenue===null||profit===null||!Number.isInteger(pizzas)||pizzas<0)
    return status('Confira os valores e a quantidade das metas.',true);
  try{
    await endpoint('/goals',{method:'PUT',body:JSON.stringify({
      month:$('management-month').value,revenueTargetCents:revenue,
      profitTargetCents:profit,pizzaTarget:pizzas
    })});
    await load(true);status('Metas salvas. A meta de lucro exige conciliação dos custos.');
  }catch(e){status(e.message,true);}
});
window.addEventListener('doppio:management:visible',()=>{void load();});
window.addEventListener('doppio:receipt:imported',()=>{void load(true);});
window.addEventListener('doppio:admin-ready',()=>{
  if($('admin-dashboard')?.dataset.view==='management')void load();
});
if($('admin-dashboard')?.dataset.view==='management'&&!$('admin-dashboard').hidden)void load();
})();
