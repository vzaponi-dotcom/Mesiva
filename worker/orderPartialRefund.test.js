import test from 'node:test'
import assert from 'node:assert/strict'
import { createSettingsDb } from './test-support/settingsDb.js'
import { loadOrderById } from './repositories.js'
import { registerOrderPartialRefund } from './orderPartialRefund.js'
import { cancelOrder, registerOrderRefund } from './orderCancellation.js'

const BIZ='amor-e-sabor'
const NOW=new Date('2026-10-12T16:00:00.000Z')
const AT=NOW.toISOString()
function setup(t,total=6500,paid=8000) {
  const f=createSettingsDb(); t.after(f.close)
  const s=f.sqlite
  s.prepare("INSERT INTO orders(id,business_id,client_name_snapshot,type,order_date,status,subtotal_cents,total_cents,created_at) VALUES('o1',?,'Cliente','Entrega','2026-10-12','Em preparo',?,?,?)").run(BIZ,total,total,AT)
  s.prepare("INSERT INTO payment_receipts(id,business_id,total_cents,paid_at,created_at) VALUES('r1',?,?,?,?)").run(BIZ,paid,AT,AT)
  s.prepare("INSERT INTO payment_allocations(id,business_id,receipt_id,method_code,method_label,amount_cents,created_at) VALUES('a1',?,'r1','pix','Pix',?,?)").run(BIZ,paid,AT)
  s.prepare("INSERT INTO payments(id,business_id,order_id,receipt_id,amount_cents,method,paid_at,created_at) VALUES('p1',?,'o1','r1',?,NULL,?,?)").run(BIZ,paid,AT,AT)
  return {s,db:f.db}
}
const request=(mutationId,amountCents,expectedNetReceivedCents=8000)=>({
  mutationId,amountCents,refundMethod:'Pix',expectedContentRevision:0,
  expectedTotalCents:6500,expectedNetReceivedCents,
})
const number=(s,table,where='1=1')=>s.prepare('SELECT count(*) n FROM '+table+' WHERE '+where).get().n

test('Task 11 saving a lower total only exposes refundDue and does not automatically pay it',async t=>{
  const {db,s}=setup(t)
  const o=await loadOrderById(db,BIZ,'o1')
  assert.deepEqual([o.netReceivedCents,o.refundDueCents,o.paymentStatus],[8000,1500,'Devolução pendente'])
  assert.equal(number(s,'movements'),0)
  assert.equal(number(s,'order_settlement_entries'),0)
})

test('Task 11 two actual partial refunds of R$10 and R$5 settle refund due without touching original receipt',async t=>{
  const {db,s}=setup(t)
  const first=await registerOrderPartialRefund(db,BIZ,'o1',request('refund-1',1000),NOW)
  assert.equal(first.movement.valueCents,1000)
  assert.equal(first.order.refundDueCents,500)
  const second=await registerOrderPartialRefund(db,BIZ,'o1',request('refund-2',500,7000),new Date(+NOW+1000))
  assert.equal(second.movement.valueCents,500)
  assert.equal(second.order.netReceivedCents,6500)
  assert.equal(second.order.refundDueCents,0)
  assert.equal(number(s,'payments'),1)
  assert.equal(number(s,'payment_receipts'),1)
  assert.equal(number(s,'movements',"source='order-edit-refund'"),2)
  assert.equal(number(s,'order_settlement_entries',"kind='refund'"),2)
  assert.equal(number(s,'order_partial_refund_mutation_receipts'),2)
  assert.deepEqual(s.prepare('PRAGMA foreign_key_check').all(),[])
})

test('Task 11 refund replay after uncertain batch response is idempotent; altered amount conflicts',async t=>{
  const {db,s}=setup(t)
  const batch=db.batch.bind(db)
  let first=true
  db.batch=async statements=>{
    const result=await batch(statements)
    if(first){first=false;throw new Error('lost response after commit')}
    return result
  }
  const saved=await registerOrderPartialRefund(db,BIZ,'o1',request('retry',1000),NOW)
  const replay=await registerOrderPartialRefund(db,BIZ,'o1',request('retry',1000),new Date(+NOW+1000))
  assert.equal(saved.movement.id,replay.movement.id)
  await assert.rejects(registerOrderPartialRefund(db,BIZ,'o1',request('retry',500),NOW),
    {status:409,code:'ORDER_PARTIAL_REFUND_CONFLICT'})
  assert.equal(number(s,'movements'),1)
  assert.equal(number(s,'order_settlement_entries'),1)
})

test('Task 11 over-refund, stale state and foreign-tenant requests are refused without new movements',async t=>{
  const {db,s}=setup(t)
  await assert.rejects(registerOrderPartialRefund(db,BIZ,'o1',request('too-big',1501),NOW),
    {status:409,code:'ORDER_PARTIAL_REFUND_CONFLICT'})
  await assert.rejects(registerOrderPartialRefund(db,BIZ,'o1',request('stale',500,7000),NOW),
    {status:409,code:'ORDER_PARTIAL_REFUND_CONFLICT'})
  await assert.rejects(registerOrderPartialRefund(db,'other-business','o1',request('foreign',500),NOW),
    {status:404,code:'ORDER_NOT_FOUND'})
  s.prepare("UPDATE orders SET content_revision=1 WHERE id='o1'").run()
  await assert.rejects(registerOrderPartialRefund(db,BIZ,'o1',request('revision',500),NOW),
    {status:409,code:'ORDER_PARTIAL_REFUND_CONFLICT'})
  assert.equal(number(s,'movements'),0)
})

test('Task 11 cancellation after supplement of 15 refunds exactly 95 in one legacy cancellation movement',async t=>{
  const {db,s}=setup(t,9500,8000)
  s.prepare("INSERT INTO payment_receipts(id,business_id,total_cents,paid_at,created_at) VALUES('r2',?,?,?,?)").run(BIZ,1500,AT,AT)
  s.prepare("INSERT INTO payment_allocations(id,business_id,receipt_id,method_code,method_label,amount_cents,created_at) VALUES('a2',?,'r2','pix','Pix',1500,?)").run(BIZ,AT)
  s.prepare("INSERT INTO order_settlement_entries(id,business_id,order_id,kind,amount_cents,receipt_id,mutation_id,actor_name,created_at) VALUES('supp-1',?,'o1','supplemental_payment',1500,'r2','supp-1','Operador',?)").run(BIZ,AT)
  const result=await cancelOrder(db,BIZ,'o1',{reason:'entry_error',refundNow:true,refundMethod:'Pix'},NOW)
  assert.equal(result.movement.valueCents,9500)
  assert.equal(result.order.netReceivedCents,0)
  assert.equal(result.order.refundState,'refunded')
  assert.equal(s.prepare("SELECT sum(value_cents) n FROM movements WHERE source='order-refund'").get().n,9500)
})

test('Task 11 cancellation following 15 already refunded returns only remaining 80; deferred refund is idempotently rejected',async t=>{
  const {db,s}=setup(t)
  await registerOrderPartialRefund(db,BIZ,'o1',request('part-1',1000),NOW)
  await registerOrderPartialRefund(db,BIZ,'o1',request('part-2',500,7000),NOW)
  const result=await cancelOrder(db,BIZ,'o1',{reason:'entry_error',refundNow:true,refundMethod:'Pix'},NOW)
  assert.equal(result.movement.valueCents,6500)
  assert.equal(result.order.netReceivedCents,0)
  assert.equal(result.order.refundState,'refunded')
  assert.equal(s.prepare("SELECT sum(value_cents) n FROM movements WHERE source='order-refund'").get().n,6500)
  await assert.rejects(registerOrderRefund(db,BIZ,'o1',{refundMethod:'Pix'},NOW),
    {status:409,code:'ORDER_ALREADY_REFUNDED'})
})

test('Task 11 races between reading balance and commit roll back the full refund',async t=>{
  const {db,s}=setup(t)
  const batch=db.batch.bind(db)
  db.batch=async statements=>{
    s.prepare("UPDATE orders SET total_cents=7000 WHERE id='o1'").run()
    return batch(statements)
  }
  await assert.rejects(registerOrderPartialRefund(db,BIZ,'o1',request('race',1000),NOW),
    {status:409,code:'ORDER_PARTIAL_REFUND_CONFLICT'})
  assert.equal(number(s,'movements'),0)
  assert.equal(number(s,'order_settlement_entries'),0)
})
