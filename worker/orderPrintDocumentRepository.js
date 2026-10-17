import { createOrderPrintDocument } from '../shared/orderPrintDocument.js'
import {mapOrderPaymentFields,PAYMENT_SETTLEMENT_SQL_SELECT} from './orderPaymentReadModel.js'

const rows = (result) => Array.isArray(result?.results) ? result.results : []

export const loadOrderPrintDocument = async (db, businessId, orderId) => {
  const order = await db.prepare(`SELECT
      o.id,
      o.order_number,
      o.client_name_snapshot,
      o.client_phone_snapshot,
      o.client_address_snapshot,
      o.client_id,
      o.customer_identity_type,
      COALESCE(tt.table_identifier, rt.name, tr.table_name_snapshot) AS table_identifier,
      tr.id AS reservation_id,
      o.type,
      o.order_date,
      o.scheduled_for,
      o.subtotal_cents,
      o.delivery_fee_cents,
      o.adjustment_type,
      o.adjustment_amount_cents,
      o.adjustment_reason,
      o.total_cents,
      o.created_at,
      b.name AS business_name,
      p.id AS payment_id,
      p.method AS payment_method,
      p.amount_cents AS paid_amount_cents,
      ${PAYMENT_SETTLEMENT_SQL_SELECT}
    FROM orders o
    JOIN businesses b ON b.id = o.business_id
    LEFT JOIN table_tabs tt ON tt.id = o.table_tab_id AND tt.business_id = o.business_id
    LEFT JOIN table_reservations tr ON tr.order_id = o.id AND tr.business_id = o.business_id
    LEFT JOIN tables rt ON rt.id = tr.table_id AND rt.business_id = tr.business_id
    LEFT JOIN payments p ON p.order_id = o.id AND p.business_id = o.business_id
    WHERE o.id = ? AND o.business_id = ?
    LIMIT 1`).bind(orderId, businessId).first()

  if (!order) return null

  const itemsResult = await db.prepare(`SELECT
      name_snapshot,
      size_snapshot,
      quantity,
      unit_price_cents,
      note
    FROM order_items
    WHERE order_id = ? AND business_id = ?
    ORDER BY created_at ASC, id ASC`).bind(orderId, businessId).all()

  return createOrderPrintDocument({
    businessName: order.business_name,
    orderId: order.id,
    orderNumber: order.order_number,
    orderDate: order.order_date,
    createdAt: order.created_at,
    type: order.type,
    scheduledFor: order.scheduled_for || '',
    scheduleLabel: order.scheduled_for ? (order.reservation_id ? 'RESERVA' : 'AGENDADO') : '',
    customerIdentityType: order.customer_identity_type,
    tableIdentifier: order.table_identifier,
    hasOptionalClient: Boolean(order.client_id),
    customer: {
      name: order.client_name_snapshot,
      phone: order.client_phone_snapshot || '',
      address: order.client_address_snapshot || '',
    },
    items: rows(itemsResult).map((item) => ({
      name: item.name_snapshot,
      presentation: item.size_snapshot || '',
      quantity: Number(item.quantity) || 1,
      note: item.note || '',
      unitPriceCents: Number(item.unit_price_cents) || 0,
    })),
    subtotalCents: Number(order.subtotal_cents) || 0,
    deliveryFeeCents: Number(order.delivery_fee_cents) || 0,
    adjustment: {
      type: order.adjustment_type || 'none',
      amountCents: Number(order.adjustment_amount_cents) || 0,
      reason: order.adjustment_reason || '',
    },
    totalCents: Number(order.total_cents) || 0,
    payment: {
      status: mapOrderPaymentFields(order).paymentStatus,
      method: order.payment_id ? (order.payment_method || '') : '',
    },
  })
}
