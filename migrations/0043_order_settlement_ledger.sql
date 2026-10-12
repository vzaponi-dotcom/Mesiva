-- Task 8 / Additive financial settlement foundation. No existing payment,
-- receipt, allocation, movement or order row is rewritten by this migration.
-- A supplemental receipt is attributed once to each order through its own
-- immutable entry. Payment composition remains at the shared receipt level.
--
-- Writers and readers are intentionally NOT activated by this schema change;
-- settlement balance/read models and monetary commands belong to Tasks 9-15.

-- Existing movements have a global PK. Add a composite candidate key so the
-- ledger can enforce tenant ownership through SQLite foreign keys (not merely
-- through an application WHERE clause).
CREATE UNIQUE INDEX movements_business_id_identity_idx
  ON movements(business_id, id);

CREATE TABLE order_settlement_entries (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  order_id TEXT NOT NULL,
  kind TEXT NOT NULL
    CHECK(kind IN ('supplemental_payment','refund')),
  amount_cents INTEGER NOT NULL
    CHECK(typeof(amount_cents) = 'integer' AND amount_cents > 0),
  receipt_id TEXT,
  movement_id TEXT,
  mutation_id TEXT NOT NULL
    CHECK(length(trim(mutation_id)) BETWEEN 1 AND 128),
  actor_user_id TEXT,
  actor_name TEXT NOT NULL
    CHECK(length(trim(actor_name)) BETWEEN 1 AND 120),
  created_at TEXT NOT NULL
    CHECK(length(trim(created_at)) >= 20),
  CHECK(
    (kind = 'supplemental_payment' AND receipt_id IS NOT NULL AND movement_id IS NULL)
    OR (kind = 'refund' AND receipt_id IS NULL AND movement_id IS NOT NULL)
  ),
  UNIQUE(business_id, id),
  UNIQUE(business_id, order_id, mutation_id),
  FOREIGN KEY(business_id, order_id)
    REFERENCES orders(business_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(business_id, receipt_id)
    REFERENCES payment_receipts(business_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(business_id, movement_id)
    REFERENCES movements(business_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(business_id, actor_user_id)
    REFERENCES users(business_id, id) ON DELETE RESTRICT
);

-- Financial balance readers will sum by (business_id, order_id, kind); they
-- must NEVER join an allocation and an order ledger row by receipt without
-- aggregation (a shared receipt can have many methods and many orders).
CREATE INDEX order_settlement_entries_order_idx
  ON order_settlement_entries(business_id, order_id, kind, created_at DESC);
CREATE INDEX order_settlement_entries_receipt_idx
  ON order_settlement_entries(business_id, receipt_id)
  WHERE receipt_id IS NOT NULL;
CREATE UNIQUE INDEX order_settlement_entries_receipt_order_unique_idx
  ON order_settlement_entries(business_id, receipt_id, order_id)
  WHERE kind = 'supplemental_payment';
CREATE UNIQUE INDEX order_settlement_entries_refund_movement_unique_idx
  ON order_settlement_entries(business_id, movement_id)
  WHERE kind = 'refund';

CREATE TRIGGER order_settlement_entries_immutable_update
BEFORE UPDATE ON order_settlement_entries
BEGIN
  SELECT RAISE(ABORT, 'ORDER_SETTLEMENT_IMMUTABLE');
END;
CREATE TRIGGER order_settlement_entries_immutable_delete
BEFORE DELETE ON order_settlement_entries
BEGIN
  SELECT RAISE(ABORT, 'ORDER_SETTLEMENT_IMMUTABLE');
END;

-- Never assign more of a receipt to orders than the real recorded receipt
-- total. The receipt can be shared with both legacy `payments` rows and
-- supplementary settlement entries. Allocations encode METHOD composition,
-- not a new independent amount for each order.
CREATE TRIGGER order_settlement_receipt_integrity_insert
BEFORE INSERT ON order_settlement_entries
WHEN NEW.kind = 'supplemental_payment'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM payment_receipts r
    WHERE r.id = NEW.receipt_id
      AND r.business_id = NEW.business_id
      AND r.total_cents = (
        SELECT COALESCE(SUM(a.amount_cents), 0)
        FROM payment_allocations a
        WHERE a.business_id = r.business_id AND a.receipt_id = r.id
      )
  ) THEN RAISE(ABORT, 'ORDER_SETTLEMENT_RECEIPT_INVALID') END;

  SELECT CASE WHEN (
    SELECT
      NEW.amount_cents
      + (SELECT COALESCE(SUM(e.amount_cents),0)
         FROM order_settlement_entries e
         WHERE e.business_id = NEW.business_id
           AND e.receipt_id = NEW.receipt_id
           AND e.kind = 'supplemental_payment')
      + (SELECT COALESCE(SUM(p.amount_cents),0)
         FROM payments p
         WHERE p.business_id = NEW.business_id
           AND p.receipt_id = NEW.receipt_id)
  ) > (
    SELECT r.total_cents FROM payment_receipts r
    WHERE r.id = NEW.receipt_id AND r.business_id = NEW.business_id
  ) THEN RAISE(ABORT, 'ORDER_SETTLEMENT_RECEIPT_OVERALLOCATED') END;
END;

-- The refund must represent an existing, non-deleted cash outflow for exactly
-- this order/company and exact amount. It never creates an automatic refund.
CREATE TRIGGER order_settlement_refund_integrity_insert
BEFORE INSERT ON order_settlement_entries
WHEN NEW.kind = 'refund'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM movements m
    WHERE m.business_id = NEW.business_id
      AND m.id = NEW.movement_id
      AND m.order_id = NEW.order_id
      AND m.type = 'saida'
      AND m.source = 'order-edit-refund'
      AND m.value_cents = NEW.amount_cents
      AND m.deleted_at IS NULL
  ) THEN RAISE(ABORT, 'ORDER_SETTLEMENT_REFUND_MISMATCH') END;
END;

-- A linked refund movement cannot silently change amount, ownership, source,
-- deletion state, or any other fields after being recognized by the ledger.
CREATE TRIGGER order_settlement_refund_movement_immutable_update
BEFORE UPDATE ON movements
WHEN EXISTS(
  SELECT 1 FROM order_settlement_entries e
  WHERE e.business_id = OLD.business_id
    AND e.movement_id = OLD.id AND e.kind = 'refund'
)
BEGIN
  SELECT RAISE(ABORT, 'ORDER_SETTLEMENT_MOVEMENT_IMMUTABLE');
END;
CREATE TRIGGER order_settlement_refund_movement_immutable_delete
BEFORE DELETE ON movements
WHEN EXISTS(
  SELECT 1 FROM order_settlement_entries e
  WHERE e.business_id = OLD.business_id
    AND e.movement_id = OLD.id AND e.kind = 'refund'
)
BEGIN
  SELECT RAISE(ABORT, 'ORDER_SETTLEMENT_MOVEMENT_IMMUTABLE');
END;

-- Once recognized by a settlement event, the amount and payment-method
-- composition of that shared receipt must remain frozen. Prior receipts are
-- unaffected unless they are subsequently referenced by a new ledger row.
CREATE TRIGGER order_settlement_receipt_amount_immutable_update
BEFORE UPDATE OF total_cents ON payment_receipts
WHEN EXISTS(
  SELECT 1 FROM order_settlement_entries e
  WHERE e.business_id = OLD.business_id
    AND e.receipt_id = OLD.id AND e.kind = 'supplemental_payment'
)
BEGIN
  SELECT RAISE(ABORT, 'ORDER_SETTLEMENT_RECEIPT_IMMUTABLE');
END;
CREATE TRIGGER order_settlement_allocations_immutable_update
BEFORE UPDATE ON payment_allocations
WHEN EXISTS(
  SELECT 1 FROM order_settlement_entries e
  WHERE e.business_id = OLD.business_id
    AND e.receipt_id = OLD.receipt_id AND e.kind = 'supplemental_payment'
)
BEGIN
  SELECT RAISE(ABORT, 'ORDER_SETTLEMENT_ALLOCATION_IMMUTABLE');
END;
CREATE TRIGGER order_settlement_allocations_immutable_delete
BEFORE DELETE ON payment_allocations
WHEN EXISTS(
  SELECT 1 FROM order_settlement_entries e
  WHERE e.business_id = OLD.business_id
    AND e.receipt_id = OLD.receipt_id AND e.kind = 'supplemental_payment'
)
BEGIN
  SELECT RAISE(ABORT, 'ORDER_SETTLEMENT_ALLOCATION_IMMUTABLE');
END;
CREATE TRIGGER order_settlement_allocations_immutable_insert
BEFORE INSERT ON payment_allocations
WHEN EXISTS(
  SELECT 1 FROM order_settlement_entries e
  WHERE e.business_id = NEW.business_id
    AND e.receipt_id = NEW.receipt_id AND e.kind = 'supplemental_payment'
)
BEGIN
  SELECT RAISE(ABORT, 'ORDER_SETTLEMENT_ALLOCATION_IMMUTABLE');
END;
