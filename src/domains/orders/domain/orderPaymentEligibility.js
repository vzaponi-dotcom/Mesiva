import { hasCapability } from '../../../app/access.js'

import {isOrderPaid} from '../../../../shared/orderPaymentRead.js'
export {isOrderPaid,getPendingAmount} from '../../../../shared/orderPaymentRead.js'

const sourceCapability = Object.freeze({
  orders: 'orders.view',
  history: 'orders.history',
})

const hasTableRelationship = (order) => Boolean(
  order?.type === 'Local'
  || order?.tableReservationId
  || order?.tableTabId
  || order?.customerIdentityType === 'table'
  || order?.table
  || order?.tableId
  || order?.tableIdentifier,
)

export function canReceiveStandaloneOrder(order, granted, source) {
  const viewCapability = sourceCapability[source]
  return Boolean(
    order
    && viewCapability
    && hasCapability(granted, viewCapability)
    && hasCapability(granted, 'payments.receive')
    && !isOrderPaid(order)
    && order.status !== 'Cancelado'
    && !hasTableRelationship(order),
  )
}
