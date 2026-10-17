import { validateCustomerIdentity } from '../shared/orderCustomerIdentity.js'
import { SCHEDULE_MAX_DAYS, validateOrderSchedule } from '../shared/orderTiming.js'
import { validatePaymentAllocations } from './paymentValidation.js'
import {
  moneyToCents,
  optionalTextMax,
  requireNonEmpty,
  validateIsoDate,
  validateOrderType,
  validatePositiveInteger,
} from './validation.js'

const checkoutError = (field, message) => Object.assign(new Error(message), {
  status: 400,
  code: 'VALIDATION_ERROR',
  field,
})

const normalizeSpaces = (value) => value.replace(/\s+/g, ' ')
const itemMergeKey = (item) => `${item.productId}::${item.note.toLocaleLowerCase('pt-BR')}`

const percentageToBasisPoints = (value) => {
  const raw = typeof value === 'number' ? String(value) : String(value ?? '').trim()
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) {
    throw checkoutError('adjustment.value', 'Informe um percentual entre 0,00 e 100,00 com até duas casas decimais.')
  }
  const number = Number(raw)
  if (!Number.isFinite(number) || number < 0 || number > 100) {
    throw checkoutError('adjustment.value', 'Informe um percentual entre 0,00 e 100,00 com até duas casas decimais.')
  }
  return Math.round(number * 100)
}

export const validateOrderAdjustment = (value = {}) => {
  const type = value?.type ?? 'none'
  if (!['none', 'discount', 'surcharge'].includes(type)) {
    throw checkoutError('adjustment.type', 'Tipo de ajuste inválido.')
  }

  const mode = value?.mode ?? 'fixed'
  if (!['fixed', 'percentage'].includes(mode)) {
    throw checkoutError('adjustment.mode', 'Modo de ajuste inválido.')
  }

  const reason = optionalTextMax(value?.reason, 200, 'adjustment.reason')
  if (type === 'none') return { type: 'none', mode: 'fixed', storedValue: 0, reason }

  const storedValue = mode === 'percentage'
    ? percentageToBasisPoints(value?.value ?? 0)
    : moneyToCents(value?.value ?? 0, 'adjustment.value')

  return { type, mode, storedValue, reason }
}

export const validateCheckoutInput = (body = {}, idempotencyKey, now = new Date()) => {
  const type = validateOrderType(body.type)
  const rawIdentity = body.customerIdentity ?? { type: 'registered_client', clientId: body.clientId }
  const identityResult = validateCustomerIdentity(type, rawIdentity)
  if (!identityResult.ok) throw checkoutError(identityResult.field, identityResult.message)
  const customerIdentity = identityResult.value
  const orderDate = validateIsoDate(body.orderDate, 'orderDate')
  const stableKey = requireNonEmpty(idempotencyKey, 'idempotency-key')

  let scheduledFor = null
  if (body.scheduledFor !== undefined && body.scheduledFor !== null && body.scheduledFor !== '') {
    if (typeof body.scheduledFor !== 'string') throw checkoutError('scheduledFor', 'Informe um horário agendado válido.')
    const schedule = validateOrderSchedule({
      type,
      orderDate,
      scheduledFor: body.scheduledFor,
    }, now, SCHEDULE_MAX_DAYS)
    if (!schedule.ok) {
      const message = {
        SCHEDULE_IN_PAST: 'O horário agendado deve ser no futuro.',
        SCHEDULE_DATE_MISMATCH: 'A data do pedido deve corresponder à data do horário agendado.',
        SCHEDULE_OUT_OF_RANGE: `O agendamento pode ser feito em até ${SCHEDULE_MAX_DAYS} dias.`,
        SCHEDULE_TYPE_NOT_ALLOWED: 'Agendamento não é permitido para esta modalidade.',
        SCHEDULE_INVALID: 'Informe um horário agendado válido.',
      }[schedule.code] || 'Informe um horário agendado válido.'
      throw checkoutError('scheduledFor', message)
    }
    scheduledFor = schedule.scheduledFor
  }

  if (!Array.isArray(body.items) || body.items.length === 0) {
    throw checkoutError('items', 'Adicione pelo menos um item ao pedido.')
  }

  const validatedItems = body.items.map((item, index) => ({
    productId: requireNonEmpty(item?.productId, `items.${index}.productId`),
    quantity: validatePositiveInteger(item?.quantity, `items.${index}.quantity`),
    note: normalizeSpaces(optionalTextMax(item?.note, 300, `items.${index}.note`)),
  }))
  const mergedItems = new Map()
  for (const item of validatedItems) {
    const key = itemMergeKey(item)
    const existing = mergedItems.get(key)
    if (existing) existing.quantity += item.quantity
    else mergedItems.set(key, { ...item })
  }
  const items = [...mergedItems.values()]

  const deliveryFeeCents = moneyToCents(body.deliveryFee ?? 0, 'deliveryFee')
  if (type !== 'Entrega' && deliveryFeeCents !== 0) {
    throw checkoutError('deliveryFee', 'Taxa de entrega só pode ser usada em pedidos de entrega.')
  }

  const adjustment = validateOrderAdjustment(body.adjustment)
  if (body.paymentMethod !== undefined) {
    throw checkoutError('paymentMethod', 'Use paymentAllocations para receber o pedido.')
  }
  const paymentAllocations = body.paymentAllocations === undefined || body.paymentAllocations === null
    ? null
    : validatePaymentAllocations(body.paymentAllocations)
  if (customerIdentity.type === 'table' && paymentAllocations) {
    throw checkoutError('paymentAllocations', 'Pedidos de mesa devem ser recebidos pelo pagamento integral da comanda.')
  }

  const expectedTableTabId = body.expectedTableTabId === undefined || body.expectedTableTabId === null || body.expectedTableTabId === ''
    ? null
    : requireNonEmpty(body.expectedTableTabId, 'expectedTableTabId')
  if (expectedTableTabId && customerIdentity.type !== 'table') {
    throw checkoutError('expectedTableTabId', 'A comanda esperada só pode ser usada em pedidos de mesa.')
  }
  if (expectedTableTabId && scheduledFor && customerIdentity.type === 'table') {
    throw checkoutError('expectedTableTabId', 'Reservas agendadas não podem ser vinculadas a uma comanda aberta.')
  }

  return {
    customerIdentity,
    type,
    orderDate,
    items,
    deliveryFeeCents: type === 'Entrega' ? deliveryFeeCents : 0,
    adjustment,
    paymentAllocations,
    expectedTableTabId,
    scheduledFor,
    idempotencyKey: stableKey,
  }
}

export const calculateCheckoutTotals = (pricedItems, deliveryFeeCents = 0, adjustment = {}) => {
  const subtotalCents = (Array.isArray(pricedItems) ? pricedItems : []).reduce((sum, item) => {
    const quantity = validatePositiveInteger(item?.quantity, 'quantity')
    const priceCents = Number(item?.priceCents)
    if (!Number.isInteger(priceCents) || priceCents < 0) throw checkoutError('price', 'Preço de produto inválido.')
    return sum + (priceCents * quantity)
  }, 0)

  const feeCents = Number(deliveryFeeCents)
  if (!Number.isInteger(feeCents) || feeCents < 0) throw checkoutError('deliveryFee', 'Taxa de entrega inválida.')

  const type = ['discount', 'surcharge'].includes(adjustment?.type) ? adjustment.type : 'none'
  const mode = adjustment?.mode === 'percentage' ? 'percentage' : 'fixed'
  const storedValue = Number(adjustment?.storedValue) || 0
  if (!Number.isInteger(storedValue) || storedValue < 0) throw checkoutError('adjustment.value', 'Valor de ajuste inválido.')

  let adjustmentAmountCents = 0
  if (type !== 'none') {
    adjustmentAmountCents = mode === 'percentage'
      ? Math.round(subtotalCents * storedValue / 10000)
      : storedValue
    if (type === 'discount') adjustmentAmountCents = Math.min(subtotalCents, adjustmentAmountCents)
  }

  const adjustedProductsCents = type === 'discount'
    ? subtotalCents - adjustmentAmountCents
    : subtotalCents + (type === 'surcharge' ? adjustmentAmountCents : 0)

  return {
    subtotalCents,
    adjustmentAmountCents,
    totalCents: adjustedProductsCents + feeCents,
  }
}
