import { PRINT_QUEUE_STATES, resolvePrintQueueState } from '../../../../shared/printQueue.js'
import { formatOrderDisplayNumber } from '../../../../shared/orderDisplayNumber.js'

const getHumanIdentifiers = (job, ordersById) => {
  const document = job?.document || {}
  const order = ordersById.get(String(job?.orderId || '')) || (document.order?.number?{orderNumber:document.order.number}:null)
  return [
    order && formatOrderDisplayNumber(order),
    document.customer?.name,
    document.tableIdentifier,
    order?.tableIdentifier,
    document.table?.identifier,
  ].filter(Boolean)
}

const normalizeSearch = (value) => String(value || '')
  .trim()
  .toLocaleLowerCase('pt-BR')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/#/g, '')

export const getPrintQueueSearchText = (job, orders = []) => {
  const ordersById = new Map(orders.map((order) => [String(order.id), order]))
  return getHumanIdentifiers(job, ordersById).map(normalizeSearch).join(' ')
}

export const filterPrintQueueJobs = (jobs, { search = '', status = 'all', origin = 'all', stationReady = true, orders = [] } = {}) => {
  const normalizedSearch = normalizeSearch(search)
  const ordersById = new Map(orders.map((order) => [String(order.id), order]))
  return jobs.filter((job) => {
    const jobState = resolvePrintQueueState(job?.queueState || job?.status, { stationReady })
    const searchMatches = !normalizedSearch || getHumanIdentifiers(job, ordersById).map(normalizeSearch).join(' ').includes(normalizedSearch)
    const statusMatches = status === 'all' || jobState === status
    const originMatches = origin === 'all' || job?.trigger === origin
    return searchMatches && statusMatches && originMatches
  })
}

export const PRINT_QUEUE_STATUS_FILTERS = Object.freeze([
  { value: 'all', label: 'Todos' },
  { value: PRINT_QUEUE_STATES.QUEUED, label: 'Na fila' },
  { value: PRINT_QUEUE_STATES.WAITING_STATION, label: 'Aguardando estação' },
  { value: PRINT_QUEUE_STATES.PRINTING, label: 'Imprimindo' },
  { value: PRINT_QUEUE_STATES.WAITING_CONFIRMATION, label: 'Aguardando confirmação' },
  { value: PRINT_QUEUE_STATES.WAITING_SECOND_COPY, label: 'Aguardando 2ª via' },
  { value: PRINT_QUEUE_STATES.ATTENTION, label: 'Requer atenção' },
  { value: PRINT_QUEUE_STATES.PRINTED, label: 'Impresso' },
  { value: PRINT_QUEUE_STATES.DISCARDED, label: 'Descartado' },
])

export const PRINT_QUEUE_ORIGIN_FILTERS = Object.freeze([
  { value: 'all', label: 'Todas' },
  { value: 'automatic', label: 'Automático' },
  { value: 'manual', label: 'Manual/Reimpressão' },
])
