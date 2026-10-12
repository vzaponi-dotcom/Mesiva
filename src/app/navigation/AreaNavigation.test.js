import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { workspaceHarness, buttonNamed } from '../../test-support/renderWorkspace.js'

test('AreaNavigation usa contexto e marca destino ativo', async (t) => {
  const h = await workspaceHarness(t)
  const { NavigationProvider } = await h.load('/src/app/navigation/NavigationContext.jsx')
  const { default: AreaNavigation } = await h.load('/src/app/navigation/AreaNavigation.jsx')
  const calls = []
  const renderer = await h.render(NavigationProvider, {
    activeTab: 'history',
    granted: new Set(['orders.view', 'orders.history']),
    implemented: new Set(['orders', 'history', 'new-order']),
    moreOpen: false,
    requestNavigation: (id) => calls.push(id), openMore() {}, closeMore() {},
    children: React.createElement(AreaNavigation, { area: 'orders' }),
  })
  const nav = renderer.root.findByProps({ 'aria-label': 'Navegação de Pedidos' })
  assert.equal(buttonNamed(nav, 'Histórico').props['aria-current'], 'page')
  buttonNamed(nav, 'Cozinha').props.onClick()
  assert.deepEqual(calls, ['orders'])
})

test('Financeiro keeps Relatórios in desktop area navigation', async (t) => {
  const h = await workspaceHarness(t)
  const { NavigationProvider } = await h.load('/src/app/navigation/NavigationContext.jsx')
  const { default: AreaNavigation } = await h.load('/src/app/navigation/AreaNavigation.jsx')
  const renderer = await h.render(NavigationProvider, {
    activeTab: 'reports',
    granted: new Set(['finance.overview', 'reports.view', 'finance.receivables', 'finance.movements']),
    implemented: new Set(['dashboard', 'reports', 'receivables', 'finance']),
    moreOpen: false,
    requestNavigation() {}, openMore() {}, closeMore() {},
    children: React.createElement(AreaNavigation, { area: 'finance' }),
  })
  const labels = renderer.root.findAllByType('button').map((button) => button.children.join(''))
  assert.deepEqual(labels, ['Visão geral', 'Relatórios', 'A receber', 'Movimentações'])
})

test('Financeiro removes Relatórios from mobile area navigation', async (t) => {
  const h = await workspaceHarness(t, { mobile: true })
  const { NavigationProvider } = await h.load('/src/app/navigation/NavigationContext.jsx')
  const { default: AreaNavigation } = await h.load('/src/app/navigation/AreaNavigation.jsx')
  const renderer = await h.render(NavigationProvider, {
    activeTab: 'dashboard',
    granted: new Set(['finance.overview', 'reports.view', 'finance.receivables', 'finance.movements']),
    implemented: new Set(['dashboard', 'reports', 'receivables', 'finance']),
    moreOpen: false,
    requestNavigation() {}, openMore() {}, closeMore() {},
    children: React.createElement(AreaNavigation, { area: 'finance' }),
  })
  const labels = renderer.root.findAllByType('button').map((button) => button.children.join(''))
  assert.deepEqual(labels, ['Visão geral', 'A receber', 'Movimentações'])
})

test('Movimentações shows the pending refund badge in Financeiro area navigation', async t => {
  const h = await workspaceHarness(t)
  const { NavigationProvider } = await h.load('/src/app/navigation/NavigationContext.jsx')
  const { default: AreaNavigation } = await h.load('/src/app/navigation/AreaNavigation.jsx')
  const renderer = await h.render(NavigationProvider, {
    activeTab: 'dashboard',
    granted: new Set(['finance.overview', 'finance.movements']),
    implemented: new Set(['dashboard', 'finance']),
    navigationBadges: { finance: 2 },
    requestNavigation() {}, openMore() {}, closeMore() {},
    children: React.createElement(AreaNavigation, { area: 'finance' }),
  })
  const matching = renderer.root.findAll(node => node.type === 'button' && node.props['aria-label'] === 'Movimentações, 2 devoluções ou estornos pendentes')
  assert.equal(matching.length, 1)
  assert.ok(matching[0].findAll(node => node.props?.className === 'area-navigation-badge' && node.children.includes('2')).length)
})
