export const isOrderPaid = (order) => order?.paymentStatus === 'Pago'

export const getPendingAmount = (order) => Number.isSafeInteger(order?.dueCents)
  ? Math.max(0, order.dueCents) / 100
  : isOrderPaid(order) ? 0 : Math.max(0, Number(order?.total) || 0)

export const hasSupplementalBalance = order => Boolean(order?.paymentId)
  && order.paymentStatus==='Parcialmente pago'
  && Number.isSafeInteger(order.dueCents) && order.dueCents>0
  && Number.isSafeInteger(order.totalCents) && order.totalCents>0
  && Number.isSafeInteger(order.netReceivedCents) && Number.isSafeInteger(order.contentRevision)
  && ['Em preparo','Finalizado'].includes(order.status) && order.tableReservationStatus!=='reserved'
