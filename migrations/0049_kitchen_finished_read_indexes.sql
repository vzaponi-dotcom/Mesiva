-- Counts follow finished_at (not creation or history fallback). No historical rows change.
CREATE INDEX IF NOT EXISTS orders_business_finished_at_idx ON orders(business_id,finished_at,id)
WHERE status='Finalizado';
CREATE INDEX IF NOT EXISTS orders_business_finished_legacy_idx ON orders(business_id,id)
WHERE status='Finalizado' AND finished_at IS NOT NULL
AND strftime('%Y-%m-%dT%H:%M:%fZ',finished_at) IS NOT finished_at;
