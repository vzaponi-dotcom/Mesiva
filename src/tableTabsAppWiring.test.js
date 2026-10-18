import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createPaymentApi } from './app/workflows/payments/paymentApi.js'

const api = fs.readFileSync(new URL('./app/workflows/payments/paymentApi.js', import.meta.url), 'utf8')

test('frontend exposes the consolidated table tab payment API helper', async () => {
  const calls = []
  const client = createPaymentApi({
    request: async (url, options) => { calls.push({url, method: options.method, body: JSON.parse(options.body)}); return {} },
    json: (method, body) => ({method, body: JSON.stringify(body)}),
  })
  const allocations = [{methodCode: 'pix', amountCents: 2500}]
  await client.registerTableTabPayment('tab one', allocations)
  await client.registerTableTabPayment('tab two', allocations, {receivedDate: '2026-10-15'})
  assert.deepEqual(calls, [
    {url: '/api/table-tabs/tab%20one/payment',method: 'POST',body: {allocations}},
    {url: '/api/table-tabs/tab%20two/payment',method: 'POST',body: {allocations,receivedDate: '2026-10-15'}},
  ])
})

test('legacy API no longer owns C5 table management or transfer commands', () => {
  for (const name of ['createTable', 'updateTable', 'reorderTables', 'transferTableTab', 'getTableTabDetail']) {
    assert.doesNotMatch(api, new RegExp(`export const ${name}\\b`))
  }
})
