-- Conferência de recebimentos é independente de sessão/gaveta do Caixa Operacional.
CREATE TABLE daily_receipt_conferences (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  business_date TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  source_version TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('conferida', 'com_ressalva')),
  user_id TEXT,
  request_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (business_id, business_date, revision),
  UNIQUE (business_id, business_date, source_version),
  UNIQUE (business_id, request_key)
);
CREATE INDEX daily_receipt_conferences_history_idx
  ON daily_receipt_conferences (business_id, business_date DESC, revision DESC);
