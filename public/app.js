(() => {
  'use strict';
  const cfg = window.DOPPIO_CONFIG;
  const $ = id => document.getElementById(id);
  if (!cfg || !Array.isArray(cfg.products)) {
    $('products').textContent = 'Não foi possível carregar o cardápio.';
    return;
  }
  const money = n => new Intl.NumberFormat('pt-BR', {style: 'currency', currency: 'BRL'}).format(n);
  const validPrice = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;
  const esc = v => String(v ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const products = cfg.products.filter(p => p && typeof p.id === 'string' && p.available !== false);
  let acceptingOrders = cfg.business?.acceptingOrders !== false;
  let storeStatus = cfg.business?.storeStatus || (acceptingOrders?'manual':'paused');
  let nextOpening = cfg.business?.nextOpening || null;
  const byId = id => products.find(p => p.id === id);
  const formatPrice = n => validPrice(n) ? money(n) : 'A confirmar';
  // Preço de destaque: reais maiores e centavos em posição elevada, sem descontos fictícios.
  const priceMarkup = value => {
    if(!validPrice(value))return '<span class="price price-pending">Preço a confirmar</span>';
    const [reais, centavos]=value.toFixed(2).split('.');
    return '<span class="price price-featured" aria-label="'+esc(money(value))+'">'
      +'<span class="price-eyebrow">PREÇO DA PIZZA</span>'
      +'<span class="price-amount"><small class="price-currency">R$</small>'
      +'<strong class="price-integer">'+Number(reais).toLocaleString('pt-BR')+'</strong>'
      +'<sup class="price-decimal">,'+centavos+'</sup></span></span>';
  };

  const cleanNote = v => String(v ?? '').replace(/[\r\n\t]+/g,' ').replace(/\s+/g,' ').trim().slice(0,180);
  const makeKey = i => {
    const base = i.type === 'half' ? `half:${i.a}:${i.b}` : `pizza:${i.id}`;
    return i.note ? `${base}:obs:${encodeURIComponent(i.note)}` : base;
  };
  const formatName = i => i.type === 'half'
    ? `Meio a meio: ${byId(i.a)?.name ?? 'Sabor'} / ${byId(i.b)?.name ?? 'Sabor'}`
    : byId(i.id)?.name ?? 'Pizza';
  const itemPrice = i => {
    if (i.type === 'half') {
      const a = byId(i.a)?.price, b = byId(i.b)?.price;
      return validPrice(a) && validPrice(b) ? (a + b) / 2 : null;
    }
    return validPrice(byId(i.id)?.price) ? byId(i.id).price : null;
  };
  const normalizeItem = i => {
    if (!i || !Number.isInteger(i.qty) || i.qty < 1 || i.qty > 99) return null;
    const note=cleanNote(i.note);
    if (i.type === 'half' && byId(i.a) && byId(i.b) && i.a !== i.b) {
      const [a,b] = [i.a,i.b].sort();
      const normalized={type:'half',a,b,note,qty:i.qty};
      normalized.key=makeKey(normalized);
      return normalized;
    }
    if (i.type === 'pizza' && byId(i.id)) {
      const normalized={type:'pizza',id:i.id,note,qty:i.qty};
      normalized.key=makeKey(normalized);
      return normalized;
    }
    return null;
  };
  let cart = [];
  try {
    const stored = JSON.parse(localStorage.getItem('doppio-cart-v2') || localStorage.getItem('doppio-cart-v1') || '[]');
    if (Array.isArray(stored)) cart = stored.map(normalizeItem).filter(Boolean).slice(0,40);
  } catch (_) { /* O carrinho funciona mesmo se o armazenamento estiver indisponível. */ }
  const form={name:'',phone:'',cep:'',numero:'',complemento:'',address:'',payment:(cfg.business.paymentMethods||[])[0]||'A combinar',notes:''};
  const maxKm=Number(cfg.delivery?.radiusKm)||5;
  const baseKm=Number(cfg.delivery?.includedKm)||5;
  const baseFee=Number(cfg.delivery?.minFee)||5;
  const extraFee=Number(cfg.delivery?.extraKmFee ?? 0);
  const displayKm=n=>new Intl.NumberFormat('pt-BR',{maximumFractionDigits:2}).format(n);
  const shipping={status:'idle',address:null,quote:null,message:'',requestId:0};
  let lookupTimer=null, quoteTimer=null;
  const validNumber=()=>/^[0-9]{1,6}[a-zA-Z]?$/.test(form.numero.trim());
  const phoneDigits=()=>form.phone.replace(/\D/g,'');
  const cepDigits=()=>form.cep.replace(/\D/g,'');
  const invalidateQuote=()=>{
    shipping.quote=null;shipping.message='';
    shipping.requestId++;
  };
  const halfEnabled = cfg.options?.halfHalfEnabled !== false && products.length >= 2;
  const categories = ['Todos', ...new Set(products.map(p => p.category || 'Outros')), ...(halfEnabled ? ['Meio a meio'] : [])];
  let filter = 'Todos';
  let customizing = null;
  let toastTimer, activeTrigger = null;
  const saveCart = () => { try { localStorage.setItem('doppio-cart-v2', JSON.stringify(cart)); } catch (_) {} };
  function toast(msg) {
    const el = $('toast'); el.textContent = msg; el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }
  function renderFilters() {
    document.querySelector('.filter-group').innerHTML = categories.map((name,idx) => `<button class="filter ${name===filter?'active':''}" data-filter="${esc(name)}" type="button" aria-pressed="${name===filter}">${esc(name)}${idx===0?` <span id="all-count">${String(products.length + (halfEnabled ? 1 : 0)).padStart(2,'0')}</span>`:''}</button>`).join('');
  }
  const cartIcon = `<svg class="icon-cart" viewBox="0 0 24 24" width="21" height="21" aria-hidden="true" focusable="false"><circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2 2h2l2.4 12.4a2 2 0 0 0 2 1.6h9.8a2 2 0 0 0 2-1.6L22 7H5"/></svg>`;
  function renderProducts() {
    if (!categories.includes(filter)) filter = 'Todos';
    const displayed = products.filter(p => filter === 'Todos' || (filter !== 'Meio a meio' && (p.category||'Outros') === filter));
    const showHalfCard = halfEnabled && (filter === 'Todos' || filter === 'Meio a meio');
    const halfPhoto1 = byId('brocolis') || products[0];
    const halfPhoto2 = byId('mussarela') || products[1];
    const halfCard = showHalfCard ? `<article class="pizza-card half-choice-card" id="meio-a-meio">
      <div class="pizza-image half-pizza-image">
        <div class="half-split-photos"><img src="${esc(halfPhoto1.image)}" alt="Exemplo de metade: ${esc(halfPhoto1.name)}" loading="lazy" decoding="async" width="280" height="390"><img src="${esc(halfPhoto2.image)}" alt="Exemplo de metade: ${esc(halfPhoto2.name)}" loading="lazy" decoding="async" width="280" height="390"></div>
        <span class="pizza-tag">MEIO A MEIO</span><span class="half-image-mark" aria-hidden="true">½</span>
      </div>
      <div class="pizza-body"><span class="pizza-category">PERSONALIZE SUA PIZZA</span><h3>Pizza meio a meio</h3><p>Escolha duas metades entre nossos sabores. Você também pode pedir alterações nos ingredientes.</p>
      <div class="pizza-bottom"><span class="price price-pending">Valor conforme os sabores</span><button class="add-button half-card-button" data-open-half type="button" ${acceptingOrders?'':'disabled title="Pedidos pausados"'}>½ Escolher sabores</button></div>
      <p class="half-card-caption">Preço pela média dos sabores, sujeito à confirmação.</p></div></article>` : '';
    $('products').innerHTML = displayed.map(p => `<article class="pizza-card">
      <div class="pizza-image"><img src="${esc(p.image)}" alt="Pizza de ${esc(p.name)}" loading="lazy" decoding="async" width="560" height="390"><span class="pizza-tag">${esc(p.tag||p.category||'Sabor')}</span></div>
      <div class="pizza-body"><span class="pizza-category">${esc(p.category||'Outros')}</span><h3>${esc(p.name)}</h3>
      <p class="pizza-ingredients-line" aria-label="Ingredientes: ${esc(Array.isArray(p.ingredients)?p.ingredients.join(', '):p.description)}">${Array.isArray(p.ingredients)&&p.ingredients.length?p.ingredients.map(esc).join(' · '):esc(p.description)}</p>
      <div class="pizza-bottom">${priceMarkup(p.price)}<button class="add-button" data-add="${esc(p.id)}" type="button" aria-label="Adicionar ${esc(p.name)} ao carrinho" ${acceptingOrders?'':'disabled title="Pedidos temporariamente pausados"'}>${cartIcon} Adicionar</button></div><button type="button" class="customize-link" data-customize="${esc(p.id)}" ${acceptingOrders?'':'disabled'}>✎ Personalizar / trocar ingrediente</button></div></article>`).join('') + halfCard || '<p>Novos sabores em breve.</p>';
    document.querySelector('.menu-count span').textContent = String(products.length + (halfEnabled ? 1 : 0)).padStart(2,'0');
    renderFilters();
  }
  function totals(){
    const count=cart.reduce((sum,item)=>sum+item.qty,0);
    const pending=cart.some(item=>!validPrice(itemPrice(item)));
    const customized=cart.some(item=>!!item.note);
    const subtotal=cart.reduce((sum,item)=>sum+(itemPrice(item)??0)*item.qty,0);
    const fee=shipping.status==='ready' ? shipping.quote?.fee : null;
    const km=shipping.status==='ready' ? shipping.quote?.distanceKm : null;
    const total=cart.length&&!pending&&!customized&&validPrice(fee)?subtotal+fee:null;
    return {count,pending,customized,subtotal,fee,total,km,outOfArea:shipping.status==='outside'};
  }
  function shippingPreview(){
    if(shipping.status==='ready')return 'Frete estimado pelo CEP: '+money(shipping.quote.fee)+' · rota de referência: '+displayKm(shipping.quote.distanceKm)+' km.';
    if(shipping.status==='loading-cep')return 'Buscando endereço do CEP...';
    if(shipping.status==='calculating')return 'Calculando rota pelas ruas...';
    // O cálculo usa a rua de referência do CEP, sem confirmação em mapa.
    if(shipping.status==='outside')return 'Fora da área de entrega de até '+maxKm+' km.';
    if(shipping.status==='error')return shipping.message||'Não foi possível calcular o frete. Tente novamente.';
    if(!shipping.address)return 'Digite seu CEP para preencher a rua automaticamente.';
    return 'Calcularemos automaticamente o frete para esse CEP.';
  }
  function updateDeliveryLive(){
    const t=totals(),text=shippingPreview();
    document.querySelectorAll('[data-delivery-address]').forEach(el=>{
      el.textContent=form.address||'O endereço será preenchido após a consulta do CEP.';
    });
    document.querySelectorAll('[data-delivery-preview]').forEach(el=>{
      el.textContent=text;el.classList.toggle('delivery-warning',shipping.status==='error'||shipping.status==='outside');
      el.classList.toggle('delivery-success',shipping.status==='ready');
    });
    document.querySelectorAll('[data-delivery-pending]').forEach(el=>{
      el.textContent=shipping.status==='ready'
        ? 'Frete estimado pela rua do CEP. Confira o endereço: o valor pode variar. Alterações de ingredientes são confirmadas no WhatsApp.'
        : 'Digite o CEP para consultar o frete automaticamente. O número é usado só para identificar a entrega.';
    });
    document.querySelectorAll('[data-delivery-fee]').forEach(el=>{el.textContent=shipping.status==='outside'?'Fora da área':validPrice(t.fee)?money(t.fee):'A calcular';});
    document.querySelectorAll('[data-delivery-label]').forEach(el=>{el.textContent=validPrice(t.fee)?'Frete pelo CEP (estimado)':'Taxa de entrega';});
    document.querySelectorAll('[data-order-total]').forEach(el=>{el.textContent=t.total===null?'A confirmar':money(t.total);});
    document.querySelectorAll('[data-calc-frete]').forEach(el=>{
      el.disabled=!shipping.address||shipping.status==='calculating';
      el.textContent=shipping.status==='calculating'?'Calculando...':shipping.status==='ready'?'Recalcular frete':'Calcular frete';
    });
    if($('mobile-total'))$('mobile-total').textContent=t.total!==null?money(t.total):'Conferir pedido →';
  }
  async function lookupCep(){
    const cep=cepDigits();if(cep.length!==8)return;
    const requestId=++shipping.requestId;
    shipping.status='loading-cep';shipping.message='';updateDeliveryLive();
    try{
      const response=await fetch('/api/cep?cep='+encodeURIComponent(cep),{cache:'no-store'});
      const data=await response.json();
      if(requestId!==shipping.requestId)return;
      if(!response.ok||!data.ok)throw new Error(data.message||'CEP não encontrado.');
      shipping.address=data.address;
      form.address=[data.address.street,data.address.neighborhood,data.address.city+' - '+data.address.state].filter(Boolean).join(', ');
      shipping.status='waiting-quote';updateDeliveryLive();
      calculateShipping();
    }catch(error){
      if(requestId!==shipping.requestId)return;
      shipping.address=null;form.address='';
      shipping.status='error';shipping.message=error.message||'Não foi possível consultar CEP.';updateDeliveryLive();
    }
  }
  async function calculateShipping(){
    clearTimeout(quoteTimer);
    const cep=cepDigits();
    if(cep.length!==8||!shipping.address){
      toast('Informe um CEP válido para calcular o frete.');return;
    }
    const requestId=++shipping.requestId;
    shipping.status='calculating';shipping.quote=null;shipping.message='';
    updateDeliveryLive();
    try{
      const response=await fetch('/api/frete',{
        method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({cep})
      });
      const data=await response.json();
      if(requestId!==shipping.requestId)return;
      if(!response.ok||!data.ok){
        shipping.message=data.message||'Não foi possível calcular o frete para esse CEP.';
        shipping.status=data.code==='outside_area'||data.code==='outside_state'?'outside':'error';
        updateDeliveryLive();return;
      }
      if(!Number.isFinite(data.fee)||!Number.isFinite(data.distanceKm))throw new Error('Resposta de distância inválida.');
      shipping.status='ready';shipping.quote=data;updateDeliveryLive();
    }catch(error){
      if(requestId!==shipping.requestId)return;
      shipping.status='error';shipping.message=error.message||'Falha de conexão ao calcular o frete.';
      updateDeliveryLive();
    }
  }
  function renderCartContents() {
    const s = totals();
    const items = cart.length ? `<div class="cart-items">${cart.map(i => `<div class="cart-item"><div class="cart-item-main"><div class="cart-item-name">${esc(formatName(i))}</div><div class="cart-item-price">${formatPrice(itemPrice(i))}${i.note?' · valor com alterações a confirmar':''}</div>${i.note?`<p class="item-note"><b>Obs.:</b> ${esc(i.note)}</p>`:''}<button class="edit-item-note" data-edit-note="${esc(i.key)}" type="button">✎ ${i.note?'Editar observação':'Adicionar observação'}</button></div><div class="qty-controls"><button type="button" data-qty="${esc(i.key)}" data-step="-1" aria-label="Diminuir quantidade de ${esc(formatName(i))}">−</button><span>${i.qty}</span><button type="button" data-qty="${esc(i.key)}" data-step="1" aria-label="Aumentar quantidade de ${esc(formatName(i))}">+</button></div></div>`).join('')}</div>`
      : '<div class="cart-empty"><span class="cart-empty-icon">🍕</span><b>Seu pedido começa aqui.</b><p>Escolha uma pizza e monte seu pedido.</p></div>';
    const summary=cart.length?`<div class="cart-line"></div>
      <div class="summary-row"><span>${s.pending?'Parcial dos sabores com preço':s.customized?'Subtotal base estimado':'Subtotal'}</span><strong>${s.pending&&!s.subtotal?'A confirmar':money(s.subtotal)}</strong></div>
      <div class="summary-row"><span data-delivery-label>${validPrice(s.fee)?'Frete pelo CEP (estimado)':'Taxa de entrega'}</span><strong data-delivery-fee>${s.outOfArea?'Fora da área':validPrice(s.fee)?money(s.fee):'A calcular'}</strong></div>
      <div class="summary-row summary-total"><span>Total estimado</span><strong data-order-total>${s.total===null?'A confirmar':money(s.total)}</strong></div>
      <div class="cart-pending" data-delivery-pending>${shipping.status==='ready'?'Frete estimado pelo CEP. Valores sujeitos à conferência do endereço e alterações de ingredientes.':'Informe o CEP para consultar o frete automático.'}</div>`:'';
    const fields=cart.length?`<form class="order-form" onsubmit="return false">
      <label for="{prefix}-name">Seu nome <span class="required-mark">*</span></label>
      <input id="{prefix}-name" data-field="name" autocomplete="name" maxlength="70" placeholder="Como podemos chamar você?" value="${esc(form.name)}" required>
      <label for="{prefix}-phone">Celular com DDD para contato <span class="required-mark">*</span></label>
      <input id="{prefix}-phone" data-field="phone" type="tel" inputmode="tel" autocomplete="tel-national" maxlength="18" placeholder="(11) 99999-9999" value="${esc(form.phone)}" required>
      <p class="delivery-hint">Usaremos seu número apenas para confirmar e acompanhar o pedido pelo WhatsApp.</p>
      <div class="delivery-calculator">
        <strong class="delivery-title">Frete automático pelo CEP</strong>
        <label for="{prefix}-cep">CEP de entrega <span class="required-mark">*</span></label>
        <input id="{prefix}-cep" data-field="cep" inputmode="numeric" autocomplete="postal-code" maxlength="9" placeholder="00000-000" value="${esc(form.cep)}" required>
        <p class="delivery-address-result" data-delivery-address>${esc(form.address||'O endereço será preenchido após consultar o CEP.')}</p>
        <p class="delivery-estimate ${shipping.status==='outside'||shipping.status==='error'?'delivery-warning':''}" data-delivery-preview aria-live="polite">${esc(shippingPreview())}</p>
        <button type="button" data-calc-frete class="delivery-calc-button">Recalcular frete</button>
        <p class="delivery-rule">Até ${baseKm} km: ${money(baseFee)} · Após ${baseKm} km: +${money(extraFee)} por km adicional iniciado · Limite de ${maxKm} km.</p>
        <p class="delivery-hint">A distância é estimada pela rua de referência do CEP e pode variar conforme o número da casa. Não é necessário marcar no mapa.</p>
        <div class="delivery-field-grid">
          <div><label for="{prefix}-numero">Número (para entrega) <span class="required-mark">*</span></label>
            <input id="{prefix}-numero" data-field="numero" inputmode="numeric" maxlength="7" placeholder="Nº da casa" value="${esc(form.numero)}" required></div>
          <div><label for="{prefix}-complemento">Complemento</label>
            <input id="{prefix}-complemento" data-field="complemento" maxlength="65" placeholder="Apto / Bloco" value="${esc(form.complemento)}"></div>
        </div>
      </div>
      <label for="{prefix}-payment">Forma de pagamento</label>
      <select id="{prefix}-payment" data-field="payment">${(cfg.business.paymentMethods||['A combinar']).map(x=>`<option value="${esc(x)}" ${x===form.payment?'selected':''}>${esc(x)}</option>`).join('')}</select>
      <label for="{prefix}-notes">Observações gerais (opcional)</label>
      <textarea id="{prefix}-notes" data-field="notes" rows="2" maxlength="300" placeholder="Referência do endereço, instruções de entrega...">${esc(form.notes)}</textarea>
    </form>`:'';
    return `<div class="cart-sticky"><div class="cart-title-row"><h3 class="desktop-cart-title">${cartIcon} Meu carrinho</h3><span class="cart-count">${s.count} ${s.count===1?'item':'itens'}</span></div>
      ${items}${summary}${fields}
      ${cart.length?'<button class="clear-cart" data-clear type="button">Limpar pedido</button>':''}
      ${cart.length?'<p class="checkout-step-hint"><span>1</span> Confira os dados de entrega antes de continuar</p>':''}
      <button class="button button-hot full-button checkout-review-button" type="button" data-checkout ${(cart.length&&acceptingOrders)?'':'disabled'}>${acceptingOrders?'Revisar pedido':'Pedidos temporariamente pausados'} <span>→</span></button>
      <p class="cart-disclaimer">Na próxima etapa você confere os valores e só então abre o WhatsApp. O pedido depende da confirmação da pizzaria.</p></div>`;
  }
  function renderCart() {
    checkoutKey=null;
    const stats = totals();
    $('cart-desktop').innerHTML = renderCartContents().replaceAll('{prefix}', 'desktop');
    $('cart-mobile').innerHTML = renderCartContents().replaceAll('{prefix}', 'mobile');
    $('mobile-count').textContent = $('header-count').textContent = stats.count;
    $('mobile-total').textContent = stats.total!==null ? money(stats.total) : 'Conferir pedido →';
    updateDeliveryLive();
    saveCart();
  }
  function add(item) {
    const normalized=normalizeItem({...item,qty:1});
    if (!normalized) return;
    if(!acceptingOrders){toast('A pizzaria não está recebendo pedidos neste horário.');return;}
    const found = cart.find(c => c.key === normalized.key);
    if (found) found.qty = Math.min(99,found.qty+1);
    else cart.push(normalized);
    renderCart(); toast(normalized.note?'Pizza personalizada adicionada! 🍕':'Adicionada ao pedido! 🍕');
  }
  function openCustomize(item, currentKey=null) {
    customizing={item,currentKey};
    const current = currentKey ? cart.find(c=>c.key===currentKey) : null;
    $('customize-title').textContent=currentKey?'Editar observação':'Personalizar pizza';
    $('customize-product').textContent=formatName(item)+(current?.qty>1?` · ${current.qty} unidades (a observação vale para todas)`: '');
    $('customize-notes').value=current?.note||'';
    $('customize-length').textContent=`${$('customize-notes').value.length}/180`;
    $('save-customize').innerHTML=currentKey?'Salvar observação <span>✓</span>':`Adicionar ao pedido ${cartIcon}`;
    $('customize-suggestions').innerHTML=(cfg.options?.customizationSuggestions||['Trocar mussarela por Catupiry','Sem cebola','Sem azeitonas']).map(note=>`<button class="suggestion" type="button" data-suggestion="${esc(note)}">+ ${esc(note)}</button>`).join('');
    openDialog('customize-modal');
    $('customize-notes').focus();
  }
  function saveCustomization() {
    if (!customizing) return;
    const note=cleanNote($('customize-notes').value);
    const {item,currentKey}=customizing;
    if (currentKey) {
      const index=cart.findIndex(c=>c.key===currentKey);
      if(index<0) {closeDialogs();return;}
      const edited=normalizeItem({...cart[index],note});
      const other=cart.find(c=>c.key===edited.key && c.key!==currentKey);
      if(other) {
        other.qty=Math.min(99,other.qty+edited.qty);
        cart.splice(index,1);
      } else cart[index]=edited;
      renderCart(); toast('Observação salva!');
    } else add({...item,note});
    closeDialogs();
  }
  function quantity(key,step) {
    const idx = cart.findIndex(c => c.key===key);
    if (idx<0) return;
    cart[idx].qty += step;
    if (cart[idx].qty<=0) cart.splice(idx,1);
    else cart[idx].qty = Math.min(99,cart[idx].qty);
    renderCart();
  }
  const whatsapp = msg => `https://wa.me/${String(cfg.business.whatsapp||'').replace(/\D/g,'')}?text=${encodeURIComponent(msg)}`;
  function focusMissing(key) {
    const mobile = window.matchMedia('(max-width:850px)').matches;
    if (mobile) openDialog('cart-drawer');
    const root = mobile ? $('cart-mobile') : $('cart-desktop');
    root.querySelector(`[data-field="${key}"]`)?.focus();
  }
  let checkoutFromDrawer=false;
  let checkoutKey=null,checkoutPending=false;
  // O preço de revisão é apenas referência quando existe personalização.
  function reviewHTML(){
    const stats=totals();
    const baseTotal=!stats.pending&&validPrice(stats.fee)
      ? Math.round((stats.subtotal+stats.fee)*100)/100 : null;
    const hasChanges=stats.customized;
    const list=cart.map(item=>{
      const p=itemPrice(item);
      const photo=item.type==='half' ? byId(item.a)?.image : byId(item.id)?.image;
      const lineTotal=validPrice(p)?money(Math.round(p*item.qty*100)/100):'A confirmar';
      return `<div class="review-product">
        <div class="review-product-photo">${photo?`<img src="${esc(photo)}" alt="" loading="lazy">`:'🍕'}</div>
        <div class="review-product-info">
          <strong>${esc(formatName(item))}</strong>
          <small>${item.qty} ${item.qty===1?'unidade':'unidades'}${item.type==='half'?' · Meio a meio':''}</small>
          ${item.note?`<p class="review-note">✎ ${esc(item.note)}</p>`:''}
        </div>
        <div class="review-product-price">${lineTotal}</div>
      </div>`;
    }).join('');
    const address=[form.address,'nº '+form.numero.trim(),form.complemento.trim(), 'CEP '+form.cep.trim()].filter(Boolean).join(' · ');
    const feeLabel=shipping.status==='ready'&&validPrice(stats.fee)
      ? money(stats.fee)+' <small>(estimado pelo CEP)</small>' : 'A confirmar no WhatsApp';
    const warnings=[
      hasChanges?'As alterações de ingredientes podem gerar acréscimos. O valor exibido é o preço base.':'',
      stats.pending?'Algumas pizzas estão com preço pendente de confirmação.':'',
      shipping.status!=='ready'?'Não foi possível calcular o frete agora. A pizzaria confirmará o valor antes de aceitar o pedido.':''
    ].filter(Boolean);
    return `<div class="review-progress"><span class="review-progress-done">1. Dados preenchidos ✓</span><span class="review-progress-active">2. Conferência final</span></div>
      <section class="review-section" aria-label="Pizzas escolhidas">
        <div class="review-section-heading"><h3>🍕 Suas pizzas</h3><span>${stats.count} ${stats.count===1?'item':'itens'}</span></div>
        <div class="review-products">${list}</div>
      </section>
      <section class="review-section" aria-label="Informações de entrega">
        <div class="review-section-heading"><h3>📍 Entrega</h3><span>Confira o endereço</span></div>
        <div class="review-data-pair"><small>Nome</small><strong>${esc(form.name.trim())}</strong></div>
        <div class="review-data-pair"><small>Celular</small><strong>${esc(form.phone.trim())}</strong></div>
        <div class="review-data-pair"><small>Endereço</small><strong>${esc(address)}</strong></div>
        <div class="review-data-pair"><small>Pagamento</small><strong>${esc(form.payment)}</strong></div>
        ${form.notes.trim()?`<div class="review-data-pair"><small>Observações</small><strong>${esc(form.notes.trim())}</strong></div>`:''}
      </section>
      <section class="review-totals" aria-label="Resumo dos valores">
        <div class="review-amount-line"><span>Subtotal das pizzas</span><strong>${stats.pending?'A confirmar':money(stats.subtotal)}</strong></div>
        <div class="review-amount-line"><span>Frete</span><strong>${feeLabel}</strong></div>
        <div class="review-amount-line review-grand-total">
          <span>${hasChanges?'Total base estimado':'Total estimado'}</span>
          <strong>${baseTotal===null?'A confirmar':money(baseTotal)}</strong>
        </div>
      </section>
      ${warnings.length?`<div class="review-warning" role="note">${warnings.map(w=>`<p>⚠ ${esc(w)}</p>`).join('')}</div>`:''}
      <p class="review-terms">Ao continuar, os dados informados serão registrados no painel da Doppio Pizzas para atendimento (retidos por até 90 dias). O WhatsApp abrirá com a mensagem pronta: você precisará tocar em Enviar. Abrir o WhatsApp não confirma o pedido; a pizzaria validará disponibilidade, frete, valor final e prazo.</p>`;
  }
  function openCheckoutReview(){
    checkoutFromDrawer=!$('cart-drawer').hidden;
    if(!checkoutKey)checkoutKey=crypto.randomUUID();
    $('checkout-review-content').innerHTML=reviewHTML();
    openDialog('checkout-review');
    $('checkout-confirm')?.focus();
  }
  function returnToCart(){
    if(checkoutFromDrawer)openDialog('cart-drawer');
    else closeDialogs();
  }
  function checkout(){
    if(!acceptingOrders)return toast('A pizzaria está fechada ou com pedidos pausados.');
    if(!cart.length)return toast('Adicione uma pizza primeiro.');
    if(form.name.trim().length<2){toast('Informe seu nome.');focusMissing('name');return;}
    if(!/^[1-9][0-9]{9,10}$/.test(phoneDigits())){toast('Informe celular com DDD válido.');focusMissing('phone');return;}
    if(cepDigits().length!==8){toast('Informe um CEP válido.');focusMissing('cep');return;}
    if(!validNumber()){toast('Informe o número da residência.');focusMissing('numero');return;}
    if(!shipping.address||!form.address.trim()){toast('Aguarde a consulta do CEP.');focusMissing('cep');return;}
    if(shipping.status==='outside'){toast('CEP fora da área estimada de entrega. Consulte a pizzaria.');focusMissing('cep');return;}
    if(shipping.status!=='ready' && shipping.status!=='error'){toast('Aguarde o cálculo do frete.');focusMissing('cep');return;}
    openCheckoutReview();
  }
  async function sendOrderWhatsApp(){
    if(checkoutPending)return;
    if(!acceptingOrders)return toast('A pizzaria não está recebendo pedidos neste momento.');
    if($('checkout-review').hidden)return;
    if(!cart.length)return closeDialogs();
    const button=$('checkout-confirm');
    const tab=window.open('about:blank','_blank');
    if(tab){try{tab.document.body.textContent='Preparando sua consulta à Doppio Pizzas...';}catch(_){}}
    checkoutPending=true;button.disabled=true;button.textContent='Registrando solicitação...';
    let reference=null;
    try{
      if(!checkoutKey)checkoutKey=crypto.randomUUID();
      const snapshot={
        clientKey:checkoutKey,name:form.name.trim(),phone:phoneDigits(),cep:cepDigits(),address:form.address.trim(),
        number:form.numero.trim(),complement:form.complemento.trim(),payment:form.payment,
        notes:form.notes.trim(),items:cart.map(i=>i.type==='half'
          ? {type:'half',a:i.a,b:i.b,qty:i.qty,note:i.note||''}
          : {type:'pizza',id:i.id,qty:i.qty,note:i.note||''}),
        shippingFee:shipping.status==='ready'&&validPrice(shipping.quote?.fee)?shipping.quote.fee:null,
        distanceKm:shipping.status==='ready'&&validPrice(shipping.quote?.distanceKm)?shipping.quote.distanceKm:null
      };
      const response=await fetch('/api/order',{method:'POST',credentials:'same-origin',cache:'no-store',
        headers:{'content-type':'application/json'},body:JSON.stringify(snapshot)});
      const result=await response.json();
      if(!response.ok||!result.ok){
        if(response.status===409&&result.code==='closed'){
          if(tab)tab.close();
          toast(result.message||'Pizzaria fechada neste horário.');
          await refreshStoreStatus();return;
        }
        if([400,403,409,422,429].includes(response.status)){
          if(tab)tab.close();
          toast(result.message||'Revise seu pedido e tente novamente.');
          return;
        }
        throw Error(result.message||'Não foi possível registrar o pré-pedido.');
      }
      reference=result.reference;
    }catch(_){
      // Não bloquear o WhatsApp se o registro do painel estiver indisponível.
      toast('O registro no painel não foi concluído. Confirme sua solicitação diretamente pelo WhatsApp.');
    }finally{
      checkoutPending=false;button.disabled=false;button.textContent='Abrir WhatsApp →';
    }
    const stats=totals();
    const when=new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(new Date());
    const baseTotal=!stats.pending&&validPrice(stats.fee)?Math.round((stats.subtotal+stats.fee)*100)/100:null;
    const lines=[
      '🍕 *CONSULTA DE PEDIDO — '+cfg.business.name.toUpperCase()+'*',
      ...(reference?['*Código da solicitação: '+reference+'*']:[]),
      'Preparado em: '+when,'',
      ...cart.flatMap(i=>[
        i.qty+'x '+formatName(i)+' — '+(validPrice(itemPrice(i))
          ?money(Math.round(itemPrice(i)*i.qty*100)/100)+(i.note?' (preço base)':'')
          :'preço a confirmar'),
        ...(i.note?['   ✎ Observação: '+i.note]:[])
      ]),
      '',
      'Subtotal: '+(stats.pending?'a confirmar':money(stats.subtotal)),
      'Distância de referência do CEP: '+(validPrice(stats.km)?displayKm(stats.km)+' km':'a confirmar'),
      'Frete estimado pelo CEP: '+(validPrice(stats.fee)?money(stats.fee):'a confirmar pela pizzaria'),
      'Total '+(stats.customized?'base estimado':'estimado')+': '+(baseTotal===null?'a confirmar':money(baseTotal)),'',
      '*Cliente:* '+form.name.trim(),
      '*Celular:* '+form.phone.trim(),
      '*Endereço:* '+form.address+', nº '+form.numero.trim()+(form.complemento.trim()?', '+form.complemento.trim():'')+' · CEP '+form.cep.trim(),
      '*Pagamento:* '+form.payment,
      '*Observações gerais:* '+(form.notes.trim()||'Nenhuma'), '',
      '_Envie esta mensagem para a Doppio Pizzas confirmar disponibilidade, frete, valor final e prazo antes de aceitar o pedido._'
    ];
    const link=whatsapp(lines.join('\n'));
    if(tab&&!tab.closed)tab.location.href=link;
    else window.location.href=link;
    closeDialogs();
    if(reference)toast('Solicitação '+reference+' registrada! Envie a mensagem no WhatsApp.');
  }
  function closeDialogs() {
    ['overlay','cart-drawer','half-modal','customize-modal','checkout-review'].forEach(id => {
      $(id).hidden = true;
      if ($(id).hasAttribute('aria-hidden')) $(id).setAttribute('aria-hidden','true');
    });
    document.body.classList.remove('modal-open');
    activeTrigger?.focus?.(); activeTrigger=null;
  }
  function openDialog(id) {
    if (!document.body.classList.contains('modal-open')) activeTrigger = document.activeElement;
    ['cart-drawer','half-modal','checkout-review'].forEach(x=>{$(x).hidden=true; $(x).setAttribute('aria-hidden','true');});
    $('overlay').hidden=false; $(id).hidden=false; $(id).setAttribute('aria-hidden','false');
    document.body.classList.add('modal-open'); $(id).querySelector('button')?.focus();
  }
  function populateHalf() {
    const options = products.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
    $('half-one').innerHTML=$('half-two').innerHTML=options;
    $('half-two').selectedIndex=Math.min(1,products.length-1);
    halfPrice();
  }
  function halfPrice() {
    const a=byId($('half-one').value),b=byId($('half-two').value);
    $('half-price').textContent=a&&b&&validPrice(a.price)&&validPrice(b.price)?`Valor da pizza: ${money((a.price+b.price)/2)}`:'Valor da pizza: a confirmar';
  }
  document.addEventListener('click', event => {
    if (event.target.closest('[data-open-half]')) {if(!acceptingOrders)return toast('Pedidos indisponíveis neste horário.');populateHalf();$('half-notes').value='';openDialog('half-modal');return;}
    const addButton=event.target.closest('[data-add]');
    if (addButton) {const id=addButton.dataset.add;if(byId(id))add({type:'pizza',id});return;}
    const custom=event.target.closest('[data-customize]');
    if (custom) {if(!acceptingOrders)return toast('Pedidos indisponíveis neste horário.');const id=custom.dataset.customize;if(byId(id))openCustomize({type:'pizza',id});return;}
    const editNote=event.target.closest('[data-edit-note]');
    if (editNote) {const item=cart.find(i=>i.key===editNote.dataset.editNote);if(item)openCustomize(item,item.key);return;}
    const suggestion=event.target.closest('[data-suggestion]');
    if(suggestion) {const note=$('customize-notes');note.value=[note.value.trim(),suggestion.dataset.suggestion].filter(Boolean).join('; ').slice(0,180);$('customize-length').textContent=`${note.value.length}/180`;note.focus();return;}
    const qty=event.target.closest('[data-qty]');
    if (qty) {quantity(qty.dataset.qty,Number(qty.dataset.step));return;}
    if (event.target.closest('[data-clear]')) {cart=[];renderCart();toast('Pedido esvaziado.');return;}
    if (event.target.closest('[data-calc-frete]')) {calculateShipping();return;}
    if (event.target.closest('[data-checkout]')) {checkout();return;}
    const filterButton=event.target.closest('[data-filter]');
    if (filterButton) {filter=filterButton.dataset.filter;renderProducts();}
  });
  const updateField=event=>{
    const key=event.target.dataset?.field;
    if(!Object.hasOwn(form,key))return;
    form[key]=event.target.value;
    checkoutKey=null;
    if(key==='cep'){
      form.cep=cepDigits().slice(0,8).replace(/^(\d{5})(\d)/,'$1-$2');
      event.target.value=form.cep;
      clearTimeout(lookupTimer);clearTimeout(quoteTimer);
      invalidateQuote();shipping.address=null;form.address='';
      shipping.status='idle';updateDeliveryLive();
      if(cepDigits().length===8)lookupTimer=setTimeout(lookupCep,350);
    }else if(key==='numero'){
      // O número da casa não interfere no cálculo baseado no CEP.
      document.querySelectorAll('[data-field="numero"]').forEach(el=>{
        if(el!==event.target)el.value=form.numero;
      });
    }
  };
  document.addEventListener('input',updateField);
  document.addEventListener('change',event=>{if(event.target.dataset?.field==='payment'){form.payment=event.target.value;checkoutKey=null;}});
  $('header-cart').addEventListener('click',()=>openDialog('cart-drawer'));
  $('mobile-cart-button').addEventListener('click',()=>openDialog('cart-drawer'));
  $('close-drawer').addEventListener('click',closeDialogs);
  $('close-half').addEventListener('click',closeDialogs);
  $('close-customize').addEventListener('click',closeDialogs);
  $('close-checkout-review').addEventListener('click',closeDialogs);
  $('checkout-edit').addEventListener('click',returnToCart);
  $('checkout-confirm').addEventListener('click',sendOrderWhatsApp);
  $('save-customize').addEventListener('click',saveCustomization);
  $('customize-notes').addEventListener('input',()=>{$('customize-length').textContent=`${$('customize-notes').value.length}/180`;});
  $('overlay').addEventListener('click',closeDialogs);
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'){closeDialogs();return;}
    if(e.key!=='Tab'||$('checkout-review').hidden)return;
    const controls=[...$('checkout-review').querySelectorAll('button:not([disabled])')].filter(el=>el.getClientRects().length>0);
    if(!controls.length)return;
    const first=controls[0],last=controls[controls.length-1];
    if(e.shiftKey&&(document.activeElement===first||!$('checkout-review').contains(document.activeElement))){
      e.preventDefault();last.focus();
    }else if(!e.shiftKey&&(document.activeElement===last||!$('checkout-review').contains(document.activeElement))){
      e.preventDefault();first.focus();
    }
  });
  $('half-one').addEventListener('change',halfPrice);
  $('half-two').addEventListener('change',halfPrice);
  $('add-half').addEventListener('click',()=>{
    const a=$('half-one').value,b=$('half-two').value;
    if (!byId(a)||!byId(b)) return;
    if (a===b) {toast('Escolha dois sabores diferentes.');return;}
    const [x,y]=[a,b].sort(); add({type:'half',a:x,b:y,note:cleanNote($('half-notes').value)});closeDialogs();
  });
  const msg=whatsapp(`Olá! Gostaria de informações sobre o cardápio da ${cfg.business.name}.`);
  $('header-wa').href=$('info-wa').href=msg;
  const area = [cfg.business.neighborhood, cfg.business.city].filter(Boolean).join(', ');
  $('hero-location').textContent=area.toLocaleUpperCase('pt-BR').replace(', ', ' · ');
  $('info-location').textContent=area;
  $('info-intro').textContent=`Atendemos a região de ${area}. Confira nossos detalhes antes de pedir.`;
  $('hero-count').textContent=String(products.length).padStart(2,'0');
  $('hero-radius').textContent=`${maxKm} km`;
  $('hero-eta').textContent=`~${cfg.business.etaMinutes||40} min`;
  $('menu-description').textContent=cfg.business.draft?`Conheça nossos ${products.length} sabores iniciais${halfEnabled?' e monte uma pizza meio a meio':''}. Em breve, mais novidades.`:`Escolha nossos ${products.length} sabores${halfEnabled?' ou monte uma pizza meio a meio':''}. Envie seu pedido pelo WhatsApp.`;
  $('year').textContent=new Date().getFullYear();
  $('open-days').textContent=cfg.business.openDays + (cfg.business.openHours?' · '+cfg.business.openHours:' · Horários a confirmar');
  $('delivery-details').textContent=`Até ${maxKm} km · Frete a partir de ${money(baseFee)}`;
  $('payments').textContent=(cfg.business.paymentMethods||[]).join(' · ')||'A confirmar';
  $('draft-note').hidden=!cfg.business.draft;
  if (cfg.options?.halfHalfEnabled===false || products.length<2) $('meio-a-meio').hidden=true;
  const allPricesReady=products.every(p=>validPrice(p.price));
  function updateStoreBanner(){
    $('menu-note').textContent=!acceptingOrders
      ? (storeStatus==='closed'?'Fechado neste horário':'Pedidos temporariamente pausados')
      :storeStatus==='open'?'Aberto agora · pedidos disponíveis'
      :allPricesReady?'Preços definidos · frete estimado pelo CEP':'Preços das pizzas a confirmar · frete automático pelo CEP';
    let notice=document.querySelector('.store-paused-banner');
    if(acceptingOrders){notice?.remove();return;}
    if(!notice){
      notice=document.createElement('p');
      notice.className='store-paused-banner';
      notice.setAttribute('role','status');
      document.querySelector('.menu-toolbar').after(notice);
    }
    notice.textContent=storeStatus==='closed'
      ? '🍕 Estamos fechados neste horário. '+(nextOpening?'Próxima abertura: '+nextOpening+'. ':'')+'O cardápio pode ser consultado normalmente.'
      :'🍕 Os pedidos estão temporariamente pausados. Você pode consultar o cardápio e voltar mais tarde.';
  }
  async function refreshStoreStatus(){
    try{
      const response=await fetch('/api/store-status',{cache:'no-store'});
      if(!response.ok)throw new Error('status unavailable');
      const info=await response.json();
      if(!info.ok||typeof info.acceptingOrders!=='boolean')throw new Error('invalid store status');
      const changed=info.acceptingOrders!==acceptingOrders;
      acceptingOrders=info.acceptingOrders;
      storeStatus=info.status||'manual';
      nextOpening=info.nextOpening||null;
      if(changed){renderProducts();renderCart();}
      updateStoreBanner();
    }catch(_){
      // Em falha da consulta com horário automático, bloquear novos pedidos por segurança.
      if(cfg.business?.scheduleEnabled&&acceptingOrders){
        acceptingOrders=false;storeStatus='paused';nextOpening=null;
        renderProducts();renderCart();updateStoreBanner();
      }
    }
  }
  updateStoreBanner();
  if(allPricesReady&&cfg.business.draft)$('draft-note').textContent='Cardápio em preparação · Frete estimado pelo CEP e pedidos sujeitos à confirmação pelo WhatsApp.';
  renderProducts(); renderCart();
  window.setInterval(()=>{if(!document.hidden)refreshStoreStatus();},60000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshStoreStatus();});
})();
