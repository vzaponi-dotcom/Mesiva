import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { act } from 'react-test-renderer'
import { buttonNamed, nodeText, renderWithNavigation, workspaceHarness } from '../../../test-support/renderWorkspace.js'

const NOW = new Date('2026-09-28T21:10:05.000Z')

const orders = Array.from({ length: 10 }, (_, index) => ({
  id: `order-${index + 1}`,
  orderNumber: 501 + index,
  status: 'Em preparo',
  client: index === 0 ? 'Ana Carolina' : `Cliente ${index + 1}`,
  type: 'Entrega',
  createdAt: index === 0
    ? '2026-09-28T20:00:00.000Z'
    : index === 1
      ? '2026-09-28T20:45:00.000Z'
      : '2026-09-28T21:05:00.000Z',
  items: [{ name: `Item secreto ${index + 1}` }],
  total: 9999,
  phone: '11999999999',
  address: 'Rua que não deve aparecer',
}))

const freshState = {
  paired: true,
  control: { revision: 4, requestedPage: 2, requestedModality: 'all', updatedAt: '2026-09-28T21:10:00.000Z' },
  telemetry: {
    appliedRevision: 4,
    currentPage: 2,
    pageCount: 3,
    viewportWidth: 1920,
    viewportHeight: 1080,
    visibleOrderIds: ['order-1', 'order-2', 'order-3', 'order-4'],
    reportedAt: '2026-09-28T21:10:00.000Z',
  },
  hiddenOrderIds: ['order-10'],
}

async function render(t, {
  granted = new Set(['orders.view', 'orders.kitchen.control']),
  isOnline = true,
  state = freshState,
  orderFixtures = orders,
  loadPrintDocument = async (orderId) => ({
    document: {
      type: 'order',
      order: { number: String(orderId).replace(/\D/g, '') || '501' },
      items: [
        { quantity: 2, name: 'X-Burger', presentation: 'Grande', note: 'Sem cebola' },
        { quantity: 1, name: 'Batata', presentation: '', note: '' },
      ],
    },
  }),
  apiOverrides = {},
  realtime,
} = {}) {
  const h = await workspaceHarness(t, { mobile: true })
  const calls = []
  const api = {
    getKitchenTvControl: async () => state,
    setKitchenTvPage: async (page) => {
      calls.push(['page', page])
      return {
        ...state,
        control: { ...state.control, revision: state.control.revision + 1, requestedPage: page },
      }
    },
    setKitchenTvModality: async (modality) => {
      calls.push(['modality', modality])
      return {
        ...state,
        control: { ...state.control, revision: state.control.revision + 1, requestedPage: 1, requestedModality: modality },
      }
    },
    ...apiOverrides,
  }
  const { default: KitchenTvControlSurface } = await h.load('/src/app/surfaces/kitchen-tv-control/KitchenTvControlSurface.jsx')
  const screen = await renderWithNavigation(h, KitchenTvControlSurface, {
    activeTab: 'kitchen-tv-control',
    implemented: new Set(['orders', 'history', 'kitchen-tv-control']),
    orders: orderFixtures,
    now: NOW,
    granted,
    isOnline,
    api,
    realtime,
    loadPrintDocument,
    onNavigate: (id) => calls.push(['navigate', id]),
    onFeedback: (message) => calls.push(['feedback', message]),
  })
  await act(async () => {})
  return { h, screen, calls }
}

test('mirrors only the orders reported on the current TV page and keeps customer as the primary card label', async (t) => {
  const { screen } = await render(t)
  const cards = screen.root.findAll((node) => String(node.props.className || '').split(/\s+/).includes('kitchen-tv-control-order-card'))
  assert.equal(cards.length, 4)

  const first = cards[0]
  assert.match(nodeText(first), /Ana Carolina/)
  assert.match(nodeText(first), /Pedido #501/)
  assert.doesNotMatch(nodeText(screen.root), /Cliente 5|Cliente 6|Cliente 7|Cliente 8|Cliente 9|Cliente 10/)

  const text = nodeText(screen.root)
  assert.match(text, /Controle da TV/)
  assert.match(text, /Tela 2 de 3/)
  assert.match(text, /4 na tela/)
  assert.match(text, /Na TV/)
  assert.match(text, /Toque no pedido para abrir ações/)
  assert.doesNotMatch(text, /Item secreto|R\$|9999|11999999999|Rua que não deve aparecer/)
  assert.ok(screen.root.findAllByType('svg').length > 0)

  const css = await readFile(new URL('./kitchenTvControl.css', import.meta.url), 'utf8')
  assert.match(css, /\.kitchen-tv-control-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/)
  assert.match(css, /\.kitchen-tv-control-order-client[\s\S]*color:\s*var\(--info\)/)
  assert.match(css, /\.kitchen-tv-control-order-card\.status-preparing[\s\S]*var\(--info\)/)
  assert.match(css, /\.kitchen-tv-control-order-card\.status-late[\s\S]*var\(--danger\)/)
  assert.match(css, /\.kitchen-tv-control-order-card\.status-near-limit[\s\S]*var\(--warning\)/)
  assert.match(css, /\.kitchen-tv-control-order-card\.status-scheduled[\s\S]*var\(--info\)/)
  assert.match(css, /@media \(max-width: 420px\)[\s\S]*\.kitchen-tv-control-paging \{[\s\S]*grid-template-columns:\s*minmax\(88px,\s*1fr\)[\s\S]*repeat\(3,\s*minmax\(58px,\s*auto\)\)/)
  assert.match(css, /@media \(max-width: 420px\)[\s\S]*\.kitchen-tv-control-page-button \{[\s\S]*min-height:\s*48px/)
  assert.match(css, /@media \(max-width: 420px\)[\s\S]*\.kitchen-tv-control-page-button\.is-home \{[\s\S]*background:\s*var\(--primary-fill\)/)
  assert.match(css, /@media \(max-width: 420px\)[\s\S]*\.kitchen-tv-control-summary article \{[\s\S]*min-height:\s*60px/)
  assert.match(css, /@media \(max-width: 420px\)[\s\S]*\.kitchen-tv-control-list-meta button \{[\s\S]*min-height:\s*36px/)
  assert.match(css, /@media \(max-width: 420px\)[\s\S]*\.kitchen-tv-control-order-card \{[\s\S]*min-height:\s*84px/)
  assert.match(css, /@media \(max-width: 420px\)[\s\S]*\.kitchen-tv-control-order-client \{[\s\S]*font-size:\s*\.92rem/)
  assert.match(css, /@media \(max-width: 420px\)[\s\S]*\.kitchen-tv-control-modality-filters \{[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/)
  assert.match(css, /@media \(max-width: 420px\)[\s\S]*\.kitchen-tv-control-modality-filter > span \{[\s\S]*text-overflow:\s*clip/)
  assert.match(css, /@media \(max-width: 420px\)[\s\S]*\.kitchen-tv-control-modality-filter \{[\s\S]*min-height:\s*54px/)
  assert.match(nodeText(screen.root.findByProps({ 'aria-label': 'Navegação da TV' })), /Tela 2 de 3/)
  assert.match(text, /Fora da tela/)
})

test('renders approved modality filters with badges and sends Mesa as a TV-wide filter command', async (t) => {
  const typedOrders = [
    { ...orders[0], id: 'delivery-1', orderNumber: 601, type: 'Entrega' },
    { ...orders[1], id: 'delivery-2', orderNumber: 602, type: 'Entrega' },
    { ...orders[2], id: 'pickup-1', orderNumber: 603, type: 'Retirada' },
    { ...orders[3], id: 'table-1', orderNumber: 604, type: 'Local', client: 'Mesa 4' },
    { ...orders[4], id: 'table-2', orderNumber: 605, type: 'Local', client: 'Mesa 8' },
  ]
  const state = {
    ...freshState,
    control: { ...freshState.control, requestedModality: 'all' },
    telemetry: {
      ...freshState.telemetry,
      currentPage: 1,
      pageCount: 1,
      visibleOrderIds: typedOrders.map(({ id }) => id),
    },
    hiddenOrderIds: [],
  }
  const { screen, calls } = await render(t, { state, orderFixtures: typedOrders })
  const filters = screen.root.findByProps({ 'aria-label': 'Filtrar pedidos por modalidade' })
  assert.ok(buttonNamed(filters, 'Todos 5'))
  assert.ok(buttonNamed(filters, 'Entrega 2'))
  assert.ok(buttonNamed(filters, 'Retira 1'))
  assert.ok(buttonNamed(filters, 'Mesa 2'))
  assert.equal(buttonNamed(filters, 'Todos 5').props['aria-pressed'], true)

  await act(async () => buttonNamed(filters, 'Mesa 2').props.onClick())
  assert.deepEqual(calls[0], ['modality', 'table'])
  assert.equal(buttonNamed(filters, 'Mesa 2').props['aria-pressed'], true)
  assert.match(nodeText(screen.root), /Atualizando TV/)
})

test('modality filters are read-only without kitchen-control capability', async (t) => {
  const { screen, calls } = await render(t, { granted: new Set(['orders.view']) })
  const filters = screen.root.findByProps({ 'aria-label': 'Filtrar pedidos por modalidade' })
  for (const label of ['Todos 9', 'Entrega 9', 'Retira 0', 'Mesa 0']) {
    assert.equal(buttonNamed(filters, label).props.disabled, true)
  }
  await act(async () => buttonNamed(filters, 'Entrega 9').props.onClick?.())
  assert.deepEqual(calls, [])
})

test('viewer keeps the surface readable but cannot send page commands', async (t) => {
  const { screen, calls } = await render(t, { granted: new Set(['orders.view']) })
  assert.match(nodeText(screen.root), /Somente leitura/)
  for (const label of ['Anterior', 'Início', 'Próxima']) {
    assert.equal(buttonNamed(screen.root, label).props.disabled, true)
  }
  await act(async () => buttonNamed(screen.root, 'Próxima').props.onClick?.())
  assert.deepEqual(calls, [])
})

test('changing TV page replaces the admin grid with the newly reported visible IDs', async (t) => {
  let current = {
    ...freshState,
    telemetry: { ...freshState.telemetry, currentPage: 1, visibleOrderIds: ['order-1', 'order-2'] },
  }
  const { h, screen } = await render(t, {
    state: current,
    apiOverrides: {
      getKitchenTvControl: async () => current,
      setKitchenTvPage: async (page) => {
        current = {
          ...current,
          control: { ...current.control, revision: current.control.revision + 1, requestedPage: page },
        }
        return current
      },
    },
  })

  let cards = screen.root.findAll((node) => String(node.props.className || '').split(/\s+/).includes('kitchen-tv-control-order-card'))
  assert.deepEqual(cards.map((card) => card.props['aria-label'].split(',')[0]), ['Pedido #501', 'Pedido #502'])

  await act(async () => buttonNamed(screen.root, 'Próxima').props.onClick())
  current = {
    ...current,
    telemetry: {
      ...current.telemetry,
      appliedRevision: current.control.revision,
      currentPage: 2,
      visibleOrderIds: ['order-3', 'order-4', 'order-5'],
      reportedAt: '2026-09-28T21:10:04.000Z',
    },
  }
  await act(async () => h.fireInterval(2000))
  await act(async () => {})

  cards = screen.root.findAll((node) => String(node.props.className || '').split(/\s+/).includes('kitchen-tv-control-order-card'))
  assert.deepEqual(cards.map((card) => card.props['aria-label'].split(',')[0]), ['Pedido #503', 'Pedido #504', 'Pedido #505'])
  assert.match(nodeText(screen.root), /Tela 2 de 3/)
  assert.match(nodeText(screen.root), /3 na tela/)
})

test('scheduled order reported by the TV appears in the mirrored page with scheduled styling', async (t) => {
  const scheduled = {
    id: 'scheduled-1',
    orderNumber: 700,
    status: 'Em preparo',
    client: 'Marina Souza',
    type: 'Entrega',
    createdAt: '2026-09-28T20:00:00.000Z',
    scheduledFor: '2026-09-28T23:30:00.000Z',
    items: [{ name: 'Agendado secreto' }],
  }
  const state = {
    ...freshState,
    telemetry: {
      ...freshState.telemetry,
      currentPage: 1,
      pageCount: 1,
      visibleOrderIds: ['scheduled-1'],
    },
    hiddenOrderIds: [],
  }
  const { screen } = await render(t, { state, orderFixtures: [...orders, scheduled] })
  const cards = screen.root.findAll((node) => String(node.props.className || '').split(/\s+/).includes('kitchen-tv-control-order-card'))
  assert.equal(cards.length, 1)
  assert.match(nodeText(cards[0]), /Marina Souza/)
  assert.match(nodeText(cards[0]), /AGENDADO/)
  assert.match(cards[0].props.className, /status-scheduled/)
  assert.equal(buttonNamed(screen.root, 'Retirar da TV'), undefined)
})

test('fresh telemetry enables bounded page controls for a controller', async (t) => {
  const { screen, calls } = await render(t)
  assert.equal(buttonNamed(screen.root, 'Anterior').props.disabled, false)
  assert.equal(buttonNamed(screen.root, 'Início').props.disabled, false)
  assert.equal(buttonNamed(screen.root, 'Próxima').props.disabled, false)
  await act(async () => buttonNamed(screen.root, 'Próxima').props.onClick())
  assert.deepEqual(calls[0], ['page', 3])
  assert.match(nodeText(screen.root), /Atualizando TV/)
})

test('stale telemetry never claims current visibility and disables operational controls', async (t) => {
  const stale = {
    ...freshState,
    telemetry: { ...freshState.telemetry, reportedAt: '2026-09-28T21:09:40.000Z' },
  }
  const { screen } = await render(t, { state: stale })
  const text = nodeText(screen.root)
  assert.match(text, /TV sem sinal/)
  const pager = screen.root.findByProps({ 'aria-label': 'Navegação da TV' })
  assert.match(nodeText(pager), /Tela — de —/)
  assert.doesNotMatch(nodeText(pager), /TV sem sinal/)
  assert.doesNotMatch(text, /Na TV/)
  assert.match(text, /Retirado/)
  for (const label of ['Anterior', 'Início', 'Próxima']) {
    assert.equal(buttonNamed(screen.root, label).props.disabled, true)
  }
})

test('exposes loading without replacing the official order collection', async (t) => {
  const pending = new Promise(() => {})
  const loading = await render(t, { apiOverrides: { getKitchenTvControl: () => pending } })
  assert.match(nodeText(loading.screen.root), /Carregando controle da TV/)
})

test('exposes control read failures', async (t) => {
  const failed = await render(t, {
    apiOverrides: { getKitchenTvControl: async () => { throw new Error('Falha simulada') } },
  })
  assert.match(nodeText(failed.screen.root), /Falha simulada/)
})

test('exposes offline state without queueing page or order commands', async (t) => {
  const mutations = []
  const offline = await render(t, {
    isOnline: false,
    apiOverrides: {
      setKitchenTvPage: async (page) => { mutations.push(['page', page]) },
      hideKitchenTvOrder: async (orderId) => { mutations.push(['hide', orderId]) },
    },
  })
  assert.match(nodeText(offline.screen.root), /Sem conexão/)
  const nextPage = buttonNamed(offline.screen.root, 'Próxima')
  assert.equal(nextPage.props.disabled, true)
  await act(async () => nextPage.props.onClick())
  const cards = offline.screen.root.findAll((node) => String(node.props.className || '').split(/\s+/).includes('kitchen-tv-control-order-card'))
  assert.equal(cards.length, 0)
  assert.match(nodeText(offline.screen.root), /Aguardando a TV informar os pedidos desta tela/)
  assert.deepEqual(mutations, [])
})


test('tapping Retirar da TV closes the action sheet and leaves restoration to Retirados', async (t) => {
  let state = structuredClone(freshState)
  const mutations = []
  const { screen, calls } = await render(t, {
    state,
    apiOverrides: {
      getKitchenTvControl: async () => state,
      hideKitchenTvOrder: async (orderId) => {
        mutations.push(['hide', orderId])
        state = { ...state, hiddenOrderIds: [...state.hiddenOrderIds, orderId] }
        return { orderId, hidden: true }
      },
    },
  })
  const card = screen.root.findAllByType('button').find((node) => String(node.props['aria-label'] || '').startsWith('Pedido #501,'))
  await act(async () => card.props.onClick())
  assert.deepEqual(mutations, [])

  const sheet = screen.root.findByProps({ role: 'dialog' })
  assert.match(nodeText(sheet), /Pedido #501/)
  assert.match(nodeText(sheet), /Ana/)
  assert.match(nodeText(sheet), /Remove apenas do painel da TV\. O pedido continua em preparo no sistema\./)
  assert.ok(buttonNamed(sheet, 'Retirar da TV'))
  assert.equal(buttonNamed(sheet, 'Ver na Cozinha'), undefined)

  await act(async () => buttonNamed(sheet, 'Retirar da TV').props.onClick())
  assert.deepEqual(mutations, [['hide', 'order-1']])
  assert.equal(screen.root.findAllByProps({ role: 'dialog' }).length, 0)
  assert.equal(buttonNamed(screen.root, 'Desfazer'), undefined)
  assert.ok(calls.some(([kind, message]) => kind === 'feedback' && message === 'Pedido retirado da TV.'))
  assert.ok(buttonNamed(screen.root, 'Retirados 2'))
})

test('hidden active orders stay restorable from a separate Retirados panel without inflating the mirrored page', async (t) => {
  let state = structuredClone(freshState)
  const mutations = []
  const { screen } = await render(t, {
    state,
    apiOverrides: {
      getKitchenTvControl: async () => state,
      restoreKitchenTvOrder: async (orderId) => {
        mutations.push(['restore', orderId])
        state = { ...state, hiddenOrderIds: state.hiddenOrderIds.filter((id) => id !== orderId) }
        return { orderId, hidden: false }
      },
    },
  })
  const pageCards = screen.root.findAll((node) => String(node.props.className || '').split(/\s+/).includes('kitchen-tv-control-order-card'))
  assert.equal(pageCards.length, 4)
  assert.ok(buttonNamed(screen.root, 'Retirados 1'))

  await act(async () => buttonNamed(screen.root, 'Retirados 1').props.onClick())
  const sheet = screen.root.findByProps({ role: 'dialog' })
  assert.match(nodeText(sheet), /Cliente 10/)
  await act(async () => buttonNamed(sheet, 'Voltar para a TV').props.onClick())
  assert.deepEqual(mutations, [['restore', 'order-10']])
})

test('hide failure rolls the optimistic card back to authoritative visibility and announces the error', async (t) => {
  let reads = 0
  const mutations = []
  const { screen } = await render(t, {
    apiOverrides: {
      getKitchenTvControl: async () => {
        reads += 1
        return freshState
      },
      hideKitchenTvOrder: async (orderId) => {
        mutations.push(['hide', orderId])
        throw new Error('Não foi possível retirar agora')
      },
    },
  })
  const card = screen.root.findAllByType('button').find((node) => String(node.props['aria-label'] || '').startsWith('Pedido #501,'))
  await act(async () => card.props.onClick())
  await act(async () => buttonNamed(screen.root, 'Retirar da TV').props.onClick())

  assert.deepEqual(mutations, [['hide', 'order-1']])
  assert.ok(reads >= 2)
  assert.match(nodeText(screen.root), /Não foi possível retirar agora/)
  const updated = screen.root.findAllByType('button').find((node) => String(node.props['aria-label'] || '').startsWith('Pedido #501,'))
  assert.match(updated.props['aria-label'], /Na TV/)
  assert.doesNotMatch(updated.props['aria-label'], /Retirado/)
})

test('read-only access keeps order actions visible but disabled', async (t) => {
  const viewer = await render(t, { granted: new Set(['orders.view']) })
  const viewerCard = viewer.screen.root.findAllByType('button').find((node) => String(node.props['aria-label'] || '').startsWith('Pedido #501,'))
  await act(async () => viewerCard.props.onClick())
  assert.equal(buttonNamed(viewer.screen.root, 'Retirar da TV').props.disabled, true)
})

test('stale TV state keeps order actions disabled and never queues a hidden mutation', async (t) => {
  const stale = {
    ...freshState,
    telemetry: { ...freshState.telemetry, reportedAt: '2026-09-28T21:09:40.000Z' },
  }
  const mutations = []
  const staleScreen = await render(t, {
    state: stale,
    apiOverrides: {
      hideKitchenTvOrder: async (orderId) => { mutations.push(['hide', orderId]) },
    },
  })
  const staleCard = staleScreen.screen.root.findAllByType('button').find((node) => String(node.props['aria-label'] || '').startsWith('Pedido #501,'))
  await act(async () => staleCard.props.onClick())
  const action = buttonNamed(staleScreen.screen.root, 'Retirar da TV')
  assert.equal(action.props.disabled, true)
  await act(async () => action.props.onClick())
  assert.deepEqual(mutations, [])
})

test('order action sheet shows print-document item snapshot and removes Ver na Cozinha', async (t) => {
  const { screen } = await render(t)
  const card = screen.root.findAllByType('button').find((node) => String(node.props['aria-label'] || '').startsWith('Pedido #501,'))
  await act(async () => card.props.onClick())
  await act(async () => {})

  const sheet = screen.root.findByProps({ role: 'dialog' })
  const text = nodeText(sheet)
  assert.match(text, /Itens do pedido/)
  assert.match(text, /Snapshot da impressão/)
  assert.match(text, /2x X-Burger Grande/)
  assert.match(text, /Obs: Sem cebola/)
  assert.match(text, /1x Batata/)
  assert.equal(buttonNamed(sheet, 'Ver na Cozinha'), undefined)
})

test('print snapshot failure keeps the order actions usable and exposes a compact retry-safe error', async (t) => {
  const { screen } = await render(t, {
    loadPrintDocument: async () => { throw new Error('Falha simulada no snapshot') },
  })
  const card = screen.root.findAllByType('button').find((node) => String(node.props['aria-label'] || '').startsWith('Pedido #501,'))
  await act(async () => card.props.onClick())
  await act(async () => {})

  const sheet = screen.root.findByProps({ role: 'dialog' })
  assert.match(nodeText(sheet), /Não foi possível carregar os itens do pedido/)
  assert.ok(buttonNamed(sheet, 'Retirar da TV'))
})

test('mobile TV control stays inside the normal app layout', async () => {
  const css = await readFile(new URL('./kitchenTvControl.css', import.meta.url), 'utf8')
  const mobile = css.slice(css.indexOf('@media (max-width: 820px)'), css.indexOf('@media (max-width: 420px)'))
  assert.match(mobile, /\.kitchen-tv-control-page\s*\{[^}]*width:\s*100%[^}]*max-width:\s*none/s)
  assert.doesNotMatch(mobile, /position:\s*fixed|inset:\s*0|height:\s*100dvh|layer-mobile-nav|safe-area-inset/)
})

test('TV control reads the canonical print document without widening the Printing public entry', async () => {
  const apiSource = await readFile(new URL('./kitchenTvControlApi.js', import.meta.url), 'utf8')
  const printingIndex = await readFile(new URL('../../../domains/printing/index.js', import.meta.url), 'utf8')
  assert.match(apiSource, /\/api\/orders\/.*\/print-document/)
  assert.doesNotMatch(printingIndex, /getOrderPrintDocument/)
})

test('TV control uses shared structured edit changes in an initially expanded mobile sheet', async (t) => {
  const edited = {
    ...orders[0],
    operationalRevision: 3,
    editSummary: { items: [
      { kind: 'removed', before: { name: 'Prato feito comercial', quantity: 2, note: 'Sem sal' }, after: null },
      { kind: 'modified', before: { name: 'Marmita', quantity: 1, note: 'Sem cebola' }, after: { name: 'Marmita', quantity: 3, note: 'Com salada' } },
      { kind: 'added', before: null, after: { name: 'Suco', quantity: 1, note: '' } },
    ] },
  }
  const { screen } = await render(t, { orderFixtures: [edited, ...orders.slice(1)] })
  const card = screen.root.findAllByType('button').find((node) => String(node.props['aria-label'] || '').startsWith('Pedido #501,'))
  await act(async () => card.props.onClick())
  const sheet = screen.root.findByProps({ role: 'dialog' })
  const panel = sheet.findAll((node) => node.type === 'details' && String(node.props.className || '').split(/\s+/).includes('kitchen-tv-control-edit-review'))
  assert.equal(panel.length, 1)
  assert.equal(panel[0].type, 'details')
  assert.equal(panel[0].props.open, true)
  const rows = panel[0].findAll((node) => String(node.props.className || '').split(/\s+/).includes('order-edit-change-row'))
  assert.equal(rows.length, 3)
  assert.deepEqual(rows.map(row => row.props['data-kind']), ['removed', 'updated', 'added'])
  const content = nodeText(panel[0])
  for (const value of ['Últimas alterações', '3 alterações', 'Prato feito comercial', 'Marmita', 'Suco', 'Removido', 'Alterado', 'Adicionado', 'Quantidade', 'Observação alterada', 'Antes', 'Depois', 'Sem cebola', 'Com salada']) {
    assert.ok(content.includes(value), value)
  }
  assert.equal(panel[0].findAll(node => node.type === 'ul').length, 0)
  assert.ok(buttonNamed(sheet, 'Retirar da TV'))
  assert.match(nodeText(sheet), /Snapshot da impressão/)
})

test('TV control does not show an empty edit-history panel when only a revision is known', async (t) => {
  const edited = { ...orders[0], operationalRevision: 1, editSummary: { items: [] } }
  const { screen } = await render(t, { orderFixtures: [edited, ...orders.slice(1)] })
  const card = screen.root.findAllByType('button').find((node) => String(node.props['aria-label'] || '').startsWith('Pedido #501,'))
  await act(async () => card.props.onClick())
  const sheet = screen.root.findByProps({ role: 'dialog' })
  assert.equal(sheet.findAll((node) => node.type === 'details' && String(node.props.className || '').split(/\s+/).includes('kitchen-tv-control-edit-review')).length, 0)
  assert.ok(buttonNamed(sheet, 'Retirar da TV'))
})

test('control refreshes another device change by hint without the two-second poll',async t=>{
  const listeners=new Set(),realtime={state:'live',subscribeInvalidations(fn){listeners.add(fn);return()=>listeners.delete(fn)}}
  let reads=0,next=freshState
  const {h,screen}=await render(t,{realtime,apiOverrides:{getKitchenTvControl:async()=>{reads++;return next}}})
  const initial=reads
  await act(async()=>h.fireInterval(2000));assert.equal(reads,initial)
  next={...freshState,telemetry:{...freshState.telemetry,visibleOrderIds:['order-5']}}
  await act(async()=>Promise.all([...listeners].map(fn=>fn({topics:['kitchen-tv'],orderIds:[],requiresFullRefresh:false}))))
  const cards=screen.root.findAll(node=>String(node.props.className || '').split(' ').includes('kitchen-tv-control-order-card'))
  assert.equal(cards.length,1);assert.match(nodeText(cards[0]),/Cliente 5/)
  assert.equal(reads,initial+1)
})
