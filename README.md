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


## Fotos ilustrativas completas do catálogo — 20/11/2026

- Chocolate com Morango e Uva Nevada possuem imagens ilustrativas inteiras, enquadradas sem cortar as pizzas, em AVIF 640 × 446 para cards 560 × 390, com mais definição que a miniatura anterior.
- As imagens foram geradas para apresentação e não devem ser descritas como fotos reais dos produtos. Substituir pelos registros reais quando forem disponibilizados.
- Migração versionada do D1 (catalogVersion 6) atualiza apenas os caminhos anteriores conhecidos e preserva fotografias personalizadas eventualmente enviadas pelo painel.
- Os valores R$ 56,99 para ambas e o meio a meio doce independente permanecem inalterados.

## Relatório diário de pizzas e pedidos (22/11/2026)

- O painel em /admin mostra cada dia civil de São Paulo nos últimos 7, 30 ou 90 dias, incluindo dias sem movimentação.
- Solicitações são registros enviados pelo checkout e não equivalem automaticamente a compras.
- Pedidos confirmados incluem os status preparo, entrega e concluido. Pizzas vendidas somam as quantidades dos itens desses pedidos; novo e cancelado não entram nas vendas.
- Pizza meio a meio equivale a uma única pizza, de acordo com a quantidade solicitada.
- A data exibida é a data de criação da solicitação, não a data em que o status foi alterado; alterações posteriores de status podem atualizar a contagem de dias anteriores.
- A seção mostra resumo de hoje, detalhamento dia a dia, totais do período e recebimentos lançados manualmente. Não altera nem exclui os pedidos históricos.


## Gestão de estoque e preços de insumos (24/11/2026)

No **Doppio Admin** existe a seção **05 · Estoque e Custos** e o atalho “📦 Ir para Estoque e Custos”.

- **Cadastro:** informe o nome do insumo, unidade de controle (g, kg, ml, L ou un), quantidade por embalagem, preço da embalagem em reais, saldo inicial e nível mínimo para alerta. O sistema calcula custo unitário e valor estimado do saldo. Nenhum ingrediente ou preço é inventado na primeira abertura.
- **Preço de compra:** altere preço e tamanho de embalagem em Editar. As unidades de controle permanecem as mesmas depois do cadastro para manter a integridade das movimentações e fichas.
- **Movimentações:** use Entrada, Consumo, Perda, Ajuste positivo ou Ajuste negativo. Todo ajuste fica no histórico, e não é possível dar saída acima do saldo registrado.
- **Ficha técnica:** selecione a pizza, adicione insumos ativos e informe quantidade por pizza inteira. O custo se atualiza conforme os preços cadastrados. Mostra o preço de venda que já está no cardápio e a margem bruta estimada, mas não modifica o preço publicado.
- **Exportar CSV:** salva lista de saldos, preços e estimativas em arquivo que pode ser aberto no Excel.
- **Escopo:** controle de estoque é manual nesta fase. **Pré-pedidos não geram baixa automática** porque podem nunca ter sido confirmados. No preparo, o operador deve registrar o consumo conforme necessário.
- **Precisão:** custo e valor de estoque são baseados no preço de referência atual da embalagem, não em custo médio histórico de compras. A margem bruta estimada não inclui custos indiretos (gás, taxa de cartão, transporte, impostos, energia, mão de obra) até estes serem contabilizados à parte.
- **Persistência:** banco Cloudflare D1 existente, com três tabelas novas: stock_ingredients, stock_movements, stock_recipe. A criação é não destrutiva; não modifica o esquema de pedidos nem o catálogo público.
- **Privacidade:** operações somente em /api/admin/inventory e subrotas, protegidas pela mesma sessão administrativa. API retorna 401 sem login e verifica Origin nas gravações. A interface pública carrega apenas o código, não os dados.
- **Falhas de carregamento:** atualize o painel e entre novamente se a sessão expirar. Não apague o banco sem investigar a origem.

Exemplo ilustrativo, **não pré-cadastrado**: pacote de mussarela com 1.000 g por R$ 35,90 → custo R$ 0,0359/g. Se uma pizza usar 200 g, seu custo de mussarela será R$ 7,18.


### Gestão empresarial — despesas simplificadas (25/11/2026)

No painel administrativo, a aba **Gestão empresarial** possui lançamento rápido de despesas (descrição, valor, categoria, data e pagamento), atalhos de categorias, busca e filtros. O administrador pode corrigir e arquivar despesas. Cada alteração gera auditoria no D1 e o arquivamento não apaga registros. Os valores financeiros permanecem indicativos até conciliação.

A interface e API foram homologadas com dez testes de SQLite em memória e simulação de uso no navegador para adicionar, editar, buscar e excluir. O catálogo e os pedidos operacionais não são alterados pelos lançamentos gerenciais.


## Promoção Doppio — 2 pizzas + Pepsi 2 litros (27/11/2026)

- Promoção ativa: **na compra de pelo menos 2 pizzas no mesmo pedido, o cliente ganha 1 Pepsi 2 L ou 1 Pepsi Zero 2 L**, à escolha, sem custo adicional. Somente uma garrafa por pedido, não uma a cada dupla de pizzas.
- Vale para pizzas salgadas, doces e meio a meio. Cada unidade de pizza meio a meio conta como **uma** pizza (mesmo com dois sabores). Quantidades de um único sabor também contam.
- Banner fixo, não abre pop-up. Com 1 pizza o carrinho exibe o progresso; ao adicionar a segunda aparecem duas opções de refrigerante. A variante segue na revisão, no pré-pedido registrado no D1 e na mensagem preparada para WhatsApp.
- A pizzaria confere disponibilidade do sabor escolhido antes de confirmar a solicitação. Nenhum refrigerante é cobrado ou automaticamente debitado do estoque nesta fase; lançamento de movimentação física continua manual na aba Estoque.
- O servidor revalida a quantidade de pizzas e rejeita brinde indevido, variante inválida ou produto indisponível. Carrinhos antigos sem opção preenchida recebem a opção padrão Pepsi tradicional, preservando compatibilidade.
- A tabela `doppio_orders` ganha a coluna opcional `promo_soda_variant` por migração aditiva. Pedidos históricos e relatórios financeiros mantêm seus valores e quantidades. No admin, o brinde aparece com valor R$ 0,00.
- `promotion.enabled` no config.js controla a experiência pública. `promotion.twoPizzasSodaBannerEnabled` controla **somente o banner**; o desligamento real da promoção também deve acompanhar a regra `PROMO_ENABLED` no servidor (src/orders.js). Evitar alterar apenas um dos lados.
- Homologação: `node --test tests/promotion.test.mjs` e `node --test tests/management.test.mjs` com Node 22+ e banco SQLite isolado; simulação do carrinho, escolha Pepsi Zero, checkout, API e painel via navegador.
