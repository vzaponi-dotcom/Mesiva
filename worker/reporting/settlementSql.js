// Canonical correlated aggregations for reports. The receipt total and its
// payment methods are never joined to an order (shared receipts otherwise
// multiply monetary amounts). Keep this aligned with Task 9 read model.
export const orderGrossReceivedSql = (alias='o') => `(
  COALESCE((SELECT SUM(p.amount_cents) FROM payments p
    WHERE p.business_id=${alias}.business_id AND p.order_id=${alias}.id),0)
  + COALESCE((SELECT SUM(e.amount_cents) FROM order_settlement_entries e
    WHERE e.business_id=${alias}.business_id AND e.order_id=${alias}.id
      AND e.kind='supplemental_payment'),0)
)`

export const orderRefundedSql = (alias='o') => `(
  COALESCE((SELECT SUM(e.amount_cents) FROM order_settlement_entries e
    WHERE e.business_id=${alias}.business_id AND e.order_id=${alias}.id
      AND e.kind='refund'),0)
  + COALESCE((SELECT SUM(m.value_cents) FROM movements m
    WHERE m.business_id=${alias}.business_id AND m.order_id=${alias}.id
      AND m.source='order-refund' AND m.type='saida' AND m.deleted_at IS NULL),0)
)`

export const orderNetReceivedSql = alias => `(${orderGrossReceivedSql(alias)}-${orderRefundedSql(alias)})`
export const orderDueSql = (alias='o') => `MAX(0,${alias}.total_cents-${orderNetReceivedSql(alias)})`
export const orderRefundDueSql = (alias='o') => `MAX(0,${orderNetReceivedSql(alias)}-${alias}.total_cents)`
