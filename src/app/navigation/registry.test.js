import test from 'node:test'
import assert from 'node:assert/strict'
import {
  NAVIGATION_DESTINATIONS,
  AREA_DESTINATION_IDS,
  DESKTOP_NAV_GROUPS,
  MOBILE_DIRECT_ENTRIES,
  MOBILE_MORE_ENTRIES,
  MOBILE_SECTION_IDS,
} from './registry.js'

test('C2 preserva IDs, fallbacks e menus atuais', () => {
  assert.deepEqual(NAVIGATION_DESTINATIONS.map(({ id }) => id), [
    'my-account', 'access-team', 'access-activity',
    'settings-home', 'settings-business-profile', 'settings-operations', 'settings-modalities',
    'settings-payments', 'settings-cancellations', 'settings-finance-categories',
    'settings-kitchen-tv',
    'orders', 'history', 'kitchen-tv-control', 'new-order', 'comandas', 'print-queue',
    'dashboard', 'day-conference', 'reports', 'receivables', 'finance', 'clients', 'products', 'tables',
    'settings-printing', 'settings-device',
  ])
  assert.deepEqual(AREA_DESTINATION_IDS, {
    access: ['access-team', 'access-activity'],
    orders: ['orders', 'history', 'kitchen-tv-control'],
    finance: ['dashboard', 'reports', 'receivables', 'finance', 'day-conference'],
    settings: [
      'settings-home', 'settings-business-profile', 'settings-operations', 'settings-modalities',
      'settings-payments', 'settings-cancellations',
      'settings-finance-categories', 'settings-kitchen-tv',
      'settings-printing', 'settings-device', 'access-team', 'access-activity',
    ],
  })
  assert.deepEqual(DESKTOP_NAV_GROUPS.map(({ label }) => label), ['OPERAÇÃO', 'FINANCEIRO', 'CADASTROS'])
  assert.deepEqual(MOBILE_DIRECT_ENTRIES.map((item) => item.area || item.id), ['orders', 'comandas', 'finance'])
  assert.deepEqual(MOBILE_MORE_ENTRIES.map((item) => item.area || item.id), ['print-queue', 'clients', 'products', 'tables', 'settings'])
  assert.deepEqual(MOBILE_SECTION_IDS, [
    'orders', 'history', 'kitchen-tv-control', 'comandas', 'dashboard', 'day-conference', 'receivables', 'finance',
    'print-queue', 'clients', 'products', 'tables', 'settings-kitchen-tv',
    'settings-printing', 'settings-device',
  ])
})



test('printing settings require administrative printing capabilities, not operational station view', () => {
  const destination = NAVIGATION_DESTINATIONS.find(({ id }) => id === 'settings-printing')
  assert.deepEqual(destination, {
    id: 'settings-printing',
    path: '/configuracoes/impressao',
    area: 'settings',
    label: 'Impressão',
    mobileEntry: 'more',
    anyCapability: ['printing.settings.view', 'printing.settings', 'printing.station.configure'],
  })
  const settingsHome = NAVIGATION_DESTINATIONS.find(({ id }) => id === 'settings-home')
  assert.equal(settingsHome.anyCapability.includes('printing.station.view'), false)
  assert.equal(settingsHome.anyCapability.includes('printing.station.configure'), true)
})

test('operation identity is an internal Settings destination without adding a new mobile global entry', () => {
  const destination = NAVIGATION_DESTINATIONS.find(({ id }) => id === 'settings-business-profile')
  assert.deepEqual(destination, {
    id: 'settings-business-profile',
    path: '/configuracoes/identidade',
    area: 'settings',
    label: 'Identidade da operação',
    mobileEntry: 'more',
    capability: 'business.profile.view',
  })
  assert.equal(AREA_DESTINATION_IDS.settings[1], 'settings-business-profile')
  assert.deepEqual(MOBILE_MORE_ENTRIES.map((item) => item.area || item.id), ['print-queue', 'clients', 'products', 'tables', 'settings'])
  assert.equal(MOBILE_MORE_ENTRIES.some((item) => item.id === 'settings-business-profile'), false)
})


test('reporting is a Financeiro destination without adding a new mobile bottom entry', () => {
  const destination = NAVIGATION_DESTINATIONS.find(({ id }) => id === 'reports')
  assert.deepEqual(destination, {
    id: 'reports',
    path: '/relatorios',
    area: 'finance',
    label: 'Relatórios',
    mobileEntry: null,
    capability: 'reports.view',
  })
  assert.deepEqual(AREA_DESTINATION_IDS.finance, ['dashboard', 'reports', 'receivables', 'finance', 'day-conference'])
  assert.deepEqual(
    DESKTOP_NAV_GROUPS.find(({ label }) => label === 'FINANCEIRO').items.map((item) => item.id || item.area),
    ['dashboard', 'day-conference', 'reports', 'receivables', 'finance'],
  )
  assert.deepEqual(MOBILE_DIRECT_ENTRIES.map((item) => item.area || item.id), ['orders', 'comandas', 'finance'])
  assert.equal(MOBILE_MORE_ENTRIES.some((item) => item.id === 'reports'), false)
})


test('kitchen TV control stays inside Pedidos without adding a new global navigation entry', () => {
  const destination = NAVIGATION_DESTINATIONS.find(({ id }) => id === 'kitchen-tv-control')
  assert.deepEqual(destination, {
    id: 'kitchen-tv-control',
    path: '/pedidos/controle-da-tv',
    area: 'orders',
    label: 'Controle da TV',
    mobileEntry: 'orders',
    capability: 'orders.view',
  })
  assert.deepEqual(AREA_DESTINATION_IDS.orders, ['orders', 'history', 'kitchen-tv-control'])
  assert.equal(MOBILE_DIRECT_ENTRIES.some((item) => item.id === 'kitchen-tv-control'), false)
  assert.equal(MOBILE_MORE_ENTRIES.some((item) => item.id === 'kitchen-tv-control'), false)
})
