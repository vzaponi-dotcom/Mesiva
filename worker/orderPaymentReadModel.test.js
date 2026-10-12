import test from 'node:test'
import assert from 'node:assert/strict'
import * as paymentModel from './orderPaymentReadModel.js'
import { listOrders } from './orderReadRepository.js'
import { loadOrderById, loadBootstrap } from './repositories.js'
import { createSettingsDb } from './test-support/settingsDb.js'

const BIZ = 'amor-e-sabor'
const OTHER = 'settlement-read-other'
const NOW = '2026-10-12T13:00:00.000Z'
const DATE = '2026-10-12'

function dbFor(t) {
  const fixture = createSettingsDb()
  t.after(fixture.close)
  return fixture
}
function order(db, id, totalCents, businessId = BIZ) {
  db.prepare(`INSERT INTO orders (id,business_id,client_name_snapshot,type,order_date,status,subtotal_cents,total_cents,created_at)
    VALUES(?,?,?,'Entrega',?,'Em preparo',?,?,?)`)
    .run(id,businessId,id,DATE,totalCents,totalCents,NOW)
}
function receipt(db, id, cents, businessId = BIZ, methods = [cents]) {
  db.prepare('INSERT INTO payment_receipts(id,business_id,total_cents,paid_at,created_at) VALUES(?,?,?,?,?)')
    .run(id,businessId,cents,NOW,NOW)
  methods.forEach((amount,i) => db.prepare(`INSERT INTO payment_allocations
    (id,business_id,receipt_id,method_code,method_label,amount_cents,created_at)
    VALUES(?,?,?,NULL,?,?,?)`)
    .run(id+':alloc:'+i,businessId,id,i ? 'Dinheiro' : 'Pix',amount,NOW))
}
function original(db, id, orderId, receiptId, cents, businessId = BIZ) {
  db.prepare(`INSERT INTO payments(id,business_id,order_id,receipt_id,amount_cents,method,paid_at,created_at)
    VALUES(?,?,?,?,?,NULL,?,?)`).run(id,businessId,orderId,receiptId,cents,NOW,NOW)
}
function supplement(db, id, orderId, receiptId, cents, businessId = BIZ) {
  db.prepare(`INSERT INTO order_settlement_entries
    (id,business_id,order_id,kind,amount_cents,receipt_id,mutation_id,actor_name,created_at)
    VALUES(?,?,?,'supplemental_payment',?,?,?,'Operador',?)`)
    .run(id,businessId,orderId,cents,receiptId,id,NOW)
}
function refund(db, id, orderId, cents, source = 'order-edit-refund', businessId = BIZ) {
  db.prepare(`INSERT INTO movements(id,business_id,type,category,description,value_cents,source,order_id,movement_date,created_at,updated_at)
    VALUES(?,?,'saida','Devoluções','Devolução',?,?,?,?,?,?)`)
    .run('mov:'+id,businessId,cents,source,orderId,DATE,NOW,NOW)
  if(source === 'order-edit-refund') db.prepare(`INSERT INTO order_settlement_entries
    (id,business_id,order_id,kind,amount_cents,movement_id,mutation_id,actor_name,created_at)
    VALUES(?,?,?,'refund',?,?,?,'Operador',?)`)
    .run(id,businessId,orderId,cents,'mov:'+id,id,NOW)
}

test('Task 9 balance is calculated once in integer cents for due, paid and partial refunds', () => {
  assert.equal(typeof paymentModel.deriveOrderSettlementBalance, 'function', 'Task 9 canonical balance function is required')
  const balance = paymentModel.deriveOrderSettlementBalance
  const cases = [
    [8000,0,0,0,0,8000,0],
    [8000,8000,0,8000,8000,0,0],
    [9500,8000,0,8000,8000,1500,0],
    [9500,9500,0,9500,9500,0,0],
    [6500,8000,0,8000,8000,0,1500],
    [6500,8000,1000,8000,7000,0,500],
    [6500,8000,1500,8000,6500,0,0],
  ]
  for (const [total,gross,refunded,expectedGross,net,due,refundDue] of cases) {
    const result = balance({totalCents:total,grossReceivedCents:gross,refundedCents:refunded})
    assert.deepEqual([result.grossReceivedCents,result.refundedCents,result.netReceivedCents,result.dueCents,result.refundDueCents],
      [expectedGross,refunded,net,due,refundDue])
  }
  assert.throws(()=>balance({totalCents:6500,grossReceivedCents:8000,refundedCents:8001}),/INVALID|REFUND|BALANCE/)
  assert.throws(()=>balance({totalCents:10.1,grossReceivedCents:0,refundedCents:0}),/INVALID|BALANCE/)
})

test('Task 9 payment identity is preserved independently of derived settlement status', () => {
  const row = {
    total_cents:9500,payment_id:'payment-original',receipt_id:'receipt-original',
    paid_amount_cents:8000,gross_received_cents:8000,refunded_cents:0,
    payment_allocations_json:'[{"methodCode":"pix","methodLabel":"Pix","amountCents":8000}]',
  }
  const mapped = paymentModel.mapOrderPaymentFields(row)
  assert.equal(mapped.paymentId,'payment-original')
  assert.equal(mapped.paymentReceiptId,'receipt-original')
  assert.equal(mapped.paymentStatus,'Parcialmente pago')
  assert.equal(mapped.dueCents,1500)
  assert.equal(mapped.netReceivedCents,8000)
  assert.equal(mapped.paymentMethod,'Pix')
  assert.equal(paymentModel.mapOrderPaymentFields({...row,total_cents:6500}).paymentStatus,'Devolução pendente')
  assert.equal(paymentModel.mapOrderPaymentFields({...row,total_cents:6500,refunded_cents:1500}).paymentStatus,'Pago')
})

test('Task 9 real SQL reads shared receipts only once per order and keeps cardinality after multiple refunds',async t=>{
  const {db,sqlite}=dbFor(t)
  for(const [id,total] of [['one',9500],['two',6500],['three',6500],['unpaid',8000]])order(sqlite,id,total)
  receipt(sqlite,'original-one',8000)
  original(sqlite,'pay-one','one','original-one',8000)
  receipt(sqlite,'original-two',8000)
  original(sqlite,'pay-two','two','original-two',8000)
  receipt(sqlite,'shared',3000,BIZ,[2000,1000])
  supplement(sqlite,'credit-one','one','shared',1500)
  supplement(sqlite,'credit-two','two','shared',1500)
  refund(sqlite,'refund-two-1','two',1000)
  refund(sqlite,'refund-two-2','two',500)
  const all=await listOrders(db,BIZ)
  assert.equal(all.length,4)
  assert.equal(new Set(all.map(o=>o.id)).size,4,'one card per order regardless of receipt allocations/refunds')
  const one=all.find(o=>o.id==='one')
  const two=all.find(o=>o.id==='two')
  const three=all.find(o=>o.id==='three')
  const unpaid=all.find(o=>o.id==='unpaid')
  assert.deepEqual([one.grossReceivedCents,one.refundedCents,one.dueCents,one.paymentStatus], [9500,0,0,'Pago'])
  assert.deepEqual([two.grossReceivedCents,two.refundedCents,two.netReceivedCents,two.dueCents,two.refundDueCents],
    [9500,1500,8000,0,1500])
  assert.equal(two.paymentStatus,'Devolução pendente')
  assert.deepEqual([three.grossReceivedCents,three.dueCents],[0,6500])
  assert.deepEqual([unpaid.grossReceivedCents,unpaid.dueCents,unpaid.paymentStatus],[0,8000,'Pendente'])
  const detailed=await loadOrderById(db,BIZ,'two')
  assert.equal(detailed.netReceivedCents,8000)
  assert.equal(detailed.refundDueCents,1500)
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM payments WHERE order_id='two'").get().n,1)
  assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[])
})

test('Task 9 historical cancellation refund counts once; foreign business finance remains isolated',async t=>{
  const {db,sqlite}=dbFor(t)
  sqlite.prepare('INSERT INTO businesses(id,slug,name,created_at,updated_at) VALUES(?,?,?,?,?)').run(OTHER,OTHER,OTHER,NOW,NOW)
  order(sqlite,'historic',8000)
  receipt(sqlite,'h-receipt',8000)
  original(sqlite,'h-pay','historic','h-receipt',8000)
  refund(sqlite,'legacy-refund','historic',8000,'order-refund')
  order(sqlite,'foreign',9500,OTHER)
  receipt(sqlite,'foreign-r',9500,OTHER)
  original(sqlite,'foreign-p','foreign','foreign-r',9500,OTHER)
  const local=await listOrders(db,BIZ)
  assert.equal(local.length,1)
  assert.equal(local[0].grossReceivedCents,8000)
  assert.equal(local[0].refundedCents,8000)
  assert.equal(local[0].netReceivedCents,0)
  assert.equal(local[0].refundMovementId,'mov:legacy-refund')
  const remote=await listOrders(db,OTHER)
  assert.equal(remote.length,1)
  assert.equal(remote[0].grossReceivedCents,9500)
})
