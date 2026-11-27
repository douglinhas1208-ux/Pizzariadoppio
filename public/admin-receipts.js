/* Recebimento de cupons fiscais estruturados, disponível somente no Admin autenticado. */
(()=>{
  'use strict';
  const $=id=>document.getElementById(id);
  const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=x=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(x||0)/100);
  let receipt=null,submitting=false;
  const msg=(text,isError=false)=>{const el=$('receipt-import-message');el.textContent=text;el.classList.toggle('stock-error',isError);};
  function clear(){
    receipt=null;
    $('receipt-import-preview').hidden=true;
    $('receipt-import-confirm').disabled=true;
    $('receipt-import-upload').value='';
  }
  $('receipt-import-upload').addEventListener('change',async event=>{
    const file=event.target.files?.[0];clear();
    if(!file)return msg('Selecione um cupom estruturado em JSON.');
    if(file.size>15000)return msg('Arquivo muito grande. Use um cupom JSON de até 15 KB.',true);
    try{
      const parsed=JSON.parse(await file.text());
      if(!parsed||!Array.isArray(parsed.items)||!parsed.receiptId||!parsed.date||!parsed.merchant||
         !Number.isInteger(parsed.totalCents)||!parsed.paymentMethod||!parsed.items.length)
        throw Error('Dados incompletos.');
      const sum=parsed.items.reduce((a,x)=>a+Number(x.lineTotalCents||0),0);
      if(sum!==parsed.totalCents)throw Error('Os itens não somam o valor total do cupom.');
      receipt=parsed;
      $('receipt-import-title').textContent=parsed.merchant+' · '+parsed.date.split('-').reverse().join('/');
      $('receipt-import-total').textContent=money(parsed.totalCents);
      $('receipt-import-items').innerHTML=parsed.items.map(x=>
        '<tr><td>'+esc(x.name)+'</td><td>'+esc(x.quantity)+' '+esc(x.unit)+'</td><td>'+money(x.lineTotalCents)+'</td></tr>'
      ).join('');
      $('receipt-import-preview').hidden=false;
      $('receipt-import-confirm').disabled=false;
      msg('Revise produtos, quantidades e valores antes de confirmar. Apenas um lançamento financeiro será criado.');
    }catch(e){receipt=null;msg('Não foi possível ler o cupom: '+e.message,true);}
  });
  $('receipt-import-confirm').addEventListener('click',async()=>{
    if(!receipt||submitting)return;
    submitting=true;$('receipt-import-confirm').disabled=true;
    msg('Registrando no financeiro e no estoque…');
    try{
      const res=await fetch('/api/admin/management/receipts/import',{
        method:'POST',credentials:'same-origin',cache:'no-store',
        headers:{'content-type':'application/json'},
        body:JSON.stringify(receipt)
      });
      const data=await res.json();
      if(!res.ok||!data.ok)throw Error(data.message||'Não foi possível registrar o cupom.');
      if(data.alreadyImported){
        msg('Este cupom já estava importado. Nenhum valor foi lançado novamente.');
      }else{
        msg('Cupom registrado: '+money(data.totalCents)+' em uma despesa e '+data.stockMovements+' entradas no estoque.');
      }
      clear();
      window.dispatchEvent(new CustomEvent('doppio:receipt:imported',{detail:{date:receipt?.date}}));
    }catch(e){msg('Importação não concluída: '+e.message,true);}
    finally{submitting=false;$('receipt-import-confirm').disabled=!receipt;}
  });
})();
