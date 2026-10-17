import test from 'node:test'
import assert from 'node:assert/strict'
import { buildFutureScheduledOrdersModel, buildKitchenQueueModel } from './kitchenQueue.js'
import { act } from 'react-test-renderer'
import { buttonNamed, nodeText, renderWithNavigation, workspaceHarness } from '../../../test-support/renderWorkspace.js'

const now = new Date('2026-09-04T11:01:00.000Z')
const ids = (entries) => entries.map(({ order }) => order.id)

const scheduledOrder = {
  id: 'scheduled-1',
  status: 'Em preparo',
  type: 'Entrega',
  createdAt: '2026-09-04T08:00:00.000Z',
  scheduledFor: '2026-09-04T15:00:00.000Z',
}

const fixtures = [
  { id: 'old-operational', status: 'Em preparo', type: 'Retirada', createdAt: '2026-09-04T08:00:00.000Z', scheduledFor: '2026-09-04T11:00:00.000Z', items: [{ name: 'Marmita' }] },
  { id: 'order-1048', orderNumber: 116, status: 'Em preparo', client: 'João Silva', type: 'Entrega', createdAt: '2026-09-04T10:30:00.000Z', items: [{ name: 'Pudim' }] },
  { id: 'desired-1230', status: 'Em preparo', type: 'Retirada', createdAt: '2026-09-04T08:00:00.000Z', scheduledFor: '2026-09-04T12:30:00.000Z' },
  { id: 'desired-1200', status: 'Em preparo', type: 'Entrega', createdAt: '2026-09-04T08:00:00.000Z', scheduledFor: '2026-09-04T12:00:00.000Z' },
  { id: 'finished-order', status: 'Finalizado', type: 'Local', createdAt: '2026-09-04T09:00:00.000Z', finishedAt: '2026-09-04T10:45:00.000Z' },
  { id: 'cancelled-order', status: 'Cancelado', type: 'Local', createdAt: '2026-09-04T09:00:00.000Z' },
]

test('each active order belongs to exactly one main queue at the boundary', () => {
  const before = new Date('2026-09-04T14:09:59.999Z')
  const atStart = new Date('2026-09-04T14:10:00.000Z')

  assert.deepEqual(ids(buildKitchenQueueModel([scheduledOrder], before, '').scheduled), ['scheduled-1'])
  assert.deepEqual(ids(buildKitchenQueueModel([scheduledOrder], before, '').preparing), [])
  assert.deepEqual(ids(buildKitchenQueueModel([scheduledOrder], atStart, '').scheduled), [])
  assert.deepEqual(ids(buildKitchenQueueModel([scheduledOrder], atStart, '').preparing), ['scheduled-1'])
})

test('late is an additional flag and never creates a third queue', () => {
  const lateImmediate = { id: 'late-immediate', status: 'Em preparo', type: 'Local', createdAt: '2026-09-04T14:40:00.000Z' }
  const lateScheduled = { id: 'late-scheduled', status: 'Em preparo', type: 'Entrega', createdAt: '2026-09-04T13:00:00.000Z', scheduledFor: '2026-09-04T15:00:00.000Z' }
  const model = buildKitchenQueueModel([lateImmediate, lateScheduled], new Date('2026-09-04T15:16:00.000Z'), '')

  assert.equal(model.preparing.length, 2)
  assert.equal(model.counts.late, 2)
  assert.equal(Object.hasOwn(model, 'late'), false)
})

test('keeps stable identifier tie-breakers and desired-time ordering for scheduled queue', () => {
  const model = buildKitchenQueueModel([
    { id: 'preparing-b', status: 'Em preparo', type: 'Local', createdAt: '2026-09-04T09:00:00.000Z' },
    { id: 'preparing-a', status: 'Em preparo', type: 'Local', createdAt: '2026-09-04T09:00:00.000Z' },
    { id: 'scheduled-b', status: 'Em preparo', type: 'Entrega', createdAt: '2026-09-04T08:00:00.000Z', scheduledFor: '2026-09-04T12:30:00.000Z' },
    { id: 'scheduled-a', status: 'Em preparo', type: 'Entrega', createdAt: '2026-09-04T08:00:00.000Z', scheduledFor: '2026-09-04T12:30:00.000Z' },
    { id: 'scheduled-first', status: 'Em preparo', type: 'Entrega', createdAt: '2026-09-04T08:00:00.000Z', scheduledFor: '2026-09-04T12:00:00.000Z' },
  ], now, '')

  assert.deepEqual(ids(model.preparing), ['preparing-a', 'preparing-b'])
  assert.deepEqual(ids(model.scheduled), ['scheduled-first', 'scheduled-a', 'scheduled-b'])
})

test('prioritizes the most overdue deadline even when its operational start is newer', () => {
  const model = buildKitchenQueueModel([
    {
      id: 'scheduled-25-late',
      status: 'Em preparo',
      type: 'Entrega',
      createdAt: '2026-09-04T12:00:00.000Z',
      scheduledFor: '2026-09-04T14:50:00.000Z',
    },
    {
      id: 'immediate-40-late',
      status: 'Em preparo',
      type: 'Local',
      createdAt: '2026-09-04T14:20:00.000Z',
    },
  ], new Date('2026-09-04T15:30:00.000Z'), '')

  assert.deepEqual(ids(model.preparing), ['immediate-40-late', 'scheduled-25-late'])
})

test('places overdue orders before orders that are still within deadline', () => {
  const model = buildKitchenQueueModel([
    {
      id: 'scheduled-on-time',
      status: 'Em preparo',
      type: 'Entrega',
      createdAt: '2026-09-04T12:00:00.000Z',
      scheduledFor: '2026-09-04T14:50:00.000Z',
    },
    {
      id: 'immediate-late',
      status: 'Em preparo',
      type: 'Local',
      createdAt: '2026-09-04T14:20:00.000Z',
    },
  ], new Date('2026-09-04T15:00:00.000Z'), '')

  assert.deepEqual(ids(model.preparing), ['immediate-late', 'scheduled-on-time'])
})

test('among on-time orders, places the nearest deadline first', () => {
  const model = buildKitchenQueueModel([
    {
      id: 'scheduled-later-deadline',
      status: 'Em preparo',
      type: 'Entrega',
      createdAt: '2026-09-04T12:00:00.000Z',
      scheduledFor: '2026-09-04T14:50:00.000Z',
    },
    {
      id: 'immediate-earlier-deadline',
      status: 'Em preparo',
      type: 'Local',
      createdAt: '2026-09-04T14:20:00.000Z',
    },
  ], new Date('2026-09-04T14:40:00.000Z'), '')

  assert.deepEqual(ids(model.preparing), ['immediate-earlier-deadline', 'scheduled-later-deadline'])
})

test('excludes final and cancelled orders from active queues', () => {
  const model = buildKitchenQueueModel(fixtures, now, '')

  assert.deepEqual(ids(model.allActive), ['old-operational', 'order-1048', 'desired-1230', 'desired-1200'])
  assert.equal(model.totalVisible, 4)
})

test('search filters visible queues without changing global indicators', () => {
  const globalModel = buildKitchenQueueModel(fixtures, now, '')
  const searchModel = buildKitchenQueueModel(fixtures, now, 'pudim')

  assert.deepEqual(ids(globalModel.preparing), ['order-1048', 'old-operational'])
  assert.deepEqual(ids(globalModel.scheduled), ['desired-1200', 'desired-1230'])
  assert.deepEqual(ids(searchModel.preparing), ['order-1048'])
  assert.deepEqual(ids(searchModel.scheduled), [])
  assert.equal(searchModel.totalVisible, 1)
  assert.deepEqual(searchModel.counts, globalModel.counts)
  assert.deepEqual(globalModel.counts, { preparing: 2, scheduled: 2, late: 1, finishedToday: 1 })
})

test('searches client, order identifiers, visible order number, products and attendance type without changing order', () => {
  assert.deepEqual(ids(buildKitchenQueueModel(fixtures, now, 'joão').preparing), ['order-1048'])
  assert.deepEqual(ids(buildKitchenQueueModel(fixtures, now, 'order-1048').preparing), ['order-1048'])
  assert.deepEqual(ids(buildKitchenQueueModel(fixtures, now, '1048').preparing), ['order-1048'])
  assert.deepEqual(ids(buildKitchenQueueModel(fixtures, now, '116').preparing), ['order-1048'])
  assert.deepEqual(ids(buildKitchenQueueModel(fixtures, now, '#116').preparing), ['order-1048'])
  assert.deepEqual(ids(buildKitchenQueueModel(fixtures, now, 'pedido 116').preparing), ['order-1048'])
  assert.deepEqual(ids(buildKitchenQueueModel(fixtures, now, 'pedido #116').preparing), ['order-1048'])
  assert.deepEqual(ids(buildKitchenQueueModel(fixtures, now, 'pudim').preparing), ['order-1048'])
  assert.deepEqual(ids(buildKitchenQueueModel(fixtures, now, 'entrega').preparing), ['order-1048'])
})


test('keeps future-day schedules outside operational queues and counters while preserving cross-midnight starts', () => {
  const reference = new Date('2026-09-04T15:00:00.000Z')
  const futureDelivery = {
    id: 'future-delivery',
    status: 'Em preparo',
    type: 'Entrega',
    createdAt: '2026-09-04T12:00:00.000Z',
    orderDate: '2026-09-05',
    scheduledFor: '2026-09-05T15:00:00.000Z',
  }
  const sameDay = {
    id: 'same-day',
    status: 'Em preparo',
    type: 'Retirada',
    createdAt: '2026-09-04T12:00:00.000Z',
    orderDate: '2026-09-04',
    scheduledFor: '2026-09-04T18:00:00.000Z',
  }
  const model = buildKitchenQueueModel([futureDelivery, sameDay], reference, '')
  const futureModel = buildFutureScheduledOrdersModel([futureDelivery, sameDay], reference, '')

  assert.deepEqual(ids(model.allActive), ['same-day'])
  assert.deepEqual(ids(model.scheduled), ['same-day'])
  assert.deepEqual(ids(model.preparing), [])
  assert.deepEqual(ids(futureModel.visible), ['future-delivery'])
  assert.equal(futureModel.totalCount, 1)
  assert.deepEqual(model.counts, { preparing: 0, scheduled: 1, late: 0, finishedToday: 0 })

  const crossMidnight = {
    id: 'cross-midnight',
    status: 'Em preparo',
    type: 'Local',
    createdAt: '2026-09-04T12:00:00.000Z',
    orderDate: '2026-09-05',
    scheduledFor: '2026-09-05T03:20:00.000Z',
    tableReservationId: 'reservation-cross-midnight',
    tableReservationStatus: 'reserved',
  }
  const afterOperationalStart = buildKitchenQueueModel(
    [crossMidnight],
    new Date('2026-09-05T02:40:00.000Z'),
    '',
  )
  const crossMidnightFuture = buildFutureScheduledOrdersModel(
    [crossMidnight],
    new Date('2026-09-05T02:40:00.000Z'),
    '',
  )
  assert.deepEqual(ids(afterOperationalStart.preparing), ['cross-midnight'])
  assert.deepEqual(ids(crossMidnightFuture.visible), [])
  assert.equal(afterOperationalStart.counts.preparing, 1)
})

test('future schedule search stays separate from current operational counters', () => {
  const reference = new Date('2026-09-04T15:00:00.000Z')
  const orders = [
    {
      id: 'today',
      status: 'Em preparo',
      type: 'Entrega',
      client: 'Hoje',
      createdAt: '2026-09-04T14:00:00.000Z',
    },
    {
      id: 'future-local',
      status: 'Em preparo',
      type: 'Local',
      client: 'Reserva Ana',
      createdAt: '2026-09-04T12:00:00.000Z',
      orderDate: '2026-09-06',
      scheduledFor: '2026-09-06T18:00:00.000Z',
      tableReservationId: 'reservation-1',
      tableReservationStatus: 'reserved',
    },
  ]

  const globalModel = buildKitchenQueueModel(orders, reference, '')
  const searchModel = buildKitchenQueueModel(orders, reference, 'reserva ana')
  const globalFuture = buildFutureScheduledOrdersModel(orders, reference, '')
  const searchFuture = buildFutureScheduledOrdersModel(orders, reference, 'reserva ana')

  assert.deepEqual(ids(globalModel.preparing), ['today'])
  assert.deepEqual(ids(globalFuture.visible), ['future-local'])
  assert.deepEqual(ids(searchModel.preparing), [])
  assert.deepEqual(ids(searchFuture.visible), ['future-local'])
  assert.deepEqual(searchModel.counts, globalModel.counts)
  assert.equal(searchModel.totalVisible, 0)
  assert.equal(searchFuture.totalCount, 1)
})

test('orders page lists Próximos dias with full schedule and reservation-only editing', async (t) => {
  const h = await workspaceHarness(t)
  const { default: Orders } = await h.load('/src/domains/orders/ui/Orders.jsx')
  const calls = []
  const futureOrders = [
    {
      id: 'future-delivery',
      orderNumber: 301,
      status: 'Em preparo',
      type: 'Entrega',
      client: 'Bruno',
      createdAt: '2026-09-04T12:00:00.000Z',
      orderDate: '2026-09-06',
      scheduledFor: '2026-09-06T15:00:00.000Z',
      total: 42,
      items: [{ id: 'item-delivery', name: 'Pizza', quantity: 1, unitPrice: 42 }],
    },
    {
      id: 'future-local',
      orderNumber: 302,
      status: 'Em preparo',
      type: 'Local',
      client: 'Mesa 4 · Ana',
      createdAt: '2026-09-04T12:00:00.000Z',
      orderDate: '2026-09-05',
      scheduledFor: '2026-09-05T18:00:00.000Z',
      tableReservationId: 'reservation-302',
      tableReservationStatus: 'reserved',
      total: 28,
      items: [{ id: 'item-local', name: 'Lanche', quantity: 1, unitPrice: 28 }],
    },
  ]
  const renderer = await renderWithNavigation(h, Orders, {
    orders: futureOrders,
    officialOrders: futureOrders,
    now: new Date('2026-09-04T15:00:00.000Z'),
    search: '',
    onSearchChange() {},
    currency: (value) => `R$ ${Number(value).toFixed(2)}`,
    onNewOrder() {},
    onFinalizeOrder() {},
    onCancelOrder() {},
    onEditReservation: (order) => calls.push(`edit:${order.id}`),
    onNavigatePrintQueue() {},
    onSoundEnabledChange() {},
    printing: {},
    granted: new Set(['orders.view', 'orders.create', 'orders.cancel']),
    canCreateOrders: true,
    canFinalizeOrders: true,
    canCancelOrders: true,
  })

  const future = renderer.root.findByProps({ className: 'future-scheduled-orders' })
  const copy = nodeText(future)
  assert.match(copy, /Próximos dias/)
  assert.match(copy, /05\/09\/2026/)
  assert.match(copy, /15:00/)
  assert.match(copy, /06\/09\/2026/)
  assert.match(copy, /12:00/)

  const editButtons = future.findAllByType('button').filter((button) => nodeText(button) === 'Editar reserva')
  assert.equal(editButtons.length, 1)
  await act(async () => editButtons[0].props.onClick())
  assert.deepEqual(calls, ['edit:future-local'])

  assert.ok(buttonNamed(future, 'Exibir detalhes'))
  assert.ok(buttonNamed(future, 'Cancelar pedido'))
  assert.ok(buttonNamed(future, 'Cancelar reserva'))
})


test('orders page combines modality, late status and search without mixing active or future queues', async (t) => {
  const h = await workspaceHarness(t)
  const { default: Orders } = await h.load('/src/domains/orders/ui/Orders.jsx')
  const orders = [
    { id: 'delivery-late', status: 'Em preparo', type: 'Entrega', client: 'Entrega atrasada', createdAt: '2026-09-04T13:00:00.000Z' },
    { id: 'delivery-new', status: 'Em preparo', type: 'Entrega', client: 'Entrega recente', createdAt: '2026-09-04T14:55:00.000Z' },
    { id: 'pickup', status: 'Em preparo', type: 'Retirada', client: 'Retirada balcão', createdAt: '2026-09-04T14:54:00.000Z' },
    { id: 'table', status: 'Em preparo', type: 'Local', tableTabId: 'tab-1', client: 'Mesa 2 Hugo', createdAt: '2026-09-04T14:53:00.000Z' },
    { id: 'pickup-scheduled', status: 'Em preparo', type: 'Retirada', client: 'Retirada agendada', createdAt: '2026-09-04T12:00:00.000Z', scheduledFor: '2026-09-04T18:00:00.000Z' },
    { id: 'table-future', status: 'Em preparo', type: 'Local', client: 'Mesa reservada', createdAt: '2026-09-04T12:00:00.000Z', orderDate: '2026-09-05', scheduledFor: '2026-09-05T18:00:00.000Z', tableReservationId: 'res-1', tableReservationStatus: 'reserved' },
  ]
  const renderer = await renderWithNavigation(h, Orders, {
    orders,
    officialOrders: orders,
    now: new Date('2026-09-04T15:00:00.000Z'),
    search: '',
    onSearchChange() {},
    currency: (value) => `R$ ${Number(value).toFixed(2)}`,
    onFinalizeOrder() {},
    onCancelOrder() {},
    printing: {},
    granted: new Set(['orders.view']),
    canCreateOrders: false,
    canFinalizeOrders: false,
    canCancelOrders: false,
  })
  const queueText = (index) => nodeText(renderer.root.findAllByProps({ className: 'kitchen-ticket-list' })[index])
  const clickModality = async (label) => {
    const buttons = renderer.root.findByProps({ 'aria-label': 'Filtrar por modalidade' }).findAllByType('button')
    const button = buttons.find((item) => nodeText(item) === label)
    assert.ok(button, `Modalidade ${label} disponível`)
    await act(async () => button.props.onClick())
  }
  assert.match(queueText(0), /Entrega atrasada/)
  assert.match(queueText(0), /Mesa 2 Hugo/)

  await clickModality('Mesa')
  assert.match(queueText(0), /Mesa 2 Hugo/)
  assert.doesNotMatch(queueText(0), /Entrega atrasada/)
  assert.match(queueText(2), /Mesa reservada/)

  await clickModality('Retirada')
  assert.match(queueText(0), /Retirada balcão/)
  assert.match(queueText(1), /Retirada agendada/)
  assert.doesNotMatch(queueText(2), /Mesa reservada/)

  await clickModality('Entrega')
  const lateButton = renderer.root.findByProps({ 'aria-label': 'Mostrar apenas pedidos em atraso' })
  await act(async () => lateButton.props.onClick())
  assert.match(queueText(0), /Entrega atrasada/)
  assert.doesNotMatch(queueText(0), /Entrega recente/)

  await clickModality('Mesa')
  assert.match(queueText(0), /Nenhum pedido corresponde aos filtros selecionados/)

  await act(async () => renderer.root.findAllByType('button').find((button) => nodeText(button) === 'Todos').props.onClick())
  assert.match(queueText(0), /Mesa 2 Hugo/)
  await clickModality('Todas')
  assert.match(queueText(0), /Entrega recente/)
  assert.match(queueText(0), /Retirada balcão/)
})
