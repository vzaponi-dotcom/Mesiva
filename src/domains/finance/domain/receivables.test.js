import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildPendingReceivableEntries,
  buildReceivablesForecast,
  calculateReceivableSummary,
  getDaysOverdue,
  getExpectedPaymentDate,
  getPaidReceivableOrders,
  getPendingReceivableOrders,
  getReceivableTiming,
  groupPendingOrders,
  groupReceivableEntriesByClient,
  sortReceivableEntries,
  sortReceivableGroups,
} from './receivables.js'

const orderRules = Object.freeze({
  isOrderCancelled: (order) => order?.status === 'Cancelado',
  isOrderPaid: (order) => order?.paymentStatus === 'Pago',
  getPendingAmount: (order) => order?.paymentStatus === 'Pago' ? 0 : Math.max(0, Number(order?.total) || 0),
})

const order = (id, overrides = {}) => ({
  id,
  clientId: 'c1',
  client: 'Maria',
  customerIdentityType: 'registered_client',
  total: 20,
  paymentStatus: 'Pendente',
  status: 'Em preparo',
  ...overrides,
})

test('registered client pending orders group by client id', () => {
  const groups = groupPendingOrders([
    order('o1', { total: 20 }),
    order('o2', { total: 30 }),
  ], orderRules)
  assert.equal(groups.length, 1)
  assert.equal(groups[0].label, 'Maria')
  assert.equal(groups[0].orders.length, 2)
  assert.equal(groups[0].total, 50)
})

test('guest names and legacy tables stay order-scoped even when labels repeat', () => {
  const groups = groupPendingOrders([
    order('o1', { clientId: null, client: 'João', customerIdentityType: 'guest_name' }),
    order('o2', { clientId: null, client: 'João', customerIdentityType: 'guest_name' }),
    order('o3', { clientId: null, client: 'Mesa 04', customerIdentityType: 'table', tableTabId: null }),
    order('o4', { clientId: null, client: 'Mesa 04', customerIdentityType: 'table', tableTabId: null }),
  ], orderRules)
  assert.equal(groups.length, 4)
  assert.deepEqual(groups.map((group) => group.orders.length), [1, 1, 1, 1])
})

test('table orders group only when they share the same table tab id', () => {
  const groups = groupPendingOrders([
    order('o1', { clientId: null, client: 'Mesa 04', customerIdentityType: 'table', tableTabId: 'tab-1', total: 20 }),
    order('o2', { clientId: null, client: 'Mesa 04', customerIdentityType: 'table', tableTabId: 'tab-1', total: 30 }),
    order('o3', { clientId: null, client: 'Mesa 04', customerIdentityType: 'table', tableTabId: null, total: 10 }),
  ], orderRules)
  assert.equal(groups.length, 2)
  const tab = groups.find((group) => group.tableTabId === 'tab-1')
  assert.equal(tab.kind, 'table_tab')
  assert.equal(tab.orders.length, 2)
  assert.equal(tab.total, 50)
})

test('cancelled unpaid orders are not receivables', () => {
  const pending = getPendingReceivableOrders([
    order('valid', { total: 35 }),
    order('cancelled', { total: 70, status: 'Cancelado' }),
    order('paid', { total: 50, paymentStatus: 'Pago' }),
  ], orderRules)

  assert.deepEqual(pending.map((item) => item.id), ['valid'])
  assert.equal(groupPendingOrders([order('cancelled', { total: 70, status: 'Cancelado' })], orderRules).length, 0)
})

const datedPending = (overrides = {}) => ({
  ...order('dated', {
    orderDate: '2026-09-06',
    createdAt: '2026-09-06T12:00:00.000Z',
    status: 'Finalizado',
    customerIdentityType: 'registered_client',
    items: [],
    ...overrides,
  }),
})

test('timing uses a payment promise over order date and separates paid and cancelled orders', () => {
  const paid = datedPending({ id: 'paid', paymentStatus: 'Pago', paidAt: '2026-09-06T14:00:00.000Z' })
  const cancelled = datedPending({ id: 'cancelled', status: 'Cancelado' })
  const promised = datedPending({ orderDate: '2026-09-01', promisedPaymentDate: '2026-09-11' })

  assert.equal(getExpectedPaymentDate(promised), '2026-09-11')
  assert.deepEqual(getReceivableTiming(promised, '2026-09-06', orderRules), {
    status: 'upcoming', expectedDate: '2026-09-11', daysOverdue: 0,
  })
  assert.equal(getReceivableTiming(promised, '2026-09-11', orderRules).status, 'today')
  assert.equal(getReceivableTiming(promised, '2026-09-12', orderRules).status, 'overdue')
  assert.equal(getDaysOverdue(datedPending({ orderDate: '2026-09-03' }), '2026-09-06', orderRules), 3)
  assert.equal(getReceivableTiming(paid, '2026-09-06', orderRules).status, 'paid')
  assert.equal(getReceivableTiming(cancelled, '2026-09-06', orderRules).status, 'excluded')
  assert.deepEqual(getPaidReceivableOrders([paid, cancelled], orderRules), [paid])
})

test('summary and forecast partition pending amounts by expected payment date', () => {
  const orders = [
    datedPending({ id: 'late', orderDate: '2026-09-03', total: 40 }),
    datedPending({ id: 'today', total: 50 }),
    datedPending({ id: 'tomorrow', promisedPaymentDate: '2026-09-07', total: 60 }),
    datedPending({ id: 'later', promisedPaymentDate: '2026-09-20', total: 70 }),
  ]
  assert.deepEqual(calculateReceivableSummary(orders, '2026-09-06', orderRules), {
    today: { amount: 50, count: 1 }, upcoming: { amount: 130, count: 2 }, overdue: { amount: 40, count: 1 },
  })
  const forecast = buildReceivablesForecast(orders, '2026-09-06', 7, orderRules)
  assert.deepEqual(forecast.overdue, { amount: 40, count: 1 })
  assert.deepEqual(forecast.today, { amount: 50, count: 1 })
  assert.deepEqual(forecast.days[0], { date: '2026-09-07', amount: 60, count: 1 })
  assert.deepEqual(forecast.later, { amount: 70, count: 1 })
})

test('pending receivable entries omit unpaid open table-tab orders', () => {
  const entries = buildPendingReceivableEntries([
    datedPending({ id: 'delivery', customerIdentityType: 'registered_client' }),
    datedPending({ id: 'tab-1', client: 'Mesa 04', clientId: null, customerIdentityType: 'table', tableTabId: 'tab-1' }),
  ], '2026-09-06', orderRules)

  assert.deepEqual(entries.map((entry) => entry.order.id), ['delivery'])
})

test('paid receivable orders omit every table-tab order', () => {
  const paid = getPaidReceivableOrders([
    order('ordinary-paid', { paymentStatus: 'Pago' }),
    order('table-tab-paid', { clientId: null, client: 'Mesa 04', customerIdentityType: 'table', tableTabId: 'tab-4', paymentStatus: 'Pago' }),
  ], orderRules)

  assert.deepEqual(paid.map((item) => item.id), ['ordinary-paid'])
})

test('sort keeps urgency, recent and value modes independent of Orders lifecycle', () => {
  const entries = [
    { key: 'upcoming', total: 30, createdAt: '2026-09-02', expectedDate: '2026-09-07', timing: { status: 'upcoming' } },
    { key: 'overdue', total: 10, createdAt: '2026-09-01', expectedDate: '2026-09-03', timing: { status: 'overdue' } },
    { key: 'today', total: 50, createdAt: '2026-09-03', expectedDate: '2026-09-06', timing: { status: 'today' } },
  ]
  assert.deepEqual(sortReceivableEntries(entries, 'urgency').map((entry) => entry.key), ['overdue', 'today', 'upcoming'])
  assert.deepEqual(sortReceivableEntries(entries, 'recent').map((entry) => entry.key), ['today', 'upcoming', 'overdue'])
  assert.deepEqual(sortReceivableEntries(entries, 'value-desc').map((entry) => entry.key), ['today', 'upcoming', 'overdue'])
})


const receivableEntry = (id, overrides = {}) => {
  const nextOrder = order(id, {
    clientPhone: '(11) 99999-0000',
    orderDate: '2026-09-20',
    createdAt: '2026-09-20T12:00:00.000Z',
    ...overrides.order,
  })
  return {
    key: `order:${id}`,
    kind: 'order',
    order: nextOrder,
    orders: [nextOrder],
    label: nextOrder.client,
    total: overrides.total ?? nextOrder.total,
    expectedDate: overrides.expectedDate ?? nextOrder.orderDate,
    timing: overrides.timing ?? { status: 'today', expectedDate: overrides.expectedDate ?? nextOrder.orderDate, daysOverdue: 0 },
    createdAt: overrides.createdAt ?? nextOrder.createdAt,
  }
}

test('client receivable groups use client id instead of repeated labels', () => {
  const groups = groupReceivableEntriesByClient([
    receivableEntry('o1', { total: 20 }),
    receivableEntry('o2', { total: 30 }),
    receivableEntry('o3', { total: 40, order: { clientId: 'c2', client: 'Maria' } }),
  ])

  assert.equal(groups.length, 2)
  const first = groups.find((group) => group.key === 'client:c1')
  const second = groups.find((group) => group.key === 'client:c2')
  assert.equal(first.kind, 'client')
  assert.equal(first.count, 2)
  assert.equal(first.total, 50)
  assert.equal(first.phone, '(11) 99999-0000')
  assert.deepEqual(first.orders.map((item) => item.id), ['o1', 'o2'])
  assert.equal(second.count, 1)
})

test('guest receivables remain single even when names repeat', () => {
  const groups = groupReceivableEntriesByClient([
    receivableEntry('g1', { order: { clientId: null, client: 'João', customerIdentityType: 'guest_name' } }),
    receivableEntry('g2', { order: { clientId: null, client: 'João', customerIdentityType: 'guest_name' } }),
  ])

  assert.equal(groups.length, 2)
  assert.deepEqual(groups.map((group) => group.key), ['order:g1', 'order:g2'])
  assert.ok(groups.every((group) => group.kind === 'single' && group.count === 1))
})

test('client group aggregate timing keeps the most urgent and oldest overdue entry', () => {
  const groups = groupReceivableEntriesByClient([
    receivableEntry('future', {
      total: 60,
      expectedDate: '2026-09-28',
      timing: { status: 'upcoming', expectedDate: '2026-09-28', daysOverdue: 0 },
      createdAt: '2026-09-22T10:00:00.000Z',
    }),
    receivableEntry('late-newer', {
      total: 20,
      expectedDate: '2026-09-23',
      timing: { status: 'overdue', expectedDate: '2026-09-23', daysOverdue: 3 },
      createdAt: '2026-09-23T10:00:00.000Z',
    }),
    receivableEntry('late-older', {
      total: 49,
      expectedDate: '2026-09-21',
      timing: { status: 'overdue', expectedDate: '2026-09-21', daysOverdue: 5 },
      createdAt: '2026-09-21T10:00:00.000Z',
    }),
  ])

  assert.equal(groups.length, 1)
  assert.equal(groups[0].total, 129)
  assert.equal(groups[0].count, 3)
  assert.deepEqual(groups[0].timing, { status: 'overdue', expectedDate: '2026-09-21', daysOverdue: 5 })
  assert.equal(groups[0].earliestExpectedDate, '2026-09-21')
  assert.equal(groups[0].oldestCreatedAt, '2026-09-21T10:00:00.000Z')
  assert.equal(groups[0].newestCreatedAt, '2026-09-23T10:00:00.000Z')
})

test('group totals reflect only the receivable entries supplied by the active filter', () => {
  const overdueOnly = groupReceivableEntriesByClient([
    receivableEntry('late', {
      total: 49,
      timing: { status: 'overdue', expectedDate: '2026-09-21', daysOverdue: 5 },
      expectedDate: '2026-09-21',
    }),
  ])

  assert.equal(overdueOnly[0].total, 49)
  assert.equal(overdueOnly[0].count, 1)
})

test('client receivable group sorting supports urgency, recent and value modes', () => {
  const groups = groupReceivableEntriesByClient([
    receivableEntry('c1-late', {
      total: 30,
      expectedDate: '2026-09-20',
      timing: { status: 'overdue', expectedDate: '2026-09-20', daysOverdue: 6 },
      createdAt: '2026-09-20T08:00:00.000Z',
      order: { clientId: 'c1', client: 'Ana' },
    }),
    receivableEntry('c2-today', {
      total: 80,
      expectedDate: '2026-09-26',
      timing: { status: 'today', expectedDate: '2026-09-26', daysOverdue: 0 },
      createdAt: '2026-09-25T08:00:00.000Z',
      order: { clientId: 'c2', client: 'Bia' },
    }),
    receivableEntry('c3-future', {
      total: 120,
      expectedDate: '2026-09-28',
      timing: { status: 'upcoming', expectedDate: '2026-09-28', daysOverdue: 0 },
      createdAt: '2026-09-26T08:00:00.000Z',
      order: { clientId: 'c3', client: 'Caio' },
    }),
  ])

  assert.deepEqual(sortReceivableGroups(groups, 'urgency').map((group) => group.key), ['client:c1', 'client:c2', 'client:c3'])
  assert.deepEqual(sortReceivableGroups(groups, 'recent').map((group) => group.key), ['client:c3', 'client:c2', 'client:c1'])
  assert.deepEqual(sortReceivableGroups(groups, 'value-desc').map((group) => group.key), ['client:c3', 'client:c2', 'client:c1'])
})

test('active Local reservation without table tab never becomes a standalone receivable', () => {
  const reservation = datedPending({
    id: 'reservation-local',
    clientId: null,
    client: 'Mesa 05 · Ana',
    customerIdentityType: 'table',
    type: 'Local',
    tableTabId: null,
    tableReservationId: 'reservation-1',
    tableReservationStatus: 'reserved',
    orderDate: '2026-09-10',
    total: 85,
  })

  assert.deepEqual(getPendingReceivableOrders([reservation], orderRules), [])
  assert.deepEqual(buildPendingReceivableEntries([reservation], '2026-09-06', orderRules), [])
  assert.deepEqual(groupPendingOrders([reservation], orderRules), [])
  assert.deepEqual(calculateReceivableSummary([reservation], '2026-09-06', orderRules), {
    today: { amount: 0, count: 0 },
    upcoming: { amount: 0, count: 0 },
    overdue: { amount: 0, count: 0 },
  })
  assert.deepEqual(buildReceivablesForecast([reservation], '2026-09-06', 7, orderRules).days[3], {
    date: '2026-09-10', amount: 0, count: 0,
  })
})

test('reservation exclusion is explicit and does not hide legacy table-shaped orders without reservation identity', () => {
  const legacyTable = datedPending({
    id: 'legacy-table',
    clientId: null,
    client: 'Mesa 04',
    customerIdentityType: 'table',
    type: 'Local',
    tableTabId: null,
    tableReservationId: null,
    orderDate: '2026-09-06',
    total: 30,
  })
  const reservation = {
    ...legacyTable,
    id: 'reservation-context',
    type: 'Entrega',
    customerIdentityType: 'registered_client',
    clientId: 'c9',
    client: 'Reserva inconsistente protegida',
    tableReservationId: 'reservation-9',
    tableReservationStatus: 'reserved',
  }

  assert.deepEqual(getPendingReceivableOrders([legacyTable], orderRules).map(({ id }) => id), ['legacy-table'])
  assert.deepEqual(getPendingReceivableOrders([reservation], orderRules), [])
})

test('converted, cancelled and no-show reservation orders stay out of receivables', () => {
  const converted = datedPending({
    id: 'converted',
    clientId: null,
    client: 'Mesa 02',
    customerIdentityType: 'table',
    type: 'Local',
    tableTabId: 'tab-converted',
    tableReservationId: 'reservation-converted',
    tableReservationStatus: 'converted',
  })
  const cancelled = datedPending({
    id: 'cancelled-reservation',
    clientId: null,
    customerIdentityType: 'table',
    type: 'Local',
    tableReservationId: 'reservation-cancelled',
    tableReservationStatus: 'cancelled',
    status: 'Cancelado',
  })
  const noShow = datedPending({
    id: 'no-show-reservation',
    clientId: null,
    customerIdentityType: 'table',
    type: 'Local',
    tableReservationId: 'reservation-no-show',
    tableReservationStatus: 'no_show',
    status: 'Cancelado',
  })

  assert.deepEqual(getPendingReceivableOrders([converted, cancelled, noShow], orderRules), [])
  assert.deepEqual(getPaidReceivableOrders([
    { ...converted, paymentStatus: 'Pago' },
    { ...cancelled, paymentStatus: 'Pago' },
    { ...noShow, paymentStatus: 'Pago' },
  ], orderRules), [])
})

test('future delivery and pickup remain forecast receivables by future orderDate while paid-at-checkout is excluded', () => {
  const delivery = datedPending({
    id: 'future-delivery',
    type: 'Entrega',
    orderDate: '2026-09-09',
    promisedPaymentDate: null,
    total: 60,
  })
  const pickup = datedPending({
    id: 'future-pickup',
    type: 'Retirada',
    orderDate: '2026-09-12',
    promisedPaymentDate: null,
    total: 45,
  })
  const paidDelivery = datedPending({
    id: 'future-paid',
    type: 'Entrega',
    orderDate: '2026-09-10',
    paymentStatus: 'Pago',
    paidAt: '2026-09-06T15:00:00.000Z',
    total: 70,
  })

  const pending = getPendingReceivableOrders([delivery, pickup, paidDelivery], orderRules)
  assert.deepEqual(pending.map(({ id }) => id), ['future-delivery', 'future-pickup'])
  assert.equal(getReceivableTiming(delivery, '2026-09-06', orderRules).status, 'upcoming')
  assert.equal(getReceivableTiming(pickup, '2026-09-06', orderRules).status, 'upcoming')

  const forecast = buildReceivablesForecast([delivery, pickup, paidDelivery], '2026-09-06', 7, orderRules)
  assert.deepEqual(forecast.days[2], { date: '2026-09-09', amount: 60, count: 1 })
  assert.deepEqual(forecast.days[5], { date: '2026-09-12', amount: 45, count: 1 })
  assert.equal(forecast.days.reduce((sum, day) => sum + day.amount, 0), 105)
})

test('Task 13 receivables include only outstanding cents and omit refund-only balances', async () => {
  // Finance receives an injected Orders rule contract; the domain must not
  // import Orders directly, including from tests.
  const rules={
    isOrderCancelled: o=>o.status==='Cancelado',
    isOrderPaid: o=>o.paymentStatus==='Pago',
    getPendingAmount: o=>Number.isSafeInteger(o.dueCents)
      ? Math.max(0,o.dueCents)/100
      : o.paymentStatus==='Pago' ? 0 : Math.max(0,Number(o.total)||0),
  }
  const partial=order('partial',{total:95,paymentId:'p1',paymentStatus:'Parcialmente pago',dueCents:1500})
  const unpaid=order('unpaid',{total:30,paymentStatus:'Pendente',dueCents:3000})
  const overpaid=order('overpaid',{total:65,paymentId:'p2',paymentStatus:'Devolução pendente',dueCents:0,refundDueCents:1500})
  const pending=getPendingReceivableOrders([partial,unpaid,overpaid],rules)
  assert.deepEqual(pending.map(o=>o.id),['partial','unpaid'])
  const entries=buildPendingReceivableEntries([partial,unpaid,overpaid],'2026-10-12',rules)
  assert.deepEqual(entries.map(e=>e.total),[15,30])
  assert.equal(calculateReceivableSummary([partial,unpaid,overpaid],'2026-10-12',rules).today.amount,45)
  assert.equal(groupPendingOrders([partial,unpaid,overpaid],rules)[0].total,45)
})

test('Task 16 paid closed-comanda order with an edited amount owes an actionable individual due',()=>{
 const rules={
   isOrderCancelled:o=>o.status==='Cancelado',
   isOrderPaid:o=>o.paymentStatus==='Pago',
   getPendingAmount:o=>Number.isSafeInteger(o.dueCents)?o.dueCents/100:Math.max(0,Number(o.total)||0),
 }
 const openTab=order('open-tab',{customerIdentityType:'table',clientId:null,tableTabId:'tab-open',
   paymentStatus:'Pendente',dueCents:5000,total:50})
 const paidTab=order('closed-tab-edit',{customerIdentityType:'table',clientId:null,tableTabId:'tab-closed',
   paymentId:'paid-shared',paymentStatus:'Parcialmente pago',dueCents:1500,total:95})
 const other=order('ordinary',{customerIdentityType:'registered_client',dueCents:3000,total:30})
 const entries=buildPendingReceivableEntries([openTab,paidTab,other],'2026-10-12',rules)
 assert.deepEqual(entries.map(e=>[e.order.id,e.total]),[['closed-tab-edit',15],['ordinary',30]])
})
