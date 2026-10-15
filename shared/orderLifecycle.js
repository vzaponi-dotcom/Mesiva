const TERMINAL_STATUSES = new Set(['Finalizado', 'Cancelado'])

export const isOrderCancelled = (order) => order?.status === 'Cancelado'

export const isOrderFinished = (order) => TERMINAL_STATUSES.has(order?.status)

export const isOrderActive = (order) => !isOrderFinished(order)

export const getOrderRefundState = (order) => {
  if (!isOrderCancelled(order) || order?.paymentStatus !== 'Pago') return 'none'
  if (order?.refundState === 'refunded' || order?.refundedAt || order?.refundMovementId) return 'refunded'
  return 'pending'
}
