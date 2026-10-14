import test from 'node:test'
import assert from 'node:assert/strict'
import * as repository from './orderReadRepository.js'
import { createSettingsDb } from './test-support/settingsDb.js'
import { seedOperationalReadFixture } from './test-support/operationalReadFixture.js'

const BUSINESS = 'amor-e-sabor', FOREIGN = 'foreign-read-company'
const sortOrders = orders => [...orders].sort((a,b) => a.createdAt === b.createdAt
  ? (a.id < b.id ? 1 : a.id > b.id ? -1 : 0) : (a.createdAt < b.createdAt ? 1 : -1))
const readSelected = (db,businessId,ids) => {
  assert.equal(typeof repository.listOrdersByIds,'function','missing listOrdersByIds')
  return repository.listOrdersByIds(db,businessId,ids)
}
function setup(t) {
  const f = createSettingsDb({ beforeSpecB(sqlite) {
    sqlite.prepare(`INSERT INTO businesses (id,slug,name,created_at,updated_at)
      VALUES (?,?,?,'2026-10-13','2026-10-13')`).run(FOREIGN,FOREIGN,'Empresa fictícia')
  } })
  t.after(f.close)
  return f
}

test('empty IDs return without querying D1', async () => {
  const db = { prepare() { assert.fail('empty read must not prepare SQL') } }
  assert.deepEqual(await readSelected(db,BUSINESS,[]),[])
})

test('selected orders keep items, payment, refund, cancellation and historical contract', async t => {
  const { db,sqlite } = setup(t)
  const { activeIds,historicalIds } = await seedOperationalReadFixture(db,{historicalOrders:3,activeOrders:2,itemsPerOrder:2})
  const cancelled = activeIds[0], paid = historicalIds[0]
  sqlite.prepare(`UPDATE orders SET status='Cancelado',cancelled_at='2026-10-13T14:00:00.000Z',
    cancel_reason='client_changed_mind',cancel_reason_note='Solicitado pelo cliente',
    scheduled_for='2026-10-13T15:00:00.000Z',is_backdated=1 WHERE id=?`).run(cancelled)
  sqlite.exec(`INSERT INTO payment_receipts (id,business_id,total_cents,paid_at,created_at)
    VALUES ('read-receipt','amor-e-sabor',2000,'2026-10-13T13:00:00.000Z','2026-10-13T13:00:00.000Z');
    INSERT INTO payment_allocations (id,business_id,receipt_id,method_code,method_label,amount_cents,created_at)
    VALUES ('read-allocation','amor-e-sabor','read-receipt','pix','Pix',2000,'2026-10-13T13:00:00.000Z');`)
  sqlite.prepare(`INSERT INTO payments (id,business_id,order_id,receipt_id,amount_cents,paid_at,created_at)
    VALUES ('read-payment',?,?,'read-receipt',2000,'2026-10-13T13:00:00.000Z','2026-10-13T13:00:00.000Z')`).run(BUSINESS,paid)
  sqlite.prepare(`INSERT INTO movements (id,business_id,type,category,description,value_cents,source,order_id,payment_id,movement_date,created_at)
    VALUES ('read-refund',?,'saida','Reembolso','Fictício',2000,'order-refund',?,'read-payment','2026-10-13','2026-10-13T14:00:00.000Z')`).run(BUSINESS,paid)
  const requested = [cancelled,paid], before = sqlite.prepare('SELECT total_changes() AS n').get().n
  const selected = await readSelected(db,BUSINESS,[...requested,cancelled,'not-found'])
  const all = await repository.listOrders(db,BUSINESS)
  assert.deepEqual(selected,sortOrders(all.filter(order=>requested.includes(order.id))))
  assert.equal(sqlite.prepare('SELECT total_changes() AS n').get().n,before)
  const cancelledOrder = selected.find(order=>order.id===cancelled)
  assert.equal(cancelledOrder.status,'Cancelado')
  assert.equal(cancelledOrder.cancelledAt,'2026-10-13T14:00:00.000Z')
  assert.equal(cancelledOrder.scheduledFor,'2026-10-13T15:00:00.000Z')
  assert.equal(cancelledOrder.isBackdated,true)
  assert.equal(cancelledOrder.items.length,2)
  assert.equal(cancelledOrder.items[0].note,'Sem cebola')
  const paidOrder = selected.find(order=>order.id===paid)
  assert.equal(paidOrder.status,'Finalizado')
  assert.equal(paidOrder.paymentStatus,'Pago')
  assert.deepEqual(paidOrder.paymentAllocations,[{methodCode:'pix',methodLabel:'Pix',amountCents:2000}])
  assert.equal(paidOrder.refundMovementId,'read-refund')
})

test('selected table orders preserve comanda and reservation snapshots', async t => {
  const { db,sqlite } = setup(t)
  const { activeIds } = await seedOperationalReadFixture(db,{activeOrders:2})
  const at='2026-10-13T12:00:00.000Z'
  sqlite.prepare(`INSERT INTO tables (id,business_id,name,name_key,sort_order,is_active,created_at,updated_at)
    VALUES ('read-table',?,'Mesa fictícia','mesa-ficticia',50,1,?,?)`).run(BUSINESS,at,at)
  sqlite.prepare(`INSERT INTO table_tabs (id,business_id,table_identifier,status,opened_at,created_at,updated_at,table_id,tab_number)
    VALUES ('read-tab',?,'Mesa fictícia','open',?,?,?,'read-table',42)`).run(BUSINESS,at,at,at)
  sqlite.prepare(`UPDATE orders SET type='Local',customer_identity_type='table',table_tab_id='read-tab' WHERE id=?`).run(activeIds[0])
  sqlite.prepare(`UPDATE orders SET type='Local',scheduled_for=? WHERE id=?`).run(at,activeIds[1])
  sqlite.prepare(`INSERT INTO table_reservations
    (id,business_id,order_id,table_id,table_name_snapshot,status,scheduled_for,ends_at,duration_minutes,revision,created_at,updated_at)
    VALUES ('read-reservation',?,?,'read-table','Mesa fictícia','reserved',?,'2026-10-13T13:00:00.000Z',60,4,?,?)`)
    .run(BUSINESS,activeIds[1],at,at,at)
  const orders = await readSelected(db,BUSINESS,activeIds)
  assert.equal(orders.find(o=>o.id===activeIds[0]).tableTabId,'read-tab')
  assert.equal(orders.find(o=>o.id===activeIds[0]).tableIdentifier,'Mesa fictícia')
  const reserved = orders.find(o=>o.id===activeIds[1])
  assert.equal(reserved.tableReservationId,'read-reservation')
  assert.equal(reserved.reservationRevision,4)
  assert.equal(reserved.reservationTableName,'Mesa fictícia')
})

test('foreign and nonexistent IDs return no data or foreign items', async t => {
  const { db } = setup(t)
  const own = await seedOperationalReadFixture(db,{activeOrders:1})
  const foreign = await seedOperationalReadFixture(db,{businessId:FOREIGN,activeOrders:1})
  const orders = await readSelected(db,BUSINESS,[foreign.activeIds[0],own.activeIds[0],'not-found',own.activeIds[0]])
  assert.deepEqual(orders.map(o=>o.id),own.activeIds)
  assert.equal(orders[0].items.length,5)
  assert.deepEqual(await readSelected(db,BUSINESS,foreign.activeIds),[])
})

test('large ID sets stay within D1 bindings and sort across batches with tied dates', async t => {
  const { db } = setup(t)
  const { activeIds } = await seedOperationalReadFixture(db,{activeOrders:205,itemsPerOrder:1})
  let statements=0
  const guardedDb = { ...db,prepare(sql) {
    const statement=db.prepare(sql)
    return { ...statement,bind(...values) {
      statements+=1
      assert.ok(values.length<=100,'D1 accepts at most 100 bindings')
      return statement.bind(...values)
    } }
  } }
  const orders=await readSelected(guardedDb,BUSINESS,[...activeIds.reverse(),activeIds[0]])
  assert.equal(orders.length,205)
  assert.ok(statements>=6,'orders and items must be split into bounded batches')
  assert.deepEqual(orders.map(o=>o.id),[...new Set(activeIds)].sort().reverse())
  assert.ok(orders.every(o=>o.items.length===1))
})
