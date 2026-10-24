-- Conference receipt-to-order lookup: bounded by company and receipt, not all paid orders.
CREATE INDEX IF NOT EXISTS payments_business_receipt_order_idx
  ON payments (business_id, receipt_id, order_id)
  WHERE receipt_id IS NOT NULL;
