-- Additive read indexes: preserve operational rows, history and print/audit data.
CREATE INDEX orders_business_active_created_idx
  ON orders (business_id, created_at, id)
  WHERE status NOT IN ('Finalizado', 'Cancelado', 'Entregue', 'Despachado')
    AND finished_at IS NULL
    AND cancelled_at IS NULL;

CREATE INDEX order_items_business_order_created_idx
  ON order_items (business_id, order_id, created_at, id);
