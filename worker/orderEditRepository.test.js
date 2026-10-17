import test from 'node:test'
import assert from 'node:assert/strict'
import { OperationalDb } from './test-support/operationalDb.js'
import { updateExistingOrder } from './orderEditRepository.js'
import { registerOrderPayment } from './paymentRepository.js'

const B='amor-e-sabor', OTHER='edit-other', NOW=new Date('2026-10-10T15:00:00.000Z')
const edit = (overrides={}) => ({
  expectedContentRevision:0,mutationId:'edit-A',
  items:[{id:'i1',quantity:2,note:'sem cebola'}], ...overrides,
})
function fixture(){
  const db=new OperationalDb({businesses:[OTHER]})
  const sql=db.sqlite
  for(const business of [B,OTHER]) {
    sql.prepare('INSERT INTO products(id,business_id,category,size,name,price_cents,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(business===B?'p1':'foreign',business,'Bebidas','Un','Suco',3200,1,NOW.toISOString(),NOW.toISOString())
    const orderId=business===B?'o1':'foreign-order'
    sql.prepare("INSERT INTO orders(id,business_id,order_number,client_name_snapshot,type,order_date,status,subtotal_cents,total_cents,created_at) VALUES (?,?,?,?,?,'2026-10-10','Em preparo',3200,3200,?)")
      .run(orderId,business,business===B?55:56,'Cliente','Entrega',NOW.toISOString())
    sql.prepare('INSERT INTO order_items(id,business_id,order_id,product_id,name_snapshot,category_snapshot,size_snapshot,quantity,catalog_price_cents,unit_price_cents,price_reason,note,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(business===B?'i1':'foreign-i',business,orderId,business===B?'p1':'foreign','Suco','Bebidas','Un',1,3200,3200,'','',NOW.toISOString())
  }
  return db
}
const persist=db=>({
  order:db.sqlite.prepare("SELECT status,content_revision,total_cents,order_number,finished_at FROM orders WHERE id='o1'").get(),
  items:db.sqlite.prepare("SELECT id,quantity,note,unit_price_cents FROM order_items WHERE order_id='o1' ORDER BY id").all(),
  revisions:db.sqlite.prepare("SELECT count(*) n FROM order_edit_revisions WHERE order_id='o1'").get().n,
  receipts:db.sqlite.prepare("SELECT count(*) n FROM order_edit_mutation_receipts WHERE order_id='o1'").get().n,
  jobs:db.sqlite.prepare("SELECT count(*) n FROM print_jobs WHERE order_id='o1'").get().n,
})

test('atomic edit preserves order id/number and item IDs, records one revision and no print job',async()=>{
 const db=fixture()
 const result=await updateExistingOrder(db,B,'o1',edit(),{allowAdjustment:true},NOW)
 assert.equal(result.changed,true)
 assert.equal(result.order.id,'o1')
 assert.equal(result.order.orderNumber,55)
 assert.equal(result.order.contentRevision,1)
 assert.equal(result.order.total,64)
 assert.equal(result.order.items[0].id,'i1')
 assert.equal(result.order.items[0].note,'sem cebola')
 const state=persist(db)
 assert.equal(state.order.content_revision,1)
 assert.equal(state.order.total_cents,6400)
 assert.equal(state.revisions,1)
 assert.equal(state.receipts,1)
 assert.equal(state.jobs,0)
 assert.equal(db.sqlite.prepare("SELECT json_extract(changes_json,'$.items[0].kind') kind FROM order_edit_revisions WHERE order_id='o1'").get().kind,'modified')
 assert.equal(db.sqlite.prepare("SELECT count(*) n FROM audit_events WHERE action='order.edited' AND resource_id='o1'").get().n,1)
})

test('duplicate mutation replays once while stale revision or changed payload conflicts',async()=>{
 const db=fixture()
 const first=await updateExistingOrder(db,B,'o1',edit(),{allowAdjustment:true},NOW)
 const replay=await updateExistingOrder(db,B,'o1',edit(),{allowAdjustment:true},NOW)
 assert.equal(replay.contentRevision,first.contentRevision)
 assert.equal(replay.changed,true)
 assert.deepEqual(persist(db).order.content_revision,1)
 assert.equal(persist(db).receipts,1)
 await assert.rejects(updateExistingOrder(db,B,'o1',edit({items:[{id:'i1',quantity:3,note:'sem cebola'}]}),{allowAdjustment:true},NOW),{status:409})
 await assert.rejects(updateExistingOrder(db,B,'o1',edit({mutationId:'new-key'}),{allowAdjustment:true},NOW),{status:409})
 assert.equal(persist(db).revisions,1)
})

test('noop saves receipt but neither revision nor audit/print',async()=>{
 const db=fixture()
 const result=await updateExistingOrder(db,B,'o1',edit({items:[{id:'i1',quantity:1,note:''}]}),{},NOW)
 assert.equal(result.changed,false)
 assert.equal(result.contentRevision,0)
 assert.equal(persist(db).revisions,0)
 assert.equal(persist(db).receipts,1)
 assert.equal(persist(db).jobs,0)
 assert.equal(db.sqlite.prepare("SELECT count(*) n FROM audit_events WHERE action='order.edited'").get().n,0)
})

test('rollback on batch failure does not change any order, line or receipt',async()=>{
 const db=fixture()
 const before=persist(db)
 db.failNextBatch=true
 await assert.rejects(updateExistingOrder(db,B,'o1',edit(),{},NOW),/forced batch failure/)
 assert.deepEqual(persist(db),before)
})

test('Task 14 edited paid order preserves original receipt and derives due or refund without a cash movement',async()=>{
 const higher=fixture()
 await registerOrderPayment(higher,B,'o1',[{methodCode:'pix',amountCents:3200}],NOW)
 const increased=await updateExistingOrder(higher,B,'o1',edit(),{},NOW)
 assert.equal(increased.order.total,64)
 assert.equal(increased.order.grossReceivedCents,3200)
 assert.equal(increased.order.dueCents,3200)
 assert.equal(increased.order.paymentStatus,'Parcialmente pago')
 assert.equal(higher.sqlite.prepare("SELECT COUNT(*) n FROM movements WHERE source='order-edit-refund'").get().n,0)
 assert.equal(higher.sqlite.prepare("SELECT COUNT(*) n FROM payments WHERE order_id='o1'").get().n,1)
 const lower=fixture()
 await registerOrderPayment(lower,B,'o1',[{methodCode:'pix',amountCents:3200}],NOW)
 const decreased=await updateExistingOrder(lower,B,'o1',edit({items:[{id:'i1',quantity:1,note:''}],deliveryFee:0, adjustment:{type:'discount',mode:'fixed',value:10,reason:'ajuste'}}),{allowAdjustment:true},NOW)
 assert.equal(decreased.order.total,22)
 assert.equal(decreased.order.refundDueCents,1000)
 assert.equal(decreased.order.paymentStatus,'Devolução pendente')
 assert.equal(lower.sqlite.prepare("SELECT COUNT(*) n FROM movements WHERE source='order-edit-refund'").get().n,0)
})

test('cross-tenant IDs, finalized and cancelled orders are rejected without mutations',async()=>{
 const db=fixture()
 await assert.rejects(updateExistingOrder(db,OTHER,'o1',edit(),{},NOW),{status:404})
 await assert.rejects(updateExistingOrder(db,B,'foreign-order',edit(),{},NOW),{status:404})
 db.sqlite.exec("UPDATE orders SET status='Finalizado' WHERE id='o1'")
 await assert.rejects(updateExistingOrder(db,B,'o1',edit(),{},NOW),{status:409})
 db.sqlite.exec("UPDATE orders SET status='Cancelado' WHERE id='o1'")
 await assert.rejects(updateExistingOrder(db,B,'o1',edit(),{},NOW),{status:409})
 assert.equal(persist(db).receipts,0)
})

test('finalization racing after initial read aborts the whole edit transaction',async()=>{
 const db=fixture(),before=persist(db)
 const run=db.batch.bind(db)
 let intercepted=false
 db.batch=async statements=>{
   if(!intercepted){intercepted=true;db.sqlite.exec("UPDATE orders SET status='Finalizado' WHERE id='o1'")}
   return run(statements)
 }
 await assert.rejects(updateExistingOrder(db,B,'o1',edit(),{},NOW),{status:409})
 const after=persist(db)
 assert.equal(after.order.status,'Finalizado')
 assert.equal(after.order.total_cents,before.order.total_cents)
 assert.equal(after.items.length,before.items.length)
 assert.equal(after.revisions,0)
 assert.equal(after.receipts,0)
})

test('new item uses current official catalog and keeps old item price',async()=>{
 const db=fixture()
 db.sqlite.exec("UPDATE products SET price_cents=5500 WHERE id='p1'")
 const result=await updateExistingOrder(db,B,'o1',edit({items:[{id:'i1',quantity:1,note:''},{productId:'p1',quantity:1,note:'extra'}]}),{},NOW)
 assert.equal(result.order.total,87)
 const rows=db.sqlite.prepare("SELECT id,unit_price_cents FROM order_items WHERE order_id='o1' ORDER BY unit_price_cents").all()
 assert.deepEqual(rows.map(x=>x.unit_price_cents),[3200,5500])
 assert.equal(rows[0].id,'i1')
})

test('phase A edits existing products after catalog deactivation without silently repricing them',async()=>{
 const db=fixture()
 db.sqlite.prepare("UPDATE products SET active=0,price_cents=9900,name='Novo nome' WHERE id='p1'").run()
 const result=await updateExistingOrder(db,B,'o1',edit(),{},NOW)
 assert.equal(result.order.total,64)
 assert.equal(result.order.items[0].name,'Suco')
 assert.equal(result.order.items[0].unitPrice,32)
 await assert.rejects(updateExistingOrder(db,B,'o1',{
   expectedContentRevision:1,mutationId:'add-inactive',
   items:[{id:'i1',quantity:2,note:'sem cebola'},{productId:'p1',quantity:1,note:'extra'}],
 },{},NOW),{status:404,code:'PRODUCT_NOT_FOUND'})
 assert.equal(persist(db).revisions,1)
})
test('Task 14 paid edit with delivery fee updates due without editing historical receipts',async()=>{
 const db=fixture()
 await registerOrderPayment(db,B,'o1',[{methodCode:'pix',amountCents:3200}],NOW)
 const edited=await updateExistingOrder(db,B,'o1',edit({mutationId:'paid-extra',deliveryFee:4}),{},NOW)
 assert.equal(edited.order.total,68)
 assert.equal(edited.order.dueCents,3600)
 assert.equal(persist(db).revisions,1)
 assert.equal(persist(db).receipts,1)
 assert.equal(db.sqlite.prepare("SELECT amount_cents FROM payments WHERE order_id='o1'").get().amount_cents,3200)
})
