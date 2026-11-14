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
    $('order-badge').textContent=state.acceptingOrders?'Aceitando pedidos':'Pedidos pausados';
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
  function render(){
    $('opening-days').value=state.openDays;
    $('opening-hours').value=state.openHours;
    $('delivery-eta').value=state.etaMinutes;
    $('accepting-orders').checked=state.acceptingOrders;
    renderProducts();
    clearDirty('Configuração carregada. Faça suas alterações e salve.');
  }
  async function loadState(){
    const result=await api('state');
    state=result.state;
    render();
    screen('admin-dashboard');
  }
  async function bootstrap(){
    screen('admin-loading');
    try{
      const result=await api('status');
      if(!result.ready){screen('admin-setup');return;}
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
