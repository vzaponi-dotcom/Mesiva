import test from 'node:test'
import assert from 'node:assert/strict'
import { createSettingsDb } from './test-support/settingsDb.js'

const BUSINESS = 'amor-e-sabor'
const MIGRATION = '0052_effective_receipt_date.sql'
const REGISTERED_AT = '2026-10-17T15:00:00.000Z'

const fields = (sqlite) => sqlite.prepare('PRAGMA table_info(payment_receipts)').all().map((row) => row.name)
const receipt = (sqlite, id, cents) => sqlite.prepare(
  'INSERT INTO payment_receipts(id,business_id,total_cents,paid_at,created_at) VALUES(?,?,?,?,?)',
).run(id, BUSINESS, cents, REGISTERED_AT, REGISTERED_AT)
const allocation = (sqlite, id, receiptId, cents, method) => sqlite.prepare(
  'INSERT INTO payment_allocations(id,business_id,receipt_id,method_code,method_label,amount_cents,created_at) VALUES(?,?,?,?,?,?,?)',
).run(id, BUSINESS, receiptId, method, method === 'pix' ? 'Pix' : 'Dinheiro', cents, REGISTERED_AT)
const movement = (sqlite, id, receiptId, allocationId, date, cents) => sqlite.prepare(
  "INSERT INTO movements(id,business_id,type,category,description,value_cents,source,receipt_id,payment_allocation_id,movement_date,created_at) VALUES(?,?,'entrada','Vendas','Recebimento histórico',?,'order-payment',?,?,?,?)",
).run(id, BUSINESS, cents, receiptId, allocationId, date, REGISTERED_AT)

test('0052 creates a nullable effective date and an index for receipt-period queries', (t) => {
  const f = createSettingsDb()
  t.after(f.close)
  assert.ok(fields(f.sqlite).includes('received_date'))
  assert.ok(f.sqlite.prepare("PRAGMA index_list(payment_receipts)").all().some((row) => row.name === 'payment_receipts_business_received_date_idx'))
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM payment_receipts').get().n, 0)
  assert.deepEqual(f.sqlite.prepare('PRAGMA foreign_key_check').all(), [])
})

test('0052 preserves receipt/allocations/timestamps, derives only unanimous linked financial dates and leaves ambiguous legacy rows for controlled fallback', (t) => {
  let historical
  const f = createSettingsDb({
    beforeMigration(file, sqlite) {
      if (file !== MIGRATION) return
      receipt(sqlite, 'linked', 3000)
      allocation(sqlite, 'linked-pix', 'linked', 2000, 'pix')
      allocation(sqlite, 'linked-cash', 'linked', 1000, 'cash')
      movement(sqlite, 'linked-m1', 'linked', 'linked-pix', '2026-10-15', 2000)
      movement(sqlite, 'linked-m2', 'linked', 'linked-cash', '2026-10-15', 1000)

      receipt(sqlite, 'no-movement', 500)
      allocation(sqlite, 'unlinked-pix', 'no-movement', 500, 'pix')

      receipt(sqlite, 'mixed-dates', 500)
      allocation(sqlite, 'mixed-pix', 'mixed-dates', 300, 'pix')
      allocation(sqlite, 'mixed-cash', 'mixed-dates', 200, 'cash')
      movement(sqlite, 'mixed-m1', 'mixed-dates', 'mixed-pix', '2026-10-15', 300)
      movement(sqlite, 'mixed-m2', 'mixed-dates', 'mixed-cash', '2026-10-16', 200)
      historical = {
        receipts: sqlite.prepare('SELECT id,total_cents,paid_at,created_at FROM payment_receipts ORDER BY id').all(),
        allocations: sqlite.prepare('SELECT id,receipt_id,amount_cents,created_at FROM payment_allocations ORDER BY id').all(),
        movements: sqlite.prepare('SELECT id,receipt_id,movement_date,created_at FROM movements ORDER BY id').all(),
      }
    },
  })
  t.after(f.close)
  assert.ok(historical, 'the upgrade fixture must execute before migration 0052')
  assert.deepEqual(f.sqlite.prepare('SELECT id,total_cents,paid_at,created_at FROM payment_receipts ORDER BY id').all(), historical.receipts)
  assert.deepEqual(f.sqlite.prepare('SELECT id,receipt_id,amount_cents,created_at FROM payment_allocations ORDER BY id').all(), historical.allocations)
  assert.deepEqual(f.sqlite.prepare('SELECT id,receipt_id,movement_date,created_at FROM movements ORDER BY id').all(), historical.movements)
  assert.deepEqual(f.sqlite.prepare('SELECT id,received_date FROM payment_receipts ORDER BY id').all().map((row) => ({ ...row })), [
    { id: 'linked', received_date: '2026-10-15' },
    { id: 'mixed-dates', received_date: null },
    { id: 'no-movement', received_date: null },
  ])
  assert.deepEqual(f.sqlite.prepare('PRAGMA foreign_key_check').all(), [])
})
