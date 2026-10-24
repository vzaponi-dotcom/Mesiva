import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), 'utf8')

test('financial overview removes the duplicated new-order floating action', () => {
  const page = source('./app/surfaces/dashboard/DashboardSurface.jsx')
  const css = source('./app/surfaces/dashboard/dashboard.css')

  assert.doesNotMatch(page, /Novo pedido|onNewOrder|dashboard-new-order-fab/)
  assert.doesNotMatch(css, /dashboard-new-order-fab/)
})

test('financial overview does not cover its heading with a redundant conference action', () => {
  const page = source('./app/surfaces/dashboard/DashboardSurface.jsx')
  const navigation = source('./app/navigation/registry.js')

  assert.doesNotMatch(page, /Conferir recebimentos|requestNavigation\(['"]day-conference['"]\)/)
  assert.match(page, /dashboard-privacy-toggle/, 'preserve the monetary privacy control')
  assert.match(navigation, /id: 'day-conference', path: '\/financeiro\/conferencia-do-dia'/,
    'the finance navigation keeps a direct conference destination')
})
