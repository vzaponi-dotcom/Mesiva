import { isScheduledWaiting } from './orderTiming.js'
import { isOrderActive } from './orderLifecycle.js'

const FINISHED_STATUSES = new Set(['Finalizado', 'Entregue', 'Despachado'])
const isActiveOrder = (order) => Boolean(order?.id) && isOrderActive(order) && !FINISHED_STATUSES.has(order?.status)

export const activeOrderIdSet = (orders = []) => new Set(
  orders.filter(isActiveOrder).map((order) => String(order.id)),
)

export const getNewActiveOrderIds = (previousIds, orders = []) => {
  const knownIds = previousIds instanceof Set ? previousIds : new Set(previousIds ?? [])
  return [...activeOrderIdSet(orders)].filter((id) => !knownIds.has(id))
}

export const operationalOrderIdSet = (orders = [], now = new Date(), currentTiming) => new Set(
  orders.filter((order) => isActiveOrder(order) && !isScheduledWaiting(order, now, currentTiming)).map((order) => String(order.id)),
)

export const getOperationalOrderCount = (orders = [], now = new Date(), currentTiming) => operationalOrderIdSet(orders, now, currentTiming).size

export const getNewOperationalOrderIds = (previousIds, orders = [], now = new Date(), currentTiming) => {
  const knownIds = previousIds instanceof Set ? previousIds : new Set(previousIds ?? [])
  return [...operationalOrderIdSet(orders, now, currentTiming)].filter((id) => !knownIds.has(id))
}

export const detectOperationalArrivals = (previousIds, orders = [], now = new Date(), alertedIds = new Set(), currentTiming) => {
  const currentIds = operationalOrderIdSet(orders, now, currentTiming)
  if (previousIds === undefined || previousIds === null) return { currentIds, newIds: [] }
  const knownIds = previousIds instanceof Set ? previousIds : new Set(previousIds)
  const alreadyAlerted = alertedIds instanceof Set ? alertedIds : new Set(alertedIds ?? [])
  const newIds = [...currentIds].filter((id) => !knownIds.has(id) && !alreadyAlerted.has(id))
  return { currentIds, newIds }
}
