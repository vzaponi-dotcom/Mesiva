import { getBusinessDate, normalizeMovementCategory } from './finance.js'

const movementDateOf = (movement = {}) => String(movement.movementDate ?? movement.date ?? '')
const isActiveMovement = (movement = {}) => !movement.deletedAt
const inRange = (date, range) => Boolean(date && range?.startDate && range?.endDate)
  && date >= range.startDate
  && date <= range.endDate

const shiftIsoDate = (isoDate, days) => {
  const date = new Date(`${isoDate}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime())) return isoDate
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

const normalizedSearchText = (value) => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase('pt-BR')
  .trim()

const parseDate = (value) => {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export const getFinancePeriodRange = (period = { key: 'today' }, today) => {
  const key = period?.key ?? 'today'
  if (key === 'custom') return { startDate: period.startDate, endDate: period.endDate }
  const daysBack = key === '7d' ? 6 : key === '30d' ? 29 : 0
  return { startDate: shiftIsoDate(today, -daysBack), endDate: today }
}

export const filterMovementsByPeriod = (movements = [], range) => movements.filter((movement) => {
  if (!isActiveMovement(movement)) return false
  return inRange(movementDateOf(movement), range)
})

export const summarizeFinancePeriod = (movements = [], range) => {
  const active = filterMovementsByPeriod(movements, range)
  const entries = active
    .filter((movement) => movement.type === 'entrada')
    .reduce((sum, movement) => sum + Number(movement.value || 0), 0)
  const exits = active
    .filter((movement) => movement.type === 'saida')
    .reduce((sum, movement) => sum + Number(movement.value || 0), 0)
  return { entries, exits, result: entries - exits }
}

export const calculateCurrentBalance = (movements = [], financeSettings) => {
  if (!financeSettings?.openingDate || !Number.isFinite(Number(financeSettings.openingBalance))) return null
  const movementBalance = movements.reduce((balance, movement) => {
    if (!isActiveMovement(movement)) return balance
    const date = movementDateOf(movement)
    if (!date || date < financeSettings.openingDate) return balance
    const value = Number(movement.value || 0)
    return movement.type === 'saida' ? balance - value : movement.type === 'entrada' ? balance + value : balance
  }, 0)
  return Number(financeSettings.openingBalance) + movementBalance
}

export const filterFinanceHistory = (movements = [], filters = {}) => {
  const search = normalizedSearchText(filters.search)
  const type = String(filters.type ?? '')
  const category = String(filters.category ?? '')
  const paymentMethod = String(filters.paymentMethod ?? '')

  return movements.filter((movement) => {
    if (!isActiveMovement(movement)) return false
    if (type && movement.type !== type) return false
    if (category && normalizeMovementCategory(movement) !== category) return false
    if (paymentMethod === '__missing__' && movement.paymentMethod) return false
    if (paymentMethod && paymentMethod !== '__missing__' && movement.paymentMethod !== paymentMethod) return false
    if (!search) return true

    const haystack = normalizedSearchText([
      movement.description,
      movement.category,
      normalizeMovementCategory(movement),
      movement.paymentMethod,
      movement.orderId,
    ].filter(Boolean).join(' '))
    return haystack.includes(search)
  })
}

export const hasFinanceSecondaryFilters = (filters = {}) => [
  filters.search,
  filters.type,
  filters.category,
  filters.paymentMethod,
].some((value) => String(value ?? '').trim() !== '')

export const calculateReceivedToday = (movements = [], dateValue = getBusinessDate()) =>
  (Array.isArray(movements) ? movements : []).reduce((total, movement) => {
    const createdAt = parseDate(movement?.createdAt)
    if (!createdAt || getBusinessDate(createdAt) !== dateValue) return total
    const value = Math.max(0, Number(movement?.value) || 0)
    if (movement?.type === 'entrada' && movement?.source === 'order-payment') return total + value
    if (movement?.type === 'saida' && movement?.source === 'order-refund') return total - value
    return total
  }, 0)
