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
  const byId = id => products.find(p => p.id === id);
  const formatPrice = n => validPrice(n) ? money(n) : 'A confirmar';
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
  const form={name:'',cep:'',numero:'',complemento:'',address:'',payment:(cfg.business.paymentMethods||[])[0]||'A combinar',notes:''};
  const maxKm=Number(cfg.delivery?.radiusKm)||10;
  const baseKm=Number(cfg.delivery?.includedKm)||5;
  const baseFee=Number(cfg.delivery?.minFee)||5;
  const extraFee=Number(cfg.delivery?.extraKmFee)||1;
  const displayKm=n=>new Intl.NumberFormat('pt-BR',{maximumFractionDigits:2}).format(n);
  const shipping={status:'idle',address:null,quote:null,pin:null,near:null,message:'',requestId:0};
  let lookupTimer=null, quoteTimer=null;
  const validNumber=()=>/^[0-9]{1,6}[a-zA-Z]?$/.test(form.numero.trim());
  const cepDigits=()=>form.cep.replace(/\D/g,'');
  const invalidateQuote=()=>{
    shipping.quote=null;shipping.pin=null;shipping.near=null;shipping.message='';
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
      <div class="pizza-bottom"><span class="price price-pending">Valor conforme os sabores</span><button class="add-button half-card-button" data-open-half type="button">½ Escolher sabores</button></div>
      <p class="half-card-caption">Preço pela média dos sabores, sujeito à confirmação.</p></div></article>` : '';
    $('products').innerHTML = displayed.map(p => `<article class="pizza-card">
      <div class="pizza-image"><img src="${esc(p.image)}" alt="Pizza de ${esc(p.name)}" loading="lazy" decoding="async" width="560" height="390"><span class="pizza-tag">${esc(p.tag||p.category||'Sabor')}</span></div>
      <div class="pizza-body"><span class="pizza-category">${esc(p.category||'Outros')}</span><h3>${esc(p.name)}</h3>
      <p class="pizza-ingredients-line" aria-label="Ingredientes: ${esc(Array.isArray(p.ingredients)?p.ingredients.join(', '):p.description)}">${Array.isArray(p.ingredients)&&p.ingredients.length?p.ingredients.map(esc).join(' · '):esc(p.description)}</p>
      <div class="pizza-bottom"><span class="price ${validPrice(p.price)?'':'price-pending'}">${validPrice(p.price)?money(p.price):'Preço a confirmar'}</span><button class="add-button" data-add="${esc(p.id)}" type="button" aria-label="Adicionar ${esc(p.name)} ao carrinho">${cartIcon} Adicionar</button></div><button type="button" class="customize-link" data-customize="${esc(p.id)}">✎ Personalizar / trocar ingrediente</button></div></article>`).join('') + halfCard || '<p>Novos sabores em breve.</p>';
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
    if(shipping.status==='ready')return 'Rota calculada: '+displayKm(shipping.quote.distanceKm)+' km · Frete '+money(shipping.quote.fee)+' (até '+maxKm+' km).';
    if(shipping.status==='loading-cep')return 'Buscando endereço do CEP...';
    if(shipping.status==='calculating')return 'Calculando rota pelas ruas...';
    if(shipping.status==='map-required')return shipping.message||'Confirme a entrada da casa no mapa para calcular com precisão.';
    if(shipping.status==='outside')return 'Fora da área de entrega de até '+maxKm+' km.';
    if(shipping.status==='error')return shipping.message||'Não foi possível calcular o frete. Tente novamente.';
    if(!shipping.address)return 'Digite seu CEP para preencher a rua automaticamente.';
    if(!validNumber())return 'Agora informe o número da residência.';
    return 'Calcule o frete automaticamente com CEP e número.';
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
        ? 'Frete calculado pela rota. Os preços das pizzas e as alterações continuam sujeitos à confirmação.'
        : 'O frete será calculado pela rota das ruas antes do envio do pedido.';
    });
    document.querySelectorAll('[data-delivery-fee]').forEach(el=>{el.textContent=shipping.status==='outside'?'Fora da área':validPrice(t.fee)?money(t.fee):'A calcular';});
    document.querySelectorAll('[data-delivery-label]').forEach(el=>{el.textContent=validPrice(t.fee)?'Frete calculado':'Taxa de entrega';});
    document.querySelectorAll('[data-order-total]').forEach(el=>{el.textContent=t.total===null?'A confirmar':money(t.total);});
    document.querySelectorAll('[data-map-confirm]').forEach(el=>{el.hidden=shipping.status!=='map-required';});
    document.querySelectorAll('[data-calc-frete]').forEach(el=>{
      el.disabled=!shipping.address||!validNumber()||shipping.status==='calculating';
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
      shipping.status='waiting-number';updateDeliveryLive();
      if(validNumber())scheduleQuote(350);
    }catch(error){
      if(requestId!==shipping.requestId)return;
      shipping.address=null;form.address='';
      shipping.status='error';shipping.message=error.message||'Não foi possível consultar CEP.';updateDeliveryLive();
    }
  }
  async function calculateShipping(pin=null){
    clearTimeout(quoteTimer);
    const cep=cepDigits();const numero=form.numero.trim();
    if(cep.length!==8||!validNumber()||!shipping.address){
      toast('Preencha um CEP válido e o número da residência.');return;
    }
    const requestId=++shipping.requestId;shipping.status='calculating';shipping.quote=null;shipping.message='';
    updateDeliveryLive();
    try{
      const response=await fetch('/api/frete',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({cep,numero,...(pin?{pin}:{})})});
      const data=await response.json();
      if(requestId!==shipping.requestId)return;
      if(response.status===409&&data.code==='confirm_pin'){
        shipping.near=data.near||null;shipping.message=data.message;shipping.status='map-required';updateDeliveryLive();return;
      }
      if(!response.ok||!data.ok){
        shipping.message=data.message||'Não foi possível calcular a rota.';
        shipping.status=data.code==='outside_area'||data.code==='outside_state'?'outside':'error';
        updateDeliveryLive();return;
      }
      if(!Number.isFinite(data.fee)||!Number.isFinite(data.distanceKm))throw new Error('Resposta de distância inválida.');
      shipping.status='ready';shipping.quote=data;shipping.pin=pin;updateDeliveryLive();
    }catch(error){
      if(requestId!==shipping.requestId)return;
      shipping.status='error';shipping.message=error.message||'Falha de conexão ao calcular o frete.';updateDeliveryLive();
    }
  }
  function scheduleQuote(delay=750){
    clearTimeout(quoteTimer);
    if(!shipping.address||!validNumber())return;
    quoteTimer=setTimeout(()=>calculateShipping(),delay);
  }
  function openAddressMap(){
    if(!shipping.address||!validNumber())return toast('Informe o CEP e número antes de marcar no mapa.');
    if(!window.DOPPIO_MAP)return toast('Mapa indisponível. Atualize a página e tente novamente.');
    const center=shipping.near||{lat:-23.5532045,lon:-46.4938778};
    window.DOPPIO_MAP.show({lat:center.lat,lon:center.lon,onConfirm:coords=>calculateShipping(coords)});
  }
  function renderCartContents() {
    const s = totals();
    const items = cart.length ? `<div class="cart-items">${cart.map(i => `<div class="cart-item"><div class="cart-item-main"><div class="cart-item-name">${esc(formatName(i))}</div><div class="cart-item-price">${formatPrice(itemPrice(i))}${i.note?' · valor com alterações a confirmar':''}</div>${i.note?`<p class="item-note"><b>Obs.:</b> ${esc(i.note)}</p>`:''}<button class="edit-item-note" data-edit-note="${esc(i.key)}" type="button">✎ ${i.note?'Editar observação':'Adicionar observação'}</button></div><div class="qty-controls"><button type="button" data-qty="${esc(i.key)}" data-step="-1" aria-label="Diminuir quantidade de ${esc(formatName(i))}">−</button><span>${i.qty}</span><button type="button" data-qty="${esc(i.key)}" data-step="1" aria-label="Aumentar quantidade de ${esc(formatName(i))}">+</button></div></div>`).join('')}</div>`
      : '<div class="cart-empty"><span class="cart-empty-icon">🍕</span><b>Seu pedido começa aqui.</b><p>Escolha uma pizza e monte seu pedido.</p></div>';
    const summary=cart.length?`<div class="cart-line"></div>
      <div class="summary-row"><span>${s.pending?'Parcial dos sabores com preço':s.customized?'Subtotal base estimado':'Subtotal'}</span><strong>${s.pending&&!s.subtotal?'A confirmar':money(s.subtotal)}</strong></div>
      <div class="summary-row"><span data-delivery-label>${validPrice(s.fee)?'Frete calculado':'Taxa de entrega'}</span><strong data-delivery-fee>${s.outOfArea?'Fora da área':validPrice(s.fee)?money(s.fee):'A calcular'}</strong></div>
      <div class="summary-row summary-total"><span>Total estimado</span><strong data-order-total>${s.total===null?'A confirmar':money(s.total)}</strong></div>
      <div class="cart-pending" data-delivery-pending>${shipping.status==='ready'?'Frete calculado pela rota. Preços das pizzas e alterações ainda precisam de confirmação.':'O frete será calculado pela rota das ruas antes do envio do pedido.'}</div>`:'';
    const fields=cart.length?`<form class="order-form" onsubmit="return false">
      <label for="{prefix}-name">Seu nome <span class="required-mark">*</span></label>
      <input id="{prefix}-name" data-field="name" autocomplete="name" maxlength="70" placeholder="Como podemos chamar você?" value="${esc(form.name)}" required>
      <div class="delivery-calculator">
        <strong class="delivery-title">Frete automático por endereço</strong>
        <label for="{prefix}-cep">CEP de entrega <span class="required-mark">*</span></label>
        <input id="{prefix}-cep" data-field="cep" inputmode="numeric" autocomplete="postal-code" maxlength="9" placeholder="00000-000" value="${esc(form.cep)}" required>
        <p class="delivery-address-result" data-delivery-address>${esc(form.address||'O endereço será preenchido após a consulta do CEP.')}</p>
        <div class="delivery-field-grid">
          <div><label for="{prefix}-numero">Número <span class="required-mark">*</span></label>
            <input id="{prefix}-numero" data-field="numero" inputmode="numeric" maxlength="7" placeholder="Nº da casa" value="${esc(form.numero)}" required></div>
          <div><label for="{prefix}-complemento">Complemento</label>
            <input id="{prefix}-complemento" data-field="complemento" maxlength="65" placeholder="Apto / Bloco" value="${esc(form.complemento)}"></div>
        </div>
        <button type="button" data-calc-frete class="delivery-calc-button">Calcular frete</button>
        <button type="button" data-map-confirm class="delivery-map-button" ${shipping.status==='map-required'?'':'hidden'}>📍 Confirmar entrada no mapa</button>
        <p class="delivery-rule">Até ${baseKm} km: ${money(baseFee)} · Depois: +${money(extraFee)} por km iniciado · Máximo de ${maxKm} km.</p>
        <p class="delivery-estimate ${shipping.status==='outside'||shipping.status==='error'?'delivery-warning':''}" data-delivery-preview aria-live="polite">${esc(shippingPreview())}</p>
        <p class="delivery-hint">Distância calculada pelas ruas. Quando o número não é encontrado, confirme a entrada no mapa.</p>
      </div>
      <label for="{prefix}-payment">Forma de pagamento</label>
      <select id="{prefix}-payment" data-field="payment">${(cfg.business.paymentMethods||['A combinar']).map(x=>`<option value="${esc(x)}" ${x===form.payment?'selected':''}>${esc(x)}</option>`).join('')}</select>
      <label for="{prefix}-notes">Observações gerais (opcional)</label>
      <textarea id="{prefix}-notes" data-field="notes" rows="2" maxlength="300" placeholder="Referência do endereço, instruções de entrega...">${esc(form.notes)}</textarea>
    </form>`:'';
    return `<div class="cart-sticky"><div class="cart-title-row"><h3 class="desktop-cart-title">${cartIcon} Meu carrinho</h3><span class="cart-count">${s.count} ${s.count===1?'item':'itens'}</span></div>
      ${items}${summary}${fields}
      ${cart.length?'<button class="clear-cart" data-clear type="button">Limpar pedido</button>':''}
      <button class="button button-hot full-button" type="button" data-checkout ${cart.length?'':'disabled'}>Enviar para confirmar no WhatsApp <span>↗</span></button>
      <p class="cart-disclaimer">* O envio abre o WhatsApp e não conclui a compra. Preços, prazo, entrega e disponibilidade precisam ser confirmados pela pizzaria.</p></div>`;
  }
  function renderCart() {
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
  function checkout() {
    if (!cart.length) return toast('Adicione uma pizza primeiro.');
    if (form.name.trim().length<2) { toast('Informe seu nome para continuar.'); focusMissing('name'); return; }
    if(cepDigits().length!==8){toast('Informe o CEP para calcular o frete.');focusMissing('cep');return;}
    if(!validNumber()){toast('Informe o número da residência.');focusMissing('numero');return;}
    if(!form.address||!shipping.address){toast('Aguarde a consulta do CEP.');focusMissing('cep');return;}
    const s=totals();
    if(shipping.status!=='ready'||!shipping.quote){
      toast(shipping.status==='map-required'?'Confirme a entrada no mapa para calcular o frete.':'Calcule o frete antes de enviar o pedido.');
      focusMissing('numero');return;
    }
    const when = new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(new Date());
    const lines = [
      `🍕 *CONSULTA DE PEDIDO — ${cfg.business.name.toUpperCase()}*`,
      `Enviado em: ${when}`,'',
      ...cart.flatMap(i => [`${i.qty}x ${formatName(i)} — ${validPrice(itemPrice(i)) ? money(itemPrice(i)*i.qty) + (i.note?' (preço base; alterações a confirmar)':'') : 'preço a confirmar'}`, ...(i.note?[`   ✎ Observação desta pizza: ${i.note}`]:[])]),
      '', `Subtotal base: ${s.pending?'a confirmar':money(s.subtotal)}`,
      `Distância pela rota: ${displayKm(s.km)} km (OpenRouteService)`,
      `Frete calculado: ${money(s.fee)}`,
      `Total: ${s.total===null?'a confirmar':money(s.total)}`,'',
      `*Cliente:* ${form.name.trim()}`,
      `*Endereço:* ${form.address}, nº ${form.numero.trim()}${form.complemento.trim()?', '+form.complemento.trim():''} · CEP ${form.cep.trim()}`,
      ...(shipping.quote.destination?[`*Mapa de entrega:* https://www.openstreetmap.org/?mlat=${shipping.quote.destination.lat}&mlon=${shipping.quote.destination.lon}#map=18/${shipping.quote.destination.lat}/${shipping.quote.destination.lon}`]:[]),
      `*Pagamento:* ${form.payment}`,
      `*Observações gerais:* ${form.notes.trim()||'Nenhuma'}`,'',
      '_🍕 A Doppio Pizzas confirmará os valores, o frete, a disponibilidade e as alterações de ingredientes antes de finalizar o pedido._'
    ];
    window.open(whatsapp(lines.join('\n')), '_blank', 'noopener,noreferrer');
  }
  function closeDialogs() {
    ['overlay','cart-drawer','half-modal','customize-modal'].forEach(id => {
      $(id).hidden = true;
      if ($(id).hasAttribute('aria-hidden')) $(id).setAttribute('aria-hidden','true');
    });
    document.body.classList.remove('modal-open');
    activeTrigger?.focus?.(); activeTrigger=null;
  }
  function openDialog(id) {
    if (!document.body.classList.contains('modal-open')) activeTrigger = document.activeElement;
    ['cart-drawer','half-modal'].forEach(x=>{$(x).hidden=true; $(x).setAttribute('aria-hidden','true');});
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
    if (event.target.closest('[data-open-half]')) {populateHalf();$('half-notes').value='';openDialog('half-modal');return;}
    const addButton=event.target.closest('[data-add]');
    if (addButton) {const id=addButton.dataset.add;if(byId(id))add({type:'pizza',id});return;}
    const custom=event.target.closest('[data-customize]');
    if (custom) {const id=custom.dataset.customize;if(byId(id))openCustomize({type:'pizza',id});return;}
    const editNote=event.target.closest('[data-edit-note]');
    if (editNote) {const item=cart.find(i=>i.key===editNote.dataset.editNote);if(item)openCustomize(item,item.key);return;}
    const suggestion=event.target.closest('[data-suggestion]');
    if(suggestion) {const note=$('customize-notes');note.value=[note.value.trim(),suggestion.dataset.suggestion].filter(Boolean).join('; ').slice(0,180);$('customize-length').textContent=`${note.value.length}/180`;note.focus();return;}
    const qty=event.target.closest('[data-qty]');
    if (qty) {quantity(qty.dataset.qty,Number(qty.dataset.step));return;}
    if (event.target.closest('[data-clear]')) {cart=[];renderCart();toast('Pedido esvaziado.');return;}
    if (event.target.closest('[data-calc-frete]')) {calculateShipping();return;}
    if (event.target.closest('[data-map-confirm]')) {openAddressMap();return;}
    if (event.target.closest('[data-checkout]')) {checkout();return;}
    const filterButton=event.target.closest('[data-filter]');
    if (filterButton) {filter=filterButton.dataset.filter;renderProducts();}
  });
  const updateField=event=>{
    const key=event.target.dataset?.field;
    if(!Object.hasOwn(form,key))return;
    form[key]=event.target.value;
    if(key==='cep'){
      form.cep=cepDigits().slice(0,8).replace(/^(\d{5})(\d)/,'$1-$2');
      event.target.value=form.cep;
      clearTimeout(lookupTimer);clearTimeout(quoteTimer);
      invalidateQuote();shipping.address=null;form.address='';
      shipping.status='idle';updateDeliveryLive();
      if(cepDigits().length===8)lookupTimer=setTimeout(lookupCep,350);
    }else if(key==='numero'){
      clearTimeout(quoteTimer);
      if(shipping.status==='loading-cep'){shipping.quote=null;updateDeliveryLive();return;}
      invalidateQuote();
      shipping.status=shipping.address?'waiting-number':'idle';updateDeliveryLive();
      if(shipping.address&&validNumber())scheduleQuote();
    }
  };
  document.addEventListener('input',updateField);
  document.addEventListener('change',event=>{if(event.target.dataset?.field==='payment')form.payment=event.target.value;});
  $('header-cart').addEventListener('click',()=>openDialog('cart-drawer'));
  $('mobile-cart-button').addEventListener('click',()=>openDialog('cart-drawer'));
  $('close-drawer').addEventListener('click',closeDialogs);
  $('close-half').addEventListener('click',closeDialogs);
  $('close-customize').addEventListener('click',closeDialogs);
  $('save-customize').addEventListener('click',saveCustomization);
  $('customize-notes').addEventListener('input',()=>{$('customize-length').textContent=`${$('customize-notes').value.length}/180`;});
  $('overlay').addEventListener('click',closeDialogs);
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closeDialogs();});
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
  $('hero-radius').textContent=`${cfg.delivery?.radiusKm||15} km`;
  $('hero-eta').textContent=`~${cfg.business.etaMinutes||40} min`;
  $('menu-description').textContent=cfg.business.draft?`Conheça nossos ${products.length} sabores iniciais${halfEnabled?' e monte uma pizza meio a meio':''}. Em breve, mais novidades.`:`Escolha nossos ${products.length} sabores${halfEnabled?' ou monte uma pizza meio a meio':''}. Envie seu pedido pelo WhatsApp.`;
  $('year').textContent=new Date().getFullYear();
  $('open-days').textContent=cfg.business.openDays + (cfg.business.openHours?' · '+cfg.business.openHours:' · Horários a confirmar');
  $('delivery-details').textContent=`Até ${maxKm} km · Frete a partir de ${money(baseFee)}`;
  $('payments').textContent=(cfg.business.paymentMethods||[]).join(' · ')||'A confirmar';
  $('draft-note').hidden=!cfg.business.draft;
  if (cfg.options?.halfHalfEnabled===false || products.length<2) $('meio-a-meio').hidden=true;
  const allPricesReady=products.every(p=>validPrice(p.price));
  if (allPricesReady) $('menu-note').textContent='Preços informados · frete calculado pela distância estimada';
  renderProducts(); renderCart();
})();
