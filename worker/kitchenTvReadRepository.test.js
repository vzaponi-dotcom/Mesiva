import assert from 'node:assert/strict'
import test from 'node:test'
import { createSettingsDb } from './test-support/settingsDb.js'

const BUSINESS = 'amor-e-sabor'
const repositoryPromise = import('./kitchenTvReadRepository.js').catch(() => ({}))

function setup(t) {
  const fixture = createSettingsDb()
  t.after(fixture.close)
  fixture.sqlite.prepare(`UPDATE business_operation_settings SET
    scheduled_prep_lead_minutes = 37,
    scheduled_late_grace_minutes = 9,
    immediate_late_after_minutes = 21,
    immediate_very_late_after_minutes = 44
    WHERE business_id = ?`).run(BUSINESS)

  const insertOrder = fixture.sqlite.prepare(`INSERT INTO orders (
    id, business_id, client_name_snapshot, type, order_date, status,
    subtotal_cents, total_cents, created_at, finished_at, scheduled_for,
    cancelled_at, order_number
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  insertOrder.run('active-now', BUSINESS, 'Ana Souza', 'Entrega', '2026-09-22', 'Em preparo', 4200, 4200,
    '2026-09-22T17:40:00.000Z', null, null, null, 1042)
  insertOrder.run('active-scheduled', BUSINESS, 'Ricardo Martins', 'Retirada', '2026-09-22', 'Agendado', 3800, 3800,
    '2026-09-22T17:45:00.000Z', null, '2026-09-22T20:00:00.000Z', null, 1043)
  insertOrder.run('finished', BUSINESS, 'Finalizado', 'Local', '2026-09-22', 'Finalizado', 1000, 1000,
    '2026-09-22T16:00:00.000Z', '2026-09-22T16:30:00.000Z', null, null, 1040)
  insertOrder.run('cancelled', BUSINESS, 'Cancelado', 'Entrega', '2026-09-22', 'Cancelado', 1000, 1000,
    '2026-09-22T16:10:00.000Z', null, null, '2026-09-22T16:20:00.000Z', 1041)

  const insertItem = fixture.sqlite.prepare(`INSERT INTO order_items (
    id, business_id, order_id, name_snapshot, category_snapshot, size_snapshot,
    quantity, catalog_price_cents, unit_price_cents, price_reason, note, created_at
  ) VALUES (?, ?, ?, ?, '', ?, ?, ?, ?, '', ?, ?)`)
  insertItem.run('item-1', BUSINESS, 'active-now', 'Marmita', 'G', 1, 4200, 4200, 'Sem cebola', '2026-09-22T17:40:01.000Z')
  insertItem.run('item-2', BUSINESS, 'active-scheduled', 'Suco Natural', '', 2, 1900, 1900, '', '2026-09-22T17:45:01.000Z')
  return fixture
}

test('returns only active kitchen-safe fields, future scheduled orders and current operation timing', async (t) => {
  const repository = await repositoryPromise
  assert.equal(typeof repository.loadKitchenTvState, 'function')
  const { db } = setup(t)
  const forbiddenSql = /client_phone|client_address|subtotal|total_cents|delivery_fee|adjustment|payment|movement|refund|print_job|catalog_price|unit_price/i
  const guardedDb = { ...db, prepare(sql) {
    assert.doesNotMatch(sql, forbiddenSql)
    return db.prepare(sql)
  } }

  const state = await repository.loadKitchenTvState(guardedDb, BUSINESS)
  assert.deepEqual(state.timing, {
    scheduledPrepLeadMinutes: 37,
    scheduledLateGraceMinutes: 9,
    immediateLateAfterMinutes: 21,
    immediateVeryLateAfterMinutes: 44,
  })
  assert.deepEqual(state.control, { revision: 0, requestedPage: 1, requestedModality: 'all' })
  assert.deepEqual(state.orders, [
    {
      id: 'active-now', orderNumber: 1042, client: 'Ana Souza', type: 'Entrega', status: 'Em preparo',
      orderDate: '2026-09-22', createdAt: '2026-09-22T17:40:00.000Z', scheduledFor: null,
      items: [{ quantity: 1, name: 'Marmita', size: 'G', note: 'Sem cebola' }],
    },
    {
      id: 'active-scheduled', orderNumber: 1043, client: 'Ricardo Martins', type: 'Retirada', status: 'Agendado',
      orderDate: '2026-09-22', createdAt: '2026-09-22T17:45:00.000Z', scheduledFor: '2026-09-22T20:00:00.000Z',
      items: [{ quantity: 2, name: 'Suco Natural', size: '', note: '' }],
    },
  ])
})

test('TV shows table and client on the first, second and third order of a comanda', async (t) => {
  const repository = await repositoryPromise
  const { db, sqlite } = setup(t)
  sqlite.exec(`
    INSERT INTO clients (id, business_id, name, created_at, updated_at)
      VALUES ('client-hugo', '${BUSINESS}', 'Hugo', '2026-09-22T18:00:00.000Z', '2026-09-22T18:00:00.000Z');
    INSERT INTO tables (id, business_id, name, name_key, sort_order, is_active, created_at, updated_at)
      VALUES ('mesa-2', '${BUSINESS}', 'Mesa KDS 2', 'MESA KDS 2', 2, 1, '2026-09-22T18:00:00.000Z', '2026-09-22T18:00:00.000Z'),
             ('mesa-3', '${BUSINESS}', 'Mesa KDS 3', 'MESA KDS 3', 3, 1, '2026-09-22T18:00:00.000Z', '2026-09-22T18:00:00.000Z');
    INSERT INTO table_tabs (id, business_id, table_id, table_identifier, tab_number, status, opened_at, created_at, updated_at)
      VALUES ('comanda-2', '${BUSINESS}', 'mesa-2', 'Mesa KDS 2', 2, 'open', '2026-09-22T18:00:00.000Z', '2026-09-22T18:00:00.000Z', '2026-09-22T18:00:00.000Z'),
             ('comanda-3', '${BUSINESS}', 'mesa-3', 'Mesa KDS 3', 3, 'open', '2026-09-22T18:00:00.000Z', '2026-09-22T18:00:00.000Z', '2026-09-22T18:00:00.000Z');
  `)
  const addOrder = sqlite.prepare(`INSERT INTO orders (
    id, business_id, client_id, client_name_snapshot, customer_identity_type, table_tab_id,
    type, order_date, status, subtotal_cents, total_cents, created_at, order_number
  ) VALUES (?, ?, ?, ?, 'table', ?, 'Local', '2026-09-22', 'Em preparo', 1500, 1500, ?, ?)`)
  for (const number of [1, 2, 3]) {
    addOrder.run(`hugo-${number}`, BUSINESS, 'client-hugo', 'Hugo', 'comanda-2',
      `2026-09-22T18:0${number}:00.000Z`, 1043 + number)
  }
  addOrder.run('no-name', BUSINESS, null, 'Mesa KDS 3', 'comanda-3', '2026-09-22T18:04:00.000Z', 1047)

  const state = await repository.loadKitchenTvState(db, BUSINESS)
  for (const number of [1, 2, 3]) {
    const order = state.orders.find((entry) => entry.id === `hugo-${number}`)
    assert.equal(order.client, 'Mesa KDS 2 · Hugo')
    assert.equal(order.type, 'Local')
    assert.equal(Object.hasOwn(order, 'tableIdentifier'), false)
    assert.equal(Object.hasOwn(order, 'clientId'), false)
  }
  assert.equal(state.orders.find((order) => order.id === 'no-name').client, 'Mesa KDS 3')
  assert.equal(state.orders.find((order) => order.id === 'active-now').client, 'Ana Souza')
})

test('serialized state never exposes contact, financial, refund, printing or catalog fields', async (t) => {
  const repository = await repositoryPromise
  const { db } = setup(t)
  const serialized = JSON.stringify(await repository.loadKitchenTvState(db, BUSINESS)).toLowerCase()
  for (const forbidden of [
    'phone', 'address', 'subtotal', 'totalcents', 'deliveryfee', 'adjustment', 'payment',
    'movement', 'refund', 'printer', 'printjob', 'qz', 'productid', 'clientid',
  ]) assert.equal(serialized.includes(forbidden), false, `forbidden Kitchen TV field: ${forbidden}`)
})


test('TV-only hidden orders disappear from state and item rows while administrative order data stays untouched', async (t) => {
  const repository = await repositoryPromise
  const { db, sqlite } = setup(t)

  sqlite.prepare('INSERT INTO kitchen_tv_hidden_orders (business_id, order_id, hidden_at) VALUES (?, ?, ?)')
    .run(BUSINESS, 'active-now', '2026-09-22T18:00:00.000Z')

  const state = await repository.loadKitchenTvState(db, BUSINESS)
  assert.deepEqual(state.orders.map(({ id }) => id), ['active-scheduled'])
  assert.equal(JSON.stringify(state).includes('Sem cebola'), false)

  const official = sqlite.prepare('SELECT status, finished_at FROM orders WHERE business_id = ? AND id = ?')
    .get(BUSINESS, 'active-now')
  assert.deepEqual({ ...official }, { status: 'Em preparo', finished_at: null })

  sqlite.prepare('DELETE FROM kitchen_tv_hidden_orders WHERE business_id = ? AND order_id = ?')
    .run(BUSINESS, 'active-now')
  const restored = await repository.loadKitchenTvState(db, BUSINESS)
  assert.deepEqual(restored.orders.map(({ id }) => id), ['active-now', 'active-scheduled'])
})

test('Kitchen TV state exposes only revision and requested page, never administrative telemetry', async (t) => {
  const repository = await repositoryPromise
  const { db, sqlite } = setup(t)

  sqlite.prepare(`INSERT INTO kitchen_tv_display_control (
    business_id, revision, requested_page, updated_at,
    reported_revision, reported_page, reported_page_count,
    reported_viewport_width, reported_viewport_height,
    reported_visible_order_ids_json, reported_at
  ) VALUES (?, 7, 3, ?, 6, 2, 4, 960, 540, '["active-now"]', ?)`)
    .run(BUSINESS, '2026-09-22T18:00:00.000Z', '2026-09-22T18:00:01.000Z')

  const state = await repository.loadKitchenTvState(db, BUSINESS)
  assert.deepEqual(state.control, { revision: 7, requestedPage: 3, requestedModality: 'all' })
  assert.equal(Object.hasOwn(state.control, 'telemetry'), false)
  assert.equal(JSON.stringify(state).includes('visibleOrderIds'), false)
})

test('TV reads active candidates before items even with large terminal history',async t=>{
  const {seedOperationalReadFixture}=await import('./test-support/operationalReadFixture.js')
  const {db,sqlite,close}=createSettingsDb();t.after(close)
  const {activeIds}=await seedOperationalReadFixture(db,{historicalOrders:1000,activeOrders:5,itemsPerOrder:2})
  sqlite.prepare("UPDATE orders SET status='Estado desconhecido' WHERE id=?").run(activeIds[1])
  sqlite.prepare("UPDATE orders SET status='Agendado',scheduled_for='2026-10-15T15:00:00.000Z' WHERE id=?").run(activeIds[2])
  sqlite.prepare("UPDATE orders SET finished_at='2026-10-13T13:00:00.000Z' WHERE id=?").run(activeIds[3])
  sqlite.prepare('INSERT INTO kitchen_tv_hidden_orders(business_id,order_id,hidden_at) VALUES(?,?,?)').run(BUSINESS,activeIds[4],'2026-10-13T13:00:00.000Z')
  assert.throws(()=>sqlite.prepare('UPDATE orders SET status=NULL WHERE id=?').run(activeIds[0]),/NOT NULL/)
  const plans=[]
  const recording={...db,prepare(sql){const statement=db.prepare(sql);return {...statement,bind(...values){
    if(sql.includes('FROM orders') || sql.includes('FROM order_items'))plans.push({sql,details:sqlite.prepare('EXPLAIN QUERY PLAN '+sql).all(...values).map(r=>r.detail)})
    return statement.bind(...values)
  }}}}
  const state=await (await repositoryPromise).loadKitchenTvState(recording,BUSINESS)
  assert.deepEqual(state.orders.map(o=>o.id),activeIds.slice(0,3))
  assert.ok(state.orders.every(o=>o.items.length===2))
  assert.equal(state.orders[1].status,'Estado desconhecido')
  assert.equal(state.orders[2].scheduledFor,'2026-10-15T15:00:00.000Z')
  assert.equal(plans.length,2)
  for(const plan of plans)assert.ok(plan.details.some(detail=>detail.includes('orders_business_active_created_idx')),'missing active candidate index: '+plan.details.join('; '))
  const items=plans.find(plan=>plan.sql.includes('i.order_id'))
  assert.ok(items.details.some(detail=>detail.includes('order_items_business_order_created_idx') && detail.includes('order_id=?')),'items must be constrained to one candidate order: '+items.details.join('; '))
})
