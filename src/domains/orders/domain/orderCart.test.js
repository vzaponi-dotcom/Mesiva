import test from 'node:test'
import assert from 'node:assert/strict'
import * as orderCart from './orderCart.js'

const {
  addCartItem, buildOrderPayload, calculateOrderPreview,
  commitCartItemNote, decrementCartProduct, editCartItemNote,
  getCartProductQuantity,
  getOrderItems, getOrderItemsSearchText, getOrderItemsSummary,
  removeCartItem, updateCartItem,
} = orderCart

const marmita = { id: 'p1', name: 'Marmita G', category: 'Marmita', size: 'G', price: 32 }
const coca = { id: 'p2', name: 'Coca-Cola', category: 'Bebida', size: 'Lata', price: 8 }

test('same product and normalized note merge quantity', () => {
  let items = addCartItem([], marmita, ' sem   cebola ')
  items = addCartItem(items, marmita, 'Sem cebola')
  assert.equal(items.length, 1)
  assert.equal(items[0].quantity, 2)
  assert.equal(items[0].note, 'sem cebola')
})

test('note editing preserves spaces while typing and normalizes only on commit', () => {
  let items = addCartItem([], marmita, '')
  const lineId = items[0].lineId

  items = editCartItemNote(items, lineId, 'sem ')
  assert.equal(items[0].note, 'sem ')

  items = editCartItemNote(items, lineId, 'sem cebola')
  assert.equal(items[0].note, 'sem cebola')

  items = commitCartItemNote(items, lineId)
  assert.equal(items[0].note, 'sem cebola')
})

test('committing an equivalent normalized note consolidates cart lines', () => {
  let items = addCartItem([], marmita, 'sem cebola')
  items = addCartItem(items, marmita, 'sem salada')
  const secondLineId = items[1].lineId

  items = editCartItemNote(items, secondLineId, '  SEM CEBOLA  ')
  assert.equal(items.length, 2)
  items = commitCartItemNote(items, secondLineId)

  assert.equal(items.length, 1)
  assert.equal(items[0].quantity, 2)
  assert.equal(items[0].note, 'sem cebola')
})

test('quantity never drops below one and remove deletes the line', () => {
  let items = addCartItem([], coca, '')
  items = updateCartItem(items, items[0].lineId, { quantity: 0 })
  assert.equal(items[0].quantity, 1)
  assert.deepEqual(removeCartItem(items, items[0].lineId), [])
})

test('catalog quantity sums every cart line for the same product', () => {
  const items = [
    { lineId: 'plain', productId: 'p1', quantity: 2, note: '' },
    { lineId: 'note', productId: 'p1', quantity: 3, note: 'sem cebola' },
    { lineId: 'other', productId: 'p2', quantity: 4, note: '' },
  ]

  assert.equal(getCartProductQuantity(items, 'p1'), 5)
  assert.equal(getCartProductQuantity(items, 'p2'), 4)
  assert.equal(getCartProductQuantity(items, 'missing'), 0)
})

test('catalog decrement removes one unit and removes the final cart line at zero', () => {
  let items = [
    { lineId: 'plain', productId: 'p1', quantity: 2, note: '' },
    { lineId: 'note', productId: 'p1', quantity: 2, note: 'sem cebola' },
  ]

  items = decrementCartProduct(items, 'p1')
  assert.equal(getCartProductQuantity(items, 'p1'), 3)
  assert.equal(items.find((item) => item.lineId === 'plain').quantity, 1)

  items = decrementCartProduct(items, 'p1')
  assert.equal(getCartProductQuantity(items, 'p1'), 2)
  assert.equal(items.some((item) => item.lineId === 'plain'), false)

  items = decrementCartProduct(items, 'p1')
  items = decrementCartProduct(items, 'p1')
  assert.equal(getCartProductQuantity(items, 'p1'), 0)
  assert.deepEqual(decrementCartProduct(items, 'missing'), items)
})

test('percentage discount excludes delivery fee and paid payload uses structured allocations without prices', () => {
  const items = [...addCartItem([], marmita, ''), ...addCartItem([], coca, '')]
  const draft = {
    clientId: 'c1', type: 'Entrega', orderDate: '2026-09-01', items,
    deliveryFee: 8,
    adjustment: { type: 'discount', mode: 'percentage', value: 10, reason: ' fidelidade ' },
  }
  assert.deepEqual(calculateOrderPreview(draft), { subtotal: 40, deliveryFee: 8, adjustmentAmount: 4, total: 44 })
  const paymentAllocations = [
    { methodCode: 'cash', amountCents: 2000 },
    { methodCode: 'pix', amountCents: 2400 },
  ]
  const payload = buildOrderPayload(draft, paymentAllocations)
  assert.equal(payload.items[0].unitPrice, undefined)
  assert.deepEqual(payload.paymentAllocations, paymentAllocations)
  assert.equal(payload.paymentMethod, undefined)
  assert.equal(payload.adjustment.reason, 'fidelidade')
})

test('pending checkout omits payment allocations entirely', () => {
  const payload = buildOrderPayload({ type: 'Retirada', orderDate: '2026-09-01', items: [] })
  assert.equal(Object.hasOwn(payload, 'paymentAllocations'), false)
  assert.equal(Object.hasOwn(payload, 'paymentMethod'), false)
})

test('payload includes scheduledFor only when provided', () => {
  const draft = { type: 'Entrega', orderDate: '2026-09-04', items: [], deliveryFee: 0, scheduledFor: '2026-09-04T15:00:00.000Z' }
  assert.equal(buildOrderPayload(draft).scheduledFor, draft.scheduledFor)
  assert.equal(buildOrderPayload({ ...draft, scheduledFor: null }).scheduledFor, undefined)
  assert.equal(buildOrderPayload({ ...draft, type: 'Local', scheduledFor: null }).scheduledFor, undefined)
})

test('summary and search use every item and tolerate legacy fields', () => {
  const order = { items: [{ name: 'Marmita G', quantity: 2 }, { name: 'Coca-Cola', quantity: 1 }] }
  assert.match(getOrderItemsSummary(order), /Coca-Cola/)
  assert.match(getOrderItemsSearchText(order).toLowerCase(), /coca-cola/)
  assert.equal(getOrderItems({ productName: 'Pudim', quantity: 1, size: '' })[0].name, 'Pudim')
})

test('multi-item search finds any product and legacy order stays readable', () => {
  assert.match(getOrderItemsSearchText({ items: [{ name: 'Marmita G' }, { name: 'Pudim' }] }).toLowerCase(), /pudim/)
  assert.equal(getOrderItems({ productName: 'Marmita P', size: 'P', quantity: 2 })[0].quantity, 2)
})

test('display name appends size only when product name does not already contain it', () => {
  assert.equal(typeof orderCart.getOrderItemDisplayName, 'function')
  assert.equal(orderCart.getOrderItemDisplayName({ name: 'Marmita', size: 'P' }), 'Marmita P')
  assert.equal(orderCart.getOrderItemDisplayName({ name: 'Marmita P', size: 'P' }), 'Marmita P')
  assert.equal(orderCart.getOrderItemDisplayName({ name: 'Coca-Cola', size: 'Lata' }), 'Coca-Cola Lata')
})


test('Local reservation payload keeps scheduledFor but never carries an open table-tab identity', () => {
  const reserved = buildOrderPayload({
    customerIdentity: { type: 'table', tableId: 'table-1' },
    type: 'Local',
    orderDate: '2026-10-01',
    items: [{ productId: 'p1', quantity: 1, note: '' }],
    deliveryFee: 0,
    adjustment: { type: 'none', mode: 'fixed', value: 0, reason: '' },
    scheduledFor: '2026-10-01T20:00:00.000Z',
    expectedTableTabId: 'tab-open',
  })
  assert.equal(reserved.scheduledFor, '2026-10-01T20:00:00.000Z')
  assert.equal(Object.hasOwn(reserved, 'expectedTableTabId'), false)

  const immediate = buildOrderPayload({
    customerIdentity: { type: 'table', tableId: 'table-1' },
    type: 'Local',
    orderDate: '2026-09-29',
    items: [{ productId: 'p1', quantity: 1, note: '' }],
    deliveryFee: 0,
    adjustment: { type: 'none', mode: 'fixed', value: 0, reason: '' },
    scheduledFor: null,
    expectedTableTabId: 'tab-open',
  })
  assert.equal(immediate.expectedTableTabId, 'tab-open')
  assert.equal(Object.hasOwn(immediate, 'scheduledFor'), false)
})


test('checkout payload optionally carries an effective payment date only for paid submissions',()=>{
  const draft={type:'Retirada',orderDate:'2026-10-17',items:[]}
  const allocations=[{methodCode:'pix',amountCents:2500}]
  assert.equal(buildOrderPayload(draft,allocations,{receivedDate:'2026-10-15'}).receivedDate,'2026-10-15')
  assert.equal(Object.hasOwn(buildOrderPayload(draft,allocations),'receivedDate'),false)
  assert.equal(Object.hasOwn(buildOrderPayload(draft,null,{receivedDate:'2026-10-15'}),'receivedDate'),false)
})
