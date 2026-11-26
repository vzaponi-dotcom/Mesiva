import test from 'node:test'
import assert from 'node:assert/strict'

import {
  normalizeReportingQuery,
  patchReportingQuery,
  reportingQueryToSearchParams,
} from './reportingQuery.js'

const normalize = (search = '') => normalizeReportingQuery(
  new URLSearchParams(search),
  { today: '2026-09-25' },
)

test('reporting query defaults to current business month and overview', () => {
  assert.deepEqual(normalize(), {
    view: 'overview',
    period: 'current-month',
    from: '2026-09-01',
    to: '2026-09-25',
    type: null,
    schedule: null,
    status: null,
    paymentMethod: null,
    category: null,
    product: null,
    productName: null,
    customer: null,
    orderHourFrom: null,
    orderHourTo: null,
    operationalDeadline: null,
    receivable: null,
    search: '',
    sort: 'date-desc',
    page: 1,
    pageSize: 25,
  })
})

test('unknown reporting view falls back without discarding valid filters', () => {
  const query = normalize('view=unknown&type=Entrega&page=4&pageSize=50&category=Refei%C3%A7%C3%B5es')
  assert.equal(query.view, 'overview')
  assert.equal(query.type, 'Entrega')
  assert.equal(query.category, 'Refeições')
  assert.equal(query.page, 4)
  assert.equal(query.pageSize, 50)
})

test('reporting query serialization is deterministic and round-trippable', () => {
  const query = normalize('view=products&type=Entrega&schedule=scheduled&page=3&pageSize=50&search=maria')
  const serialized = reportingQueryToSearchParams(query).toString()
  assert.equal(
    serialized,
    'view=products&period=current-month&from=2026-09-01&to=2026-09-25&type=Entrega&schedule=scheduled&search=maria&page=3&pageSize=50',
  )
  assert.deepEqual(normalize(serialized), query)
})

test('population-changing reporting filters reset detail pagination', () => {
  const current = normalize('view=detail&type=Entrega&page=4&pageSize=50')
  const next = patchReportingQuery(current, { type: 'Retirada' })
  assert.equal(next.view, 'detail')
  assert.equal(next.type, 'Retirada')
  assert.equal(next.page, 1)
  assert.equal(next.pageSize, 50)
})

test('switching reporting view preserves active filters', () => {
  const current = normalize('view=overview&type=Entrega&category=Refei%C3%A7%C3%B5es&page=2')
  const next = patchReportingQuery(current, { view: 'products' })
  assert.equal(next.view, 'products')
  assert.equal(next.type, 'Entrega')
  assert.equal(next.category, 'Refeições')
})

test('returning from a product drill-down restores the product list for the same period', () => {
  const current = normalize('view=detail&from=2026-09-01&to=2026-09-20&type=Entrega&product=juice')
  const next = patchReportingQuery(current, { view: 'products' })
  assert.equal(next.product, null)
  assert.equal(next.from, '2026-09-01')
  assert.equal(next.to, '2026-09-20')
  assert.equal(next.type, 'Entrega')
  assert.equal(patchReportingQuery(normalize('view=detail&productName=Suco'), { view: 'products' }).productName, null)
})

test('historical product name uses a separate round-trippable filter and resets the detail page', () => {
  const current = normalize('view=detail&productName=X-Bacon&page=4')
  assert.equal(current.productName, 'X-Bacon')
  assert.equal(reportingQueryToSearchParams(current).get('productName'), 'X-Bacon')
  assert.equal(patchReportingQuery(current, { productName: 'Batata' }).page, 1)
  assert.equal(patchReportingQuery(current, { productName: 'Batata' }).productName, 'Batata')
})

test('reporting URL omits implicit overview and pagination defaults while preserving the exact date recorte', () => {
  const query = normalize('period=today&from=2026-09-25&to=2026-09-25')
  assert.equal(reportingQueryToSearchParams(query).toString(), 'period=today&from=2026-09-25&to=2026-09-25')
  assert.deepEqual(normalize(reportingQueryToSearchParams(query)), query)
})


test('detail pagination preserves the supported 10 item page size', () => {
  const query = normalize('view=detail&page=1&pageSize=10')
  assert.equal(query.pageSize, 10)
  const patched = patchReportingQuery(query, { pageSize: 10, page: 1 })
  assert.equal(patched.pageSize, 10)
  assert.equal(reportingQueryToSearchParams(patched).get('pageSize'), '10')
})
