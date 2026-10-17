import assert from 'node:assert/strict'
import test from 'node:test'
import { OperationalDb } from './test-support/operationalDb.js'
import { createOrder } from './repositories.js'

const seed = ({ auto = true, primary = true, centralCopies = 2 } = {}) => {
  const db = new OperationalDb()
  db.exec(`
    INSERT INTO clients (id, business_id, name, phone, address, created_at, updated_at)
      VALUES ('c1', 'amor-e-sabor', 'Maria', '11998765432', 'Rua das Flores, 123', '2026-09-03T20:00:00.000Z', '2026-09-03T20:00:00.000Z');
    INSERT INTO products (
      id, business_id, category, size, presentation_type, presentation_value, presentation_unit, name, price_cents, active, created_at, updated_at
    ) VALUES
      ('p1', 'amor-e-sabor', 'Lanches', '', 'size', 'G', '', 'X-BURGER', 3000, 1, '2026-09-03T20:00:00.000Z', '2026-09-03T20:00:00.000Z'),
      ('p2', 'amor-e-sabor', 'Bebidas', '350ml', 'volume', '350', 'ml', 'Coca-Cola', 800, 1, '2026-09-03T20:00:00.000Z', '2026-09-03T20:00:00.000Z');
    INSERT INTO print_stations (
      id, business_id, name, platform, is_primary, auto_print_enabled, default_copies, created_at, updated_at
    ) VALUES ('station-a', 'amor-e-sabor', 'Tablet da cozinha', 'android', ${primary ? 1 : 0}, ${auto ? 1 : 0}, 2,
      '2026-09-03T20:00:00.000Z', '2026-09-03T20:00:00.000Z');
    UPDATE business_print_settings SET default_copies = ${centralCopies} WHERE business_id = 'amor-e-sabor';
    INSERT INTO tables (id, business_id, name, name_key, sort_order, is_active, created_at, updated_at)
      VALUES ('table-1', 'amor-e-sabor', 'Mesa 1', 'MESA 1', 1, 1,
        '2026-09-03T20:00:00.000Z', '2026-09-03T20:00:00.000Z');
  `)
  return db
}

const input = (overrides = {}) => ({
  customerIdentity: { type: 'registered_client', clientId: 'c1' },
  type: 'Entrega',
  orderDate: '2026-09-03',
  idempotencyKey: 'print-checkout-1',
  items: [
    { productId: 'p1', quantity: 2, note: 'sem cebola' },
    { productId: 'p2', quantity: 1, note: '' },
  ],
  deliveryFeeCents: 800,
  adjustment: { type: 'none', mode: 'fixed', storedValue: 0, reason: '' },
  paymentAllocations: [{ methodCode: 'pix', amountCents: 7600 }],
  ...overrides,
})

const seedTableSeven = (db) => {
  db.exec(`
    INSERT INTO clients (id, business_id, name, phone, address, created_at, updated_at)
      VALUES ('c2', 'amor-e-sabor', 'Joao', '', '', '2026-09-03T20:00:00.000Z', '2026-09-03T20:00:00.000Z');
    INSERT INTO tables (id, business_id, name, name_key, sort_order, is_active, created_at, updated_at)
      VALUES ('table-7', 'amor-e-sabor', 'Mesa 7', 'MESA 7', 7, 1,
        '2026-09-03T20:00:00.000Z', '2026-09-03T20:00:00.000Z');
  `)
}

const automaticSnapshotCustomerName = async (overrides = {}) => {
  const db = seed()
  seedTableSeven(db)
  const order = await createOrder(db, 'amor-e-sabor', input({
    paymentAllocations: null,
    ...overrides,
  }), new Date('2026-09-03T23:31:00.000Z'))
  const job = db.all(`SELECT snapshot_json FROM print_jobs WHERE order_id = '${order.id}'`)[0]
  return JSON.parse(job.snapshot_json).customer.name
}

test('current checkout snapshots customer contact and enqueues one paid automatic print job atomically', async () => {
  const db = seed()
  const now = new Date('2026-09-03T23:31:00.000Z')
  const order = await createOrder(db, 'amor-e-sabor', input(), now)

  assert.equal(order.clientPhone, '(11) 99876-5432')
  assert.equal(order.clientAddress, 'Rua das Flores, 123')
  const jobs = db.all(`SELECT * FROM print_jobs`)
  assert.equal(jobs.length, 1)
  assert.equal(jobs[0].order_id, order.id)
  assert.equal(jobs[0].trigger, 'automatic')
  assert.equal(jobs[0].status, 'pending')
  assert.equal(jobs[0].station_id, null)
  assert.equal(jobs[0].copies_requested, 2)
  const snapshot = JSON.parse(jobs[0].snapshot_json)
  assert.equal(snapshot.customer.phone, '(11) 99876-5432')
  assert.equal(snapshot.customer.address, 'Rua das Flores, 123')
  assert.equal(snapshot.items[0].note, 'sem cebola')
  assert.deepEqual(snapshot.payment, { status: 'Pago', method: 'Pix' })
})

test('automatic local print snapshot preserves table and optional customer identity', async () => {
  assert.equal(await automaticSnapshotCustomerName({
    customerIdentity: { type: 'table', tableId: 'table-7', clientId: 'c2' },
    type: 'Local',
    idempotencyKey: 'auto-table-with-client',
  }), 'Mesa 7 · Joao')
})

test('second and third orders on a named comanda retain its customer identity', async () => {
  const db = seed()
  seedTableSeven(db)
  const now = new Date('2026-09-03T23:31:00.000Z')
  const add = (key, customerIdentity, expectedTableTabId) => createOrder(db, 'amor-e-sabor', input({
    customerIdentity, type: 'Local', paymentAllocations: null, idempotencyKey: key, expectedTableTabId,
  }), now)

  const first = await add('named-comanda-1', { type: 'table', tableId: 'table-7', clientId: 'c2' })
  for (const number of [2, 3]) {
    const order = await add(`named-comanda-${number}`, { type: 'table', tableId: 'table-7' }, first.tableTabId)
    assert.equal(order.client, 'Mesa 7 · Joao')
    assert.equal(order.clientId, 'c2')
    const job = db.all(`SELECT snapshot_json FROM print_jobs WHERE order_id = '${order.id}'`)[0]
    assert.equal(JSON.parse(job.snapshot_json).customer.name, 'Mesa 7 · Joao')
  }

  const explicit = await add('named-comanda-4', { type: 'table', tableId: 'table-7', clientId: 'c1' }, first.tableTabId)
  assert.equal(explicit.client, 'Mesa 7 · Maria')
  const otherTable = await add('other-table-1', { type: 'table', tableId: 'table-1' })
  assert.equal(otherTable.client, 'Mesa 1')
})

test('automatic local print snapshot preserves a table without a customer', async () => {
  assert.equal(await automaticSnapshotCustomerName({
    customerIdentity: { type: 'table', tableId: 'table-7' },
    type: 'Local',
    idempotencyKey: 'auto-table-without-client',
  }), 'Mesa 7')
})

test('automatic delivery print snapshot preserves the customer without a table', async () => {
  assert.equal(await automaticSnapshotCustomerName({
    customerIdentity: { type: 'registered_client', clientId: 'c2' },
    type: 'Entrega',
    idempotencyKey: 'auto-delivery-with-client',
  }), 'Joao')
})

test('automatic local print snapshot does not duplicate the table identity', async () => {
  assert.equal(await automaticSnapshotCustomerName({
    customerIdentity: { type: 'table', tableId: 'table-7' },
    type: 'Local',
    idempotencyKey: 'auto-table-no-duplicate',
  }), 'Mesa 7')
})

test('table checkout requests one automatic copy when the central default is two', async () => {
  const db = seed({ centralCopies: 2 })

  const order = await createOrder(db, 'amor-e-sabor', input({
    customerIdentity: { type: 'table', tableId: 'table-1' },
    type: 'Local',
    paymentAllocations: null,
    idempotencyKey: 'table-one-copy',
  }), new Date('2026-09-03T23:31:00.000Z'))

  const job = db.all(`SELECT copies_requested FROM print_jobs WHERE order_id = '${order.id}'`)[0]
  assert.equal(job.copies_requested, 1)
})

test('delivery checkout snapshots the central default of one or two copies', async () => {
  const oneCopyDb = seed({ centralCopies: 1 })
  const oneCopyOrder = await createOrder(oneCopyDb, 'amor-e-sabor', input({
    idempotencyKey: 'delivery-one-copy',
  }), new Date('2026-09-03T23:31:00.000Z'))
  assert.equal(oneCopyDb.all(`SELECT copies_requested FROM print_jobs WHERE order_id = '${oneCopyOrder.id}'`)[0].copies_requested, 1)

  const twoCopyDb = seed({ centralCopies: 2 })
  const twoCopyOrder = await createOrder(twoCopyDb, 'amor-e-sabor', input({
    idempotencyKey: 'delivery-two-copies',
  }), new Date('2026-09-03T23:31:00.000Z'))
  assert.equal(twoCopyDb.all(`SELECT copies_requested FROM print_jobs WHERE order_id = '${twoCopyOrder.id}'`)[0].copies_requested, 2)
})

test('pickup checkout snapshots the central default of one or two copies', async () => {
  const oneCopyDb = seed({ centralCopies: 1 })
  const oneCopyOrder = await createOrder(oneCopyDb, 'amor-e-sabor', input({
    type: 'Retirada',
    idempotencyKey: 'pickup-one-copy',
  }), new Date('2026-09-03T23:31:00.000Z'))
  assert.equal(oneCopyDb.all(`SELECT copies_requested FROM print_jobs WHERE order_id = '${oneCopyOrder.id}'`)[0].copies_requested, 1)

  const twoCopyDb = seed({ centralCopies: 2 })
  const twoCopyOrder = await createOrder(twoCopyDb, 'amor-e-sabor', input({
    type: 'Retirada',
    idempotencyKey: 'pickup-two-copies',
  }), new Date('2026-09-03T23:31:00.000Z'))
  assert.equal(twoCopyDb.all(`SELECT copies_requested FROM print_jobs WHERE order_id = '${twoCopyOrder.id}'`)[0].copies_requested, 2)
})

test('changing the central default does not rewrite an existing automatic job copy snapshot', async () => {
  const db = seed({ centralCopies: 1 })
  const order = await createOrder(db, 'amor-e-sabor', input({
    idempotencyKey: 'immutable-copy-snapshot',
  }), new Date('2026-09-03T23:31:00.000Z'))

  db.exec(`UPDATE business_print_settings SET default_copies = 2 WHERE business_id = 'amor-e-sabor'`)

  const job = db.all(`SELECT copies_requested FROM print_jobs WHERE order_id = '${order.id}'`)[0]
  assert.equal(job.copies_requested, 1)
})

test('new scheduled order is printable immediately while keeping its scheduled time', async () => {
  const db = seed()
  const now = new Date('2026-09-03T12:00:00.000Z')
  const scheduledFor = '2026-09-03T16:00:00.000Z'

  const order = await createOrder(db, 'amor-e-sabor', input({
    idempotencyKey: 'scheduled-immediate-print',
    scheduledFor,
  }), now)

  const jobs = db.all(`SELECT created_at, available_at FROM print_jobs WHERE order_id = '${order.id}'`)
  assert.equal(jobs.length, 1)
  assert.equal(jobs[0].created_at, now.toISOString())
  assert.equal(jobs[0].available_at, now.toISOString())
  assert.equal(order.scheduledFor, scheduledFor)
})

test('same-day scheduled delivery and pickup remain printable immediately', async () => {
  for (const type of ['Entrega', 'Retirada']) {
    const db = seed()
    const now = new Date('2026-09-03T12:00:00.000Z')
    const scheduledFor = '2026-09-03T16:00:00.000Z'
    const order = await createOrder(db, 'amor-e-sabor', input({
      type,
      idempotencyKey: `same-day-${type}`,
      scheduledFor,
    }), now)

    const job = db.all(`SELECT created_at, available_at FROM print_jobs WHERE order_id = '${order.id}'`)[0]
    assert.equal(job.created_at, now.toISOString())
    assert.equal(job.available_at, now.toISOString())
  }
})

test('next-day delivery and pickup automatic jobs wait for operationalStartAt', async () => {
  for (const type of ['Entrega', 'Retirada']) {
    const db = seed()
    const now = new Date('2026-09-03T12:00:00.000Z')
    const scheduledFor = '2026-09-04T15:00:00.000Z'
    const order = await createOrder(db, 'amor-e-sabor', input({
      type,
      orderDate: '2026-09-04',
      idempotencyKey: `next-day-${type}`,
      scheduledFor,
    }), now)

    const job = db.all(`SELECT created_at, available_at FROM print_jobs WHERE order_id = '${order.id}'`)[0]
    assert.equal(job.created_at, now.toISOString())
    assert.equal(job.available_at, '2026-09-04T14:10:00.000Z')
  }
})

test('Local reservation automatic job waits for operationalStartAt even on the same day', async () => {
  const db = seed()
  const now = new Date('2026-09-03T12:00:00.000Z')
  const scheduledFor = '2026-09-03T16:00:00.000Z'
  const order = await createOrder(db, 'amor-e-sabor', input({
    customerIdentity: { type: 'table', tableId: 'table-1', clientId: 'c1' },
    type: 'Local',
    paymentAllocations: null,
    idempotencyKey: 'same-day-local-reservation',
    scheduledFor,
  }), now)

  const job = db.all(`SELECT created_at, available_at, copies_requested, snapshot_json
    FROM print_jobs WHERE order_id = '${order.id}'`)[0]
  assert.equal(job.created_at, now.toISOString())
  assert.equal(job.available_at, '2026-09-03T15:10:00.000Z')
  const snapshot = JSON.parse(job.snapshot_json)
  assert.equal(snapshot.order.scheduledFor, scheduledFor)
  assert.equal(snapshot.order.scheduleLabel, 'RESERVA')
  assert.equal(snapshot.customer.name, 'Mesa 1 · Maria')
})

test('Local reservation copy count uses the table printing default without a table tab', async () => {
  const db = seed({ centralCopies: 1 })
  db.exec(`UPDATE business_print_settings
    SET default_copies = 1, table_tab_default_copies = 2
    WHERE business_id = 'amor-e-sabor'`)
  const order = await createOrder(db, 'amor-e-sabor', input({
    customerIdentity: { type: 'table', tableId: 'table-1' },
    type: 'Local',
    paymentAllocations: null,
    idempotencyKey: 'reservation-table-copy-default',
    scheduledFor: '2026-09-03T16:00:00.000Z',
  }), new Date('2026-09-03T12:00:00.000Z'))

  const job = db.all(`SELECT copies_requested FROM print_jobs WHERE order_id = '${order.id}'`)[0]
  assert.equal(job.copies_requested, 2)
})

test('future scheduled delivery snapshot identifies the requested service time as AGENDADO', async () => {
  const db = seed()
  const scheduledFor = '2026-09-04T15:00:00.000Z'
  const order = await createOrder(db, 'amor-e-sabor', input({
    orderDate: '2026-09-04',
    idempotencyKey: 'future-scheduled-document',
    scheduledFor,
  }), new Date('2026-09-03T12:00:00.000Z'))

  const job = db.all(`SELECT snapshot_json FROM print_jobs WHERE order_id = '${order.id}'`)[0]
  const snapshot = JSON.parse(job.snapshot_json)
  assert.equal(snapshot.order.scheduledFor, scheduledFor)
  assert.equal(snapshot.order.scheduleLabel, 'AGENDADO')
})

test('checkout retry with the same idempotency key keeps one order and one automatic print job', async () => {
  const db = seed()
  const first = await createOrder(db, 'amor-e-sabor', input(), new Date('2026-09-03T23:31:00.000Z'))
  const second = await createOrder(db, 'amor-e-sabor', input(), new Date('2026-09-03T23:32:00.000Z'))

  assert.equal(first.id, second.id)
  assert.equal(db.all(`SELECT * FROM orders`).length, 1)
  assert.equal(db.all(`SELECT * FROM print_jobs`).length, 1)
})

test('eligible checkout creates one unassigned automatic job without a ready primary station', async () => {
  const disabled = seed({ auto: false })
  const disabledInput = input({ idempotencyKey: 'disabled' })
  await createOrder(disabled, 'amor-e-sabor', disabledInput, new Date('2026-09-03T23:31:00.000Z'))
  await createOrder(disabled, 'amor-e-sabor', disabledInput, new Date('2026-09-03T23:32:00.000Z'))
  assert.equal(disabled.all(`SELECT * FROM print_jobs`).length, 1)
  assert.equal(disabled.all(`SELECT * FROM print_jobs`)[0].station_id, null)
  disabled.exec(`UPDATE print_stations SET auto_print_enabled = 1 WHERE id = 'station-a'`)
  assert.equal(disabled.all(`SELECT * FROM print_jobs`).length, 1)

  const secondaryOnly = seed({ primary: false })
  await createOrder(secondaryOnly, 'amor-e-sabor', input({ idempotencyKey: 'secondary' }), new Date('2026-09-03T23:31:00.000Z'))
  assert.equal(secondaryOnly.all(`SELECT * FROM print_jobs`).length, 1)
  assert.equal(secondaryOnly.all(`SELECT * FROM print_jobs`)[0].station_id, null)

  const offline = seed()
  assert.equal(offline.all(`SELECT last_seen_at FROM print_stations`)[0].last_seen_at, null)
  await createOrder(offline, 'amor-e-sabor', input({ idempotencyKey: 'offline' }), new Date('2026-09-03T23:31:00.000Z'))
  assert.equal(offline.all(`SELECT * FROM print_jobs`).length, 1)
  assert.equal(offline.all(`SELECT * FROM print_jobs`)[0].station_id, null)

  const noStation = seed()
  noStation.exec(`DELETE FROM print_stations`)
  const noStationInput = input({ idempotencyKey: 'no-station' })
  await createOrder(noStation, 'amor-e-sabor', noStationInput, new Date('2026-09-03T23:31:00.000Z'))
  await createOrder(noStation, 'amor-e-sabor', noStationInput, new Date('2026-09-03T23:32:00.000Z'))
  assert.equal(noStation.all(`SELECT * FROM orders`).length, 1)
  assert.equal(noStation.all(`SELECT * FROM print_jobs`).length, 1)
  assert.equal(noStation.all(`SELECT * FROM print_jobs`)[0].station_id, null)
})

test('historical/backdated orders never enqueue automatic kitchen printing', async () => {
  const db = seed()
  const order = await createOrder(db, 'amor-e-sabor', input({ orderDate: '2026-09-02', idempotencyKey: 'historical' }), new Date('2026-09-03T23:31:00.000Z'))
  assert.equal(order.status, 'Finalizado')
  assert.equal(db.all(`SELECT * FROM print_jobs`).length, 0)
})
