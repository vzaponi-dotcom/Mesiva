import { mapOrderItemRow, mapOrderRow } from './repositories.js'
import { ORDER_ITEM_SELECT, ORDER_SELECT } from './orderReadSql.js'

const rows = (result) => Array.isArray(result?.results) ? result.results : []

const mapOrdersWithItems = (orderRows, itemRows) => {
  const itemsByOrder = new Map()
  for (const itemRow of itemRows) {
    const current = itemsByOrder.get(itemRow.order_id) ?? []
    current.push(mapOrderItemRow(itemRow))
    itemsByOrder.set(itemRow.order_id, current)
  }
  return orderRows.map(orderRow => mapOrderRow(orderRow, itemsByOrder.get(orderRow.id) ?? []))
}

export const listOrders = async (db, businessId) => {
  const ordersResult = await db.prepare(`${ORDER_SELECT} WHERE o.business_id = ? ORDER BY o.created_at DESC`).bind(businessId).all()
  const itemsResult = await db.prepare(`${ORDER_ITEM_SELECT} WHERE business_id = ? ORDER BY created_at ASC`).bind(businessId).all()
  return mapOrdersWithItems(rows(ordersResult), rows(itemsResult))
}

// D1 permits 100 bound parameters: the company occupies one of them.
export const listOrdersByIds = async (db, businessId, ids) => {
  const uniqueIds = [...new Set(ids)]
  if (!uniqueIds.length) return []
  const orderRows = [], itemRows = []
  for (let offset = 0; offset < uniqueIds.length; offset += 99) {
    const selectedIds = uniqueIds.slice(offset, offset + 99)
    const placeholders = selectedIds.map(() => '?').join(',')
    const orders = await db.prepare(`${ORDER_SELECT}
      WHERE o.business_id = ? AND o.id IN (${placeholders})`)
      .bind(businessId, ...selectedIds).all()
    const items = await db.prepare(`${ORDER_ITEM_SELECT}
      WHERE business_id = ? AND order_id IN (${placeholders}) ORDER BY created_at ASC`)
      .bind(businessId, ...selectedIds).all()
    orderRows.push(...rows(orders))
    itemRows.push(...rows(items))
  }
  // Sorting after batching keeps the order independent of the request's ID order.
  orderRows.sort((a,b) => a.created_at === b.created_at
    ? (a.id < b.id ? 1 : a.id > b.id ? -1 : 0) : (a.created_at < b.created_at ? 1 : -1))
  return mapOrdersWithItems(orderRows, itemRows)
}
