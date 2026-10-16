-- Rebuild derived candidates only. Preserve all orders, payments, ledger and movements.
DROP TRIGGER financial_candidates_orders_insert;
DROP TRIGGER financial_candidates_orders_update;
DROP TRIGGER financial_candidates_payments_insert;
DROP TRIGGER financial_candidates_payments_update;
DROP TRIGGER financial_candidates_payments_delete;
DROP TRIGGER financial_candidates_refund_insert;
DROP TRIGGER financial_candidates_refund_update;
DROP TRIGGER financial_candidates_refund_delete;
DROP VIEW order_financial_candidate_source;
CREATE VIEW order_financial_candidate_source AS
SELECT balance.*,CASE
 WHEN status='Cancelado' AND net_received_cents>0 THEN 'refund'
 WHEN status<>'Cancelado' AND total_cents>net_received_cents THEN 'unpaid'
 WHEN status<>'Cancelado' AND net_received_cents>total_cents THEN 'refund'
 ELSE NULL END AS candidate_kind
FROM (SELECT source.*,gross_received_cents-refunded_cents AS net_received_cents
 FROM (SELECT o.*,o.id AS order_id,p.id AS payment_id,p.amount_cents AS paid_amount_cents,
 p.method AS payment_method,p.paid_at,(
    CASE WHEN NULLIF(p.id,'') IS NOT NULL THEN COALESCE(p.amount_cents,0) ELSE 0 END +
    COALESCE((SELECT SUM(e.amount_cents)
      FROM order_settlement_entries e
      WHERE e.business_id = o.business_id AND e.order_id = o.id
        AND e.kind = 'supplemental_payment'), 0)
  ) AS gross_received_cents,
  (
    COALESCE((SELECT SUM(e.amount_cents)
      FROM order_settlement_entries e
      WHERE e.business_id = o.business_id AND e.order_id = o.id
        AND e.kind = 'refund'), 0) +
    COALESCE((SELECT SUM(m.value_cents)
      FROM movements m
      WHERE m.business_id = o.business_id AND m.order_id = o.id
        AND m.source = 'order-refund' AND m.type = 'saida'
        AND m.deleted_at IS NULL), 0)
  ) AS refunded_cents
 FROM orders o LEFT JOIN payments p ON p.business_id=o.business_id AND p.order_id=o.id) source) balance;

DELETE FROM order_financial_candidates;
INSERT INTO order_financial_candidates(business_id,order_id,kind)
 SELECT business_id,order_id,candidate_kind FROM order_financial_candidate_source WHERE candidate_kind IS NOT NULL;

CREATE TRIGGER financial_candidates_orders_insert AFTER INSERT ON orders
BEGIN
  INSERT INTO order_financial_candidates(business_id,order_id,kind)
    SELECT business_id,order_id,candidate_kind FROM order_financial_candidate_source
    WHERE business_id=NEW.business_id AND order_id=NEW.id AND candidate_kind IS NOT NULL
    ON CONFLICT(business_id,order_id) DO UPDATE SET kind=excluded.kind
      WHERE order_financial_candidates.kind IS NOT excluded.kind;
  DELETE FROM order_financial_candidates
    WHERE business_id=NEW.business_id AND order_id=NEW.id AND NOT EXISTS (
      SELECT 1 FROM order_financial_candidate_source s WHERE s.business_id=NEW.business_id AND s.order_id=NEW.id AND s.candidate_kind IS NOT NULL
    );
END;

CREATE TRIGGER financial_candidates_orders_update AFTER UPDATE OF status,total_cents,id,business_id ON orders
BEGIN
  INSERT INTO order_financial_candidates(business_id,order_id,kind)
    SELECT business_id,order_id,candidate_kind FROM order_financial_candidate_source
    WHERE business_id=OLD.business_id AND order_id=OLD.id AND candidate_kind IS NOT NULL
    ON CONFLICT(business_id,order_id) DO UPDATE SET kind=excluded.kind
      WHERE order_financial_candidates.kind IS NOT excluded.kind;
  DELETE FROM order_financial_candidates
    WHERE business_id=OLD.business_id AND order_id=OLD.id AND NOT EXISTS (
      SELECT 1 FROM order_financial_candidate_source s WHERE s.business_id=OLD.business_id AND s.order_id=OLD.id AND s.candidate_kind IS NOT NULL
    );
  INSERT INTO order_financial_candidates(business_id,order_id,kind)
    SELECT business_id,order_id,candidate_kind FROM order_financial_candidate_source
    WHERE business_id=NEW.business_id AND order_id=NEW.id AND candidate_kind IS NOT NULL
    ON CONFLICT(business_id,order_id) DO UPDATE SET kind=excluded.kind
      WHERE order_financial_candidates.kind IS NOT excluded.kind;
  DELETE FROM order_financial_candidates
    WHERE business_id=NEW.business_id AND order_id=NEW.id AND NOT EXISTS (
      SELECT 1 FROM order_financial_candidate_source s WHERE s.business_id=NEW.business_id AND s.order_id=NEW.id AND s.candidate_kind IS NOT NULL
    );
END;

CREATE TRIGGER financial_candidates_orders_delete AFTER DELETE ON orders
BEGIN
  INSERT INTO order_financial_candidates(business_id,order_id,kind)
    SELECT business_id,order_id,candidate_kind FROM order_financial_candidate_source
    WHERE business_id=OLD.business_id AND order_id=OLD.id AND candidate_kind IS NOT NULL
    ON CONFLICT(business_id,order_id) DO UPDATE SET kind=excluded.kind
      WHERE order_financial_candidates.kind IS NOT excluded.kind;
  DELETE FROM order_financial_candidates
    WHERE business_id=OLD.business_id AND order_id=OLD.id AND NOT EXISTS (
      SELECT 1 FROM order_financial_candidate_source s WHERE s.business_id=OLD.business_id AND s.order_id=OLD.id AND s.candidate_kind IS NOT NULL
    );
END;

CREATE TRIGGER financial_candidates_payments_insert AFTER INSERT ON payments
BEGIN
  INSERT INTO order_financial_candidates(business_id,order_id,kind)
    SELECT business_id,order_id,candidate_kind FROM order_financial_candidate_source
    WHERE business_id=NEW.business_id AND order_id=NEW.order_id AND candidate_kind IS NOT NULL
    ON CONFLICT(business_id,order_id) DO UPDATE SET kind=excluded.kind
      WHERE order_financial_candidates.kind IS NOT excluded.kind;
  DELETE FROM order_financial_candidates
    WHERE business_id=NEW.business_id AND order_id=NEW.order_id AND NOT EXISTS (
      SELECT 1 FROM order_financial_candidate_source s WHERE s.business_id=NEW.business_id AND s.order_id=NEW.order_id AND s.candidate_kind IS NOT NULL
    );
END;

CREATE TRIGGER financial_candidates_payments_update AFTER UPDATE OF amount_cents,id,order_id,business_id ON payments
BEGIN
  INSERT INTO order_financial_candidates(business_id,order_id,kind)
    SELECT business_id,order_id,candidate_kind FROM order_financial_candidate_source
    WHERE business_id=OLD.business_id AND order_id=OLD.order_id AND candidate_kind IS NOT NULL
    ON CONFLICT(business_id,order_id) DO UPDATE SET kind=excluded.kind
      WHERE order_financial_candidates.kind IS NOT excluded.kind;
  DELETE FROM order_financial_candidates
    WHERE business_id=OLD.business_id AND order_id=OLD.order_id AND NOT EXISTS (
      SELECT 1 FROM order_financial_candidate_source s WHERE s.business_id=OLD.business_id AND s.order_id=OLD.order_id AND s.candidate_kind IS NOT NULL
    );
  INSERT INTO order_financial_candidates(business_id,order_id,kind)
    SELECT business_id,order_id,candidate_kind FROM order_financial_candidate_source
    WHERE business_id=NEW.business_id AND order_id=NEW.order_id AND candidate_kind IS NOT NULL
    ON CONFLICT(business_id,order_id) DO UPDATE SET kind=excluded.kind
      WHERE order_financial_candidates.kind IS NOT excluded.kind;
  DELETE FROM order_financial_candidates
    WHERE business_id=NEW.business_id AND order_id=NEW.order_id AND NOT EXISTS (
      SELECT 1 FROM order_financial_candidate_source s WHERE s.business_id=NEW.business_id AND s.order_id=NEW.order_id AND s.candidate_kind IS NOT NULL
    );
END;

CREATE TRIGGER financial_candidates_payments_delete AFTER DELETE ON payments
BEGIN
  INSERT INTO order_financial_candidates(business_id,order_id,kind)
    SELECT business_id,order_id,candidate_kind FROM order_financial_candidate_source
    WHERE business_id=OLD.business_id AND order_id=OLD.order_id AND candidate_kind IS NOT NULL
    ON CONFLICT(business_id,order_id) DO UPDATE SET kind=excluded.kind
      WHERE order_financial_candidates.kind IS NOT excluded.kind;
  DELETE FROM order_financial_candidates
    WHERE business_id=OLD.business_id AND order_id=OLD.order_id AND NOT EXISTS (
      SELECT 1 FROM order_financial_candidate_source s WHERE s.business_id=OLD.business_id AND s.order_id=OLD.order_id AND s.candidate_kind IS NOT NULL
    );
END;

CREATE TRIGGER financial_candidates_refund_insert AFTER INSERT ON movements
WHEN NEW.source='order-refund'
BEGIN
  INSERT INTO order_financial_candidates(business_id,order_id,kind)
    SELECT business_id,order_id,candidate_kind FROM order_financial_candidate_source
    WHERE business_id=NEW.business_id AND order_id=NEW.order_id AND candidate_kind IS NOT NULL
    ON CONFLICT(business_id,order_id) DO UPDATE SET kind=excluded.kind
      WHERE order_financial_candidates.kind IS NOT excluded.kind;
  DELETE FROM order_financial_candidates
    WHERE business_id=NEW.business_id AND order_id=NEW.order_id AND NOT EXISTS (
      SELECT 1 FROM order_financial_candidate_source s WHERE s.business_id=NEW.business_id AND s.order_id=NEW.order_id AND s.candidate_kind IS NOT NULL
    );
END;

CREATE TRIGGER financial_candidates_refund_update AFTER UPDATE OF value_cents,deleted_at,source,type,order_id,business_id ON movements
WHEN OLD.source='order-refund' OR NEW.source='order-refund'
BEGIN
  INSERT INTO order_financial_candidates(business_id,order_id,kind)
    SELECT business_id,order_id,candidate_kind FROM order_financial_candidate_source
    WHERE business_id=OLD.business_id AND order_id=OLD.order_id AND candidate_kind IS NOT NULL
    ON CONFLICT(business_id,order_id) DO UPDATE SET kind=excluded.kind
      WHERE order_financial_candidates.kind IS NOT excluded.kind;
  DELETE FROM order_financial_candidates
    WHERE business_id=OLD.business_id AND order_id=OLD.order_id AND NOT EXISTS (
      SELECT 1 FROM order_financial_candidate_source s WHERE s.business_id=OLD.business_id AND s.order_id=OLD.order_id AND s.candidate_kind IS NOT NULL
    );
  INSERT INTO order_financial_candidates(business_id,order_id,kind)
    SELECT business_id,order_id,candidate_kind FROM order_financial_candidate_source
    WHERE business_id=NEW.business_id AND order_id=NEW.order_id AND candidate_kind IS NOT NULL
    ON CONFLICT(business_id,order_id) DO UPDATE SET kind=excluded.kind
      WHERE order_financial_candidates.kind IS NOT excluded.kind;
  DELETE FROM order_financial_candidates
    WHERE business_id=NEW.business_id AND order_id=NEW.order_id AND NOT EXISTS (
      SELECT 1 FROM order_financial_candidate_source s WHERE s.business_id=NEW.business_id AND s.order_id=NEW.order_id AND s.candidate_kind IS NOT NULL
    );
END;

CREATE TRIGGER financial_candidates_refund_delete AFTER DELETE ON movements
WHEN OLD.source='order-refund'
BEGIN
  INSERT INTO order_financial_candidates(business_id,order_id,kind)
    SELECT business_id,order_id,candidate_kind FROM order_financial_candidate_source
    WHERE business_id=OLD.business_id AND order_id=OLD.order_id AND candidate_kind IS NOT NULL
    ON CONFLICT(business_id,order_id) DO UPDATE SET kind=excluded.kind
      WHERE order_financial_candidates.kind IS NOT excluded.kind;
  DELETE FROM order_financial_candidates
    WHERE business_id=OLD.business_id AND order_id=OLD.order_id AND NOT EXISTS (
      SELECT 1 FROM order_financial_candidate_source s WHERE s.business_id=OLD.business_id AND s.order_id=OLD.order_id AND s.candidate_kind IS NOT NULL
    );
END;

CREATE TRIGGER financial_candidates_settlement_insert AFTER INSERT ON order_settlement_entries
BEGIN
  INSERT INTO order_financial_candidates(business_id,order_id,kind)
    SELECT business_id,order_id,candidate_kind FROM order_financial_candidate_source
    WHERE business_id=NEW.business_id AND order_id=NEW.order_id AND candidate_kind IS NOT NULL
    ON CONFLICT(business_id,order_id) DO UPDATE SET kind=excluded.kind
      WHERE order_financial_candidates.kind IS NOT excluded.kind;
  DELETE FROM order_financial_candidates
    WHERE business_id=NEW.business_id AND order_id=NEW.order_id AND NOT EXISTS (
      SELECT 1 FROM order_financial_candidate_source s WHERE s.business_id=NEW.business_id AND s.order_id=NEW.order_id AND s.candidate_kind IS NOT NULL
    );
END;
