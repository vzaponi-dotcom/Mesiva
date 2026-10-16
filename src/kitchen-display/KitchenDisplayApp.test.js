import test from 'node:test'
import assert from 'node:assert/strict'
import { act } from 'react-test-renderer'

import { buttonNamed, nodeText, workspaceHarness } from '../test-support/renderWorkspace.js'

const state = (ids = []) => ({
  serverNow: '2026-09-22T20:00:00.000Z',
  timing: { scheduledPrepLeadMinutes: 50, scheduledLateGraceMinutes: 15, immediateLateAfterMinutes: 30, immediateVeryLateAfterMinutes: 60 },
  orders: ids.map((id) => ({ id, status: 'Em preparo', createdAt: '2026-09-22T19:00:00.000Z' })),
})
const flushEffects = () => act(async () => {
  await Promise.resolve()
  await Promise.resolve()
})

test('paired TV waits for one start gesture so audio can unlock before kitchen use', async (t) => {
  const h = await workspaceHarness(t)
  const { KitchenDisplayApp } = await h.load('/src/kitchen-display/KitchenDisplayApp.jsx')
  const events = []
  const renderer = await h.render(KitchenDisplayApp, {
    bootstrap: async () => ({ kind: 'paired', state: state(['existing']) }),
    readState: async () => state(['existing']),
    audio: { unlock: async () => { events.push('audio'); return true }, playArrival: async () => true },
  })
  await flushEffects()

  assert.deepEqual(events, [])
  assert.ok(buttonNamed(renderer.root, 'Iniciar painel da cozinha'))
  assert.doesNotMatch(nodeText(renderer.root), /Painel da cozinha ativo/)

  await act(async () => buttonNamed(renderer.root, 'Iniciar painel da cozinha').props.onClick())
  assert.deepEqual(events, ['audio'])
  assert.match(nodeText(renderer.root), /Painel da cozinha ativo/)
})

test('live runtime polls only after the start gesture and only while visible', async (t) => {
  const h = await workspaceHarness(t)
  const { KitchenDisplayApp } = await h.load('/src/kitchen-display/KitchenDisplayApp.jsx')
  let reads = 0
  const renderer = await h.render(KitchenDisplayApp, {
    bootstrap: async () => ({ kind: 'paired', state: state([]) }),
    readState: async () => { reads += 1; return state([]) },
    audio: { unlock: async () => true, playArrival: async () => true },
  })
  await flushEffects()

  await act(async () => h.fireInterval(2000))
  assert.equal(reads, 0)

  await act(async () => buttonNamed(renderer.root, 'Iniciar painel da cozinha').props.onClick())
  await act(async () => h.fireInterval(2000))
  assert.equal(reads, 1)

  h.setVisibility('hidden')
  await act(async () => h.fireInterval(2000))
  assert.equal(reads, 1)
  await act(async () => h.window.dispatchEvent(new Event('focus')))
  await act(async () => h.window.dispatchEvent(new Event('online')))
  assert.equal(reads, 3)
  h.setVisibility('visible')
  await act(async () => h.document.dispatchEvent(new Event('visibilitychange')))
  assert.equal(reads, 4)
})

test('new arrivals alert once and highlight for exactly 2600ms; initial orders stay quiet', async (t) => {
  const h = await workspaceHarness(t)
  const { KitchenDisplayApp } = await h.load('/src/kitchen-display/KitchenDisplayApp.jsx')
  const plays = []
  const scheduled = []
  const renderer = await h.render(KitchenDisplayApp, {
    bootstrap: async () => ({ kind: 'paired', state: state(['existing']) }),
    readState: async () => state(['existing', 'new-order']),
    audio: { unlock: async () => true, playArrival: async (options) => { plays.push(options); return true } },
    schedule: (callback, delay) => { scheduled.push({ callback, delay }); return scheduled.length },
    cancelSchedule: () => {},
  })
  await flushEffects()
  assert.equal(plays.length, 0)

  await act(async () => buttonNamed(renderer.root, 'Iniciar painel da cozinha').props.onClick())
  await act(async () => h.fireInterval(2000))
  assert.deepEqual(plays, [{ profile: 'kitchen-strong', volume: 'max' }])
  assert.deepEqual(renderer.root.findByProps({ 'data-order-id': 'new-order' }).props['data-highlighted'], true)
  assert.equal(scheduled[0].delay, 2600)
  await act(async () => scheduled[0].callback())
  assert.equal(renderer.root.findByProps({ 'data-order-id': 'new-order' }).props['data-highlighted'], false)
})

test('failed audio unlock keeps the panel available and exposes the sound recovery action', async (t) => {
  const h = await workspaceHarness(t)
  const { KitchenDisplayApp } = await h.load('/src/kitchen-display/KitchenDisplayApp.jsx')
  const { KitchenDisplayHttpError } = await h.load('/src/kitchen-display/kitchenDisplayApi.js')
  const responses = [new Error('offline'), new KitchenDisplayHttpError(401, 'revoked')]
  const renderer = await h.render(KitchenDisplayApp, {
    bootstrap: async () => ({ kind: 'paired', state: state(['keep-me']) }),
    readState: async () => { throw responses.shift() },
    audio: { unlock: async () => false, playArrival: async () => false },
  })
  await flushEffects()
  await act(async () => buttonNamed(renderer.root, 'Iniciar painel da cozinha').props.onClick())

  assert.match(nodeText(renderer.root), /Painel da cozinha ativo/)
  assert.ok(buttonNamed(renderer.root, 'Ativar alertas sonoros'))

  await act(async () => h.fireInterval(2000))
  assert.match(nodeText(renderer.root), /Dados temporariamente desatualizados/)
  assert.ok(renderer.root.findByProps({ 'data-order-id': 'keep-me' }))
  await act(async () => h.fireInterval(2000))
  assert.match(nodeText(renderer.root), /Painel não autorizado/)
  assert.equal(renderer.root.findAllByProps({ 'data-order-id': 'keep-me' }).length, 0)
})

test('paired approval advances from code to the explicit start screen', async (t) => {
  const h = await workspaceHarness(t)
  const { KitchenDisplayApp } = await h.load('/src/kitchen-display/KitchenDisplayApp.jsx')
  const renderer = await h.render(KitchenDisplayApp, {
    bootstrap: async () => ({ kind: 'pairing', pairing: { paired: false, code: '482731', expiresAt: '2026-09-22T20:30:00.000Z' } }),
    pollPairing: async () => ({ kind: 'paired', state: state([]) }),
    readState: async () => state([]),
    audio: { unlock: async () => true, playArrival: async () => true },
  })
  await flushEffects()
  assert.match(nodeText(renderer.root), /Conectar esta TV/)
  assert.match(nodeText(renderer.root), /482 731/)

  await act(async () => h.fireInterval(2000))
  assert.ok(buttonNamed(renderer.root, 'Iniciar painel da cozinha'))
  assert.doesNotMatch(nodeText(renderer.root), /Painel da cozinha ativo/)

  await act(async () => buttonNamed(renderer.root, 'Iniciar painel da cozinha').props.onClick())
  assert.match(nodeText(renderer.root), /Painel da cozinha ativo/)
})

test('an audio unlock that never settles cannot trap the user after the explicit click', async (t) => {
  const h = await workspaceHarness(t)
  const { KitchenDisplayApp } = await h.load('/src/kitchen-display/KitchenDisplayApp.jsx')
  const never = new Promise(() => {})
  const renderer = await h.render(KitchenDisplayApp, {
    bootstrap: async () => ({ kind: 'paired', state: state(['existing']) }),
    readState: async () => state(['existing']),
    audio: { unlock: async () => never, playArrival: async () => true },
  })
  await flushEffects()

  await act(async () => buttonNamed(renderer.root, 'Iniciar painel da cozinha').props.onClick())
  assert.match(nodeText(renderer.root), /Painel da cozinha ativo/)
})


test('paired approval reaches the start screen before evaluating order timing compatibility', async (t) => {
  const h = await workspaceHarness(t)
  const { KitchenDisplayApp } = await h.load('/src/kitchen-display/KitchenDisplayApp.jsx')
  const incompatibleState = {
    serverNow: '2026-09-22T20:00:00.000Z',
    timing: null,
    orders: [{ id: 'legacy-tv-order', status: 'Em preparo', createdAt: '2026-09-22T19:00:00.000Z' }],
  }
  const renderer = await h.render(KitchenDisplayApp, {
    bootstrap: async () => ({ kind: 'pairing', pairing: { paired: false, code: '654321' } }),
    pollPairing: async () => ({ kind: 'paired', state: incompatibleState }),
    audio: { unlock: async () => true, playArrival: async () => true },
  })
  await flushEffects()

  await act(async () => h.fireInterval(2000))
  assert.ok(buttonNamed(renderer.root, 'Iniciar painel da cozinha'))
  assert.doesNotMatch(nodeText(renderer.root), /Não foi possível preparar os pedidos nesta TV/)

  await act(async () => buttonNamed(renderer.root, 'Iniciar painel da cozinha').props.onClick())
  assert.match(nodeText(renderer.root), /Não foi possível preparar os pedidos nesta TV/)
  assert.match(nodeText(renderer.root), /Política de tempo do pedido inválida/)
})


test('activation failures after approval show a diagnostic instead of another pairing code', async (t) => {
  const h = await workspaceHarness(t)
  const { KitchenDisplayApp } = await h.load('/src/kitchen-display/KitchenDisplayApp.jsx')
  const renderer = await h.render(KitchenDisplayApp, {
    bootstrap: async () => ({ kind: 'pairing', pairing: { paired: false, code: '482731' } }),
    pollPairing: async () => {
      const error = Object.assign(new Error('Este painel não está mais autorizado.'), {
        status: 401,
        activationFailure: true,
      })
      throw error
    },
    audio: { unlock: async () => true, playArrival: async () => true },
  })
  await flushEffects()

  await act(async () => h.fireInterval(2000))

  assert.match(nodeText(renderer.root), /Não foi possível preparar os pedidos nesta TV/)
  assert.match(nodeText(renderer.root), /KDS_SESSION_ACTIVATION_401/)
  assert.doesNotMatch(nodeText(renderer.root), /482 731/)
})


test('start gesture requests fullscreen without blocking audio or panel activation', async (t) => {
  const h = await workspaceHarness(t)
  const { KitchenDisplayApp } = await h.load('/src/kitchen-display/KitchenDisplayApp.jsx')
  const events = []
  const renderer = await h.render(KitchenDisplayApp, {
    bootstrap: async () => ({ kind: 'paired', state: state(['existing']) }),
    readState: async () => state(['existing']),
    requestFullscreen: async () => { events.push('fullscreen'); return true },
    audio: { unlock: async () => { events.push('audio'); return true }, playArrival: async () => true },
  })
  await flushEffects()

  await act(async () => buttonNamed(renderer.root, 'Iniciar painel da cozinha').props.onClick())

  assert.deepEqual(events, ['fullscreen', 'audio'])
  assert.match(nodeText(renderer.root), /Painel da cozinha ativo/)
})

test('failed fullscreen request keeps KDS live and offers a manual retry action', async (t) => {
  const h = await workspaceHarness(t)
  const { KitchenDisplayApp } = await h.load('/src/kitchen-display/KitchenDisplayApp.jsx')
  let attempts = 0
  const renderer = await h.render(KitchenDisplayApp, {
    bootstrap: async () => ({ kind: 'paired', state: state([]) }),
    requestFullscreen: async () => {
      attempts += 1
      return attempts > 1
    },
    audio: { unlock: async () => true, playArrival: async () => true },
  })
  await flushEffects()

  await act(async () => buttonNamed(renderer.root, 'Iniciar painel da cozinha').props.onClick())
  await flushEffects()

  assert.match(nodeText(renderer.root), /Painel da cozinha ativo/)
  const toolbar = renderer.root.findByProps({ className: 'kds-live-toolbar' })
  assert.ok(buttonNamed(toolbar, 'Entrar em tela cheia'))
  assert.match(renderer.root.findByType('main').props.className, /kds-shell--fullscreen-recovery/)

  await act(async () => buttonNamed(toolbar, 'Entrar em tela cheia').props.onClick())
  await flushEffects()
  assert.equal(attempts, 2)
  assert.equal(buttonNamed(renderer.root, 'Entrar em tela cheia'), undefined)
})


test('start screen lets this TV choose, preview and persist its local alert sound', async (t) => {
  const h = await workspaceHarness(t)
  const { KitchenDisplayApp } = await h.load('/src/kitchen-display/KitchenDisplayApp.jsx')
  const previews = []
  const renderer = await h.render(KitchenDisplayApp, {
    bootstrap: async () => ({ kind: 'paired', state: state([]) }),
    audio: {
      unlock: async () => true,
      playArrival: async () => true,
      preview: async (options) => { previews.push(options); return true },
    },
  })
  await flushEffects()

  const profileGroup = renderer.root.findByProps({ role: 'radiogroup', 'aria-label': 'Toque do alerta da TV' })
  assert.equal(buttonNamed(profileGroup, 'Cozinha forte').props['aria-checked'], true)
  const volumeGroup = renderer.root.findByProps({ role: 'group', 'aria-label': 'Volume do alerta da TV' })
  assert.equal(buttonNamed(volumeGroup, 'Máximo').props['aria-pressed'], true)

  await act(async () => buttonNamed(profileGroup, 'Campainha').props.onClick())
  await act(async () => buttonNamed(volumeGroup, 'Alto').props.onClick())
  assert.equal(h.localStorage.getItem('kitchen-sound-profile'), 'bell')
  assert.equal(h.localStorage.getItem('kitchen-sound-volume'), 'high')

  await act(async () => buttonNamed(renderer.root, 'Ouvir alerta').props.onClick())
  assert.deepEqual(previews, [{ profile: 'bell', volume: 'high' }])
})


test('live Kitchen TV recomputes tall-card demand when viewport height changes', async (t) => {
  const h = await workspaceHarness(t)
  h.window.innerHeight = 1080
  const { KitchenDisplayApp } = await h.load('/src/kitchen-display/KitchenDisplayApp.jsx')
  const adaptiveState = {
    serverNow: '2026-09-22T20:00:00.000Z',
    timing: state([]).timing,
    orders: [{
      id: 'adaptive-order',
      orderNumber: 3001,
      client: 'Pedido adaptativo',
      type: 'Entrega',
      status: 'Em preparo',
      createdAt: '2026-09-22T19:00:00.000Z',
      items: Array.from({ length: 7 }, (_, index) => ({ quantity: 1, name: `Produto Família Especial Completo ${index + 1}`, note: '' })),
    }],
  }
  const renderer = await h.render(KitchenDisplayApp, {
    bootstrap: async () => ({ kind: 'paired', state: adaptiveState }),
    readState: async () => adaptiveState,
    requestFullscreen: async () => true,
    audio: { unlock: async () => true, playArrival: async () => true },
  })
  await flushEffects()
  await act(async () => buttonNamed(renderer.root, 'Iniciar painel da cozinha').props.onClick())
  await flushEffects()

  let card = renderer.root.findByProps({ 'data-order-id': 'adaptive-order' })
  assert.equal(card.props['data-layout-demand'], 'normal')
  assert.equal(card.props['data-column-count'], 2)
  assert.doesNotMatch(card.props.className, /kds-card--tall/)

  h.window.innerHeight = 600
  await act(async () => h.window.dispatchEvent(new Event('resize')))

  card = renderer.root.findByProps({ 'data-order-id': 'adaptive-order' })
  assert.equal(card.props['data-layout-demand'], 'tall')
  assert.equal(card.props['data-column-count'], 1)
  assert.match(card.props.className, /kds-card--tall/)
})


const controlledState = (count, { revision = 0, requestedPage = 1, requestedModality = 'all', prefix = 'page' } = {}) => ({
  serverNow: '2026-09-22T20:00:00.000Z',
  timing: state([]).timing,
  control: { revision, requestedPage, requestedModality },
  orders: Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index + 1}`,
    orderNumber: 5000 + index,
    client: `Cliente ${index + 1}`,
    type: 'Entrega',
    status: 'Em preparo',
    createdAt: '2026-09-22T19:50:00.000Z',
    items: [{ quantity: 1, name: 'Marmita', note: '' }],
  })),
})

test('a newer modality revision filters the TV content without rendering filter buttons on the TV', async (t) => {
  const h = await workspaceHarness(t)
  h.window.innerWidth = 1280
  h.window.innerHeight = 720
  const { KitchenDisplayApp } = await h.load('/src/kitchen-display/KitchenDisplayApp.jsx')
  const base = controlledState(3, { revision: 1, requestedModality: 'all' })
  base.orders = [
    { ...base.orders[0], id: 'delivery-one', type: 'Entrega' },
    { ...base.orders[1], id: 'pickup-one', type: 'Retirada' },
    { ...base.orders[2], id: 'table-one', type: 'Local' },
  ]
  const tableOnly = {
    ...base,
    control: { revision: 2, requestedPage: 1, requestedModality: 'table' },
  }
  const reports = []
  const renderer = await h.render(KitchenDisplayApp, {
    bootstrap: async () => ({ kind: 'paired', state: base }),
    readState: async () => tableOnly,
    reportState: async (payload) => { reports.push(payload); return { reported: true } },
    requestFullscreen: async () => true,
    audio: { unlock: async () => true, playArrival: async () => true },
  })
  await flushEffects()
  await act(async () => buttonNamed(renderer.root, 'Iniciar painel da cozinha').props.onClick())
  await flushEffects()
  assert.ok(renderer.root.findByProps({ 'data-order-id': 'delivery-one' }))
  assert.ok(renderer.root.findByProps({ 'data-order-id': 'pickup-one' }))
  assert.ok(renderer.root.findByProps({ 'data-order-id': 'table-one' }))

  await act(async () => h.fireInterval(2000))
  await flushEffects()
  assert.equal(renderer.root.findAllByProps({ 'data-order-id': 'delivery-one' }).length, 0)
  assert.equal(renderer.root.findAllByProps({ 'data-order-id': 'pickup-one' }).length, 0)
  assert.ok(renderer.root.findByProps({ 'data-order-id': 'table-one' }))
  assert.deepEqual(reports.at(-1)?.visibleOrderIds, ['table-one'])
  assert.equal(buttonNamed(renderer.root, 'Todos'), undefined)
  assert.equal(buttonNamed(renderer.root, 'Mesa'), undefined)
})

test('remote paging starts on page one and does not replay the command already present at bootstrap', async (t) => {
  const h = await workspaceHarness(t)
  h.window.innerWidth = 960
  h.window.innerHeight = 540
  const { KitchenDisplayApp } = await h.load('/src/kitchen-display/KitchenDisplayApp.jsx')
  const initial = controlledState(30, { revision: 5, requestedPage: 2 })
  const renderer = await h.render(KitchenDisplayApp, {
    bootstrap: async () => ({ kind: 'paired', state: initial }),
    readState: async () => initial,
    requestFullscreen: async () => true,
    audio: { unlock: async () => true, playArrival: async () => true },
  })
  await flushEffects()
  await act(async () => buttonNamed(renderer.root, 'Iniciar painel da cozinha').props.onClick())
  await flushEffects()

  assert.ok(renderer.root.findByProps({ 'data-order-id': 'page-1' }))
  assert.equal(renderer.root.findAllByProps({ 'data-order-id': 'page-30' }).length, 0)
  assert.doesNotMatch(nodeText(renderer.root), /Anterior|Próxima/)
})

test('a newer control revision changes the TV page and an out-of-range request clamps to the last page', async (t) => {
  const h = await workspaceHarness(t)
  h.window.innerWidth = 960
  h.window.innerHeight = 540
  const { KitchenDisplayApp } = await h.load('/src/kitchen-display/KitchenDisplayApp.jsx')
  const initial = controlledState(30, { revision: 2, requestedPage: 1 })
  const responses = [
    controlledState(30, { revision: 3, requestedPage: 2 }),
    controlledState(30, { revision: 4, requestedPage: 99 }),
  ]
  const renderer = await h.render(KitchenDisplayApp, {
    bootstrap: async () => ({ kind: 'paired', state: initial }),
    readState: async () => responses.shift() || responses.at(-1) || initial,
    requestFullscreen: async () => true,
    audio: { unlock: async () => true, playArrival: async () => true },
  })
  await flushEffects()
  await act(async () => buttonNamed(renderer.root, 'Iniciar painel da cozinha').props.onClick())

  await act(async () => h.fireInterval(2000))
  assert.ok(renderer.root.findByProps({ 'data-order-id': 'page-30' }))
  assert.equal(renderer.root.findAllByProps({ 'data-order-id': 'page-1' }).length, 0)

  await act(async () => h.fireInterval(2000))
  assert.ok(renderer.root.findByProps({ 'data-order-id': 'page-30' }))
})

test('current page clamps automatically when the queue shrinks and the page disappears', async (t) => {
  const h = await workspaceHarness(t)
  h.window.innerWidth = 960
  h.window.innerHeight = 540
  const { KitchenDisplayApp } = await h.load('/src/kitchen-display/KitchenDisplayApp.jsx')
  const initial = controlledState(30, { revision: 1, requestedPage: 1 })
  const responses = [
    controlledState(30, { revision: 2, requestedPage: 2 }),
    controlledState(2, { revision: 2, requestedPage: 2 }),
  ]
  const renderer = await h.render(KitchenDisplayApp, {
    bootstrap: async () => ({ kind: 'paired', state: initial }),
    readState: async () => responses.shift() || controlledState(2, { revision: 2, requestedPage: 2 }),
    requestFullscreen: async () => true,
    audio: { unlock: async () => true, playArrival: async () => true },
  })
  await flushEffects()
  await act(async () => buttonNamed(renderer.root, 'Iniciar painel da cozinha').props.onClick())

  await act(async () => h.fireInterval(2000))
  assert.ok(renderer.root.findByProps({ 'data-order-id': 'page-30' }))

  await act(async () => h.fireInterval(2000))
  assert.ok(renderer.root.findByProps({ 'data-order-id': 'page-1' }))
  assert.ok(renderer.root.findByProps({ 'data-order-id': 'page-2' }))
  assert.equal(renderer.root.findAllByProps({ 'data-order-id': 'page-30' }).length, 0)
})


test('new arrival on a secondary page forces page one, alerts once and consumes the current revision', async (t) => {
  const h = await workspaceHarness(t)
  h.window.innerWidth = 960
  h.window.innerHeight = 540
  const { KitchenDisplayApp } = await h.load('/src/kitchen-display/KitchenDisplayApp.jsx')
  const reports = []
  const plays = []
  const initial = controlledState(30, { revision: 1, requestedPage: 1 })
  const pageTwo = controlledState(30, { revision: 2, requestedPage: 2 })
  const arrival = {
    ...controlledState(30, { revision: 2, requestedPage: 2 }),
    orders: [
      ...controlledState(30, { revision: 2, requestedPage: 2 }).orders,
      {
        id: 'new-arrival',
        orderNumber: 5999,
        client: 'Chegando',
        type: 'Entrega',
        status: 'Em preparo',
        createdAt: '2026-09-22T19:59:59.000Z',
        items: [{ quantity: 1, name: 'Marmita', note: '' }],
      },
    ],
  }
  const responses = [pageTwo, arrival, arrival]
  const renderer = await h.render(KitchenDisplayApp, {
    bootstrap: async () => ({ kind: 'paired', state: initial }),
    readState: async () => responses.shift() || arrival,
    reportState: async (payload) => { reports.push(payload); return { reported: true } },
    requestFullscreen: async () => true,
    audio: {
      unlock: async () => true,
      playArrival: async (options) => { plays.push(options); return true },
    },
  })
  await flushEffects()
  await act(async () => buttonNamed(renderer.root, 'Iniciar painel da cozinha').props.onClick())
  await flushEffects()

  await act(async () => h.fireInterval(2000))
  assert.ok(renderer.root.findByProps({ 'data-order-id': 'page-30' }))

  await act(async () => h.fireInterval(2000))
  assert.ok(renderer.root.findByProps({ 'data-order-id': 'page-1' }))
  assert.equal(renderer.root.findAllByProps({ 'data-order-id': 'page-30' }).length, 0)
  assert.equal(plays.length, 1)
  assert.equal(reports.at(-1)?.currentPage, 1)
  assert.equal(reports.at(-1)?.appliedRevision, 2)

  await act(async () => h.fireInterval(2000))
  assert.ok(renderer.root.findByProps({ 'data-order-id': 'page-1' }))
  assert.equal(renderer.root.findAllByProps({ 'data-order-id': 'page-30' }).length, 0)
  assert.equal(plays.length, 1)
})

test('telemetry is deduplicated across identical polls and changes when viewport rendering changes', async (t) => {
  const h = await workspaceHarness(t)
  h.window.innerWidth = 960
  h.window.innerHeight = 540
  const { KitchenDisplayApp } = await h.load('/src/kitchen-display/KitchenDisplayApp.jsx')
  const reports = []
  const current = controlledState(2, { revision: 3, requestedPage: 1 })
  const renderer = await h.render(KitchenDisplayApp, {
    bootstrap: async () => ({ kind: 'paired', state: current }),
    readState: async () => current,
    reportState: async (payload) => { reports.push(payload); return { reported: true } },
    requestFullscreen: async () => true,
    audio: { unlock: async () => true, playArrival: async () => true },
  })
  await flushEffects()
  await act(async () => buttonNamed(renderer.root, 'Iniciar painel da cozinha').props.onClick())
  await flushEffects()

  assert.equal(reports.length, 1)
  assert.deepEqual(reports[0].visibleOrderIds.sort(), ['page-1', 'page-2'])

  await act(async () => h.fireInterval(2000))
  await flushEffects()
  assert.equal(reports.length, 1)

  h.window.innerWidth = 1280
  h.window.innerHeight = 720
  await act(async () => h.window.dispatchEvent(new Event('resize')))
  await flushEffects()
  assert.equal(reports.length, 2)
  assert.equal(reports[1].viewportWidth, 1280)
  assert.equal(reports[1].viewportHeight, 720)
})

test('unchanged live render sends a slow telemetry heartbeat without waiting for resize or fullscreen changes', async (t) => {
  const h = await workspaceHarness(t)
  h.window.innerWidth = 960
  h.window.innerHeight = 540
  const { KitchenDisplayApp } = await h.load('/src/kitchen-display/KitchenDisplayApp.jsx')
  const reports = []
  const current = controlledState(2, { revision: 3, requestedPage: 1 })
  const renderer = await h.render(KitchenDisplayApp, {
    bootstrap: async () => ({ kind: 'paired', state: current }),
    readState: async () => current,
    reportState: async (payload) => { reports.push(payload); return { reported: true } },
    requestFullscreen: async () => true,
    audio: { unlock: async () => true, playArrival: async () => true },
  })
  await flushEffects()
  await act(async () => buttonNamed(renderer.root, 'Iniciar painel da cozinha').props.onClick())
  await flushEffects()

  assert.equal(reports.length, 1)

  await act(async () => h.fireInterval(2000))
  await flushEffects()
  assert.equal(reports.length, 1)

  await act(async () => h.fireInterval(5000))
  await flushEffects()
  assert.equal(reports.length, 2)
  assert.deepEqual(reports[1], reports[0])
})

test('telemetry failure never marks the Kitchen TV stale or stops order polling', async (t) => {
  const h = await workspaceHarness(t)
  h.window.innerWidth = 960
  h.window.innerHeight = 540
  const { KitchenDisplayApp } = await h.load('/src/kitchen-display/KitchenDisplayApp.jsx')
  let reads = 0
  let reports = 0
  const current = controlledState(2, { revision: 0, requestedPage: 1 })
  const renderer = await h.render(KitchenDisplayApp, {
    bootstrap: async () => ({ kind: 'paired', state: current }),
    readState: async () => { reads += 1; return current },
    reportState: async () => { reports += 1; throw new Error('telemetry offline') },
    requestFullscreen: async () => true,
    audio: { unlock: async () => true, playArrival: async () => true },
  })
  await flushEffects()
  await act(async () => buttonNamed(renderer.root, 'Iniciar painel da cozinha').props.onClick())
  await flushEffects()

  assert.equal(reports, 1)
  assert.doesNotMatch(nodeText(renderer.root), /Dados temporariamente desatualizados/)

  await act(async () => h.fireInterval(2000))
  await flushEffects()
  assert.equal(reads, 1)
  assert.doesNotMatch(nodeText(renderer.root), /Dados temporariamente desatualizados/)
})

test('future scheduled work stays invisible and silent until its operational window, then alerts once', async (t) => {
  const h = await workspaceHarness(t)
  h.window.innerWidth = 1280
  h.window.innerHeight = 720
  const { KitchenDisplayApp } = await h.load('/src/kitchen-display/KitchenDisplayApp.jsx')
  const plays = []
  const futureOrder = {
    id: 'future-window-order',
    orderNumber: 7101,
    client: 'Entrega futura',
    type: 'Entrega',
    status: 'Em preparo',
    createdAt: '2026-09-22T12:00:00.000Z',
    orderDate: '2026-09-23',
    scheduledFor: '2026-09-23T15:00:00.000Z',
    items: [{ quantity: 1, name: 'Marmita', note: '' }],
  }
  const makeState = (serverNow) => ({
    serverNow,
    timing: state([]).timing,
    control: { revision: 1, requestedPage: 1, requestedModality: 'all' },
    orders: [futureOrder],
  })
  const initial = makeState('2026-09-22T20:00:00.000Z')
  const beforeWindow = makeState('2026-09-23T14:09:59.000Z')
  const atWindow = makeState('2026-09-23T14:10:00.000Z')
  const responses = [beforeWindow, atWindow, atWindow]
  const renderer = await h.render(KitchenDisplayApp, {
    bootstrap: async () => ({ kind: 'paired', state: initial }),
    readState: async () => responses.shift() || atWindow,
    requestFullscreen: async () => true,
    audio: {
      unlock: async () => true,
      playArrival: async (options) => { plays.push(options); return true },
    },
  })
  await flushEffects()
  await act(async () => buttonNamed(renderer.root, 'Iniciar painel da cozinha').props.onClick())
  await flushEffects()

  assert.equal(renderer.root.findAllByProps({ 'data-order-id': 'future-window-order' }).length, 0)
  assert.equal(plays.length, 0)

  await act(async () => h.fireInterval(2000))
  await flushEffects()
  const sameDayWaiting = renderer.root.findByProps({ 'data-order-id': 'future-window-order' })
  assert.match(sameDayWaiting.props.className, /kds-card--scheduled/)
  assert.equal(plays.length, 0)

  await act(async () => h.fireInterval(2000))
  await flushEffects()
  assert.ok(renderer.root.findByProps({ 'data-order-id': 'future-window-order' }))
  assert.equal(plays.length, 1)

  await act(async () => h.fireInterval(2000))
  await flushEffects()
  assert.equal(plays.length, 1)
})

test('opening the TV after an order already entered the operational window does not replay historical sound', async (t) => {
  const h = await workspaceHarness(t)
  h.window.innerWidth = 1280
  h.window.innerHeight = 720
  const { KitchenDisplayApp } = await h.load('/src/kitchen-display/KitchenDisplayApp.jsx')
  const plays = []
  const alreadyOperational = {
    serverNow: '2026-09-23T14:11:00.000Z',
    timing: state([]).timing,
    control: { revision: 1, requestedPage: 1, requestedModality: 'all' },
    orders: [{
      id: 'already-operational',
      orderNumber: 7102,
      client: 'Já operacional',
      type: 'Retirada',
      status: 'Em preparo',
      createdAt: '2026-09-22T12:00:00.000Z',
      orderDate: '2026-09-23',
      scheduledFor: '2026-09-23T15:00:00.000Z',
      items: [{ quantity: 1, name: 'Pedido', note: '' }],
    }],
  }
  const renderer = await h.render(KitchenDisplayApp, {
    bootstrap: async () => ({ kind: 'paired', state: alreadyOperational }),
    readState: async () => alreadyOperational,
    requestFullscreen: async () => true,
    audio: {
      unlock: async () => true,
      playArrival: async (options) => { plays.push(options); return true },
    },
  })
  await flushEffects()
  await act(async () => buttonNamed(renderer.root, 'Iniciar painel da cozinha').props.onClick())
  await flushEffects()

  assert.ok(renderer.root.findByProps({ 'data-order-id': 'already-operational' }))
  assert.equal(plays.length, 0)

  await act(async () => h.fireInterval(2000))
  await flushEffects()
  assert.equal(plays.length, 0)
})

test('table modality keeps an operational Local reservation visible without exposing future agenda rows', async (t) => {
  const h = await workspaceHarness(t)
  h.window.innerWidth = 1280
  h.window.innerHeight = 720
  const { KitchenDisplayApp } = await h.load('/src/kitchen-display/KitchenDisplayApp.jsx')
  const current = {
    serverNow: '2026-09-23T14:10:00.000Z',
    timing: state([]).timing,
    control: { revision: 4, requestedPage: 1, requestedModality: 'table' },
    orders: [
      {
        id: 'local-operational',
        orderNumber: 7103,
        client: 'Mesa 3 · Bia',
        type: 'Local',
        status: 'Em preparo',
        createdAt: '2026-09-22T12:00:00.000Z',
        orderDate: '2026-09-23',
        scheduledFor: '2026-09-23T15:00:00.000Z',
        tableReservationId: 'reservation-7103',
        tableReservationStatus: 'reserved',
        items: [{ quantity: 1, name: 'Lanche', note: '' }],
      },
      {
        id: 'delivery-operational',
        orderNumber: 7104,
        client: 'Entrega',
        type: 'Entrega',
        status: 'Em preparo',
        createdAt: '2026-09-23T14:00:00.000Z',
        items: [{ quantity: 1, name: 'Marmita', note: '' }],
      },
      {
        id: 'local-future',
        orderNumber: 7105,
        client: 'Mesa 8 · Futuro',
        type: 'Local',
        status: 'Em preparo',
        createdAt: '2026-09-22T12:00:00.000Z',
        orderDate: '2026-10-23',
        scheduledFor: '2026-10-23T18:00:00.000Z',
        tableReservationId: 'reservation-7105',
        tableReservationStatus: 'reserved',
        items: [{ quantity: 1, name: 'Reserva futura', note: '' }],
      },
    ],
  }
  const renderer = await h.render(KitchenDisplayApp, {
    bootstrap: async () => ({ kind: 'paired', state: current }),
    readState: async () => current,
    requestFullscreen: async () => true,
    audio: { unlock: async () => true, playArrival: async () => true },
  })
  await flushEffects()
  await act(async () => buttonNamed(renderer.root, 'Iniciar painel da cozinha').props.onClick())
  await flushEffects()

  assert.ok(renderer.root.findByProps({ 'data-order-id': 'local-operational' }))
  assert.equal(renderer.root.findAllByProps({ 'data-order-id': 'delivery-operational' }).length, 0)
  assert.equal(renderer.root.findAllByProps({ 'data-order-id': 'local-future' }).length, 0)
  assert.equal(buttonNamed(renderer.root, 'Próximos dias'), undefined)
})

import { clientFixture } from '../infrastructure/realtime/test-support/clientFixture.js'

test('paired TV uses realtime hints without the legacy two-second projection poll',async t=>{
  const h=await workspaceHarness(t),f=clientFixture()
  const {KitchenDisplayApp}=await h.load('/src/kitchen-display/KitchenDisplayApp.jsx')
  let reads=0
  const renderer=await h.render(KitchenDisplayApp,{realtimeApi:f.api,realtimeTransport:{clock:f.clock,createSocket:f.createSocket,random:()=>0.5},bootstrap:async()=>({kind:'paired',state:state([])}),readState:async()=>{reads++;return state(['new-order'])},audio:{unlock:async()=>true,playArrival:async()=>true}})
  await flushEffects();assert.equal(f.sockets.length,0)
  await act(async()=>buttonNamed(renderer.root,'Iniciar painel da cozinha').props.onClick())
  assert.equal(f.sockets.length,1)
  await act(async()=>{f.sockets[0].ready(f.clock);f.sockets[0].invalidate('2',['new-order']);await f.clock.tick(250)})
  assert.equal(reads,1);assert.equal(renderer.root.findAllByProps({'data-order-id':'new-order'}).length,1)
  await act(async()=>h.fireInterval(2000));assert.equal(reads,1)
  await act(async()=>{f.sockets[0].invalidate('3',['new-order']);await f.clock.tick(250)});assert.equal(reads,2)
})
test('revoked realtime TV cannot resume its projection or expose orders',async t=>{
  const h=await workspaceHarness(t),f=clientFixture()
  f.api.prepare=async()=>{throw Object.assign(new Error('revoked'),{status:401})}
  const {KitchenDisplayApp}=await h.load('/src/kitchen-display/KitchenDisplayApp.jsx')
  let reads=0
  const renderer=await h.render(KitchenDisplayApp,{realtimeApi:f.api,realtimeTransport:{clock:f.clock,createSocket:f.createSocket},bootstrap:async()=>({kind:'paired',state:state(['private'])}),readState:async()=>{reads++;return state(['private'])},audio:{unlock:async()=>true,playArrival:async()=>true}})
  await flushEffects();await act(async()=>buttonNamed(renderer.root,'Iniciar painel da cozinha').props.onClick())
  await act(async()=>f.clock.tick(300_000))
  assert.equal(f.sockets.length,0);assert.equal(reads,0)
  assert.equal(renderer.root.findAllByProps({'data-order-id':'private'}).length,0)
})
test('scheduled orders enter their window and alert from local clock without HTTP or messages',async t=>{
  const h=await workspaceHarness(t),f=clientFixture(),plays=[]
  const {KitchenDisplayApp}=await h.load('/src/kitchen-display/KitchenDisplayApp.jsx')
  const initial={...state([]),serverNow:'2026-10-14T14:09:59.000Z',orders:[{id:'scheduled-clock',status:'Em preparo',type:'Entrega',orderDate:'2026-10-14',scheduledFor:'2026-10-14T15:00:00.000Z',createdAt:'2026-10-14T12:00:00.000Z',items:[]}]}
  let reads=0
  const renderer=await h.render(KitchenDisplayApp,{realtimeApi:f.api,realtimeTransport:{clock:f.clock,createSocket:f.createSocket},bootstrap:async()=>({kind:'paired',state:initial}),readState:async()=>{reads++;return initial},audio:{unlock:async()=>true,playArrival:async()=>{plays.push('arrival');return true}}})
  await flushEffects();await act(async()=>buttonNamed(renderer.root,'Iniciar painel da cozinha').props.onClick())
  assert.equal(plays.length,0)
  await act(async()=>h.fireInterval(1000))
  assert.equal(reads,0);assert.deepEqual(plays,['arrival'])
  await act(async()=>h.fireInterval(1000));assert.equal(plays.length,1)
})
