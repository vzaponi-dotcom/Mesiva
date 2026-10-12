import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readdirSync, readFileSync } from 'node:fs'
import { createSettingsDb } from './test-support/settingsDb.js'

const NOW = '2026-10-12T12:00:00.000Z'
const DATE = '2026-10-12'
const BIZ = 'amor-e-sabor'
const OTHER = 'settlement-second-company'
const migration = '0043_order_settlement_ledger.sql'
const migrations = new URL('../migrations/', import.meta.url)
const files = () => readdirSync(migrations).filter(name => name.endsWith('.sql')).sort()

function seedBusiness(db, id) {
  db.prepare('INSERT INTO businesses(id,slug,name,created_at,updated_at) VALUES(?,?,?,?,?)')
    .run(id,id,id,NOW,NOW)
}
function seedOrder(db, id, businessId = BIZ) {
  db.prepare("INSERT INTO orders(id,business_id,client_name_snapshot,type,order_date,status,subtotal_cents,total_cents,created_at) VALUES(?,?,?,'Entrega',?,'Em preparo',8000,8000,?)")
    .run(id,businessId,'Cliente',DATE,NOW)
}
function seedReceipt(db, { id, businessId = BIZ, cents, allocations = [cents] }) {
  db.prepare('INSERT INTO payment_receipts(id,business_id,total_cents,paid_at,created_at) VALUES(?,?,?,?,?)')
    .run(id,businessId,cents,NOW,NOW)
  for (let index = 0; index < allocations.length; index += 1) {
    db.prepare('INSERT INTO payment_allocations(id,business_id,receipt_id,method_code,method_label,amount_cents,created_at) VALUES(?,?,?,NULL,?,?,?)')
      .run(id+':allocation:'+index,businessId,id,index ? 'Dinheiro' : 'Pix',allocations[index],NOW)
  }
}
function seedPayment(db, id, orderId, receiptId, cents = 8000, businessId = BIZ) {
  db.prepare('INSERT INTO payments(id,business_id,order_id,receipt_id,amount_cents,method,paid_at,created_at) VALUES(?,?,?,?,?,NULL,?,?)')
    .run(id,businessId,orderId,receiptId,cents,NOW,NOW)
}
function seedMovement(db, {id, orderId, businessId = BIZ, cents, type = 'saida', source = 'order-edit-refund'}) {
  db.prepare('INSERT INTO movements(id,business_id,type,category,description,value_cents,source,order_id,movement_date,created_at,updated_at,payment_method) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(id,businessId,type,'Devoluções','Devolução de pedido',cents,source,orderId,DATE,NOW,NOW,'Pix')
}
function actor(db, businessId = BIZ, name = 'Operador') {
  const roleId = businessId + ':settlement-role'
  const userId = businessId + ':settlement-user'
  db.prepare("INSERT INTO roles(id,business_id,code,name,created_at,updated_at) VALUES(?,?,?,'Operador',?,?)")
    .run(roleId,businessId,'settlement-test-role',NOW,NOW)
  db.prepare('INSERT INTO users(id,business_id,display_name,login_normalized,role_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
    .run(userId,businessId,name,userId,roleId,NOW,NOW)
  return userId
}
function add(db, {
  id, orderId, kind, amountCents, receiptId = null, movementId = null,
  businessId = BIZ, mutationId = id, actorUserId = null,
}) {
  db.prepare(`INSERT INTO order_settlement_entries
   (id,business_id,order_id,kind,amount_cents,receipt_id,movement_id,mutation_id,actor_user_id,actor_name,created_at)
   VALUES(?,?,?,?,?,?,?,?,?,'Operador',?)`)
    .run(id,businessId,orderId,kind,amountCents,receiptId,movementId,mutationId,actorUserId,NOW)
}
function clean(t) {
  const fixture = createSettingsDb()
  t.after(fixture.close)
  return fixture.sqlite
}
function upgrade(t) {
  const db = new DatabaseSync(':memory:')
  t.after(() => db.close())
  for (const name of files().filter(name => name < migration)) {
    const sql = readFileSync(new URL(name,migrations),'utf8')
    if (Number(name.slice(0,4)) < 24) db.exec(sql)
    else {
      db.exec('BEGIN')
      try { db.exec(sql); db.exec('COMMIT') }
      catch (e) { db.exec('ROLLBACK'); throw e }
    }
  }
  db.exec('PRAGMA foreign_keys=ON')
  return db
}

test('0043 clean installation adds only an empty immutable settlement ledger and keeps the legacy unique payment contract',t=>{
  const db=clean(t)
  assert.equal(files().at(-1),migration)
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='order_settlement_entries'").get())
  assert.equal(db.prepare('SELECT COUNT(*) n FROM order_settlement_entries').get().n,0)
  const paymentIndexes=db.prepare('PRAGMA index_list(payments)').all()
  assert.ok(paymentIndexes.some(index=>Number(index.unique)===1 && db.prepare(`PRAGMA index_info("${index.name}")`).all().some(col=>col.name==='order_id')))
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[])
})

test('0043 upgrade preserves historical order, payment, receipt, allocation and movement bytes',t=>{
  const db=upgrade(t)
  seedOrder(db,'historical')
  seedReceipt(db,{id:'old-receipt',cents:8000,allocations:[4000,4000]})
  seedPayment(db,'old-payment','historical','old-receipt')
  seedMovement(db,{id:'old-movement',orderId:'historical',cents:8000,type:'entrada',source:'manual'})
  const tables=['orders','payments','payment_receipts','payment_allocations','movements']
  const before=Object.fromEntries(tables.map(name=>[name,db.prepare(`SELECT * FROM ${name}`).all()]))
  db.exec('BEGIN')
  try {db.exec(readFileSync(new URL(migration,migrations),'utf8'));db.exec('COMMIT')}
  catch(e){db.exec('ROLLBACK');throw e}
  for(const name of tables)assert.deepEqual(db.prepare(`SELECT * FROM ${name}`).all(),before[name],name)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM order_settlement_entries').get().n,0)
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[])
})

test('a paid order can receive supplemental receipts without making a second payments row',t=>{
  const db=clean(t)
  seedOrder(db,'paid')
  seedReceipt(db,{id:'original',cents:8000})
  seedPayment(db,'existing-pay','paid','original')
  seedReceipt(db,{id:'supplement',cents:1500,allocations:[1000,500]})
  add(db,{id:'supp-1',orderId:'paid',kind:'supplemental_payment',receiptId:'supplement',amountCents:1500})
  assert.equal(db.prepare("SELECT SUM(amount_cents) n FROM order_settlement_entries WHERE order_id='paid'").get().n,1500)
  assert.equal(db.prepare("SELECT COUNT(*) n FROM payments WHERE order_id='paid'").get().n,1)
  assert.equal(db.prepare("SELECT COUNT(*) n FROM payment_allocations WHERE receipt_id='supplement'").get().n,2)
  assert.throws(()=>seedPayment(db,'illegal-second','paid','supplement',1500),/UNIQUE/)
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[])
})

test('shared receipts attribute value once per order and cannot be assigned beyond their total',t=>{
  const db=clean(t)
  for(const id of ['one','two','three'])seedOrder(db,id)
  seedReceipt(db,{id:'shared',cents:3000,allocations:[2000,1000]})
  add(db,{id:'credit-one',orderId:'one',kind:'supplemental_payment',receiptId:'shared',amountCents:1200})
  add(db,{id:'credit-two',orderId:'two',kind:'supplemental_payment',receiptId:'shared',amountCents:1800})
  assert.equal(db.prepare("SELECT SUM(amount_cents) n FROM order_settlement_entries WHERE receipt_id='shared'").get().n,3000)
  assert.throws(()=>add(db,{id:'over',orderId:'three',kind:'supplemental_payment',receiptId:'shared',amountCents:1}),/OVERALLOCATED|CHECK/)
  assert.throws(()=>add(db,{id:'duplicate-order-credit',orderId:'one',kind:'supplemental_payment',receiptId:'shared',amountCents:1}),/UNIQUE|OVERALLOCATED/)
  assert.equal(db.prepare("SELECT SUM(amount_cents) n FROM payment_allocations WHERE receipt_id='shared'").get().n,3000)
  assert.throws(()=>db.prepare("UPDATE payment_receipts SET total_cents=4000 WHERE id='shared'").run(),/IMMUTABLE/)
  assert.throws(()=>db.prepare("UPDATE payment_allocations SET amount_cents=2500 WHERE receipt_id='shared'").run(),/IMMUTABLE/)
  assert.throws(()=>db.prepare("DELETE FROM payment_allocations WHERE receipt_id='shared'").run(),/IMMUTABLE/)
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[])
})

test('refunds support multiple distinct exit movements but reject fabricated or mismatched exits',t=>{
  const db=clean(t)
  seedOrder(db,'refunded')
  seedMovement(db,{id:'exit-1',orderId:'refunded',cents:1000})
  seedMovement(db,{id:'exit-2',orderId:'refunded',cents:500})
  add(db,{id:'refund-1',orderId:'refunded',kind:'refund',movementId:'exit-1',amountCents:1000})
  add(db,{id:'refund-2',orderId:'refunded',kind:'refund',movementId:'exit-2',amountCents:500})
  assert.equal(db.prepare("SELECT COUNT(*) n FROM order_settlement_entries WHERE kind='refund'").get().n,2)
  assert.throws(()=>add(db,{id:'duplicate-movement',orderId:'refunded',kind:'refund',movementId:'exit-1',amountCents:1000}),/UNIQUE/)
  assert.throws(()=>add(db,{id:'wrong-amount',orderId:'refunded',kind:'refund',movementId:'exit-2',amountCents:1}),/MISMATCH|UNIQUE/)
  assert.throws(()=>add(db,{id:'missing-exit',orderId:'refunded',kind:'refund',movementId:'missing',amountCents:1}),/FOREIGN KEY|MISMATCH/)
  assert.throws(()=>db.prepare("UPDATE movements SET value_cents=100 WHERE id='exit-1'").run(),/IMMUTABLE/)
  assert.throws(()=>db.prepare("DELETE FROM movements WHERE id='exit-1'").run(),/IMMUTABLE/)
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[])
})

test('mutation, kind, actor and cross-tenant references are constrained and entries cannot be rewritten',t=>{
  const db=clean(t)
  seedOrder(db,'local')
  seedBusiness(db,OTHER)
  seedOrder(db,'foreign',OTHER)
  const localActor=actor(db)
  const remoteActor=actor(db,OTHER,'Estranho')
  seedReceipt(db,{id:'local-receipt',cents:1500})
  seedReceipt(db,{id:'foreign-receipt',businessId:OTHER,cents:1500})
  seedReceipt(db,{id:'actor-check-receipt',cents:1500})
  add(db,{id:'first',orderId:'local',kind:'supplemental_payment',receiptId:'local-receipt',amountCents:1000,actorUserId:localActor,mutationId:'same'})
  assert.throws(()=>add(db,{id:'duplicate-mutation',orderId:'local',kind:'supplemental_payment',receiptId:'local-receipt',amountCents:500,mutationId:'same'}),/UNIQUE/)
  assert.throws(()=>add(db,{id:'wrong-company-order',orderId:'foreign',kind:'supplemental_payment',receiptId:'local-receipt',amountCents:100}),/FOREIGN KEY/)
  assert.throws(()=>add(db,{id:'wrong-company-receipt',orderId:'local',kind:'supplemental_payment',receiptId:'foreign-receipt',amountCents:100}),/FOREIGN KEY|ORDER_SETTLEMENT_RECEIPT_INVALID/)
  assert.throws(()=>add(db,{id:'wrong-company-actor',orderId:'local',kind:'supplemental_payment',receiptId:'actor-check-receipt',amountCents:100,actorUserId:remoteActor}),/FOREIGN KEY/)
  assert.throws(()=>add(db,{id:'bad-kind',orderId:'local',kind:'arbitrary',receiptId:'local-receipt',amountCents:100}),/CHECK/)
  assert.throws(()=>add(db,{id:'zero',orderId:'local',kind:'supplemental_payment',receiptId:'local-receipt',amountCents:0}),/CHECK/)
  assert.throws(()=>add(db,{id:'bad-shape',orderId:'local',kind:'refund',receiptId:'local-receipt',amountCents:100}),/CHECK|ORDER_SETTLEMENT_REFUND_MISMATCH/)
  assert.throws(()=>db.prepare("UPDATE order_settlement_entries SET amount_cents=999 WHERE id='first'").run(),/IMMUTABLE/)
  assert.throws(()=>db.prepare("DELETE FROM order_settlement_entries WHERE id='first'").run(),/IMMUTABLE/)
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[])
})
