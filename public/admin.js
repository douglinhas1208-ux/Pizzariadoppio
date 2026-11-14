(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const money=value=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(value);
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const photos=[
    {path:'assets/frango-real.avif',name:'Frango com Catupiry'},
    {path:'assets/brocolis.webp',name:'Brócolis com Bacon'},
    {path:'assets/calabresa-real.avif',name:'Calabresa'},
    {path:'assets/mussarela.webp',name:'Mussarela'}
  ];
  let state=null,dirty=false,busy=false,toastTimer;
  let orders=[],orderBusy=false;
  const orderNames={novo:'Aguardando confirmação',preparo:'Em preparação',entrega:'Saiu para entrega',concluido:'Concluído',cancelado:'Cancelado'};
  const orderMoney=cents=>Number.isInteger(cents)?money(cents/100):'A confirmar';
  const weekNames=['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];
  const emptyWeek=()=>Array.from({length:7},()=>({enabled:false,start:'',end:''}));
  function normalizeSchedule(){
    if(typeof state.scheduleEnabled!=='boolean')state.scheduleEnabled=false;
    if(!Array.isArray(state.weeklyHours)||state.weeklyHours.length!==7)state.weeklyHours=emptyWeek();
  }
  function renderSchedule(){
    normalizeSchedule();
    $('schedule-enabled').checked=state.scheduleEnabled;
    $('schedule-editor').hidden=!state.scheduleEnabled;
    $('manual-open-days').hidden=state.scheduleEnabled;
    $('manual-open-hours').hidden=state.scheduleEnabled;
    $('weekly-hours-grid').innerHTML=state.weeklyHours.map((day,i)=>'<div class="weekly-hours-row" data-weekday="'+i+'">'
      +'<label class="week-checkbox"><input type="checkbox" data-day-enabled '+(day.enabled?'checked':'')+'> '+weekNames[i]+'</label>'
      +'<label class="week-time">Das <input type="time" data-time="start" value="'+esc(day.start)+'" '+(!day.enabled?'disabled':'')+' aria-label="Abertura '+weekNames[i]+'"></label>'
      +'<label class="week-time">Até <input type="time" data-time="end" value="'+esc(day.end)+'" '+(!day.enabled?'disabled':'')+' aria-label="Fechamento '+weekNames[i]+'"></label>'
      +'</div>').join('');
  }

  function screen(id){
    ['admin-loading','admin-setup','admin-login','admin-dashboard'].forEach(x=>{$(x).hidden=x!==id;});
    $('connection-state').textContent=id==='admin-dashboard'?'Acesso protegido':id==='admin-login'?'Login protegido':id==='admin-setup'?'Ativação pendente':'Conectando...';
    $('connection-state').classList.toggle('connected',id==='admin-dashboard');
  }
  function toast(message,bad=false){
    const el=$('admin-toast');
    el.textContent=message;
    el.hidden=false;
    el.classList.toggle('bad',bad);
    clearTimeout(toastTimer);
    toastTimer=setTimeout(()=>{el.hidden=true;},4900);
  }
  async function api(path,options={}){
    let response;
    try{
      response=await fetch('/api/admin/'+path,{
        credentials:'same-origin',cache:'no-store',
        ...options,
        headers:{...(options.body?{'content-type':'application/json'}:{}),...(options.headers||{})}
      });
    }catch(_){throw new Error('Não foi possível conectar ao servidor. Confira sua internet.');}
    let body;
    try{body=await response.json();}catch(_){throw new Error('Resposta inesperada do servidor.');}
    if(!response.ok||!body.ok){
      const error=new Error(body.message||'O servidor recusou a operação.');
      error.status=response.status;error.code=body.code;
      throw error;
    }
    return body;
  }
  function setDirty(){
    if(!state)return;
    dirty=true;
    $('save-state').disabled=false;
    $('save-status').textContent='Alterações não salvas';
    $('save-status').className='unsaved';
    $('last-saved').textContent='Clique em salvar para publicar no cardápio.';
  }
  function clearDirty(message='Tudo atualizado no cardápio.'){
    dirty=false;
    $('save-state').disabled=true;
    $('save-status').textContent='Alterações salvas';
    $('save-status').className='saved';
    $('last-saved').textContent=message;
  }
  function renderStats(){
    const list=state.products,available=list.filter(x=>x.available);
    $('stat-products').textContent=list.length;
    $('stat-available').textContent=available.length;
    $('stat-min').textContent=money(Math.min(...list.map(x=>Number.isFinite(x.price)?x.price:500)));
    $('order-badge').textContent=!state.acceptingOrders?'Pedidos pausados':state.scheduleEnabled?'Horário automático habilitado':'Aceitando pedidos (manual)';
    $('order-badge').classList.toggle('paused',!state.acceptingOrders);
  }
  function photoOptions(current){
    const options=[...photos];
    if(current&&!options.some(x=>x.path===current))options.push({path:current,name:'Foto cadastrada'});
    return options.map(x=>'<option value="'+esc(x.path)+'"'+(x.path===current?' selected':'')+'>'+esc(x.name)+'</option>').join('');
  }
  function productHTML(product,index){
    return '<article class="flavor-entry" data-index="'+index+'">'
      +'<div class="flavor-top">'
        +'<img class="flavor-photo" src="/'+esc(product.image)+'" alt="" loading="lazy">'
        +'<div class="flavor-heading"><span class="flavor-id">SABOR '+String(index+1).padStart(2,'0')+'</span><h4>'+esc(product.name||'Novo sabor')+'</h4><span class="flavor-price">'+money(Number.isFinite(product.price)?product.price:0)+'</span></div>'
        +'<div class="flavor-controls"><label class="availability"><input type="checkbox" data-field="available"'+(product.available?' checked':'')+'> Disponível</label><button type="button" class="remove-product" data-remove="'+index+'" title="Excluir sabor">Excluir</button></div>'
      +'</div>'
      +'<div class="flavor-grid">'
        +'<label>Nome da pizza<input type="text" data-field="name" value="'+esc(product.name)+'" maxlength="70" required></label>'
        +'<label>Preço em R$<input type="text" data-field="price" value="'+(Number.isFinite(product.price)?product.price.toFixed(2):'0.00').replace('.',',')+'" inputmode="decimal" maxlength="8" required></label>'
        +'<label class="wide">Descrição<input type="text" data-field="description" value="'+esc(product.description)+'" maxlength="240"></label>'
        +'<label class="wide">Ingredientes (separados por vírgula)<input type="text" data-field="ingredients" value="'+esc(product.ingredients.join(', '))+'" maxlength="420"></label>'
        +'<label>Categoria<input type="text" data-field="category" value="'+esc(product.category)+'" maxlength="50"></label>'
        +'<label>Etiqueta no card<input type="text" data-field="tag" value="'+esc(product.tag)+'" maxlength="36"></label>'
        +'<label class="wide">Foto disponível<select data-field="image">'+photoOptions(product.image)+'</select></label>'
      +'</div>'
    +'</article>';
  }
  function renderProducts(){
    $('admin-products').innerHTML=state.products.map(productHTML).join('');
    renderStats();
  }

  function renderOrderCounts(stats={}){
    for(const id of ['novo','preparo','entrega','concluido']){
      $('order-count-'+id).textContent=Number(stats[id]||0);
    }
  }
  function renderOrders(){
    const filter=$('orders-filter').value,term=$('orders-search').value.trim().toLocaleLowerCase('pt-BR');
    const result=orders.filter(o=>(filter==='todos'||o.status===filter)&&
      (!term||o.customerName.toLocaleLowerCase('pt-BR').includes(term)||o.reference.toLocaleLowerCase('pt-BR').includes(term)));
    if(!result.length){
      $('orders-list').innerHTML='<p class="orders-empty">'+(orders.length?'Nenhuma solicitação corresponde a este filtro.':'Nenhuma solicitação registrada ainda. Quando um cliente preparar uma consulta pelo site, ela aparecerá aqui.')+'</p>';
      return;
    }
    const dateTime=t=>new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'}).format(new Date(t*1000));
    $('orders-list').innerHTML=result.map(o=>{
      const list=o.items.map(item=>'<li><strong>'+item.qty+'x '+esc(item.name)+'</strong> <span>'+orderMoney(item.itemCents)+'</span>'
        +(item.note?'<small>✎ '+esc(item.note)+'</small>':'')+'</li>').join('');
      const addr=[o.address,'nº '+o.number,o.complement,'CEP '+o.cep].filter(Boolean).join(' · ');
      const total=orderMoney(o.totalCents);
      return '<details class="order-entry order-'+esc(o.status)+'" data-order-id="'+esc(o.id)+'">'
        +'<summary class="order-entry-summary"><span class="order-entry-main"><strong>'+esc(o.reference)+'</strong><small>'+esc(dateTime(o.createdAt))+' · '+esc(o.customerName)+'</small></span>'
        +'<span class="order-entry-side"><span class="order-status-badge">'+esc(orderNames[o.status]||o.status)+'</span><strong>'+total+'</strong></span></summary>'
        +'<div class="order-entry-details">'
          +'<div class="order-details-grid"><div><small>Cliente</small><strong>'+esc(o.customerName)+'</strong></div>'
          +'<div><small>Forma de pagamento</small><strong>'+esc(o.payment)+'</strong></div>'
          +'<div class="order-wide"><small>Endereço de entrega</small><strong>'+esc(addr)+'</strong></div>'
          +(o.notes?'<div class="order-wide"><small>Observações gerais</small><strong>'+esc(o.notes)+'</strong></div>':'')
          +'</div>'
          +'<ul class="order-items">'+list+'</ul>'
          +'<div class="order-amounts">'
            +'<span>Pizzas (preço base) <strong>'+orderMoney(o.subtotalCents)+'</strong></span>'
            +'<span>Frete estimado <strong>'+orderMoney(o.shippingCents)+'</strong></span>'
            +'<span>Total '+(o.hasCustomization?'base estimado':'estimado')+' <strong>'+total+'</strong></span>'
          +'</div>'
          +'<div class="order-actions"><label>Atualizar status<select data-order-status="'+esc(o.id)+'">'
          +Object.keys(orderNames).map(key=>'<option value="'+key+'"'+(key===o.status?' selected':'')+'>'+esc(orderNames[key])+'</option>').join('')
          +'</select></label>'
          +'<button type="button" class="order-delete" data-order-delete="'+esc(o.id)+'">Excluir solicitação</button></div>'
          +'<p class="order-smallprint">O status é administrado pela pizzaria. Nenhuma mensagem é enviada automaticamente ao cliente.</p>'
        +'</div></details>';
    }).join('');
  }
  async function loadOrders(){
    if(orderBusy)return;
    try{
      const data=await api('orders');
      orders=data.orders||[];
      renderOrderCounts(data.stats||{});
      renderOrders();
    }catch(e){
      $('orders-list').innerHTML='<p class="orders-empty">Não foi possível carregar as solicitações. Clique em Atualizar.</p>';
      if(e.status===401)toast('Sua sessão expirou. Entre novamente no painel.',true);
    }
  }

  function render(){
    $('opening-days').value=state.openDays;
    $('opening-hours').value=state.openHours;
    $('delivery-eta').value=state.etaMinutes;
    $('accepting-orders').checked=state.acceptingOrders;
    renderSchedule();
    renderProducts();
    clearDirty('Configuração carregada. Faça suas alterações e salve.');
  }
  async function loadState(){
    const result=await api('state');
    state=result.state;
    render();
    screen('admin-dashboard');
    await loadOrders();
  }
  async function bootstrap(){
    screen('admin-loading');
    try{
      const result=await api('status');
      if(!result.ready){
        screen('admin-setup');
        const details=$('setup-diagnostics');
        const checks=result.checks;
        if(checks){
          const lines=[
            ['Banco de dados D1',checks.database],
            ['ADMIN_PASSWORD (pelo menos 16 caracteres)',checks.password],
            ['ADMIN_SESSION_SECRET (pelo menos 32 caracteres)',checks.sessionSecret]
          ];
          details.innerHTML=lines.map(([label,ready])=>'<li class="'+(ready?'setup-ok':'setup-missing')+'">'+(ready?'✓ Configurado: ':'⚠ Pendente: ')+label+'</li>').join('');
          if(result.databaseError)details.insertAdjacentHTML('beforeend','<li class="setup-missing">⚠ Não foi possível acessar o banco de dados.</li>');
        }else details.textContent=result.message||'Verifique as configurações do Worker.';
        return;
      }
      try{
        await api('me');
        await loadState();
      }catch(e){
        if(e.status===401){screen('admin-login');return;}
        throw e;
      }
    }catch(error){screen('admin-setup');toast(error.message,true);}
  }
  $('login-form').addEventListener('submit',async event=>{
    event.preventDefault();
    const password=$('admin-password').value;
    const btn=$('login-button');
    btn.disabled=true;
    $('login-error').hidden=true;
    try{
      await api('login',{method:'POST',body:JSON.stringify({password})});
      $('admin-password').value='';
      await loadState();
      toast('Bem-vindo ao Doppio Admin!');
    }catch(error){
      $('login-error').textContent=error.message;
      $('login-error').hidden=false;
    }finally{btn.disabled=false;}
  });

  $('orders-reload').addEventListener('click',async()=>{await loadOrders();toast('Lista de solicitações atualizada.');});
  $('orders-filter').addEventListener('change',renderOrders);
  $('orders-search').addEventListener('input',renderOrders);
  $('orders-list').addEventListener('change',async event=>{
    const select=event.target.closest('[data-order-status]');
    if(!select||orderBusy)return;
    const id=select.dataset.orderStatus,item=orders.find(o=>o.id===id);
    if(!item)return;
    const oldStatus=item.status,newStatus=select.value;
    if(oldStatus===newStatus)return;
    orderBusy=true;select.disabled=true;
    try{
      await api('orders/'+encodeURIComponent(id),{method:'PUT',body:JSON.stringify({status:newStatus})});
      item.status=newStatus;
      await loadOrders();
      toast('Status de '+item.reference+' atualizado.');
    }catch(e){select.value=oldStatus;toast(e.message,true);}
    finally{orderBusy=false;select.disabled=false;}
  });
  $('orders-list').addEventListener('click',async event=>{
    const btn=event.target.closest('[data-order-delete]');
    if(!btn||orderBusy)return;
    const id=btn.dataset.orderDelete,item=orders.find(o=>o.id===id);
    if(!item||!confirm('Excluir definitivamente a solicitação '+item.reference+' e os dados do cliente?'))return;
    orderBusy=true;btn.disabled=true;
    try{
      await api('orders/'+encodeURIComponent(id),{method:'DELETE',body:'{}'});
      orders=orders.filter(o=>o.id!==id);
      await loadOrders();
      toast('Solicitação excluída permanentemente.');
    }catch(e){btn.disabled=false;toast(e.message,true);}
    finally{orderBusy=false;}
  });

  $('setup-refresh').addEventListener('click',bootstrap);
  $('logout').addEventListener('click',async()=>{
    if(dirty&&!confirm('Sair sem salvar as alterações?'))return;
    try{await api('logout',{method:'POST',body:'{}'});}catch(_){}
    state=null;dirty=false;screen('admin-login');toast('Você saiu do painel.');
  });
  for(const [id,key] of [['opening-days','openDays'],['opening-hours','openHours'],['delivery-eta','etaMinutes']]){
    $(id).addEventListener('input',event=>{
      if(!state)return;
      state[key]=key==='etaMinutes'?Number(event.target.value):event.target.value;
      setDirty();
    });
  }
  $('accepting-orders').addEventListener('change',event=>{
    if(!state)return;
    state.acceptingOrders=event.target.checked;renderStats();setDirty();
  });
  $('schedule-enabled').addEventListener('change',event=>{
    if(!state)return;
    state.scheduleEnabled=event.target.checked;
    renderSchedule();renderStats();setDirty();
  });
  $('weekly-hours-grid').addEventListener('change',event=>{
    if(!state)return;
    const row=event.target.closest('[data-weekday]');
    if(!row)return;
    const day=state.weeklyHours[Number(row.dataset.weekday)];
    if(!day)return;
    if(event.target.hasAttribute('data-day-enabled')){
      day.enabled=event.target.checked;
      row.querySelectorAll('input[type="time"]').forEach(el=>{el.disabled=!day.enabled;});
      setDirty();
    }
  });
  $('weekly-hours-grid').addEventListener('input',event=>{
    if(!state)return;
    const key=event.target.dataset.time;
    if(key!=='start'&&key!=='end')return;
    const row=event.target.closest('[data-weekday]');
    const day=row&&state.weeklyHours[Number(row.dataset.weekday)];
    if(!day)return;
    day[key]=event.target.value;setDirty();
  });
  $('admin-products').addEventListener('input',event=>{
    if(!state)return;
    const row=event.target.closest('[data-index]');
    if(!row)return;
    const item=state.products[Number(row.dataset.index)];
    if(!item)return;
    const field=event.target.dataset.field;
    if(field==='price'){
      const input=event.target.value.trim().replace(',','.');
      item.price=/^\d{1,3}(?:\.\d{1,2})?$/.test(input)?Number(input):NaN;
      row.querySelector('.flavor-price').textContent=Number.isFinite(item.price)?money(item.price):'Verifique o preço';
    }else if(field==='ingredients'){
      item.ingredients=event.target.value.split(',').map(x=>x.trim()).filter(Boolean);
    }else if(['name','description','category','tag'].includes(field)){
      item[field]=event.target.value;
      if(field==='name')row.querySelector('.flavor-heading h4').textContent=item.name||'Novo sabor';
    }else return;
    renderStats();setDirty();
  });
  $('admin-products').addEventListener('change',event=>{
    if(!state)return;
    const row=event.target.closest('[data-index]');
    if(!row)return;
    const item=state.products[Number(row.dataset.index)];
    if(!item)return;
    const field=event.target.dataset.field;
    if(field==='available')item.available=event.target.checked;
    else if(field==='image'){
      item.image=event.target.value;
      row.querySelector('.flavor-photo').src='/'+item.image;
    }else return;
    renderStats();setDirty();
  });
  $('admin-products').addEventListener('click',event=>{
    const button=event.target.closest('[data-remove]');
    if(!button||!state)return;
    if(state.products.length<2)return toast('É necessário manter pelo menos um sabor.',true);
    const idx=Number(button.dataset.remove),item=state.products[idx];
    if(!item)return;
    if(!confirm('Excluir "'+item.name+'" do cardápio? A remoção será publicada ao salvar.'))return;
    state.products.splice(idx,1);renderProducts();setDirty();
  });
  $('add-product').addEventListener('click',()=>{
    if(!state)return;
    if(state.products.length>=30)return toast('Limite de 30 sabores nesta versão.',true);
    const id='pizza-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,6);
    state.products.push({id,name:'Novo sabor',description:'',ingredients:['Massa','Molho de tomate'],category:'Clássicas',image:'assets/mussarela.webp',price:49.99,available:false,tag:'Novidade'});
    renderProducts();setDirty();
    const last=$('admin-products').lastElementChild;
    last.scrollIntoView({behavior:'smooth',block:'center'});
    last.querySelector('[data-field="name"]')?.focus();
    toast('Novo sabor adicionado como indisponível. Preencha os dados e salve.');
  });
  $('save-state').addEventListener('click',async()=>{
    if(!state||!dirty||busy)return;
    if(state.products.some(p=>!Number.isFinite(p.price)||p.price<1||p.price>500))return toast('Revise o preço de todos os sabores.',true);
    if(state.scheduleEnabled){
      const active=state.weeklyHours.filter(d=>d.enabled);
      if(!active.length)return toast('Selecione pelo menos um dia na programação automática.',true);
      if(active.some(d=>!d.start||!d.end||d.start===d.end))return toast('Preencha horários de abertura e fechamento diferentes em cada dia selecionado.',true);
    }
    const button=$('save-state');
    busy=true;button.disabled=true;button.textContent='Salvando...';
    try{
      const res=await api('state',{method:'PUT',body:JSON.stringify({expectedRevision:state.revision,state})});
      state=res.state;render();
      toast('Alterações publicadas no cardápio!');
    }catch(error){
      button.disabled=false;
      if(error.status===401){screen('admin-login');toast('Sessão expirada. Entre novamente.',true);}
      else toast(error.message,true);
    }finally{
      busy=false;button.textContent='Salvar alterações ✓';button.disabled=!dirty;
    }
  });
  $('reload-state').addEventListener('click',async()=>{
    if(dirty&&!confirm('Descartar alterações não salvas e recarregar?'))return;
    try{await loadState();toast('Dados atualizados.');}catch(error){toast(error.message,true);}
  });
  window.addEventListener('beforeunload',event=>{
    if(!dirty)return;
    event.preventDefault();event.returnValue='';
  });
  bootstrap();
})();
