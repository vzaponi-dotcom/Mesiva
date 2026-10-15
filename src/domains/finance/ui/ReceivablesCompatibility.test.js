import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8')

test('order-list mode preserves desktop quick payment, mobile FAB and single-order delegation', async () => {
  const page = await read('./Receivables.jsx')
  const quick = await read('./ReceivablesQuickPaymentDialog.jsx')

  assert.match(page, /activeView === 'pending' && displayMode === 'orders'[\s\S]*receivables-payment-desktop-action/)
  assert.match(page, /activeView === 'pending' && displayMode === 'orders' && !overlayOpen[\s\S]*receivables-payment-fab/)
  assert.match(page, /onSelect=\{registerQuickPayment\}/)
  assert.match(quick, /onSelect\(entry\.order\.id\)/)
  assert.match(quick, /onClose\?\.\(\)/)
})

test('payment promise and forecast flows remain reachable and keep their existing contracts', async () => {
  const page = await read('./Receivables.jsx')
  const promise = await read('./PaymentPromiseDialog.jsx')
  const forecast = await read('./ReceivablesForecastDialog.jsx')

  assert.match(page, /setPromiseOrder\(order\)/)
  assert.match(page, /setForecastOpen\(true\)/)
  assert.match(page, /const applyForecastDate = \(date\) => \{[\s\S]*exactDateFilter: date/)
  assert.match(page, /applyTimingFilter\('today'\)/)
  assert.match(page, /applyTimingFilter\('upcoming'\)/)
  assert.match(page, /applyTimingFilter\('overdue'\)/)

  assert.match(promise, /onSave\?\.\(order\.id, selectedDate\)/)
  assert.match(promise, /onSave\?\.\(order\.id, null\)/)
  assert.match(promise, /Remover data prometida/)
  assert.match(forecast, /onSelectDate\(day\.date\)/)
})

test('paid receivables remain flat and mixed payment composition remains visible', async () => {
  const page = await read('./Receivables.jsx')
  const detail = await read('./ReceivableDetail.jsx')

  assert.match(page, /receivables-ledger-paid/)
  assert.match(page, /visiblePaidOrders\.map/)
  assert.doesNotMatch(page, /groupReceivableEntriesByClient\(visiblePaidOrders/)
  assert.match(detail, /formatPaymentSummary\(order\?\.paymentAllocations, order\?\.paymentMethod/)
})

test('client navigation passes the canonical customer identity instead of the presentation group shape', async () => {
  const panel = await read('./ReceivableClientPanel.jsx')

  assert.match(panel, /group\.clientId && onOpenClient/)
  assert.match(panel, /onOpenClient\?\.\(\{\s*id:\s*group\.clientId,\s*name:\s*group\.label\s*\}\)/)
})

test('table-tab orders remain outside standalone receivables and quick payment', async () => {
  const domain = await read('../../../../shared/receivableReadRules.js')
  const page = await read('./Receivables.jsx')

  assert.match(domain, /\.filter\(\(order\) => !isTableTabOrder\(order\)\)/)
  assert.match(page, /quickPaymentEntries = useMemo\(\(\) => \(scoped\?\(reads\.quick\.data\?\.entries \|\| \[\]\):pendingEntries\)\.filter/)
})
