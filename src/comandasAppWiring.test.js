import { getBusinessDate } from '../shared/finance.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { act } from 'react-test-renderer'
import { workspaceHarness as createWorkspaceHarness, workspaceTables, nodeText, buttonNamed } from './test-support/renderWorkspace.js'
import { comandaDetail, deferred, detailResponse } from './test-support/comandaFixtures.js'
import { authenticatedSession, markSystemNotificationsRead } from './test-support/appSessionFixtures.js'

const workspaceHarness = async (...args) => {
  const harness = await createWorkspaceHarness(...args)
  markSystemNotificationsRead(harness)
  return harness
}


const effectivePaymentConfig = {
  version: 'payment-test-v1', revisions: { paymentMethods: 1, cancellationReasons: 1 },
  paymentMethods: { methods: [
    { code: 'pix', label: 'Pix', value: 'Pix' },
    { code: 'cash', label: 'Dinheiro', value: 'Dinheiro' },
    { code: 'debit_card', label: 'Cartão de débito', value: 'Cartão de débito' },
    { code: 'credit_card', label: 'Cartão de crédito', value: 'Cartão de crédito' },
    { code: 'transfer', label: 'Transferência', value: 'Transferência' },
    { code: 'other', label: 'Outro', value: 'Outro' },
  ], defaultMethod: 'pix' },
  cancellationReasons: { items: [
    { id: 'duplicate_order', label: 'Pedido duplicado', requiresNote: false },
  ] },
}
const effectiveCheckoutConfig = {
  ...effectivePaymentConfig,
  revisions: { ...effectivePaymentConfig.revisions, operations: 1 },
  operations: {
    enabledModalities: ['Entrega', 'Retirada', 'Local'],
    defaultModality: 'Entrega',
    timing: { scheduledPrepLeadMinutes: 50, scheduledLateGraceMinutes: 15, immediateLateAfterMinutes: 30, immediateVeryLateAfterMinutes: 40 },
  },
}
async function paymentWorkspace(t, mobile = false) {
  const h = await workspaceHarness(t, { mobile })
  const state = { tables: workspaceTables, expired: false, relogged: false, pending: [], detail: comandaDetail, bootstrapCalls: 0 }
  globalThis.fetch = async (path, options = {}) => {
    if (String(path).startsWith('/api/bootstrap?')) path = '/api/bootstrap'
    if (path.endsWith('/cancel')) return state.deferCancellation.promise
    if (path === '/api/orders') return state.deferOrders ? state.deferOrders.promise : jsonResponse({ orders: state.bootstrapData?.orders || [] })
    if (path.endsWith('/payment')) {
      const p = deferred(); state.pending.push({ ...p, path, options }); return p.promise
    }
    if (path.startsWith('/api/table-tabs/')) {
      if (state.queueDetails) { const p = deferred(); state.queueDetails.push({ ...p, path }); return p.promise }
      if (state.deferDetail) return state.deferDetail.promise
      return detailResponse(state.details?.[path] || state.detail)
    }
    if (path === '/api/bootstrap') {
      state.bootstrapCalls++
      if (state.deferBootstrap) return state.deferBootstrap.promise
      if (state.bootstrapError) throw new Error(state.bootstrapError)
      if (state.expired) return { ok: false, status: 401, json: async () => ({ error: { message: 'Sessão expirada' } }) }
      return { ok: true, json: async () => structuredClone({ tables: state.tables, tableTabs: [], orders: [], movements: [], clients: [], products: [], financeSettings: null, effectiveBusinessConfig: effectivePaymentConfig, ...state.bootstrapData }) }
    }
    if (path === '/api/auth/login') { state.relogged = true; return jsonResponse({}) }
    const responses = {
      '/api/auth/session': authenticatedSession,
      '/api/printing/stations': { stations: [{ id: 'test-station', platform: 'other', isPrimary: false, autoPrintEnabled: false }] },
      '/api/printing/jobs?limit=100': { jobs: [] },
      '/api/printing/jobs/summary': { summary: {} },
    }
    assert.ok(Object.hasOwn(responses, path), path)
    return { ok: true, json: async () => responses[path] }
  }
  const { default: App } = await h.load('/src/App.jsx')
  const { renderer: r } = await h.renderAdminApp(App)
  const navigate = async (name) => act(async () => buttonNamed(r.root.findByProps({ 'aria-label': 'Menu principal' }), name).props.onClick())
  const select = async () => act(async () => r.root.findByProps({ 'aria-label': 'Mesas ativas' }).findAllByType('button')[0].props.onClick())
  const pay = async () => {
    const action = buttonNamed(r.root, 'Registrar pagamento')
    assert.ok(action, 'occupied detail must expose full payment')
    await act(async () => action.props.onClick())
    await act(async () => { void r.root.findByType('form').props.onSubmit({ preventDefault() {} }) })
  }
  await navigate('Comandas'); await select()
  return { h, r, state, navigate, select, pay }
}

const paidResult = () => ({
  receipt: { id: 'receipt-tab-42', totalCents: 12345, total: 123.45, tableTabId: 'tab-42' },
  allocations: [{ id: 'allocation-tab-42', receiptId: 'receipt-tab-42', methodCode: 'pix', methodLabel: 'Pix', amountCents: 12345, amount: 123.45 }],
  payments: [{ id: 'payment-tab-42', orderId: 'paid-order', receiptId: 'receipt-tab-42', amount: 123.45 }],
  orders: [{ id: 'paid-order', client: 'Mesa 7', total: 123.45, paymentStatus: 'Pago', status: 'Finalizado', type: 'Local' }],
  movements: [{ id: 'paid-movement', description: 'Pagamento comanda', value: 123.45, type: 'entrada', date: '2026-09-10', paymentMethod: 'Pix' }],
  tableTab: { id: 'tab-42', number: 42, tableId: 'occupied', tableIdentifier: 'Mesa 7', status: 'closed' },
  tables: workspaceTables.map((table) => table.id === 'occupied' ? { ...table, occupancy: 'free', openTableTab: null } : table),
})
const jsonResponse = (data) => ({ ok: true, json: async () => data })

test('Table Service external actions publish printing confirmation through the global toast', async (t) => {
  const { h, r } = await paymentWorkspace(t)
  const { default: TableServiceExternalActions } = await h.load('/src/app/surfaces/table-service/TableServiceExternalActions.jsx')
  const externalActions = r.root.findByType(TableServiceExternalActions)
  await act(async () => externalActions.props.onToast('Impressão enviada para a fila'))
  assert.match(nodeText(r.root), /Impressão enviada para a fila/)
})

for (const syncOutcome of ['success', 'failure']) test(`accepted payment reconciles after an applied snapshot and selection change (${syncOutcome})`, async (t) => {
  const { h, r, state, pay, navigate } = await paymentWorkspace(t)
  const other = { id: 'other', name: 'Terraço', isActive: true, occupancy: 'occupied', sortOrder: 3, openTableTab: { id: 'tab-43', number: 43, itemCount: 3, totalCents: 12345 } }
  state.details = { '/api/table-tabs/tab-43': { ...comandaDetail, id: 'tab-43', number: 43, table: { id: 'other', name: 'Terraço' } } }
  await pay()
  state.tables = [...workspaceTables, other]
  await act(async () => h.fireInterval(5000))
  await act(async () => r.root.findByProps({ 'aria-label': 'Mesas ativas' }).findAllByType('button').at(-1).props.onClick())
  state.bootstrapData = { ...paidResult(), tables: [...paidResult().tables, other], tableTabs: [paidResult().tableTab] }
  if (syncOutcome === 'failure') state.bootstrapError = 'Reconciliação indisponível'
  const reads = state.bootstrapCalls
  await act(async () => state.pending[0].resolve(jsonResponse(paidResult())))
  assert.ok(state.bootstrapCalls > reads, 'accepted financial effects must reconcile even after the UI owner changes')
  assert.match(nodeText(r.root.findByProps({ 'aria-label': 'Detalhe da comanda' })), /Comanda 43.*Terraço/)
  assert.doesNotMatch(nodeText(r.root), /recebido via/)
  if (syncOutcome === 'failure') {
    assert.ok(buttonNamed(r.root, 'Tentar sincronizar'), 'financial sync failure must remain actionable on the replacement selection')
    await navigate('Clientes'); await navigate('Comandas')
    state.bootstrapError = null
    await act(async () => buttonNamed(r.root, 'Tentar sincronizar').props.onClick())
  }
  const { Comandas } = await h.load('/src/domains/table-service/index.js')
  assert.deepEqual(r.root.findByType(Comandas).props.selection, { tableId: 'other', tableTabId: 'tab-43' })
  assert.match(nodeText(r.root.findByProps({ 'aria-label': 'Mesas ativas' })), /Mesa 7Livre/)
  assert.equal(buttonNamed(r.root, 'Tentar sincronizar'), undefined)
  await navigate('A receber')
  const { default: Receivables } = await h.load('/src/domains/finance/ui/Receivables.jsx')
  assert.deepEqual(r.root.findByType(Receivables).props.orders, paidResult().orders)
  assert.deepEqual(r.root.findByType(Receivables).props.movements, paidResult().movements)
})

for (const readState of ['started', 'failed']) test(`partial free-table reconciliation cannot settle while a newer orders read ${readState}`, async (t) => {
  const { h, r, state, pay, navigate } = await paymentWorkspace(t)
  const unpaid = [{ ...paidResult().orders[0], paymentStatus: 'Pendente' }]
  state.bootstrapData = { orders: unpaid, tableTabs: [{ ...paidResult().tableTab, status: 'open' }], movements: [] }
  await act(async () => h.fireInterval(5000))
  await pay()
  await act(async () => h.fireInterval(5000))
  const partial = deferred()
  state.deferBootstrap = partial
  await act(async () => state.pending[0].resolve(jsonResponse(paidResult())))
  const newerOrders = deferred()
  state.deferOrders = newerOrders
  await navigate('Pedidos')
  if (readState === 'failed') await act(async () => newerOrders.reject(new Error('Leitura mais recente falhou')))
  state.deferBootstrap = null
  state.bootstrapError = 'Sem reconciliação completa'
  await act(async () => partial.resolve(jsonResponse({ ...paidResult(), tableTabs: [paidResult().tableTab] })))
  await navigate('Comandas')
  const { Comandas } = await h.load('/src/domains/table-service/index.js')
  assert.equal(r.root.findByType(Comandas).props.selection, null, 'obsolete visual ownership clears even while financial reconciliation remains pending')
  assert.doesNotMatch(nodeText(r.root), /recebido via Pix/)
  assert.ok(buttonNamed(r.root, 'Tentar sincronizar'), 'free tables alone cannot discharge financial synchronization')
  await navigate('A receber')
  const { default: Receivables } = await h.load('/src/domains/finance/ui/Receivables.jsx')
  assert.deepEqual(r.root.findByType(Receivables).props.orders, unpaid)
  if (readState === 'started') await act(async () => newerOrders.reject(new Error('Leitura mais recente falhou')))
  await navigate('Comandas')
  state.bootstrapError = null
  state.bootstrapData = { ...paidResult(), tableTabs: [paidResult().tableTab] }
  await act(async () => buttonNamed(r.root, 'Tentar sincronizar').props.onClick())
  assert.equal(r.root.findByType(Comandas).props.selection, null)
  assert.equal(buttonNamed(r.root, 'Tentar sincronizar'), undefined)
  await navigate('A receber')
  assert.deepEqual(r.root.findByType(Receivables).props.orders, paidResult().orders)
  assert.deepEqual(r.root.findByType(Receivables).props.movements, paidResult().movements)
  await navigate('Comandas')
  await act(async () => r.root.findByProps({ 'aria-label': 'Mesas ativas' }).findAllByType('button')[0].props.onClick())
  const { NewOrderRoute } = await h.load('/src/domains/orders/ui/NewOrderRoute.jsx')
  const route = r.root.findByType(NewOrderRoute)
  assert.equal(Object.hasOwn(route.props, 'tableTabs'), false)
  assert.equal(route.props.expectedTableTabId, '')
})

for (const stale of ['orders', 'movements', 'tableTabs']) test(`a fully applied reconciliation still requires accepted payment evidence in ${stale}`, async (t) => {
  const { h, r, state, pay, navigate } = await paymentWorkspace(t)
  await pay()
  await act(async () => h.fireInterval(5000))
  state.bootstrapData = { ...paidResult(), tableTabs: [paidResult().tableTab] }
  if (stale === 'orders') state.bootstrapData.orders = [{ ...paidResult().orders[0], paymentStatus: 'Pendente' }]
  if (stale === 'movements') state.bootstrapData.movements = []
  if (stale === 'tableTabs') state.bootstrapData.tableTabs = [{ ...paidResult().tableTab, status: 'open' }]
  await act(async () => state.pending[0].resolve(jsonResponse(paidResult())))
  const { Comandas } = await h.load('/src/domains/table-service/index.js')
  assert.equal(r.root.findByType(Comandas).props.selection, null, `obsolete visual ownership clears even when ${stale} evidence is stale`)
  assert.doesNotMatch(nodeText(r.root), /recebido via/)
  assert.ok(buttonNamed(r.root, 'Tentar sincronizar'))
  state.bootstrapData = { ...paidResult(), tableTabs: [paidResult().tableTab] }
  await act(async () => buttonNamed(r.root, 'Tentar sincronizar').props.onClick())
  assert.equal(r.root.findByType(Comandas).props.selection, null)
  await navigate('A receber')
  const { default: Receivables } = await h.load('/src/domains/finance/ui/Receivables.jsx')
  assert.deepEqual(r.root.findByType(Receivables).props.orders, paidResult().orders)
  assert.deepEqual(r.root.findByType(Receivables).props.movements, paidResult().movements)
})

test('a newer cancellation rejects three financial collections without free tables completing payment sync', async (t) => {
  const { h, r, state, pay, navigate, select } = await paymentWorkspace(t)
  const otherOrder = { ...paidResult().orders[0], id: 'order-77', client: 'Outro pedido', tableTabId: 'tab-77' }
  const otherTab = { id: 'tab-77', number: 77, tableId: null, status: 'open' }
  const refund = { id: 'refund-77', description: 'Estorno mais recente', value: 123.45, type: 'saida', date: '2026-09-10' }
  state.bootstrapData = { orders: [{ ...paidResult().orders[0], paymentStatus: 'Pendente' }, otherOrder], movements: [], tableTabs: [{ ...paidResult().tableTab, status: 'open' }, otherTab] }
  await act(async () => h.fireInterval(5000))
  await pay()
  await act(async () => h.fireInterval(5000))
  await select() // retires only the old payment UI; its network response is pending
  await navigate('Pedidos')
  await act(async () => buttonNamed(r.root.findByProps({ 'aria-label': 'Navegação de Pedidos' }), 'Histórico').props.onClick())
  await act(async () => buttonNamed(r.root, 'Hoje').props.onClick())
  await act(async () => buttonNamed(r.root, 'Todo o período').props.onClick())
  const otherRow = r.root.findAllByType('article').find((row) => nodeText(row).includes('Outro pedido'))
  await act(async () => otherRow.findAllByType('button').find(node => node.props['aria-haspopup'] === 'menu').props.onClick())
  await act(async () => buttonNamed(otherRow, 'Cancelar pedido').props.onClick())
  const { default: SystemSelect } = await h.load('/src/shared/ui/SystemSelect.jsx')
  await act(async () => r.root.findByType(SystemSelect).props.onChange('duplicate_order'))
  await act(async () => buttonNamed(r.root, 'Sim').props.onClick())
  await act(async () => r.root.findAllByType(SystemSelect).find((select) => select.props.label === 'Forma do estorno').props.onChange('Pix'))
  await act(async () => r.root.findByType('form').props.onSubmit({ preventDefault() {} }))
  state.deferCancellation = deferred()
  await act(async () => { void buttonNamed(r.root, 'Confirmar cancelamento definitivamente').props.onClick() })
  await navigate('Comandas')
  const read = deferred()
  state.deferBootstrap = read
  await act(async () => state.pending[0].resolve(jsonResponse(paidResult())))
  const cancelled = { ...otherOrder, status: 'Cancelado' }
  const closedOtherTab = { ...otherTab, status: 'closed' }
  await act(async () => state.deferCancellation.resolve(jsonResponse({ order: cancelled, movement: refund, tableTab: closedOtherTab })))
  state.deferBootstrap = null
  state.bootstrapError = 'Reconciliação pós-mudança indisponível'
  await act(async () => read.resolve(jsonResponse({ ...paidResult(), orders: [...paidResult().orders, otherOrder], tableTabs: [paidResult().tableTab, otherTab] })))
  assert.ok(buttonNamed(r.root, 'Tentar sincronizar'), 'tables applied alone must not complete accepted payment')
  assert.doesNotMatch(nodeText(r.root), /recebido via/)
  await navigate('A receber')
  const { default: Receivables } = await h.load('/src/domains/finance/ui/Receivables.jsx')
  assert.equal(r.root.findByType(Receivables).props.orders.find((order) => order.id === 'paid-order').paymentStatus, 'Pendente')
  assert.equal(r.root.findByType(Receivables).props.orders.find((order) => order.id === 'order-77').status, 'Cancelado')
  assert.deepEqual(r.root.findByType(Receivables).props.movements, [refund])
  await navigate('Comandas')
  state.bootstrapError = null
  state.bootstrapData = { tables: paidResult().tables, orders: [...paidResult().orders, cancelled], movements: [...paidResult().movements, refund], tableTabs: [paidResult().tableTab, closedOtherTab] }
  await act(async () => buttonNamed(r.root, 'Tentar sincronizar').props.onClick())
  assert.equal(buttonNamed(r.root, 'Tentar sincronizar'), undefined)
  await navigate('A receber')
  assert.deepEqual(r.root.findByType(Receivables).props.orders, [...paidResult().orders, cancelled])
  assert.deepEqual(r.root.findByType(Receivables).props.movements, [...paidResult().movements, refund])
  await navigate('Comandas')
  await act(async () => r.root.findByProps({ 'aria-label': 'Mesas ativas' }).findAllByType('button')[0].props.onClick())
  const { NewOrderRoute } = await h.load('/src/domains/orders/ui/NewOrderRoute.jsx')
  const route = r.root.findByType(NewOrderRoute)
  assert.equal(Object.hasOwn(route.props, 'tableTabs'), false)
  assert.equal(route.props.expectedTableTabId, '')
})

test('two accepted payments retain independent reconciliation obligations after automatic replacement', async (t) => {
  const { h, r, state, pay, select } = await paymentWorkspace(t)
  await pay()
  state.tables = workspaceTables.map((table) => table.id === 'occupied' ? { ...table, openTableTab: { id: 'tab-99', number: 99, itemCount: 3, totalCents: 12345 } } : table)
  state.detail = { ...comandaDetail, id: 'tab-99', number: 99 }
  await act(async () => h.fireInterval(5000))
  await select()
  await pay()
  await act(async () => h.fireInterval(5000))
  state.bootstrapError = 'Sincronização indisponível'
  await act(async () => state.pending[0].resolve(jsonResponse(paidResult())))
  const second = { ...paidResult(), orders: [{ ...paidResult().orders[0], id: 'order-99' }], movements: [{ ...paidResult().movements[0], id: 'movement-99' }], tableTab: { ...paidResult().tableTab, id: 'tab-99', number: 99 } }
  await act(async () => state.pending[1].resolve(jsonResponse(second)))
  state.bootstrapError = null
  // This complete read confirms the replacement only; the first acceptance is
  // still missing from the financial collections and cannot disappear with it.
  state.bootstrapData = { ...second, tableTabs: [second.tableTab] }
  await act(async () => buttonNamed(r.root, 'Tentar sincronizar').props.onClick())
  assert.ok(buttonNamed(r.root, 'Tentar sincronizar'), 'settling one payment cannot erase the other accepted payment obligation')
  state.bootstrapData = { tables: second.tables, orders: [...paidResult().orders, ...second.orders], movements: [...paidResult().movements, ...second.movements], tableTabs: [paidResult().tableTab, second.tableTab] }
  await act(async () => buttonNamed(r.root, 'Tentar sincronizar').props.onClick())
  assert.equal(buttonNamed(r.root, 'Tentar sincronizar'), undefined)
  assert.equal(state.pending.length, 2, 'reconciliation does not charge either comanda again')
})

for (const readState of ['started', 'failed']) test(`payment applies official effects when a newer bootstrap only ${readState}`, async (t) => {
  const { h, r, state, pay, navigate } = await paymentWorkspace(t)
  await pay()
  const read = deferred()
  state.deferBootstrap = read
  await act(async () => h.window.dispatchEvent(new Event('focus')))
  if (readState === 'failed') await act(async () => read.reject(new Error('Refresh falhou')))
  await act(async () => state.pending[0].resolve(jsonResponse(paidResult())))
  assert.match(nodeText(r.root.findByProps({ 'aria-label': 'Mesas ativas' })), /Mesa 7Livre/, 'starting a read is not applying authority')
  const { Comandas } = await h.load('/src/domains/table-service/index.js')
  assert.equal(r.root.findByType(Comandas).props.selection, null)
  if (readState === 'started') await act(async () => read.resolve(jsonResponse({ tables: workspaceTables, orders: [], tableTabs: [], movements: [] })))
  await navigate('A receber')
  const { default: Receivables } = await h.load('/src/domains/finance/ui/Receivables.jsx')
  assert.deepEqual(r.root.findByType(Receivables).props.orders, paidResult().orders)
  assert.deepEqual(r.root.findByType(Receivables).props.movements, paidResult().movements)
})

test('successful reconciled payment clears only the originating selection and uses applied authority', async (t) => {
  const { h, r, state, pay } = await paymentWorkspace(t)
  await pay()
  state.tables = workspaceTables.map((table) => ({ ...table, name: `${table.name} atual` }))
  await act(async () => h.window.dispatchEvent(new Event('focus')))
  const sync = deferred()
  state.deferBootstrap = sync
  await act(async () => state.pending[0].resolve(jsonResponse(paidResult())))
  assert.match(nodeText(r.root.findByProps({ 'aria-label': 'Mesas ativas' })), /Mesa 7 atual/, 'payment must not roll back the applied snapshot')
  await act(async () => sync.resolve(jsonResponse({ ...paidResult(), tableTabs: [paidResult().tableTab] })))
  const { Comandas } = await h.load('/src/domains/table-service/index.js')
  assert.equal(r.root.findByType(Comandas).props.selection, null, 'reconciliation must finish the originating selection too')
})

test('failed reconciliation after accepted payment exposes retry and blocks paying that tab again', async (t) => {
  const { h, r, state, pay } = await paymentWorkspace(t)
  await pay()
  await act(async () => h.window.dispatchEvent(new Event('focus')))
  state.bootstrapError = 'Sem conexão para sincronizar'
  await act(async () => state.pending[0].resolve(jsonResponse(paidResult())))
  assert.match(nodeText(r.root), /Pagamento registrado.*sincroniza/i)
  assert.ok(buttonNamed(r.root, 'Tentar sincronizar'), 'accepted payment needs an actionable sync state')
  assert.ok(!buttonNamed(r.root, 'Registrar pagamento') || buttonNamed(r.root, 'Registrar pagamento').props.disabled)
  assert.doesNotMatch(nodeText(r.root), /recebido via Pix/)
  state.bootstrapError = null
  state.bootstrapData = { ...paidResult(), tableTabs: [paidResult().tableTab] }
  await act(async () => buttonNamed(r.root, 'Tentar sincronizar').props.onClick())
  assert.match(nodeText(r.root.findByProps({ 'aria-label': 'Mesas ativas' })), /Mesa 7Livre/)
  const { Comandas } = await h.load('/src/domains/table-service/index.js')
  assert.equal(r.root.findByType(Comandas).props.selection, null)
  assert.equal(state.pending.length, 1, 'sync retry never resubmits the payment')
})

test('unresolved accepted payment survives leaving Comandas after obsolete visual ownership clears', async (t) => {
  const { h, r, state, pay, navigate } = await paymentWorkspace(t)
  await pay()
  await act(async () => h.window.dispatchEvent(new Event('focus')))
  state.bootstrapError = 'Sincronização indisponível'
  await act(async () => state.pending[0].resolve(jsonResponse(paidResult())))
  await navigate('Clientes'); await navigate('Comandas')
  assert.ok(buttonNamed(r.root, 'Tentar sincronizar'), 'navigation cannot erase accepted-but-unsynchronized payment state')
  state.bootstrapError = null
  state.bootstrapData = { ...paidResult(), tableTabs: [paidResult().tableTab] }
  await act(async () => buttonNamed(r.root, 'Tentar sincronizar').props.onClick())
  const { Comandas } = await h.load('/src/domains/table-service/index.js')
  assert.equal(r.root.findByType(Comandas).props.selection, null, 'settlement keeps the already-cleared visual ownership clear')
  assert.match(nodeText(r.root.findByProps({ 'aria-label': 'Mesas ativas' })), /Mesa 7Livre/)
  assert.equal(buttonNamed(r.root, 'Tentar sincronizar'), undefined)
  assert.doesNotMatch(nodeText(r.root), /recebido via Pix/)
})

test('periodic refresh stays payment-agnostic and explicit retry settles an earlier failed reconciliation', async (t) => {
  const { h, r, state, pay } = await paymentWorkspace(t)
  await pay()
  await act(async () => h.fireInterval(5000))
  state.bootstrapError = 'Refresh falhou'
  await act(async () => state.pending[0].resolve(jsonResponse(paidResult())))
  assert.ok(buttonNamed(r.root, 'Tentar sincronizar'))
  state.bootstrapError = null
  state.bootstrapData = { ...paidResult(), tableTabs: [paidResult().tableTab] }
  await act(async () => h.fireInterval(5000))
  assert.ok(buttonNamed(r.root, 'Tentar sincronizar'), 'generic polling cannot settle payment after the runtime bridge is removed')
  await act(async () => buttonNamed(r.root, 'Tentar sincronizar').props.onClick())
  assert.equal(buttonNamed(r.root, 'Tentar sincronizar'), undefined)
  const { Comandas } = await h.load('/src/domains/table-service/index.js')
  assert.equal(r.root.findByType(Comandas).props.selection, null)
})

for (const outcome of ['success', 'error', '401']) test(`automatic tab replacement clears A and explicit B selection isolates payment ${outcome}`, async (t) => {
  const { h, r, state, pay, select } = await paymentWorkspace(t)
  await pay()
  state.tables = workspaceTables.map((table) => table.id === 'occupied' ? { ...table, openTableTab: { id: 'tab-99', number: 99, itemCount: 3, totalCents: 12345 } } : table)
  state.detail = { ...comandaDetail, id: 'tab-99', number: 99 }
  await act(async () => h.window.dispatchEvent(new Event('focus')))
  assert.equal(r.root.findAllByProps({ role: 'dialog' }).length, 0)
  const { Comandas } = await h.load('/src/domains/table-service/index.js')
  assert.equal(r.root.findByType(Comandas).props.selection, null, 'B cannot inherit A selection')
  await select()
  assert.ok(!buttonNamed(r.root, 'Registrar pagamento').props.disabled, 'replacement cannot inherit the old request lock')
  await pay()
  assert.equal(state.pending[1].path, '/api/table-tabs/tab-99/payment')
  await act(async () => state.pending[0].resolve(outcome === 'success' ? jsonResponse(paidResult()) : { ok: false, status: outcome === '401' ? 401 : 500, json: async () => ({ error: { message: 'Erro da comanda antiga' } }) }))
  assert.match(nodeText(r.root.findByProps({ 'aria-label': 'Detalhe da comanda' })), /Comanda 99/)
  assert.doesNotMatch(nodeText(r.root), /Erro da comanda antiga|recebido via/)
  assert.ok(buttonNamed(r.root, 'Confirmar pagamento').props.disabled, 'old finally cannot unlock the replacement payment')
  await act(async () => state.pending[1].reject(new Error('Falha atual')))
})

for (const outcome of ['success', 'error']) test(`payment reconciliation ignores old bootstrap ${outcome} after business reset`, async (t) => {
  const { h, r, state, pay, navigate, select } = await paymentWorkspace(t)
  await pay()
  await act(async () => h.window.dispatchEvent(new Event('focus')))
  const oldRead = deferred()
  state.deferBootstrap = oldRead
  await act(async () => h.window.dispatchEvent(new Event('focus')))
  await act(async () => state.pending[0].resolve(jsonResponse(paidResult())))
  // The queued reconciliation belongs to the old session. A detail read can
  // expire that session while bootstrap is still waiting on the network.
  state.deferDetail = { promise: Promise.resolve({ ok: false, status: 401, json: async () => ({ error: { message: 'Sessão expirada' } }) }) }
  await navigate('Clientes'); await navigate('Comandas')
  state.deferBootstrap = null; state.deferDetail = null
  await act(async () => r.root.findByProps({ placeholder: 'Digite o PIN' }).props.onChange({ target: { value: '1234' } }))
  await act(async () => r.root.findByType('form').props.onSubmit({ preventDefault() {} }))
  await navigate('Comandas'); await select(); await pay()
  await act(async () => h.window.dispatchEvent(new Event('focus')))
  await act(async () => oldRead.resolve(outcome === 'success'
    ? jsonResponse({ tables: paidResult().tables, orders: paidResult().orders, movements: paidResult().movements, tableTabs: [paidResult().tableTab], clients: [], products: [] })
    : { ok: false, status: 401, json: async () => ({ error: { message: 'Sessão antiga' } }) }))
  assert.ok(buttonNamed(r.root, 'Confirmar pagamento')?.props.disabled, 'old reconciliation cannot clear the new session or its payment')
  assert.match(nodeText(r.root.findByProps({ 'aria-label': 'Mesas ativas' })), /Ocupada/)
  await act(async () => state.pending[1].reject(new Error('Pagamento não concluído')))
})

for (const mobile of [false, true]) test(`official full payment releases table and synchronizes all consumers (${mobile})`, async (t) => {
  const { h, r, state, pay, navigate } = await paymentWorkspace(t, mobile)
  await pay()
  assert.equal(state.pending.length, 1)
  assert.equal(state.pending[0].path, '/api/table-tabs/tab-42/payment')
  assert.deepEqual(JSON.parse(state.pending[0].options.body), { allocations: [{ methodCode: 'pix', amountCents: 12345 }], receivedDate: getBusinessDate() })
  assert.match(nodeText(r.root.findByProps({ 'aria-label': 'Mesas ativas' })), /Ocupada/)
  await act(async () => state.pending[0].resolve(jsonResponse(paidResult())))
  assert.equal(r.root.findAllByProps({ role: 'dialog' }).length, 0)
  assert.match(nodeText(r.root.findByProps({ 'aria-label': 'Mesas ativas' })), /Mesa 7Livre/)
  assert.match(nodeText(r.root.findByProps({ 'aria-label': 'Detalhe da comanda' })), /Selecione/)
  const { Comandas } = await h.load('/src/domains/table-service/index.js')
  assert.equal(r.root.findByType(Comandas).props.selection, null)
  assert.ok(!r.root.findByProps({ className: 'comandas-page' }).props.className.includes('has-mobile-detail'))
  await navigate('A receber')
  const { default: Receivables } = await h.load('/src/domains/finance/ui/Receivables.jsx')
  assert.deepEqual(r.root.findByType(Receivables).props.orders, paidResult().orders)
  assert.deepEqual(r.root.findByType(Receivables).props.movements, paidResult().movements)
  await navigate('Comandas')
  await act(async () => r.root.findByProps({ 'aria-label': 'Mesas ativas' }).findAllByType('button')[0].props.onClick())
  const { NewOrderRoute } = await h.load('/src/domains/orders/ui/NewOrderRoute.jsx')
  const route = r.root.findByType(NewOrderRoute)
  assert.equal(Object.hasOwn(route.props, 'tableTabs'), false)
  assert.equal(route.props.expectedTableTabId, '')
})

test('payment conflict refreshes official tables and removes the mobile closed selection', async (t) => {
  const { h, r, state, pay } = await paymentWorkspace(t, true)
  await pay()
  state.tables = paidResult().tables
  const reads = state.bootstrapCalls
  await act(async () => state.pending[0].resolve({ ok: false, status: 409, json: async () => ({ error: { message: 'Comanda já encerrada.' } }) }))
  assert.ok(state.bootstrapCalls > reads)
  assert.match(nodeText(r.root), /Comanda já encerrada/)
  assert.match(nodeText(r.root.findByProps({ 'aria-label': 'Mesas ativas' })), /Mesa 7Livre/)
  const { Comandas } = await h.load('/src/domains/table-service/index.js')
  assert.equal(r.root.findByType(Comandas).findByType('div').props.className, 'comandas-page')
})

test('official transfer keeps the selected tab and follows its authoritative table identity', async (t) => {
  const { h, r, state } = await paymentWorkspace(t)
  const transferredTables = workspaceTables.map((table) => {
    if (table.id === 'occupied') return { ...table, occupancy: 'free', openTableTab: null }
    if (table.id === 'free') return { ...table, occupancy: 'occupied', openTableTab: { ...workspaceTables[1].openTableTab } }
    return table
  })
  state.tables = transferredTables
  state.detail = { ...comandaDetail, table: { id: 'free', name: 'Varanda' } }

  await act(async () => h.window.dispatchEvent(new Event('focus')))

  const { Comandas } = await h.load('/src/domains/table-service/index.js')
  assert.deepEqual(r.root.findByType(Comandas).props.selection, { tableId: 'free', tableTabId: 'tab-42' })
  assert.match(nodeText(r.root.findByProps({ 'aria-label': 'Detalhe da comanda' })), /Comanda 42.*Varanda/)
})

test('payment completion cannot replace newer official tables or clear a newer selected tab', async (t) => {
  const { h, r, state, pay, select } = await paymentWorkspace(t)
  await pay()
  state.tables = workspaceTables.map((table) => table.id === 'occupied' ? { ...table, openTableTab: { id: 'tab-99', number: 99, itemCount: 1, totalCents: 2000 } } : table)
  state.detail = { ...comandaDetail, id: 'tab-99', number: 99, totalCents: 2000 }
  await act(async () => h.window.dispatchEvent(new Event('focus')))
  await select()
  state.bootstrapData = { orders: paidResult().orders, movements: paidResult().movements, tableTabs: [paidResult().tableTab, { id: 'tab-99', tableId: 'occupied', number: 99, status: 'open' }] }
  await act(async () => state.pending[0].resolve(jsonResponse(paidResult())))
  assert.match(nodeText(r.root.findByProps({ 'aria-label': 'Detalhe da comanda' })), /Comanda 99/)
  assert.match(nodeText(r.root.findByProps({ 'aria-label': 'Mesas ativas' })), /Comanda 99/)
  assert.ok(!buttonNamed(r.root, 'Registrar pagamento').props.disabled)
})

for (const outcome of ['success', 'error']) test(`old-session payment ${outcome} cannot mutate or unlock a newer session payment`, async (t) => {
  const { h, r, state, pay, navigate, select } = await paymentWorkspace(t)
  await pay()
  state.expired = true
  await act(async () => h.window.dispatchEvent(new Event('focus')))
  state.expired = false
  await act(async () => r.root.findByProps({ placeholder: 'Digite o PIN' }).props.onChange({ target: { value: '1234' } }))
  await act(async () => r.root.findByType('form').props.onSubmit({ preventDefault() {} }))
  await navigate('Comandas'); await select(); await pay()
  await act(async () => state.pending[0].resolve(outcome === 'success' ? jsonResponse(paidResult()) : { ok: false, status: 401, json: async () => ({ error: { message: 'Erro antigo' } }) }))
  assert.ok(buttonNamed(r.root, 'Confirmar pagamento').props.disabled)
  assert.match(nodeText(r.root.findByProps({ 'aria-label': 'Mesas ativas' })), /Ocupada/)
  assert.doesNotMatch(nodeText(r.root), /Erro antigo|Pagamento de/)
  await navigate('A receber')
  const { default: Receivables } = await h.load('/src/domains/finance/ui/Receivables.jsx')
  assert.deepEqual(r.root.findByType(Receivables).props.orders, [])
  assert.deepEqual(r.root.findByType(Receivables).props.movements, [])
  await navigate('Comandas')
  await act(async () => state.pending[1].resolve(jsonResponse(paidResult())))
  assert.match(nodeText(r.root.findByProps({ 'aria-label': 'Mesas ativas' })), /Mesa 7Livre/)
})

test('payment settling after selection of another table keeps that detail and applies official effects', async (t) => {
  const { h, r, state, pay, navigate } = await paymentWorkspace(t)
  const other = { id: 'other', name: 'Terraço', isActive: true, occupancy: 'occupied', sortOrder: 3, openTableTab: { id: 'tab-43', number: 43, itemCount: 3, totalCents: 12345 } }
  state.tables = [...workspaceTables, other]
  state.details = { '/api/table-tabs/tab-43': { ...comandaDetail, id: 'tab-43', number: 43, table: { id: 'other', name: 'Terraço' } } }
  await act(async () => h.window.dispatchEvent(new Event('focus')))
  await pay()
  await act(async () => r.root.findByProps({ 'aria-label': 'Mesas ativas' }).findAllByType('button').at(-1).props.onClick())
  assert.equal(r.root.findAllByProps({ role: 'dialog' }).length, 0)
  await act(async () => state.pending[0].resolve(jsonResponse({ ...paidResult(), tables: [...paidResult().tables, other] })))
  assert.match(nodeText(r.root.findByProps({ 'aria-label': 'Detalhe da comanda' })), /Comanda 43.*Terraço/)
  assert.match(nodeText(r.root.findByProps({ 'aria-label': 'Mesas ativas' })), /Mesa 7Livre/)
  await navigate('A receber')
  const { default: Receivables } = await h.load('/src/domains/finance/ui/Receivables.jsx')
  assert.deepEqual(r.root.findByType(Receivables).props.orders, paidResult().orders)
})

for (const outcome of ['success', 'error']) test(`old detail ${outcome} cannot reach a relogged business using the same table identifiers`, async (t) => {
  const { h, r, state, navigate, select } = await paymentWorkspace(t)
  const oldDetail = deferred()
  state.deferDetail = oldDetail
  await act(async () => h.window.dispatchEvent(new Event('focus')))
  state.expired = true
  await act(async () => h.window.dispatchEvent(new Event('focus')))
  state.expired = false
  state.deferDetail = null
  state.detail = { ...comandaDetail, businessName: 'Outro negócio', items: [{ ...comandaDetail.items[0], note: 'Nova consulta' }] }
  await act(async () => r.root.findByProps({ placeholder: 'Digite o PIN' }).props.onChange({ target: { value: '1234' } }))
  await act(async () => r.root.findByType('form').props.onSubmit({ preventDefault() {} }))
  await navigate('Comandas'); await select()
  await act(async () => oldDetail.resolve(outcome === 'success' ? detailResponse() : { ok: false, status: 401, json: async () => ({ error: { message: 'Sessão antiga' } }) }))
  assert.match(nodeText(r.root.findByProps({ 'aria-label': 'Detalhe da comanda' })), /Nova consulta/)
  assert.doesNotMatch(nodeText(r.root), /Sem cebola|Sessão antiga/)
  assert.ok(!buttonNamed(r.root, 'Registrar pagamento').props.disabled)
})

test('payment failure retains the full dialog for retry and going offline blocks confirmation', async (t) => {
  const { h, r, state, pay } = await paymentWorkspace(t)
  await pay()
  await act(async () => state.pending[0].reject(new Error('Conexão interrompida')))
  assert.match(nodeText(r.root), /Conexão interrompida/)
  assert.ok(!buttonNamed(r.root, 'Confirmar pagamento').props.disabled)
  await act(async () => h.window.dispatchEvent(new Event('offline')))
  await act(async () => r.root.findByType('form').props.onSubmit({ preventDefault() {} }))
  assert.equal(state.pending.length, 1)
  assert.ok(buttonNamed(r.root, 'Confirmar pagamento').props.disabled)
  await act(async () => h.window.dispatchEvent(new Event('online')))
  await act(async () => { void r.root.findByType('form').props.onSubmit({ preventDefault() {} }) })
  assert.equal(state.pending.length, 2)
  await act(async () => state.pending[1].resolve(jsonResponse(paidResult())))
  assert.match(nodeText(r.root.findByProps({ 'aria-label': 'Mesas ativas' })), /Mesa 7Livre/)
})

const lifecycleProduct = { id: 'product-1', name: 'Coxinha', category: 'Lanches', presentationType: 'unit', price: 20, isActive: true }

for (const mobile of [false, true]) test(`slow detail coalesces real polling and change events and publishes before one follow-up (${mobile})`, async (t) => {
  const { h, r, state, navigate } = await paymentWorkspace(t, mobile)
  await navigate('Clientes')
  state.queueDetails = []
  await navigate('Comandas')
  assert.equal(state.queueDetails.length, 1)
  for (let tick = 0; tick < 4; tick++) await act(async () => h.fireInterval(5000))
  await act(async () => h.document.dispatchEvent(new Event('visibilitychange')))
  await act(async () => h.window.dispatchEvent(new Event('focus')))
  assert.equal(state.queueDetails.length, 1, '20 seconds of polling must not replace a slower in-flight detail')
  await act(async () => state.queueDetails[0].resolve(detailResponse({ ...comandaDetail, items: [{ ...comandaDetail.items[0], note: 'Primeiro snapshot lento' }] })))
  assert.match(nodeText(r.root.findByProps({ 'aria-label': 'Detalhe da comanda' })), /Primeiro snapshot lento/)
  assert.equal(state.queueDetails.length, 2, 'all signals coalesce into one follow-up')
  await act(async () => state.queueDetails[1].resolve(detailResponse({ ...comandaDetail, items: [{ ...comandaDetail.items[0], note: 'Snapshot atualizado' }] })))
  assert.match(nodeText(r.root.findByProps({ 'aria-label': 'Detalhe da comanda' })), /Snapshot atualizado/)
  assert.ok(!buttonNamed(r.root, 'Registrar pagamento').props.disabled)
  assert.equal(state.queueDetails.length, 2)
})

test('explicit reselection of the same table retires the old payment dialog generation', async (t) => {
  const { r, state, pay, select } = await paymentWorkspace(t)
  await pay()
  await select()
  assert.equal(r.root.findAllByProps({ role: 'dialog' }).length, 0, 'a new selection intent must not inherit the old modal')
  await act(async () => state.pending[0].resolve({ ok: false, status: 500, json: async () => ({ error: { message: 'Erro de outra seleção' } }) }))
  assert.doesNotMatch(nodeText(r.root), /Erro de outra seleção/)
})

for (const change of ['replacement', 'session']) test(`mobile payment-sheet teardown releases body after official ${change}`, async (t) => {
  const { h, r, state } = await paymentWorkspace(t, true)
  h.document.body.style.overflow = 'scroll'
  await act(async () => buttonNamed(r.root, 'Registrar pagamento').props.onClick())
  await act(async () => r.root.findByProps({ role: 'combobox' }).props.onClick())
  assert.equal(r.root.findAllByProps({ role: 'dialog' }).length, 2)
  assert.equal(h.document.body.style.overflow, 'hidden')
  if (change === 'session') state.expired = true
  else {
    state.tables = workspaceTables.map((table) => table.id === 'occupied' ? { ...table, openTableTab: { id: 'tab-99', number: 99, itemCount: 3, totalCents: 12345 } } : table)
    state.detail = { ...comandaDetail, id: 'tab-99', number: 99 }
  }
  await act(async () => h.window.dispatchEvent(new Event('focus')))
  assert.equal(r.root.findAllByProps({ role: 'dialog' }).length, 0)
  assert.equal(h.document.body.style.overflow, 'scroll')
})
const checkoutDetails = {
  '/api/table-tabs/tab-42': { tableTab: comandaDetail },
  ...Object.fromEntries([['tab-99', 99], ['tab-100', 100], ['new-tab-200', 200], ['new-tab-201', 201]].map(([id, number]) => [
    `/api/table-tabs/${id}`, { tableTab: { ...comandaDetail, id, number, table: { id: 'free', name: 'Varanda' }, orderCount: 1, itemCount: 1, totalCents: 2000 } },
  ])),
}

const buttonContaining = (root, text) => root.findAllByType('button').find((button) => nodeText(button).includes(text))
const ids = (records = []) => records.map((record) => record.id)

async function prepareLocalOrderForCheckout(renderer) {
  const search = renderer.root.findAllByType('input').find((input) => input.props.placeholder === 'Nome, categoria ou apresentação')
  await act(async () => search.props.onChange({ target: { value: lifecycleProduct.name } }))
  await act(async () => renderer.root.findByProps({ 'aria-label': `Adicionar ${lifecycleProduct.name}` }).props.onClick())
  await act(async () => buttonNamed(renderer.root, 'Revisar pedido →').props.onClick())
}

test('App renders official Comandas, preserves selection across destinations and blocks offline launches', async (t) => {
  const harness = await workspaceHarness(t)
  const requests = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (path, options) => {
    if (String(path).startsWith('/api/bootstrap?')) path = '/api/bootstrap'
    requests.push([path, options.method || 'GET'])
    const responses = {
      ...checkoutDetails,
      '/api/auth/session': authenticatedSession,
      '/api/bootstrap': { tables: workspaceTables, tableTabs: [], orders: [], clients: [], products: [], movements: [], financeSettings: null, effectiveBusinessConfig: effectiveCheckoutConfig },
      '/api/printing/stations': { stations: [{ id: 'test-station', platform: 'other', isPrimary: false, autoPrintEnabled: false }] },
      '/api/printing/jobs?limit=100': { jobs: [] },
      '/api/printing/jobs/summary': { summary: {} },
    }
    assert.ok(Object.hasOwn(responses, path), `Unexpected request: ${path}`)
    return { ok: true, json: async () => responses[path] }
  }
  t.after(() => { globalThis.fetch = originalFetch })
  const { default: App } = await harness.load('/src/App.jsx')
  const { renderer } = await harness.renderAdminApp(App)
  const desktop = () => renderer.root.findByProps({ 'aria-label': 'Menu principal' })
  assert.ok(buttonNamed(desktop(), 'Comandas'), 'App exposes its Comandas destination')
  await act(async () => buttonNamed(desktop(), 'Comandas').props.onClick())
  const tableList = () => renderer.root.findByProps({ 'aria-label': 'Mesas ativas' })
  assert.match(nodeText(tableList()), /Comanda 42.*123,45/)
  await act(async () => tableList().findAllByType('button')[0].props.onClick())
  assert.match(nodeText(renderer.root.findByProps({ 'aria-label': 'Detalhe da comanda' })), /Comanda 42/)
  await act(async () => buttonNamed(desktop(), 'Clientes').props.onClick())
  await act(async () => buttonNamed(desktop(), 'Comandas').props.onClick())
  assert.equal(tableList().findAllByType('button')[0].props['aria-pressed'], true)
  await act(async () => harness.window.dispatchEvent(new Event('offline')))
  assert.equal(tableList().findAllByType('button')[1].props.disabled, true)
  assert.ok(!tableList().findAllByType('button')[0].props.disabled)
  assert.ok(requests.every(([, method]) => method === 'GET'), 'consultation makes no mutations')
  await act(async () => harness.window.dispatchEvent(new Event('online')))
  await act(async () => tableList().findAllByType('button')[1].props.onClick())
  const { NewOrderRoute } = await harness.load('/src/domains/orders/ui/NewOrderRoute.jsx')
  assert.equal(renderer.root.findAllByType(NewOrderRoute).length, 1)
  assert.match(nodeText(renderer.root.findByProps({ 'aria-current': 'step' })), /Produtos/)
  await act(async () => buttonContaining(renderer.root, 'Voltar').props.onClick())
  const typeOptions = renderer.root.findByProps({ 'aria-label': 'Tipo do pedido' })
  assert.equal(buttonNamed(typeOptions, 'Consumo no local').props['aria-pressed'], true)
  assert.equal(renderer.root.findByProps({ className: 'new-order-table-grid' }).findAllByType('button').find((button) => nodeText(button).includes('Varanda')).props['aria-pressed'], true)
  await act(async () => buttonNamed(renderer.root, 'Cancelar venda').props.onClick())
  assert.match(nodeText(tableList()), /Varanda.*Livre/)
  await act(async () => buttonNamed(desktop(), 'Visão geral').props.onClick())
  await act(async () => buttonNamed(desktop(), 'Pedidos').props.onClick())
  const newOrder = buttonNamed(renderer.root, 'Novo pedido')
  assert.ok(newOrder, nodeText(renderer.root))
  await act(async () => newOrder.props.onClick())
  assert.equal(buttonNamed(renderer.root.findByProps({ 'aria-label': 'Tipo do pedido' }), 'Entrega').props['aria-pressed'], true)
  assert.equal(renderer.root.findAllByProps({ className: 'new-order-table-grid' }).length, 0)
})

test('an occupied comanda adds another order through the preselected wizard and returns to its summary', async (t) => {
  const harness = await workspaceHarness(t)
  const requests = []
  const afterCheckoutTables = workspaceTables.map((table) => table.id === 'occupied'
    ? { ...table, openTableTab: { ...table.openTableTab, itemCount: 4, totalCents: 14345 } }
    : table)
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (path, options = {}) => {
    if (String(path).startsWith('/api/bootstrap?')) path = '/api/bootstrap'
    requests.push([path, options])
    if (path === '/api/table-tabs/tab-42') return detailResponse(requests.some(([url]) => url === '/api/orders')
      ? { ...comandaDetail, itemCount: 4, totalCents: 14345, items: [...comandaDetail.items, { productId: 'product-1', name: 'Coxinha', presentation: '', note: '', quantity: 1, unitPriceCents: 2000, lineTotalCents: 2000 }] }
      : comandaDetail)
    const responses = {
      ...checkoutDetails,
      '/api/auth/session': authenticatedSession,
      '/api/bootstrap': { tables: workspaceTables, tableTabs: [], orders: [], clients: [], products: [lifecycleProduct], movements: [], financeSettings: null, effectiveBusinessConfig: effectiveCheckoutConfig },
      '/api/printing/stations': { stations: [{ id: 'test-station', platform: 'other', isPrimary: false, autoPrintEnabled: false }] },
      '/api/printing/jobs?limit=100': { jobs: [] },
      '/api/printing/jobs/summary': { summary: {} },
      '/api/orders': { order: { id: 'order-43', paymentStatus: 'Pendente', status: 'Em preparo' }, movement: null, tableTab: { id: 'tab-42', tableId: 'occupied', number: 42, status: 'open' }, tables: afterCheckoutTables },
    }
    assert.ok(Object.hasOwn(responses, path), `Unexpected request: ${path}`)
    return { ok: true, json: async () => responses[path] }
  }
  t.after(() => { globalThis.fetch = originalFetch })
  const { default: App } = await harness.load('/src/App.jsx')
  const { renderer } = await harness.renderAdminApp(App)
  const navigation = () => renderer.root.findByProps({ 'aria-label': 'Menu principal' })
  await act(async () => buttonNamed(navigation(), 'Comandas').props.onClick())
  await act(async () => renderer.root.findByProps({ 'aria-label': 'Mesas ativas' }).findAllByType('button')[0].props.onClick())

  const addOrder = buttonNamed(renderer.root.findByProps({ 'aria-label': 'Detalhe da comanda' }), 'Adicionar pedido')
  assert.ok(addOrder, 'occupied command detail exposes its add-order action')
  await act(async () => addOrder.props.onClick())
  assert.match(nodeText(renderer.root.findByProps({ 'aria-current': 'step' })), /Produtos/)
  assert.match(nodeText(renderer.root.findByProps({ className: 'new-order-context-strip' })), /Mesa 7/)
  await prepareLocalOrderForCheckout(renderer)
  assert.equal(buttonNamed(renderer.root, 'Salvar e receber'), undefined, 'table checkout must only be settled through the comanda')
  await act(async () => buttonNamed(renderer.root, 'Salvar pedido').props.onClick())
  assert.match(nodeText(renderer.root.findByProps({ 'aria-label': 'Detalhe da comanda' })), /Comanda 42.*4 itens.*143,45/)
  assert.match(nodeText(renderer.root.findByProps({ 'aria-label': 'Detalhe da comanda' })), /1x Coxinha/)
  assert.equal(requests.filter(([path]) => path === '/api/table-tabs/tab-42').length, 2)
  const orderRequest = requests.find(([path, options]) => path === '/api/orders' && options.method === 'POST')
  const orderPayload = JSON.parse(orderRequest[1].body)
  assert.equal(orderPayload.type, 'Local')
  assert.deepEqual(orderPayload.customerIdentity, { type: 'table', tableId: 'occupied' })
  assert.equal(orderPayload.expectedTableTabId, 'tab-42')
  assert.equal(orderPayload.items[0].productId, lifecycleProduct.id)
  assert.match(orderRequest[1].headers['idempotency-key'], /.+/)
})

test('an occupied comanda can cancel its preselected wizard without creating an order', async (t) => {
  const harness = await workspaceHarness(t)
  const requests = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (path, options = {}) => {
    if (String(path).startsWith('/api/bootstrap?')) path = '/api/bootstrap'
    requests.push([path, options])
    const responses = {
      ...checkoutDetails,
      '/api/auth/session': authenticatedSession,
      '/api/bootstrap': { tables: workspaceTables, tableTabs: [], orders: [], clients: [], products: [lifecycleProduct], movements: [], financeSettings: null, effectiveBusinessConfig: effectiveCheckoutConfig },
      '/api/printing/stations': { stations: [{ id: 'test-station', platform: 'other', isPrimary: false, autoPrintEnabled: false }] },
      '/api/printing/jobs?limit=100': { jobs: [] },
      '/api/printing/jobs/summary': { summary: {} },
    }
    assert.ok(Object.hasOwn(responses, path), `Unexpected request: ${path}`)
    return { ok: true, json: async () => responses[path] }
  }
  t.after(() => { globalThis.fetch = originalFetch })
  const { default: App } = await harness.load('/src/App.jsx')
  const { renderer } = await harness.renderAdminApp(App)
  const navigation = () => renderer.root.findByProps({ 'aria-label': 'Menu principal' })
  await act(async () => buttonNamed(navigation(), 'Comandas').props.onClick())
  await act(async () => renderer.root.findByProps({ 'aria-label': 'Mesas ativas' }).findAllByType('button')[0].props.onClick())
  await act(async () => buttonNamed(renderer.root.findByProps({ 'aria-label': 'Detalhe da comanda' }), 'Adicionar pedido').props.onClick())
  assert.match(nodeText(renderer.root.findByProps({ 'aria-current': 'step' })), /Produtos/)
  assert.match(nodeText(renderer.root.findByProps({ className: 'new-order-context-strip' })), /Mesa 7/)
  await act(async () => buttonNamed(renderer.root, 'Cancelar venda').props.onClick())
  assert.match(nodeText(renderer.root.findByProps({ 'aria-label': 'Detalhe da comanda' })), /Comanda 42.*3 itens.*123,45/)
  assert.equal(requests.filter(([path, options]) => path === '/api/orders' && options.method === 'POST').length, 0)
})

test('a stale occupied-comanda checkout keeps the wizard and refreshes authoritative tables for retry', async (t) => {
  const harness = await workspaceHarness(t)
  let bootstrapCalls = 0
  let checkoutAttempted = false
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (path, options = {}) => {
    if (String(path).startsWith('/api/bootstrap?')) path = '/api/bootstrap'
    if (path === '/api/bootstrap') {
      bootstrapCalls++
      const currentTables = checkoutAttempted
        ? workspaceTables.map((table) => table.id === 'occupied' ? { ...table, occupancy: 'free', openTableTab: null } : table)
        : workspaceTables
      return { ok: true, status: 200, json: async () => ({ tables: currentTables, tableTabs: [], orders: [], clients: [], products: [lifecycleProduct], movements: [], financeSettings: null, effectiveBusinessConfig: effectiveCheckoutConfig }) }
    }
    if (path === '/api/table-tabs/tab-42') return detailResponse(comandaDetail)
    if (path === '/api/orders' && options.method === 'POST') {
      checkoutAttempted = true
      return { ok: false, status: 409, json: async () => ({ error: { code: 'TABLE_TAB_CHANGED', message: 'A comanda mudou ou foi encerrada.' } }) }
    }
    const responses = {
      ...checkoutDetails,
      '/api/auth/session': authenticatedSession,
      '/api/printing/stations': { stations: [{ id: 'test-station', platform: 'other', isPrimary: false, autoPrintEnabled: false }] },
      '/api/printing/jobs?limit=100': { jobs: [] },
      '/api/printing/jobs/summary': { summary: {} },
    }
    assert.ok(Object.hasOwn(responses, path), `Unexpected request: ${path}`)
    return { ok: true, status: 200, json: async () => responses[path] }
  }
  t.after(() => { globalThis.fetch = originalFetch })

  const { default: App } = await harness.load('/src/App.jsx')
  const { NewOrderRoute } = await harness.load('/src/domains/orders/ui/NewOrderRoute.jsx')
  const { renderer } = await harness.renderAdminApp(App)
  const navigation = renderer.root.findByProps({ 'aria-label': 'Menu principal' })
  await act(async () => buttonNamed(navigation, 'Comandas').props.onClick())
  await act(async () => renderer.root.findByProps({ 'aria-label': 'Mesas ativas' }).findAllByType('button')[0].props.onClick())
  await act(async () => buttonNamed(renderer.root, 'Adicionar pedido').props.onClick())
  await prepareLocalOrderForCheckout(renderer)
  const beforeSubmitReads = bootstrapCalls
  await act(async () => buttonNamed(renderer.root, 'Salvar pedido').props.onClick())

  assert.equal(renderer.root.findAllByType(NewOrderRoute).length, 1, '409 must retain the prepared wizard')
  assert.ok(bootstrapCalls > beforeSubmitReads, '409 must refresh authoritative tables before retry')
  assert.match(nodeText(renderer.root), /A comanda mudou ou foi encerrada/)
  assert.equal(buttonNamed(renderer.root, 'Salvar pedido').props.disabled, false)
})

test('a successful table checkout returns to Comandas with the authoritative occupied summary selected', async (t) => {
  const harness = await workspaceHarness(t)
  const requests = []
  const createdTables = workspaceTables.map((table) => table.id === 'free'
    ? { ...table, occupancy: 'occupied', openTableTab: { id: 'tab-99', number: 99, itemCount: 1, totalCents: 2000 } }
    : table)
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (path, options = {}) => {
    if (String(path).startsWith('/api/bootstrap?')) path = '/api/bootstrap'
    requests.push([path, options])
    const responses = {
      ...checkoutDetails,
      '/api/auth/session': authenticatedSession,
      '/api/bootstrap': { tables: workspaceTables, tableTabs: [], orders: [], clients: [], products: [lifecycleProduct], movements: [], financeSettings: null, effectiveBusinessConfig: effectiveCheckoutConfig },
      '/api/printing/stations': { stations: [{ id: 'test-station', platform: 'other', isPrimary: false, autoPrintEnabled: false }] },
      '/api/printing/jobs?limit=100': { jobs: [] },
      '/api/printing/jobs/summary': { summary: {} },
      '/api/orders': { order: { id: 'order-99', paymentStatus: 'Pendente', status: 'Em preparo' }, movement: null, tableTab: { id: 'tab-99', tableId: 'free', number: 99, status: 'open' }, tables: createdTables },
    }
    assert.ok(Object.hasOwn(responses, path), `Unexpected request: ${path}`)
    return { ok: true, json: async () => responses[path] }
  }
  t.after(() => { globalThis.fetch = originalFetch })
  const { default: App } = await harness.load('/src/App.jsx')
  const { renderer } = await harness.renderAdminApp(App)
  const navigation = () => renderer.root.findByProps({ 'aria-label': 'Menu principal' })
  await act(async () => buttonNamed(navigation(), 'Comandas').props.onClick())
  await act(async () => renderer.root.findByProps({ 'aria-label': 'Mesas ativas' }).findAllByType('button')[1].props.onClick())
  await prepareLocalOrderForCheckout(renderer)
  await act(async () => buttonNamed(renderer.root, 'Salvar pedido').props.onClick())

  const tableList = renderer.root.findByProps({ 'aria-label': 'Mesas ativas' })
  const varanda = tableList.findAllByType('button').find((button) => nodeText(button).includes('Varanda'))
  assert.equal(varanda.props['aria-pressed'], true)
  assert.match(nodeText(tableList), /Varanda.*Comanda 99.*20,00/)
  const orderRequest = requests.find(([path, options]) => path === '/api/orders' && options.method === 'POST')
  assert.deepEqual(JSON.parse(orderRequest[1].body).customerIdentity, { type: 'table', tableId: 'free' })
  assert.equal(JSON.parse(orderRequest[1].body).items[0].productId, lifecycleProduct.id)
})

test('an unavailable table rejection retains the real wizard draft and retries with its idempotency key', async (t) => {
  const harness = await workspaceHarness(t)
  let tableUnavailable = false
  const orderRequests = []
  const retryTables = workspaceTables.map((table) => table.id === 'free'
    ? { ...table, occupancy: 'occupied', openTableTab: { id: 'tab-100', number: 100, itemCount: 1, totalCents: 2000 } }
    : table)
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (path, options = {}) => {
    if (String(path).startsWith('/api/bootstrap?')) path = '/api/bootstrap'
    if (path === '/api/orders' && options.method === 'POST') {
      orderRequests.push(options)
      if (orderRequests.length === 1) return { ok: false, status: 409, json: async () => ({ error: { message: 'A mesa não está disponível.' } }) }
      return { ok: true, json: async () => ({ order: { id: 'order-100', paymentStatus: 'Pendente', status: 'Em preparo' }, movement: null, tableTab: { id: 'tab-100', tableId: 'free', number: 100, status: 'open' }, tables: retryTables }) }
    }
    const bootstrapTables = tableUnavailable ? workspaceTables.map((table) => table.id === 'free' ? { ...table, isActive: false } : table) : workspaceTables
    const responses = {
      ...checkoutDetails,
      '/api/auth/session': authenticatedSession,
      '/api/bootstrap': { tables: bootstrapTables, tableTabs: [], orders: [], clients: [], products: [lifecycleProduct], movements: [], financeSettings: null, effectiveBusinessConfig: effectiveCheckoutConfig },
      '/api/printing/stations': { stations: [{ id: 'test-station', platform: 'other', isPrimary: false, autoPrintEnabled: false }] },
      '/api/printing/jobs?limit=100': { jobs: [] },
      '/api/printing/jobs/summary': { summary: {} },
    }
    assert.ok(Object.hasOwn(responses, path), `Unexpected request: ${path}`)
    return { ok: true, json: async () => responses[path] }
  }
  t.after(() => { globalThis.fetch = originalFetch })
  const { default: App } = await harness.load('/src/App.jsx')
  const { renderer } = await harness.renderAdminApp(App)
  const navigation = () => renderer.root.findByProps({ 'aria-label': 'Menu principal' })
  await act(async () => buttonNamed(navigation(), 'Comandas').props.onClick())
  await act(async () => renderer.root.findByProps({ 'aria-label': 'Mesas ativas' }).findAllByType('button')[1].props.onClick())
  await prepareLocalOrderForCheckout(renderer)
  tableUnavailable = true
  await act(async () => harness.window.dispatchEvent(new Event('focus')))
  await act(async () => buttonNamed(renderer.root, 'Salvar pedido').props.onClick())
  assert.match(nodeText(renderer.root), /A mesa não está disponível/)
  assert.match(nodeText(renderer.root), /Coxinha/)

  tableUnavailable = false
  await act(async () => buttonNamed(renderer.root, 'Salvar pedido').props.onClick())
  assert.equal(orderRequests.length, 2)
  assert.equal(orderRequests[0].headers['idempotency-key'], orderRequests[1].headers['idempotency-key'])
  assert.match(nodeText(renderer.root.findByProps({ 'aria-label': 'Mesas ativas' })), /Varanda.*Comanda 100/)
})

test('a deferred old checkout cannot mutate or leave an ownerless wizard after reset and relogin', async (t) => {
  const harness = await workspaceHarness(t)
  const { NewOrderRoute } = await harness.load('/src/domains/orders/ui/NewOrderRoute.jsx')
  const { Comandas } = await harness.load('/src/domains/table-service/index.js')
  const { default: Receivables } = await harness.load('/src/domains/finance/ui/Receivables.jsx')
  let sessionExpired = false
  let relogged = false
  const orderResolvers = []
  const orderStarted = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (path, options = {}) => {
    if (String(path).startsWith('/api/bootstrap?')) path = '/api/bootstrap'
    if (path === '/api/bootstrap' && sessionExpired) {
      return { ok: false, status: 401, json: async () => ({ error: { message: 'Sessão expirada.' } }) }
    }
    if (path === '/api/orders' && options.method === 'POST') {
      return new Promise((resolve) => {
        orderResolvers.push(resolve)
        orderStarted.shift()?.()
      })
    }
    if (path === '/api/auth/login') { relogged = true; return { ok: true, json: async () => ({}) } }
    const responses = {
      ...checkoutDetails,
      '/api/auth/session': authenticatedSession,
      '/api/bootstrap': { tables: workspaceTables, tableTabs: [], orders: [], clients: [], products: [lifecycleProduct], movements: [], financeSettings: null, effectiveBusinessConfig: effectiveCheckoutConfig },
      '/api/printing/stations': { stations: [{ id: 'test-station', platform: 'other', isPrimary: false, autoPrintEnabled: false }] },
      '/api/printing/jobs?limit=100': { jobs: [] },
      '/api/printing/jobs/summary': { summary: {} },
    }
    assert.ok(Object.hasOwn(responses, path), `Unexpected request: ${path}`)
    return { ok: true, json: async () => responses[path] }
  }
  t.after(() => { globalThis.fetch = originalFetch })
  const { default: App } = await harness.load('/src/App.jsx')
  const { renderer } = await harness.renderAdminApp(App)
  const navigation = () => renderer.root.findByProps({ 'aria-label': 'Menu principal' })
  await act(async () => buttonNamed(navigation(), 'Comandas').props.onClick())
  await act(async () => renderer.root.findByProps({ 'aria-label': 'Mesas ativas' }).findAllByType('button')[1].props.onClick())
  await prepareLocalOrderForCheckout(renderer)
  const firstOrderStarted = new Promise((resolve) => orderStarted.push(resolve))
  await act(async () => {
    void buttonNamed(renderer.root, 'Salvar pedido').props.onClick()
    await firstOrderStarted
  })

  sessionExpired = true
  await act(async () => harness.window.dispatchEvent(new Event('focus')))
  assert.equal(renderer.root.findAllByType('form').length, 1)
  sessionExpired = false
  const loginInput = renderer.root.findByProps({ placeholder: 'Digite o PIN' })
  await act(async () => loginInput.props.onChange({ target: { value: '1234' } }))
  await act(async () => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }))
  assert.equal(renderer.root.findAllByProps({ 'aria-label': 'Tipo do pedido' }).length, 0, 'relogin exits the ownerless wizard')
  assert.ok(renderer.root.findAllByProps({ placeholder: 'Buscar cliente, pedido, produto ou tipo' }).length, 'relogin returns to the authenticated kitchen landing')
  await act(async () => buttonNamed(navigation(), 'Comandas').props.onClick())
  await act(async () => renderer.root.findByProps({ 'aria-label': 'Mesas ativas' }).findAllByType('button')[1].props.onClick())
  await prepareLocalOrderForCheckout(renderer)
  const secondOrderStarted = new Promise((resolve) => orderStarted.push(resolve))
  await act(async () => {
    void buttonNamed(renderer.root, 'Salvar pedido').props.onClick()
    await secondOrderStarted
  })

  const replacementRoute = renderer.root.findByType(NewOrderRoute)
  assert.deepEqual(ids(replacementRoute.props.tables), ids(workspaceTables), 'replacement route still receives only the relogged bootstrap tables')
  assert.equal(Object.hasOwn(replacementRoute.props, 'tableTabs'), false, 'replacement route exposes no old-session tableTabs prop')
  assert.equal(replacementRoute.props.expectedTableTabId, '')
  assert.deepEqual(ids(replacementRoute.props.products), [lifecycleProduct.id])
  assert.doesNotMatch(JSON.stringify(replacementRoute.props), /stale-(order|movement|tab|table)|Mesa Stale Exclusiva/)

  await act(async () => {
    orderResolvers[0]({ ok: true, json: async () => ({ order: { id: 'stale-order-9999', client: 'Cliente Stale Exclusivo', type: 'Local', total: 7777, paymentStatus: 'Pendente', status: 'Em preparo' }, movement: { id: 'stale-movement-9999', description: 'Movimento Stale Exclusivo', type: 'entrada', value: 7777, category: 'Vendas', date: '2026-09-10' }, tableTab: { id: 'stale-tab-501', tableId: 'stale-table-501', number: 501 }, tables: [{ id: 'stale-table-501', name: 'Mesa Stale Exclusiva', isActive: true, occupancy: 'occupied', sortOrder: 1, openTableTab: { id: 'stale-tab-501', number: 501, itemCount: 1, totalCents: 7777 } }] }) })
    await Promise.resolve()
  })
  assert.equal(renderer.root.findAllByType(NewOrderRoute).length, 1, 'stale success cannot replace the newer wizard')
  assert.equal(buttonNamed(renderer.root, 'Salvar pedido').props.disabled, true, 'old finally cannot clear the newer checkout loading state')
  assert.equal(renderer.root.findAllByProps({ 'aria-label': 'Mesas ativas' }).length, 0)
  const stillOwnedRoute = renderer.root.findByType(NewOrderRoute)
  assert.deepEqual(ids(stillOwnedRoute.props.tables), ids(workspaceTables), 'stale tables never reach the replacement route')
  assert.equal(Object.hasOwn(stillOwnedRoute.props, 'tableTabs'), false, 'stale table tab never becomes a route prop')
  assert.equal(stillOwnedRoute.props.expectedTableTabId, '')
  assert.doesNotMatch(JSON.stringify(stillOwnedRoute.props), /stale-(order|movement|tab|table)|Mesa Stale Exclusiva/)
  assert.doesNotMatch(nodeText(renderer.root), /Mesa Stale Exclusiva|Cliente Stale Exclusivo|Movimento Stale Exclusivo|Pedido entrou em preparo/)
  await act(async () => {
    orderResolvers[1]({ ok: true, json: async () => ({ order: { id: 'new-order-200', client: 'Cliente Novo 200', type: 'Local', total: 2000, paymentStatus: 'Pendente', status: 'Em preparo' }, movement: { id: 'new-movement-200', description: 'Movimento Novo 200', type: 'entrada', value: 2000, category: 'Vendas', date: '2026-09-10' }, tableTab: { id: 'new-tab-200', tableId: 'free', number: 200, status: 'open' }, tables: workspaceTables.map((table) => table.id === 'free' ? { ...table, occupancy: 'occupied', openTableTab: { id: 'new-tab-200', number: 200, itemCount: 1, totalCents: 2000 } } : table) }) })
    await Promise.resolve()
  })
  assert.match(nodeText(renderer.root.findByProps({ 'aria-label': 'Detalhe da comanda' })), /Comanda 200.*20,00/)
  const comandas = renderer.root.findByType(Comandas)
  assert.deepEqual(comandas.props.selection, { tableId: 'free', tableTabId: 'new-tab-200' })
  assert.deepEqual(ids(comandas.props.tables), ids(workspaceTables), 'Comandas consumes only the newer returned tables')
  assert.doesNotMatch(JSON.stringify(comandas.props), /stale-(order|movement|tab|table)|Mesa Stale Exclusiva/)
  await act(async () => buttonNamed(navigation(), 'A receber').props.onClick())
  const receivables = renderer.root.findByType(Receivables)
  assert.deepEqual(ids(receivables.props.orders), ['new-order-200'], 'A receber receives the newer order, not the stale order')
  assert.deepEqual(ids(receivables.props.movements), ['new-movement-200'], 'A receber receives the newer movement, not the stale movement')
  await act(async () => buttonNamed(navigation(), 'Comandas').props.onClick())
  await act(async () => buttonNamed(renderer.root.findByProps({ 'aria-label': 'Detalhe da comanda' }), 'Adicionar pedido').props.onClick())
  const postCheckoutRoute = renderer.root.findByType(NewOrderRoute)
  assert.equal(Object.hasOwn(postCheckoutRoute.props, 'tableTabs'), false)
  assert.equal(postCheckoutRoute.props.expectedTableTabId, 'new-tab-200', 'occupied comanda identity is preserved by expectedTableTabId')
  assert.doesNotMatch(JSON.stringify(postCheckoutRoute.props), /stale-(order|movement|tab|table)|Mesa Stale Exclusiva/)
})

test('a deferred stale checkout rejection cannot clear or report over a newer relogged checkout', async (t) => {
  const harness = await workspaceHarness(t)
  const { NewOrderRoute } = await harness.load('/src/domains/orders/ui/NewOrderRoute.jsx')
  const { default: Receivables } = await harness.load('/src/domains/finance/ui/Receivables.jsx')
  let sessionExpired = false
  let relogged = false
  const orderResolvers = []
  const orderStarted = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (path, options = {}) => {
    if (String(path).startsWith('/api/bootstrap?')) path = '/api/bootstrap'
    if (path === '/api/bootstrap' && sessionExpired) {
      return { ok: false, status: 401, json: async () => ({ error: { message: 'Sessão expirada.' } }) }
    }
    if (path === '/api/orders' && options.method === 'POST') {
      return new Promise((resolve) => {
        orderResolvers.push(resolve)
        orderStarted.shift()?.()
      })
    }
    if (path === '/api/auth/login') { relogged = true; return { ok: true, json: async () => ({}) } }
    const responses = {
      ...checkoutDetails,
      '/api/auth/session': authenticatedSession,
      '/api/bootstrap': { tables: workspaceTables, tableTabs: [], orders: [], clients: [], products: [lifecycleProduct], movements: [], financeSettings: null, effectiveBusinessConfig: effectiveCheckoutConfig },
      '/api/printing/stations': { stations: [{ id: 'test-station', platform: 'other', isPrimary: false, autoPrintEnabled: false }] },
      '/api/printing/jobs?limit=100': { jobs: [] },
      '/api/printing/jobs/summary': { summary: {} },
    }
    assert.ok(Object.hasOwn(responses, path), `Unexpected request: ${path}`)
    return { ok: true, json: async () => responses[path] }
  }
  t.after(() => { globalThis.fetch = originalFetch })
  const { default: App } = await harness.load('/src/App.jsx')
  const { renderer } = await harness.renderAdminApp(App)
  const navigation = () => renderer.root.findByProps({ 'aria-label': 'Menu principal' })
  await act(async () => buttonNamed(navigation(), 'Comandas').props.onClick())
  await act(async () => renderer.root.findByProps({ 'aria-label': 'Mesas ativas' }).findAllByType('button')[1].props.onClick())
  await prepareLocalOrderForCheckout(renderer)
  const oldOrderStarted = new Promise((resolve) => orderStarted.push(resolve))
  await act(async () => {
    void buttonNamed(renderer.root, 'Salvar pedido').props.onClick()
    await oldOrderStarted
  })
  sessionExpired = true
  await act(async () => harness.window.dispatchEvent(new Event('focus')))
  sessionExpired = false
  const loginInput = renderer.root.findByProps({ placeholder: 'Digite o PIN' })
  await act(async () => loginInput.props.onChange({ target: { value: '1234' } }))
  await act(async () => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }))
  assert.equal(renderer.root.findAllByProps({ 'aria-label': 'Tipo do pedido' }).length, 0)
  await act(async () => buttonNamed(navigation(), 'Comandas').props.onClick())
  await act(async () => renderer.root.findByProps({ 'aria-label': 'Mesas ativas' }).findAllByType('button')[1].props.onClick())
  await prepareLocalOrderForCheckout(renderer)
  const newerOrderStarted = new Promise((resolve) => orderStarted.push(resolve))
  await act(async () => {
    void buttonNamed(renderer.root, 'Salvar pedido').props.onClick()
    await newerOrderStarted
  })
  const replacementRoute = renderer.root.findByType(NewOrderRoute)
  assert.deepEqual(ids(replacementRoute.props.tables), ids(workspaceTables))
  assert.equal(Object.hasOwn(replacementRoute.props, 'tableTabs'), false)
  assert.equal(replacementRoute.props.expectedTableTabId, '')

  await act(async () => {
    orderResolvers[0]({ ok: false, status: 500, json: async () => ({ error: { message: 'Falha antiga.' } }) })
    await Promise.resolve()
  })
  assert.equal(buttonNamed(renderer.root, 'Salvar pedido').props.disabled, true, 'stale finally cannot clear the newer checkout loading state')
  assert.equal(renderer.root.findAllByProps({ 'aria-label': 'Mesas ativas' }).length, 0)
  const stillOwnedRoute = renderer.root.findByType(NewOrderRoute)
  assert.deepEqual(ids(stillOwnedRoute.props.tables), ids(workspaceTables), 'stale rejection leaves bootstrap tables intact')
  assert.equal(Object.hasOwn(stillOwnedRoute.props, 'tableTabs'), false, 'stale rejection cannot reintroduce the dead route prop')
  assert.equal(stillOwnedRoute.props.expectedTableTabId, '')
  assert.doesNotMatch(nodeText(renderer.root), /Falha antiga|Mesa Stale Exclusiva|Pedido entrou em preparo/)
  await act(async () => {
    orderResolvers[1]({ ok: true, json: async () => ({ order: { id: 'new-order-201', client: 'Cliente Novo 201', type: 'Local', total: 2000, paymentStatus: 'Pendente', status: 'Em preparo' }, movement: { id: 'new-movement-201', description: 'Movimento Novo 201', type: 'entrada', value: 2000, category: 'Vendas', date: '2026-09-10' }, tableTab: { id: 'new-tab-201', tableId: 'free', number: 201, status: 'open' }, tables: workspaceTables.map((table) => table.id === 'free' ? { ...table, occupancy: 'occupied', openTableTab: { id: 'new-tab-201', number: 201, itemCount: 1, totalCents: 2000 } } : table) }) })
    await Promise.resolve()
  })
  assert.match(nodeText(renderer.root.findByProps({ 'aria-label': 'Detalhe da comanda' })), /Comanda 201.*20,00/)
  await act(async () => buttonNamed(navigation(), 'A receber').props.onClick())
  const receivables = renderer.root.findByType(Receivables)
  assert.deepEqual(ids(receivables.props.orders), ['new-order-201'])
  assert.deepEqual(ids(receivables.props.movements), ['new-movement-201'])
})
