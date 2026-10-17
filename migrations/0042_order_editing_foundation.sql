-- Task 1 / Order editing foundation. Schema only: no edits or print jobs are performed here.
-- An order keeps its existing id/number and starts at revision 0 until its first
-- successful content mutation. Financial writes must not increment this revision.
CREATE UNIQUE INDEX orders_business_id_identity_idx
  ON orders(business_id, id);

ALTER TABLE orders ADD COLUMN content_revision INTEGER NOT NULL DEFAULT 0
  CHECK (typeof(content_revision) = 'integer' AND content_revision >= 0);
ALTER TABLE orders ADD COLUMN last_edited_at TEXT
  CHECK (last_edited_at IS NULL OR length(trim(last_edited_at)) >= 20);

-- The immutable operational history stores before/after fields privately.
-- The public kitchen/TV read model must project only non-sensitive deltas.
CREATE TABLE order_edit_revisions (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  order_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(typeof(revision) = 'integer' AND revision >= 1),
  actor_user_id TEXT,
  actor_name TEXT NOT NULL CHECK(length(trim(actor_name)) > 0),
  edited_at TEXT NOT NULL CHECK(length(trim(edited_at)) >= 20),
  before_total_cents INTEGER NOT NULL
    CHECK(typeof(before_total_cents) = 'integer' AND before_total_cents >= 0),
  after_total_cents INTEGER NOT NULL
    CHECK(typeof(after_total_cents) = 'integer' AND after_total_cents >= 0),
  changes_json TEXT NOT NULL
    CHECK(json_valid(changes_json) AND json_type(changes_json) = 'object'),
  UNIQUE(business_id, order_id, revision),
  FOREIGN KEY(business_id, order_id)
    REFERENCES orders(business_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(business_id, actor_user_id)
    REFERENCES users(business_id, id) ON DELETE RESTRICT
);
CREATE INDEX order_edit_revisions_business_time_idx
  ON order_edit_revisions(business_id, order_id, edited_at DESC, revision DESC);

CREATE TRIGGER order_edit_revisions_immutable_update
BEFORE UPDATE ON order_edit_revisions
BEGIN
  SELECT RAISE(ABORT, 'ORDER_EDIT_HISTORY_IMMUTABLE');
END;
CREATE TRIGGER order_edit_revisions_immutable_delete
BEFORE DELETE ON order_edit_revisions
BEGIN
  SELECT RAISE(ABORT, 'ORDER_EDIT_HISTORY_IMMUTABLE');
END;

-- A no-op has a receipt even though it does not generate a content revision.
-- A later writer must compare the request hash on replay and return the same
-- persisted result instead of silently treating a changed payload as success.
CREATE TABLE order_edit_mutation_receipts (
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  order_id TEXT NOT NULL,
  mutation_id TEXT NOT NULL CHECK(length(trim(mutation_id)) BETWEEN 1 AND 128),
  request_hash TEXT NOT NULL CHECK(length(request_hash) = 64 AND request_hash NOT GLOB '*[^0-9a-f]*'),
  result_revision INTEGER NOT NULL
    CHECK(typeof(result_revision) = 'integer' AND result_revision >= 0),
  changed INTEGER NOT NULL
    CHECK(changed IN (0,1) AND (changed = 0 OR result_revision > 0)),
  result_json TEXT NOT NULL CHECK(json_valid(result_json) AND json_type(result_json) = 'object'),
  created_at TEXT NOT NULL CHECK(length(trim(created_at)) >= 20),
  PRIMARY KEY (business_id, order_id, mutation_id),
  FOREIGN KEY(business_id, order_id)
    REFERENCES orders(business_id, id) ON DELETE RESTRICT
);

CREATE TRIGGER order_edit_mutation_receipts_immutable_update
BEFORE UPDATE ON order_edit_mutation_receipts
BEGIN
  SELECT RAISE(ABORT, 'ORDER_EDIT_RECEIPT_IMMUTABLE');
END;
CREATE TRIGGER order_edit_mutation_receipts_immutable_delete
BEFORE DELETE ON order_edit_mutation_receipts
BEGIN
  SELECT RAISE(ABORT, 'ORDER_EDIT_RECEIPT_IMMUTABLE');
END;

-- Acknowledgement is append-only per exact operational revision. Confirming
-- revision N cannot confirm a later revision N+1. The paired TV cannot write.
CREATE TABLE order_kitchen_edit_acknowledgements (
  business_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(typeof(revision) = 'integer' AND revision >= 1),
  acknowledged_by_user_id TEXT NOT NULL,
  acknowledged_at TEXT NOT NULL CHECK(length(trim(acknowledged_at)) >= 20),
  PRIMARY KEY (business_id, order_id, revision),
  FOREIGN KEY(business_id, order_id, revision)
    REFERENCES order_edit_revisions(business_id, order_id, revision)
    ON DELETE RESTRICT,
  FOREIGN KEY(business_id, acknowledged_by_user_id)
    REFERENCES users(business_id, id) ON DELETE RESTRICT
);

CREATE TRIGGER order_kitchen_edit_ack_immutable_update
BEFORE UPDATE ON order_kitchen_edit_acknowledgements
BEGIN
  SELECT RAISE(ABORT, 'ORDER_KITCHEN_ACK_IMMUTABLE');
END;
CREATE TRIGGER order_kitchen_edit_ack_immutable_delete
BEFORE DELETE ON order_kitchen_edit_acknowledgements
BEGIN
  SELECT RAISE(ABORT, 'ORDER_KITCHEN_ACK_IMMUTABLE');
END;

-- Existing builtin actors gain the new grant at migration time. Future builtin
-- roles are granted by worker/access/roles.js; custom roles are never widened.
INSERT INTO role_capabilities (business_id, role_id, capability)
SELECT business_id, id, 'orders.edit'
FROM roles
WHERE is_builtin = 1 AND code IN ('manager', 'operator')
ON CONFLICT (business_id, role_id, capability) DO NOTHING;
