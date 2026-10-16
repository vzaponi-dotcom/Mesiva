-- Derived candidate keys only; never rewrite orders, payments, movements or audit.
-- Values and eligibility remain authoritative in the joined source records.
CREATE VIEW order_financial_candidate_source AS
SELECT o.*,o.id AS order_id,p.id AS payment_id,p.amount_cents AS paid_amount_cents,
  p.method AS payment_method,p.paid_at,r.id AS refund_movement_id,
  CASE
    WHEN o.status <> 'Cancelado' AND NULLIF(p.id,'') IS NULL THEN 'unpaid'
    WHEN o.status = 'Cancelado' AND NULLIF(p.id,'') IS NOT NULL AND NULLIF(r.id,'') IS NULL THEN 'refund'
    ELSE NULL
  END AS candidate_kind
FROM orders o
LEFT JOIN payments p ON p.business_id=o.business_id AND p.order_id=o.id
LEFT JOIN movements r ON r.business_id=o.business_id AND r.order_id=o.id AND r.source='order-refund';

CREATE TABLE order_financial_candidates (
  business_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('unpaid','refund')),
  PRIMARY KEY(business_id,order_id),
  FOREIGN KEY(business_id,order_id) REFERENCES orders(business_id,id) ON DELETE CASCADE ON UPDATE CASCADE
) WITHOUT ROWID;
CREATE INDEX order_financial_candidates_kind_idx ON order_financial_candidates(business_id,kind,order_id);

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

CREATE TRIGGER financial_candidates_orders_update AFTER UPDATE OF status,id,business_id ON orders

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

CREATE TRIGGER financial_candidates_payments_update AFTER UPDATE OF id,order_id,business_id ON payments

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

CREATE TRIGGER financial_candidates_refund_update AFTER UPDATE OF id,source,order_id,business_id ON movements
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

-- Read visibility/candidate indexes; independent of retained terminal history.
CREATE INDEX orders_business_active_read_id_idx ON orders(business_id,id)
  WHERE status IN ('Em preparo','Agendado');
CREATE INDEX orders_business_client_read_idx ON orders(business_id,client_id,id)
  WHERE client_id IS NOT NULL;
CREATE INDEX orders_business_customer_read_idx ON orders(business_id,id)
  WHERE client_id IS NOT NULL;
