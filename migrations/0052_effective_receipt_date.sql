-- Effective financial date belongs to the receipt, not to the instant of registration.
-- Nullable until legacy receipts without reliable movement evidence are resolved.
ALTER TABLE payment_receipts
  ADD COLUMN received_date TEXT
  CHECK (received_date IS NULL OR received_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]');

-- Backfill only when all linked automatic receipt movements agree on their
-- financial day. Do not fabricate a UTC-to-local date from paid_at in SQLite:
-- historical America/Sao_Paulo DST rules require timezone-aware application code.
WITH unanimous AS (
  SELECT business_id, receipt_id, MIN(movement_date) AS financial_date
  FROM movements
  WHERE deleted_at IS NULL
    AND source = 'order-payment'
    AND type = 'entrada'
    AND receipt_id IS NOT NULL
  GROUP BY business_id, receipt_id
  HAVING MIN(movement_date) = MAX(movement_date)
    AND MIN(movement_date) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
)
UPDATE payment_receipts AS receipt
SET received_date = unanimous.financial_date
FROM unanimous
WHERE receipt.business_id = unanimous.business_id
  AND receipt.id = unanimous.receipt_id
  AND receipt.received_date IS NULL;

-- Period lookups use the receipt date. Legacy NULL rows need a safe explicit
-- paid_at timezone fallback in readers until a controlled historical backfill.
CREATE INDEX payment_receipts_business_received_date_idx
  ON payment_receipts (business_id, received_date, id)
  WHERE received_date IS NOT NULL;
