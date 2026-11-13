# Doppio Pizzas — Cardápio digital

Site público: https://cardapio.doppio-pizzas.workers.dev/

Projeto Cloudflare Workers: `cardapio`. Branch: `main`. Deploy: `npx wrangler deploy`.

Arquivos do site ficam na pasta `public/`, incluindo as imagens reais. Personalize o catálogo alterando `public/config.js`, incluindo preços, produtos, frete, horários e formas de pagamento. Enquanto os preços estiverem sem definição, o pedido pelo WhatsApp solicita confirmação, sem cobrança online.

Não registre chaves, tokens nem dados de clientes neste repositório.

## Publicação automática

O Cloudflare Workers Builds está conectado ao GitHub e executa `npx wrangler deploy` após alterações na branch `main`. Esta alteração de documentação valida a integração sem modificar a página.
