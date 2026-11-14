/* Banner pode ser desativado sem remover nada do site: config.js -> promotion.twoPizzasSodaBannerEnabled = false */
(() => {
  'use strict';
  const banner = document.getElementById('promo-duas-pizzas');
  if (!banner) return;
  banner.hidden = window.DOPPIO_CONFIG?.promotion?.twoPizzasSodaBannerEnabled !== true;
})();
