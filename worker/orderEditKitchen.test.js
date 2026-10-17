import test from 'node:test'
import assert from 'node:assert/strict'
import { OperationalDb } from './test-support/operationalDb.js'
import { loadKitchenTvState } from './kitchenTvReadRepository.js'
import { loadOperationalEditSignals, acknowledgeOperationalOrderEdit } from './orderEditSignalsRepository.js'

const B='amor-e-sabor',T='another-tenant',NOW='2026-10-10T15:40:00.000Z'
function fixture(){
 const db=new OperationalDb({businesses:[T]})
 db.sqlite.prepare("INSERT INTO orders(id,business_id,order_number,client_name_snapshot,client_phone_snapshot,type,order_date,status,subtotal_cents,total_cents,created_at) VALUES ('o1',?,42,'Ana','1111111111','Entrega','2026-10-10','Em preparo',8000,8000,?)").run(B,NOW)
 db.sqlite.prepare("INSERT INTO order_items(id,business_id,order_id,name_snapshot,quantity,catalog_price_cents,unit_price_cents,created_at) VALUES('i1',?,'o1','Marmita',2,4000,4000,?)").run(B,NOW)
 return db
}
const change={
 items:[{kind:'removed',before:{id:'i-old',name:'Salada',quantity:1,note:'sem molho',unitPriceCents:3000},after:null},
  {kind:'modified',before:{id:'i1',name:'Marmita',quantity:1,note:''},after:{id:'i1',name:'Marmita',quantity:2,note:'sem gelo'}}],
 deliveryFee:{before:500,after:0},
}
function revision(db){
 db.sqlite.prepare("UPDATE orders SET content_revision=1,last_edited_at=? WHERE business_id=? AND id='o1'").run(NOW,B)
 db.sqlite.prepare("INSERT INTO order_edit_revisions(id,business_id,order_id,revision,actor_name,edited_at,before_total_cents,after_total_cents,changes_json) VALUES('rev-1',?,'o1',1,'Operador',?,8000,8000,?)").run(B,NOW,JSON.stringify(change))
}
test('TV shows a persistent operational revision and item differences without leaking finances',async()=>{
 const db=fixture();revision(db)
 const state=await loadKitchenTvState(db,B)
 const o=state.orders.find(x=>x.id==='o1')
 assert.equal(o.editPending,true)
 assert.equal(o.operationalRevision,1)
 assert.deepEqual(o.editSummary.items.map(x=>x.kind),['removed','modified'])
 assert.equal(JSON.stringify(o).includes('unitPriceCents'),false)
 assert.equal(JSON.stringify(o).includes('deliveryFee'),false)
 assert.equal(JSON.stringify(o).includes('1111111111'),false)
 assert.equal(o.items[0].quantity,2)
})
test('exact revision acknowledgement is idempotent, authorized writer remains tenant scoped',async()=>{
 const db=fixture();revision(db)
 db.sqlite.prepare("INSERT INTO roles(id,business_id,code,name,created_at,updated_at) VALUES('r1',?,'custom','Custom',?,?)").run(B,NOW,NOW)
 db.sqlite.prepare("INSERT INTO users(id,business_id,display_name,login_normalized,role_id,created_at,updated_at) VALUES('u1',?,'Operador','u1','r1',?,?)").run(B,NOW,NOW)
 assert.equal(await acknowledgeOperationalOrderEdit(db,B,'o1',1,'u1',new Date(NOW)),true)
 assert.equal(await acknowledgeOperationalOrderEdit(db,B,'o1',1,'u1',new Date(NOW)),true)
 assert.equal((await loadOperationalEditSignals(db,B)).get('o1').editPending,false)
 await assert.rejects(acknowledgeOperationalOrderEdit(db,T,'o1',1,'u1',new Date(NOW)),{status:404})
 await assert.rejects(acknowledgeOperationalOrderEdit(db,B,'o1',2,'u1',new Date(NOW)),{status:409})
})
test('finance-only later revision does not suppress or raise a kitchen edit alert',async()=>{
 const db=fixture();revision(db)
 db.sqlite.prepare("UPDATE orders SET content_revision=2 WHERE business_id=? AND id='o1'").run(B)
 db.sqlite.prepare("INSERT INTO order_edit_revisions(id,business_id,order_id,revision,actor_name,edited_at,before_total_cents,after_total_cents,changes_json) VALUES('rev-2',?,'o1',2,'Operador',?,8000,8000,?)").run(B,NOW,JSON.stringify({items:[],deliveryFee:{before:1,after:2}}))
 const signal=(await loadOperationalEditSignals(db,B)).get('o1')
 assert.equal(signal.operationalRevision,1)
 assert.equal(signal.editPending,true)
})

test('acknowledging one operational revision never acknowledges the next',async()=>{
 const db=fixture();revision(db)
 db.sqlite.prepare("INSERT INTO roles(id,business_id,code,name,created_at,updated_at) VALUES('r2',?,'custom2','Custom2',?,?)").run(B,NOW,NOW)
 db.sqlite.prepare("INSERT INTO users(id,business_id,display_name,login_normalized,role_id,created_at,updated_at) VALUES('u2',?,'Operador','u2','r2',?,?)").run(B,NOW,NOW)
 await acknowledgeOperationalOrderEdit(db,B,'o1',1,'u2',new Date(NOW))
 db.sqlite.prepare("UPDATE orders SET content_revision=2,last_edited_at=? WHERE business_id=? AND id='o1'").run(NOW,B)
 db.sqlite.prepare("INSERT INTO order_edit_revisions(id,business_id,order_id,revision,actor_name,edited_at,before_total_cents,after_total_cents,changes_json) VALUES('rev-new',?,'o1',2,'Operador',?,8000,8000,?)")
   .run(B,NOW,JSON.stringify({items:[{kind:'added',before:null,after:{name:'Água',quantity:1,note:''}}]}))
 const signal=(await loadOperationalEditSignals(db,B)).get('o1')
 assert.equal(signal.operationalRevision,2)
 assert.equal(signal.editPending,true)
 await assert.rejects(acknowledgeOperationalOrderEdit(db,B,'o1',1,'u2',new Date(NOW)),{status:409})
 assert.equal((await loadOperationalEditSignals(db,B)).get('o1').editPending,true)
})
