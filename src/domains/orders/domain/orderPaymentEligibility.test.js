import test from 'node:test'
import assert from 'node:assert/strict'
import { canReceiveStandaloneOrder } from './orderPaymentEligibility.js'

const pending = (overrides = {}) => ({
  id: 'order-1',
  client: 'Ana',
  type: 'Entrega',
  status: 'Em preparo',
  paymentStatus: 'Pendente',
  customerIdentityType: 'registered_client',
  ...overrides,
})

test('Cozinha recebe Entrega e Retirada pendentes com consulta e recebimento', () => {
  const granted = new Set(['orders.view', 'payments.receive'])

  assert.equal(canReceiveStandaloneOrder(pending(), granted, 'orders'), true)
  assert.equal(canReceiveStandaloneOrder(pending({ type: 'Retirada' }), granted, 'orders'), true)
})

test('Histórico recebe pedido finalizado pendente sem consulta financeira', () => {
  const granted = new Set(['orders.history', 'payments.receive'])
  const order = pending({ status: 'Finalizado' })

  assert.equal(canReceiveStandaloneOrder(order, granted, 'history'), true)
  assert.equal(granted.has('finance.receivables'), false)
})

test('pedido pago ou cancelado nunca recebe entrada operacional', () => {
  const granted = new Set(['orders.view', 'payments.receive'])

  assert.equal(canReceiveStandaloneOrder(pending({ paymentStatus: 'Pago' }), granted, 'orders'), false)
  assert.equal(canReceiveStandaloneOrder(pending({ status: 'Cancelado' }), granted, 'orders'), false)
})

for (const [name, patch] of [
  ['tipo Local', { type: 'Local' }],
  ['tableTabId', { tableTabId: 'tab-1' }],
  ['identidade table', { customerIdentityType: 'table' }],
  ['mesa legada', { table: { id: 'table-1' } }],
  ['tableId legado', { tableId: 'table-1' }],
  ['identificador legado de mesa', { tableIdentifier: 'Mesa 1' }],
]) test(`pedido com ${name} permanece exclusivo da comanda`, () => {
  const granted = new Set(['orders.view', 'payments.receive'])

  assert.equal(canReceiveStandaloneOrder(pending(patch), granted, 'orders'), false)
})

test('origem ou capacidades ausentes não ganham concessão implícita', () => {
  const order = pending({ status: 'Finalizado' })

  assert.equal(canReceiveStandaloneOrder(order, new Set(['payments.receive']), 'orders'), false)
  assert.equal(canReceiveStandaloneOrder(order, new Set(['orders.view']), 'orders'), false)
  assert.equal(canReceiveStandaloneOrder(order, new Set(['orders.history']), 'history'), false)
  assert.equal(canReceiveStandaloneOrder(order, new Set(['orders.view', 'payments.receive']), undefined), false)
  assert.equal(canReceiveStandaloneOrder(order, new Set(['orders.view', 'payments.receive']), 'receivables'), false)
})

test('reservation identity blocks standalone receiving even if another field is malformed', () => {
  const granted = new Set(['orders.view', 'payments.receive'])
  const reservation = pending({
    type: 'Entrega',
    customerIdentityType: 'registered_client',
    tableTabId: null,
    tableReservationId: 'reservation-guard',
    tableReservationStatus: 'reserved',
  })

  assert.equal(canReceiveStandaloneOrder(reservation, granted, 'orders'), false)
})

test('Task 13 partial and overpaid orders use remaining cents, but legacy initial collection cannot re-charge paid orders', async () => {
  const {getPendingAmount,isOrderPaid}=await import('./orderPaymentEligibility.js')
  const incomplete=pending({total:95,paymentId:'existing',paymentStatus:'Parcialmente pago',dueCents:1500})
  assert.equal(getPendingAmount(incomplete),15)
  assert.equal(isOrderPaid(incomplete),false)
  assert.equal(canReceiveStandaloneOrder(incomplete,new Set(['orders.view','payments.receive']),'orders'),false)
  const refund=pending({total:65,paymentId:'existing',paymentStatus:'Devolução pendente',dueCents:0,refundDueCents:1500})
  assert.equal(getPendingAmount(refund),0)
  assert.equal(canReceiveStandaloneOrder(refund,new Set(['orders.view','payments.receive']),'orders'),false)
  assert.equal(getPendingAmount(pending({total:35,paymentStatus:'Pendente'})),35)
})

test('client and order surfaces can offer only an official supplemental balance under their real grants',()=>{
 const partial=pending({paymentId:'p',paymentStatus:'Parcialmente pago',totalCents:6000,netReceivedCents:3000,dueCents:3000,contentRevision:1})
 const grants=new Set(['orders.view','orders.history','payments.receive'])
 assert.equal(canReceiveStandaloneOrder(partial,grants,'orders'),true)
 assert.equal(canReceiveStandaloneOrder(partial,grants,'history'),true)
 assert.equal(canReceiveStandaloneOrder(partial,new Set(['orders.view']),'orders'),false)
 assert.equal(canReceiveStandaloneOrder({...partial,tableTabId:'open-tab'},grants,'orders'),false)
})
