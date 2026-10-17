import test from 'node:test'
import assert from 'node:assert/strict'
import { loadBootstrap } from './repositories.js'

class EmptyFinanceDb {
  async batch(statements) { return Promise.all(statements.map(statement => statement.all())) }
  prepare() {
    return {
      bind() {
        return {
          async first() { return null },
          async all() { return { results: [] } },
        }
      },
    }
  }
}

test('bootstrap always exposes financeSettings null before opening balance is configured', async () => {
  const bootstrap = await loadBootstrap(new EmptyFinanceDb(), 'amor-e-sabor')
  assert.equal(Object.hasOwn(bootstrap, 'financeSettings'), true)
  assert.equal(bootstrap.financeSettings, null)
})
