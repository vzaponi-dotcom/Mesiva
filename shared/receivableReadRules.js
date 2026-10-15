const DAY_MS = 86_400_000
const timingRank = { overdue: 0, today: 1, upcoming: 2 }

const requireOrderRules = (rules) => {
  if (
    typeof rules?.isOrderCancelled !== 'function'
    || typeof rules?.isOrderPaid !== 'function'
    || typeof rules?.getPendingAmount !== 'function'
  ) throw new TypeError('Receivables requires Orders financial rules')
  return rules
}

const isoDayNumber = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ''))
  if (!match) return null
  const [, rawYear, rawMonth, rawDay] = match
  const year = Number(rawYear)
  const month = Number(rawMonth)
  const day = Number(rawDay)
  const timestamp = Date.UTC(year, month - 1, day)
  const parsed = new Date(timestamp)
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return null
  return timestamp / DAY_MS
}

const isoFromDayNumber = (dayNumber) => new Date(dayNumber * DAY_MS).toISOString().slice(0, 10)

const isRegisteredClientOrder = (order) => Boolean(
  order?.clientId && (!order?.customerIdentityType || order.customerIdentityType === 'registered_client'),
)

const isTableTabOrder = (order) => order?.customerIdentityType === 'table' && Boolean(order?.tableTabId)
const isReservationOrder = (order) => Boolean(order?.tableReservationId)

const groupKey = (order) => {
  if (isRegisteredClientOrder(order)) return `client:${order.clientId}`
  if (isTableTabOrder(order)) return `table-tab:${order.tableTabId}`
  return `order:${order?.id}`
}

export const getPendingReceivableOrders = (orders = [], orderRules) => {
  const { isOrderCancelled, isOrderPaid } = requireOrderRules(orderRules)
  return (Array.isArray(orders) ? orders : [])
    .filter((order) => !isOrderCancelled(order) && !isOrderPaid(order) && !isReservationOrder(order))
}

export const getPaidReceivableOrders = (orders = [], orderRules) => {
  const { isOrderCancelled, isOrderPaid } = requireOrderRules(orderRules)
  return (Array.isArray(orders) ? orders : [])
    .filter((order) => !isOrderCancelled(order) && isOrderPaid(order) && !isTableTabOrder(order) && !isReservationOrder(order))
}

export const getExpectedPaymentDate = (order) => order?.promisedPaymentDate || order?.orderDate || null

export const getReceivableTiming = (order, today, orderRules) => {
  const { isOrderCancelled, isOrderPaid } = requireOrderRules(orderRules)
  const expectedDate = getExpectedPaymentDate(order)
  if (isOrderCancelled(order)) return { status: 'excluded', expectedDate, daysOverdue: 0 }
  if (isOrderPaid(order)) return { status: 'paid', expectedDate, daysOverdue: 0 }
  const expectedDay = isoDayNumber(expectedDate)
  const todayDay = isoDayNumber(today)
  if (expectedDay == null || todayDay == null) return { status: 'today', expectedDate, daysOverdue: 0 }
  if (expectedDay < todayDay) return { status: 'overdue', expectedDate, daysOverdue: todayDay - expectedDay }
  if (expectedDay > todayDay) return { status: 'upcoming', expectedDate, daysOverdue: 0 }
  return { status: 'today', expectedDate, daysOverdue: 0 }
}

export const getDaysOverdue = (order, today, orderRules) => getReceivableTiming(order, today, orderRules).daysOverdue

const emptyTotals = () => ({ amount: 0, count: 0 })

export const calculateReceivableSummary = (orders, today, orderRules) => {
  const summary = { today: emptyTotals(), upcoming: emptyTotals(), overdue: emptyTotals() }
  for (const entry of buildPendingReceivableEntries(orders, today, orderRules)) {
    const bucket = summary[entry.timing.status]
    if (!bucket) continue
    bucket.amount += entry.total
    bucket.count += 1
  }
  return summary
}

export const buildReceivablesForecast = (orders, today, horizonDays = 7, orderRules) => {
  const todayDay = isoDayNumber(today)
  const days = Array.from({ length: horizonDays }, (_, index) => ({
    date: todayDay == null ? null : isoFromDayNumber(todayDay + index + 1), amount: 0, count: 0,
  }))
  const result = { overdue: emptyTotals(), today: emptyTotals(), days, later: emptyTotals() }
  for (const entry of buildPendingReceivableEntries(orders, today, orderRules)) {
    const { timing } = entry
    const amount = entry.total
    if (timing.status === 'overdue' || timing.status === 'today') {
      result[timing.status].amount += amount
      result[timing.status].count += 1
      continue
    }
    const delta = isoDayNumber(timing.expectedDate) - todayDay
    const bucket = delta >= 1 && delta <= horizonDays ? result.days[delta - 1] : result.later
    bucket.amount += amount
    bucket.count += 1
  }
  return result
}

export const formatTableIdentifierLabel = (value) => {
  const identifier = String(value ?? '').trim()
  return /^\d+$/.test(identifier) ? `Mesa ${identifier}` : identifier
}

export const buildPendingReceivableEntries = (orders = [], today, orderRules) => {
  const { getPendingAmount } = requireOrderRules(orderRules)
  return getPendingReceivableOrders(orders, orderRules)
    .filter((order) => !isTableTabOrder(order))
    .map((order) => ({
      key: `order:${order.id}`,
      kind: 'order',
      order,
      orders: [order],
      label: order.client || 'Pedido sem identificação',
      total: getPendingAmount(order),
      expectedDate: getExpectedPaymentDate(order),
      timing: getReceivableTiming(order, today, orderRules),
      createdAt: order.createdAt || '',
    }))
}

export const sortReceivableEntries = (entries = [], sortMode = 'urgency') => [...(Array.isArray(entries) ? entries : [])]
  .sort((left, right) => {
    if (sortMode === 'recent') return String(right.createdAt).localeCompare(String(left.createdAt))
    if (sortMode === 'value-desc') return right.total - left.total || String(left.createdAt).localeCompare(String(right.createdAt))
    return (timingRank[left.timing?.status] ?? 99) - (timingRank[right.timing?.status] ?? 99)
      || String(left.expectedDate || '').localeCompare(String(right.expectedDate || ''))
      || String(left.createdAt || '').localeCompare(String(right.createdAt || ''))
  })

const receivableEntryTimingCompare = (left, right) => (
  (timingRank[left?.timing?.status] ?? 99) - (timingRank[right?.timing?.status] ?? 99)
  || String(left?.expectedDate || left?.timing?.expectedDate || '').localeCompare(String(right?.expectedDate || right?.timing?.expectedDate || ''))
  || String(left?.createdAt || '').localeCompare(String(right?.createdAt || ''))
)

const groupLabelCompare = (left, right) => String(left?.label || '').localeCompare(String(right?.label || ''), 'pt-BR', { sensitivity: 'base' })

export const groupReceivableEntriesByClient = (entries = []) => {
  const grouped = new Map()

  for (const entry of Array.isArray(entries) ? entries : []) {
    const order = entry?.order
    if (!order?.id) continue
    const registeredClient = isRegisteredClientOrder(order)
    const key = registeredClient ? `client:${order.clientId}` : (entry.key || `order:${order.id}`)
    const current = grouped.get(key) ?? {
      key,
      kind: registeredClient ? 'client' : 'single',
      clientId: registeredClient ? order.clientId : null,
      label: order.client || entry.label || 'Pedido sem identificação',
      phone: order.clientPhone || '',
      entries: [],
      orders: [],
      count: 0,
      total: 0,
      timing: null,
      earliestExpectedDate: '',
      oldestCreatedAt: '',
      newestCreatedAt: '',
    }

    current.entries.push(entry)
    current.orders.push(order)
    current.count += 1
    current.total += Number(entry.total) || 0
    if (!current.phone && order.clientPhone) current.phone = order.clientPhone

    const expectedDate = String(entry.expectedDate || entry.timing?.expectedDate || '')
    if (expectedDate && (!current.earliestExpectedDate || expectedDate < current.earliestExpectedDate)) {
      current.earliestExpectedDate = expectedDate
    }

    const createdAt = String(entry.createdAt || '')
    if (createdAt && (!current.oldestCreatedAt || createdAt < current.oldestCreatedAt)) current.oldestCreatedAt = createdAt
    if (createdAt && (!current.newestCreatedAt || createdAt > current.newestCreatedAt)) current.newestCreatedAt = createdAt

    const timingEntry = {
      timing: {
        ...(entry.timing || {}),
        expectedDate: entry.timing?.expectedDate || entry.expectedDate || null,
      },
      expectedDate: entry.expectedDate || entry.timing?.expectedDate || null,
      createdAt: entry.createdAt || '',
    }
    if (!current.timing || receivableEntryTimingCompare(timingEntry, {
      timing: current.timing,
      expectedDate: current.timing.expectedDate,
      createdAt: current.oldestCreatedAt,
    }) < 0) {
      current.timing = timingEntry.timing
    }

    grouped.set(key, current)
  }

  return [...grouped.values()]
}

export const sortReceivableGroups = (groups = [], sortMode = 'urgency') => [...(Array.isArray(groups) ? groups : [])]
  .sort((left, right) => {
    if (sortMode === 'recent') {
      return String(right.newestCreatedAt || '').localeCompare(String(left.newestCreatedAt || ''))
        || groupLabelCompare(left, right)
    }
    if (sortMode === 'value-desc') {
      return (Number(right.total) || 0) - (Number(left.total) || 0)
        || String(left.oldestCreatedAt || '').localeCompare(String(right.oldestCreatedAt || ''))
        || groupLabelCompare(left, right)
    }
    return (timingRank[left.timing?.status] ?? 99) - (timingRank[right.timing?.status] ?? 99)
      || String(left.earliestExpectedDate || left.timing?.expectedDate || '').localeCompare(String(right.earliestExpectedDate || right.timing?.expectedDate || ''))
      || String(left.oldestCreatedAt || '').localeCompare(String(right.oldestCreatedAt || ''))
      || groupLabelCompare(left, right)
  })

export const groupPendingOrders = (orders = [], orderRules) => {
  const { getPendingAmount } = requireOrderRules(orderRules)
  const grouped = new Map()

  for (const order of getPendingReceivableOrders(orders, orderRules)) {
    const key = groupKey(order)
    const current = grouped.get(key) ?? {
      key,
      kind: isTableTabOrder(order) ? 'table_tab' : isRegisteredClientOrder(order) ? 'registered_client' : 'order',
      tableTabId: isTableTabOrder(order) ? order.tableTabId : null,
      label: order.client || 'Pedido sem identificação',
      identityType: order.customerIdentityType || (order.clientId ? 'registered_client' : 'guest_name'),
      orders: [],
      total: 0,
    }
    current.orders.push(order)
    current.total += getPendingAmount(order)
    grouped.set(key, current)
  }

  return [...grouped.values()].sort((a, b) => b.total - a.total)
}
