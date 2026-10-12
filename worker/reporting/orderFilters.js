import {orderDueSql} from './settlementSql.js'

export function buildOrderFilters(businessId, query, alias = 'o') {
  const where = [`${alias}.business_id = ?`, `${alias}.order_date >= ?`, `${alias}.order_date <= ?`]
  const values = [businessId, query.from, query.to]
  const add = (condition, ...params) => { where.push(condition); values.push(...params) }
  if (query.type) add(`${alias}.type = ?`, query.type)
  if (query.status) add(`${alias}.status = ?`, query.status)
  if (query.schedule === 'scheduled') add(`${alias}.scheduled_for IS NOT NULL`)
  if (query.schedule === 'immediate') add(`${alias}.scheduled_for IS NULL`)
  if (query.customer) add(`(${alias}.client_id = ? OR ${alias}.client_name_snapshot LIKE ?)`, query.customer, `%${query.customer}%`)
  if (query.category) add(`EXISTS (
    SELECT 1 FROM order_items oi WHERE oi.business_id = ${alias}.business_id AND oi.order_id = ${alias}.id
      AND oi.category_snapshot = ? COLLATE NOCASE
  )`, query.category)
  if (query.product) add(`EXISTS (
    SELECT 1 FROM order_items oi WHERE oi.business_id = ${alias}.business_id AND oi.order_id = ${alias}.id
      AND (oi.product_id = ? OR (oi.product_id IS NULL AND json_array(oi.category_snapshot, oi.name_snapshot, oi.size_snapshot) = ?))
  )`, query.product, query.product)
  if (query.productName) add(`EXISTS (
    SELECT 1 FROM order_items oi WHERE oi.business_id = ${alias}.business_id AND oi.order_id = ${alias}.id
      AND instr(lower(oi.name_snapshot), lower(?)) > 0
  )`, query.productName)
  if (query.paymentMethod) add(`(
    EXISTS (SELECT 1 FROM payments p JOIN payment_allocations pa
      ON pa.business_id=p.business_id AND pa.receipt_id=p.receipt_id
      WHERE p.business_id=${alias}.business_id AND p.order_id=${alias}.id
        AND (pa.method_code=? OR pa.method_label=? COLLATE NOCASE))
    OR EXISTS (SELECT 1 FROM order_settlement_entries e JOIN payment_allocations pa
      ON pa.business_id=e.business_id AND pa.receipt_id=e.receipt_id
      WHERE e.business_id=${alias}.business_id AND e.order_id=${alias}.id
        AND e.kind='supplemental_payment'
        AND (pa.method_code=? OR pa.method_label=? COLLATE NOCASE))
  )`, query.paymentMethod,query.paymentMethod,query.paymentMethod,query.paymentMethod)
  if (query.receivable === 'unpaid') add(`${alias}.status <> 'Cancelado' AND ${alias}.total_cents > 0
    AND NOT (${alias}.customer_identity_type = 'table' AND ${alias}.table_tab_id IS NOT NULL)
    AND NOT EXISTS (
      SELECT 1 FROM table_reservations pending_reservation
      WHERE pending_reservation.business_id = ${alias}.business_id
        AND pending_reservation.order_id = ${alias}.id
    )
    AND ${orderDueSql(alias)} > 0`)
  if (query.search) add(`(${alias}.client_name_snapshot LIKE ? OR CAST(${alias}.order_number AS TEXT) LIKE ? OR ${alias}.client_phone_snapshot LIKE ?)`, `%${query.search}%`, `%${query.search}%`, `%${query.search}%`)
  return { sql: where.join(' AND '), values }
}
