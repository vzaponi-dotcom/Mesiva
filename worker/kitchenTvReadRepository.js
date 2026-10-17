import { formatOrderCustomerIdentity } from '../shared/orderPrintDocument.js'
import { loadOperations } from './operationSettingsRepository.js'
import { loadOperationalEditSignals } from './orderEditSignalsRepository.js'
import { loadKitchenTvControl } from './kitchenTvControlRepository.js'

const rows = (result) => Array.isArray(result?.results) ? result.results : []

const ACTIVE_ORDERS_SELECT = `SELECT orders.id, orders.order_number, orders.client_name_snapshot,
  orders.customer_identity_type, tabs.table_identifier,
  COALESCE(reserved_tables.name, reservations.table_name_snapshot) AS reservation_table_name,
  orders.type, orders.status, orders.order_date, orders.created_at, orders.scheduled_for
  FROM orders
  LEFT JOIN table_tabs tabs ON tabs.id = orders.table_tab_id AND tabs.business_id = orders.business_id
  LEFT JOIN table_reservations reservations ON reservations.order_id = orders.id AND reservations.business_id = orders.business_id
  LEFT JOIN tables reserved_tables ON reserved_tables.id = reservations.table_id AND reserved_tables.business_id = orders.business_id
  WHERE orders.business_id = ?
    AND orders.status NOT IN ('Finalizado', 'Cancelado', 'Entregue', 'Despachado')
    AND orders.finished_at IS NULL
    AND orders.cancelled_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM kitchen_tv_hidden_orders hidden
      WHERE hidden.business_id = orders.business_id
        AND hidden.order_id = orders.id
    )
  ORDER BY orders.created_at ASC, orders.id ASC`

// Keep active orders as the outer loop: an ordinary join can scan all historical items.
const ACTIVE_ITEMS_SELECT = `SELECT i.order_id, i.quantity, i.name_snapshot, i.size_snapshot, i.note
  FROM orders o
  CROSS JOIN order_items i ON i.order_id = o.id AND i.business_id = o.business_id
  WHERE o.business_id = ?
    AND o.status NOT IN ('Finalizado', 'Cancelado', 'Entregue', 'Despachado')
    AND o.finished_at IS NULL
    AND o.cancelled_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM kitchen_tv_hidden_orders hidden
      WHERE hidden.business_id = o.business_id
        AND hidden.order_id = o.id
    )
  ORDER BY i.created_at ASC, i.id ASC`

export async function loadKitchenTvState(db, businessId) {
  const [operations, control, ordersResult, itemsResult, signals] = await Promise.all([
    loadOperations(db, businessId),
    loadKitchenTvControl(db, businessId),
    db.prepare(ACTIVE_ORDERS_SELECT).bind(businessId).all(),
    db.prepare(ACTIVE_ITEMS_SELECT).bind(businessId).all(),
    loadOperationalEditSignals(db,businessId),
  ])
  const itemsByOrder = new Map()
  for (const row of rows(itemsResult)) {
    const items = itemsByOrder.get(row.order_id) ?? []
    items.push({ quantity: row.quantity, name: row.name_snapshot, size: row.size_snapshot || '', note: row.note || '' })
    itemsByOrder.set(row.order_id, items)
  }

  return {
    timing: { ...operations.data.timing },
    control: {
      revision: control.revision,
      requestedPage: control.requestedPage,
      requestedModality: control.requestedModality,
    },
    orders: rows(ordersResult).map((row) => ({
      id: row.id,
      orderNumber: row.order_number,
      client: row.customer_identity_type === 'table'
        ? formatOrderCustomerIdentity({
          tableIdentifier: row.table_identifier || row.reservation_table_name,
          customerName: row.client_name_snapshot,
        }) || row.client_name_snapshot
        : row.client_name_snapshot,
      type: row.type,
      status: row.status,
      orderDate: row.order_date,
      createdAt: row.created_at,
      scheduledFor: row.scheduled_for,
      items: itemsByOrder.get(row.id) ?? [],
      ...(signals.get(row.id) || {}),
    })),
  }
}
