import { reportKitchenTvDisplay } from '../kitchenTvControlRepository.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createSettingsDb } from '../test-support/settingsDb.js'
import { withCommittedEffects } from './committedEffects.js'
import { createOrder, closeTableTabIfSettled } from '../repositories.js'
import { registerClientOrdersPayment, registerTableTabPayment, registerOrderPayment } from '../paymentRepository.js'
import { cancelOrder } from '../orderCancellation.js'
import { getOrCreateOpenTableTabByTableId } from '../tableRepository.js'
import { upsertPrintStation, setPrimaryPrintStation, heartbeatPrintStation, discardPendingPrintJobs, getPrintQueueSummary } from '../orderPrintingRepository.js'
const business='amor-e-sabor',now=new Date('2026-10-14T15:00:00Z')
function fixture(t){
  const f=createSettingsDb();t.after(f.close)
  f.sqlite.exec("DELETE FROM tables;INSERT INTO clients(id,business_id,name,created_at,updated_at) VALUES('c','amor-e-sabor','Fictício','2026-10-14','2026-10-14');INSERT INTO products(id,business_id,category,size,name,price_cents,active,created_at,updated_at) VALUES('p','amor-e-sabor','Meals','','Prato',1000,1,'2026-10-14','2026-10-14');INSERT INTO tables(id,business_id,name,name_key,sort_order,is_active,created_at,updated_at) VALUES('t','amor-e-sabor','Mesa 1','mesa 1',1,1,'2026-10-14','2026-10-14')")
  const events=[],db=withCommittedEffects(f.db,{onCommitted:e=>events.push(e)})
  const order=(key,overrides={})=>createOrder(db,business,{customerIdentity:{type:'registered_client',clientId:'c'},type:'Entrega',orderDate:'2026-10-14',items:[{productId:'p',quantity:1,note:''}],deliveryFeeCents:0,adjustment:{type:'none',mode:'fixed',storedValue:0,reason:''},paymentMethod:null,idempotencyKey:key,...overrides},now)
  return {...f,db,events,order}
}
test('order creation with automatic print job publishes both projections and replay is silent',async t=>{
  const f=fixture(t),order=await f.order('create-realtime')
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM print_jobs').get().n,1)
  assert.ok(f.events.some(e=>e.orderIds.includes(order.id) && e.topics.includes('orders') && e.topics.includes('printing')))
  f.events.length=0
  assert.equal((await f.order('create-realtime')).id,order.id)
  assert.deepEqual(f.events,[])
})
test('client batch payment groups affected order IDs and preserves official receipt/audit',async t=>{
  const f=fixture(t),a=await f.order('batch-a'),b=await f.order('batch-b')
  f.events.length=0
  const result=await registerClientOrdersPayment(f.db,business,'c',[a.id,b.id],[{methodCode:'pix',amountCents:2000}],now)
  assert.equal(result.payments.length,2);assert.equal(result.receipt.totalCents,2000)
  assert.equal(f.events.length,1);assert.deepEqual(new Set(f.events[0].orderIds),new Set([a.id,b.id]))
  assert.equal(f.sqlite.prepare("SELECT count(*) n FROM audit_events WHERE action='payment.received'").get().n,2)
})
test('table-tab payment and cancellation with refund keep their committed official effects',async t=>{
  const f=fixture(t),a=await f.order('tab-order',{customerIdentity:{type:'table',tableId:'t'},type:'Local'})
  f.events.length=0
  const payment=await registerTableTabPayment(f.db,business,a.tableTabId,[{methodCode:'pix',amountCents:1000}],now)
  assert.equal(payment.tableTab.status,'closed');assert.ok(f.events.some(e=>e.topics.includes('tables') && e.orderIds.includes(a.id)))
  const b=await f.order('refund-order')
  await registerOrderPayment(f.db,business,b.id,[{methodCode:'pix',amountCents:1000}],now)
  f.events.length=0
  await cancelOrder(f.db,business,b.id,{reason:'duplicate_order',refundNow:true,refundMethod:'Pix'},now)
  assert.equal(f.sqlite.prepare('SELECT status FROM orders WHERE id=?').get(b.id).status,'Cancelado')
  assert.equal(f.sqlite.prepare("SELECT count(*) n FROM audit_events WHERE resource_id=? AND action IN ('order.cancelled','payment.refunded')").get(b.id).n,2)
  assert.ok(f.events.some(e=>e.topics.includes('finance') && e.orderIds.includes(b.id)))
})
test('un-audited table-tab open/close notify while no-change retries remain silent',async t=>{
  const f=fixture(t),tab=await getOrCreateOpenTableTabByTableId(f.db,business,'t',now)
  assert.ok(f.events.some(e=>e.topics.includes('tables')))
  f.events.length=0
  await getOrCreateOpenTableTabByTableId(f.db,business,'t',now)
  assert.deepEqual(f.events,[])
  await closeTableTabIfSettled(f.db,business,tab.id,now)
  assert.ok(f.events.some(e=>e.topics.includes('tables')))
})
test('unchanged printing heartbeat is silent; health transition still refreshes presentation',async t=>{
  const f=fixture(t)
  const station=await upsertPrintStation(f.db,business,{id:'s',name:'Windows',platform:'windows',transport:'qz',autoPrintEnabled:true},now)
  await setPrimaryPrintStation(f.db,business,station.id,now)
  await heartbeatPrintStation(f.db,business,station.id,{qzReady:true,printerReady:true,physicalState:'ready'},now)
  f.events.length=0
  await heartbeatPrintStation(f.db,business,station.id,{qzReady:true,printerReady:true,physicalState:'ready'},new Date(+now+10_000))
  assert.deepEqual(f.events,[])
  await heartbeatPrintStation(f.db,business,station.id,{qzReady:false,printerReady:false,physicalState:'printer_offline'},new Date(+now+20_000))
  assert.ok(f.events.some(e=>e.topics.includes('printing')))
})

test('bulk printing groups committed candidates and an empty repeat emits no notification',async t=>{
  const f=fixture(t)
  await f.order('bulk-a');await f.order('bulk-b');f.events.length=0
  const jobs=await discardPendingPrintJobs(f.db,business,'Sistema',now)
  assert.equal(jobs.length,2)
  assert.equal(f.events.length,1);assert.deepEqual(f.events[0].topics,['printing'])
  assert.equal(f.sqlite.prepare("SELECT count(*) n FROM audit_events WHERE action='printing.discarded'").get().n,2)
  f.events.length=0
  await discardPendingPrintJobs(f.db,business,'Sistema',now)
  assert.deepEqual(f.events,[])
})

test('ordinary order creation emits narrow hints; table totals retain their own invalidation',async t=>{
  const f=fixture(t)
  await f.order('narrow-order')
  assert.deepEqual(new Set(f.events.flatMap(e=>e.topics)),new Set(['orders','kitchen-tv','printing']))
  f.events.length=0
  const first=await f.order('table-one',{customerIdentity:{type:'table',tableId:'t'},type:'Local'})
  assert.ok(f.events.some(e=>e.topics.includes('tables')))
  f.events.length=0
  await f.order('table-two',{customerIdentity:{type:'table',tableId:'t'},type:'Local',expectedTableTabId:first.tableTabId})
  assert.ok(f.events.some(e=>e.topics.includes('tables')))
})

test('unchanged TV heartbeat is silent while changed visible projection notifies control',async t=>{
  const f=fixture(t),report={appliedRevision:1,currentPage:1,pageCount:1,viewportWidth:1280,viewportHeight:720,visibleOrderIds:[]}
  await reportKitchenTvDisplay(f.db,business,report,now)
  assert.ok(f.events.some(e=>e.topics.includes('kitchen-tv')))
  f.events.length=0
  await reportKitchenTvDisplay(f.db,business,report,new Date(+now+5000))
  assert.deepEqual(f.events,[])
  await reportKitchenTvDisplay(f.db,business,{...report,visibleOrderIds:['visible-order']},new Date(+now+10000))
  assert.equal(f.events.length,1);assert.deepEqual(f.events[0].topics,['kitchen-tv'])
})
test('existing terminal print retention notifies presentation without changing order or audit history',async t=>{
  const f=fixture(t),order=await f.order('retained-history')
  f.sqlite.prepare("UPDATE print_jobs SET status='printed',processed_at='2020-01-01T00:00:00.000Z' WHERE order_id=?").run(order.id)
  const auditCount=f.sqlite.prepare('SELECT count(*) n FROM audit_events').get().n;f.events.length=0
  await getPrintQueueSummary(f.db,business,now)
  assert.ok(f.events.some(e=>e.topics.includes('printing')))
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM orders').get().n,1)
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM audit_events').get().n,auditCount)
})
