import test from 'node:test'
import assert from 'node:assert/strict'
import {createSettingsDb} from './test-support/settingsDb.js'
import {updateExistingOrder} from './orderEditRepository.js'
import {registerOrderPayment,registerClientOrdersPayment} from './paymentRepository.js'
import {registerOrderPartialRefund} from './orderPartialRefund.js'
import {registerOrderSupplementalPayment} from './orderSupplementalPayment.js'
import {readReceivables,readFinanceOverview} from './readModels/financeReadRepository.js'
import {readCustomerRelationship} from './readModels/customerReadRepository.js'
import {createOrderPrintDocument} from '../shared/orderPrintDocument.js'
import {effectForCommittedEvent} from './realtime/effectCatalog.js'
import {loadSurfaceSnapshot} from './readModels/snapshotRepository.js'
import {getOrderRefundState} from '../shared/orderLifecycle.js'
import {withCommittedEffects} from './realtime/committedEffects.js'

const B='amor-e-sabor',now=new Date('2026-10-16T12:00:00.000Z'),at=now.toISOString()
const granted=new Set(['orders.view','orders.history','finance.receivables','finance.movements','finance.overview','clients.view'])
async function setup(t){
 const f=createSettingsDb();t.after(f.close)
 f.sqlite.prepare("INSERT INTO clients(id,business_id,name,phone,address,created_at,updated_at) VALUES('c',?,'Ana','','',?,?)").run(B,at,at)
 f.sqlite.prepare("INSERT INTO products(id,business_id,category,size,name,price_cents,active,created_at,updated_at) VALUES('prod',?,'Bebidas','Un','Suco',3000,1,?,?)").run(B,at,at)
 f.sqlite.prepare("INSERT INTO orders(id,business_id,order_number,client_id,customer_identity_type,client_name_snapshot,type,order_date,status,subtotal_cents,total_cents,created_at) VALUES('o',?,27,'c','registered_client','Ana','Retirada','2026-10-16','Em preparo',3000,3000,?)").run(B,at)
 f.sqlite.prepare("INSERT INTO order_items(id,business_id,order_id,product_id,name_snapshot,category_snapshot,size_snapshot,quantity,catalog_price_cents,unit_price_cents,note,created_at) VALUES('line',?,'o','prod','Suco','Bebidas','Un',1,3000,3000,'',?)").run(B,at)
 await registerOrderPayment(f.db,B,'o',[{methodCode:'pix',amountCents:3000}],now)
 return f
}
const edit=quantity=>({expectedContentRevision:0,mutationId:'edit-'+quantity,items:[{id:'line',quantity,note:''}]})
test('scoped finance, forecast and client relationship use only edited due and clear it after settlement',async t=>{
 const f=await setup(t)
 await updateExistingOrder(f.db,B,'o',edit(2),{},now)
 const pending=await readReceivables(f.db,B,{granted,now,mode:'orders'})
 assert.deepEqual(pending.orders.map(o=>o.id),['o'])
 assert.equal(pending.entries[0].total,30)
 assert.equal(pending.summary.today.amount,30)
 const overview=await readFinanceOverview(f.db,B,{granted,now})
 assert.equal(overview.dashboard.totals.receivables,30)
 const client=await readCustomerRelationship(f.db,B,'c',{granted,now,filter:'pending'})
 assert.equal(client.profile.pending,30)
 assert.equal(client.summary.count,1)
 await registerOrderSupplementalPayment(f.db,B,'o',{mutationId:'supplement',expectedContentRevision:1,expectedTotalCents:6000,expectedNetReceivedCents:3000,allocations:[{methodCode:'pix',amountCents:3000}]},now)
 assert.equal((await readReceivables(f.db,B,{granted,now,mode:'orders'})).orders.length,0)
 assert.equal(f.sqlite.prepare("SELECT count(*) n FROM order_financial_candidates WHERE order_id='o'").get().n,0)
})
test('scoped refunds include a finalized edited order and track a partial refund until zero',async t=>{
 const f=await setup(t)
 await updateExistingOrder(f.db,B,'o',{...edit(1),adjustment:{type:'discount',mode:'fixed',value:15,reason:'Correção'}},{allowAdjustment:true},now)
 f.sqlite.exec("UPDATE orders SET status='Finalizado' WHERE id='o'")
 const query={granted,now,mode:'orders',view:'refunds'}
 let result=await readReceivables(f.db,B,query)
 assert.deepEqual(result.orders.map(o=>o.id),['o'])
 assert.equal(result.entries[0].total,15)
 assert.equal((await loadSurfaceSnapshot(f.db,B,{surface:'shell',granted,now})).readModel.counters.refunds,1)
 assert.equal((await readReceivables(f.db,B,{granted,now,mode:'orders'})).orders.length,0)
 const request={expectedContentRevision:1,expectedTotalCents:1500,refundMethod:'Pix'}
 await registerOrderPartialRefund(f.db,B,'o',{...request,mutationId:'refund-one',amountCents:1000,expectedNetReceivedCents:3000},now)
 result=await readReceivables(f.db,B,query)
 assert.equal(result.entries[0].total,5)
 await registerOrderPartialRefund(f.db,B,'o',{...request,mutationId:'refund-two',amountCents:500,expectedNetReceivedCents:2000},now)
 assert.equal((await readReceivables(f.db,B,query)).orders.length,0)
 assert.equal((await loadSurfaceSnapshot(f.db,B,{surface:'shell',granted,now})).readModel.counters.refunds,0)
})

test('cancelled edited partially paid order keeps its net refund actionable',()=>{
 assert.equal(getOrderRefundState({status:'Cancelado',paymentId:'p',paymentStatus:'Parcialmente pago',netReceivedCents:8000,refundState:'pending'}),'pending')
})
test('pending automatic print snapshot changes payment state along with items and total',async t=>{
 const f=await setup(t)
 const initial=createOrderPrintDocument({orderId:'o',orderNumber:27,items:[{name:'Suco',quantity:1,unitPriceCents:3000}],totalCents:3000,payment:{status:'Pago',method:'Pix'}})
 f.sqlite.prepare("INSERT INTO print_jobs(id,business_id,order_id,type,trigger,status,copies_requested,copies_printed,snapshot_json,created_at,available_at) VALUES('job',?,'o','order','automatic','pending',1,0,?,?,?)").run(B,JSON.stringify(initial),at,at)
 const result=await updateExistingOrder(f.db,B,'o',edit(2),{},now)
 const snapshot=JSON.parse(f.sqlite.prepare("SELECT snapshot_json FROM print_jobs WHERE id='job'").get().snapshot_json)
 assert.equal(snapshot.financial.totalCents,6000)
 assert.equal(snapshot.payment.status,result.order.paymentStatus)
})
test('editing and settlement events invalidate official peers after commit',()=>{
 for(const action of ['order.edited','payment.supplemental-received','payment.partial-refunded']){
  const effect=effectForCommittedEvent(B,{action,resourceType:'order',resourceId:'o'})
  assert.ok(effect?.topics.includes('orders'),action)
  assert.ok(effect.topics.includes('finance'),action)
  assert.deepEqual(effect.orderIds,['o'])
 }
})

test('real edit and settlement commits publish once while mutation replay stays silent',async t=>{
 const f=await setup(t),events=[]
 const db=withCommittedEffects(f.db,{onCommitted:event=>events.push(event)})
 const request=edit(2)
 await updateExistingOrder(db,B,'o',request,{},now)
 assert.equal(events.length,1)
 assert.ok(events[0].topics.includes('orders'))
 assert.ok(events[0].topics.includes('printing'))
 await updateExistingOrder(db,B,'o',request,{},now)
 assert.equal(events.length,1)
 const payment={mutationId:'notified-payment',expectedContentRevision:1,expectedTotalCents:6000,expectedNetReceivedCents:3000,allocations:[{methodCode:'pix',amountCents:3000}]}
 await registerOrderSupplementalPayment(db,B,'o',payment,now)
 assert.equal(events.length,2)
 assert.ok(events[1].topics.includes('finance'))
 await registerOrderSupplementalPayment(db,B,'o',payment,now)
 assert.equal(events.length,2)
})
test('mixed client receipt charges due only, preserves original payment and is replay safe',async t=>{
 const f=await setup(t)
 await updateExistingOrder(f.db,B,'o',edit(2),{},now)
 f.sqlite.prepare("INSERT INTO orders(id,business_id,order_number,client_id,customer_identity_type,client_name_snapshot,type,order_date,status,subtotal_cents,total_cents,created_at) VALUES('o2',?,28,'c','registered_client','Ana','Retirada','2026-10-16','Em preparo',2000,2000,?)").run(B,at)
 const allocations=[{methodCode:'pix',amountCents:4000},{methodCode:'cash',amountCents:1000}]
 const options={mutationId:'client-mixed'}
 const result=await registerClientOrdersPayment(f.db,B,'c',['o','o2'],allocations,now,options)
 assert.equal(result.receipt.totalCents,5000)
 assert.deepEqual(result.orders.map(o=>o.dueCents),[0,0])
 assert.equal(f.sqlite.prepare("SELECT amount_cents FROM payments WHERE order_id='o'").get().amount_cents,3000)
 assert.equal(f.sqlite.prepare("SELECT count(*) n FROM payments WHERE order_id IN ('o','o2')").get().n,2)
 assert.equal(f.sqlite.prepare('SELECT SUM(value_cents) n FROM movements WHERE receipt_id=?').get(result.receipt.id).n,5000)
 const replay=await registerClientOrdersPayment(f.db,B,'c',['o','o2'],allocations,now,options)
 assert.equal(replay.receipt.id,result.receipt.id)
 await assert.rejects(registerClientOrdersPayment(f.db,B,'c',['o','o2'],[{methodCode:'pix',amountCents:5000}],now,options),{status:409})
})

test('mixed batch rejects a concurrent settlement snapshot without a second receipt or movement',async t=>{
 const f=await setup(t)
 await updateExistingOrder(f.db,B,'o',edit(2),{},now)
 f.sqlite.prepare("INSERT INTO orders(id,business_id,order_number,client_id,customer_identity_type,client_name_snapshot,type,order_date,status,subtotal_cents,total_cents,created_at) VALUES('o2',?,28,'c','registered_client','Ana','Retirada','2026-10-16','Em preparo',2000,2000,?)").run(B,at)
 const batch=f.db.batch;let raced=false
 f.db.batch=async statements=>{
  if(!raced){raced=true;await registerOrderSupplementalPayment({...f.db,batch},B,'o',{mutationId:'race',expectedContentRevision:1,expectedTotalCents:6000,expectedNetReceivedCents:3000,allocations:[{methodCode:'pix',amountCents:3000}]},now)}
  return batch(statements)
 }
 await assert.rejects(registerClientOrdersPayment(f.db,B,'c',['o','o2'],[{methodCode:'pix',amountCents:5000}],now,{mutationId:'stale-client'}),{status:409})
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM payment_receipts').get().n,2)
 assert.equal(f.sqlite.prepare("SELECT count(*) n FROM payments WHERE order_id='o2'").get().n,0)
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM client_payment_mutation_receipts').get().n,0)
})

test('client receipt reconciles an uncertain committed response with the same mutation',async t=>{
 const f=await setup(t)
 await updateExistingOrder(f.db,B,'o',edit(2),{},now)
 f.sqlite.prepare("INSERT INTO orders(id,business_id,order_number,client_id,customer_identity_type,client_name_snapshot,type,order_date,status,subtotal_cents,total_cents,created_at) VALUES('o2',?,28,'c','registered_client','Ana','Retirada','2026-10-16','Em preparo',2000,2000,?)").run(B,at)
 const batch=f.db.batch
 f.db.batch=async statements=>{await batch(statements);throw new Error('response lost after commit')}
 const result=await registerClientOrdersPayment(f.db,B,'c',['o','o2'],[{methodCode:'pix',amountCents:5000}],now,{mutationId:'lost-client-response'})
 assert.equal(result.receipt.totalCents,5000)
 assert.deepEqual(result.orders.map(order=>order.dueCents),[0,0])
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM payment_receipts').get().n,2)
 assert.throws(()=>f.sqlite.exec('DELETE FROM client_payment_mutation_receipts'),/IMMUTABLE/)
})
