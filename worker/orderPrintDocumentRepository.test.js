import assert from 'node:assert/strict'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { loadOrderPrintDocument } from './orderPrintDocumentRepository.js'

class D1Sqlite {
  constructor() {
    this.sqlite = new DatabaseSync(':memory:')
    this.sqlite.exec(`
      CREATE TABLE businesses (id TEXT PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE business_profiles (
        business_id TEXT PRIMARY KEY,
        phone TEXT NOT NULL DEFAULT '',
        address_line TEXT NOT NULL DEFAULT '',
        logo_object_key TEXT,
        logo_updated_at TEXT
      );
      CREATE TABLE orders (
        id TEXT PRIMARY KEY,
        business_id TEXT NOT NULL,
        order_number INTEGER,
        client_id TEXT,
        client_name_snapshot TEXT NOT NULL,
        client_phone_snapshot TEXT NOT NULL DEFAULT '',
        client_address_snapshot TEXT NOT NULL DEFAULT '',
        customer_identity_type TEXT NOT NULL DEFAULT 'registered_client',
        table_tab_id TEXT,
        type TEXT NOT NULL,
        order_date TEXT NOT NULL,
        scheduled_for TEXT,
        subtotal_cents INTEGER NOT NULL,
        delivery_fee_cents INTEGER NOT NULL DEFAULT 0,
        adjustment_type TEXT NOT NULL DEFAULT 'none',
        adjustment_amount_cents INTEGER NOT NULL DEFAULT 0,
        adjustment_reason TEXT NOT NULL DEFAULT '',
        total_cents INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE order_items (
        id TEXT PRIMARY KEY,
        business_id TEXT NOT NULL,
        order_id TEXT NOT NULL,
        name_snapshot TEXT NOT NULL,
        size_snapshot TEXT NOT NULL DEFAULT '',
        quantity INTEGER NOT NULL,
        unit_price_cents INTEGER NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );
      CREATE TABLE payments (
        id TEXT PRIMARY KEY,
        business_id TEXT NOT NULL,
        order_id TEXT NOT NULL,
        method TEXT NOT NULL,
        paid_at TEXT NOT NULL,
        amount_cents INTEGER NOT NULL DEFAULT 8550
      );
      CREATE TABLE order_settlement_entries (
        id TEXT PRIMARY KEY, business_id TEXT, order_id TEXT, kind TEXT,
        amount_cents INTEGER, receipt_id TEXT, movement_id TEXT
      );
      CREATE TABLE movements (
        id TEXT PRIMARY KEY, business_id TEXT, order_id TEXT, source TEXT, type TEXT,
        value_cents INTEGER, deleted_at TEXT
      );
            CREATE TABLE table_tabs (
        id TEXT PRIMARY KEY,
        business_id TEXT NOT NULL,
        table_identifier TEXT NOT NULL
      );
      CREATE TABLE tables (
        id TEXT PRIMARY KEY,
        business_id TEXT NOT NULL,
        name TEXT NOT NULL
      );
      CREATE TABLE table_reservations (
        id TEXT PRIMARY KEY,
        business_id TEXT NOT NULL,
        order_id TEXT NOT NULL,
        table_id TEXT NOT NULL,
        table_name_snapshot TEXT NOT NULL,
        status TEXT NOT NULL
      );
    `)
  }

  prepare(sql) {
    const database = this.sqlite
    return {
      bind(...values) {
        return {
          async first() { return database.prepare(sql).get(...values) ?? null },
          async all() { return { results: database.prepare(sql).all(...values) } },
          async run() {
            const result = database.prepare(sql).run(...values)
            return { success: true, meta: { changes: Number(result.changes || 0) } }
          },
        }
      },
    }
  }

  exec(sql) { this.sqlite.exec(sql) }
}

const seedOrder = (db) => {
  db.exec(`
    INSERT INTO businesses (id, name) VALUES ('amor-e-sabor', 'Amor & Sabor'), ('other', 'Outro');
    INSERT INTO business_profiles (business_id, phone, address_line, logo_object_key, logo_updated_at)
      VALUES ('amor-e-sabor', 'PROFILE_PHONE_MARKER', 'PROFILE_ADDRESS_MARKER', 'PROFILE_LOGO_KEY_MARKER', '2026-09-24T03:00:00.000Z');
    INSERT INTO orders (
      id, business_id, client_name_snapshot, client_phone_snapshot, client_address_snapshot,
      order_number, type, order_date, subtotal_cents, delivery_fee_cents, adjustment_type,
      adjustment_amount_cents, adjustment_reason, total_cents, created_at
    ) VALUES (
      'o1', 'amor-e-sabor', 'João Silva', '(11) 99876-5432', 'Rua das Flores, 123',
      58, 'Entrega', '2026-09-03', 7950, 800, 'discount', 200, 'fidelidade', 8550,
      '2026-09-03T23:31:00.000Z'
    );
    INSERT INTO order_items (
      id, business_id, order_id, name_snapshot, size_snapshot, quantity, unit_price_cents, note, created_at
    ) VALUES
      ('i1', 'amor-e-sabor', 'o1', 'X-BURGER', '', 2, 3000, 'sem cebola', '2026-09-03T23:31:00.000Z'),
      ('i2', 'amor-e-sabor', 'o1', 'BATATA', 'G', 1, 1950, '', '2026-09-03T23:31:01.000Z');
    INSERT INTO payments (id, business_id, order_id, method, paid_at)
      VALUES ('p1', 'amor-e-sabor', 'o1', 'Pix', '2026-09-03T23:32:00.000Z');

    INSERT INTO table_tabs (id, business_id, table_identifier) VALUES ('tab-4', 'amor-e-sabor', 'Mesa 4');
    INSERT INTO orders (
      id, business_id, client_id, client_name_snapshot, client_phone_snapshot, client_address_snapshot, customer_identity_type, table_tab_id,
      order_number, type, order_date, subtotal_cents, delivery_fee_cents, adjustment_type,
      adjustment_amount_cents, adjustment_reason, total_cents, created_at
    ) VALUES (
      'local-with-client', 'amor-e-sabor', 'client-4', 'Hugo', '', '', 'table', 'tab-4',
      59, 'Local', '2026-09-03', 3200, 0, 'none', 0, '', 3200,
      '2026-09-03T20:00:00.000Z'
    );

    INSERT INTO orders (
      id, business_id, client_name_snapshot, client_phone_snapshot, client_address_snapshot,
      order_number, type, order_date, subtotal_cents, delivery_fee_cents, adjustment_type,
      adjustment_amount_cents, adjustment_reason, total_cents, created_at
    ) VALUES (
      'legacy', 'amor-e-sabor', 'Mesa A-01', '', '',
      60, 'Local', '2026-09-03', 3200, 0, 'none', 0, '', 3200,
      '2026-09-03T20:00:00.000Z'
    );
    INSERT INTO order_items (
      id, business_id, order_id, name_snapshot, size_snapshot, quantity, unit_price_cents, note, created_at
    ) VALUES ('legacy-i1', 'amor-e-sabor', 'legacy', 'Marmita', 'G', 1, 3200, '', '2026-09-03T20:00:00.000Z');
  `)
}

test('current order print document is rebuilt from immutable order/item snapshots and raw integer cents', async () => {
  const db = new D1Sqlite()
  seedOrder(db)

  const document = await loadOrderPrintDocument(db, 'amor-e-sabor', 'o1')

  assert.equal(document.business.name, 'Amor & Sabor')
  assert.equal(document.order.id, 'o1')
  assert.equal(document.order.number, '58')
  assert.equal(document.customer.name, 'João Silva')
  assert.equal(document.customer.phone, '(11) 99876-5432')
  assert.equal(document.customer.address, 'Rua das Flores, 123')
  assert.equal(document.items.length, 2)
  assert.equal(document.items[0].name, 'X-BURGER')
  assert.equal(document.items[0].note, 'sem cebola')
  assert.equal(document.items[0].unitPriceCents, 3000)
  assert.equal(document.items[1].presentation, 'G')
  assert.equal(document.financial.subtotalCents, 7950)
  assert.equal(document.financial.deliveryFeeCents, 800)
  assert.deepEqual(document.financial.adjustment, {
    type: 'discount', amountCents: 200, reason: 'fidelidade',
  })
  assert.equal(document.financial.totalCents, 8550)
  assert.deepEqual(document.payment, { status: 'Pago', method: 'Pix' })
})

test('legacy-compatible blank contact snapshots stay blank and unpaid order stays pending', async () => {
  const db = new D1Sqlite()
  seedOrder(db)

  const document = await loadOrderPrintDocument(db, 'amor-e-sabor', 'legacy')

  assert.deepEqual(document.customer, { name: 'Mesa A-01', phone: '', address: '' })
  assert.deepEqual(document.payment, { status: 'Pendente', method: '' })
  assert.equal(document.financial.deliveryFeeCents, 0)
})

test('local ticket identity comes from the immutable table tab snapshot after a table rename', async () => {
  const db = new D1Sqlite()
  seedOrder(db)

  const document = await loadOrderPrintDocument(db, 'amor-e-sabor', 'local-with-client')

  assert.equal(document.customer.name, 'Mesa 4 · Hugo')
})

test('order print document lookup is business scoped and missing orders return null', async () => {
  const db = new D1Sqlite()
  seedOrder(db)

  assert.equal(await loadOrderPrintDocument(db, 'other', 'o1'), null)
  assert.equal(await loadOrderPrintDocument(db, 'amor-e-sabor', 'missing'), null)
})


test('newly generated print documents use the current business name while excluding profile contact and logo metadata', async () => {
  const db = new D1Sqlite()
  seedOrder(db)

  const beforeRename = await loadOrderPrintDocument(db, 'amor-e-sabor', 'o1')
  db.sqlite.prepare('UPDATE businesses SET name = ? WHERE id = ?').run('Amor & Sabor Renomeado', 'amor-e-sabor')
  const afterRename = await loadOrderPrintDocument(db, 'amor-e-sabor', 'o1')

  assert.equal(beforeRename.business.name, 'Amor & Sabor')
  assert.equal(afterRename.business.name, 'Amor & Sabor Renomeado')
  assert.deepEqual(beforeRename.business, { name: 'Amor & Sabor' })
  assert.deepEqual(afterRename.business, { name: 'Amor & Sabor Renomeado' })

  const serialized = JSON.stringify(afterRename)
  assert.doesNotMatch(serialized, /PROFILE_PHONE_MARKER|PROFILE_ADDRESS_MARKER|PROFILE_LOGO_KEY_MARKER/)
})


test('manual print document rebuild preserves scheduled delivery and reservation service time', async () => {
  const db = new D1Sqlite()
  seedOrder(db)
  db.exec(`
    INSERT INTO tables (id, business_id, name)
      VALUES ('table-reserved', 'amor-e-sabor', 'Mesa 8');
    INSERT INTO orders (
      id, business_id, client_id, client_name_snapshot, client_phone_snapshot, client_address_snapshot,
      customer_identity_type, table_tab_id, order_number, type, order_date, scheduled_for,
      subtotal_cents, delivery_fee_cents, adjustment_type, adjustment_amount_cents,
      adjustment_reason, total_cents, created_at
    ) VALUES
      ('scheduled-delivery', 'amor-e-sabor', NULL, 'Ana', '', '', 'registered_client', NULL, 61,
       'Entrega', '2026-09-04', '2026-09-04T15:00:00.000Z',
       2500, 0, 'none', 0, '', 2500, '2026-09-03T12:00:00.000Z'),
      ('reserved-local', 'amor-e-sabor', 'client-hugo', 'Hugo', '', '', 'table', NULL, 62,
       'Local', '2026-09-04', '2026-09-04T23:00:00.000Z',
       3200, 0, 'none', 0, '', 3200, '2026-09-03T12:00:00.000Z');
    INSERT INTO table_reservations (
      id, business_id, order_id, table_id, table_name_snapshot, status
    ) VALUES (
      'reservation-local', 'amor-e-sabor', 'reserved-local', 'table-reserved', 'Mesa 8', 'reserved'
    );
    INSERT INTO order_items (
      id, business_id, order_id, name_snapshot, size_snapshot, quantity, unit_price_cents, note, created_at
    ) VALUES
      ('scheduled-item', 'amor-e-sabor', 'scheduled-delivery', 'Prato', '', 1, 2500, '', '2026-09-03T12:00:00.000Z'),
      ('reserved-item', 'amor-e-sabor', 'reserved-local', 'Marmita', 'G', 1, 3200, '', '2026-09-03T12:00:00.000Z');
  `)

  const scheduled = await loadOrderPrintDocument(db, 'amor-e-sabor', 'scheduled-delivery')
  const reservation = await loadOrderPrintDocument(db, 'amor-e-sabor', 'reserved-local')

  assert.equal(scheduled.order.scheduledFor, '2026-09-04T15:00:00.000Z')
  assert.equal(scheduled.order.scheduleLabel, 'AGENDADO')
  assert.equal(reservation.order.scheduledFor, '2026-09-04T23:00:00.000Z')
  assert.equal(reservation.order.scheduleLabel, 'RESERVA')
  assert.equal(reservation.customer.name, 'Mesa 8 · Hugo')
})
