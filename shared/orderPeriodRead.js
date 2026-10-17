const toLocalDateValue=date=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`
const isOrderCancelled=order=>order?.status==='Cancelado'
const PERIOD_DAYS = { today: 1, '7d': 7, '30d': 30 }
const localNoon = (value) => new Date(value.getFullYear(), value.getMonth(), value.getDate(), 12, 0, 0)

export const getDashboardDateRange = (period = '30d', now = new Date()) => {
  const days = PERIOD_DAYS[period] ?? PERIOD_DAYS['30d']
  const end = localNoon(now instanceof Date ? now : new Date(now))

  return Array.from({ length: days }, (_, index) => {
    const date = new Date(end)
    date.setDate(end.getDate() - (days - 1 - index))
    return toLocalDateValue(date)
  })
}

export const filterOrdersByPeriod = (orders, period = '30d', now = new Date()) => {
  const dates = new Set(getDashboardDateRange(period, now))
  return (Array.isArray(orders) ? orders : [])
    .filter((order) => !isOrderCancelled(order))
    .filter((order) => dates.has(order?.orderDate))
}
