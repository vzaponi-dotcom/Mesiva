import test from 'node:test'
import assert from 'node:assert/strict'
import { OperationalDb } from './test-support/operationalDb.js'
import { updateExistingOrder } from './orderEditRepository.js'
import { createOrderPrintDocument } from '../shared/orderPrintDocument.js'
const B='amor-e-sabor',at=new Date('2026-10-10T17:00:00.000Z')
function setup(status='pending'){
 const db=new OperationalDb()
 db.sqlite.prepare("INSERT INTO products(id,business_id,category,size,name,price_cents,active,created_at,updated_at) VALUES('prod',?,'Bebidas','Un','Suco',3000,1,?,?)").run(B,at.toISOString(),at.toISOString())
 db.sqlite.prepare("INSERT INTO orders(id,business_id,order_number,client_name_snapshot,type,order_date,status,subtotal_cents,total_cents,created_at) VALUES('order',?,27,'Ana','Retirada','2026-10-10','Em preparo',3000,3000,?)").run(B,at.toISOString())
 db.sqlite.prepare("INSERT INTO order_items(id,business_id,order_id,product_id,name_snapshot,category_snapshot,size_snapshot,quantity,catalog_price_cents,unit_price_cents,note,created_at) VALUES('line',?,'order','prod','Suco','Bebidas','Un',1,3000,3000,'',?)").run(B,at.toISOString())
 const initial=createOrderPrintDocument({businessName:'Mesiva',orderId:'order',orderNumber:27,orderDate:'2026-10-10',createdAt:at.toISOString(),type:'Retirada',customer:{name:'Ana'},items:[{name:'Suco',quantity:1,unitPriceCents:3000}],subtotalCents:3000,totalCents:3000,payment:{status:'Pendente'}})
 db.sqlite.prepare("INSERT INTO print_jobs(id,business_id,order_id,type,trigger,status,copies_requested,copies_printed,snapshot_json,created_at,available_at) VALUES('job',?,'order','order','automatic',?,2,0,?,?,?)").run(B,status,JSON.stringify(initial),at.toISOString(),at.toISOString())
 return db
}
const edit=(key='change')=>({expectedContentRevision:0,mutationId:key,items:[{id:'line',quantity:2,note:'Sem gelo'}]})
test('pending automatic print job snapshot is replaced with entire updated order in same batch',async()=>{
 const db=setup()
 const result=await updateExistingOrder(db,B,'order',edit(),{},at)
 assert.equal(result.order.total,60)
 const rows=db.sqlite.prepare("SELECT trigger,status,copies_requested,snapshot_json FROM print_jobs WHERE business_id=?").all(B)
 assert.equal(rows.length,1)
 assert.equal(rows[0].trigger,'automatic')
 assert.equal(rows[0].copies_requested,2)
 assert.equal(rows[0].status,'pending')
 const printed=JSON.parse(rows[0].snapshot_json)
 assert.equal(printed.items[0].quantity,2)
 assert.equal(printed.items[0].note,'Sem gelo')
 assert.equal(printed.financial.totalCents,6000)
 assert.equal(printed.order.number,'27')
})
test('existing processing or printed job retains original evidence while order updates',async()=>{
 for(const status of ['processing','printed','discarded','awaiting_second_copy','requires_attention']){
   const db=setup(status)
   const before=db.sqlite.prepare("SELECT snapshot_json FROM print_jobs WHERE id='job'").get().snapshot_json
   await updateExistingOrder(db,B,'order',edit(),{},at)
   assert.equal(db.sqlite.prepare("SELECT snapshot_json FROM print_jobs WHERE id='job'").get().snapshot_json,before,status)
 }
})
test('no change never rewrites queued snapshot or creates new manual print jobs',async()=>{
 const db=setup()
 const before=db.sqlite.prepare("SELECT snapshot_json FROM print_jobs WHERE id='job'").get().snapshot_json
 await updateExistingOrder(db,B,'order',{expectedContentRevision:0,mutationId:'noop',items:[{id:'line',quantity:1,note:''}]},{},at)
 assert.equal(db.sqlite.prepare("SELECT snapshot_json FROM print_jobs WHERE id='job'").get().snapshot_json,before)
 assert.equal(db.sqlite.prepare("SELECT count(*) n FROM print_jobs").get().n,1)
})
test('concurrent claim of automatic print job aborts editing rather than overwriting a processing snapshot',async()=>{
 const db=setup()
 const original=db.batch.bind(db)
 db.batch=async statements=>{
   db.sqlite.exec("UPDATE print_jobs SET status='processing' WHERE id='job'")
   return original(statements)
 }
 await assert.rejects(updateExistingOrder(db,B,'order',edit(),{},at),{status:409})
 assert.equal(db.sqlite.prepare("SELECT total_cents FROM orders WHERE id='order'").get().total_cents,3000)
 assert.equal(db.sqlite.prepare("SELECT status FROM print_jobs WHERE id='job'").get().status,'processing')
})
