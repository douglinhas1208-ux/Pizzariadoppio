/*
  DOPPIO PIZZAS — ARQUIVO DE CONFIGURAÇÃO
  Atualize os campos abaixo e publique novamente os arquivos.
  - price: null = preço ainda não definido | 49.90 = R$ 49,90
  - delivery.fee: null = frete a confirmar | 7.00 = R$ 7,00
  - Para incluir um sabor no futuro, copie um objeto dentro de products.
  - Nenhuma configuração é secreta: este arquivo aparece para clientes.
*/
window.DOPPIO_CONFIG = {
  business: {
    name: 'Doppio Pizzas',
    whatsapp: '5511959315869',
    neighborhood: 'Jardim Brasília',
    city: 'São Paulo',
    openDays: 'Sábados e domingos',
    openHours: null, // exemplo: '18h às 23h'
    etaMinutes: 40,
    paymentMethods: ['Crédito', 'Débito', 'Pix'],
    draft: true
  },
  delivery: {
    radiusKm: 10,
    fee: null, // valor fixo, quando definido. Cobrança por bairro pode ser avaliada na próxima versão.
    feeMessage: 'Entregas em até 10 km. Frete confirmado após verificar o endereço.',
    freeFrom: null // futuro: frete grátis a partir de um valor, quando houver política definida
  },
  options: {
    halfHalfEnabled: true,
    halfHalfPricing: 'average', // média dos dois sabores
    // Sugestões de observações. São pedidos sujeitos a disponibilidade e preço a confirmar.
    customizationSuggestions: ['Trocar mussarela por Catupiry', 'Sem cebola', 'Sem azeitonas', 'Sem bacon'],
    catupiryCrustAvailable: false, // previsto para o futuro
    requireDeliveryAddress: true // impede enviar pedido sem endereço
  },
  products: [
    {id:'frango', name:'Frango com Catupiry', description:'Frango e Catupiry.', ingredients:['Massa','Molho de tomate','Frango','Catupiry','Azeitonas'], category:'Clássicas', image:'assets/frango-real.avif', price:null, available:true, tag:'Clássica'},
    {id:'brocolis', name:'Brócolis com Bacon', description:'Brócolis, bacon e Catupiry.', ingredients:['Massa','Molho de tomate','Brócolis','Bacon','Catupiry'], category:'Clássicas', image:'assets/brocolis.webp', price:null, available:true, tag:'Clássica'},
    {id:'calabresa', name:'Calabresa', description:'Calabresa e cebola.', ingredients:['Massa','Molho de tomate','Calabresa','Cebola','Azeitonas'], category:'Clássicas', image:'assets/calabresa-real.avif', price:null, available:true, tag:'Clássica'},
    {id:'mussarela', name:'Mussarela', description:'Mussarela, tomate e azeitonas.', ingredients:['Massa','Molho de tomate','Mussarela','Tomate','Azeitonas'], category:'Clássicas', image:'assets/mussarela.webp', price:null, available:true, tag:'Clássica'}
  ]
};
