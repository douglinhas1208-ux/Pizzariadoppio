# Doppio Pizzas — Cardápio digital

Site público: https://cardapio.doppio-pizzas.workers.dev/

Projeto Cloudflare Workers: `cardapio`. Branch: `main`. Deploy: `npx wrangler deploy`.

Arquivos do site ficam na pasta `public/`, incluindo as imagens reais. Personalize o catálogo alterando `public/config.js`, incluindo preços, produtos, frete, horários e formas de pagamento. Enquanto os preços estiverem sem definição, o pedido pelo WhatsApp solicita confirmação, sem cobrança online.

Não registre chaves, tokens nem dados de clientes neste repositório.

## Publicação automática

O Cloudflare Workers Builds está conectado ao GitHub e executa `npx wrangler deploy` após alterações na branch `main`. Esta alteração de documentação valida a integração sem modificar a página.

## Painel administrativo — Fase 1

URL: https://cardapio.doppio-pizzas.workers.dev/admin

Gerencie sabores, preços, disponibilidade, imagens já cadastradas, ingredientes, dias e horários de abertura, prazo de entrega e pausa de pedidos. O cardápio e WhatsApp atuais são preservados. A Fase 1 não cria um banco de pedidos, pagamentos ou integração com WhatsApp Business API.

IMPORTANTE: a área administrativa é bloqueada até concluir a ativação de um banco D1 e dois segredos seguros. Nenhuma senha deve entrar no repositório.

### Ativação sem custo inicial (dentro do plano gratuito Cloudflare)

1. Cloudflare Dashboard > Storage & databases > D1 SQL database: criar o banco "doppio-admin" e copiar seu Database ID (UUID não secreto).
2. Adicionar ao objeto existente do arquivo wrangler.jsonc o campo d1_databases, com um item contendo:
   - binding = DOPPIO_DB
   - database_name = doppio-admin
   - database_id = o UUID REAL do banco (não usar texto de exemplo)
3. Cloudflare Dashboard > Workers & Pages > cardapio > Settings > Variables and Secrets: criar como SECRET, nunca variável pública:
   - ADMIN_PASSWORD: senha forte e exclusiva com 16 caracteres ou mais
   - ADMIN_SESSION_SECRET: sequência aleatória diferente da senha, com 32 caracteres ou mais
4. Publicar o Worker de novo pela integração GitHub/Cloudflare Workers Builds. A API cria as tabelas automaticamente na primeira utilização (sem SQL manual).
5. Abrir /admin, entrar, editar um sabor e clicar em Salvar alterações. Testar no cardápio em uma aba anônima.

Sem database_id verdadeiro no wrangler.jsonc e sem os dois secrets, o painel ficará no modo "ativação pendente". **Não é um erro de publicação.** Não exponha segredos no chat ou GitHub.

### Funcionamento e segurança

- Fonte base: public/config.js. Depois que o painel for ativado, /api/public-config.js publicará as alterações persistidas no D1 antes de carregar public/app.js. Sem D1, continua o cardápio atual com os quatro sabores e preços.
- O banco mantém o catálogo em admin_state e detecta conflitos por número de revisão.
- Login verificado apenas pelo servidor: sessão assinada (HMAC), cookie HttpOnly/Secure/SameSite Strict, duração de oito horas, checagem de origem nas alterações e bloqueio de tentativas incorretas por IP no D1.
- Novas fotos: nesta versão é possível escolher somente dentre arquivos de imagem já publicados. Upload de foto nova será uma fase posterior.
- Loja pausada: impede novos pedidos no checkout em páginas atualizadas; o contato genérico pelo WhatsApp continua acessível.
- Não há pagamento online nem recepção automática de pedidos: o cliente ainda precisa enviar a mensagem no WhatsApp.
- API de administração sem credenciais fica bloqueada. GET /api/admin/status responde ready:false até a ativação, e ready:true após configuração.

### Teste após ativação

Verificar os quatro preços (54,99/49,99), meio a meio, frete por CEP, carrinho e envio do checkout. Abrir /admin em aba anônima deve exigir senha; sem login /api/admin/state retorna 401. Após editar/salvar, a alteração deve aparecer no cardápio público.

Nunca registre ADMIN_PASSWORD, ADMIN_SESSION_SECRET nem ORS_API_KEY em arquivos versionados.
