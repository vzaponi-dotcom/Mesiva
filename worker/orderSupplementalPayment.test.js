import assert from 'node:assert/strict'
import test from 'node:test'
import { createSettingsDb } from './test-support/settingsDb.js'
import { registerOrderSupplementalPayment } from './orderSupplementalPayment.js'
import { loadOrderById } from './repositories.js'

const BIZ = 'amor-e-sabor'
const OTHER = 'supplement-other-business'
const NOW = new Date('2026-10-12T15:00:00.000Z')
const STAMP = NOW.toISOString()
const alloc = (...parts) => parts.map(([methodCode,amountCents]) => ({methodCode,amountCents}))
const one = alloc(['pix',1500])
const split = alloc(['pix',1000],['cash',500])

function fixture(t) {
  const f=createSettingsDb();t.after(f.close)
  const s=f.sqlite
  s.prepare("INSERT INTO orders(id,business_id,client_name_snapshot,type,order_date,status,subtotal_cents,total_cents,created_at) VALUES('order-1',?,'Maria','Entrega','2026-10-12','Em preparo',9500,9500,?)").run(BIZ,STAMP)
  s.prepare('INSERT INTO payment_receipts(id,business_id,total_cents,paid_at,created_at) VALUES(?,?,?,?,?)').run('old-receipt',BIZ,8000,STAMP,STAMP)
  s.prepare('INSERT INTO payment_allocations(id,business_id,receipt_id,method_code,method_label,amount_cents,created_at) VALUES(?,?,?,?,?,?,?)')
    .run('old-allocation',BIZ,'old-receipt','pix','Pix',8000,STAMP)
  s.prepare("INSERT INTO payments(id,business_id,order_id,receipt_id,amount_cents,method,paid_at,created_at) VALUES('old-payment',?,'order-1','old-receipt',8000,NULL,?,?)").run(BIZ,STAMP,STAMP)
  return {s,db:f.db}
}
const request=(mutationId='mut-1',allocations=one)=>({
  mutationId,expectedContentRevision:0,expectedTotalCents:9500,expectedNetReceivedCents:8000,allocations,
})
function count(s,table,where='1=1') {
  return s.prepare('SELECT count(*) n FROM '+table+' WHERE '+where).get().n
}

test('Task 10 supplementary Pix payment reconciles one due amount without second legacy payment',async t=>{
  const {s,db}=fixture(t)
  const result=await registerOrderSupplementalPayment(db,BIZ,'order-1',request(),NOW)
  assert.equal(result.receipt.totalCents,1500)
  assert.equal(result.allocations.length,1)
  assert.equal(result.order.paymentStatus,'Pago')
  assert.equal(result.order.dueCents,0)
  assert.equal(result.order.grossReceivedCents,9500)
  assert.equal(count(s,'payments',"order_id='order-1'"),1)
  assert.equal(count(s,'order_settlement_entries',"kind='supplemental_payment'"),1)
  assert.equal(count(s,'order_supplemental_mutation_receipts'),1)
  assert.equal(count(s,'payment_receipts'),2)
  assert.equal(count(s,'payment_allocations'),2)
  assert.equal(count(s,'movements',"type='entrada'"),1)
  assert.equal(s.prepare("SELECT COALESCE(SUM(value_cents),0) n FROM movements WHERE type='entrada'").get().n,1500)
  assert.deepEqual(s.prepare('PRAGMA foreign_key_check').all(),[])
})

test('Task 10 mixed Pix/cash payment generates one receipt and precisely two cash movements',async t=>{
  const {s,db}=fixture(t)
  const result=await registerOrderSupplementalPayment(db,BIZ,'order-1',request('mixed',split),NOW)
  assert.equal(result.allocations.length,2)
  assert.deepEqual(s.prepare("SELECT method_code,amount_cents FROM payment_allocations WHERE receipt_id=? ORDER BY method_code").all(result.receipt.id)
      .map(({method_code,amount_cents})=>({method_code,amount_cents})),
    [{method_code:'cash',amount_cents:500},{method_code:'pix',amount_cents:1000}])
  const movements=s.prepare("SELECT value_cents,payment_id,receipt_id,payment_allocation_id FROM movements WHERE type='entrada' ORDER BY value_cents").all()
  assert.deepEqual(movements.map(m=>m.value_cents),[500,1000])
  assert.ok(movements.every(m=>m.payment_id===null&&m.receipt_id===result.receipt.id&&m.payment_allocation_id))
  assert.equal(count(s,'payments'),1)
  assert.equal(count(s,'order_settlement_entries'),1)
})

test('Task 10 repeated mutation replays saved receipt after unknown response but changed payload fails closed',async t=>{
  const {s,db}=fixture(t)
  const originalBatch=db.batch.bind(db)
  let lost=true
  db.batch=async statements=>{
    const answer=await originalBatch(statements)
    if(lost){lost=false;throw new Error('network response lost')}
    return answer
  }
  const first=await registerOrderSupplementalPayment(db,BIZ,'order-1',request('retry',split),NOW)
  const repeat=await registerOrderSupplementalPayment(db,BIZ,'order-1',request('retry',split),new Date(+NOW+5000))
  assert.equal(first.receipt.id,repeat.receipt.id)
  assert.equal(first.entry.id,repeat.entry.id)
  assert.equal(count(s,'payment_receipts'),2)
  assert.equal(count(s,'movements'),2)
  await assert.rejects(registerOrderSupplementalPayment(db,BIZ,'order-1',request('retry',one),NOW),
    {status:409,code:'ORDER_SUPPLEMENTAL_CONFLICT'})
  assert.equal(count(s,'payment_receipts'),2)
})

test('Task 10 stale revision/net, invalid allocation, cancelled and unpaid orders reject without side-effects',async t=>{
  const {s,db}=fixture(t)
  const expectConflict=(input,code='ORDER_SUPPLEMENTAL_CONFLICT')=>assert.rejects(
    registerOrderSupplementalPayment(db,BIZ,'order-1',input,NOW),{status:409,code})
  await expectConflict({...request('stale-rev'),expectedContentRevision:1})
  await expectConflict({...request('stale-total'),expectedTotalCents:9600})
  await expectConflict({...request('stale-net'),expectedNetReceivedCents:7000})
  await assert.rejects(registerOrderSupplementalPayment(db,BIZ,'order-1',request('invalid-amount',alloc(['pix',1000])),NOW),
    {status:400,code:'VALIDATION_ERROR'})
  s.prepare("UPDATE orders SET status='Cancelado' WHERE id='order-1'").run()
  await expectConflict(request('cancelled'))
  s.prepare("UPDATE orders SET status='Em preparo' WHERE id='order-1'").run()
  s.prepare("DELETE FROM payments WHERE id='old-payment'").run()
  await expectConflict(request('unpaid'))
  assert.equal(count(s,'payment_receipts'),1)
  assert.equal(count(s,'order_settlement_entries'),0)
  assert.equal(count(s,'movements'),0)
})

test('Task 10 state/policy race inside batch fully rolls back all entries',async t=>{
  const {s,db}=fixture(t)
  const original=db.batch.bind(db)
  db.batch=async statements=>{
    s.prepare("UPDATE orders SET content_revision=content_revision+1 WHERE id='order-1'").run()
    return original(statements)
  }
  await assert.rejects(registerOrderSupplementalPayment(db,BIZ,'order-1',request('race'),NOW),
    {status:409,code:'ORDER_SUPPLEMENTAL_CONFLICT'})
  assert.equal(count(s,'payment_receipts'),1)
  assert.equal(count(s,'order_settlement_entries'),0)
  assert.equal(count(s,'movements'),0)
  assert.equal(count(s,'settings_tx_assertions'),0)
})

test('Task 10 duplicate different mutation and cross-tenant attempts cannot collect twice',async t=>{
  const {s,db}=fixture(t)
  await registerOrderSupplementalPayment(db,BIZ,'order-1',request('first'),NOW)
  await assert.rejects(registerOrderSupplementalPayment(db,BIZ,'order-1',request('second'),NOW),
    {status:409,code:'ORDER_SUPPLEMENTAL_CONFLICT'})
  await assert.rejects(registerOrderSupplementalPayment(db,OTHER,'order-1',request('foreign'),NOW),
    {status:404,code:'ORDER_NOT_FOUND'})
  const latest=await loadOrderById(db,BIZ,'order-1')
  assert.equal(latest.netReceivedCents,9500)
  assert.equal(count(s,'order_settlement_entries'),1)
})

test('Task 10 unfinished order with no payment must continue through the original payment flow',async t=>{
  const {s,db}=fixture(t)
  s.prepare("DELETE FROM payments WHERE id='old-payment'").run()
  await assert.rejects(registerOrderSupplementalPayment(db,BIZ,'order-1',
    {...request(),expectedNetReceivedCents:0,allocations:alloc(['pix',9500])},NOW),
    {status:409,code:'ORDER_SUPPLEMENTAL_CONFLICT'})
  assert.equal(count(s,'order_settlement_entries'),0)
  assert.equal(count(s,'payment_receipts'),1)
})

test('Task 16: a finalized order with an outstanding edit balance can be settled later without re-opening its lifecycle',async t=>{
 const {s,db}=fixture(t)
 s.prepare("UPDATE orders SET status='Finalizado' WHERE id='order-1'").run()
 const result=await registerOrderSupplementalPayment(db,BIZ,'order-1',request('after-finalization'),NOW)
 assert.equal(result.order.status,'Finalizado')
 assert.equal(result.order.dueCents,0)
 assert.equal(result.order.paymentStatus,'Pago')
 assert.equal(count(s,'payments'),1)
 assert.equal(count(s,'order_settlement_entries'),1)
})


test('Task 6: complementary split payment records the selected financial date without changing the original receipt',async t=>{
  const {s,db}=fixture(t)
  const original=s.prepare("SELECT * FROM payment_receipts WHERE id='old-receipt'").get()
  const oldPayment=s.prepare("SELECT * FROM payments WHERE id='old-payment'").get()
  const result=await registerOrderSupplementalPayment(db,BIZ,'order-1',
    {...request('retro-split',split),receivedDate:'2026-10-10'},NOW)
  assert.equal(result.receipt.receivedDate,'2026-10-10')
  assert.equal(result.receipt.paidAt,STAMP)
  assert.equal(s.prepare('SELECT received_date FROM payment_receipts WHERE id=?').get(result.receipt.id).received_date,'2026-10-10')
  const movements=s.prepare('SELECT movement_date,created_at,value_cents FROM movements WHERE receipt_id=? ORDER BY value_cents').all(result.receipt.id)
  assert.deepEqual(movements.map(m=>m.movement_date),['2026-10-10','2026-10-10'])
  assert.deepEqual(movements.map(m=>m.value_cents),[500,1000])
  assert.ok(movements.every(m=>m.created_at===STAMP))
  assert.deepEqual(s.prepare("SELECT * FROM payment_receipts WHERE id='old-receipt'").get(),original)
  assert.deepEqual(s.prepare("SELECT * FROM payments WHERE id='old-payment'").get(),oldPayment)
  assert.equal(s.prepare("SELECT order_date FROM orders WHERE id='order-1'").get().order_date,'2026-10-12')
  assert.equal(count(s,'payments'),1)
  assert.equal(count(s,'order_settlement_entries'),1)
})

test('Task 6: absent receipt date defaults to business today, future and malformed dates do not write',async t=>{
  const {s,db}=fixture(t)
  for(const [n,receivedDate] of [null,'2026-10-13','2026-02-30','2026-10-10T12:00:00Z',' 2026-10-10 ',42].entries()){
    await assert.rejects(
      registerOrderSupplementalPayment(db,BIZ,'order-1',{...request('bad-date-'+n),receivedDate},NOW),
      {status:400,code:'VALIDATION_ERROR',field:'receivedDate'},
    )
  }
  assert.equal(count(s,'payment_receipts'),1)
  assert.equal(count(s,'order_settlement_entries'),0)
  assert.equal(count(s,'movements'),0)
  const result=await registerOrderSupplementalPayment(db,BIZ,'order-1',request('legacy-no-date'),NOW)
  assert.equal(result.receipt.receivedDate,'2026-10-12')
  assert.equal(s.prepare('SELECT movement_date FROM movements WHERE receipt_id=?').get(result.receipt.id).movement_date,'2026-10-12')
})

test('Task 6: replay preserves explicit date and legacy omitted date across midnight and rejects conflicting date',async t=>{
  const {s,db}=fixture(t)
  const chosen={...request('explicit-replay'),receivedDate:'2026-10-10'}
  const first=await registerOrderSupplementalPayment(db,BIZ,'order-1',chosen,NOW)
  const nextDay=new Date('2026-10-13T15:00:00.000Z')
  const repeat=await registerOrderSupplementalPayment(db,BIZ,'order-1',chosen,nextDay)
  assert.equal(repeat.receipt.id,first.receipt.id)
  assert.equal(repeat.receipt.receivedDate,'2026-10-10')
  await assert.rejects(registerOrderSupplementalPayment(db,BIZ,'order-1',
    {...chosen,receivedDate:'2026-10-11'},nextDay),{status:409,code:'ORDER_SUPPLEMENTAL_CONFLICT'})
  await assert.rejects(registerOrderSupplementalPayment(db,BIZ,'order-1',
    request('explicit-replay'),nextDay),{status:409,code:'ORDER_SUPPLEMENTAL_CONFLICT'})
  assert.equal(count(s,'payment_receipts'),2)
  assert.equal(count(s,'movements'),1)
})

test('Task 6: omitted date replay remains stable after midnight even with an uncertain first response',async t=>{
  const {s,db}=fixture(t)
  const originalBatch=db.batch.bind(db)
  let lost=true
  db.batch=async statements=>{
    const result=await originalBatch(statements)
    if(lost){lost=false;throw new Error('network response lost after commit')}
    return result
  }
  const payload=request('legacy-next-day')
  const first=await registerOrderSupplementalPayment(db,BIZ,'order-1',payload,NOW)
  const nextDay=await registerOrderSupplementalPayment(db,BIZ,'order-1',payload,new Date('2026-10-13T15:00:00.000Z'))
  assert.equal(nextDay.receipt.id,first.receipt.id)
  assert.equal(nextDay.receipt.receivedDate,'2026-10-12')
  assert.equal(count(s,'payment_receipts'),2)
  assert.equal(count(s,'movements'),1)
})
