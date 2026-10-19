import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { act, create } from 'react-test-renderer'
import { createServer } from 'vite'
import { getBusinessDate } from '../../../../shared/finance.js'
import { workspaceHarness } from '../../../test-support/renderWorkspace.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const textContent = (node) => JSON.stringify(node)
const nodeText = (node) => node.children.map((child) => typeof child === 'string' ? child : nodeText(child)).join('')

const orderPresentation = {
  formatOrderDate: (value) => value || '',
  getOrderItemsSearchText: () => '',
  getOrderItemsSummary: () => 'Itens',
}
const orderRules = {
  isOrderCancelled: (order) => order?.status === 'Cancelado',
  isOrderPaid: (order) => order?.paymentStatus === 'Pago',
  getPendingAmount: (order) => order?.paymentStatus === 'Pago' ? 0 : Math.max(0, Number(order?.total) || 0),
}

const order = (id, client, overrides = {}) => ({
  id,
  client,
  clientId: 'client-1',
  customerIdentityType: 'registered_client',
  total: 20,
  orderDate: getBusinessDate(),
  createdAt: `${getBusinessDate()}T12:00:00.000Z`,
  paymentStatus: 'Pendente',
  status: 'Finalizado',
  items: [],
  ...overrides,
})

test('A Receber renders only ordinary pending and paid orders from a mixed dataset', async () => {
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
  const { default: Receivables } = await vite.ssrLoadModule('/src/domains/finance/ui/Receivables.jsx')
  const { NavigationProvider } = await vite.ssrLoadModule('/src/app/navigation/NavigationContext.jsx')
  const hadWindow = Object.hasOwn(globalThis, 'window')
  const originalWindow = globalThis.window
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } })
  globalThis.window = {
    setInterval: () => 1,
    clearInterval: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
  }
  const orders = [
    order('ordinary-pending', 'Cliente pendente'),
    order('table-pending', 'Mesa pendente', { clientId: null, customerIdentityType: 'table', tableTabId: 'tab-pending', total: 80 }),
    order('ordinary-paid', 'Cliente quitado', { paymentStatus: 'Pago', paidAt: '2026-09-10T12:00:00.000Z', total: 30 }),
    order('table-paid', 'Mesa quitada', { clientId: null, customerIdentityType: 'table', tableTabId: 'tab-paid', paymentStatus: 'Pago', paidAt: '2026-09-10T13:00:00.000Z', total: 90 }),
  ]
  const paymentRequests = []
  let renderer

  function ControlledReceivables(props) {
    const [queryState, setQueryState] = React.useState({
      search: '',
      displayMode: 'orders',
      activeView: 'pending',
      timingFilter: 'all',
      sortMode: 'urgency',
      exactDateFilter: null,
      selectedEntryKey: null,
    })
    const onQueryChange = (patch) => setQueryState((current) => ({ ...current, ...patch }))
    return React.createElement(Receivables, { ...props, queryState, onQueryChange, orderPresentation, orderRules })
  }

  try {
    await act(async () => {
      renderer = create(React.createElement(NavigationProvider, {
        activeTab: 'receivables', granted: new Set(['finance.receivables']), implemented: new Set(['receivables']), moreOpen: false,
        requestNavigation() {}, openMore() {}, closeMore() {},
        children: React.createElement(ControlledReceivables, {
        orders,
        currency: (value) => `R$ ${value.toFixed(2)}`,
        onRegisterPayment: (orderId) => paymentRequests.push(orderId),
        onUpdatePaymentPromise: async () => true,
        }),
      }))
    })

    let rendered = textContent(renderer.toJSON())
    assert.match(rendered, /Cliente pendente/)
    assert.doesNotMatch(rendered, /Mesa pendente/)
    const summary = renderer.root.findByProps({ className: 'receivables-summary-grid' })
    const todaySummary = summary.findAllByType('button').find((card) => nodeText(card).includes('Receber hoje'))
    assert.equal(nodeText(todaySummary), 'Receber hojeR$ 20.001 pedido(s)')

    const pendingRow = renderer.root.findAllByProps({ className: 'receivable-ledger-row' })[0]
    await act(async () => pendingRow.props.onClick())
    const detailPanel = renderer.root.findByProps({ className: 'receivables-detail-panel' })
    const detailPaymentButton = detailPanel.findAllByType('button').find((button) => nodeText(button) === 'Registrar recebimento')
    const promiseButton = detailPanel.findAllByType('button').find((button) => nodeText(button) === 'Definir data prometida')
    assert.ok(detailPaymentButton)
    assert.ok(promiseButton)
    await act(async () => detailPaymentButton.props.onClick())
    assert.deepEqual(paymentRequests, ['ordinary-pending'])

    const paidTab = renderer.root.findAll((node) => node.props.onClick && nodeText(node) === 'Quitados')[0]
    await act(async () => paidTab.props.onClick())
    rendered = textContent(renderer.toJSON())
    assert.match(rendered, /Cliente quitado/)
    assert.doesNotMatch(rendered, /Mesa quitada/)
  } finally {
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator)
    else delete globalThis.navigator
    if (hadWindow) globalThis.window = originalWindow
    else delete globalThis.window
    await vite.close()
  }
})

test('A Receber preserva a seleção mobile sem reabrir o detalhe ao retornar', async (t) => {
  const h = await workspaceHarness(t, { mobile: true })
  const { default: Receivables } = await h.load('/src/domains/finance/ui/Receivables.jsx')
  const { NavigationProvider } = await h.load('/src/app/navigation/NavigationContext.jsx')
  const api = React.createRef()

  const Workspace = React.forwardRef(function Workspace(_props, ref) {
    const [activePage, setActivePage] = React.useState('receivables')
    const [queryState, setQueryState] = React.useState({
      search: '',
      displayMode: 'orders',
      activeView: 'pending',
      timingFilter: 'all',
      sortMode: 'urgency',
      exactDateFilter: null,
      selectedEntryKey: null,
    })
    React.useImperativeHandle(ref, () => ({ activePage, queryState, setActivePage }), [activePage, queryState])
    if (activePage !== 'receivables') return React.createElement('div', null, 'Outra página')
    return React.createElement(NavigationProvider, {
      activeTab: activePage, granted: new Set(['finance.receivables']), implemented: new Set(['receivables']), moreOpen: false,
      requestNavigation() {}, openMore() {}, closeMore() {},
      children: React.createElement(Receivables, {
        orders: [order('mobile-pending', 'Cliente mobile')],
        currency: (value) => `R$ ${value.toFixed(2)}`,
        orderPresentation,
        orderRules,
        queryState,
        onQueryChange: (patch) => setQueryState((current) => ({ ...current, ...patch })),
      }),
    })
  })

  const renderer = await h.render(Workspace, { ref: api })

  const row = renderer.root.findByProps({ className: 'receivable-ledger-row' })
  await act(async () => row.props.onClick())
  assert.equal(api.current.queryState.selectedEntryKey, 'order:mobile-pending')
  assert.equal(renderer.root.findAllByProps({ role: 'dialog' }).length, 1)

  await act(async () => api.current.setActivePage('other'))
  await act(async () => api.current.setActivePage('receivables'))

  assert.equal(api.current.queryState.selectedEntryKey, 'order:mobile-pending')
  assert.equal(renderer.root.findByProps({ className: 'receivable-ledger-row' }).props['aria-pressed'], true)
  assert.equal(renderer.root.findAllByProps({ role: 'dialog' }).length, 0)

  await act(async () => renderer.root.findByProps({ className: 'receivable-ledger-row' }).props.onClick())
  assert.equal(renderer.root.findAllByProps({ role: 'dialog' }).length, 1)
})
