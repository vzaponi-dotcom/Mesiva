import { getOperationalDurationMinutes } from '../../../../shared/orderTiming.js'
import {filterOrdersByPeriod} from '../../../../shared/orderPeriodRead.js'
export {filterOrdersByPeriod,getDashboardDateRange} from '../../../../shared/orderPeriodRead.js'

export const calculateOperationalMetrics = (orders, period = '30d', now = new Date(), currentTiming) => {
  const eligible = filterOrdersByPeriod(orders, period, now)
    .filter((order) => order?.status === 'Finalizado' && order?.isBackdated !== true)
    .map((order) => ({ order, minutes: getOperationalDurationMinutes(order, currentTiming) }))
    .filter(({ minutes }) => Number.isFinite(minutes) && minutes >= 0)

  const durations = eligible.map(({ minutes }) => minutes)
  const sampleSize = durations.length
  const total = durations.reduce((sum, minutes) => sum + minutes, 0)
  const byType = { Entrega: 0, Retirada: 0, Local: 0 }
  const byTypeCounts = { Entrega: 0, Retirada: 0, Local: 0 }

  for (const { order, minutes } of eligible) {
    if (!(order.type in byType)) continue
    byType[order.type] += minutes
    byTypeCounts[order.type] += 1
  }

  return {
    sampleSize,
    averageMinutes: sampleSize ? total / sampleSize : 0,
    fastestMinutes: sampleSize ? Math.min(...durations) : 0,
    slowestMinutes: sampleSize ? Math.max(...durations) : 0,
    bands: [
      durations.filter((minutes) => minutes <= 20).length,
      durations.filter((minutes) => minutes >= 21 && minutes <= 30).length,
      durations.filter((minutes) => minutes >= 31 && minutes <= 40).length,
      durations.filter((minutes) => minutes > 40).length,
    ],
    byType: Object.fromEntries(Object.keys(byType).map((type) => [type, byTypeCounts[type] ? byType[type] / byTypeCounts[type] : 0])),
  }
}
