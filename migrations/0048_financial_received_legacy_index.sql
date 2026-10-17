-- Isolate noncanonical creation timestamps for exact Date.parse compatibility.
CREATE INDEX movements_business_created_legacy_read_idx ON movements(business_id,id)
  WHERE deleted_at IS NULL AND (strftime('%Y-%m-%dT%H:%M:%fZ',created_at) IS NOT created_at);

-- Stable history paging and point lookup of the complete receipt composition.
CREATE INDEX movements_business_active_created_read_idx ON movements(business_id,created_at DESC,id DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX movements_business_receipt_created_read_idx ON movements(business_id,receipt_id,created_at DESC,id DESC)
  WHERE deleted_at IS NULL AND source='order-payment' AND receipt_id IS NOT NULL;
