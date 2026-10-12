const cleanText = (value) => typeof value === 'string' ? value.trim() : ''

export const PAYMENT_ALLOCATIONS_JSON_SELECT = `p.receipt_id AS receipt_id,
  (SELECT COALESCE(json_group_array(json_object(
    'methodCode', allocation.method_code,
    'methodLabel', allocation.method_label,
    'amountCents', allocation.amount_cents
  )), '[]')
   FROM (
     SELECT pa.method_code, pa.method_label, pa.amount_cents
     FROM payment_allocations pa
     WHERE pa.business_id = o.business_id AND pa.receipt_id = p.receipt_id
     ORDER BY pa.created_at ASC, pa.id ASC
   ) allocation) AS payment_allocations_json`

export const parsePaymentAllocations = (row = {}) => {
  if (!row.payment_id) return []
  const structured = row.receipt_id != null || Object.hasOwn(row, 'payment_allocations_json')
  if (!structured) return []
  try {
    const parsed = JSON.parse(row.payment_allocations_json ?? '[]')
    if (!Array.isArray(parsed)) return []
    const allocations = parsed.map((allocation) => ({
      methodCode: allocation?.methodCode == null ? null : cleanText(allocation.methodCode),
      methodLabel: cleanText(allocation?.methodLabel),
      amountCents: Number(allocation?.amountCents),
    }))
    if (allocations.some((allocation) => (allocation.methodCode !== null && !allocation.methodCode)
      || !allocation.methodLabel
      || !Number.isSafeInteger(allocation.amountCents)
      || allocation.amountCents <= 0)) return []
    return allocations
  } catch {
    return []
  }
}


export const PAYMENT_SETTLEMENT_SQL_SELECT = `(
    COALESCE(p.amount_cents, 0) +
    COALESCE((SELECT SUM(e.amount_cents)
      FROM order_settlement_entries e
      WHERE e.business_id = o.business_id AND e.order_id = o.id
        AND e.kind = 'supplemental_payment'), 0)
  ) AS gross_received_cents,
  (
    COALESCE((SELECT SUM(e.amount_cents)
      FROM order_settlement_entries e
      WHERE e.business_id = o.business_id AND e.order_id = o.id
        AND e.kind = 'refund'), 0) +
    COALESCE((SELECT SUM(m.value_cents)
      FROM movements m
      WHERE m.business_id = o.business_id AND m.order_id = o.id
        AND m.source = 'order-refund' AND m.type = 'saida'
        AND m.deleted_at IS NULL), 0)
  ) AS refunded_cents`

export const deriveOrderSettlementBalance = ({ totalCents, grossReceivedCents, refundedCents }) => {
  for (const [key, value] of Object.entries({ totalCents, grossReceivedCents, refundedCents })) {
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('ORDER_BALANCE_INVALID_' + key)
  }
  if (refundedCents > grossReceivedCents) throw new RangeError('ORDER_BALANCE_INVALID_REFUND')
  const netReceivedCents = grossReceivedCents - refundedCents
  return {
    totalCents, grossReceivedCents, refundedCents, netReceivedCents,
    dueCents: Math.max(totalCents - netReceivedCents, 0),
    refundDueCents: Math.max(netReceivedCents - totalCents, 0),
  }
}

const settlementStatus = (balance, paid) => {
  if (balance.refundDueCents) return 'Devolução pendente'
  if (balance.dueCents) return balance.grossReceivedCents ? 'Parcialmente pago' : 'Pendente'
  return paid || balance.grossReceivedCents ? 'Pago' : 'Pendente'
}

export const mapOrderPaymentFields = (row = {}) => {
  const paid = Boolean(row.payment_id)
  const structured = row.receipt_id != null || Object.hasOwn(row, 'payment_allocations_json')
  const paymentAllocations = parsePaymentAllocations(row)
  const hasReceivedData = !paid || row.gross_received_cents != null || row.paid_amount_cents != null
  const balance = Number.isSafeInteger(row.total_cents) && hasReceivedData
    ? deriveOrderSettlementBalance({
      totalCents: row.total_cents,
      grossReceivedCents: row.gross_received_cents ?? (paid ? Number(row.paid_amount_cents || 0) : 0),
      refundedCents: row.refunded_cents ?? (row.refund_movement_id ? Number(row.paid_amount_cents || 0) : 0),
    })
    : null
  return {
    paymentStatus: balance ? settlementStatus(balance, paid) : paid ? 'Pago' : 'Pendente',
    paymentId: paid ? row.payment_id : null,
    paymentReceiptId: paid ? row.receipt_id ?? null : null,
    paymentMethod: paid
      ? (paymentAllocations.length === 1 ? paymentAllocations[0].methodLabel : structured ? null : row.payment_method ?? null)
      : null,
    paymentAllocations,
    paidAt: paid ? row.paid_at : null,
    ...(balance || {}),
  }
}
