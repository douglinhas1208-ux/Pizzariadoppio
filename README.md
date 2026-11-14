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

## Horários automáticos — Fase 1.1

O Doppio Admin pode ativar uma programação semanal em Funcionamento da pizzaria. Por padrão, fica DESLIGADA para preservar o funcionamento manual e os horários atuais. O operador seleciona os dias e preenche abertura/fechamento, depois salva. A opção manual "Aceitar pedidos" funciona como interruptor principal: se desligada, bloqueia novos pedidos independentemente da programação.

- O horário é interpretado no fuso America/Sao_Paulo, não no fuso do aparelho do cliente.
- Os horários aceitam funcionamento após a meia-noite, por exemplo sábado 18:00 até domingo 01:00.
- O início da abertura é inclusivo e o fechamento é exclusivo; horários iguais são inválidos.
- Fora da programação, aparece aviso de fechamento e próxima abertura prevista; o cardápio continua visível, mas adicionar pizzas e checkout ficam bloqueados.
- O site consulta a situação atual do Worker na carga inicial e verifica novamente a cada minuto e ao voltar para a aba.
- A API GET /api/store-status publica somente o estado de funcionamento, sem credenciais ou dados de clientes.
- Não há pedidos agendados nessa etapa; fechar no site não impede contato direto pelo WhatsApp.
- Os campos manuais de dias e horários continuam disponíveis para quando o agendamento for desligado.
