/* Doppio: mapa apenas quando confirmação manual do número for necessária. */
(()=>{
 'use strict';
 let activeMap=null, pinMarker=null, onConfirm=null;
 const loadLeaflet=()=>{
   if(window.L)return Promise.resolve(window.L);
   if(window.__doppioLeafletPromise)return window.__doppioLeafletPromise;
   const css=document.createElement('link');css.rel='stylesheet';
   css.href='https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';document.head.appendChild(css);
   window.__doppioLeafletPromise=new Promise((resolve,reject)=>{
     const script=document.createElement('script');
     script.src='https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
     script.onload=()=>window.L?resolve(window.L):reject(new Error('Mapa indisponível'));
     script.onerror=()=>reject(new Error('Falha ao carregar mapa'));document.head.appendChild(script);
   });
   return window.__doppioLeafletPromise;
 };
 const overlay=()=>{
   let root=document.getElementById('doppio-map-overlay');
   if(root)return root;
   root=document.createElement('div');root.id='doppio-map-overlay';root.hidden=true;
   root.innerHTML='<div class="doppio-map-window" role="dialog" aria-modal="true" aria-label="Confirmar endereço de entrega">'+
      '<div class="doppio-map-heading"><div><strong>Marque a entrada da sua casa</strong><p>Arraste o marcador até o local exato da entrega para calcular o frete pelas ruas.</p></div>'+
      '<button type="button" class="doppio-map-close" aria-label="Fechar mapa">×</button></div>'+
      '<div id="doppio-map-canvas" aria-label="Mapa para selecionar a localização"></div>'+
      '<div class="doppio-map-bottom"><span id="doppio-map-status">Toque no mapa ou arraste o marcador.</span>'+
      '<div class="doppio-map-buttons"><button type="button" id="doppio-map-gps">Usar minha localização</button>'+
      '<button type="button" class="doppio-map-primary" id="doppio-map-apply">Confirmar ponto</button></div></div></div>';
   document.body.appendChild(root);
   root.querySelector('.doppio-map-close').addEventListener('click',close);
   root.addEventListener('click',event=>{if(event.target===root)close()});
   root.querySelector('#doppio-map-apply').addEventListener('click',()=>{
     if(!pinMarker)return;
     const loc=pinMarker.getLatLng(),cb=onConfirm;
     close();
     if(typeof cb==='function')cb([loc.lng,loc.lat]);
   });
   root.querySelector('#doppio-map-gps').addEventListener('click',()=>{
     const status=root.querySelector('#doppio-map-status');
     if(!navigator.geolocation){status.textContent='Localização indisponível neste navegador.';return;}
     status.textContent='Obtendo localização com sua permissão...';
     navigator.geolocation.getCurrentPosition(pos=>{
       const loc=[pos.coords.latitude,pos.coords.longitude];
       if(activeMap&&pinMarker){pinMarker.setLatLng(loc);activeMap.setView(loc,17);}
       status.textContent='Confira o marcador e confirme o ponto.';
     },()=>{status.textContent='Não foi possível usar o GPS. Posicione o marcador manualmente.';},
     {enableHighAccuracy:true,timeout:12000,maximumAge:0});
   });
   return root;
 };
 const close=()=>{
   const root=document.getElementById('doppio-map-overlay');
   if(root)root.hidden=true;
   if(activeMap){activeMap.remove();activeMap=null;pinMarker=null;}
   document.body.classList.remove('doppio-map-open');
 };
 async function show({lat=-23.5532045,lon=-46.4938778,onConfirm:confirmCallback}={}){
   onConfirm=confirmCallback;
   const root=overlay();
   root.hidden=false;document.body.classList.add('doppio-map-open');
   root.querySelector('#doppio-map-status').textContent='Carregando mapa...';
   try{
     const L=await loadLeaflet();
     if(root.hidden)return;
     activeMap=L.map('doppio-map-canvas',{zoomControl:true}).setView([lat,lon],16);
     L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
       maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> colaboradores'
     }).addTo(activeMap);
     pinMarker=L.marker([lat,lon],{draggable:true}).addTo(activeMap);
     activeMap.on('click',e=>pinMarker.setLatLng(e.latlng));
     root.querySelector('#doppio-map-status').textContent='Toque no mapa ou arraste o marcador até a entrada.';
     requestAnimationFrame(()=>activeMap?.invalidateSize());
   }catch(err){
     root.querySelector('#doppio-map-status').textContent='Falha ao abrir mapa. Confira a conexão e tente novamente.';
     root.querySelector('#doppio-map-apply').disabled=true;
   }
 }
 window.DOPPIO_MAP={show,close};
})();