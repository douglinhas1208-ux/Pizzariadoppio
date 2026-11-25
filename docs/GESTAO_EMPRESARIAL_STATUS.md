# Doppio Pizzas — Gestão empresarial (ramificação de desenvolvimento)

**Situação:** em desenvolvimento e homologação. **NÃO publicada na produção**, cujo Worker usa a branch \`main\`.
A pizzaria opera às **sextas, sábados e domingos**. Qualquer evolução deve preservar a operação, os pedidos, o catálogo e o estoque.

## Origem e escopo
Continuação do trabalho iniciado com Sol em 25/11/2026. Já existiam painel administrativo, estoque/custos, fichas técnicas e relatórios de pedidos.
Esta branch agrega:
- \`migrations/management-draft.sql\`: 3 tabelas isoladas e gatilhos para espelhar a evolução de pedidos no histórico gerencial, com sincronização repetível;
- \`src/management.js\`: API autenticada (via \`adminApi\`), com resumo mensal, cadastro de despesas e metas;
- \`public/admin-management.js\`: interface mensal de gestão empresarial;
- \`public/admin.html\`, \`public/admin.css\`, \`public/admin.js\`: terceira aba do Admin, visível separadamente do painel principal e do estoque;
- \`tests/management.test.mjs\`: testes de homologação usando **SQLite em memória**.

## Regras do histórico
1. Um \`order_id\` corresponde a um registro de histórico. UPSERT idempotente não duplica ao reprocessar.
2. \`novo\` = solicitação, não venda. \`preparo\`, \`entrega\` e \`concluido\` = vendas operacionais registradas. \`cancelado\` não compõe vendas.
3. Quantidade de pizzas é a soma de \`qty\` de cada item, inclusive meio a meio como **uma pizza por unidade pedida**, e não quantidade de linhas de pedidos.
4. Histórico financeiro não contém nome, telefone, endereço ou observações do cliente.
5. A tabela de pedidos operacional permanece sob a política de retenção atual (90 dias). O histórico gerencial permanece após a remoção de um pedido operacional **depois que a sincronização estiver ativada**.
6. Dados já excluídos **antes** da migração não são recuperados sem fonte de backup e não devem ser estimados.
7. Atualizações de valor recebido representam um **valor cumulativo registrado** no pedido; não são pagamentos individualizados. Não inferir a data do recebimento de \`updated_at\`.
8. Pagamentos registrados em pedidos depois cancelados devem ser destacados para conciliação. Não realizar estorno automático nem contabilizar como venda concluída.
9. A exclusão manual deve ganhar política explícita de trilha de auditoria/estorno antes do lançamento produtivo.
10. Não dar baixa automática em estoque por solicitação não confirmada. Integração de receitas, custos de ingredientes e despesa depende de homologação separada.

## Cálculos da versão experimental
- Vendas de pizzas: soma de \`subtotal_cents\` para pedidos confirmados.
- Frete da pizzaria: soma de \`shipping_cents\` para confirmados; transporte organizado por cliente não gera frete da pizzaria.
- Vendas estimadas: valor de \`total_cents\` informado ou soma de subtotal+frete se total ausente.
- Despesas registradas: soma de \`amount_cents\` por \`expense_date\`. Despesa com \`paid_at\` é apresentada como informada paga.
- Saldo **parcial**: vendas estimadas - despesas cadastradas. **NÃO é lucro, EBITDA, margem líquida nem fluxo de caixa**.
- Metas mensais: faturamento, lucro líquido desejado e pizzas vendidas. Progresso de lucro não deve ser mostrado até conciliação contábil.
- Horários/dias considerados: América/São Paulo; preferência operacional sexta, sábado e domingo.

## Como testar sem interferir na produção
- Requer Node.js 22+ com \`node:sqlite\`.
- Execute: \`node --test tests/management.test.mjs\`.
- Testes utilizam somente SQLite **em memória**, sem credenciais reais e sem acesso ao Worker/D1 de produção.
- Antes de qualquer ativação, criar banco D1 **exclusivo de homologação**, aplicar migração nele, confirmar importação repetível e comparar amostras de pedidos/estados do ambiente de teste.
- Validar que usuário não autenticado recebe 401 e que chamadas com Origem inválida recebem 403, conforme \`adminApi\`.
- Simular telas e formulários com respostas de teste; **não** cadastrar despesas fictícias no banco real.
- Somente depois de auditoria, conciliação e aprovação explícita para publicação planejar merge e deploy, com backup e rollback.

## Pendências anteriores à produção
- [ ] Teste E2E da interface da gestão empresarial em navegador com ambiente D1 homologado.
- [ ] Implementar livro de caixa que capture eventos e datas reais de pagamento/estorno, sem pressupor que o campo cumulativo equivale a entrada bancária.
- [ ] Definir política explícita para exclusão administrativa, estorno de cancelados e retificações, com trilha de auditoria e lançamentos compensatórios.
- [ ] Associar receitas e custos dos ingredientes ao preço real e ao status confirmado, sem dar baixa em pré-pedidos.
- [ ] Validar despesas, relatórios gerenciais, cálculos de margem, impostos, taxas e custos indiretos.
- [ ] Fazer conferência de histórico >90 dias após ativação do espelhamento; não prometer recuperação de registros antigos já expurgados.
- [ ] Homologar performance e efeitos em horário de pico, principalmente sexta a domingo.
- [ ] Executar plano de backup e rollback antes de qualquer mudança em produção.

**Importante:** a infraestrutura de produção, o catálogo atual e os pedidos operacionais NÃO foram modificados por este conjunto de commits.


## Atualização do controle de despesas — 25/11/2026
- Lançamento rápido com descrição, valor, categoria, data e pagamento, inclusive atalhos de categorias.
- Busca de gastos por descrição ou categoria e filtros de pagos/pendentes.
- Edição por ID e revisão otimista (`expectedRevision`), sem sobrescrever mudanças de outra sessão.
- Exclusão apenas lógica (`archived_at`); o gasto sai dos totais, mas continua guardado.
- Auditoria automática no SQLite para criação, edição e arquivamento, com estados anterior e novo.
- Migração aditiva de `revision` e `archived_at` que mantém despesas já registradas.
- Dez testes automatizados em SQLite isolado e teste de interface com dados simulados (criação, edição, exclusão, busca, layout mobile).
- Não cria lançamentos de despesa automaticamente ao comprar ingredientes no módulo Estoque; as duas operações permanecem independentes e precisam ser conciliadas para evitar dupla contagem.
