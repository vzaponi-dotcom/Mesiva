-- Task 11: a durable, immutable receipt for each manually confirmed partial refund.
-- It exists solely to replay an uncertain D1/transport response without
-- duplicating a real cash exit. No automatic bank refund is performed.
CREATE TABLE order_partial_refund_mutation_receipts (
  business_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  mutation_id TEXT NOT NULL CHECK(length(trim(mutation_id)) BETWEEN 1 AND 128),
  request_hash TEXT NOT NULL CHECK(length(request_hash)=64 AND request_hash NOT GLOB '*[^0-9a-f]*'),
  settlement_entry_id TEXT NOT NULL,
  result_json TEXT NOT NULL CHECK(json_valid(result_json) AND json_type(result_json)='object'),
  created_at TEXT NOT NULL CHECK(length(trim(created_at))>=20),
  PRIMARY KEY(business_id,order_id,mutation_id),
  UNIQUE(business_id,settlement_entry_id),
  FOREIGN KEY(business_id,order_id) REFERENCES orders(business_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(business_id,settlement_entry_id)
    REFERENCES order_settlement_entries(business_id,id) ON DELETE RESTRICT
);
CREATE TRIGGER order_partial_refund_receipts_immutable_update
BEFORE UPDATE ON order_partial_refund_mutation_receipts BEGIN
  SELECT RAISE(ABORT,'ORDER_PARTIAL_REFUND_RECEIPT_IMMUTABLE');
END;
CREATE TRIGGER order_partial_refund_receipts_immutable_delete
BEFORE DELETE ON order_partial_refund_mutation_receipts BEGIN
  SELECT RAISE(ABORT,'ORDER_PARTIAL_REFUND_RECEIPT_IMMUTABLE');
END;
