-- Additive timeline indexes; no historical data is rewritten.
CREATE INDEX orders_business_history_time_idx
  ON orders (business_id, (CASE WHEN status = 'Cancelado' THEN COALESCE(NULLIF(cancelled_at, ''), created_at) ELSE COALESCE(NULLIF(finished_at, ''), created_at) END) DESC, id DESC, status)
  WHERE status IN ('Finalizado', 'Cancelado');

-- An empty compatibility subset costs no full-history probe on ordinary reads.
CREATE INDEX orders_business_history_legacy_idx
  ON orders (business_id, id)
  WHERE status IN ('Finalizado', 'Cancelado') AND (CASE WHEN status = 'Cancelado' THEN COALESCE(NULLIF(cancelled_at, ''), created_at) ELSE COALESCE(NULLIF(finished_at, ''), created_at) END IS NULL OR strftime('%Y-%m-%dT%H:%M:%fZ', CASE WHEN status = 'Cancelado' THEN COALESCE(NULLIF(cancelled_at, ''), created_at) ELSE COALESCE(NULLIF(finished_at, ''), created_at) END) IS NOT CASE WHEN status = 'Cancelado' THEN COALESCE(NULLIF(cancelled_at, ''), created_at) ELSE COALESCE(NULLIF(finished_at, ''), created_at) END);
