import { formatProductPresentation } from '../../catalog/index.js'
import { getOrderItemDisplayName, getOrderItems } from './orderCartRead.js'

export { getOrderItemDisplayName, getOrderItems, getOrderItemsSearchText, getOrderItemsSummary } from './orderCartRead.js'

const cleanSpaces = (value) => String(value ?? '').trim().replace(/\s+/g, ' ')
const toNonNegativeNumber = (value) => {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : 0
}
const moneyToCents = (value) => Math.round((toNonNegativeNumber(value) + Number.EPSILON) * 100)
const centsToMoney = (value) => Number(value || 0) / 100

export const normalizeItemNote = (value) => cleanSpaces(value).slice(0, 300)
const mergeKey = (productId, note) => `${productId}::${normalizeItemNote(note).toLocaleLowerCase('pt-BR')}`

const mergeCartLine = (items, lineId, updated) => {
  const withoutCurrent = items.filter((item) => item.lineId !== lineId)
  const equivalent = withoutCurrent.find((item) => mergeKey(item.productId, item.note) === mergeKey(updated.productId, updated.note))

  if (!equivalent) {
    return items.map((item) => item.lineId === lineId ? updated : item)
  }

  return withoutCurrent.map((item) => item.lineId === equivalent.lineId
    ? { ...item, quantity: Math.max(1, Number(item.quantity) || 1) + updated.quantity }
    : item)
}

export const addCartItem = (items, product, note = '') => {
  const normalizedNote = normalizeItemNote(note)
  const key = mergeKey(product.id, normalizedNote)
  const existing = items.find((item) => mergeKey(item.productId, item.note) === key)

  if (existing) {
    return items.map((item) => item.lineId === existing.lineId
      ? { ...item, quantity: Math.max(1, Number(item.quantity) || 1) + 1 }
      : item)
  }

  const presentation = formatProductPresentation(product)
  return [...items, {
    lineId: crypto.randomUUID(),
    productId: product.id,
    name: product.name,
    category: product.category || '',
    size: presentation === 'Unidade' ? 'Un' : presentation,
    unitPrice: toNonNegativeNumber(product.price),
    quantity: 1,
    note: normalizedNote,
  }]
}

export const getCartProductQuantity = (items, productId) => (Array.isArray(items) ? items : [])
  .filter((item) => item.productId === productId)
  .reduce((sum, item) => sum + Math.max(1, Math.trunc(Number(item.quantity) || 1)), 0)

export const decrementCartProduct = (items, productId) => {
  const currentItems = Array.isArray(items) ? items : []
  const matching = currentItems.filter((item) => item.productId === productId)
  if (!matching.length) return currentItems

  const target = matching.find((item) => !normalizeItemNote(item.note)) ?? matching[0]
  const quantity = Math.max(1, Math.trunc(Number(target.quantity) || 1))

  if (quantity <= 1) return currentItems.filter((item) => item.lineId !== target.lineId)

  return currentItems.map((item) => item.lineId === target.lineId
    ? { ...item, quantity: quantity - 1 }
    : item)
}

export const updateCartItem = (items, lineId, patch = {}) => {
  const current = items.find((item) => item.lineId === lineId)
  if (!current) return items

  const updated = {
    ...current,
    ...patch,
    quantity: patch.quantity === undefined
      ? Math.max(1, Number(current.quantity) || 1)
      : Math.max(1, Math.trunc(Number(patch.quantity) || 1)),
    note: patch.note === undefined ? current.note : normalizeItemNote(patch.note),
  }

  return mergeCartLine(items, lineId, updated)
}

export const editCartItemNote = (items, lineId, note) => items.map((item) => item.lineId === lineId
  ? { ...item, note: String(note ?? '').slice(0, 300) }
  : item)

export const commitCartItemNote = (items, lineId) => {
  const current = items.find((item) => item.lineId === lineId)
  if (!current) return items

  return mergeCartLine(items, lineId, {
    ...current,
    note: normalizeItemNote(current.note),
  })
}

export const removeCartItem = (items, lineId) => items.filter((item) => item.lineId !== lineId)

export const calculateOrderPreview = (draft = {}) => {
  const subtotalCents = (Array.isArray(draft.items) ? draft.items : []).reduce(
    (sum, item) => sum + moneyToCents(item.unitPrice) * Math.max(1, Math.trunc(Number(item.quantity) || 1)),
    0,
  )
  const deliveryFeeCents = draft.type === 'Entrega' ? moneyToCents(draft.deliveryFee) : 0
  const adjustment = draft.adjustment || {}
  const type = ['discount', 'surcharge'].includes(adjustment.type) ? adjustment.type : 'none'
  const mode = adjustment.mode === 'percentage' ? 'percentage' : 'fixed'
  const value = toNonNegativeNumber(adjustment.value)

  let adjustmentAmountCents = 0
  if (type !== 'none') {
    adjustmentAmountCents = mode === 'percentage'
      ? Math.round(subtotalCents * Math.min(100, value) / 100)
      : moneyToCents(value)
    if (type === 'discount') adjustmentAmountCents = Math.min(subtotalCents, adjustmentAmountCents)
  }

  const adjustedProductsCents = type === 'discount'
    ? subtotalCents - adjustmentAmountCents
    : subtotalCents + (type === 'surcharge' ? adjustmentAmountCents : 0)

  return {
    subtotal: centsToMoney(subtotalCents),
    deliveryFee: centsToMoney(deliveryFeeCents),
    adjustmentAmount: centsToMoney(adjustmentAmountCents),
    total: centsToMoney(adjustedProductsCents + deliveryFeeCents),
  }
}

export const buildOrderPayload = (draft = {}, paymentAllocations) => {
  const adjustment = draft.adjustment || {}
  const payload = {
    customerIdentity: draft.customerIdentity,
    type: draft.type,
    orderDate: draft.orderDate,
    items: (Array.isArray(draft.items) ? draft.items : []).map((item) => ({
      productId: item.productId,
      quantity: Math.max(1, Math.trunc(Number(item.quantity) || 1)),
      note: normalizeItemNote(item.note),
    })),
    deliveryFee: draft.type === 'Entrega' ? toNonNegativeNumber(draft.deliveryFee) : 0,
    adjustment: {
      type: ['discount', 'surcharge'].includes(adjustment.type) ? adjustment.type : 'none',
      mode: adjustment.mode === 'percentage' ? 'percentage' : 'fixed',
      value: toNonNegativeNumber(adjustment.value),
      reason: cleanSpaces(adjustment.reason).slice(0, 200),
    },
  }
  if (Array.isArray(paymentAllocations) && paymentAllocations.length) {
    payload.paymentAllocations = paymentAllocations.map(({ methodCode, amountCents }) => ({ methodCode, amountCents }))
  }
  if (draft.expectedTableTabId && !(draft.type === 'Local' && draft.scheduledFor)) payload.expectedTableTabId = draft.expectedTableTabId
  if (draft.scheduledFor) payload.scheduledFor = draft.scheduledFor
  return payload
}

export const addEditCartItem = (items,product) => {
  const presentation=formatProductPresentation(product)
  return [...items,{lineId:crypto.randomUUID(),persistedItemId:null,
    productId:product.id,name:product.name,category:product.category || '',
    size:presentation==='Unidade'?'Un':presentation,
    unitPrice:Number(product.price)||0,quantity:1,note:''}]
}
export const updateEditCartItem = (items,lineId,patch={}) => items.map(item=>item.lineId===lineId
  ? {...item,quantity:patch.quantity===undefined?item.quantity:Math.max(1,Math.trunc(Number(patch.quantity)||1)),
      note:patch.note===undefined?item.note:normalizeItemNote(patch.note)}:item)
export const commitEditCartItemNote = (items,lineId) => items.map(item=>item.lineId===lineId
  ? {...item,note:normalizeItemNote(item.note)}:item)
export const decrementEditCartProduct = (items,productId) => {
  const matching=items.filter(item=>item.productId===productId)
  if(!matching.length)return items
  const target=matching.find(item=>!item.persistedItemId)||matching[0]
  if(Number(target.quantity)<=1)return items.filter(item=>item.lineId!==target.lineId)
  return items.map(item=>item.lineId===target.lineId?{...item,quantity:Number(item.quantity)-1}:item)
}
export const buildOrderEditPayload = draft => ({
  items:(draft.items||[]).map(item=>item.persistedItemId
    ? {id:item.persistedItemId,quantity:Math.max(1,Math.trunc(Number(item.quantity)||1)),note:normalizeItemNote(item.note)}
    : {productId:item.productId,quantity:Math.max(1,Math.trunc(Number(item.quantity)||1)),note:normalizeItemNote(item.note)}),
  deliveryFee:draft.type==='Entrega'?toNonNegativeNumber(draft.deliveryFee):0,
  adjustment:{
    type:draft.adjustment?.type||'none',mode:draft.adjustment?.mode||'fixed',
    value:toNonNegativeNumber(draft.adjustment?.value),
    reason:cleanSpaces(draft.adjustment?.reason).slice(0,200),
  },
})
