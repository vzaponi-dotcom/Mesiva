import { installAuditSchema } from './test-support/auditSchema.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import * as tableRepository from './tableRepository.js'

const {
  createTable,
  getOrCreateOpenTableTabByTableId,
  listTables,
  loadTableById,
  normalizeTableName,
  renameTable,
  reorderTables,
  setTableActive,
  transferOpenTableTab,
} = tableRepository

class D1Sqlite {
  constructor() {
    this.beforeTransferRun = null
    this.sqlite = new DatabaseSync(':memory:')
    this.sqlite.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE businesses (id TEXT PRIMARY KEY);
      CREATE TABLE tables (
        id TEXT PRIMARY KEY,
        business_id TEXT NOT NULL REFERENCES businesses(id),
        name TEXT NOT NULL,
        name_key TEXT NOT NULL,
        sort_order INTEGER NOT NULL,
        is_active INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_tables_business_name_key ON tables (business_id, name_key);
      CREATE TABLE table_tabs (
        id TEXT PRIMARY KEY,
        business_id TEXT NOT NULL,
        table_id TEXT REFERENCES tables(id),
        table_identifier TEXT NOT NULL,
        tab_number INTEGER,
        status TEXT NOT NULL,
        opened_at TEXT NOT NULL,
        closed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_table_tabs_one_open_per_table_id
        ON table_tabs (business_id, table_id) WHERE status = 'open';
      CREATE UNIQUE INDEX idx_table_tabs_business_number
        ON table_tabs (business_id, tab_number);
      CREATE TABLE table_tab_counters (
        business_id TEXT PRIMARY KEY REFERENCES businesses(id),
        last_number INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE orders (
        id TEXT PRIMARY KEY,
        business_id TEXT NOT NULL,
        order_number INTEGER,
        client_id TEXT,
        client_name_snapshot TEXT NOT NULL DEFAULT '',
        table_tab_id TEXT REFERENCES table_tabs(id),
        status TEXT NOT NULL,
        total_cents INTEGER NOT NULL,
        scheduled_for TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE table_reservations (
        id TEXT PRIMARY KEY,
        business_id TEXT NOT NULL,
        order_id TEXT NOT NULL,
        table_id TEXT NOT NULL,
        table_name_snapshot TEXT NOT NULL,
        status TEXT NOT NULL,
        scheduled_for TEXT NOT NULL,
        ends_at TEXT NOT NULL,
        duration_minutes INTEGER NOT NULL,
        revision INTEGER NOT NULL,
        converted_table_tab_id TEXT,
        converted_at TEXT,
        cancelled_at TEXT,
        no_show_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE payments (id TEXT PRIMARY KEY, business_id TEXT NOT NULL, order_id TEXT NOT NULL);
      CREATE TABLE order_items (id TEXT PRIMARY KEY, business_id TEXT NOT NULL, order_id TEXT NOT NULL, quantity INTEGER NOT NULL);
      INSERT INTO businesses (id) VALUES ('biz-a'), ('biz-b');
    `)
    installAuditSchema(this.sqlite)
  }

  prepare(sql) {
    const database = this.sqlite
    const adapter = this
    return {
      bind(...values) {
        return {
          async first() {
            return database.prepare(sql).get(...values) ?? null
          },
          async all() {
            return { results: database.prepare(sql).all(...values) }
          },
          run() {
            if (sql.includes('UPDATE table_tabs') && sql.includes('SET table_id =') && adapter.beforeTransferRun) {
              const beforeTransferRun = adapter.beforeTransferRun
              adapter.beforeTransferRun = null
              beforeTransferRun()
            }
            const result = database.prepare(sql).run(...values)
            return { success: true, meta: { changes: Number(result.changes || 0) } }
          },
        }
      },
    }
  }

  async batch(statements) {
    this.sqlite.exec('BEGIN')
    try {
      const results = []
      for (const statement of statements) results.push(statement.run())
      this.sqlite.exec('COMMIT')
      return results
    } catch (error) {
      this.sqlite.exec('ROLLBACK')
      throw error
    }
  }

  exec(sql) {
    this.sqlite.exec(sql)
  }
}

const now = new Date('2026-09-07T15:00:00.000Z')

const insertTable = (db, { id, businessId = 'biz-a', name, nameKey = name.toUpperCase(), sortOrder, isActive = 1 }) => {
  db.sqlite.prepare(`INSERT INTO tables (
    id, business_id, name, name_key, sort_order, is_active, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id,
    businessId,
    name,
    nameKey,
    sortOrder,
    isActive,
    now.toISOString(),
    now.toISOString(),
  )
}

const insertOpenTableTab = (db, { id, tableId, businessId = 'biz-a', tableIdentifier, tabNumber = 37 }) => {
  db.sqlite.prepare(`INSERT INTO table_tabs (
    id, business_id, table_id, table_identifier, tab_number, status, opened_at, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?)`).run(
    id,
    businessId,
    tableId,
    tableIdentifier,
    tabNumber,
    now.toISOString(),
    now.toISOString(),
    now.toISOString(),
  )
}

test('normalizeTableName collapses spaces, builds a case-insensitive key, and enforces its limit', () => {
  assert.deepEqual(normalizeTableName('  Mesa   8  '), { name: 'Mesa 8', nameKey: 'MESA 8' })
  assert.throws(() => normalizeTableName('   '), (error) => error.status === 400 && error.code === 'VALIDATION_ERROR')
  assert.deepEqual(normalizeTableName('x'.repeat(60)), { name: 'x'.repeat(60), nameKey: 'X'.repeat(60) })
  assert.throws(() => normalizeTableName('x'.repeat(61)), (error) => error.status === 400 && error.code === 'VALIDATION_ERROR')
})

test('listTables returns the official pending summary for an occupied table tab', async () => {
  const db = new D1Sqlite()
  insertTable(db, { id: 'second', name: 'Mesa 2', sortOrder: 2, isActive: 0 })
  insertTable(db, { id: 'first', name: 'Mesa 1', sortOrder: 1 })
  db.exec(`INSERT INTO table_tabs (
    id, business_id, table_id, table_identifier, tab_number, status, opened_at, created_at, updated_at
  ) VALUES ('tab-1', 'biz-a', 'first', 'Mesa 1', 1042, 'open', '${now.toISOString()}', '${now.toISOString()}', '${now.toISOString()}');
  INSERT INTO orders (id, business_id, table_tab_id, status, total_cents, created_at) VALUES
    ('pending-1', 'biz-a', 'tab-1', 'Em preparo', 3600, '${now.toISOString()}'),
    ('pending-2', 'biz-a', 'tab-1', 'Finalizado', 5000, '${now.toISOString()}'),
    ('paid', 'biz-a', 'tab-1', 'Em preparo', 2000, '${now.toISOString()}'),
    ('cancelled', 'biz-a', 'tab-1', 'Cancelado', 700, '${now.toISOString()}');
  INSERT INTO payments (id, business_id, order_id) VALUES ('payment-1', 'biz-a', 'paid');
  INSERT INTO order_items (id, business_id, order_id, quantity) VALUES
    ('item-1', 'biz-a', 'pending-1', 2),
    ('item-2', 'biz-a', 'pending-2', 4),
    ('item-paid', 'biz-a', 'paid', 9),
    ('item-cancelled', 'biz-a', 'cancelled', 7);`)

  assert.deepEqual(await listTables(db, 'biz-a'), [
    {
      id: 'first', name: 'Mesa 1', sortOrder: 1, isActive: true, occupancy: 'occupied', openTableTabId: 'tab-1',
      openTableTab: { id: 'tab-1', number: 1042, openedAt: now.toISOString(), orderCount: 2, itemCount: 6, totalCents: 8600 },
      nextReservation: null,
    },
    { id: 'second', name: 'Mesa 2', sortOrder: 2, isActive: false, occupancy: 'free', openTableTabId: null, openTableTab: null, nextReservation: null },
  ])
})

test('listTables exposes the next reservation without changing current occupancy', async () => {
  const db = new D1Sqlite()
  insertTable(db, { id: 'free', name: 'Mesa 1', sortOrder: 1 })
  insertTable(db, { id: 'occupied', name: 'Mesa 2', sortOrder: 2 })
  insertOpenTableTab(db, { id: 'tab-occupied', tableId: 'occupied', tableIdentifier: 'Mesa 2', tabNumber: 50 })

  db.exec(`INSERT INTO orders (
    id, business_id, order_number, client_id, client_name_snapshot, table_tab_id, status, total_cents, scheduled_for, created_at
  ) VALUES
    ('reserve-free', 'biz-a', 100, 'client-free', 'João', NULL, 'Em preparo', 3300, '2026-09-10T23:00:00.000Z', '${now.toISOString()}'),
    ('reserve-later', 'biz-a', 101, NULL, 'Mesa 1', NULL, 'Em preparo', 1800, '2026-09-11T23:00:00.000Z', '${now.toISOString()}'),
    ('reserve-occupied', 'biz-a', 102, NULL, 'Mesa 2', NULL, 'Em preparo', 2500, '2026-09-10T22:00:00.000Z', '${now.toISOString()}');
  INSERT INTO order_items (id, business_id, order_id, quantity) VALUES
    ('reserve-free-item', 'biz-a', 'reserve-free', 3),
    ('reserve-later-item', 'biz-a', 'reserve-later', 1),
    ('reserve-occupied-item', 'biz-a', 'reserve-occupied', 2);
  INSERT INTO table_reservations (
    id, business_id, order_id, table_id, table_name_snapshot, status, scheduled_for, ends_at,
    duration_minutes, revision, created_at, updated_at
  ) VALUES
    ('reservation-free', 'biz-a', 'reserve-free', 'free', 'Mesa 1', 'reserved',
      '2026-09-10T23:00:00.000Z', '2026-09-11T01:00:00.000Z', 120, 2, '${now.toISOString()}', '${now.toISOString()}'),
    ('reservation-later', 'biz-a', 'reserve-later', 'free', 'Mesa 1', 'reserved',
      '2026-09-11T23:00:00.000Z', '2026-09-12T01:00:00.000Z', 120, 1, '${now.toISOString()}', '${now.toISOString()}'),
    ('reservation-occupied', 'biz-a', 'reserve-occupied', 'occupied', 'Mesa 2', 'reserved',
      '2026-09-10T22:00:00.000Z', '2026-09-11T00:00:00.000Z', 120, 1, '${now.toISOString()}', '${now.toISOString()}')`)

  const originalBatch=db.batch.bind(db),calls=[]
  db.batch=async statements=>{calls.push(statements.length);return originalBatch(statements)}
  const tables = await listTables(db, 'biz-a')
  assert.deepEqual(calls,[2])
  const free = tables.find((table) => table.id === 'free')
  const occupied = tables.find((table) => table.id === 'occupied')

  assert.equal(free.occupancy, 'free')
  assert.deepEqual(free.nextReservation, {
    id: 'reservation-free',
    orderId: 'reserve-free',
    orderNumber: 100,
    tableId: 'free',
    tableName: 'Mesa 1',
    status: 'reserved',
    scheduledFor: '2026-09-10T23:00:00.000Z',
    endsAt: '2026-09-11T01:00:00.000Z',
    durationMinutes: 120,
    revision: 2,
    convertedTableTabId: null,
    convertedAt: null,
    cancelledAt: null,
    noShowAt: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    clientId: 'client-free',
    clientName: 'João',
    itemCount: 3,
    totalCents: 3300,
    orderStatus: 'Em preparo',
  })

  assert.equal(occupied.occupancy, 'occupied')
  assert.equal(occupied.openTableTab.id, 'tab-occupied')
  assert.equal(occupied.nextReservation.id, 'reservation-occupied')
  assert.equal(occupied.nextReservation.itemCount, 2)
})

test('createTable normalizes the name and appends after the current business order', async () => {
  const db = new D1Sqlite()
  insertTable(db, { id: 'existing', name: 'Mesa 1', sortOrder: 4 })
  insertTable(db, { id: 'other', businessId: 'biz-b', name: 'Mesa 9', sortOrder: 30 })

  const created = await createTable(db, 'biz-a', { name: '  Jardim   1 ' }, now)

  assert.equal(created.name, 'Jardim 1')
  assert.equal(created.sortOrder, 5)
  assert.equal(created.isActive, true)
  assert.equal(created.occupancy, 'free')
  assert.equal((await loadTableById(db, 'biz-a', created.id)).name, 'Jardim 1')
  assert.equal(await loadTableById(db, 'biz-b', created.id), null)
})

test('renameTable changes a free table and hides normalized uniqueness errors', async () => {
  const db = new D1Sqlite()
  insertTable(db, { id: 'one', name: 'Mesa 1', sortOrder: 1 })
  insertTable(db, { id: 'two', name: 'Mesa 2', sortOrder: 2 })

  assert.equal((await renameTable(db, 'biz-a', 'one', '  Varanda   A  ', now)).name, 'Varanda A')
  await assert.rejects(
    () => renameTable(db, 'biz-a', 'one', ' mesa   2 ', now),
    (error) => error.status === 409 && error.code === 'TABLE_NAME_EXISTS' && !/UNIQUE constraint/i.test(error.message),
  )
})

test('occupied tables cannot be renamed or deactivated', async () => {
  const db = new D1Sqlite()
  insertTable(db, { id: 'occupied', name: 'Mesa 1', sortOrder: 1 })
  db.exec(`INSERT INTO table_tabs (
    id, business_id, table_id, table_identifier, tab_number, status, opened_at, created_at, updated_at
  ) VALUES ('tab-open', 'biz-a', 'occupied', 'Mesa 1', 37, 'open', '${now.toISOString()}', '${now.toISOString()}', '${now.toISOString()}')`)

  await assert.rejects(
    () => renameTable(db, 'biz-a', 'occupied', 'Novo nome', now),
    (error) => error.status === 409 && error.code === 'TABLE_OCCUPIED',
  )
  await assert.rejects(
    () => setTableActive(db, 'biz-a', 'occupied', false, now),
    (error) => error.status === 409 && error.code === 'TABLE_OCCUPIED',
  )
})

test('active reservations block rename and deactivation but never block reordering', async () => {
  const db = new D1Sqlite()
  insertTable(db, { id: 'reserved', name: 'Mesa 1', sortOrder: 1 })
  insertTable(db, { id: 'other', name: 'Mesa 2', sortOrder: 2 })
  db.exec(`INSERT INTO orders (
    id, business_id, order_number, client_name_snapshot, table_tab_id, status, total_cents, scheduled_for, created_at
  ) VALUES ('reserved-order', 'biz-a', 201, 'João', NULL, 'Em preparo', 2500, '2026-09-10T23:00:00.000Z', '${now.toISOString()}');
  INSERT INTO table_reservations (
    id, business_id, order_id, table_id, table_name_snapshot, status,
    scheduled_for, ends_at, duration_minutes, revision,
    converted_table_tab_id, converted_at, cancelled_at, no_show_at,
    created_at, updated_at
  ) VALUES (
    'active-reservation', 'biz-a', 'reserved-order', 'reserved', 'Mesa 1', 'reserved',
    '2026-09-10T23:00:00.000Z', '2026-09-11T01:00:00.000Z', 120, 1,
    NULL, NULL, NULL, NULL, '${now.toISOString()}', '${now.toISOString()}'
  )`)

  await assert.rejects(
    () => renameTable(db, 'biz-a', 'reserved', 'Novo nome', now),
    (error) => error.status === 409 && error.code === 'TABLE_HAS_ACTIVE_RESERVATION',
  )
  await assert.rejects(
    () => setTableActive(db, 'biz-a', 'reserved', false, now),
    (error) => error.status === 409 && error.code === 'TABLE_HAS_ACTIVE_RESERVATION',
  )

  assert.deepEqual((await reorderTables(db, 'biz-a', ['other', 'reserved'], now)).map((table) => table.id), ['other', 'reserved'])
})

test('terminal reservations do not block rename or deactivation', async () => {
  for (const [status, terminalField] of [
    ['cancelled', 'cancelled_at'],
    ['no_show', 'no_show_at'],
  ]) {
    const db = new D1Sqlite()
    insertTable(db, { id: `table-${status}`, name: `Mesa ${status}`, sortOrder: 1 })
    db.exec(`INSERT INTO orders (
      id, business_id, order_number, client_name_snapshot, table_tab_id, status, total_cents, scheduled_for, created_at
    ) VALUES ('order-${status}', 'biz-a', 210, 'Cliente', NULL, 'Cancelado', 2500, '2026-09-10T23:00:00.000Z', '${now.toISOString()}')`)
    db.sqlite.prepare(`INSERT INTO table_reservations (
      id, business_id, order_id, table_id, table_name_snapshot, status,
      scheduled_for, ends_at, duration_minutes, revision,
      converted_table_tab_id, converted_at, cancelled_at, no_show_at,
      created_at, updated_at
    ) VALUES (?, 'biz-a', ?, ?, ?, ?, ?, ?, 120, 1, NULL, NULL, ?, ?, ?, ?)`).run(
      `reservation-${status}`,
      `order-${status}`,
      `table-${status}`,
      `Mesa ${status}`,
      status,
      '2026-09-10T23:00:00.000Z',
      '2026-09-11T01:00:00.000Z',
      terminalField === 'cancelled_at' ? now.toISOString() : null,
      terminalField === 'no_show_at' ? now.toISOString() : null,
      now.toISOString(),
      now.toISOString(),
    )

    assert.equal((await renameTable(db, 'biz-a', `table-${status}`, `Livre ${status}`, now)).name, `Livre ${status}`)
    assert.equal((await setTableActive(db, 'biz-a', `table-${status}`, false, now)).isActive, false)
  }
})

test('a free table can be deactivated and later reactivated', async () => {
  const db = new D1Sqlite()
  insertTable(db, { id: 'free', name: 'Mesa 1', sortOrder: 1 })

  assert.equal((await setTableActive(db, 'biz-a', 'free', false, now)).isActive, false)
  assert.equal((await setTableActive(db, 'biz-a', 'free', true, now)).isActive, true)
})

test('reorderTables accepts every business table exactly once and never updates another business', async () => {
  const db = new D1Sqlite()
  insertTable(db, { id: 'one', name: 'Mesa 1', sortOrder: 1 })
  insertTable(db, { id: 'two', name: 'Mesa 2', sortOrder: 2 })
  insertTable(db, { id: 'other', businessId: 'biz-b', name: 'Mesa 1', sortOrder: 7 })

  assert.deepEqual((await reorderTables(db, 'biz-a', ['two', 'one'], now)).map((table) => table.id), ['two', 'one'])
  assert.equal((await loadTableById(db, 'biz-b', 'other')).sortOrder, 7)
  await assert.rejects(() => reorderTables(db, 'biz-a', ['one', 'one'], now), (error) => error.code === 'INVALID_TABLE_ORDER')
  await assert.rejects(() => reorderTables(db, 'biz-a', ['one'], now), (error) => error.code === 'INVALID_TABLE_ORDER')
  await assert.rejects(() => reorderTables(db, 'biz-a', ['one', 'other'], now), (error) => error.code === 'INVALID_TABLE_ORDER')
})

test('table repository exposes no hard-delete operation', () => {
  assert.equal(Object.hasOwn(tableRepository, 'deleteTable'), false)
})

test('new tabs reserve unique increasing business numbers and reuse the open tab', async () => {
  const db = new D1Sqlite()
  insertTable(db, { id: 'table-1', name: 'Varanda', sortOrder: 1 })
  insertTable(db, { id: 'table-2', name: 'Sal\u00e3o', sortOrder: 2 })

  const first = await getOrCreateOpenTableTabByTableId(db, 'biz-a', 'table-1', now)
  const reused = await getOrCreateOpenTableTabByTableId(db, 'biz-a', 'table-1', new Date('2026-09-07T15:01:00.000Z'))
  const second = await getOrCreateOpenTableTabByTableId(db, 'biz-a', 'table-2', now)

  assert.equal(first.id, reused.id)
  assert.equal(first.tableId, 'table-1')
  assert.equal(first.tableIdentifier, 'Varanda')
  assert.equal(first.tabNumber, 1)
  assert.equal(reused.tabNumber, 1)
  assert.equal(second.tabNumber, 2)
  assert.equal(db.sqlite.prepare("SELECT count(*) AS count FROM table_tabs WHERE status = 'open'").get().count, 2)
})

test('tab number allocation is isolated per business', async () => {
  const db = new D1Sqlite()
  insertTable(db, { id: 'table-a', businessId: 'biz-a', name: 'Mesa A', sortOrder: 1 })
  insertTable(db, { id: 'table-b', businessId: 'biz-b', name: 'Mesa B', sortOrder: 1 })

  assert.equal((await getOrCreateOpenTableTabByTableId(db, 'biz-a', 'table-a', now)).tabNumber, 1)
  assert.equal((await getOrCreateOpenTableTabByTableId(db, 'biz-b', 'table-b', now)).tabNumber, 1)
})

test('concurrent new tabs receive distinct allocated numbers', async () => {
  const db = new D1Sqlite()
  insertTable(db, { id: 'table-1', name: 'Mesa 1', sortOrder: 1 })
  insertTable(db, { id: 'table-2', name: 'Mesa 2', sortOrder: 2 })

  const tabs = await Promise.all([
    getOrCreateOpenTableTabByTableId(db, 'biz-a', 'table-1', now),
    getOrCreateOpenTableTabByTableId(db, 'biz-a', 'table-2', now),
  ])

  assert.deepEqual(tabs.map((tab) => tab.tabNumber).sort((a, b) => a - b), [1, 2])
})

test('missing, cross-business, and inactive tables are rejected by the domain', async () => {
  const db = new D1Sqlite()
  insertTable(db, { id: 'inactive', name: 'Mesa 1', sortOrder: 1, isActive: 0 })
  insertTable(db, { id: 'other', businessId: 'biz-b', name: 'Mesa 2', sortOrder: 1 })

  for (const tableId of ['missing', 'other']) {
    await assert.rejects(
      () => getOrCreateOpenTableTabByTableId(db, 'biz-a', tableId, now),
      (error) => error.status === 404 && error.code === 'TABLE_NOT_FOUND',
    )
  }
  await assert.rejects(
    () => getOrCreateOpenTableTabByTableId(db, 'biz-a', 'inactive', now),
    (error) => error.status === 409 && error.code === 'TABLE_INACTIVE',
  )
})

test('concurrent attempts cannot create two open tabs for the same table', async () => {
  const db = new D1Sqlite()
  insertTable(db, { id: 'table-1', name: 'Mesa 1', sortOrder: 1 })

  const [first, second] = await Promise.all([
    getOrCreateOpenTableTabByTableId(db, 'biz-a', 'table-1', now),
    getOrCreateOpenTableTabByTableId(db, 'biz-a', 'table-1', now),
  ])

  assert.equal(first.id, second.id)
  assert.equal(first.tabNumber, 1)
  assert.equal(second.tabNumber, 1)
  assert.equal(db.sqlite.prepare("SELECT count(*) AS count FROM table_tabs WHERE status = 'open'").get().count, 1)
})

test('transferring a tab preserves its number', async () => {
  const db = new D1Sqlite()
  insertTable(db, { id: 'source', name: 'Mesa 1', sortOrder: 1 })
  insertTable(db, { id: 'destination', name: 'Varanda', sortOrder: 2 })
  insertOpenTableTab(db, { id: 'tab-1', tableId: 'source', tableIdentifier: 'Mesa 1' })
  db.sqlite.prepare(`INSERT INTO orders (id, business_id, table_tab_id, status, total_cents, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run('order-1', 'biz-a', 'tab-1', 'Em preparo', 1000, now.toISOString())

  const transferred = await transferOpenTableTab(db, 'biz-a', 'source', 'destination', now, 'tab-1')

  assert.deepEqual(transferred, {
    id: 'tab-1',
    tableId: 'destination',
    tableIdentifier: 'Varanda',
    tabNumber: 37,
    status: 'open',
    openedAt: now.toISOString(),
    closedAt: null,
  })
  assert.equal(db.sqlite.prepare('SELECT table_tab_id FROM orders WHERE id = ?').get('order-1').table_tab_id, 'tab-1')
  assert.equal((await loadTableById(db, 'biz-a', 'source')).occupancy, 'free')
  assert.equal((await loadTableById(db, 'biz-a', 'destination')).occupancy, 'occupied')
})

test('transferOpenTableTab rejects a source without an open tab', async () => {
  const db = new D1Sqlite()
  insertTable(db, { id: 'source', name: 'Mesa 1', sortOrder: 1 })
  insertTable(db, { id: 'destination', name: 'Mesa 2', sortOrder: 2 })

  await assert.rejects(
    () => transferOpenTableTab(db, 'biz-a', 'source', 'destination', now, 'missing-tab'),
    (error) => error.status === 409 && error.code === 'TABLE_TAB_CHANGED',
  )
})

test('transferOpenTableTab rejects a missing or cross-business destination', async () => {
  const db = new D1Sqlite()
  insertTable(db, { id: 'source', name: 'Mesa 1', sortOrder: 1 })
  insertTable(db, { id: 'other', businessId: 'biz-b', name: 'Mesa 2', sortOrder: 1 })
  insertOpenTableTab(db, { id: 'tab-1', tableId: 'source', tableIdentifier: 'Mesa 1' })

  for (const destinationId of ['missing', 'other']) {
    await assert.rejects(
      () => transferOpenTableTab(db, 'biz-a', 'source', destinationId, now, 'tab-1'),
      (error) => error.status === 404 && error.code === 'TABLE_DESTINATION_NOT_FOUND',
    )
  }
})

test('transferOpenTableTab rejects an inactive destination', async () => {
  const db = new D1Sqlite()
  insertTable(db, { id: 'source', name: 'Mesa 1', sortOrder: 1 })
  insertTable(db, { id: 'destination', name: 'Mesa 2', sortOrder: 2, isActive: 0 })
  insertOpenTableTab(db, { id: 'tab-1', tableId: 'source', tableIdentifier: 'Mesa 1' })

  await assert.rejects(
    () => transferOpenTableTab(db, 'biz-a', 'source', 'destination', now, 'tab-1'),
    (error) => error.status === 409 && error.code === 'TABLE_DESTINATION_INACTIVE',
  )
})

test('transferOpenTableTab rejects an occupied destination without merging tabs', async () => {
  const db = new D1Sqlite()
  insertTable(db, { id: 'source', name: 'Mesa 1', sortOrder: 1 })
  insertTable(db, { id: 'destination', name: 'Mesa 2', sortOrder: 2 })
  insertOpenTableTab(db, { id: 'source-tab', tableId: 'source', tableIdentifier: 'Mesa 1' })
  insertOpenTableTab(db, { id: 'destination-tab', tableId: 'destination', tableIdentifier: 'Mesa 2', tabNumber: 38 })

  await assert.rejects(
    () => transferOpenTableTab(db, 'biz-a', 'source', 'destination', now, 'source-tab'),
    (error) => error.status === 409 && error.code === 'TABLE_DESTINATION_OCCUPIED',
  )
  assert.equal(db.sqlite.prepare("SELECT count(*) AS count FROM table_tabs WHERE status = 'open'").get().count, 2)
})

test('transferOpenTableTab rejects transferring a tab to its current table', async () => {
  const db = new D1Sqlite()
  insertTable(db, { id: 'source', name: 'Mesa 1', sortOrder: 1 })
  insertOpenTableTab(db, { id: 'tab-1', tableId: 'source', tableIdentifier: 'Mesa 1' })

  await assert.rejects(
    () => transferOpenTableTab(db, 'biz-a', 'source', 'source', now, 'tab-1'),
    (error) => error.status === 409 && error.code === 'TABLE_TRANSFER_SAME_TABLE',
  )
})

test('concurrent transfers to one destination cannot create two open tabs there', async () => {
  const db = new D1Sqlite()
  insertTable(db, { id: 'source-1', name: 'Mesa 1', sortOrder: 1 })
  insertTable(db, { id: 'source-2', name: 'Mesa 2', sortOrder: 2 })
  insertTable(db, { id: 'destination', name: 'Mesa 3', sortOrder: 3 })
  insertOpenTableTab(db, { id: 'tab-1', tableId: 'source-1', tableIdentifier: 'Mesa 1' })
  insertOpenTableTab(db, { id: 'tab-2', tableId: 'source-2', tableIdentifier: 'Mesa 2', tabNumber: 38 })

  const results = await Promise.allSettled([
    transferOpenTableTab(db, 'biz-a', 'source-1', 'destination', now, 'tab-1'),
    transferOpenTableTab(db, 'biz-a', 'source-2', 'destination', now, 'tab-2'),
  ])

  assert.equal(results.filter(({ status }) => status === 'fulfilled').length, 1)
  assert.equal(results.filter(({ status }) => status === 'rejected').length, 1)
  assert.equal(results.find(({ status }) => status === 'rejected').reason.code, 'TABLE_DESTINATION_OCCUPIED')
  assert.equal(db.sqlite.prepare(`SELECT count(*) AS count FROM table_tabs
    WHERE business_id = 'biz-a' AND table_id = 'destination' AND status = 'open'`).get().count, 1)
})

test('confirmation of A does not transfer B that replaced it before the request', async () => {
  const db = new D1Sqlite()
  try {
    insertTable(db, { id: 'source', name: 'Mesa 1', sortOrder: 1 })
    insertTable(db, { id: 'destination', name: 'Mesa 2', sortOrder: 2 })
    insertOpenTableTab(db, { id: 'A', tableId: 'source', tableIdentifier: 'Mesa 1', tabNumber: 37 })
    db.exec("UPDATE table_tabs SET status='closed' WHERE id='A'")
    insertOpenTableTab(db, { id: 'B', tableId: 'source', tableIdentifier: 'Mesa 1', tabNumber: 38 })

    await assert.rejects(
      transferOpenTableTab(db, 'biz-a', 'source', 'destination', now, 'A'),
      (error) => error.status === 409 && error.code === 'TABLE_TAB_CHANGED',
    )
    assert.equal(db.sqlite.prepare('SELECT table_id FROM table_tabs WHERE id = ?').get('B').table_id, 'source')
  } finally {
    db.sqlite.close()
  }
})

test('confirmation of A does not transfer B that replaces it between read and write', async () => {
  const db = new D1Sqlite()
  try {
    insertTable(db, { id: 'source', name: 'Mesa 1', sortOrder: 1 })
    insertTable(db, { id: 'destination', name: 'Mesa 2', sortOrder: 2 })
    insertOpenTableTab(db, { id: 'A', tableId: 'source', tableIdentifier: 'Mesa 1', tabNumber: 37 })
    db.beforeTransferRun = () => {
      db.exec("UPDATE table_tabs SET status='closed' WHERE id='A'")
      insertOpenTableTab(db, { id: 'B', tableId: 'source', tableIdentifier: 'Mesa 1', tabNumber: 38 })
    }

    await assert.rejects(
      transferOpenTableTab(db, 'biz-a', 'source', 'destination', now, 'A'),
      (error) => error.status === 409 && error.code === 'TABLE_TAB_CHANGED',
    )
    assert.equal(db.sqlite.prepare('SELECT table_id FROM table_tabs WHERE id = ?').get('B').table_id, 'source')
  } finally {
    db.sqlite.close()
  }
})

test('an expected tab from another business or table is never transferred', async () => {
  const db = new D1Sqlite()
  try {
    insertTable(db, { id: 'source', name: 'Mesa 1', sortOrder: 1 })
    insertTable(db, { id: 'destination', name: 'Mesa 2', sortOrder: 2 })
    insertTable(db, { id: 'other-source', name: 'Mesa 3', sortOrder: 3 })
    insertTable(db, { id: 'foreign-source', businessId: 'biz-b', name: 'Mesa 4', sortOrder: 1 })
    insertOpenTableTab(db, { id: 'current', tableId: 'source', tableIdentifier: 'Mesa 1' })
    insertOpenTableTab(db, { id: 'moved', tableId: 'other-source', tableIdentifier: 'Mesa 3', tabNumber: 38 })
    insertOpenTableTab(db, { id: 'foreign', tableId: 'foreign-source', businessId: 'biz-b', tableIdentifier: 'Mesa 4', tabNumber: 1 })

    for (const expectedTableTabId of ['moved', 'foreign']) {
      await assert.rejects(
        transferOpenTableTab(db, 'biz-a', 'source', 'destination', now, expectedTableTabId),
        (error) => error.status === 409 && error.code === 'TABLE_TAB_CHANGED',
      )
    }
    assert.equal(db.sqlite.prepare('SELECT table_id FROM table_tabs WHERE id = ?').get('current').table_id, 'source')
  } finally {
    db.sqlite.close()
  }
})

test('destination occupied between read and write rejects without moving the expected tab', async () => {
  const db = new D1Sqlite()
  try {
    insertTable(db, { id: 'source', name: 'Mesa 1', sortOrder: 1 })
    insertTable(db, { id: 'destination', name: 'Mesa 2', sortOrder: 2 })
    insertOpenTableTab(db, { id: 'A', tableId: 'source', tableIdentifier: 'Mesa 1' })
    db.beforeTransferRun = () => insertOpenTableTab(db, { id: 'B', tableId: 'destination', tableIdentifier: 'Mesa 2', tabNumber: 38 })

    await assert.rejects(
      transferOpenTableTab(db, 'biz-a', 'source', 'destination', now, 'A'),
      (error) => error.status === 409 && error.code === 'TABLE_DESTINATION_OCCUPIED',
    )
    assert.equal(db.sqlite.prepare('SELECT table_id FROM table_tabs WHERE id = ?').get('A').table_id, 'source')
  } finally {
    db.sqlite.close()
  }
})

test('destination inactivated between read and write rejects without moving the expected tab', async () => {
  const db = new D1Sqlite()
  try {
    insertTable(db, { id: 'source', name: 'Mesa 1', sortOrder: 1 })
    insertTable(db, { id: 'destination', name: 'Mesa 2', sortOrder: 2 })
    insertOpenTableTab(db, { id: 'A', tableId: 'source', tableIdentifier: 'Mesa 1' })
    db.beforeTransferRun = () => db.exec("UPDATE tables SET is_active=0 WHERE id='destination'")

    await assert.rejects(
      transferOpenTableTab(db, 'biz-a', 'source', 'destination', now, 'A'),
      (error) => error.status === 409 && error.code === 'TABLE_DESTINATION_INACTIVE',
    )
    assert.equal(db.sqlite.prepare('SELECT table_id FROM table_tabs WHERE id = ?').get('A').table_id, 'source')
  } finally {
    db.sqlite.close()
  }
})


test('table summaries seek only open tabs and their orders, independent of unrelated history', async () => {
  const db = new D1Sqlite()
  db.exec(`CREATE INDEX idx_orders_table_tab ON orders(business_id,table_tab_id);
    CREATE INDEX order_items_business_order_created_idx ON order_items(business_id,order_id);
    CREATE INDEX payments_business_order_idx ON payments(business_id,order_id);`)
  insertTable(db,{id:'occupied',name:'Mesa 1',sortOrder:1})
  insertOpenTableTab(db,{id:'open',tableId:'occupied',tableIdentifier:'Mesa 1'})
  db.exec(`INSERT INTO orders(id,business_id,table_tab_id,status,total_cents,created_at) VALUES
    ('old-open','biz-a','open','Finalizado',2300,'2020-01-01'),
    ('other-company','biz-b','open','Finalizado',9900,'2020-01-01');
    INSERT INTO order_items(id,business_id,order_id,quantity) VALUES('item','biz-a','old-open',3);
    WITH RECURSIVE n(x) AS(SELECT 0 UNION ALL SELECT x+1 FROM n WHERE x<9999)
    INSERT INTO orders(id,business_id,status,total_cents,created_at)
    SELECT 'history:'||x,'biz-a','Finalizado',1000,'2020-01-01' FROM n;`)
  const plans=[],prepare=db.prepare.bind(db)
  db.prepare=sql=>({bind:(...values)=>{
    if(sql.includes('AS open_table_tab_order_count'))plans.push(...db.sqlite.prepare('EXPLAIN QUERY PLAN '+sql).all(...values).map(r=>r.detail))
    return prepare(sql).bind(...values)
  }})
  for(const table of [(await listTables(db,'biz-a'))[0],await loadTableById(db,'biz-a','occupied')]){
    assert.equal(table.openTableTab.orderCount,1)
    assert.equal(table.openTableTab.itemCount,3)
    assert.equal(table.openTableTab.totalCents,2300)
  }
  assert.equal(plans.some(p=>/^SCAN (orders|order_items)\b/.test(p)),false,plans.join('\n'))
  assert.equal(plans.filter(p=>p.includes('idx_orders_table_tab') && p.includes('table_tab_id=?')).length,2)
})
