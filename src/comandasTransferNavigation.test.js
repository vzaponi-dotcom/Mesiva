import assert from 'node:assert/strict'
import test from 'node:test'
import { act } from 'react-test-renderer'
import { buttonNamed, nodeText, workspaceHarness as createWorkspaceHarness } from './test-support/renderWorkspace.js'
import { comandaDetail, deferred } from './test-support/comandaFixtures.js'
import { authenticatedSession, effectivePaymentConfig, markSystemNotificationsRead } from './test-support/appSessionFixtures.js'

const workspaceHarness = async (...args) => {
  const harness = await createWorkspaceHarness(...args)
  markSystemNotificationsRead(harness)
  return harness
}

const tabA = { id: 'tab-A', number: 41, itemCount: 3, totalCents: 12345 }
const tabB = { id: 'tab-B', number: 42, itemCount: 1, totalCents: 2500 }
const sourceWithA = () => ({ id: 'table-1', name: 'Mesa 1', isActive: true, occupancy: 'occupied', sortOrder: 1, openTableTab: { ...tabA } })
const sourceWithB = () => ({ id: 'table-1', name: 'Mesa 1', isActive: true, occupancy: 'occupied', sortOrder: 1, openTableTab: { ...tabB } })
const sourceFree = () => ({ id: 'table-1', name: 'Mesa 1', isActive: true, occupancy: 'free', sortOrder: 1, openTableTab: null })
const destinationFree = () => ({ id: 'table-5', name: 'Mesa 5', isActive: true, occupancy: 'free', sortOrder: 2, openTableTab: null })
const destinationWithA = () => ({ id: 'table-5', name: 'Mesa 5', isActive: true, occupancy: 'occupied', sortOrder: 2, openTableTab: { ...tabA } })
const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => structuredClone(data) })

function detailFor(table, tab) {
  return { ...comandaDetail, id: tab.id, number: tab.number, table: { id: table.id, name: table.name } }
}

async function appWorkspace(h, App, { capabilities, tables = [sourceWithA(), destinationFree()] } = {}) {
  const state = { tables, tableTabs: [], orders: [], movements: [], bootstrapCalls: 0, transferCalls: [], transferResponse: null, paymentRequest: null }
  globalThis.fetch = async (path, options = {}) => {
    if (String(path).startsWith('/api/bootstrap?')) path = '/api/bootstrap'
    if (path === '/api/auth/session') return response(authenticatedSession)
    if (path === '/api/bootstrap') {
      state.bootstrapCalls += 1
      return response({ tables: state.tables, tableTabs: state.tableTabs, orders: state.orders, movements: state.movements, clients: [], products: [], financeSettings: null, effectiveBusinessConfig: effectivePaymentConfig })
    }
    if (path === '/api/orders' && (!options.method || options.method === 'GET')) return response({ orders: state.orders })
    if (path === '/api/printing/stations') return response({ stations: [{ id: 'test-station', platform: 'other', isPrimary: false, autoPrintEnabled: false }] })
    if (path === '/api/printing/jobs?limit=100') return response({ jobs: [] })
    if (path.startsWith('/api/table-tabs/') && path.endsWith('/payment')) {
      state.paymentRequest ??= deferred()
      return state.paymentRequest.promise
    }
    if (path.startsWith('/api/table-tabs/')) {
      const tabId = decodeURIComponent(path.split('/').at(-1))
      const table = state.tables.find((item) => item.openTableTab?.id === tabId)
      return table
        ? response({ tableTab: detailFor(table, table.openTableTab) })
        : response({ error: { message: 'Comanda indisponivel.' } }, 404)
    }
    if (/^\/api\/tables\/[^/]+\/transfer$/.test(path) && options.method === 'POST') {
      state.transferCalls.push({ path, body: JSON.parse(options.body) })
      return state.transferResponse ? state.transferResponse() : response({ tables: state.tables, tableTab: { id: tabA.id, tableId: 'table-5', status: 'open' } })
    }
    throw new Error(`Unexpected request: ${path}`)
  }
  const { renderer } = await h.renderAdminApp(App, capabilities === undefined ? {} : { capabilities })
  const navigate = async (name) => act(async () => buttonNamed(renderer.root.findByProps({ 'aria-label': 'Menu principal' }), name).props.onClick())
  const selectA = async () => act(async () => renderer.root.findByProps({ 'aria-label': 'Mesas ativas' }).findAllByType('button').find((button) => nodeText(button).includes('Comanda 41')).props.onClick())
  const dispose = async () => act(async () => renderer.unmount())
  return { renderer, state, navigate, selectA, dispose }
}

async function openTransferConfirmation(renderer) {
  await act(async () => buttonNamed(renderer.root, 'Transferir comanda').props.onClick())
  const destination = renderer.root.findAllByProps({ role: 'radio' }).find((option) => nodeText(option).includes('Mesa 5'))
  await act(async () => destination.props.onClick())
  await act(async () => buttonNamed(renderer.root, 'Continuar').props.onClick())
}

test('A6 keeps comanda identity across transfer, navigation, payment, and order entry', async (t) => {
  const h = await workspaceHarness(t)
  const [{ default: App }, { Comandas, Tables }, { NewOrderRoute }] = await Promise.all([
    h.load('/src/App.jsx'),
    h.load('/src/domains/table-service/index.js'),
    h.load('/src/domains/orders/ui/NewOrderRoute.jsx'),
  ])

  await t.test('Mesas captures Ver comanda identity and no longer exposes transfer', async (st) => {
    globalThis.fetch = async (path) => {
      if (path === '/api/table-tabs/tab-A') return response({ tableTab: detailFor(sourceWithA(), tabA) })
      throw new Error(`Unexpected request: ${path}`)
    }
    const targets = []
    const renderer = await h.render(Tables, { tables: [sourceWithA(), destinationFree()], canOpenComanda: true, onOpenComanda: (target) => targets.push(target), onCreate() {}, onRename() {}, onSetActive() {}, onReorder() {} })
    st.after(() => act(async () => renderer.unmount()))
    assert.equal(buttonNamed(renderer.root, 'Transferir comanda'), undefined)
    await act(async () => buttonNamed(renderer.root, 'Ver comanda').props.onClick())
    assert.deepEqual(targets, [{ tableId: 'table-1', tableTabId: 'tab-A' }])
  })

  await t.test('selection follows only A, closes obsolete UI, protects new order, and does not retry 409', async (st) => {
    const { renderer, state, navigate, selectA, dispose } = await appWorkspace(h, App)
    st.after(dispose)
    await navigate('Comandas'); await selectA()
    const addFromSource = buttonNamed(renderer.root, 'Adicionar pedido').props.onClick
    state.tables = [sourceFree(), destinationWithA()]
    await act(async () => h.window.dispatchEvent(new Event('focus')))
    assert.deepEqual(renderer.root.findByType(Comandas).props.selection, { tableId: 'table-5', tableTabId: 'tab-A' })
    assert.match(nodeText(renderer.root.findByProps({ 'aria-label': 'Detalhe da comanda' })), /Comanda 41.*Mesa 5/)

    await act(async () => addFromSource())
    let route = renderer.root.findByType(NewOrderRoute)
    assert.equal(route.props.initialTableId, 'table-5')
    assert.equal(route.props.expectedTableTabId, 'tab-A')
    await act(async () => route.props.onCancel())

    state.tables = [sourceWithA(), destinationFree()]
    await act(async () => h.window.dispatchEvent(new Event('focus')))
    await openTransferConfirmation(renderer)
    state.tables = [sourceFree(), destinationFree()]
    await act(async () => h.window.dispatchEvent(new Event('focus')))
    assert.equal(renderer.root.findAllByProps({ role: 'dialog' }).length, 0)
    assert.match(nodeText(renderer.root.findByProps({ 'aria-label': 'Detalhe da comanda' })), /Selecione uma mesa ocupada/)

    state.tables = [sourceWithA(), destinationFree()]
    await act(async () => h.window.dispatchEvent(new Event('focus')))
    await selectA()
    const obsoleteAddOrder = buttonNamed(renderer.root, 'Adicionar pedido').props.onClick
    state.tables = [sourceWithB(), destinationFree()]
    await act(async () => h.window.dispatchEvent(new Event('focus')))
    assert.equal(renderer.root.findByType(Comandas).props.selection, null)
    assert.equal(renderer.root.findByProps({ 'aria-label': 'Mesas ativas' }).findAllByType('button').find((button) => nodeText(button).includes('Comanda 42')).props['aria-pressed'], false)
    await act(async () => obsoleteAddOrder())
    assert.equal(renderer.root.findAllByType(NewOrderRoute).length, 0)
    assert.match(nodeText(renderer.root), /comanda.*mudou|comanda.*indisponivel/i)

    state.tables = [sourceWithA(), destinationFree()]
    await act(async () => h.window.dispatchEvent(new Event('focus')))
    await selectA()
    state.transferResponse = () => response({ error: { code: 'TABLE_TAB_CHANGED', message: 'A comanda mudou.' } }, 409)
    await openTransferConfirmation(renderer)
    const readsBefore = state.bootstrapCalls
    const confirm = buttonNamed(renderer.root.findByProps({ role: 'dialog' }), 'Transferir comanda')
    await act(async () => confirm.props.onClick())
    assert.deepEqual(state.transferCalls, [{ path: '/api/tables/table-1/transfer', body: { destinationTableId: 'table-5', expectedTableTabId: 'tab-A' } }])
    assert.equal(state.bootstrapCalls, readsBefore + 1)
    assert.match(nodeText(renderer.root), /A comanda mudou/)
  })

  await t.test('an accepted payment keeps reconciling after A loses visual ownership', async (st) => {
    const { renderer, state, navigate, selectA, dispose } = await appWorkspace(h, App)
    st.after(dispose)
    await navigate('Comandas'); await selectA()
    await act(async () => buttonNamed(renderer.root, 'Registrar pagamento').props.onClick())
    await act(async () => { void renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }) })
    state.tables = [sourceWithB(), destinationFree()]
    await act(async () => h.window.dispatchEvent(new Event('focus')))
    const paid = {
      orders: [{ id: 'paid-order', client: 'Mesa 1', total: 123.45, paymentStatus: 'Pago', status: 'Finalizado', type: 'Local' }],
      movements: [{ id: 'paid-movement', description: 'Pagamento comanda', value: 123.45, type: 'entrada', date: '2026-09-11' }],
      tableTab: { id: 'tab-A', number: 41, tableId: 'table-1', tableIdentifier: 'Mesa 1', status: 'closed' },
      tables: [sourceFree(), destinationFree()],
    }
    await act(async () => state.paymentRequest.resolve(response(paid)))
    assert.ok(buttonNamed(renderer.root, 'Tentar sincronizar'), 'the accepted obligation must outlive the cleared selection')
    state.orders = paid.orders; state.movements = paid.movements; state.tableTabs = [paid.tableTab]
    await act(async () => buttonNamed(renderer.root, 'Tentar sincronizar').props.onClick())
    assert.equal(buttonNamed(renderer.root, 'Tentar sincronizar'), undefined)
    assert.match(nodeText(renderer.root.findByProps({ 'aria-label': 'Detalhe da comanda' })), /Selecione uma mesa ocupada/)
  })

  await t.test('comandas.transfer exposes the protected action without tables.manage', async (st) => {
    const { renderer, selectA, dispose } = await appWorkspace(h, App, { capabilities: new Set(['comandas.view', 'comandas.transfer']) })
    st.after(dispose)
    await selectA()
    assert.ok(buttonNamed(renderer.root, 'Transferir comanda'))
  })

  await t.test('a stale Ver comanda target neither selects B nor navigates as A', async (st) => {
    const { renderer, state, navigate, dispose } = await appWorkspace(h, App, { capabilities: new Set(['tables.view', 'comandas.view']) })
    st.after(dispose)
    await navigate('Mesas')
    const staleOpen = buttonNamed(renderer.root, 'Ver comanda').props.onClick
    state.tables = [sourceWithB(), destinationFree()]
    await act(async () => h.window.dispatchEvent(new Event('focus')))
    await act(async () => staleOpen())
    assert.equal(renderer.root.findAllByType(Tables).length, 1)
    assert.match(nodeText(renderer.root), /comanda.*atualizada|atendimento.*mudou/i)
    await navigate('Comandas')
    assert.equal(renderer.root.findByType(Comandas).props.selection, null)
  })
})
