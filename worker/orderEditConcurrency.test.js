import test from 'node:test'
import assert from 'node:assert/strict'
import { OperationalDb } from './test-support/operationalDb.js'
import { registerOrderPayment } from './paymentRepository.js'
import { updateOrderStatus } from './repositories.js'
import { cancelOrder } from './orderCancellation.js'
import { updateExistingOrder } from './orderEditRepository.js'

const B='amor-e-sabor'
const NOW=new Date('2026-10-12T19:00:00.000Z')
const AT=NOW.toISOString()
const pix=[{methodCode:'pix',amountCents:3200}]
const edit=(mutationId='e1')=>({
  mutationId,expectedContentRevision:0,
  items:[{id:'item-1',quantity:2,note:'mais um'}],
})
function fixture(t){
  const db=new OperationalDb()
  db.sqlite.prepare('INSERT INTO products(id,business_id,category,size,name,price_cents,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run('product-1',B,'Refeições','', 'Prato',3200,1,AT,AT)
  db.sqlite.prepare(`INSERT INTO orders
    (id,business_id,client_name_snapshot,type,order_date,status,subtotal_cents,total_cents,content_revision,created_at)
    VALUES('o1',?,'Ana','Entrega','2026-10-12','Em preparo',3200,3200,0,?)`).run(B,AT)
  db.sqlite.prepare(`INSERT INTO order_items
    (id,business_id,order_id,product_id,name_snapshot,category_snapshot,size_snapshot,quantity,catalog_price_cents,unit_price_cents,price_reason,note,created_at)
    VALUES('item-1',?,'o1','product-1','Prato','Refeições','',1,3200,3200,'','',?)`).run(B,AT)
  return db
}
const count=(db,table)=>db.sqlite.prepare(`SELECT count(*) n FROM ${table}`).get().n
const intercept=(db,change)=>{
  const batch=db.batch.bind(db)
  let once=true
  db.batch=async statements=>{
    if(once){once=false;change(db.sqlite)}
    return batch(statements)
  }
}

test('Task 15 standalone payment vs content edit must abort without receipt if revision moves',async t=>{
  const db=fixture(t)
  intercept(db,s=>s.prepare("UPDATE orders SET content_revision=1 WHERE id='o1'").run())
  await assert.rejects(registerOrderPayment(db,B,'o1',pix,NOW),{status:409})
  assert.equal(count(db,'payment_receipts'),0)
  assert.equal(count(db,'payments'),0)
  assert.equal(count(db,'movements'),0)
})
test('Task 15 standalone payment vs edited amount cannot charge stale value',async t=>{
  const db=fixture(t)
  intercept(db,s=>s.prepare("UPDATE orders SET content_revision=1,total_cents=6400,subtotal_cents=6400 WHERE id='o1'").run())
  await assert.rejects(registerOrderPayment(db,B,'o1',pix,NOW),{status:409})
  assert.equal(count(db,'payment_receipts'),0)
})
test('Task 15 finalization vs edited content must not accept an obsolete snapshot',async t=>{
  const db=fixture(t)
  intercept(db,s=>s.prepare("UPDATE orders SET content_revision=1,total_cents=6400,subtotal_cents=6400 WHERE id='o1'").run())
  await assert.rejects(updateOrderStatus(db,B,'o1',NOW),{status:409,code:'ORDER_STATUS_CHANGED'})
  assert.equal(db.sqlite.prepare("SELECT status FROM orders WHERE id='o1'").get().status,'Em preparo')
})
test('Task 15 cancellation without refund vs concurrent edit aborts and keeps the order open',async t=>{
  const db=fixture(t)
  intercept(db,s=>s.prepare("UPDATE orders SET content_revision=1,total_cents=6400,subtotal_cents=6400 WHERE id='o1'").run())
  await assert.rejects(cancelOrder(db,B,'o1',{reason:'entry_error',refundNow:false,expectedRevision:0},NOW),{status:409})
  assert.equal(db.sqlite.prepare("SELECT status FROM orders WHERE id='o1'").get().status,'Em preparo')
})
test('Task 15 cancellation with refund vs concurrent edit refuses stale content even if received net is unchanged',async t=>{
  const db=fixture(t)
  await registerOrderPayment(db,B,'o1',pix,NOW)
  intercept(db,s=>s.prepare("UPDATE orders SET content_revision=1,total_cents=6400,subtotal_cents=6400 WHERE id='o1'").run())
  await assert.rejects(cancelOrder(db,B,'o1',{reason:'entry_error',refundNow:true,refundMethod:'Pix',expectedRevision:0},NOW),{status:409})
  assert.equal(db.sqlite.prepare("SELECT status FROM orders WHERE id='o1'").get().status,'Em preparo')
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM movements WHERE source='order-refund'").get().n,0)
})
test('Task 15 stale edit after payment and no second settlement on retry',async t=>{
  const db=fixture(t)
  intercept(db,s=>{
    s.prepare("UPDATE orders SET content_revision=1,total_cents=6400,subtotal_cents=6400 WHERE id='o1'").run()
  })
  await assert.rejects(updateExistingOrder(db,B,'o1',edit(),{},NOW),{status:409})
  assert.equal(count(db,'order_edit_revisions'),0)
  assert.equal(count(db,'order_edit_mutation_receipts'),0)
  assert.equal(db.sqlite.prepare("SELECT content_revision FROM orders WHERE id='o1'").get().content_revision,1)
})

const injectOriginalPayment=(s,id='p1')=>{
  const iso=NOW.toISOString()
  s.prepare('INSERT INTO payment_receipts(id,business_id,total_cents,paid_at,created_at) VALUES(?,?,?,?,?)')
    .run(id+'-receipt',B,3200,iso,iso)
  s.prepare('INSERT INTO payment_allocations(id,business_id,receipt_id,method_code,method_label,amount_cents,created_at) VALUES(?,?,?,?,?,?,?)')
    .run(id+'-allocation',B,id+'-receipt','pix','Pix',3200,iso)
  s.prepare('INSERT INTO payments(id,business_id,order_id,receipt_id,amount_cents,method,paid_at,created_at) VALUES(?,?,?,?,?,NULL,?,?)')
    .run(id,B,'o1',id+'-receipt',3200,iso,iso)
}
test('Task 15 order edit vs first receipt rejects an edited financial snapshot, leaving the historic receipt untouched',async t=>{
  const db=fixture(t)
  intercept(db,s=>injectOriginalPayment(s))
  await assert.rejects(updateExistingOrder(db,B,'o1',edit('edit-versus-payment'),{},NOW),{status:409,code:'ORDER_EDIT_CONFLICT'})
  assert.equal(count(db,'order_edit_revisions'),0)
  assert.equal(count(db,'order_edit_mutation_receipts'),0)
  assert.equal(count(db,'payments'),1)
  assert.equal(db.sqlite.prepare("SELECT total_cents FROM orders WHERE id='o1'").get().total_cents,3200)
})
test('Task 15 deferred cancellation cannot overlook a receipt committed while it was preparing',async t=>{
  const db=fixture(t)
  intercept(db,s=>injectOriginalPayment(s))
  await assert.rejects(cancelOrder(db,B,'o1',{reason:'entry_error',expectedRevision:0,refundNow:false},NOW),
    {status:409,code:'ORDER_CANCEL_CONFLICT'})
  assert.equal(db.sqlite.prepare("SELECT status FROM orders WHERE id='o1'").get().status,'Em preparo')
  assert.equal(count(db,'payments'),1)
  assert.equal(count(db,'movements'),0)
})
