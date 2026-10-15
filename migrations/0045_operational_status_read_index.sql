-- Kitchen eligibility is based on status. Preserve legacy active rows that
-- carry a finished/cancelled timestamp; the stricter TV index0043 is unchanged.
CREATE INDEX orders_business_current_status_idx
  ON orders (business_id, created_at DESC, id DESC)
  WHERE status IN ('Em preparo', 'Agendado');
