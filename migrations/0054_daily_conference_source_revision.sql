-- Metadata only: never rewrites receipts, allocations, payments or movements.
CREATE TABLE daily_receipt_source_revisions (
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  business_date TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  PRIMARY KEY (business_id, business_date)
);
INSERT INTO daily_receipt_source_revisions (business_id, business_date, revision)
SELECT business_id, movement_date, 1 FROM movements
WHERE source IN ('order-payment','order-refund','order-edit-refund')
GROUP BY business_id, movement_date;

ALTER TABLE daily_receipt_conferences ADD COLUMN actor_name TEXT NOT NULL DEFAULT 'Acesso legado';
ALTER TABLE daily_receipt_conferences ADD COLUMN request_hash TEXT;

CREATE TRIGGER daily_receipt_source_insert AFTER INSERT ON movements
WHEN NEW.source IN ('order-payment','order-refund','order-edit-refund')
BEGIN
  INSERT INTO daily_receipt_source_revisions VALUES (NEW.business_id, NEW.movement_date, 1)
  ON CONFLICT (business_id, business_date) DO UPDATE SET revision = revision + 1;
END;
CREATE TRIGGER daily_receipt_source_delete AFTER DELETE ON movements
WHEN OLD.source IN ('order-payment','order-refund','order-edit-refund')
  AND EXISTS (SELECT 1 FROM businesses WHERE id=OLD.business_id)
BEGIN
  INSERT INTO daily_receipt_source_revisions VALUES (OLD.business_id, OLD.movement_date, 1)
  ON CONFLICT (business_id, business_date) DO UPDATE SET revision = revision + 1;
END;
CREATE TRIGGER daily_receipt_source_update AFTER UPDATE ON movements
BEGIN
  INSERT INTO daily_receipt_source_revisions
  SELECT OLD.business_id, OLD.movement_date, 1
  WHERE OLD.source IN ('order-payment','order-refund','order-edit-refund')
  ON CONFLICT (business_id, business_date) DO UPDATE SET revision = revision + 1;
  INSERT INTO daily_receipt_source_revisions
  SELECT NEW.business_id, NEW.movement_date, 1
  WHERE NEW.source IN ('order-payment','order-refund','order-edit-refund')
    AND (OLD.source NOT IN ('order-payment','order-refund','order-edit-refund')
      OR OLD.business_id <> NEW.business_id OR OLD.movement_date <> NEW.movement_date)
  ON CONFLICT (business_id, business_date) DO UPDATE SET revision = revision + 1;
END;

-- Historical method fallbacks and receipt/allocation corrections also invalidate
-- the affected days, including changes that preserve all monetary aggregates.
CREATE TRIGGER daily_receipt_payment_update AFTER UPDATE ON payments
BEGIN
  INSERT INTO daily_receipt_source_revisions
  SELECT m.business_id, m.movement_date, 1 FROM movements m
  WHERE m.business_id=OLD.business_id AND m.payment_id=OLD.id
    AND m.source='order-payment' AND NULLIF(m.payment_method,'') IS NULL
  GROUP BY m.business_id, m.movement_date
  ON CONFLICT (business_id, business_date) DO UPDATE SET revision = revision + 1;
END;
CREATE TRIGGER daily_receipt_receipt_update AFTER UPDATE ON payment_receipts
BEGIN
  INSERT INTO daily_receipt_source_revisions
  SELECT m.business_id, m.movement_date, 1 FROM movements m
  WHERE m.business_id=OLD.business_id AND m.receipt_id=OLD.id AND m.source='order-payment'
  GROUP BY m.business_id, m.movement_date
  ON CONFLICT (business_id, business_date) DO UPDATE SET revision = revision + 1;
END;
CREATE TRIGGER daily_receipt_allocation_update AFTER UPDATE ON payment_allocations
BEGIN
  INSERT INTO daily_receipt_source_revisions
  SELECT m.business_id, m.movement_date, 1 FROM movements m
  WHERE m.business_id=OLD.business_id AND m.receipt_id=OLD.receipt_id AND m.source='order-payment'
  GROUP BY m.business_id, m.movement_date
  ON CONFLICT (business_id, business_date) DO UPDATE SET revision = revision + 1;
END;
