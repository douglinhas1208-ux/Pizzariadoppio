/*
  DOPPIO PIZZAS — ARQUIVO DE CONFIGURAÇÃO
  Atualize os campos abaixo e publique novamente os arquivos.
  - price: null = preço ainda não definido | 49.90 = R$ 49,90
  - Frete: até 5 km R$ 5,00; cada km adicional (arredondado para cima) +R$ 1,00.
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
    minFee: 5, // valor mínimo de entrega em reais
    includedKm: 5, // até 5 km não há acréscimos
    extraKmFee: 1, // R$ 1,00 por km adicional iniciado
    feeMessage: 'Frete mínimo R$ 5,00 até 5 km; +R$ 1,00 por km extra, até 10 km. Frete estimado pela rota de referência da rua do CEP. Número solicitado apenas para a entrega.',
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
    {id:'frango', name:'Frango com Catupiry', description:'Frango e Catupiry.', ingredients:['Massa','Molho de tomate','Frango','Catupiry','Azeitonas'], category:'Clássicas', image:'assets/frango-real.avif', price:54.99, available:true, tag:'Clássica'},
    {id:'brocolis', name:'Brócolis com Bacon', description:'Brócolis, bacon e Catupiry.', ingredients:['Massa','Molho de tomate','Brócolis','Bacon','Catupiry'], category:'Clássicas', image:'assets/brocolis.webp', price:54.99, available:true, tag:'Clássica'},
    {id:'calabresa', name:'Calabresa', description:'Calabresa e cebola.', ingredients:['Massa','Molho de tomate','Calabresa','Cebola','Azeitonas'], category:'Clássicas', image:'assets/calabresa-real.avif', price:49.99, available:true, tag:'Clássica'},
    {id:'mussarela', name:'Mussarela', description:'Mussarela, tomate e azeitonas.', ingredients:['Massa','Molho de tomate','Mussarela','Tomate','Azeitonas'], category:'Clássicas', image:'assets/mussarela.webp', price:49.99, available:true, tag:'Clássica'}
  ]
};
