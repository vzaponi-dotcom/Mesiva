-- Durable replay for one shared client receipt, including mixed supplemental balances.
CREATE TABLE client_payment_mutation_receipts (
 business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
 -- Historical identity survives normal client deletion, like receipt/order snapshots.
 client_id TEXT NOT NULL,
 mutation_id TEXT NOT NULL CHECK(length(trim(mutation_id)) BETWEEN 1 AND 128),
 request_hash TEXT NOT NULL,
 receipt_id TEXT NOT NULL,
 order_ids_json TEXT NOT NULL CHECK(json_valid(order_ids_json)),
 created_at TEXT NOT NULL,
 PRIMARY KEY(business_id,mutation_id),
 FOREIGN KEY(business_id,receipt_id) REFERENCES payment_receipts(business_id,id) ON DELETE RESTRICT
);
CREATE TRIGGER client_payment_receipts_immutable_update BEFORE UPDATE ON client_payment_mutation_receipts
BEGIN SELECT RAISE(ABORT,'CLIENT_PAYMENT_RECEIPT_IMMUTABLE'); END;
CREATE TRIGGER client_payment_receipts_immutable_delete BEFORE DELETE ON client_payment_mutation_receipts
BEGIN SELECT RAISE(ABORT,'CLIENT_PAYMENT_RECEIPT_IMMUTABLE'); END;
