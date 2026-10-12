import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readdirSync, readFileSync } from 'node:fs'
import { createSettingsDb } from './test-support/settingsDb.js'
import { APPLICATION_CAPABILITIES } from '../shared/settingsAccess.js'
import { seedBuiltinRoles, loadRoleGrants } from './access/roles.js'

const BUSINESS = 'amor-e-sabor'
const OTHER = 'order-edit-other'
const NOW = '2026-10-10T14:00:00.000Z'
const directory = new URL('../migrations/', import.meta.url)
const files = () => readdirSync(directory).filter(file => file.endsWith('.sql')).sort()

function setup(t) {
  const fixture = createSettingsDb()
  t.after(fixture.close)
  return fixture.sqlite
}

function seedBusiness(sqlite, id) {
  sqlite.prepare('INSERT INTO businesses(id,slug,name,created_at,updated_at) VALUES(?,?,?,?,?)')
    .run(id, id, id, NOW, NOW)
}

function seedOrder(sqlite, id, businessId) {
  sqlite.prepare("INSERT INTO orders (id,business_id,client_name_snapshot,type,order_date,status,subtotal_cents,total_cents,created_at) VALUES (?,?,?,'Entrega','2026-10-10','Em preparo',8000,8000,?)")
    .run(id, businessId, 'Cliente', NOW)
}

function seedActor(sqlite, businessId, name) {
  const roleId = businessId + ':test-role'
  const userId = businessId + ':' + name
  sqlite.prepare("INSERT INTO roles (id,business_id,code,name,created_at,updated_at) VALUES (?,?,?,'Teste',?,?)")
    .run(roleId,businessId,'test-role',NOW,NOW)
  sqlite.prepare('INSERT INTO users (id,business_id,display_name,login_normalized,role_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
    .run(userId,businessId,name,userId,roleId,NOW,NOW)
  return userId
}

function recordEdit(sqlite, { id = 'edit-1', businessId = BUSINESS, orderId = 'order-1', revision = 1, actorId = null } = {}) {
  sqlite.prepare("INSERT INTO order_edit_revisions (id,business_id,order_id,revision,actor_user_id,actor_name,edited_at,before_total_cents,after_total_cents,changes_json) VALUES (?,?,?,?,?,'Operador',?,8000,9500,?)")
    .run(id,businessId,orderId,revision,actorId,NOW,JSON.stringify({ items: [{ change: 'added', name: 'Bebida', quantity: 1 }] }))
}

function apply(sqlite, names) {
  for (const name of names) {
    const sql = readFileSync(new URL(name, directory), 'utf8')
    if (Number(name.slice(0, 4)) < 24) sqlite.exec(sql)
    else {
      sqlite.exec('BEGIN')
      try { sqlite.exec(sql); sqlite.exec('COMMIT') }
      catch (error) { sqlite.exec('ROLLBACK'); throw error }
    }
  }
  sqlite.exec('PRAGMA foreign_keys=ON')
}

test('0042 clean install adds revision, history, mutation receipt and kitchen acknowledgement', t => {
  const sqlite = setup(t)
  const columns = sqlite.prepare('PRAGMA table_info(orders)').all().map(row => row.name)
  for (const column of ['content_revision', 'last_edited_at']) assert.ok(columns.includes(column), column)
  for (const name of ['order_edit_revisions','order_edit_mutation_receipts','order_kitchen_edit_acknowledgements']) {
    assert.ok(sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name),name)
  }
  seedOrder(sqlite,'order-1',BUSINESS)
  assert.equal(sqlite.prepare("SELECT content_revision FROM orders WHERE id='order-1'").get().content_revision,0)
  assert.throws(()=>sqlite.prepare("UPDATE orders SET content_revision=-1 WHERE id='order-1'").run(),/CHECK/)
  assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[])
})

test('0042 upgrade preserves orders and grants existing builtin roles without touching custom roles', t => {
  const names=files()
  const migration='0042_order_editing_foundation.sql'
  assert.ok(names.includes(migration), '0042 must remain available after newer additive migrations')
  const sqlite=new DatabaseSync(':memory:')
  t.after(()=>sqlite.close())
  apply(sqlite,names.filter(name=>name<migration))
  seedOrder(sqlite,'existing',BUSINESS)
  seedBusiness(sqlite,OTHER)
  for (const [id,business,code,builtin] of [
    ['manager',BUSINESS,'manager',1],['operator',BUSINESS,'operator',1],
    ['custom',BUSINESS,'custom',0],['lookalike',OTHER,'operator',0],
  ]) sqlite.prepare('INSERT INTO roles (id,business_id,code,name,is_builtin,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
    .run(id,business,code,code,builtin,NOW,NOW)
  sqlite.prepare('INSERT INTO role_capabilities(business_id,role_id,capability) VALUES (?,?,?)')
    .run(BUSINESS,'custom','orders.view')
  const existing={...sqlite.prepare("SELECT * FROM orders WHERE id='existing'").get()}
  apply(sqlite,[migration])
  assert.deepEqual({...sqlite.prepare("SELECT * FROM orders WHERE id='existing'").get()},
    {...existing,content_revision:0,last_edited_at:null})
  for(const id of ['manager','operator'])
    assert.equal(sqlite.prepare("SELECT count(*) n FROM role_capabilities WHERE role_id=? AND capability='orders.edit'").get(id).n,1)
  for(const id of ['custom','lookalike'])
    assert.equal(sqlite.prepare("SELECT count(*) n FROM role_capabilities WHERE role_id=? AND capability='orders.edit'").get(id).n,0)
  assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[])
})

test('order revisions are immutable, tenant scoped and unique per order revision',t=>{
  const sqlite=setup(t)
  seedOrder(sqlite,'order-1',BUSINESS)
  seedBusiness(sqlite,OTHER)
  seedOrder(sqlite,'order-2',OTHER)
  const actor=seedActor(sqlite,BUSINESS,'ana')
  const foreignActor=seedActor(sqlite,OTHER,'jose')
  recordEdit(sqlite,{actorId:actor})
  assert.equal(JSON.parse(sqlite.prepare("SELECT changes_json FROM order_edit_revisions WHERE id='edit-1'").get().changes_json).items[0].name,'Bebida')
  assert.throws(()=>recordEdit(sqlite,{id:'edit-2',revision:1}),/UNIQUE/)
  assert.throws(()=>recordEdit(sqlite,{id:'wrong-tenant',businessId:BUSINESS,orderId:'order-2'}),/FOREIGN KEY/)
  assert.throws(()=>recordEdit(sqlite,{id:'wrong-actor',actorId:foreignActor,revision:2}),/FOREIGN KEY/)
  assert.throws(()=>sqlite.prepare("UPDATE order_edit_revisions SET changes_json='{}' WHERE id='edit-1'").run(),/IMMUTABLE/)
  assert.throws(()=>sqlite.prepare("DELETE FROM order_edit_revisions WHERE id='edit-1'").run(),/IMMUTABLE/)
  assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[])
})

test('idempotency receipts support no-op edits, reject duplicate keys and cannot be rewritten',t=>{
  const sqlite=setup(t)
  seedOrder(sqlite,'order-1',BUSINESS)
  seedOrder(sqlite,'order-3',BUSINESS)
  const insert=(orderId,mutationId,revision,changed,hash='a'.repeat(64))=>
    sqlite.prepare("INSERT INTO order_edit_mutation_receipts (business_id,order_id,mutation_id,request_hash,result_revision,changed,result_json,created_at) VALUES (?,?,?,?,?,?,'{}',?)")
      .run(BUSINESS,orderId,mutationId,hash,revision,changed,NOW)
  insert('order-1','same',0,0)
  assert.throws(()=>insert('order-1','same',0,0),/UNIQUE/)
  insert('order-3','same',0,0)
  assert.throws(()=>insert('order-1','bad',0,0,'oops'),/CHECK/)
  assert.throws(()=>insert('order-1','bad-changed',0,1),/CHECK/)
  assert.throws(()=>sqlite.prepare("UPDATE order_edit_mutation_receipts SET request_hash='x' WHERE mutation_id='same' AND order_id='order-1'").run(),/IMMUTABLE/)
  assert.equal(sqlite.prepare("SELECT count(*) n FROM order_edit_mutation_receipts WHERE mutation_id='same'").get().n,2)
})

test('acknowledgement can refer only to same tenant and exact revision',t=>{
  const sqlite=setup(t)
  seedOrder(sqlite,'order-1',BUSINESS)
  seedBusiness(sqlite,OTHER)
  seedOrder(sqlite,'order-2',OTHER)
  const actor=seedActor(sqlite,BUSINESS,'ana')
  const outsider=seedActor(sqlite,OTHER,'jose')
  recordEdit(sqlite,{actorId:actor})
  recordEdit(sqlite,{id:'edit-2',revision:2,actorId:actor})
  const acknowledge=(orderId,revision,userId)=>
    sqlite.prepare('INSERT INTO order_kitchen_edit_acknowledgements (business_id,order_id,revision,acknowledged_by_user_id,acknowledged_at) VALUES (?,?,?,?,?)')
      .run(BUSINESS,orderId,revision,userId,NOW)
  acknowledge('order-1',1,actor)
  assert.throws(()=>acknowledge('order-1',1,actor),/UNIQUE/)
  assert.throws(()=>acknowledge('order-1',3,actor),/FOREIGN KEY/)
  assert.throws(()=>acknowledge('order-1',2,outsider),/FOREIGN KEY/)
  assert.throws(()=>acknowledge('order-2',1,actor),/FOREIGN KEY/)
  assert.throws(()=>sqlite.prepare('DELETE FROM order_kitchen_edit_acknowledgements').run(),/IMMUTABLE/)
  assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[])
})

test('orders.edit is seeded for builtin manager/operator without granting custom roles',async t=>{
  const {db,sqlite,close}=createSettingsDb()
  t.after(close)
  assert.ok(APPLICATION_CAPABILITIES.includes('orders.edit'))
  await seedBuiltinRoles(db,BUSINESS,new Date(NOW))
  for (const code of ['manager','operator']) {
    const grants=await loadRoleGrants(db,BUSINESS,BUSINESS+':'+code)
    assert.ok(grants.has('orders.edit'),code)
  }
  sqlite.prepare("INSERT INTO roles (id,business_id,code,name,created_at,updated_at) VALUES ('custom-role',?,'custom','Custom',?,?)").run(BUSINESS,NOW,NOW)
  assert.equal((await loadRoleGrants(db,BUSINESS,'custom-role')).has('orders.edit'),false)
})
