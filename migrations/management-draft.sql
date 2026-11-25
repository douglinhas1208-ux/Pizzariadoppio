-- Doppio: base da gestão empresarial. Executar primeiro em banco de teste.
-- Não contém nome, telefone, endereço, IP ou observações de clientes.
CREATE TABLE IF NOT EXISTS doppio_management_sales (
 order_id TEXT PRIMARY KEY,
 order_created_at INTEGER NOT NULL,
 last_order_update_at INTEGER NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('novo','preparo','entrega','concluido','cancelado')),
 pizza_quantity INTEGER NOT NULL CHECK(pizza_quantity>=0),
 subtotal_cents INTEGER NOT NULL CHECK(subtotal_cents>=0),
 shipping_cents INTEGER,
 total_cents INTEGER,
 paid_amount_cents INTEGER
);
CREATE INDEX IF NOT EXISTS doppio_management_sales_date ON doppio_management_sales(order_created_at);
CREATE TABLE IF NOT EXISTS doppio_management_expenses (
 id TEXT PRIMARY KEY,
 expense_date TEXT NOT NULL,
 category TEXT NOT NULL,
 description TEXT NOT NULL,
 amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
 paid_at INTEGER
);
CREATE TABLE IF NOT EXISTS doppio_management_goals (
 month TEXT PRIMARY KEY,
 revenue_target_cents INTEGER NOT NULL DEFAULT 0 CHECK(revenue_target_cents>=0),
 profit_target_cents INTEGER NOT NULL DEFAULT 0 CHECK(profit_target_cents>=0),
 pizza_target INTEGER NOT NULL DEFAULT 0 CHECK(pizza_target>=0),
 operating_weekdays TEXT NOT NULL DEFAULT '[5,6,0]'
);
-- Histórico usa data do pedido; data efetiva do recebimento ainda precisa ser
-- registrada em um livro de caixa próprio. Não inferir essa data de updated_at.
-- Próxima etapa: sincronização idempotente e política explícita para exclusões,
-- cancelamentos, estornos e migração dos pedidos existentes antes da retenção.
