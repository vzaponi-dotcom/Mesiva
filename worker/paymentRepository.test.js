import test from 'node:test'
import assert from 'node:assert/strict'
import { OperationalDb } from './test-support/operationalDb.js'
import { createOrder } from './repositories.js'
import { registerOrderPayment } from './paymentRepository.js'

const BUSINESS = 'amor-e-sabor'
const NOW = new Date('2026-09-21T15:00:00.000Z')

class PaymentDb extends OperationalDb {
  constructor() {
    super()
    const timestamp = NOW.toISOString()
    this.exec(`
      INSERT INTO clients (id, business_id, name, created_at, updated_at)
      VALUES ('client-1', '${BUSINESS}', 'Ana', '${timestamp}', '${timestamp}');
      INSERT INTO products (id, business_id, category, size, name, price_cents, active, created_at, updated_at)
      VALUES ('product-1', '${BUSINESS}', 'Meals', '', 'Prato', 8000, 1, '${timestamp}', '${timestamp}');
    `)
  }
}

const orderInput = (idempotencyKey, overrides = {}) => ({
  customerIdentity: { type: 'registered_client', clientId: 'client-1' },
  type: 'Entrega',
  orderDate: '2026-09-21',
  items: [{ productId: 'product-1', quantity: 1, note: '' }],
  deliveryFeeCents: 0,
  adjustment: { type: 'none', mode: 'fixed', storedValue: 0, reason: '' },
  paymentMethod: null,
  idempotencyKey,
  ...overrides,
})

const split = [
  { methodCode: 'cash', amountCents: 3000 },
  { methodCode: 'pix', amountCents: 5000 },
]

test('split standalone payment persists one receipt, two allocations, one order payment and two financial movements', async () => {
  const db = new PaymentDb()
  const order = await createOrder(db, BUSINESS, orderInput('split-order'), NOW)

  const result = await registerOrderPayment(db, BUSINESS, order.id, split, new Date(+NOW + 60_000))

  assert.equal(result.receipt.totalCents, 8000)
  assert.equal(result.receipt.total, 80)
  assert.equal(result.receipt.tableTabId, null)
  assert.equal(result.allocations.length, 2)
  assert.deepEqual(result.allocations.map(({ methodCode, methodLabel, amountCents }) => ({ methodCode, methodLabel, amountCents })), [
    { methodCode: 'cash', methodLabel: 'Dinheiro', amountCents: 3000 },
    { methodCode: 'pix', methodLabel: 'Pix', amountCents: 5000 },
  ])
  assert.equal(result.payment.orderId, order.id)
  assert.equal(result.payment.receiptId, result.receipt.id)
  assert.equal(result.payment.amount, 80)
  assert.equal(result.order.paymentStatus, 'Pago')
  assert.equal(result.movements.length, 2)
  assert.deepEqual(result.movements.map(({ value, paymentMethod }) => ({ value, paymentMethod })), [
    { value: 30, paymentMethod: 'Dinheiro' },
    { value: 50, paymentMethod: 'Pix' },
  ])

  const receipt = db.sqlite.prepare('SELECT * FROM payment_receipts WHERE id = ?').get(result.receipt.id)
  assert.equal(receipt.total_cents, 8000)

  const allocations = db.sqlite.prepare('SELECT * FROM payment_allocations WHERE receipt_id = ? ORDER BY amount_cents').all(result.receipt.id)
  assert.deepEqual(allocations.map(({ method_code, method_label, amount_cents }) => ({ method_code, method_label, amount_cents })), [
    { method_code: 'cash', method_label: 'Dinheiro', amount_cents: 3000 },
    { method_code: 'pix', method_label: 'Pix', amount_cents: 5000 },
  ])

  const payment = db.sqlite.prepare('SELECT * FROM payments WHERE order_id = ?').get(order.id)
  assert.equal(payment.receipt_id, result.receipt.id)
  assert.equal(payment.method, null)
  assert.equal(payment.amount_cents, 8000)

  const movements = db.sqlite.prepare(`SELECT * FROM movements
    WHERE order_id = ? AND source = 'order-payment' ORDER BY value_cents`).all(order.id)
  assert.equal(movements.length, 2)
  assert.deepEqual(movements.map(({ value_cents }) => value_cents), [3000, 5000])
  assert.ok(movements.every(({ payment_id }) => payment_id === payment.id))
  assert.ok(movements.every(({ receipt_id }) => receipt_id === result.receipt.id))
  assert.equal(new Set(movements.map(({ payment_allocation_id }) => payment_allocation_id)).size, 2)
  assert.equal(movements.reduce((sum, movement) => sum + movement.value_cents, 0), 8000)

  assert.equal(db.sqlite.prepare("SELECT first_used_at FROM business_payment_methods WHERE business_id = ? AND code = 'cash'").get(BUSINESS).first_used_at, result.receipt.paidAt)
  assert.equal(db.sqlite.prepare("SELECT first_used_at FROM business_payment_methods WHERE business_id = ? AND code = 'pix'").get(BUSINESS).first_used_at, result.receipt.paidAt)
})

test('standalone payment rejects mismatched totals, cancelled orders and duplicates without leaking receipts', async () => {
  const db = new PaymentDb()
  const order = await createOrder(db, BUSINESS, orderInput('reject-order'), NOW)

  await assert.rejects(
    registerOrderPayment(db, BUSINESS, order.id, [{ methodCode: 'pix', amountCents: 7999 }], new Date(+NOW + 1_000)),
    { status: 400, code: 'VALIDATION_ERROR' },
  )
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM payment_receipts').get().n, 0)

  db.sqlite.prepare("UPDATE orders SET status = 'Cancelado' WHERE id = ?").run(order.id)
  await assert.rejects(
    registerOrderPayment(db, BUSINESS, order.id, [{ methodCode: 'pix', amountCents: 8000 }], new Date(+NOW + 2_000)),
    { status: 409, code: 'ORDER_ALREADY_CANCELLED' },
  )
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM payment_receipts').get().n, 0)

  db.sqlite.prepare("UPDATE orders SET status = 'Em preparo' WHERE id = ?").run(order.id)
  await registerOrderPayment(db, BUSINESS, order.id, [{ methodCode: 'pix', amountCents: 8000 }], new Date(+NOW + 3_000))
  await assert.rejects(
    registerOrderPayment(db, BUSINESS, order.id, [{ methodCode: 'pix', amountCents: 8000 }], new Date(+NOW + 4_000)),
    { status: 409, code: 'ORDER_ALREADY_PAID' },
  )
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM payment_receipts').get().n, 1)
  assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM movements WHERE source = 'order-payment'").get().n, 1)
})

test('inactive method rejects the whole composition before any payment effect', async () => {
  const db = new PaymentDb()
  const order = await createOrder(db, BUSINESS, orderInput('inactive-method'), NOW)
  db.sqlite.exec("UPDATE business_payment_methods SET active = 0 WHERE code = 'cash'")

  await assert.rejects(
    registerOrderPayment(db, BUSINESS, order.id, split, new Date(+NOW + 5_000)),
    { status: 409, code: 'POLICY_CHANGED' },
  )
  for (const table of ['payment_receipts', 'payment_allocations', 'payments']) {
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM ' + table).get().n, 0, table)
  }
  assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM movements WHERE source = 'order-payment'").get().n, 0)
})

test('policy change immediately before commit rolls back receipt, allocations, payment, movements and first-use metadata', async () => {
  const db = new PaymentDb()
  const order = await createOrder(db, BUSINESS, orderInput('policy-race'), NOW)
  const batch = db.batch.bind(db)
  let raced = false
  db.batch = async (statements) => {
    if (!raced) {
      raced = true
      db.sqlite.exec("UPDATE business_payment_methods SET active = 0 WHERE code = 'cash'; UPDATE business_payment_settings SET revision = revision + 1")
    }
    return batch(statements)
  }

  await assert.rejects(
    registerOrderPayment(db, BUSINESS, order.id, split, new Date(+NOW + 6_000)),
    { status: 409, code: 'POLICY_CHANGED' },
  )

  for (const table of ['payment_receipts', 'payment_allocations', 'payments']) {
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM ' + table).get().n, 0, table)
  }
  assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM movements WHERE source = 'order-payment'").get().n, 0)
  assert.equal(db.sqlite.prepare("SELECT first_used_at FROM business_payment_methods WHERE code = 'pix'").get().first_used_at, null)
  assert.equal(db.sqlite.prepare("SELECT first_used_at FROM business_payment_methods WHERE code = 'cash'").get().first_used_at, null)
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM settings_tx_assertions').get().n, 0)
})

test('Task 12 requires open table tab settlement through its own payment flow', async () => {
  const db = new PaymentDb()
  const timestamp = NOW.toISOString()
  db.sqlite.prepare(`INSERT INTO tables
    (id, business_id, name, name_key, sort_order, is_active, created_at, updated_at)
    VALUES ('table-1', ?, 'Mesa 1', 'mesa 1', 1, 1, ?, ?)`).run(BUSINESS, timestamp, timestamp)

  const tableOrder = await createOrder(db, BUSINESS, orderInput('table-order', {
    type: 'Local',
    customerIdentity: { type: 'table', tableId: 'table-1', clientId: null },
  }), NOW)

  await assert.rejects(registerOrderPayment(
    db,
    BUSINESS,
    tableOrder.id,
    [{ methodCode: 'pix', amountCents: 8000 }],
    new Date(+NOW + 7_000),
  ), {status:409,code:'TABLE_TAB_PAYMENT_REQUIRED'})
  assert.equal(db.sqlite.prepare('SELECT status FROM table_tabs WHERE id = ?').get(tableOrder.tableTabId).status, 'open')
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM payments').get().n,0)
})
