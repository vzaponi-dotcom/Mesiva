export const isOrderPaid = (order) => order?.paymentStatus === 'Pago'

export const getPendingAmount = (order) => isOrderPaid(order)
  ? 0
  : Math.max(0, Number(order?.total) || 0)

