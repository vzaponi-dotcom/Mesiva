import { getBusinessDate } from '../../../../shared/finance.js'

const safeCents = (value) => Number.isSafeInteger(value) && value >= 0 ? value : 0
const currentCodes = (allocations = [], exceptIndex = -1) => new Set(
  allocations
    .map((allocation, index) => index === exceptIndex ? '' : allocation?.methodCode)
    .filter(Boolean),
)
const optionFor = (options = [], value) => options.find((option) => option?.code === value || option?.value === value) ?? null

export const createInitialPaymentComposition = ({ totalCents = 0, defaultPaymentMethod = '', paymentOptions = [] } = {}) => {
  const option = optionFor(paymentOptions, defaultPaymentMethod)
  return [{ methodCode: option?.code || '', amountCents: safeCents(totalCents) }]
}

export const remainingPaymentCents = (allocations = [], totalCents = 0, excludeIndex = -1) => {
  const authoritativeTotal = Number.isSafeInteger(totalCents) && totalCents > 0 ? totalCents : 0
  let enteredCents = 0
  for (const [index, allocation] of (Array.isArray(allocations) ? allocations : []).entries()) {
    if (index === excludeIndex) continue
    const amount = safeCents(allocation?.amountCents)
    if (enteredCents > Number.MAX_SAFE_INTEGER - amount) return 0
    enteredCents += amount
  }
  return Math.max(0, authoritativeTotal - enteredCents)
}

export const addPaymentAllocation = (allocations = [], totalCents = 0) => {
  const rows = Array.isArray(allocations) ? allocations : []
  return [
    ...rows,
    { methodCode: '', amountCents: remainingPaymentCents(rows, totalCents) },
  ]
}

export const autofillPaymentRemainder = (allocations = [], totalCents = 0, index = -1) => (
  updatePaymentAllocation(allocations, index, {
    amountCents: remainingPaymentCents(allocations, totalCents, index),
  })
)

export const removePaymentAllocation = (allocations = [], index) => (
  (Array.isArray(allocations) ? allocations : []).filter((_, position) => position !== index)
)

export const updatePaymentAllocation = (allocations = [], index, patch = {}) => (
  (Array.isArray(allocations) ? allocations : []).map((allocation, position) => position === index
    ? { ...allocation, ...patch }
    : allocation)
)

export const paymentOptionsForAllocation = (options = [], allocations = [], index) => {
  const used = currentCodes(allocations, index)
  return (Array.isArray(options) ? options : []).filter((option) => !used.has(option.code))
}

export const summarizePaymentComposition = (allocations = [], totalCents = 0, paymentOptions = []) => {
  const rows = Array.isArray(allocations) ? allocations : []
  const allowed = new Set((Array.isArray(paymentOptions) ? paymentOptions : []).map(({ code }) => code).filter(Boolean))
  const methods = rows.map(({ methodCode }) => methodCode).filter(Boolean)
  const hasDuplicateMethods = new Set(methods).size !== methods.length
  const needsReview = rows.some(({ methodCode }) => Boolean(methodCode) && !allowed.has(methodCode))
  const amountsValid = rows.length > 0 && rows.every(({ amountCents }) => Number.isSafeInteger(amountCents) && amountCents > 0)
  const methodsValid = rows.length > 0 && rows.every(({ methodCode }) => typeof methodCode === 'string' && Boolean(methodCode))
  let enteredCents = 0
  let sumSafe = true
  for (const row of rows) {
    const amount = safeCents(row?.amountCents)
    if (enteredCents > Number.MAX_SAFE_INTEGER - amount) {
      sumSafe = false
      enteredCents = Number.MAX_SAFE_INTEGER
      break
    }
    enteredCents += amount
  }
  const authoritativeTotal = Number.isSafeInteger(totalCents) && totalCents > 0 ? totalCents : 0
  const remainingCents = Math.max(0, authoritativeTotal - enteredCents)
  const overageCents = Math.max(0, enteredCents - authoritativeTotal)
  const valid = Boolean(authoritativeTotal)
    && sumSafe
    && amountsValid
    && methodsValid
    && !hasDuplicateMethods
    && !needsReview
    && enteredCents === authoritativeTotal

  return {
    totalCents: authoritativeTotal,
    enteredCents,
    remainingCents,
    overageCents,
    hasDuplicateMethods,
    needsReview,
    valid,
  }
}

export const toPaymentAllocations = (allocations, totalCents, paymentOptions) => {
  const summary = summarizePaymentComposition(allocations, totalCents, paymentOptions)
  if (!summary.valid) return null
  return allocations.map(({ methodCode, amountCents }) => ({ methodCode, amountCents }))
}

export const paymentMethodLabel = (paymentOptions = [], code) => (
  (Array.isArray(paymentOptions) ? paymentOptions : []).find((option) => option.code === code)?.label || code || ''
)

export const paymentMethodCode = (paymentOptions = [], value) => optionFor(paymentOptions, value)?.code || ''

// ISO calendar date only. Avoid Date.parse normalization of impossible days.
export const isValidReceivedDate = (value, today = getBusinessDate()) => {
  if (typeof value !== 'string' || !/^\\d{4}-\\d{2}-\\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() + 1 === month
    && parsed.getUTCDate() === day && value <= today
}
