import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ORDER_PRINT_DOCUMENT_VERSION,
  ORDER_PRINT_THANK_YOU,
  createOrderPrintDocument,
  createTestPrintDocument,
  formatPrintMoneyCents,
} from './orderPrintDocument.js'

const orderInput = (overrides = {}) => ({
  businessName: 'Amor & Sabor',
  orderId: 'order-0184',
  orderNumber: 184,
  orderDate: '2026-09-03',
  createdAt: '2026-09-03T23:31:00.000Z',
  type: 'Entrega',
  customer: { name: 'João Silva', phone: '(11) 99876-5432', address: 'Rua das Flores, 123' },
  items: [
    { name: 'X-BURGER', presentation: '', quantity: 2, note: 'Sem cebola + Bacon', unitPriceCents: 3000 },
    { name: 'BATATA', presentation: 'G', quantity: 1, note: 'Cheddar e bacon', unitPriceCents: 1200 },
  ],
  subtotalCents: 7200,
  deliveryFeeCents: 800,
  adjustment: { type: 'discount', amountCents: 0, reason: '' },
  totalCents: 8000,
  payment: { status: 'Pago', method: 'Pix' },
  ...overrides,
})

test('canonical order print document keeps approved customer-safe ticket data in cents', () => {
  const document = createOrderPrintDocument(orderInput())

  assert.equal(ORDER_PRINT_DOCUMENT_VERSION, 1)
  assert.equal(document.version, 1)
  assert.equal(document.type, 'order')
  assert.equal(document.business.name, 'Amor & Sabor')
  assert.equal(document.order.id, 'order-0184')
  assert.equal(document.order.number, '184')
  assert.equal(document.order.type, 'Entrega')
  assert.deepEqual(document.customer, {
    name: 'João Silva',
    phone: '(11) 99876-5432',
    address: 'Rua das Flores, 123',
  })
  assert.equal(document.items[0].quantity, 2)
  assert.equal(document.items[0].unitPriceCents, 3000)
  assert.equal(document.items[0].lineTotalCents, 6000)
  assert.equal(document.items[0].note, 'Sem cebola + Bacon')
  assert.equal(document.financial.subtotalCents, 7200)
  assert.equal(document.financial.deliveryFeeCents, 800)
  assert.equal(document.financial.totalCents, 8000)
  assert.deepEqual(document.payment, { status: 'Pago', method: 'Pix' })
  assert.equal(document.message, 'Obrigado pela compra! Agradecemos a preferência.')
  assert.equal(document.message, ORDER_PRINT_THANK_YOU)
})

test('canonical document normalizes optional values without inventing payment or contact data', () => {
  const document = createOrderPrintDocument(orderInput({
    customer: { name: 'Mesa A-01' },
    payment: null,
    deliveryFeeCents: undefined,
    adjustment: undefined,
    items: [{ name: 'Marmita', quantity: 1, unitPriceCents: 3200 }],
    totalCents: 3200,
  }))

  assert.deepEqual(document.customer, { name: 'Mesa A-01', phone: '', address: '' })
  assert.deepEqual(document.payment, { status: 'Pendente', method: '' })
  assert.equal(document.financial.deliveryFeeCents, 0)
  assert.deepEqual(document.financial.adjustment, { type: 'none', amountCents: 0, reason: '' })
  assert.equal(document.items[0].presentation, '')
  assert.equal(document.items[0].note, '')
})

test('local order documents prioritize the persisted table snapshot and append an optional client', () => {
  const withoutClient = createOrderPrintDocument(orderInput({
    type: 'Local',
    customerIdentityType: 'table',
    tableIdentifier: 'Mesa 4',
    customer: { name: 'Mesa 4' },
  }))
  const withClient = createOrderPrintDocument(orderInput({
    type: 'Local',
    customerIdentityType: 'table',
    tableIdentifier: 'Mesa 4',
    hasOptionalClient: true,
    customer: { name: 'Hugo' },
  }))
  const legacyGuest = createOrderPrintDocument(orderInput({
    type: 'Local',
    customerIdentityType: 'guest_name',
    customer: { name: 'Nome legado' },
  }))

  assert.equal(withoutClient.customer.name, 'Mesa 4')
  assert.equal(withClient.customer.name, 'Mesa 4 · Hugo')
  assert.equal(legacyGuest.customer.name, 'Nome legado')
})

test('money formatting uses Brazilian ticket formatting', () => {
  assert.equal(formatPrintMoneyCents(8750), 'R$ 87,50')
})

test('order print document uses the official number and leaves it blank when absent', () => {
  assert.equal(createOrderPrintDocument(orderInput({ orderNumber: 58 })).order.number, '58')
  assert.equal(createOrderPrintDocument(orderInput({ orderNumber: undefined })).order.number, '')
})

test('test print document is explicit and never fabricates an order', () => {
  const document = createTestPrintDocument({
    businessName: 'Amor & Sabor',
    createdAt: '2026-09-03T23:31:00.000Z',
  })

  assert.equal(document.version, 1)
  assert.equal(document.type, 'test')
  assert.equal(document.business.name, 'Amor & Sabor')
  assert.deepEqual(document.test, {
    title: 'TESTE DE IMPRESSÃO',
    message: 'Impressora configurada com sucesso.',
    createdAt: '2026-09-03T23:31:00.000Z',
  })
  assert.equal('order' in document, false)
  assert.equal('customer' in document, false)
  assert.equal('financial' in document, false)
})


test('operation profile logo and contact metadata never enter the canonical order print document', () => {
  const document = createOrderPrintDocument(orderInput({
    businessName: 'Amor & Sabor Renomeado',
    businessLogo: { present: true, version: 'logo-v2', url: '/api/business/logo' },
    businessPhone: 'PROFILE_PHONE_MARKER',
    businessAddress: 'PROFILE_ADDRESS_MARKER',
  }))

  assert.deepEqual(document.business, { name: 'Amor & Sabor Renomeado' })
  assert.deepEqual(Object.keys(document.business), ['name'])
  const serialized = JSON.stringify(document)
  assert.doesNotMatch(serialized, /logo-v2|\/api\/business\/logo|PROFILE_PHONE_MARKER|PROFILE_ADDRESS_MARKER/)
})


test('scheduled order print document keeps requested service timestamp and semantic label', () => {
  const scheduled = createOrderPrintDocument(orderInput({
    scheduledFor: '2026-09-04T15:00:00.000Z',
    scheduleLabel: 'AGENDADO',
  }))
  const reservation = createOrderPrintDocument(orderInput({
    type: 'Local',
    customerIdentityType: 'table',
    tableIdentifier: 'Mesa 4',
    customer: { name: 'Hugo' },
    hasOptionalClient: true,
    scheduledFor: '2026-09-04T23:00:00.000Z',
    scheduleLabel: 'RESERVA',
  }))

  assert.equal(scheduled.order.scheduledFor, '2026-09-04T15:00:00.000Z')
  assert.equal(scheduled.order.scheduleLabel, 'AGENDADO')
  assert.equal(reservation.order.scheduledFor, '2026-09-04T23:00:00.000Z')
  assert.equal(reservation.order.scheduleLabel, 'RESERVA')
  assert.equal(reservation.customer.name, 'Mesa 4 · Hugo')
})

test('immediate print document leaves schedule metadata empty', () => {
  const document = createOrderPrintDocument(orderInput())
  assert.equal(document.order.scheduledFor, '')
  assert.equal(document.order.scheduleLabel, '')
})

test('Task 13 print documents distinguish partially paid orders and pending refunds', () => {
  for (const status of ['Parcialmente pago','Devolução pendente','Pago','Pendente']) {
    const printed=createOrderPrintDocument({totalCents:9500,payment:{status,method:'Pix'}})
    assert.equal(printed.payment.status,status)
  }
})
