import test from 'node:test'
import assert from 'node:assert/strict'
import { OperationalDb } from './test-support/operationalDb.js'
import { registerClientOrdersPayment } from './paymentRepository.js'
import { registerOrderRefund } from './orderCancellation.js'

const BUSINESS = 'amor-e-sabor'
const OTHER_BUSINESS = 'other-business'
const NOW = new Date('2026-09-27T00:40:00.000Z')
const ISO = NOW.toISOString()

class ClientReceivablesDb extends OperationalDb {
  constructor() {
    super({ businesses: [OTHER_BUSINESS] })
    this.sqlite.exec(`
      INSERT INTO clients (id, business_id, name, phone, address, created_at, updated_at) VALUES
        ('c1', '${BUSINESS}', 'Fernanda Albuquerque', '11999990000', '', '${ISO}', '${ISO}'),
        ('c2', '${BUSINESS}', 'Luana', '11999990001', '', '${ISO}', '${ISO}'),
        ('c-other', '${OTHER_BUSINESS}', 'Outro', '', '', '${ISO}', '${ISO}');
      INSERT INTO tables (id, business_id, name, name_key, sort_order, is_active, created_at, updated_at)
      VALUES ('table-1', '${BUSINESS}', 'Mesa 1', 'mesa 1', 1, 1, '${ISO}', '${ISO}');
      INSERT INTO table_tabs (
        id, business_id, table_id, table_identifier, tab_number, status,
        opened_at, closed_at, created_at, updated_at
      ) VALUES (
        'tab-1', '${BUSINESS}', 'table-1', 'Mesa 1', 1, 'open',
        '${ISO}', NULL, '${ISO}', '${ISO}'
      );
    `)

    this.insertOrder('o1', { clientId: 'c1', client: 'Fernanda Albuquerque', totalCents: 4900, orderNumber: 143 })
    this.insertOrder('o2', { clientId: 'c1', client: 'Fernanda Albuquerque', totalCents: 2000, orderNumber: 156 })
    this.insertOrder('o3', { clientId: 'c1', client: 'Fernanda Albuquerque', totalCents: 6000, orderNumber: 181 })
    this.insertOrder('other-client', { clientId: 'c2', client: 'Luana', totalCents: 3500, orderNumber: 190 })
    this.insertOrder('guest', { clientId: null, client: 'João', identityType: 'guest_name', totalCents: 1500, orderNumber: 191 })
    this.insertOrder('cancelled', { clientId: 'c1', client: 'Fernanda Albuquerque', totalCents: 1700, status: 'Cancelado', orderNumber: 192 })
    this.insertOrder('zero', { clientId: 'c1', client: 'Fernanda Albuquerque', totalCents: 0, orderNumber: 193 })
    this.insertOrder('table-order', {
      clientId: null,
      client: 'Mesa 1',
      identityType: 'table',
      tableTabId: 'tab-1',
      type: 'Local',
      totalCents: 2500,
      orderNumber: 194,
    })
    this.insertOrder('outside-business', {
      businessId: OTHER_BUSINESS,
      clientId: 'c-other',
      client: 'Outro',
      totalCents: 3100,
      orderNumber: 1,
    })
  }

  insertOrder(id, {
    businessId = BUSINESS,
    clientId,
    client,
    identityType = clientId ? 'registered_client' : 'guest_name',
    tableTabId = null,
    type = 'Entrega',
    totalCents,
    status = 'Finalizado',
    orderNumber,
  }) {
    this.sqlite.prepare(`INSERT INTO orders (
      id, business_id, client_id, client_name_snapshot, client_phone_snapshot,
      client_address_snapshot, customer_identity_type, table_tab_id, type,
      order_date, status, scheduled_for, promised_payment_date, is_backdated,
      subtotal_cents, delivery_fee_cents, adjustment_type, adjustment_mode,
      adjustment_value, adjustment_amount_cents, adjustment_reason, total_cents,
      created_at, finished_at, cancelled_at, cancel_reason, cancel_reason_note,
      idempotency_key, order_number
    ) VALUES (
      ?, ?, ?, ?, '', '', ?, ?, ?,
      '2026-09-26', ?, NULL, NULL, 0,
      ?, 0, 'none', 'fixed',
      0, 0, '', ?,
      ?, ?, NULL, NULL, NULL,
      ?, ?
    )`).run(
      id,
      businessId,
      clientId,
      client,
      identityType,
      tableTabId,
      type,
      status,
      totalCents,
      totalCents,
      ISO,
      status === 'Finalizado' ? ISO : null,
      'key-' + id,
      orderNumber,
    )
  }

  markPaid(orderId, { receiptId = 'existing-receipt', paymentId = 'existing-payment', amountCents = 4900 } = {}) {
    this.sqlite.prepare(`INSERT INTO payment_receipts
      (id, business_id, table_tab_id, total_cents, paid_at, created_at)
      VALUES (?, ?, NULL, ?, ?, ?)`).run(receiptId, BUSINESS, amountCents, ISO, ISO)
    this.sqlite.prepare(`INSERT INTO payments
      (id, business_id, order_id, receipt_id, amount_cents, method, paid_at, created_at)
      VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`).run(paymentId, BUSINESS, orderId, receiptId, amountCents, ISO, ISO)
  }
}

class D1BindingLimitDb extends ClientReceivablesDb {
  constructor() {
    super()
    const prepare = this.prepare
    this.maxBoundParameters = 0
    this.prepare = (sql) => {
      const statement = prepare(sql)
      return new Proxy(statement, {
        get: (target, property) => {
          if (property === 'bind') return (...values) => {
            this.maxBoundParameters = Math.max(this.maxBoundParameters, values.length)
            if (values.length > 100) throw new Error(`D1_TOO_MANY_BOUND_PARAMETERS:${values.length}`)
            return target.bind(...values)
          }
          const value = Reflect.get(target, property, target)
          return typeof value === 'function' ? value.bind(target) : value
        },
      })
    }
  }
}

const pix69 = [{ methodCode: 'pix', amountCents: 6900 }]
const split69 = [
  { methodCode: 'cash', amountCents: 3000 },
  { methodCode: 'pix', amountCents: 3900 },
]

const counts = (db) => ({
  receipts: db.sqlite.prepare('SELECT count(*) AS n FROM payment_receipts').get().n,
  allocations: db.sqlite.prepare('SELECT count(*) AS n FROM payment_allocations').get().n,
  payments: db.sqlite.prepare('SELECT count(*) AS n FROM payments').get().n,
  movements: db.sqlite.prepare("SELECT count(*) AS n FROM movements WHERE source = 'order-payment'").get().n,
})

test('client receivables payment settles selected orders with one receipt and leaves siblings pending', async () => {
  const db = new ClientReceivablesDb()

  const result = await registerClientOrdersPayment(db, BUSINESS, 'c1', ['o1', 'o2'], pix69, NOW)

  assert.equal(result.receipt.totalCents, 6900)
  assert.equal(result.receipt.tableTabId, null)
  assert.equal(result.allocations.length, 1)
  assert.equal(result.payments.length, 2)
  assert.equal(result.movements.length, 1)
  assert.deepEqual(result.orders.map((order) => [order.id, order.paymentStatus]), [['o1', 'Pago'], ['o2', 'Pago']])
  assert.ok(result.orders.every((order) => order.paymentMethod === 'Pix'))
  assert.ok(result.orders.every((order) => order.paymentAllocations.length === 1))
  assert.equal(new Set(result.payments.map((payment) => payment.receiptId)).size, 1)
  assert.equal(result.payments[0].receiptId, result.receipt.id)
  assert.deepEqual(result.payments.map((payment) => payment.amount).sort((a, b) => a - b), [20, 49])
  assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM payments WHERE order_id = 'o3'").get().n, 0)
})

test('client receivables split payment creates M allocation movements without assigning methods to individual orders', async () => {
  const db = new ClientReceivablesDb()

  const result = await registerClientOrdersPayment(db, BUSINESS, 'c1', ['o1', 'o2'], split69, NOW)

  assert.equal(result.receipt.totalCents, 6900)
  assert.equal(result.payments.length, 2)
  assert.equal(result.allocations.length, 2)
  assert.equal(result.movements.length, 2)
  assert.deepEqual(result.allocations.map(({ methodCode, amountCents }) => ({ methodCode, amountCents })), split69)
  assert.deepEqual(result.movements.map(({ value, paymentMethod }) => ({ value, paymentMethod })), [
    { value: 30, paymentMethod: 'Dinheiro' },
    { value: 39, paymentMethod: 'Pix' },
  ])
  assert.ok(result.movements.every((movement) => movement.orderId == null && movement.paymentId == null))
  assert.equal(new Set(result.movements.map((movement) => movement.receiptId)).size, 1)
  assert.equal(new Set(result.movements.map((movement) => movement.paymentAllocationId)).size, 2)

  const payments = db.sqlite.prepare("SELECT order_id, receipt_id, amount_cents, method FROM payments WHERE order_id IN ('o1','o2') ORDER BY order_id").all()
  assert.deepEqual(payments.map(({ order_id, amount_cents, method }) => ({ order_id, amount_cents, method })), [
    { order_id: 'o1', amount_cents: 4900, method: null },
    { order_id: 'o2', amount_cents: 2000, method: null },
  ])
  assert.equal(new Set(payments.map(({ receipt_id }) => receipt_id)).size, 1)

  assert.equal(new Set(result.orders.map((order) => order.paymentReceiptId)).size, 1)
  assert.equal(result.orders[0].paymentReceiptId, result.receipt.id)
  assert.ok(result.orders.every((order) => order.paymentMethod === null))
  assert.deepEqual(result.orders.map((order) => order.paidAmount).sort((a, b) => a - b), [20, 49])
  assert.ok(result.orders.every((order) => order.paymentAllocations.length === 2))
  assert.deepEqual(
    result.orders[0].paymentAllocations
      .map(({ methodCode, methodLabel, amountCents }) => ({ methodCode, methodLabel, amountCents }))
      .sort((left, right) => left.methodCode.localeCompare(right.methodCode)),
    [
      { methodCode: 'cash', methodLabel: 'Dinheiro', amountCents: 3000 },
      { methodCode: 'pix', methodLabel: 'Pix', amountCents: 3900 },
    ],
  )

  const movements = db.sqlite.prepare("SELECT value_cents, order_id, payment_id, receipt_id, payment_allocation_id FROM movements WHERE source = 'order-payment' ORDER BY value_cents").all()
  assert.deepEqual(movements.map(({ value_cents }) => value_cents), [3000, 3900])
  assert.ok(movements.every(({ order_id, payment_id }) => order_id === null && payment_id === null))
  assert.equal(movements.reduce((sum, movement) => sum + movement.value_cents, 0), 6900)
})

test('client receivables payment rejects invalid order-id sets before creating effects', async () => {
  const cases = [
    { ids: [], expected: { status: 400, code: 'VALIDATION_ERROR' } },
    { ids: ['o1'], expected: { status: 400, code: 'VALIDATION_ERROR' } },
    { ids: ['o1', 'o1'], expected: { status: 400, code: 'VALIDATION_ERROR' } },
    { ids: Array.from({ length: 101 }, (_, index) => 'order-' + index), expected: { status: 400, code: 'VALIDATION_ERROR' } },
  ]

  for (const { ids, expected } of cases) {
    const db = new ClientReceivablesDb()
    await assert.rejects(registerClientOrdersPayment(db, BUSINESS, 'c1', ids, pix69, NOW), expected)
    assert.deepEqual(counts(db), { receipts: 0, allocations: 0, payments: 0, movements: 0 })
  }
})

test('client receivables payment rejects orders outside the exact registered-client batch', async () => {
  const cases = [
    ['o1', 'missing'],
    ['o1', 'other-client'],
    ['o1', 'guest'],
    ['o1', 'table-order'],
    ['o1', 'cancelled'],
    ['o1', 'outside-business'],
    ['o1', 'zero'],
  ]

  for (const ids of cases) {
    const db = new ClientReceivablesDb()
    await assert.rejects(
      registerClientOrdersPayment(db, BUSINESS, 'c1', ids, [{ methodCode: 'pix', amountCents: 9800 }], NOW),
      (error) => error?.status === 409 || error?.status === 404 || error?.status === 400,
    )
    assert.deepEqual(counts(db), { receipts: 0, allocations: 0, payments: 0, movements: 0 })
  }
})

test('client receivables payment rejects already-paid selected order without creating a second receipt', async () => {
  const db = new ClientReceivablesDb()
  db.markPaid('o1')
  const before = counts(db)

  await assert.rejects(
    registerClientOrdersPayment(db, BUSINESS, 'c1', ['o1', 'o2'], pix69, NOW),
    { status: 409, code: 'CLIENT_RECEIVABLES_PAYMENT_CONFLICT' },
  )
  assert.deepEqual(counts(db), before)
})

test('client receivables payment preserves exact-total and payment-method validation', async () => {
  const cases = [
    [{ methodCode: 'pix', amountCents: 6800 }],
    [{ methodCode: 'pix', amountCents: 7000 }],
    [{ methodCode: 'pix', amountCents: 0 }, { methodCode: 'cash', amountCents: 6900 }],
    [{ methodCode: 'pix', amountCents: 3000 }, { methodCode: 'pix', amountCents: 3900 }],
    [{ methodCode: 'unknown', amountCents: 6900 }],
  ]
  for (const allocations of cases) {
    const db = new ClientReceivablesDb()
    await assert.rejects(
      registerClientOrdersPayment(db, BUSINESS, 'c1', ['o1', 'o2'], allocations, NOW),
      { status: 400, code: 'VALIDATION_ERROR' },
    )
    assert.deepEqual(counts(db), { receipts: 0, allocations: 0, payments: 0, movements: 0 })
  }
})

test('inactive payment method rejects the complete client batch before financial effects', async () => {
  const db = new ClientReceivablesDb()
  db.sqlite.exec("UPDATE business_payment_methods SET active = 0 WHERE business_id = 'amor-e-sabor' AND code = 'cash'")

  await assert.rejects(
    registerClientOrdersPayment(db, BUSINESS, 'c1', ['o1', 'o2'], split69, NOW),
    { status: 409, code: 'POLICY_CHANGED' },
  )
  assert.deepEqual(counts(db), { receipts: 0, allocations: 0, payments: 0, movements: 0 })
})

test('forced batch failure rolls back receipt allocations payments movements and first-use metadata', async () => {
  const db = new ClientReceivablesDb()
  db.failNextBatch = true

  await assert.rejects(
    registerClientOrdersPayment(db, BUSINESS, 'c1', ['o1', 'o2'], split69, NOW),
    /forced batch failure/,
  )
  assert.deepEqual(counts(db), { receipts: 0, allocations: 0, payments: 0, movements: 0 })
  assert.equal(db.sqlite.prepare("SELECT first_used_at FROM business_payment_methods WHERE business_id = ? AND code = 'cash'").get(BUSINESS).first_used_at, null)
  assert.equal(db.sqlite.prepare("SELECT first_used_at FROM business_payment_methods WHERE business_id = ? AND code = 'pix'").get(BUSINESS).first_used_at, null)
})

test('policy change immediately before commit rolls back the complete client receipt', async () => {
  const db = new ClientReceivablesDb()
  const batch = db.batch.bind(db)
  let raced = false
  db.batch = async (statements) => {
    if (!raced) {
      raced = true
      db.sqlite.exec("UPDATE business_payment_methods SET active = 0 WHERE business_id = 'amor-e-sabor' AND code = 'cash'; UPDATE business_payment_settings SET revision = revision + 1 WHERE business_id = 'amor-e-sabor'")
    }
    return batch(statements)
  }

  await assert.rejects(
    registerClientOrdersPayment(db, BUSINESS, 'c1', ['o1', 'o2'], split69, NOW),
    { status: 409, code: 'POLICY_CHANGED' },
  )
  assert.deepEqual(counts(db), { receipts: 0, allocations: 0, payments: 0, movements: 0 })
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM settings_tx_assertions').get().n, 0)
})

test('selected-order state race leaves only the concurrent external payment and rolls back the client batch', async () => {
  const db = new ClientReceivablesDb()
  const batch = db.batch.bind(db)
  let raced = false
  db.batch = async (statements) => {
    if (!raced) {
      raced = true
      db.markPaid('o1', { receiptId: 'race-receipt', paymentId: 'race-payment', amountCents: 4900 })
    }
    return batch(statements)
  }

  await assert.rejects(
    registerClientOrdersPayment(db, BUSINESS, 'c1', ['o1', 'o2'], pix69, NOW),
    { status: 409, code: 'CLIENT_RECEIVABLES_PAYMENT_CONFLICT' },
  )
  assert.deepEqual(counts(db), { receipts: 1, allocations: 0, payments: 1, movements: 0 })
  assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM payments WHERE order_id = 'o2'").get().n, 0)
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM settings_tx_assertions').get().n, 0)
})


test('refund of one order from a mixed shared receipt stays integral to that order and preserves the original receipt', async () => {
  const db = new ClientReceivablesDb()
  const payment = await registerClientOrdersPayment(db, BUSINESS, 'c1', ['o1', 'o2'], split69, NOW)
  const originalReceipt = db.sqlite.prepare('SELECT id, total_cents FROM payment_receipts WHERE id = ?').get(payment.receipt.id)
  const originalAllocations = db.sqlite.prepare('SELECT method_code, amount_cents FROM payment_allocations WHERE receipt_id = ? ORDER BY method_code').all(payment.receipt.id)

  db.sqlite.prepare("UPDATE orders SET status = 'Cancelado', cancelled_at = ? WHERE id = 'o1' AND business_id = ?")
    .run('2026-09-27T01:00:00.000Z', BUSINESS)

  const result = await registerOrderRefund(
    db,
    BUSINESS,
    'o1',
    { refundMethod: 'Pix' },
    new Date('2026-09-27T01:05:00.000Z'),
  )

  assert.equal(result.order.refundState, 'refunded')
  assert.equal(result.order.paidAmount, 49)
  assert.equal(result.movement.value, 49)
  assert.equal(result.movement.paymentMethod, 'Pix')
  assert.equal(result.movement.paymentId, payment.payments.find((item) => item.orderId === 'o1').id)

  assert.deepEqual(
    db.sqlite.prepare('SELECT id, total_cents FROM payment_receipts WHERE id = ?').get(payment.receipt.id),
    originalReceipt,
  )
  assert.deepEqual(
    db.sqlite.prepare('SELECT method_code, amount_cents FROM payment_allocations WHERE receipt_id = ? ORDER BY method_code').all(payment.receipt.id),
    originalAllocations,
  )
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM payments WHERE receipt_id = ?').get(payment.receipt.id).n, 2)
})


test('client receivables batching stays below the D1 100-bound-parameter ceiling at 24, 25, 30 and 100 orders', async (t) => {
  for (const count of [24, 25, 30, 100]) await t.test(String(count), async () => {
    const db = new D1BindingLimitDb()
    const ids = []
    for (let index = 1; index <= count; index += 1) {
      const id = `d1-${count}-${String(index).padStart(3, '0')}`
      ids.push(id)
      db.insertOrder(id, {
        clientId: 'c1',
        client: 'Fernanda Albuquerque',
        totalCents: 100,
        orderNumber: 1000 + count * 100 + index,
      })
    }

    const result = await registerClientOrdersPayment(
      db,
      BUSINESS,
      'c1',
      ids,
      [{ methodCode: 'pix', amountCents: count * 100 }],
      NOW,
    )

    assert.equal(result.payments.length, count)
    assert.equal(result.orders.length, count)
    assert.equal(result.receipt.totalCents, count * 100)
    assert.ok(db.maxBoundParameters <= 100, `largest statement used ${db.maxBoundParameters} bound parameters`)
  })
})

test('client receivables payment accepts exactly 100 selected orders and creates one integral receipt', async () => {
  const db = new ClientReceivablesDb()
  const ids = []
  for (let index = 1; index <= 100; index += 1) {
    const id = 'bulk-' + String(index).padStart(3, '0')
    ids.push(id)
    db.insertOrder(id, {
      clientId: 'c1',
      client: 'Fernanda Albuquerque',
      totalCents: 100,
      orderNumber: 300 + index,
    })
  }

  const result = await registerClientOrdersPayment(
    db,
    BUSINESS,
    'c1',
    ids,
    [{ methodCode: 'pix', amountCents: 10000 }],
    NOW,
  )

  assert.equal(result.receipt.totalCents, 10000)
  assert.equal(result.payments.length, 100)
  assert.equal(result.orders.length, 100)
  assert.equal(result.allocations.length, 1)
  assert.equal(result.movements.length, 1)
  assert.equal(new Set(result.payments.map((payment) => payment.receiptId)).size, 1)
})

test('selected-order cancellation race rolls back the complete client payment batch', async () => {
  const db = new ClientReceivablesDb()
  const batch = db.batch.bind(db)
  let raced = false
  db.batch = async (statements) => {
    if (!raced) {
      raced = true
      db.sqlite.prepare("UPDATE orders SET status = 'Cancelado', cancelled_at = ? WHERE id = 'o1' AND business_id = ?")
        .run('2026-09-27T01:30:00.000Z', BUSINESS)
    }
    return batch(statements)
  }

  await assert.rejects(
    registerClientOrdersPayment(db, BUSINESS, 'c1', ['o1', 'o2'], pix69, NOW),
    { status: 409, code: 'CLIENT_RECEIVABLES_PAYMENT_CONFLICT' },
  )
  assert.deepEqual(counts(db), { receipts: 0, allocations: 0, payments: 0, movements: 0 })
  assert.equal(db.sqlite.prepare("SELECT status FROM orders WHERE id = 'o1'").get().status, 'Cancelado')
  assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM payments WHERE order_id = 'o2'").get().n, 0)
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM settings_tx_assertions').get().n, 0)
})

test('Task 12 group receipt refuses a stale content revision even with unchanged totals', async () => {
  const db = new ClientReceivablesDb()
  const batch=db.batch.bind(db)
  db.batch=async statements=>{
    db.sqlite.prepare("UPDATE orders SET content_revision=content_revision+1 WHERE id='o2'").run()
    return batch(statements)
  }
  await assert.rejects(registerClientOrdersPayment(db,BUSINESS,'c1',['o1','o2'],pix69,NOW),
    {status:409,code:'CLIENT_RECEIVABLES_PAYMENT_CONFLICT'})
  assert.deepEqual(counts(db),{receipts:0,allocations:0,payments:0,movements:0})
})

test('Task 12 shared client receipt keeps distinct order credits without multiplying revenue', async () => {
  const db=new ClientReceivablesDb()
  const receipt=await registerClientOrdersPayment(db,BUSINESS,'c1',['o1','o2'],split69,NOW)
  const {listOrders}=await import('./orderReadRepository.js')
  const orders=await listOrders(db,BUSINESS)
  const first=orders.find(order=>order.id==='o1')
  const second=orders.find(order=>order.id==='o2')
  assert.equal(first.grossReceivedCents,4900)
  assert.equal(second.grossReceivedCents,2000)
  assert.equal(first.dueCents+second.dueCents,0)
  assert.equal(db.sqlite.prepare('SELECT SUM(value_cents) n FROM movements WHERE receipt_id=?').get(receipt.receipt.id).n,6900)
  assert.equal(db.sqlite.prepare("SELECT count(*) n FROM payments WHERE order_id IN ('o1','o2')").get().n,2)
  assert.equal(db.sqlite.prepare("SELECT count(*) n FROM payment_receipts WHERE id=?").get(receipt.receipt.id).n,1)
})


test('client mixed batch receives one retroactive date across a shared receipt without inflating revenue', async () => {
  const db=new ClientReceivablesDb()
  const result=await registerClientOrdersPayment(db,BUSINESS,'c1',['o1','o2'],split69,NOW,
    {mutationId:'retro-batch',receivedDate:'2026-09-24'})
  assert.equal(result.receipt.receivedDate,'2026-09-24')
  assert.equal(result.receipt.paidAt,ISO)
  assert.equal(result.payments.length,2)
  assert.equal(db.sqlite.prepare('SELECT received_date FROM payment_receipts WHERE id=?').get(result.receipt.id).received_date,'2026-09-24')
  assert.deepEqual(db.sqlite.prepare("SELECT movement_date FROM movements WHERE receipt_id=? AND source='order-payment'").all(result.receipt.id).map(r=>r.movement_date),['2026-09-24','2026-09-24'])
  assert.equal(db.sqlite.prepare('SELECT SUM(value_cents) n FROM movements WHERE receipt_id=?').get(result.receipt.id).n,6900)
  assert.deepEqual(counts(db),{receipts:1,allocations:2,payments:2,movements:2})
  const replay=await registerClientOrdersPayment(db,BUSINESS,'c1',['o1','o2'],split69,new Date(+NOW+86400000),
    {mutationId:'retro-batch',receivedDate:'2026-09-24'})
  assert.equal(replay.receipt.id,result.receipt.id)
  assert.equal(replay.receipt.receivedDate,'2026-09-24')
  await assert.rejects(
    registerClientOrdersPayment(db,BUSINESS,'c1',['o1','o2'],split69,NOW,
      {mutationId:'retro-batch',receivedDate:'2026-09-25'}),
    {status:409,code:'CLIENT_RECEIVABLES_PAYMENT_CONFLICT'})
  assert.deepEqual(counts(db),{receipts:1,allocations:2,payments:2,movements:2})
})

test('client batch excludes invalid future date and preserves old idempotent replays across midnight', async () => {
  const db=new ClientReceivablesDb()
  await assert.rejects(registerClientOrdersPayment(db,BUSINESS,'c1',['o1','o2'],pix69,NOW,
    {mutationId:'reject-future',receivedDate:'2026-09-27'}),
    {status:400,code:'VALIDATION_ERROR',field:'receivedDate'})
  assert.deepEqual(counts(db),{receipts:0,allocations:0,payments:0,movements:0})
  const first=await registerClientOrdersPayment(db,BUSINESS,'c1',['o1','o2'],pix69,NOW,
    {mutationId:'legacy-retry'})
  assert.equal(first.receipt.receivedDate,'2026-09-26')
  const replay=await registerClientOrdersPayment(db,BUSINESS,'c1',['o1','o2'],pix69,new Date(+NOW+86400000),
    {mutationId:'legacy-retry'})
  assert.equal(replay.receipt.id,first.receipt.id)
  assert.equal(replay.receipt.receivedDate,'2026-09-26')
  assert.deepEqual(counts(db),{receipts:1,allocations:1,payments:2,movements:1})
})
