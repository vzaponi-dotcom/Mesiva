import test from 'node:test'
import assert from 'node:assert/strict'
import { getNavigationBadge } from './navigationBadges.js'

test('formats operational badges and caps only the visual value', () => {
  assert.deepEqual(getNavigationBadge({ id: 'orders', label: 'Pedidos' }, { orders: 127 }), { count: 127, text: '99+', ariaLabel: 'Pedidos, 127 pedidos em andamento' })
  assert.equal(getNavigationBadge({ id: 'orders', label: 'Pedidos' }, { orders: 0 }), null)
})

test('formats singular comanda copy', () => {
  assert.equal(getNavigationBadge({ id: 'comandas', label: 'Comandas' }, { comandas: 1 }).ariaLabel, 'Comandas, 1 comanda aberta')
})

test('history fallback never exposes the operational Orders count', () => {
  assert.equal(getNavigationBadge({ id: 'history', area: 'orders', label: 'Pedidos' }, { orders: 8 }), null)
})

test('Financeiro shows the actual pending refund count on desktop and mobile, never on unrelated tabs', () => {
  const badges = { finance: 3 }
  assert.deepEqual(getNavigationBadge({ id: 'finance', label: 'Movimentações' }, badges), {
    count: 3, text: '3', ariaLabel: 'Movimentações, 3 devoluções ou estornos pendentes',
  })
  assert.deepEqual(getNavigationBadge({ id: 'dashboard', area: 'finance', icon: 'finance', label: 'Financeiro' }, badges), {
    count: 3, text: '3', ariaLabel: 'Financeiro, 3 devoluções ou estornos pendentes',
  })
  assert.equal(getNavigationBadge({ id: 'dashboard', area: 'finance', label: 'Visão geral' }, badges), null)
  assert.equal(getNavigationBadge({ id: 'finance', label: 'Movimentações' }, { finance: 0 }), null)
  assert.equal(getNavigationBadge({ id: 'finance', label: 'Movimentações' }, { finance: undefined }), null)
  assert.deepEqual(getNavigationBadge({ id: 'finance', label: 'Movimentações' }, { finance: 120 }), {
    count: 120, text: '99+', ariaLabel: 'Movimentações, 120 devoluções ou estornos pendentes',
  })
  assert.equal(getNavigationBadge({ id: 'finance', label: 'Movimentações' }, { finance: 1 }).ariaLabel, 'Movimentações, 1 devolução ou estorno pendente')
})

test('Financeiro pending badge is wired to the existing official refund list and visibility permission', async () => {
  const { readFileSync } = await import('node:fs')
  const app = readFileSync(new URL('../../App.jsx', import.meta.url), 'utf8')
  assert.match(app, /finance:\s*canViewFinanceMovements\s*\?\s*pendingRefundOrders\.length\s*:\s*0/)
  assert.match(app, /<NavigationProvider[^>]*navigationBadges=\{navigationBadges\}/)
})
