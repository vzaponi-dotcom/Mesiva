-- Acompanhamento por revisão/forma; os snapshots e lançamentos financeiros permanecem intactos.
CREATE TABLE daily_receipt_discrepancies (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  conference_id TEXT NOT NULL REFERENCES daily_receipt_conferences(id) ON DELETE CASCADE,
  business_date TEXT NOT NULL,
  line_index INTEGER NOT NULL,
  method TEXT NOT NULL,
  net_cents INTEGER NOT NULL,
  checked_cents INTEGER NOT NULL,
  difference_cents INTEGER NOT NULL CHECK (difference_cents <> 0 AND difference_cents = checked_cents - net_cents),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','resolved')),
  resolution_reason TEXT,
  resolution_note TEXT,
  resolution_reference TEXT,
  resolved_by TEXT,
  resolved_actor_name TEXT,
  resolved_at TEXT,
  UNIQUE (conference_id,line_index),
  CHECK ((status='pending' AND resolution_reason IS NULL AND resolution_note IS NULL AND resolved_at IS NULL)
    OR (status='resolved' AND resolution_reason IN ('conference_error','source_corrected','accepted_difference')
      AND length(trim(resolution_note)) BETWEEN 1 AND 1000 AND resolved_at IS NOT NULL
      AND resolved_actor_name IS NOT NULL AND (resolution_reason<>'source_corrected' OR length(trim(resolution_reference))>0)))
);
CREATE INDEX daily_receipt_discrepancies_status_idx
  ON daily_receipt_discrepancies(business_id,status,business_date DESC,id DESC);

INSERT INTO daily_receipt_discrepancies
  (id,business_id,conference_id,business_date,line_index,method,net_cents,checked_cents,difference_cents)
SELECT c.id || ':' || j.key,c.business_id,c.id,c.business_date,j.key,
  json_extract(j.value,'$.method'),json_extract(j.value,'$.netCents'),
  json_extract(j.value,'$.checkedCents'),json_extract(j.value,'$.differenceCents')
FROM daily_receipt_conferences c,json_each(c.snapshot_json) j
WHERE c.status='com_ressalva' AND json_extract(j.value,'$.differenceCents')<>0;

CREATE TRIGGER daily_receipt_discrepancies_insert AFTER INSERT ON daily_receipt_conferences
WHEN NEW.status='com_ressalva'
BEGIN
  INSERT INTO daily_receipt_discrepancies
    (id,business_id,conference_id,business_date,line_index,method,net_cents,checked_cents,difference_cents)
  SELECT NEW.id || ':' || j.key,NEW.business_id,NEW.id,NEW.business_date,j.key,
    json_extract(j.value,'$.method'),json_extract(j.value,'$.netCents'),
    json_extract(j.value,'$.checkedCents'),json_extract(j.value,'$.differenceCents')
  FROM json_each(NEW.snapshot_json) j WHERE json_extract(j.value,'$.differenceCents')<>0;
END;
