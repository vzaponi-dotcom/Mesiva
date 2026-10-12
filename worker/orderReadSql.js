import { PAYMENT_ALLOCATIONS_JSON_SELECT } from './orderPaymentReadModel.js'
import { LATEST_OPERATIONAL_EDIT_JOIN, OPERATIONAL_EDIT_SELECT_FIELDS } from './orderEditSignalsRepository.js'

export const ORDER_SELECT = `SELECT o.id, o.order_number, o.client_id, o.client_name_snapshot,
  o.client_phone_snapshot, o.client_address_snapshot,
  o.customer_identity_type, o.table_tab_id, o.type, o.order_date, o.status,
  o.scheduled_for, o.promised_payment_date, o.is_backdated, o.subtotal_cents, o.delivery_fee_cents, o.adjustment_type, o.adjustment_mode,
  o.adjustment_value, o.adjustment_amount_cents, o.adjustment_reason, o.total_cents,
  o.content_revision, o.last_edited_at,
  o.created_at, o.finished_at, o.cancelled_at, o.cancel_reason, o.cancel_reason_note,
  cr.label AS cancel_reason_label,
  o.timing_policy_snapshot_json,
  p.id AS payment_id, p.method AS payment_method, p.paid_at, ${PAYMENT_ALLOCATIONS_JSON_SELECT},
  p.amount_cents AS paid_amount_cents,
  r.id AS refund_movement_id, r.created_at AS refund_created_at,
  tt.table_identifier AS table_identifier,
  tr.id AS table_reservation_id,
  tr.status AS table_reservation_status,
  tr.table_id AS reservation_table_id,
  COALESCE(rt.name, tr.table_name_snapshot) AS reservation_table_name,
  tr.revision AS reservation_revision,
  ${OPERATIONAL_EDIT_SELECT_FIELDS}
  FROM orders o
  LEFT JOIN payments p ON p.order_id = o.id AND p.business_id = o.business_id
  LEFT JOIN movements r ON r.order_id = o.id AND r.business_id = o.business_id
    AND r.source = 'order-refund'
  LEFT JOIN business_cancel_reasons cr ON cr.business_id = o.business_id AND cr.id = o.cancel_reason
  LEFT JOIN table_tabs tt ON tt.id = o.table_tab_id AND tt.business_id = o.business_id
  LEFT JOIN table_reservations tr ON tr.order_id = o.id AND tr.business_id = o.business_id
  LEFT JOIN tables rt ON rt.id = tr.table_id AND rt.business_id = tr.business_id
  ${LATEST_OPERATIONAL_EDIT_JOIN}`

export const ORDER_ITEM_SELECT = `SELECT id, order_id, product_id, name_snapshot,
  category_snapshot, size_snapshot, quantity, catalog_price_cents, unit_price_cents,
  price_reason, note, created_at FROM order_items`
