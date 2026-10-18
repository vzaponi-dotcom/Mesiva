import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateCheckoutTotals, validateCheckoutInput } from './orderCheckout.js'

test('checkout converts fee and percentage and validates structured payment allocations', () => {
  const input = validateCheckoutInput({
    clientId: 'c1', type: 'Entrega', orderDate: '2026-09-01',
    items: [{ productId: 'p1', quantity: 2, note: ' sem   cebola ' }],
    deliveryFee: 8,
    adjustment: { type: 'discount', mode: 'percentage', value: 7.5, reason: ' fidelidade ' },
    paymentAllocations: [
      { methodCode: 'cash', amountCents: 3000 },
      { methodCode: 'pix', amountCents: 5000 },
    ],
  }, 'checkout-1')
  assert.equal(input.items[0].note, 'sem cebola')
  assert.equal(input.deliveryFeeCents, 800)
  assert.equal(input.adjustment.storedValue, 750)
  assert.equal(input.adjustment.reason, 'fidelidade')
  assert.deepEqual(input.paymentAllocations, [
    { methodCode: 'cash', amountCents: 3000 },
    { methodCode: 'pix', amountCents: 5000 },
  ])
  assert.equal(input.paymentMethod, undefined)
})

test('checkout merges duplicate product and equivalent normalized note', () => {
  const input = validateCheckoutInput({
    clientId: 'c1', type: 'Entrega', orderDate: '2026-09-01',
    items: [
      { productId: 'p1', quantity: 1, note: ' sem   cebola ' },
      { productId: 'p1', quantity: 2, note: 'SEM CEBOLA' },
      { productId: 'p1', quantity: 1, note: 'sem salada' },
    ],
  }, 'checkout-merge')
  assert.equal(input.items.length, 2)
  assert.equal(input.items[0].quantity, 3)
  assert.equal(input.items[0].note, 'sem cebola')
})

test('checkout rejects empty cart, long note, bad percentage and fee outside Entrega', () => {
  assert.throws(() => validateCheckoutInput({ clientId: 'c1', type: 'Entrega', orderDate: '2026-09-01', items: [] }, 'k'))
  assert.throws(() => validateCheckoutInput({ clientId: 'c1', type: 'Entrega', orderDate: '2026-09-01', items: [{ productId: 'p1', quantity: 1, note: 'x'.repeat(301) }] }, 'k'))
  assert.throws(() => validateCheckoutInput({ clientId: 'c1', type: 'Entrega', orderDate: '2026-09-01', items: [{ productId: 'p1', quantity: 1 }], adjustment: { type: 'discount', mode: 'percentage', value: 100.01 } }, 'k'))
  assert.throws(() => validateCheckoutInput({ clientId: 'c1', type: 'Retirada', orderDate: '2026-09-01', items: [{ productId: 'p1', quantity: 1 }], deliveryFee: 5 }, 'k'))
})

test('checkout rejects malformed percentage precision and invalid payment allocations', () => {
  assert.throws(() => validateCheckoutInput({ clientId: 'c1', type: 'Entrega', orderDate: '2026-09-01', items: [{ productId: 'p1', quantity: 1 }], adjustment: { type: 'discount', mode: 'percentage', value: 7.555 } }, 'k'))
  assert.throws(() => validateCheckoutInput({ clientId: 'c1', type: 'Entrega', orderDate: '2026-09-01', items: [{ productId: 'p1', quantity: 1 }], paymentAllocations: [{ methodCode: 'cheque', amountCents: 1000 }] }, 'k'))
})

test('checkout carries an expected table tab only for table orders', () => {
  const table = validateCheckoutInput({
    customerIdentity: { type: 'table', tableId: 'table-1' }, type: 'Local', orderDate: '2026-09-01',
    items: [{ productId: 'p1', quantity: 1 }], expectedTableTabId: ' tab-42 ',
  }, 'table-expected')
  assert.equal(table.expectedTableTabId, 'tab-42')

  assert.throws(() => validateCheckoutInput({
    clientId: 'c1', type: 'Entrega', orderDate: '2026-09-01',
    items: [{ productId: 'p1', quantity: 1 }], expectedTableTabId: 'tab-42',
  }, 'delivery-expected'), (error) => error.status === 400 && error.field === 'expectedTableTabId')
})

test('checkout rejects immediate payment for table orders', () => {
  assert.throws(() => validateCheckoutInput({
    customerIdentity: { type: 'table', tableId: 'table-1' }, type: 'Local', orderDate: '2026-09-01',
    items: [{ productId: 'p1', quantity: 1 }], paymentAllocations: [{ methodCode: 'pix', amountCents: 1000 }],
  }, 'paid-table'), (error) => error.status === 400 && error.field === 'paymentAllocations')
})

test('discount percentage applies to products only and cannot consume fee', () => {
  assert.deepEqual(calculateCheckoutTotals(
    [{ quantity: 2, priceCents: 3200 }, { quantity: 1, priceCents: 800 }], 800,
    { type: 'discount', mode: 'percentage', storedValue: 1000 },
  ), { subtotalCents: 7200, adjustmentAmountCents: 720, totalCents: 7280 })

  assert.deepEqual(calculateCheckoutTotals(
    [{ quantity: 1, priceCents: 1000 }], 500,
    { type: 'discount', mode: 'fixed', storedValue: 2000 },
  ), { subtotalCents: 1000, adjustmentAmountCents: 1000, totalCents: 500 })
})

const scheduledNow = new Date('2026-09-04T13:00:00Z')
const scheduledBase = {
  clientId: 'c1',
  type: 'Entrega',
  orderDate: '2026-09-04',
  items: [{ productId: 'p1', quantity: 1 }],
}

test('checkout accepts a valid future same-day scheduledFor and normalizes it', () => {
  const input = validateCheckoutInput({
    ...scheduledBase,
    scheduledFor: '2026-09-04T15:00:00Z',
  }, 'scheduled-valid', scheduledNow)

  assert.equal(input.scheduledFor, '2026-09-04T15:00:00.000Z')
})

test('checkout accepts Local reservations and multiday schedules through the 90th business day', () => {
  const local = validateCheckoutInput({
    ...scheduledBase,
    type: 'Local',
    customerIdentity: { type: 'table', tableId: 'table-123' },
    scheduledFor: '2026-09-04T15:00:00Z',
  }, 'scheduled-local', scheduledNow)
  assert.equal(local.scheduledFor, '2026-09-04T15:00:00.000Z')

  const tomorrow = validateCheckoutInput({
    ...scheduledBase,
    type: 'Retirada',
    orderDate: '2026-09-05',
    scheduledFor: '2026-09-05T15:00:00Z',
  }, 'scheduled-tomorrow', scheduledNow)
  assert.equal(tomorrow.scheduledFor, '2026-09-05T15:00:00.000Z')

  const day90 = validateCheckoutInput({
    ...scheduledBase,
    orderDate: '2026-12-03',
    scheduledFor: '2026-12-03T15:00:00Z',
  }, 'scheduled-day-90', scheduledNow)
  assert.equal(day90.scheduledFor, '2026-12-03T15:00:00.000Z')
})

test('checkout rejects scheduledFor at or before checkout time', () => {
  for (const scheduledFor of ['2026-09-04T13:00:00Z', '2026-09-04T12:59:59Z']) {
    assert.throws(() => validateCheckoutInput({ ...scheduledBase, scheduledFor }, 'scheduled-past', scheduledNow), /futuro/i)
  }
})

test('checkout rejects scheduledFor on retroactive orderDate', () => {
  assert.throws(() => validateCheckoutInput({
    ...scheduledBase,
    orderDate: '2026-09-03',
    scheduledFor: '2026-09-04T15:00:00Z',
  }, 'scheduled-retroactive', scheduledNow), /retroativ|data.*pedido/i)
})


test('checkout rejects the 91st day and mismatched scheduled business date', () => {
  assert.throws(() => validateCheckoutInput({
    ...scheduledBase,
    orderDate: '2026-12-04',
    scheduledFor: '2026-12-04T15:00:00Z',
  }, 'scheduled-day-91', scheduledNow), /90 dias/i)

  assert.throws(() => validateCheckoutInput({
    ...scheduledBase,
    orderDate: '2026-09-05',
    scheduledFor: '2026-09-06T15:00:00Z',
  }, 'scheduled-mismatch', scheduledNow), /data do pedido.*horário agendado/i)
})


test('scheduled table checkout rejects expectedTableTabId because a reservation must not target an open tab', () => {
  assert.throws(() => validateCheckoutInput({
    ...scheduledBase,
    type: 'Local',
    customerIdentity: { type: 'table', tableId: 'table-123' },
    expectedTableTabId: 'tab-open',
    scheduledFor: '2026-09-04T15:00:00Z',
  }, 'scheduled-local-open-tab', scheduledNow), (error) => (
    error.status === 400
    && error.field === 'expectedTableTabId'
    && /reserva|agend/i.test(error.message)
  ))
})


test('checkout accepts a distinct effective receipt date only for paid orders', () => {
  const now = new Date('2026-09-21T15:00:00Z')
  const payload = {
    clientId:'c1',type:'Retirada',orderDate:'2026-09-21',
    items:[{productId:'p1',quantity:1}],
    paymentAllocations:[{methodCode:'pix',amountCents:8000}],
  }
  const paid = validateCheckoutInput({...payload,receivedDate:'2026-09-19'},'checkout-receive',now)
  assert.equal(paid.orderDate,'2026-09-21')
  assert.equal(paid.receivedDate,'2026-09-19')
  assert.equal(validateCheckoutInput(payload,'checkout-default',now).receivedDate,undefined)
  for (const receivedDate of ['2026-09-22','2026-02-30',null,'2026-09-19T00:00:00Z']) {
    assert.throws(() => validateCheckoutInput({...payload,receivedDate},'checkout-invalid',now),
      {status:400,code:'VALIDATION_ERROR',field:'receivedDate'})
  }
  for (const receivedDate of ['2026-09-19',null]) {
    assert.throws(() => validateCheckoutInput({...payload,paymentAllocations:null,receivedDate},'checkout-unpaid',now),
      {status:400,code:'VALIDATION_ERROR',field:'receivedDate'})
  }
})
