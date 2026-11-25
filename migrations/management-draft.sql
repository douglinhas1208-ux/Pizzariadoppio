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

-- Aplicar após a migração paid_amount_cents da tabela de pedidos.
-- Captura no mesmo comando de escrita: uma linha por pedido, sem duplicação.
CREATE TRIGGER IF NOT EXISTS doppio_management_order_insert AFTER INSERT ON doppio_orders BEGIN
 INSERT INTO doppio_management_sales(order_id,order_created_at,last_order_update_at,status,pizza_quantity,subtotal_cents,shipping_cents,total_cents,paid_amount_cents) SELECT NEW.id,NEW.created_at,NEW.updated_at,NEW.status,COALESCE((SELECT SUM(CASE WHEN json_type(item.value,'$.qty')='integer' AND CAST(json_extract(item.value,'$.qty') AS INTEGER)>0 THEN CAST(json_extract(item.value,'$.qty') AS INTEGER) ELSE 0 END) FROM json_each(CASE WHEN json_valid(NEW.items_json) THEN NEW.items_json ELSE '[]' END) item),0),NEW.subtotal_cents,NEW.shipping_cents,NEW.total_cents,NEW.paid_amount_cents WHERE 1 ON CONFLICT(order_id) DO UPDATE SET last_order_update_at=excluded.last_order_update_at,status=excluded.status,pizza_quantity=excluded.pizza_quantity,subtotal_cents=excluded.subtotal_cents,shipping_cents=excluded.shipping_cents,total_cents=excluded.total_cents,paid_amount_cents=excluded.paid_amount_cents WHERE excluded.last_order_update_at>=doppio_management_sales.last_order_update_at;
END;
CREATE TRIGGER IF NOT EXISTS doppio_management_order_update AFTER UPDATE ON doppio_orders BEGIN
 INSERT INTO doppio_management_sales(order_id,order_created_at,last_order_update_at,status,pizza_quantity,subtotal_cents,shipping_cents,total_cents,paid_amount_cents) SELECT NEW.id,NEW.created_at,NEW.updated_at,NEW.status,COALESCE((SELECT SUM(CASE WHEN json_type(item.value,'$.qty')='integer' AND CAST(json_extract(item.value,'$.qty') AS INTEGER)>0 THEN CAST(json_extract(item.value,'$.qty') AS INTEGER) ELSE 0 END) FROM json_each(CASE WHEN json_valid(NEW.items_json) THEN NEW.items_json ELSE '[]' END) item),0),NEW.subtotal_cents,NEW.shipping_cents,NEW.total_cents,NEW.paid_amount_cents WHERE 1 ON CONFLICT(order_id) DO UPDATE SET last_order_update_at=excluded.last_order_update_at,status=excluded.status,pizza_quantity=excluded.pizza_quantity,subtotal_cents=excluded.subtotal_cents,shipping_cents=excluded.shipping_cents,total_cents=excluded.total_cents,paid_amount_cents=excluded.paid_amount_cents WHERE excluded.last_order_update_at>=doppio_management_sales.last_order_update_at;
END;
-- Diferencia exclusão administrativa de expiração automática: a regra de exclusão
-- deve ser finalizada antes de ativar esta migração; não apagar histórico por cron.
-- Importação inicial repetível dos pedidos que ainda existem.
INSERT INTO doppio_management_sales(order_id,order_created_at,last_order_update_at,status,pizza_quantity,subtotal_cents,shipping_cents,total_cents,paid_amount_cents) SELECT o.id,o.created_at,o.updated_at,o.status,COALESCE((SELECT SUM(CASE WHEN json_type(item.value,'$.qty')='integer' AND CAST(json_extract(item.value,'$.qty') AS INTEGER)>0 THEN CAST(json_extract(item.value,'$.qty') AS INTEGER) ELSE 0 END) FROM json_each(CASE WHEN json_valid(o.items_json) THEN o.items_json ELSE '[]' END) item),0),o.subtotal_cents,o.shipping_cents,o.total_cents,o.paid_amount_cents FROM doppio_orders o WHERE 1 ON CONFLICT(order_id) DO UPDATE SET last_order_update_at=excluded.last_order_update_at,status=excluded.status,pizza_quantity=excluded.pizza_quantity,subtotal_cents=excluded.subtotal_cents,shipping_cents=excluded.shipping_cents,total_cents=excluded.total_cents,paid_amount_cents=excluded.paid_amount_cents WHERE excluded.last_order_update_at>=doppio_management_sales.last_order_update_at;
