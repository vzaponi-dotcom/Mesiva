import test from 'node:test'
import assert from 'node:assert/strict'
import { createSettingsDb } from './test-support/settingsDb.js'
import { seedBuiltinRoles } from './access/roles.js'
import { createUserSession } from './access/sessions.js'
import { handleRequest } from './index.js'

const B='amor-e-sabor', NOW=new Date('2026-10-10T15:00:00Z')
async function fixture(t) {
 const {db,sqlite,close}=createSettingsDb();t.after(close)
 await seedBuiltinRoles(db,B,NOW)
 sqlite.exec("UPDATE business_auth_state SET mode='user_only'")
 sqlite.prepare('INSERT INTO users(id,business_id,display_name,login_normalized,role_id,email_verified_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
  .run('editor',B,'Editor','editor@example.test',B+':operator',NOW.toISOString(),NOW.toISOString(),NOW.toISOString())
 sqlite.prepare('INSERT INTO user_credentials(business_id,user_id,password_verifier,password_changed_at,created_at,updated_at) VALUES(?,?,?,?,?,?)')
  .run(B,'editor','synthetic-verifier',NOW.toISOString(),NOW.toISOString(),NOW.toISOString())
 const token=(await createUserSession({DB:db},{businessId:B,userId:'editor'})).token
 sqlite.prepare('INSERT INTO products(id,business_id,category,size,name,price_cents,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
  .run('p1',B,'Bebidas','Un','Suco',3200,1,NOW.toISOString(),NOW.toISOString())
 sqlite.prepare("INSERT INTO orders(id,business_id,order_number,client_name_snapshot,type,order_date,status,subtotal_cents,total_cents,created_at) VALUES ('o1',?,9,'Visitante','Entrega','2026-10-10','Em preparo',3200,3200,?)").run(B,NOW.toISOString())
 sqlite.prepare("INSERT INTO order_items(id,business_id,order_id,product_id,name_snapshot,quantity,catalog_price_cents,unit_price_cents,note,created_at) VALUES('i1',?,'o1','p1','Suco',1,3200,3200,'',?)").run(B,NOW.toISOString())
 return {db,sqlite,token}
}
const payload=(overrides={})=>({expectedContentRevision:0,mutationId:'via-http',items:[{id:'i1',quantity:2,note:'sem gelo'}],...overrides})
const request=(token,body=payload(),origin='https://delivery.test')=>new Request('https://delivery.test/api/orders/o1',{
 method:'PATCH',headers:{cookie:'amor_session='+token,origin,'content-type':'application/json'},
 body:JSON.stringify(body),
})
test('PATCH order enforces orders.edit and prevents forged grants',async t=>{
 const {db,sqlite,token}=await fixture(t)
 sqlite.prepare("DELETE FROM role_capabilities WHERE business_id=? AND capability='orders.edit'").run(B)
 const response=await handleRequest(request(token,{...payload(),granted:['orders.edit']}),{DB:db})
 assert.equal(response.status,403)
 assert.equal(sqlite.prepare("SELECT content_revision FROM orders WHERE id='o1'").get().content_revision,0)
})
test('PATCH order saves official edit, responds with current order and blocks duplicate submission',async t=>{
 const {db,sqlite,token}=await fixture(t)
 const first=await handleRequest(request(token),{DB:db})
 assert.equal(first.status,200,JSON.stringify(await first.clone().json()))
 const body=await first.json()
 assert.equal(body.order.id,'o1')
 assert.equal(body.order.contentRevision,1)
 assert.equal(body.order.total,64)
 assert.equal((await handleRequest(request(token),{DB:db})).status,200)
 assert.equal(sqlite.prepare("SELECT count(*) n FROM order_edit_revisions").get().n,1)
})
test('PATCH rejects cross-origin and validation-bypass fields before any mutation',async t=>{
 const {db,sqlite,token}=await fixture(t)
 assert.equal((await handleRequest(request(token,payload(),'https://evil.test'),{DB:db})).status,403)
 assert.equal((await handleRequest(request(token,payload({orderDate:'2000-01-01'})),{DB:db})).status,400)
 assert.equal(sqlite.prepare("SELECT content_revision FROM orders WHERE id='o1'").get().content_revision,0)
})
