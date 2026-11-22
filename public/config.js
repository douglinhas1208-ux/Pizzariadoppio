/*
  DOPPIO PIZZAS — ARQUIVO DE CONFIGURAÇÃO
  Atualize os campos abaixo e publique novamente os arquivos.
  - price: null = preço ainda não definido | 49.90 = R$ 49,90
  - Frete: R$ 5,00 até 2 km; +R$ 1,00 por km adicional iniciado, até 5 km.
  - Para incluir um sabor no futuro, copie um objeto dentro de products.
  - Nenhuma configuração é secreta: este arquivo aparece para clientes.
*/
window.DOPPIO_CONFIG = {
  business: {
    name: 'Doppio Pizzas',
    whatsapp: '5511959315869',
    neighborhood: 'Jardim Brasília',
    city: 'São Paulo',
    openDays: 'Sexta, sábado e domingo',
    openHours: '18h às 23h', // horário confirmado para os três dias
    etaMinutes: 40,
    paymentMethods: ['Crédito', 'Débito', 'Pix'],
    draft: false
  },
  delivery: {
    radiusKm: 5,
    minFee: 5, // valor mínimo de entrega em reais
    includedKm: 2, // os primeiros 2 km custam R$ 5,00
    extraKmFee: 1, // R$ 1,00 por cada km adicional iniciado após 2 km
    feeMessage: 'Entregas até 5 km: R$ 5,00 até 2 km; +R$ 1,00 por km adicional iniciado. Frete estimado pela rota de referência da rua do CEP. Número solicitado apenas para a entrega.',
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
  // Coloque false para ocultar o banner promocional sem alterar o catálogo.
  promotion: { twoPizzasSodaBannerEnabled: true },
  products: [
    {id:'frango', name:'Frango com Catupiry', description:'Frango e Catupiry.', ingredients:['Massa','Molho de tomate','Frango','Catupiry','Azeitonas'], category:'Clássicas', image:'assets/frango-real.avif', price:54.99, available:true, tag:'Clássica'},
    {id:'brocolis', name:'Brócolis com Bacon', description:'Brócolis, bacon e Catupiry.', ingredients:['Massa','Molho de tomate','Brócolis','Bacon','Catupiry'], category:'Clássicas', image:'assets/brocolis.webp', price:54.99, available:true, tag:'Clássica'},
    {id:'calabresa', name:'Calabresa', description:'Calabresa e cebola.', ingredients:['Massa','Molho de tomate','Calabresa','Cebola','Azeitonas'], category:'Clássicas', image:'assets/calabresa-real.avif', price:49.99, available:true, tag:'Clássica'},
    {id:'mussarela', name:'Mussarela', description:'Mussarela, tomate e azeitonas.', ingredients:['Massa','Molho de tomate','Mussarela','Tomate','Azeitonas'], category:'Clássicas', image:'assets/mussarela.webp', price:49.99, available:true, tag:'Clássica'},
    {id:'chocolate-morango', name:'Chocolate com Morango', description:'Pizza doce de chocolate com morangos.', ingredients:['Massa','Chocolate','Morango'], category:'Doces', image:'assets/chocolate-morango-catalogo.avif', price:56.99, available:false, tag:'Doce', halfAllowed:false},
    {id:'uva-nevada', name:'Uva Nevada (Ninho com Uva)', description:'Pizza doce de creme de Ninho com uvas.', ingredients:['Massa','Creme de Ninho','Uva'], category:'Doces', image:'assets/uva-nevada-catalogo.avif', price:56.99, available:true, tag:'Doce', halfAllowed:true},
    {id:'chocolate-uva', name:'Chocolate com Uva', description:'Pizza doce com cobertura de chocolate e uvas verdes.', ingredients:['Massa','Chocolate','Uva verde'], category:'Doces', image:'assets/chocolate-uva-catalogo.avif', price:56.99, available:true, tag:'Doce', halfAllowed:true}
  ]
};
