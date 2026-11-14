/*
 * Doppio Pizzas — servidor Cloudflare Worker.
 * Serve os arquivos do cardápio sem alterações e reserva /api/* para
 * integração do frete com OpenRouteService.
 * ORS_API_KEY deve ser cadastrada como Secret no painel Cloudflare;
 * nunca coloque o valor no repositório.
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/status') {
      return new Response(
        JSON.stringify({ service: 'doppio-frete', configured: Boolean(env.ORS_API_KEY) }),
        { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } }
      );
    }

    if (url.pathname.startsWith('/api/')) {
      return new Response(
        JSON.stringify({ error: 'API em configuração. O cardápio continua disponível.' }),
        { status: 503, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } }
      );
    }

    return env.ASSETS.fetch(request);
  }
};
