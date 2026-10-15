export const HISTORY_TIMESTAMP_SQL="CASE WHEN status = 'Cancelado' THEN COALESCE(NULLIF(cancelled_at, ''), created_at) ELSE COALESCE(NULLIF(finished_at, ''), created_at) END"
export const HISTORY_STATUS_SQL="status IN ('Finalizado', 'Cancelado')"
// Only normalized UTC millisecond strings use the text timeline fast path.
// Noncanonical/invalid legacy dates retain Date.parse semantics in the Worker.
export const HISTORY_LEGACY_SQL=`(${HISTORY_TIMESTAMP_SQL} IS NULL OR strftime('%Y-%m-%dT%H:%M:%fZ', ${HISTORY_TIMESTAMP_SQL}) IS NOT ${HISTORY_TIMESTAMP_SQL})`
