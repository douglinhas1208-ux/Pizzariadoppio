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
  let adminPhotos=[];
  let orders=[],orderBusy=false,ordersRequest=null,ordersSignature='',ordersLoaded=false;
  let ordersGeneration=0;
  const ORDER_REFRESH_MS=10000;
  let soundEnabled=false,alertAudio=null,alertClearTimer;
  try{soundEnabled=localStorage.getItem('doppio-admin-sound')==='true';}catch(_){}
  const AudioAPI=window.AudioContext||window.webkitAudioContext;
  function updateSoundButton(){
    $('orders-sound-toggle').textContent=soundEnabled?'🔊 Som ativado':'🔕 Ativar som';
    $('orders-sound-toggle').setAttribute('aria-pressed',String(soundEnabled));
  }
  function playOrderChime(){
    if(!soundEnabled||!AudioAPI)return;
    try{
      if(!alertAudio)alertAudio=new AudioAPI();
      if(alertAudio.state!=='running')return;
      for(const [delay,freq] of [[0,700],[0.17,920]]){
        const start=alertAudio.currentTime+delay;
        const osc=alertAudio.createOscillator(),volume=alertAudio.createGain();
        osc.type='sine';osc.frequency.setValueAtTime(freq,start);
        volume.gain.setValueAtTime(0.0001,start);
        volume.gain.exponentialRampToValueAtTime(0.11,start+0.022);
        volume.gain.exponentialRampToValueAtTime(0.0001,start+0.13);
        osc.connect(volume);volume.connect(alertAudio.destination);
        osc.start(start);osc.stop(start+0.14);
      }
    }catch(_){/* Navegador sem áudio: manter alerta visual. */}
  }
  function showNewOrderAlert(amount){
    const banner=$('orders-new-alert');
    banner.hidden=false;
    $('orders-new-alert-text').textContent=amount===1
      ?'🍕 Nova solicitação de pedido recebida!'
      :'🍕 '+amount+' novas solicitações recebidas!';
    $('orders-panel').classList.add('has-new-orders');
    clearTimeout(alertClearTimer);
    alertClearTimer=setTimeout(()=>{
      banner.hidden=true;
      $('orders-panel').classList.remove('has-new-orders');
    },17000);
    playOrderChime();
  }

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
    const options=[...photos,...adminPhotos];
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
        +'<div class="wide photo-upload-box"><strong>📸 Enviar nova foto</strong>'
        +'<input type="file" data-upload-photo="'+index+'" accept="image/jpeg,image/png,image/webp" aria-label="Enviar foto de '+esc(product.name)+'">'
        +'<small>JPG, PNG ou WEBP · até 8 MB · compactação automática para JPEG. Depois salve as alterações no cardápio.</small></div>'
      +'</div>'
    +'</article>';
  }

  function compressPizzaPhoto(file){
    if(!file||!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('Escolha uma foto JPG, PNG ou WEBP.');
    if(file.size>8*1024*1024)throw Error('Escolha uma foto de até 8 MB.');
    return new Promise((resolve,reject)=>{
      const url=URL.createObjectURL(file),img=new Image();
      img.onload=()=>{
        URL.revokeObjectURL(url);
        try{
          if(!img.naturalWidth||!img.naturalHeight)throw Error('Imagem inválida.');
          const canvas=document.createElement('canvas');
          const ctx=canvas.getContext('2d');
          if(!ctx)throw Error('Não foi possível processar a foto.');
          let maxSide=1000;
          for(let pass=0;pass<7;pass++){
            const factor=Math.min(1,maxSide/Math.max(img.naturalWidth,img.naturalHeight));
            canvas.width=Math.max(1,Math.round(img.naturalWidth*factor));
            canvas.height=Math.max(1,Math.round(img.naturalHeight*factor));
            ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);
            ctx.drawImage(img,0,0,canvas.width,canvas.height);
            const base64=canvas.toDataURL('image/jpeg',Math.max(.56,.82-pass*.04)).split(',')[1];
            if(base64.length<=470000){resolve(base64);return;}
            maxSide=Math.round(maxSide*.79);
          }
          throw Error('Foto muito detalhada para compactar. Escolha outra imagem.');
        }catch(e){reject(e);}
      };
      img.onerror=()=>{URL.revokeObjectURL(url);reject(Error('Não foi possível abrir esta foto.'));};
      img.src=url;
    });
  }
  async function uploadPizzaPhoto(index,file,input){
    const product=state?.products[index];
    if(!product||!file)return;
    input.disabled=true;
    toast('Compactando e enviando a foto...');
    try{
      const base64=await compressPizzaPhoto(file);
      const result=await api('images',{method:'POST',body:JSON.stringify({name:file.name,base64})});
      if(!state||!state.products.includes(product))throw Error('O sabor foi alterado. Reabra o painel antes de vincular a foto.');
      const image=result.image;
      if(!image||typeof image.path!=='string')throw Error('Resposta inesperada no envio da foto.');
      if(!adminPhotos.some(p=>p.path===image.path))adminPhotos.unshift(image);
      product.image=image.path;
      renderProducts();
      setDirty();
      toast('Foto enviada! Clique em Salvar alterações para aparecer no cardápio.');
    }catch(e){
      toast(e.message||'Não foi possível enviar a foto.',true);
    }finally{input.disabled=false;}
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
          +'<div><small>Celular do cliente</small><strong>'+(o.customerPhone?esc(o.customerPhone):'Não informado neste pedido')+'</strong></div>'
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
          +'<div class="order-actions-whatsapp">'
          +'<button type="button" class="order-contact-button" data-order-whatsapp="'+esc(o.id)+'"'
          +(o.customerPhone?'':' disabled title="Telefone não informado"')+'>🟢 Preparar mensagem no WhatsApp</button>'
          +'<button type="button" class="order-payment-button'+(Number.isInteger(o.paidAmountCents)?' paid':'')+'" data-order-payment="'+esc(o.id)+'">'
          +(Number.isInteger(o.paidAmountCents)?'✓ Recebido '+orderMoney(o.paidAmountCents)+' · Desfazer':'R$ Confirmar pagamento')+'</button>'
          +'</div>'
          +'<button type="button" class="order-delete" data-order-delete="'+esc(o.id)+'">Excluir solicitação</button></div>'
          +'<p class="order-smallprint">O status é administrado pela pizzaria. Nenhuma mensagem é enviada automaticamente ao cliente.</p>'
        +'</div></details>';
    }).join('');
  }

  function orderMessage(order){
    const customer=order.customerName.trim().split(/\s+/)[0];
    const id=order.reference;
    const prefix='Olá, '+customer+'! Aqui é da Doppio Pizzas. 🍕\n';
    const notes={
      novo:'Recebemos a solicitação '+id+'. Estamos conferindo disponibilidade, entrega e valores. Já retornamos com a confirmação.',
      preparo:'Seu pedido '+id+' está confirmado e agora está em preparação. 🍕',
      entrega:'Boas notícias! Seu pedido '+id+' saiu para entrega. 🛵',
      concluido:'Seu pedido '+id+' foi marcado como concluído. Obrigado por escolher a Doppio Pizzas! 🍕',
      cancelado:'Sobre o pedido '+id+': registramos o cancelamento. Se precisar de ajuda, responda por aqui.'
    };
    return prefix+(notes[order.status]||notes.novo)+'\n\nMensagem preparada pelo painel. Confira antes de enviar.';
  }
  function parseReceivedValue(text){
    const clean=String(text||'').replace(/^R\$\s*/i,'').trim();
    if(!/^\d{1,5}(?:[,.]\d{1,2})?$/.test(clean))return null;
    const value=Math.round(Number(clean.replace(',','.'))*100);
    return value>=1&&value<=5000000?value:null;
  }
  async function updateReceivedPayment(id,button){
    if(orderBusy)return;
    const order=orders.find(o=>o.id===id);
    if(!order)return;
    let cents;
    if(Number.isInteger(order.paidAmountCents)){
      if(!confirm('Desfazer a confirmação de pagamento do pedido '+order.reference+'?'))return;
      cents=null;
    }else{
      const suggested=Number.isInteger(order.totalCents)?(order.totalCents/100).toFixed(2).replace('.',','):'';
      const answer=prompt('Qual foi o valor realmente recebido no pedido '+order.reference+'? Informe em reais (por exemplo, 59,99). Não marque pagamento não recebido.',suggested);
      if(answer===null)return;
      cents=parseReceivedValue(answer);
      if(cents===null){toast('Informe um valor válido, de R$ 0,01 a R$ 50.000,00.',true);return;}
      if(!confirm('Confirmar recebimento de '+orderMoney(cents)+' para '+order.reference+'? Esta informação será incluída no relatório.'))return;
    }
    orderBusy=true;button.disabled=true;
    try{
      await api('orders/'+encodeURIComponent(id),{method:'PUT',body:JSON.stringify({paidAmountCents:cents})});
      await loadOrders();
      await loadReports();
      toast(cents===null?'Confirmação de pagamento desfeita.':'Pagamento registrado no relatório.');
    }catch(error){toast(error.message||'Não foi possível confirmar o recebimento.',true);}
    finally{orderBusy=false;button.disabled=false;}
  }

  // Atualização periódica: não altera filtros, busca ou detalhes abertos.
  async function loadOrders({silent=false}={}){
    if(ordersRequest){
      if(silent)return;
      await ordersRequest;
    }
    if(silent && (orderBusy||document.hidden||$('admin-dashboard').hidden||
      document.activeElement?.matches?.('[data-order-status]')))return;
    const generation=ordersGeneration;
    const request=(async()=>{
      try{
        const data=await api('orders');
        if(generation!==ordersGeneration||$('admin-dashboard').hidden)return;
        const nextOrders=Array.isArray(data.orders)?data.orders:[];
        const nextStats=data.stats||{};
        const nextSignature=JSON.stringify([nextOrders,nextStats]);
        const changed=!ordersLoaded||nextSignature!==ordersSignature;
        const previouslyLoaded=ordersLoaded;
        const previousIds=new Set(orders.map(o=>o.id));
        const newCount=previouslyLoaded?nextOrders.filter(o=>!previousIds.has(o.id)&&o.status==='novo').length:0;
        if(changed){
          if(previouslyLoaded)void loadReports({silent:true});
          const openedIds=new Set([...$('orders-list').querySelectorAll('.order-entry[open]')].map(el=>el.dataset.orderId));
          orders=nextOrders;
          ordersSignature=nextSignature;
          ordersLoaded=true;
          renderOrderCounts(nextStats);
          renderOrders();
          for(const entry of $('orders-list').querySelectorAll('.order-entry')){
            if(openedIds.has(entry.dataset.orderId))entry.open=true;
          }
        }
        const localTime=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date());
        $('orders-live-state').textContent='✓ Sincronizado às '+localTime+' · atualiza a cada 10s';
        $('orders-live-state').classList.remove('offline');
        if(newCount){
          showNewOrderAlert(newCount);
          toast(newCount===1?'🍕 Nova solicitação recebida!':'🍕 '+newCount+' novas solicitações recebidas!');
        }
      }catch(e){
        if(generation!==ordersGeneration)return;
        $('orders-live-state').textContent='Sem conexão · tentando novamente';
        $('orders-live-state').classList.add('offline');
        if(e.status===401){
          screen('admin-login');
          toast('Sua sessão expirou. Entre novamente no painel.',true);
        }else if(!silent && !ordersLoaded){
          $('orders-list').innerHTML='<p class="orders-empty">Não foi possível carregar as solicitações. Clique em Atualizar.</p>';
        }else if(!silent){
          toast('Não foi possível atualizar as solicitações. Tentaremos novamente.',true);
        }
      }
    })();
    ordersRequest=request;
    try{await request;}finally{if(ordersRequest===request)ordersRequest=null;}
  }


  let reportRequest=null;
  async function loadReports({silent=false}={}){
    if(reportRequest){
      if(silent)return;
      await reportRequest;
    }
    const job=(async()=>{
      try{
        const days=Number($('report-days').value)||7;
        const res=await api('reports?days='+days);
        if($('admin-dashboard').hidden||Number($('report-days').value)!==days)return;
        const totals=res.totals||{};
        $('report-orders').textContent=Number(totals.orders||0);
        $('report-completed').textContent=Number(totals.completed||0);
        $('report-received').textContent=orderMoney(Number(totals.receivedCents||0));
        $('report-estimated').textContent=orderMoney(Number(totals.estimatedCents||0));
        const entries=(res.daily||[]).slice(-14);
        $('report-chart-label').textContent=days>14?'Até 14 dias com movimento':'Movimento dos últimos '+days+' dias';
        if(!entries.length){
          $('report-chart').innerHTML='<p class="orders-empty">Nenhum pedido registrado neste período.</p>';
          return;
        }
        const maxValue=Math.max(1,...entries.map(d=>Number(d.receivedCents||0)));
        $('report-chart').innerHTML=entries.map(d=>{
          const height=Math.max(4,Math.round(Number(d.receivedCents||0)/maxValue*104));
          const label=d.day.slice(8,10)+'/'+d.day.slice(5,7);
          return '<div class="report-bar-column" title="'+esc(label)+' · '+esc(orderMoney(d.receivedCents))+'">'
            +'<strong>'+esc(orderMoney(d.receivedCents))+'</strong>'
            +'<span class="report-bar" style="height:'+height+'px"></span>'
            +'<small>'+esc(label)+'</small></div>';
        }).join('');
      }catch(e){
        if(!silent){
          $('report-chart').innerHTML='<p class="orders-empty">Não foi possível carregar o relatório. Clique em Atualizar.</p>';
          toast(e.message||'Falha no relatório.',true);
        }
      }
    })();
    reportRequest=job;
    try{await job;}finally{if(reportRequest===job)reportRequest=null;}
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
    try{
      const images=await api('images');
      adminPhotos=images.images||[];
    }catch(_){adminPhotos=[];}
    render();
    screen('admin-dashboard');
    await loadOrders();
    await loadReports();
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

  updateSoundButton();
  $('orders-sound-toggle').addEventListener('click',async()=>{
    if(!soundEnabled){
      if(!AudioAPI){toast('Este navegador não oferece alertas sonoros.',true);return;}
      try{
        if(!alertAudio)alertAudio=new AudioAPI();
        await alertAudio.resume();
        if(alertAudio.state!=='running')throw Error('audio bloqueado');
        soundEnabled=true;
        playOrderChime();
        toast('Alerta sonoro ativado neste navegador.');
      }catch(_){soundEnabled=false;toast('Toque novamente para autorizar o áudio no navegador.',true);}
    }else{soundEnabled=false;toast('Alerta sonoro desativado.');}
    try{localStorage.setItem('doppio-admin-sound',String(soundEnabled));}catch(_){}
    updateSoundButton();
  });
  $('orders-alert-dismiss').addEventListener('click',()=>{
    $('orders-new-alert').hidden=true;
    $('orders-panel').classList.remove('has-new-orders');
  });
  $('orders-alert-open').addEventListener('click',()=>{
    $('orders-filter').value='novo';
    $('orders-search').value='';
    renderOrders();
    $('orders-new-alert').hidden=true;
    $('orders-panel').classList.remove('has-new-orders');
    $('orders-list').scrollIntoView({behavior:'smooth',block:'start'});
  });
  $('reports-reload').addEventListener('click',()=>{void loadReports();});
  $('report-days').addEventListener('change',()=>{void loadReports();});
  $('orders-reload').addEventListener('click',async()=>{await loadOrders();toast('Lista de solicitações atualizada.');});
  $('orders-filter').addEventListener('change',renderOrders);
  $('orders-search').addEventListener('input',renderOrders);
  $('orders-list').addEventListener('click',event=>{
    const btn=event.target.closest('[data-order-whatsapp]');
    if(!btn)return;
    const order=orders.find(o=>o.id===btn.dataset.orderWhatsapp);
    if(!order)return;
    const phone=String(order.customerPhone||'').replace(/\D/g,'');
    if(!/^[1-9][0-9]{9,10}$/.test(phone)){toast('Este pedido não possui celular válido.',true);return;}
    window.open('https://wa.me/55'+phone+'?text='+encodeURIComponent(orderMessage(order)),'_blank','noopener,noreferrer');
  });
  $('orders-list').addEventListener('click',event=>{
    const button=event.target.closest('[data-order-payment]');
    if(button)void updateReceivedPayment(button.dataset.orderPayment,button);
  });
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
    ordersGeneration++;
    orders=[];ordersLoaded=false;ordersSignature='';
    $('orders-live-state').textContent='Atualização automática a cada 10s';
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
    const uploader=event.target.closest('[data-upload-photo]');
    if(uploader){
      const index=Number(uploader.dataset.uploadPhoto);
      const file=uploader.files?.[0];
      if(file)void uploadPizzaPhoto(index,file,uploader);
      return;
    }
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
  // Só verifica quando o painel está aberto e visível; retoma ao voltar à aba.
  window.setInterval(()=>{void loadOrders({silent:true});},ORDER_REFRESH_MS);
  document.addEventListener('visibilitychange',()=>{
    if(!document.hidden)void loadOrders({silent:true});
  });
  window.addEventListener('focus',()=>{void loadOrders({silent:true});});
  window.addEventListener('beforeunload',event=>{
    if(!dirty)return;
    event.preventDefault();event.returnValue='';
  });
  bootstrap();
})();
