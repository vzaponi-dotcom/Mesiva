const rows = (result) => Array.isArray(result?.results) ? result.results : []

export const mapTableReservationRow = (row) => row ? ({
  id: row.id,
  orderId: row.order_id,
  orderNumber: Number(row.order_number),
  tableId: row.table_id,
  tableName: row.table_name || row.table_name_snapshot,
  status: row.status,
  scheduledFor: row.scheduled_for,
  endsAt: row.ends_at,
  durationMinutes: Number(row.duration_minutes),
  revision: Number(row.revision),
  convertedTableTabId: row.converted_table_tab_id ?? null,
  convertedAt: row.converted_at ?? null,
  cancelledAt: row.cancelled_at ?? null,
  noShowAt: row.no_show_at ?? null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  clientId: row.client_id ?? null,
  clientName: row.client_name || '',
  itemCount: Number(row.item_count || 0),
  totalCents: Number(row.total_cents || 0),
  orderStatus: row.order_status,
}) : null

const reservationSelect = `SELECT
  tr.id,
  tr.business_id,
  tr.order_id,
  tr.table_id,
  tr.table_name_snapshot,
  tr.status,
  tr.scheduled_for,
  tr.ends_at,
  tr.duration_minutes,
  tr.revision,
  tr.converted_table_tab_id,
  tr.converted_at,
  tr.cancelled_at,
  tr.no_show_at,
  tr.created_at,
  tr.updated_at,
  COALESCE(t.name, tr.table_name_snapshot) AS table_name,
  o.order_number,
  o.client_id,
  CASE WHEN o.client_id IS NOT NULL THEN o.client_name_snapshot ELSE '' END AS client_name,
  o.status AS order_status,
  o.total_cents,
  COALESCE(item_totals.item_count, 0) AS item_count
FROM table_reservations tr
JOIN orders o
  ON o.id = tr.order_id
 AND o.business_id = tr.business_id
LEFT JOIN tables t
  ON t.id = tr.table_id
 AND t.business_id = tr.business_id
LEFT JOIN (
  SELECT business_id, order_id, COALESCE(SUM(quantity), 0) AS item_count
  FROM order_items
  GROUP BY business_id, order_id
) item_totals
  ON item_totals.business_id = tr.business_id
 AND item_totals.order_id = tr.order_id`

export const loadTableReservationById = async (db, businessId, reservationId) => {
  const row = await db.prepare(`${reservationSelect}
    WHERE tr.business_id = ? AND tr.id = ?
    LIMIT 1`).bind(businessId, reservationId).first()
  return mapTableReservationRow(row)
}

export const loadTableReservationByOrderId = async (db, businessId, orderId) => {
  const row = await db.prepare(`${reservationSelect}
    WHERE tr.business_id = ? AND tr.order_id = ?
    LIMIT 1`).bind(businessId, orderId).first()
  return mapTableReservationRow(row)
}

export const listTableReservations = async (db, businessId, filters = {}) => {
  const clauses = ['tr.business_id = ?']
  const values = [businessId]

  if (filters.status) {
    clauses.push('tr.status = ?')
    values.push(filters.status)
  }
  if (filters.tableId) {
    clauses.push('tr.table_id = ?')
    values.push(filters.tableId)
  }
  if (filters.from) {
    clauses.push('tr.scheduled_for >= ?')
    values.push(filters.from)
  }
  if (filters.to) {
    clauses.push('tr.scheduled_for < ?')
    values.push(filters.to)
  }

  const result = await db.prepare(`${reservationSelect}
    WHERE ${clauses.join(' AND ')}
    ORDER BY tr.scheduled_for ASC, tr.id ASC`).bind(...values).all()
  return rows(result).map(mapTableReservationRow)
}

export const prepareNextTableReservations = (db, businessId) => db.prepare(`${reservationSelect}
    WHERE tr.business_id = ?
      AND tr.status = 'reserved'
      AND NOT EXISTS (
        SELECT 1
        FROM table_reservations earlier
        WHERE earlier.business_id = tr.business_id
          AND earlier.table_id = tr.table_id
          AND earlier.status = 'reserved'
          AND (
            earlier.scheduled_for < tr.scheduled_for
            OR (earlier.scheduled_for = tr.scheduled_for AND earlier.id < tr.id)
          )
      )
    ORDER BY tr.scheduled_for ASC, tr.id ASC`).bind(businessId)

export const listNextTableReservations = async (db, businessId) =>
  rows(await prepareNextTableReservations(db, businessId).all()).map(mapTableReservationRow)

export const loadNextTableReservationForTable = async (db, businessId, tableId) => {
  const row = await db.prepare(`${reservationSelect}
    WHERE tr.business_id = ?
      AND tr.table_id = ?
      AND tr.status = 'reserved'
    ORDER BY tr.scheduled_for ASC, tr.id ASC
    LIMIT 1`).bind(businessId, tableId).first()
  return mapTableReservationRow(row)
}
