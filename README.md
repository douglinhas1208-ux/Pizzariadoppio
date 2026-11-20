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

## Central de Pedidos — Fase 2

A Central de Pedidos fica no dashboard /admin. O cardápio gera uma solicitação pelo endpoint POST /api/order ao acionar o botão final de abrir WhatsApp. Antes de abrir a conversa, o Worker registra dados no D1 com referência própria (DP-AAAAMMDD-XXXXXXXX), protegidos pelo login existente. O número aparece na mensagem pronta do WhatsApp. **O sistema não possui integração oficial de mensagens do WhatsApp:** registrar a solicitação e abrir o link wa.me não garantem que o cliente tenha enviado a mensagem, pago ou sido atendido. O status inicial é sempre `novo` — aguardando confirmação.

Status disponíveis: `novo`, `preparo`, `entrega`, `concluido`, `cancelado`. No painel é possível consultar até 100 solicitações recentes, filtrar por status, pesquisar referência/nome, mudar o status e excluir uma solicitação. É necessário confirmar o pedido diretamente no WhatsApp antes de iniciar o preparo. Nenhuma mudança de status envia mensagens automaticamente.

### Segurança e privacidade

- GET /api/admin/orders e PUT/DELETE /api/admin/orders/:id exigem autenticação da sessão administrativa, e mutações exigem `Origin` correto.
- O servidor valida catálogo, itens, quantidades, preços, período de funcionamento e formato do endereço ao receber uma solicitação; não confia nos preços de itens enviados pelo navegador.
- Frete é **estimativa do CEP fornecida pelo navegador** a partir do endpoint de rotas existente; valor final e personalizações precisam ser confirmados antes da aceitação.
- Um token de idempotência evita pedidos duplicados ao repetir o mesmo envio; limite por IP derivado de hash para coibir abuso.
- Dados de pedidos são armazenados no D1 e eliminados após 90 dias por cron diário em UTC (`0 6 * * *`) ou durante a listagem administrativa. O administrador também pode excluí-los individualmente.
- O cliente é informado no resumo que seus dados de entrega serão guardados pela pizzaria para atendimento, por até 90 dias.
- Se o registro no painel falhar, o site pode abrir o WhatsApp como alternativa, avisando que o registro interno não foi concluído. Não há confirmação de entrega da mensagem.
- Pedidos agendados, comprovante de pagamento, WhatsApp API e envio automático de notificações ainda não fazem parte desta etapa.

## Atualização automática da Central de Pedidos

O painel administrativo consulta os pedidos **a cada 10 segundos** enquanto a aba está visível e o administrador autenticado. Também faz uma consulta ao retornar à aba ou ao focar a janela. Não é necessário atualizar a página com F5. Quando uma solicitação nova aparece, uma notificação visual é exibida.

O painel só reconstrói a lista quando os dados mudam, preservando filtro, pesquisa e o estado aberto dos detalhes da solicitação. Durante a alteração de status e enquanto o seletor de status está em foco, a sincronização automática espera para não interromper o operador. A última sincronização e problemas de conexão são mostrados na seção de pedidos. O botão manual "Atualizar" permanece disponível.

Esta é **atualização periódica (quase em tempo real)**, não uma conexão push nem uma integração automática com mensagens do WhatsApp.

## Fase 4 — alertas, WhatsApp, financeiro e fotos

**Alertas**: a Central de Pedidos consulta novas solicitações em intervalos de aproximadamente 10 segundos enquanto o painel estiver ativo/visível. Uma solicitação nova provoca um destaque no painel e uma notificação. O áudio é **opcional** e exige clique em "Ativar som" a cada nova sessão do navegador, por restrições de reprodução automática; não emite áudio antes da autorização. A tab fechada não recebe notificações push.

**Atendimento no WhatsApp**: o checkout passou a pedir celular com DDD, que fica restrito ao administrador no banco D1. Os pedidos novos disponibilizam botão "Preparar mensagem no WhatsApp" conforme o status. O botão abre o WhatsApp com o telefone do cliente e mensagem editável, sem enviar automaticamente. Pedidos antigos sem telefone continuam acessíveis, mas não terão botão funcional de contato.

**Relatórios**: em /admin é possível consultar períodos de 7, 30 e 90 dias, com contagem de solicitações, pedidos concluídos, total estimado dos concluídos e **recebimentos informados manualmente**. O administrador pode confirmar um valor realmente recebido para cada pedido (ou desfazer), e o relatório considera essa declaração. Nenhuma integração bancária nem conciliação automática está incluída; valores declarados não são prova financeira e reembolsos precisam ser controlados manualmente.

**Fotos**: o Doppio Admin permite escolher JPG/PNG/WEBP de até 8 MB. O navegador redimensiona e converte para JPEG de no máximo 350 KiB, carregado por uma API administrativa autenticada e guardado no mesmo banco D1. A imagem recebe rota pública /api/photo/<UUID> para o cardápio. Não é necessário criar bucket R2 nem novo secret. Após o envio, é preciso clicar em "Salvar alterações" para associá-la ao sabor na loja pública. As fotos já existentes continuam disponíveis.

**Privacidade e segurança**: pedidos antigos preservados durante migração do D1 (adição dos campos customer_phone e paid_amount_cents). Fotos e relatórios exigem login para edição; fotos usadas no cardápio são publicamente acessíveis. Dados de clientes e recebimentos não são expostos por endpoints públicos. Testes devem empregar exclusivamente dados fictícios e não enviar mensagens a clientes reais.


## Preparação para vendas — 19/11/2026

- Site público usa `draft:false` em `public/config.js`, preços de quatro pizzas aprovados (R$ 54,99 e R$ 49,99), meio a meio pela média e entrega de até 5 km (R$ 5 até 2 km, +R$ 1 por km adicional iniciado).
- Horários ativos são gerenciados pelo banco D1: sexta, sábado e domingo, 18h–23h, fuso America/Sao_Paulo. Fora de horário, o carrinho não recebe novos pedidos; contato genérico pelo WhatsApp permanece.
- Promoção reversível: duas pizzas no mesmo pedido qualificam-se a um refrigerante grátis. O carrinho, a revisão e o texto preparado para WhatsApp indicam o brinde; a equipe confirma as condições e a entrega.
- O site apenas **prepara** uma mensagem WhatsApp e registra pré-pedidos. Abrir o link não confirma envio nem aceite. É necessário atender o WhatsApp e conferir o registro no Doppio Admin antes de preparar pizza.
- Em cada abertura, entrar no painel, conferir horários, disponibilidade, volume de insumos, fotos, preços, promoção e ativar o som no navegador se quiser alerta sonoro; manter a aba do painel aberta.
- O checkout não processa cartão/Pix no site. Os pagamentos e recebimentos são acertados e registrados manualmente. Nunca solicitar dados completos de cartão nas observações.
- Testes de checkout podem ser feitos com respostas **simuladas**, sem gravar pedidos reais. Antes do primeiro pedido real, o operador deve conferir o WhatsApp, o recebimento no painel, frete e status de entrega com sua própria operação.
- O link compartilhado possui metadados Open Graph de foto real, e a página pública de privacidade está em `/privacidade.html`.

## Pizzas doces e horário especial — 20/11/2026

- Novos sabores: Chocolate com Morango e Uva Nevada (Ninho com Uva) na categoria **Doces**.
- Existem duas opções separadas: meio a meio salgado (somente salgadas) e meio a meio doce (somente doces). Misturas são bloqueadas no navegador e servidor.
- Valores confirmados: R$ 54,99 cada doce. A opção meio a meio doce Chocolate com Morango + Uva Nevada custa R$ 54,99. Os desenhos são ilustrações provisórias e devem ser substituídos por fotos reais enviadas pela pizzaria.
- Migração versionada do D1 acrescenta doces à primeira leitura sem sobrescrever edições existentes; preservar catalogVersion e halfAllowed em salvamentos posteriores.
- **Somente sexta 20/11/2026**, abertura 19h em vez de 18h, respeitando o fuso São Paulo e o fechamento semanal configurado. Próximas sextas seguem configuração normal do admin.
