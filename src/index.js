/*
 * Doppio Pizzas — cálculo de frete no Cloudflare Worker.
 * Segredo ORS_API_KEY: somente no Cloudflare, jamais no GitHub.
 * Distância de percurso viário, não raio em linha reta.
 */
const ORS = 'https://api.heigit.org';
const SHOP = 'Rua Firmino Morgado, 60, Jardim Brasília, São Paulo, SP, Brasil';
// Coordenadas da pizzaria confirmadas por marcador do Google Maps: [longitude, latitude]
const SHOP_COORDS = [-46.4938778,-23.5532045];
const MAX_KM = 10;
const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: {'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}
});
const normalize = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\b(rua|av|avenida|travessa|numero|n|do|da|de|dos|das)\b/g,' ').replace(/\s+/g,' ').trim();
const validCoord = point => Array.isArray(point) && point.length===2 && point.every(Number.isFinite) && point[0]>-48 && point[0]<-45 && point[1]>-25 && point[1]<-22;
const siteError = (code, message, status=400, details={}) => json({ok:false,code,message,...details},status);
async function getJSON(uri,options={},ms=9500) {
  const res=await fetch(uri,{...options,signal:AbortSignal.timeout(ms),headers:{accept:'application/json',...(options.headers||{})}});
  let data;try{data=await res.json()}catch(_){data=null}
  if (!res.ok) {
    const e=new Error('upstream '+res.status);
    e.status=res.status;
    throw e;
  }
  return data;
}
async function cepLookup(cep) {
  const result=await getJSON('https://viacep.com.br/ws/'+cep+'/json/',{},6500);
  if (!result || result.erro || !result.logradouro || !result.localidade || !result.uf) return null;
  return {cep,street:result.logradouro,neighborhood:result.bairro||'',city:result.localidade,state:result.uf};
}
function geocodeInfo(feature,street,number) {
  const p=feature.properties||{};
  const coord=feature.geometry?.coordinates;
  if(!validCoord(coord))return null;
  const searched=normalize(street);
  const found=normalize(p.street || p.name || '');
  const label=normalize(p.label);
  const words=searched.split(' ').filter(x=>x.length>2);
  const similarity=words.length && words.every(x=>found.includes(x) || label.includes(x));
  if(!similarity)return null;
  const n=String(p.housenumber||'').trim();
  const sameNumber=n===String(number);
  const fullAddress=p.layer==='address' && sameNumber;
  return {point:coord,quality:fullAddress?'number':'street',label:p.label||'',layer:p.layer||'',housenumber:n,confidence:typeof p.confidence==='number'?p.confidence:null};
}
async function geocodeAddress(apiKey,street,number,neighborhood,city,state) {
  const queries=[
    [street+' '+number,neighborhood,city,state,'Brasil'].filter(Boolean).join(', '),
    [street,neighborhood,city,state,'Brasil'].filter(Boolean).join(', '),
    [street,city,state,'Brasil'].filter(Boolean).join(', ')
  ];
  const matches=[];
  for(const text of queries){
    const url=new URL(ORS+'/pelias/v1/search');
    url.searchParams.set('text',text);
    url.searchParams.set('size','8');
    url.searchParams.set('boundary.country','BRA');
    url.searchParams.set('focus.point.lat',String(SHOP_COORDS[1]));
    url.searchParams.set('focus.point.lon',String(SHOP_COORDS[0]));
    const data=await getJSON(url.toString(),{headers:{Authorization:apiKey}},9500);
    matches.push(...(data.features||[]).map(f=>geocodeInfo(f,street,number)).filter(Boolean));
    if(matches.some(m=>m.quality==='number'))break;
  }
  const nearby=matches.filter(x=>haversine(SHOP_COORDS,x.point)<25);
  nearby.sort((a,b)=>(b.quality==='number')-(a.quality==='number') || (b.confidence||0)-(a.confidence||0));
  return nearby[0]||null;
}
function haversine(a,b) {
  const toRad=x=>x*Math.PI/180;
  const dlat=toRad(b[1]-a[1]),dlon=toRad(b[0]-a[0]);
  const h=Math.sin(dlat/2)**2+Math.cos(toRad(a[1]))*Math.cos(toRad(b[1]))*Math.sin(dlon/2)**2;
  return 12742*Math.asin(Math.min(1,Math.sqrt(h)));
}
async function route(apiKey,origin,dest) {
  const response=await getJSON(ORS+'/openrouteservice/v2/directions/driving-car/json',{
    method:'POST',
    headers:{Authorization:apiKey,'content-type':'application/json'},
    body:JSON.stringify({coordinates:[origin,dest],instructions:false,geometry:false})
  },11000);
  const meters=response.routes?.[0]?.summary?.distance;
  if(!Number.isFinite(meters) || meters<0)throw new Error('route_malformed');
  return meters;
}
async function antiAbuse(request,url) {
  const origin=request.headers.get('origin');
  if(origin && origin!==url.origin)return false;
  const ip=request.headers.get('cf-connecting-ip');
  if(!ip)return true;
  try {
    const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(ip));
    const sig=Array.from(new Uint8Array(bytes)).slice(0,10).map(b=>b.toString(16).padStart(2,'0')).join('');
    const cacheKey=new Request(url.origin+'/__ors_rate_'+sig);
    const existing=await caches.default.match(cacheKey);
    if(existing)return false;
    await caches.default.put(cacheKey,new Response('1',{headers:{'cache-control':'public, max-age=4'}}));
  } catch(_){/* não interromper pedidos por indisponibilidade transitória do cache */}
  return true;
}
async function frete(request,env,url) {
  if(!env.ORS_API_KEY)return siteError('unconfigured','Serviço de rotas em configuração.',503);
  if(!await antiAbuse(request,url))return siteError('rate_limit','Aguarde alguns segundos antes de recalcular.',429);
  const size=Number(request.headers.get('content-length')||0);
  if(size>900)return siteError('payload','Dados de endereço excessivos.',413);
  let input;
  try {input=await request.json()}catch(_){return siteError('json','Dados inválidos.')}
  const cep=String(input?.cep||'').replace(/\D/g,'');
  const number=String(input?.numero||'').trim();
  if(!/^\d{8}$/.test(cep) || !/^[0-9]{1,6}[a-zA-Z]?$/.test(number))return siteError('invalid_address','Informe um CEP válido e o número da residência.');
  const pin=input?.pin;
  if(pin!=null&&!validCoord(pin))return siteError('invalid_pin','Ponto do mapa inválido.');
  try {
    let stage='cep';
    const address=await cepLookup(cep);
    if(!address)return siteError('cep_not_found','CEP não localizado. Confira os números.',422);
    if(address.state!=='SP')return siteError('outside_state','Endereço fora da área de entrega.',422);
    const originPoint=SHOP_COORDS;
    if(!validCoord(originPoint))return siteError('origin_setup','Confirme o ponto exato de saída da pizzaria para ativar frete automático.',503);
    stage='destination';
    let destination,precision='pin_confirmado';
    if(pin){
      if(haversine(originPoint,pin)>MAX_KM+4)return siteError('outside_area','Ponto fora da região de entrega.',422,{address});
      destination=pin;
    }else{
      const candidate=await geocodeAddress(env.ORS_API_KEY,address.street,number,address.neighborhood,address.city,address.state);
      if(!candidate || candidate.quality!=='number'){
        return siteError('confirm_pin','Número não localizado com precisão. Confirme o ponto de entrega no mapa.',409,{
          address,near:candidate?{lon:candidate.point[0],lat:candidate.point[1]}:{lon:SHOP_COORDS[0],lat:SHOP_COORDS[1]},
          label:candidate?.label||address.street
        });
      }
      destination=candidate.point;
      precision='numero_localizado';
    }
    if(haversine(originPoint,destination)>MAX_KM+2){
      return siteError('outside_area','Endereço fora da área de entrega de até 10 km.',422,{address});
    }
    stage='route';
    const meters=await route(env.ORS_API_KEY,originPoint,destination);
    const km=meters/1000;
    if(km>MAX_KM+1e-6)return siteError('outside_area','Endereço fora da área de entrega de até 10 km.',422,{address,distanceKm:Math.round(km*100)/100});
    const fee=5+Math.max(0,Math.ceil(km-5-1e-9));
    return json({ok:true,address,distanceMeters:Math.round(meters),distanceKm:Math.round(km*100)/100,fee,precision,origin:'Rua Firmino Morgado, 60',routeMode:'driving-car'});
  } catch(e) {
    if(e.status===403 || e.status===401)return siteError('provider_access','O serviço de rotas recusou a chave. Confira o plano e a ativação da API.',503);
    return siteError('provider_unavailable_'+stage,'Não foi possível consultar o serviço de '+stage+' agora.',503,{upstreamStatus:typeof e.status==='number'?e.status:null});
  }
}
export default {
  async fetch(request,env) {
    const url=new URL(request.url);
    if(url.pathname==='/api/status'){
      return json({service:'doppio-frete',configured:Boolean(env.ORS_API_KEY)});
    }
    if(url.pathname==='/api/cep'){
      if(request.method!=='GET')return siteError('method','Use GET.',405);
      const cep=String(url.searchParams.get('cep')||'').replace(/\D/g,'');
      if(!/^\d{8}$/.test(cep))return siteError('invalid_cep','Digite um CEP com oito números.');
      try {
        const address=await cepLookup(cep);
        return address?json({ok:true,address}):siteError('cep_not_found','CEP não localizado.',422);
      }catch(_){return siteError('cep_unavailable','Não foi possível consultar o CEP agora.',503)}
    }
    if(url.pathname==='/api/frete'){
      if(request.method!=='POST')return siteError('method','Use POST.',405);
      return frete(request,env,url);
    }
    if(url.pathname.startsWith('/api/'))return siteError('not_found','Rota não encontrada.',404);
    return env.ASSETS.fetch(request);
  }
};
