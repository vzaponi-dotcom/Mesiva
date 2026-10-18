import { DEFAULT_PAYMENT_METHODS } from '../shared/businessPolicies.js'
import { getBusinessDate } from '../shared/finance.js'
import { validateIsoDate } from './validation.js'

const PAYMENT_CODES = new Set(DEFAULT_PAYMENT_METHODS.methods.map(({ code }) => code))

const invalid = (field, message = 'Composição de pagamento inválida.') => {
  throw Object.assign(new Error(message), {
    status: 400,
    code: 'VALIDATION_ERROR',
    field,
  })
}

// An omitted date is compatible with existing payment clients; explicit invalid values fail closed.
export function resolveReceivedDate(value, now = new Date()) {
  const today = getBusinessDate(now)
  if (value === undefined) return today
  const date = validateIsoDate(value, 'receivedDate')
  if (date > today) invalid('receivedDate', 'A data do recebimento não pode estar no futuro.')
  return date
}

const assertExactKeys = (value, allowed, field) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(field)
  const allowedSet = new Set(allowed)
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) invalid(field + '.' + key)
  }
}

export function validatePaymentAllocations(rawAllocations) {
  if (!Array.isArray(rawAllocations) || rawAllocations.length === 0) invalid('allocations')

  const seen = new Set()
  return rawAllocations.map((allocation, index) => {
    const field = 'allocations.' + index
    assertExactKeys(allocation, ['methodCode', 'amountCents'], field)

    const methodCode = allocation.methodCode
    if (typeof methodCode !== 'string' || !PAYMENT_CODES.has(methodCode)) {
      invalid(field + '.methodCode', 'Selecione uma forma de pagamento válida.')
    }

    const amountCents = allocation.amountCents
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
      invalid(field + '.amountCents', 'Informe um valor de pagamento maior que zero.')
    }

    if (seen.has(methodCode)) {
      invalid('allocations', 'Cada forma de pagamento pode ser usada apenas uma vez.')
    }
    seen.add(methodCode)

    return { methodCode, amountCents }
  })
}

export function assertPaymentAllocationTotal(allocations, authoritativeTotalCents) {
  if (!Number.isSafeInteger(authoritativeTotalCents) || authoritativeTotalCents <= 0) {
    invalid('authoritativeTotalCents', 'O total oficial do pagamento é inválido.')
  }

  const validated = validatePaymentAllocations(allocations)
  let total = 0
  for (const { amountCents } of validated) {
    if (total > Number.MAX_SAFE_INTEGER - amountCents) invalid('allocations')
    total += amountCents
  }

  if (total !== authoritativeTotalCents) {
    invalid('allocations', 'A soma das formas de pagamento deve ser igual ao valor a receber.')
  }

  return validated
}


export function validateReceivableOrderIds(rawOrderIds, { min = 2, max = 100 } = {}) {
  if (!Array.isArray(rawOrderIds) || rawOrderIds.length < min || rawOrderIds.length > max) {
    invalid('orderIds', `Selecione entre ${min} e ${max} pedidos para este recebimento.`)
  }

  const seen = new Set()
  return rawOrderIds.map((value, index) => {
    if (typeof value !== 'string' || !value.trim()) {
      invalid('orderIds.' + index, 'Pedido inválido para recebimento.')
    }
    const id = value.trim()
    if (seen.has(id)) invalid('orderIds', 'Um pedido não pode aparecer mais de uma vez no recebimento.')
    seen.add(id)
    return id
  })
}
