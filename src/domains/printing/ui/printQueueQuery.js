export const DEFAULT_PRINT_QUEUE_QUERY = Object.freeze({
  page: 1,
  pageSize: 10,
  sortBy: 'createdAt',
  sortDir: 'desc',
  status: '',
  trigger: '',
  search: '',
})

const QUERY_RESET_KEYS = new Set(['sortBy', 'sortDir', 'status', 'trigger', 'search'])

export const updatePrintQueueQuery = (current = DEFAULT_PRINT_QUEUE_QUERY, changes = {}) => {
  const next = { ...DEFAULT_PRINT_QUEUE_QUERY, ...current, ...changes, pageSize: 10 }
  const resetsPage = Object.keys(changes).some((key) => QUERY_RESET_KEYS.has(key) && next[key] !== current[key])
  return { ...next, page: resetsPage ? 1 : Math.max(1, Number(next.page) || 1) }
}

export const togglePrintQueueSort = (query = DEFAULT_PRINT_QUEUE_QUERY, sortBy) => updatePrintQueueQuery(query, {
  sortBy,
  sortDir: query.sortBy === sortBy && query.sortDir === 'desc' ? 'asc' : 'desc',
})

const sortValue = (job, sortBy, ordersById) => {
  if (sortBy === 'orderNumber') {
    if (job?.type === 'table-tab') {
      const number = Number(job?.document?.tableTab?.number)
      return Number.isInteger(number) && number > 0 ? number : null
    }
    const value = Number(ordersById.get(String(job?.orderId))?.orderNumber ?? job?.document?.order?.number)
    return Number.isInteger(value) && value > 0 ? value : null
  }
  if (sortBy === 'jobId') return String(job?.id || '') || null
  if (sortBy === 'status') return String(job?.status || '') || null
  if (sortBy === 'trigger') return String(job?.trigger || '') || null
  return String(job?.createdAt || '') || null
}

const compareValues = (left, right) => {
  if (left == null && right == null) return 0
  if (left == null) return -1
  if (right == null) return 1
  if (typeof left === 'number' && typeof right === 'number') return left - right
  return String(left).localeCompare(String(right), 'pt-BR', { numeric: true, sensitivity: 'base' })
}

export const sortPrintQueueJobsForDisplay = (jobs = [], { sortBy = 'createdAt', sortDir = 'desc', orders = [] } = {}) => {
  const ordersById = new Map(orders.map((order) => [String(order.id), order]))
  const direction = sortDir === 'asc' ? 1 : -1
  return [...jobs].sort((left, right) => {
    const primary = compareValues(sortValue(left, sortBy, ordersById), sortValue(right, sortBy, ordersById)) * direction
    if (primary) return primary
    const newestFirst = compareValues(left?.createdAt || null, right?.createdAt || null) * -1
    if (newestFirst) return newestFirst
    return compareValues(left?.id || null, right?.id || null)
  })
}
