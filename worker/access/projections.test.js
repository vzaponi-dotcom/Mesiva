import test from 'node:test'
import assert from 'node:assert/strict'
import { createSettingsDb } from '../test-support/settingsDb.js'
import { seedBuiltinRoles } from './roles.js'
import { createUserSession } from './sessions.js'
import { handleRequest } from '../index.js'
import { createOrder, updateOrderStatus } from '../repositories.js'
import { canReadOrder, projectMutationEffects } from './projections.js'
import { getBusinessDate } from '../../shared/finance.js'

const BUSINESS = 'amor-e-sabor'
const request = (token, path, method = 'GET', body) => new Request(`https://delivery.test${path}`, {
  method, headers: { cookie: `amor_session=${token}`, origin: 'https://delivery.test', 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
})
async function setup(t) {
  const fixture = createSettingsDb(); t.after(fixture.close)
  const { db, sqlite } = fixture, now = new Date(), timestamp = now.toISOString()
  await seedBuiltinRoles(db, BUSINESS, now)
  sqlite.exec("UPDATE business_auth_state SET mode='user_only'")
  const tokens = {}
  for (const name of ['manager', 'operator', 'operator2', 'empty', 'history', 'active', 'tables']) {
    const roleId = ['manager', 'operator', 'operator2'].includes(name) ? `${BUSINESS}:${name === 'operator2' ? 'operator' : name}` : name
    if (roleId === name) sqlite.prepare('INSERT INTO roles(id,business_id,code,name,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(name, BUSINESS, name, name, timestamp, timestamp)
    sqlite.prepare('INSERT INTO users(id,business_id,display_name,login_normalized,role_id,email_verified_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(name, BUSINESS, name, `${name}@example.test`, roleId, timestamp, timestamp, timestamp)
    sqlite.prepare('INSERT INTO user_credentials(business_id,user_id,password_verifier,password_changed_at,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(BUSINESS, name, 'test-verifier', timestamp, timestamp, timestamp)
    tokens[name] = (await createUserSession({ DB: db }, { businessId: BUSINESS, userId: name, now })).token
  }
  for (const [role, capability] of [['history', 'orders.history'], ['active', 'orders.view'], ['tables', 'tables.view']]) {
    sqlite.prepare('INSERT INTO role_capabilities(business_id,role_id,capability) VALUES(?,?,?)').run(BUSINESS, role, capability)
  }
  sqlite.prepare("INSERT INTO products(id,business_id,category,size,name,price_cents,active,created_at,updated_at) VALUES('product',?,'Meals','','Prato',2500,1,?,?)").run(BUSINESS, timestamp, timestamp)
  sqlite.prepare("INSERT INTO clients(id,business_id,name,phone,address,created_at,updated_at) VALUES('client',?,'Ana','','',?,?)").run(BUSINESS, timestamp, timestamp)
  sqlite.prepare("INSERT INTO tables(id,business_id,name,name_key,sort_order,is_active,created_at,updated_at) VALUES('table',?,'Mesa 1','mesa 1',1,1,?,?)").run(BUSINESS, timestamp, timestamp)
  const input = (key, type = 'Retirada') => ({
    customerIdentity: type === 'Local' ? { type: 'table', tableId: 'table', clientId: null } : { type: 'registered_client', clientId: 'client' },
    type, orderDate: getBusinessDate(now), items: [{ productId: 'product', quantity: 1, note: '' }], deliveryFeeCents: 0,
    adjustment: { type: 'none', mode: 'fixed', storedValue: 0, reason: '' }, paymentAllocations: null, idempotencyKey: key,
  })
  const active = await createOrder(db, BUSINESS, input('active'), now)
  const history = await createOrder(db, BUSINESS, input('history'), now)
  await updateOrderStatus(db, BUSINESS, history.id, now)
  const local = await createOrder(db, BUSINESS, input('local', 'Local'), now)
  return { ...fixture, env: { DB: db }, tokens, active, history, local, input, now }
}
async function read(env, token, path, method, body) {
  const response = await handleRequest(request(token, path, method, body), env)
  const text = await response.text(), data = JSON.parse(text)
  assert.equal(response.status, method === 'POST' ? 201 : 200, text)
  return data
}

test('private operational responses cannot be cached across access contexts', async (t) => {
  const { env, tokens } = await setup(t)
  for (const path of ['/api/bootstrap', '/api/orders', '/api/settings/effective']) {
    const response = await handleRequest(request(tokens.operator, path), env)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
  }
})

test('operator raw bootstrap and refresh retain operational amounts and omit managerial collections', async (t) => {
  const { env, tokens, active, history, local } = await setup(t)
  const first = await read(env, tokens.operator, '/api/bootstrap?businessId=other')
  assert.equal(first.business.id, BUSINESS)
  assert.deepEqual(new Set(first.orders.map(({ id }) => id)), new Set([active.id, history.id, local.id]))
  assert.equal(first.orders.find(({ id }) => id === active.id).total, 25)
  assert.equal(first.tableTabs.length, 1)
  for (const key of ['movements', 'financeSettings', 'balances', 'reports', 'receipts']) assert.equal(Object.hasOwn(first, key), false, key)
  const refresh = await read(env, tokens.operator, `/api/bootstrap?knownEffectiveConfigVersion=${first.effectiveConfigVersion}`)
  assert.equal(Object.hasOwn(refresh, 'effectiveBusinessConfig'), false)
  assert.equal(Object.hasOwn(refresh, 'movements'), false)
  const manager = await read(env, tokens.manager, '/api/bootstrap')
  assert.ok(Array.isArray(manager.movements)); assert.equal(Object.hasOwn(manager, 'financeSettings'), true)
})

test('empty and status-specific grants project bootstrap and direct order reads', async (t) => {
  for (const instant of ['2026-10-01T02:59:59.000Z', '2026-10-01T03:00:00.000Z', '2030-01-01T03:00:00.000Z']) {
    await t.test(`fixture statuses and grant projections at ${instant}`, async (t) => {
      t.mock.timers.enable({ apis: ['Date'], now: new Date(instant) })
      const { env, tokens, active, history, local } = await setup(t)
      assert.equal(active.status, 'Em preparo')
      assert.equal(local.status, 'Em preparo')
      const empty = await read(env, tokens.empty, '/api/bootstrap')
      for (const key of ['clients', 'products', 'orders', 'tables', 'tableTabs', 'movements', 'financeSettings']) assert.equal(Object.hasOwn(empty, key), false, key)
      assert.deepEqual(Object.keys(empty.effectiveBusinessConfig).sort(), ['revisions', 'version'])
      for (const [role, expected] of [['history', [history.id]], ['active', [active.id, local.id]]]) {
        for (const path of ['/api/bootstrap', '/api/orders?businessId=other']) {
          const data = await read(env, tokens[role], path)
          assert.deepEqual(new Set(data.orders.map(({ id }) => id)), new Set(expected))
        }
      }
      const tables = await read(env, tokens.tables, '/api/bootstrap')
      assert.equal(Object.hasOwn(tables, 'tableTabs'), false)
      assert.equal(Object.hasOwn(tables.tables[0], 'openTableTab'), false)
      assert.equal(Object.hasOwn(tables.tables[0], 'nextReservation'), false)
    })
  }
})

test('order table-tab and client batch payment confirmations omit movement rows', async (t) => {
  const { env, tokens, active, history, local, sqlite, db, input, now } = await setup(t)
  const second = await createOrder(db, BUSINESS, input('second-client-order'), now)
  await updateOrderStatus(db, BUSINESS, second.id, now)
  for (const path of [`/api/orders/${active.id}/payment`, '/api/clients/client/receivables/payment', `/api/table-tabs/${local.tableTabId}/payment`]) {
    const data = await read(env, tokens.operator, path, 'POST', {
      allocations: [{ methodCode: 'cash', amountCents: path.includes('receivables') ? 5000 : 2500 }], ...(path.includes('receivables') ? { orderIds: [history.id, second.id] } : {}),
    })
    assert.equal(Object.hasOwn(data, 'movements'), false)
    assert.equal(Object.hasOwn(data, 'financeSettings'), false)
    assert.ok(data.payment || data.payments?.length)
    for (const order of data.orders || [data.order]) assert.equal(order.paymentStatus, 'Pago')
  }
  assert.equal(sqlite.prepare('SELECT count(*) n FROM payments').get().n, 4)
  assert.equal(sqlite.prepare('SELECT count(*) n FROM movements').get().n, 3)
})

test('effective versions are isolated by trusted user and current grants on both endpoints', async (t) => {
  const { env, tokens, sqlite } = await setup(t)
  const first = await read(env, tokens.operator, '/api/bootstrap')
  const other = await read(env, tokens.operator2, `/api/bootstrap?knownEffectiveConfigVersion=${first.effectiveConfigVersion}`)
  assert.notEqual(other.effectiveConfigVersion, first.effectiveConfigVersion)
  assert.ok(other.effectiveBusinessConfig)
  const effective = await read(env, tokens.operator2, `/api/settings/effective?knownVersion=${first.effectiveConfigVersion}`)
  assert.equal(effective.version, other.effectiveConfigVersion)
  sqlite.exec("UPDATE users SET role_id='empty' WHERE id='operator'")
  const changed = await read(env, tokens.operator, `/api/bootstrap?knownEffectiveConfigVersion=${first.effectiveConfigVersion}`)
  assert.notEqual(changed.effectiveConfigVersion, first.effectiveConfigVersion)
  assert.equal(Object.hasOwn(changed, 'orders'), false)
})

test('shared order read policy fails closed and separates active cancelled and finished states', () => {
  for (const [status, active, history] of [['Em preparo', true, false], ['Finalizado', false, true], ['Cancelado', false, true], ['unknown', false, false]]) {
    assert.equal(canReadOrder({ status }, new Set(['orders.view'])), active)
    assert.equal(canReadOrder({ status }, new Set(['orders.history'])), history)
    assert.equal(canReadOrder({ status }, new Set()), false)
  }
  assert.equal(canReadOrder(null, new Set(['orders.view', 'orders.history'])), false)
})

test('mutation projection cannot expose unknown administrative collections or ungranted effects', () => {
  const payload = { order: { id: 'active', status: 'Em preparo' }, orders: [{ id: 'closed', status: 'Cancelado' }],
    client: { id: 'client' }, product: { id: 'product' }, table: { id: 'table' }, tableTab: { id: 'tab' },
    movement: { id: 'movement' }, movements: [], financeSettings: {}, receipts: [{}], balances: {}, reports: {}, receipt: { revision: 1 } }
  assert.deepEqual(projectMutationEffects(payload, new Set()), { deletedOrderIds: ['active', 'closed'] })
  assert.deepEqual(projectMutationEffects(payload, new Set(['orders.history'])), { orders: [{ id: 'closed', status: 'Cancelado' }], deletedOrderIds: ['active'] })
})

test('queue metadata allowlist excludes snapshots alternate copies and freeform error data', () => {
  const payload = { order: { id: 'active', status: 'Em preparo' }, printJob: {
    id: 'job', orderId: 'active', status: 'pending', availableAt: '2026-10-10T22:10:00.000Z',
    document: { customer: 'private snapshot' }, snapshotJson: 'private snapshot',
    nested: { document: 'private snapshot' }, lastError: { code: 'ERROR', message: 'private snapshot' },
  } }
  const result = projectMutationEffects(payload, new Set(['orders.history', 'printing.queue', 'printing.execute']))
  assert.deepEqual(result, { deletedOrderIds: ['active'], printJob: { id: 'job', orderId: 'active', status: 'pending', availableAt: '2026-10-10T22:10:00.000Z' } })
  const mismatched = { ...payload, order: { id: 'another', status: 'Em preparo' } }
  assert.equal(Object.hasOwn(projectMutationEffects(mismatched, new Set(['orders.view', 'printing.execute'])), 'printJob'), false)
})

test('finalizing without history read returns an eviction effect rather than a terminal order', async (t) => {
  const { env, tokens, sqlite, active } = await setup(t)
  sqlite.prepare('INSERT INTO role_capabilities(business_id,role_id,capability) VALUES(?,?,?)').run(BUSINESS, 'active', 'orders.finalize')
  const data = await read(env, tokens.active, `/api/orders/${active.id}/status`, 'PATCH', { status: 'Finalizado' })
  assert.deepEqual(data, { deletedOrderIds: [active.id] })
})

test('ordinary paid order creation with canonical none adjustment projects its persisted effects', async (t) => {
  const { env, tokens, sqlite } = await setup(t)
  const data = await read(env, tokens.operator, '/api/orders', 'POST', {
    customerIdentity: { type: 'registered_client', clientId: 'client' }, type: 'Retirada', orderDate: getBusinessDate(new Date()),
    items: [{ productId: 'product', quantity: 1 }], adjustment: { type: 'none', mode: 'fixed', value: 0, reason: '' },
    paymentAllocations: [{ methodCode: 'cash', amountCents: 2500 }],
  })
  assert.equal(data.order.paymentStatus, 'Pago')
  assert.equal(data.order.total, 25)
  assert.equal(Object.hasOwn(data, 'movements'), false)
  assert.equal(Object.hasOwn(data, 'financeSettings'), false)
  assert.equal(sqlite.prepare('SELECT count(*) n FROM movements WHERE order_id=?').get(data.order.id).n, 1)
})


test('authenticated individual payment route forwards the requested effective day and keeps permission protection', async (t) => {
  const { env, tokens, active, history, sqlite } = await setup(t)
  const retroactive = '2026-09-19'
  const result = await read(env, tokens.operator, `/api/orders/${active.id}/payment`, 'POST', {
    allocations: [{ methodCode: 'pix', amountCents: 2500 }],
    receivedDate: retroactive,
  })
  const persisted = sqlite.prepare('SELECT received_date, paid_at FROM payment_receipts WHERE id=?').get(result.receipt.id)
  assert.equal(persisted.received_date, retroactive)
  assert.notEqual(persisted.paid_at.slice(0, 10), retroactive)
  assert.equal(sqlite.prepare("SELECT movement_date FROM movements WHERE receipt_id=? AND source='order-payment'").get(result.receipt.id).movement_date, retroactive)

  const denied = await handleRequest(request(tokens.empty, `/api/orders/${history.id}/payment`, 'POST', {
    allocations: [{ methodCode: 'pix', amountCents: 2500 }], receivedDate: retroactive,
  }), env)
  assert.equal(denied.status, 403)
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM payment_receipts').get().n, 1)
})

test('individual payment HTTP route rejects a future receipt date without any financial effects', async (t) => {
  const { env, tokens, active, sqlite } = await setup(t)
  const future = '9999-12-31'
  const response = await handleRequest(request(tokens.operator, `/api/orders/${active.id}/payment`, 'POST', {
    allocations: [{ methodCode: 'pix', amountCents: 2500 }], receivedDate: future,
  }), env)
  assert.equal(response.status, 400)
  const body = await response.json()
  assert.equal(body.error.code, 'VALIDATION_ERROR')
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM payment_receipts').get().n, 0)
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM movements WHERE source='order-payment'").get().n, 0)
})


test('table-tab and client-batch HTTP payments forward the chosen effective date to their shared receipts',async(t)=>{
  const {env,tokens,history,local,db,input,now,sqlite}=await setup(t)
  const second=await createOrder(db,BUSINESS,input('date-batch-order'),now)
  await updateOrderStatus(db,BUSINESS,second.id,now)
  const date='2026-09-19'
  const group=await read(env,tokens.operator,'/api/clients/client/receivables/payment','POST',{
    orderIds:[history.id,second.id],allocations:[{methodCode:'pix',amountCents:5000}],
    mutationId:'date-http-client',receivedDate:date,
  })
  const table=await read(env,tokens.operator,`/api/table-tabs/${local.tableTabId}/payment`,'POST',{
    allocations:[{methodCode:'cash',amountCents:2500}],receivedDate:date,
  })
  for(const result of [group,table]){
    assert.equal(result.receipt.receivedDate,date)
    assert.equal(sqlite.prepare('SELECT received_date FROM payment_receipts WHERE id=?').get(result.receipt.id).received_date,date)
    assert.equal(sqlite.prepare("SELECT movement_date FROM movements WHERE receipt_id=? AND source='order-payment'").get(result.receipt.id).movement_date,date)
  }
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM payment_receipts').get().n,2)
})

test('table and client payment routes reject future effective date without side effects',async(t)=>{
  const {env,tokens,history,local,db,input,now,sqlite}=await setup(t)
  const second=await createOrder(db,BUSINESS,input('future-batch-order'),now)
  await updateOrderStatus(db,BUSINESS,second.id,now)
  for(const [path,payload] of [
    ['/api/clients/client/receivables/payment',{
      orderIds:[history.id,second.id],allocations:[{methodCode:'pix',amountCents:5000}],mutationId:'future-client',receivedDate:'9999-12-31',
    }],
    [`/api/table-tabs/${local.tableTabId}/payment`,{
      allocations:[{methodCode:'cash',amountCents:2500}],receivedDate:'9999-12-31',
    }],
  ]){
    const response=await handleRequest(request(tokens.operator,path,'POST',payload),env)
    assert.equal(response.status,400)
    assert.equal((await response.json()).error.code,'VALIDATION_ERROR')
  }
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM payment_receipts').get().n,0)
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM movements').get().n,0)
})


test('paid checkout HTTP route persists a distinct financial date while keeping commercial day and print job',async(t)=>{
  const {env,tokens,sqlite}=await setup(t)
  const commercialDay=getBusinessDate(new Date())
  const data=await read(env,tokens.operator,'/api/orders','POST',{
    customerIdentity:{type:'registered_client',clientId:'client'},type:'Retirada',
    orderDate:commercialDay,items:[{productId:'product',quantity:1}],
    paymentAllocations:[{methodCode:'pix',amountCents:2500}],receivedDate:'2026-09-19',
  })
  const receipt=sqlite.prepare('SELECT r.received_date,r.paid_at FROM payment_receipts r JOIN payments p ON p.receipt_id=r.id WHERE p.order_id=?').get(data.order.id)
  assert.equal(data.order.orderDate,commercialDay)
  assert.equal(receipt.received_date,'2026-09-19')
  assert.equal(sqlite.prepare("SELECT movement_date FROM movements WHERE source='order-payment' AND order_id=?").get(data.order.id).movement_date,'2026-09-19')
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM print_jobs WHERE order_id=?').get(data.order.id).n,1)
})

test('checkout HTTP rejects future date and effective date on unpaid orders without persisting effects',async(t)=>{
  const {env,tokens,sqlite}=await setup(t)
  for(const body of [
    {paymentAllocations:[{methodCode:'pix',amountCents:2500}],receivedDate:'9999-12-31'},
    {paymentAllocations:null,receivedDate:'2026-09-19'},
  ]){
    const response=await handleRequest(request(tokens.operator,'/api/orders','POST',{
      customerIdentity:{type:'registered_client',clientId:'client'},type:'Retirada',
      orderDate:getBusinessDate(new Date()),items:[{productId:'product',quantity:1}],...body,
    }),env)
    assert.equal(response.status,400)
    assert.equal((await response.json()).error.code,'VALIDATION_ERROR')
  }
  for(const table of ['payment_receipts','payments','movements','print_jobs'])
    assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM '+table).get().n,0)
})
