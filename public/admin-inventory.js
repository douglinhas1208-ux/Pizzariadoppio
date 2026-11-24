/* Doppio Admin: estoque e ficha técnica. Sessão fornecida pelo painel já autenticado. */
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const brl=c=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(c||0)/100);
const unitMoney=c=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL',minimumFractionDigits:2,maximumFractionDigits:4}).format(c/100);
const qty=q=>new Intl.NumberFormat('pt-BR',{maximumFractionDigits:3}).format(Number(q||0));
const when=t=>new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'}).format(new Date(t*1000));
const cost=i=>i.packQty>0?i.packPriceCents/i.packQty:0;
let data=null,loading=false,editingProduct='',draft=[];
function note(message,bad=false){
  const el=$('stock-message');el.textContent=message;el.classList.toggle('stock-error',bad);
}
function parsePrice(x){
  const str=String(x||'').trim().replace(/^R\$\s*/i,'');
  const standard=str.includes(',')?str.replace(/\./g,'').replace(',','.'):str;
  if(!/^\d{1,9}(?:\.\d{1,2})?$/.test(standard))return null;
  const n=Number(standard);
  return Number.isFinite(n)&&n<=1000000?Math.round(n*100):null;
}
const fnum=(f,key)=>{const v=Number(f.get(key));return Number.isFinite(v)?v:NaN;};
async function api(route='',options={}){
  const headers={'content-type':'application/json'};
  const response=await fetch('/api/admin/inventory'+route,{credentials:'same-origin',cache:'no-store',
    headers,...options});
  let result;try{result=await response.json();}catch(_){throw Error('Resposta inválida do servidor.');}
  if(!response.ok||!result.ok)throw Error(result.message||'Não foi possível salvar o estoque.');
  return result;
}
async function load(showMessage=true){
  if(loading)return;
  loading=true;
  if(showMessage)note('Consultando estoque e preços…');
  try{
    const result=await api();
    data=result;
    $('stock-content').hidden=false;
    render();
    note('Estoque atualizado. As alterações são salvas diretamente no banco D1.');
  }catch(e){
    note(e.message,true);
    if(e.message.includes('novamente')||e.message.includes('Entre'))$('stock-content').hidden=true;
  }finally{loading=false;}
}
function render(){
  const items=data.items||[],active=items.filter(i=>i.active),low=active.filter(i=>i.quantity<=i.minimumQty);
  $('stock-count').textContent=String(active.length);
  $('stock-low').textContent=String(low.length);
  $('stock-value').textContent=brl(items.filter(i=>i.active).reduce((sum,i)=>sum+i.quantity*cost(i),0));
  $('stock-items').innerHTML=items.length?items.map(i=>{
    const danger=i.active&&i.quantity<=i.minimumQty;
    return '<tr class="'+(danger?'stock-low-row':'')+'">'
      +'<td><strong>'+esc(i.name)+'</strong><small>'+esc(i.unit)+(i.active?'':' · Arquivado')+'</small></td>'
      +'<td><b>'+qty(i.quantity)+' '+esc(i.unit)+'</b>'+(danger?'<span class="stock-low-tag">Baixo</span>':'')+'</td>'
      +'<td>'+qty(i.minimumQty)+' '+esc(i.unit)+'</td>'
      +'<td>'+brl(i.packPriceCents)+' <small>/ '+qty(i.packQty)+' '+esc(i.unit)+'</small></td>'
      +'<td>'+unitMoney(cost(i))+' <small>/ '+esc(i.unit)+'</small></td>'
      +'<td>'+brl(i.quantity*cost(i))+'</td>'
      +'<td><div class="stock-table-actions"><button type="button" data-stock-edit="'+esc(i.id)+'">Editar</button>'
      +(i.active?'<button type="button" data-stock-move="'+esc(i.id)+'">Movimentar</button>':'')
      +'</div></td></tr>';
  }).join(''):'<tr><td colspan="7" class="stock-empty">Nenhum ingrediente ainda. Cadastre seus insumos com os preços de compra acima.</td></tr>';
  const previous=$('stock-movement-item').value;
  $('stock-movement-item').innerHTML=active.length
    ?'<option value="">Selecione um insumo</option>'+active.map(i=>'<option value="'+esc(i.id)+'">'+esc(i.name)+' ('+esc(i.unit)+')</option>').join('')
    :'<option value="">Cadastre um insumo antes</option>';
  if(active.some(i=>i.id===previous))$('stock-movement-item').value=previous;
  const movements=(data.movements||[]).slice(0,40);
  const names={entrada:'Entrada',consumo:'Consumo',perda:'Perda',ajuste_mais:'Ajuste +',ajuste_menos:'Ajuste −'};
  $('stock-history').innerHTML=movements.length?movements.map(m=>'<tr>'
    +'<td>'+when(m.createdAt)+'</td><td>'+esc(m.ingredientName)+'</td><td>'+esc(names[m.kind]||m.kind)+'</td>'
    +'<td class="'+(m.deltaQty<0?'stock-negative':'stock-positive')+'">'+(m.deltaQty>0?'+':'')+qty(m.deltaQty)+' '+esc(m.unit)+'</td>'
    +'<td>'+esc(m.notes||'—')+'</td></tr>').join('')
    :'<tr><td colspan="5" class="stock-empty">Nenhuma movimentação registrada.</td></tr>';
  const psel=$('stock-recipe-product');
  const chosen=editingProduct||psel.value||(data.products||[]).find(p=>p.available)?.id||data.products?.[0]?.id||'';
  psel.innerHTML=(data.products||[]).map(p=>'<option value="'+esc(p.id)+'">'+esc(p.name)+(p.available?'':' (indisponível)')+'</option>').join('');
  if(data.products.some(p=>p.id===chosen))psel.value=chosen;
  editingProduct=psel.value;
  resetRecipe();
}
function resetRecipe(){
  draft=(data.recipes||[]).filter(r=>r.productId===editingProduct).map(r=>({...r}));
  renderRecipeLines();
}
function renderRecipeLines(){
  const active=data?.items?.filter(i=>i.active)||[];
  if(!draft.length)$('stock-recipe-lines').innerHTML='<p class="stock-empty">Nenhum ingrediente nesta ficha. Clique em “Adicionar ingrediente”.</p>';
  else $('stock-recipe-lines').innerHTML=draft.map((r,index)=>{
    const selected=data.items?.find(i=>i.id===r.ingredientId);
    const options=active.concat(selected&&!selected.active?[selected]:[])
      .filter((i,j,a)=>a.findIndex(k=>k.id===i.id)===j);
    return '<div class="stock-recipe-row" data-recipe-row="'+index+'">'
      +'<label>Ingrediente<select data-recipe-ingredient aria-label="Ingrediente da ficha técnica">'
      +'<option value="">Selecione</option>'
      +options.map(i=>'<option value="'+esc(i.id)+'"'+(r.ingredientId===i.id?' selected':'')+'>'+esc(i.name)+' ('+esc(i.unit)+')</option>').join('')
      +'</select></label>'
      +'<label>Qtd. por pizza <input data-recipe-quantity type="number" step="0.001" min="0.001" max="1000000" value="'+esc(r.quantity)+'"></label>'
      +'<button type="button" data-recipe-remove="'+index+'" class="admin-button admin-button-muted" aria-label="Remover ingrediente">Remover</button>'
      +'</div>';
  }).join('');
  totals();
}
function syncDraft(){
  draft=[...document.querySelectorAll('[data-recipe-row]')].map(el=>({
    productId:editingProduct,ingredientId:el.querySelector('[data-recipe-ingredient]').value,
    quantity:Number(el.querySelector('[data-recipe-quantity]').value)
  }));
}
function totals(){
  if(!data)return;
  const product=data.products.find(p=>p.id===editingProduct);
  let total=0;
  for(const r of draft){
    const i=data.items.find(i=>i.id===r.ingredientId);
    if(i&&Number.isFinite(r.quantity)&&r.quantity>=0)total+=r.quantity*cost(i);
  }
  $('stock-recipe-cost').textContent=brl(total);
  const sale=Number.isFinite(product?.price)?product.price*100:null;
  $('stock-recipe-sale').textContent=sale===null?'Preço pendente':brl(sale);
  $('stock-recipe-margin').textContent=sale===null?'—':brl(sale-total)+' · '+(sale>0?new Intl.NumberFormat('pt-BR',{maximumFractionDigits:1}).format((sale-total)/sale*100):'0')+'%';
  $('stock-recipe-margin').classList.toggle('stock-negative',sale!==null&&sale<total);
}
$('stock-refresh').addEventListener('click',()=>load());
$('stock-new-form').addEventListener('submit',async event=>{
  event.preventDefault();
  const form=event.currentTarget,f=new FormData(form),price=parsePrice(f.get('packPrice'));
  if(price===null)return note('Preço inválido. Use por exemplo 35,90.',true);
  try{
    await api('/items',{method:'POST',body:JSON.stringify({
      name:String(f.get('name')||''),unit:String(f.get('unit')),packQty:fnum(f,'packQty'),packPriceCents:price,
      openingQty:fnum(f,'openingQty'),minimumQty:fnum(f,'minimumQty')
    })});
    form.reset();await load(false);note('Ingrediente cadastrado com sucesso.');
  }catch(e){note(e.message,true);}
});
$('stock-items').addEventListener('click',event=>{
  const edit=event.target.closest('[data-stock-edit]'),movement=event.target.closest('[data-stock-move]');
  if(edit){
    const i=data.items.find(x=>x.id===edit.dataset.stockEdit);if(!i)return;
    const form=$('stock-edit-form');
    form.elements.id.value=i.id;form.elements.name.value=i.name;
    form.elements.packQty.value=i.packQty;
    form.elements.packPrice.value=(i.packPriceCents/100).toFixed(2).replace('.',',');
    form.elements.minimumQty.value=i.minimumQty;form.elements.active.checked=i.active;
    $('stock-edit-title').textContent='Editar '+i.name+' · '+i.unit;
    form.hidden=false;form.scrollIntoView({behavior:'smooth',block:'nearest'});
  }
  if(movement){
    $('stock-movement-item').value=movement.dataset.stockMove;
    $('stock-movement-form').scrollIntoView({behavior:'smooth',block:'center'});
    $('stock-movement-form').elements.quantity.focus();
  }
});
$('stock-edit-cancel').addEventListener('click',()=>{$('stock-edit-form').hidden=true;});
$('stock-edit-form').addEventListener('submit',async event=>{
  event.preventDefault();
  const form=event.currentTarget,f=new FormData(form),price=parsePrice(f.get('packPrice'));
  if(price===null)return note('Preço inválido. Use por exemplo 35,90.',true);
  try{
    await api('/items/'+encodeURIComponent(f.get('id')),{method:'PUT',body:JSON.stringify({
      name:String(f.get('name')),packQty:fnum(f,'packQty'),packPriceCents:price,
      minimumQty:fnum(f,'minimumQty'),active:form.elements.active.checked
    })});
    form.hidden=true;await load(false);note('Ingrediente e preço atualizados.');
  }catch(e){note(e.message,true);}
});
$('stock-movement-form').addEventListener('submit',async event=>{
  event.preventDefault();
  const form=event.currentTarget,f=new FormData(form);
  try{
    await api('/movements',{method:'POST',body:JSON.stringify({
      ingredientId:f.get('ingredientId'),kind:f.get('kind'),quantity:fnum(f,'quantity'),notes:String(f.get('notes')||'')
    })});
    form.elements.quantity.value='';form.elements.notes.value='';
    await load(false);note('Movimentação registrada. O saldo e o histórico foram atualizados.');
  }catch(e){note(e.message,true);}
});
$('stock-recipe-product').addEventListener('change',event=>{
  editingProduct=event.target.value;resetRecipe();
});
$('stock-recipe-add').addEventListener('click',()=>{
  if(!data?.items.some(i=>i.active))return note('Cadastre pelo menos um insumo antes de montar a ficha técnica.',true);
  syncDraft();draft.push({productId:editingProduct,ingredientId:'',quantity:0});
  renderRecipeLines();
});
$('stock-recipe-lines').addEventListener('input',()=>{syncDraft();totals();});
$('stock-recipe-lines').addEventListener('change',()=>{syncDraft();totals();});
$('stock-recipe-lines').addEventListener('click',event=>{
  const remove=event.target.closest('[data-recipe-remove]');if(!remove)return;
  syncDraft();draft.splice(Number(remove.dataset.recipeRemove),1);renderRecipeLines();
});
$('stock-recipe-save').addEventListener('click',async()=>{
  if(!editingProduct)return note('Escolha uma pizza para configurar a ficha.',true);
  syncDraft();
  const unique=new Set();
  for(const r of draft){
    if(!r.ingredientId||!Number.isFinite(r.quantity)||r.quantity<=0)return note('Selecione todos os ingredientes e informe quantidade maior que zero.',true);
    if(unique.has(r.ingredientId))return note('O mesmo ingrediente foi adicionado duas vezes à ficha.',true);
    unique.add(r.ingredientId);
  }
  try{
    await api('/recipes/'+encodeURIComponent(editingProduct),{method:'PUT',
      body:JSON.stringify({lines:draft.map(r=>({ingredientId:r.ingredientId,quantity:r.quantity}))})});
    await load(false);note('Ficha técnica salva. Custo e margem recalculados.');
  }catch(e){note(e.message,true);}
});
$('stock-export').addEventListener('click',()=>{
  if(!data)return note('Carregue o estoque antes de exportar.',true);
  const quotes=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
  const lines=[['Ingrediente','Unidade','Saldo','Estoque mínimo','Quantidade por embalagem','Preço embalagem (R$)','Custo por unidade (R$)','Valor estimado estoque (R$)','Ativo'].join(';')];
  for(const i of data.items){
    lines.push([i.name,i.unit,i.quantity,i.minimumQty,i.packQty,(i.packPriceCents/100).toFixed(2),
      (cost(i)/100).toFixed(4),(i.quantity*cost(i)/100).toFixed(2),i.active?'Sim':'Não']
      .map(quotes).join(';'));
  }
  const csv='\ufeff'+lines.join('\r\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}),link=document.createElement('a');
  const href=URL.createObjectURL(blob);link.href=href;link.download='doppio-estoque-'+new Date().toISOString().slice(0,10)+'.csv';
  document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(href),3000);
});
window.addEventListener('doppio:admin-ready',()=>{void load();});
})();
