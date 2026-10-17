import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { act } from 'react-test-renderer'
import { buttonNamed, nodeText, renderWithNavigation, workspaceHarness } from '../../../test-support/renderWorkspace.js'

const order = {
  id: 'o1',
  clientId: 'c1',
  client: 'Maria',
  customerIdentityType: 'registered_client',
  total: 42,
  paymentStatus: 'Pendente',
  status: 'Finalizado',
  type: 'Entrega',
  orderDate: '2026-09-18',
  createdAt: '2026-09-18T12:00:00.000Z',
  items: [{ id: 'i1', name: 'Marmita', quantity: 1, unitPrice: 42 }],
}

const queryState = {
  search: '',
  displayMode: 'orders',
  activeView: 'pending',
  timingFilter: 'all',
  sortMode: 'urgency',
  exactDateFilter: null,
  selectedEntryKey: 'order:o1',
}

test('Finance Receivables does not import Orders', async () => {
  const source = await readFile(new URL('../../../domains/finance/ui/Receivables.jsx', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /domains\/orders/)
})

test('ReceivablesSurface composes Finance with Orders detail without a Finance -> Orders import', async (t) => {
  const h = await workspaceHarness(t)
  const { default: ReceivablesSurface } = await h.load('/src/app/surfaces/finance/ReceivablesSurface.jsx')
  const screen = await renderWithNavigation(h, ReceivablesSurface, {
    activeTab: 'receivables',
    orders: [order],
    movements: [],
    currency: (value) => `R$ ${Number(value).toFixed(2)}`,
    disabled: false,
    queryState,
    onQueryChange() {},
    onRegisterPayment() {},
    canReceivePayments: true,
    canManagePaymentPromises: true,
    canExecutePrinting: false,
    applyOfficialEffects() {},
    setRequestKey() {},
    onSuccess() {},
    onError(error) { assert.fail(error?.message || 'unexpected error') },
  }, {
    granted: new Set(['finance.receivables.view']),
    implemented: new Set(['receivables']),
  })

  const viewOrder = buttonNamed(screen.root, 'Ver pedido')
  assert.ok(viewOrder)
  await act(async () => viewOrder.props.onClick())
  assert.match(nodeText(screen.root), /Resumo/)
  assert.ok(buttonNamed(screen.root, 'Reimprimir'))
})


test('receivables wiring exposes single-order, client-batch and customer navigation ports without Finance owning payment', async () => {
  const surface = await readFile(new URL('./ReceivablesSurface.jsx', import.meta.url), 'utf8')
  const page = await readFile(new URL('../../../domains/finance/ui/Receivables.jsx', import.meta.url), 'utf8')
  const app = await readFile(new URL('../../../App.jsx', import.meta.url), 'utf8')

  assert.match(surface, /onRegisterClientOrdersPayment/)
  assert.match(surface, /onOpenClient/)
  assert.match(surface, /onRegisterClientOrdersPayment=\{onRegisterClientOrdersPayment\}/)
  assert.match(surface, /onOpenClient=\{onOpenClient\}/)
  assert.match(app, /onRegisterClientOrdersPayment=\{openClientOrdersPayment\}/)
  assert.match(app, /prepareOrderAction\(target\.orderIds,\(\)=>clientOrdersPayment\.open\(target\)\)/)
  assert.match(app, /onOpenClient=\{canViewClients/)
  assert.match(page, /useReceivableClientSelection/)
  assert.match(page, /selectedOrderIds\.length === 1/)
  assert.match(page, /onRegisterClientOrdersPayment\?\./)
  assert.doesNotMatch(page, /registerClientOrdersPayment\(|paymentApi/)
})
