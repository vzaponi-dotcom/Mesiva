import test from 'node:test'
import assert from 'node:assert/strict'
import { loadBootstrap } from './repositories.js'

class FinanceBootstrapDb {
  prepare(sql) {
    return {
      bind() {
        return {
          async first() {
            if (sql.includes('FROM businesses')) return { id: 'biz', name: 'Delivery' }
            if (sql.includes('FROM finance_settings')) return { opening_balance_cents: 15000, opening_date: '2026-09-01', created_at: 'created', updated_at: 'updated' }
            return null
          },
          async all() {
            if (sql.includes('LEFT JOIN business_finance_categories fc')) {
              assert.match(sql, /CASE WHEN m\.source = 'order-payment' THEN COALESCE\(m\.payment_method, p\.method\)/)
              assert.match(sql, /m\.deleted_at IS NULL/)
              assert.match(sql, /LEFT JOIN payments p/)
              assert.match(sql, /LEFT JOIN business_finance_categories fc/)
              return { results: [
                { id: 'sale', type: 'entrada', category: 'Vendas', description: 'Venda', value_cents: 1000, source: 'order-payment', order_id: 'o1', payment_id: 'p1', payment_method: 'Pix', movement_date: '2026-09-03', created_at: 'c1', updated_at: 'c1' },
                { id: 'refund', type: 'saida', category: 'Estornos', category_label: null, description: 'Estorno', value_cents: 500, source: 'order-refund', order_id: 'o2', payment_id: 'p2', payment_method: null, movement_date: '2026-09-03', created_at: 'c2', updated_at: 'c2' },
              ] }
            }
            return { results: [] }
          },
        }
      },
    }
  }
}

test('bootstrap exposes active finance movements and opening settings', async () => {
  const result = await loadBootstrap(new FinanceBootstrapDb(), 'biz')
  assert.equal(result.movements.find((m) => m.id === 'sale').paymentMethod, 'Pix')
  assert.equal(result.movements.find((m) => m.id === 'refund').paymentMethod, null)
  assert.deepEqual(result.financeSettings, { openingBalance: 150, openingDate: '2026-09-01', createdAt: 'created', updatedAt: 'updated' })
})
