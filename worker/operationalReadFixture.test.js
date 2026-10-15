import test from 'node:test'
import assert from 'node:assert/strict'
import {createSettingsDb} from './test-support/settingsDb.js'
import {seedOperationalReadFixture} from './test-support/operationalReadFixture.js'

test('large fictional history keeps D1 preparation calls bounded and preserves fixture rows',async t=>{
  const f=createSettingsDb();t.after(f.close)
  let prepares=0
  const db={...f.db,prepare(sql){prepares+=1;return f.db.prepare(sql)}}
  const first=await seedOperationalReadFixture(db,{historicalOrders:1000,activeOrders:20})
  const grown=await seedOperationalReadFixture(db,{historicalOrders:9000,historicalOffset:1020})
  assert.equal(first.activeIds[0],'amor-e-sabor:active:0')
  assert.equal(grown.historicalIds[0],'amor-e-sabor:history:1020')
  assert.equal(grown.historicalIds.at(-1),'amor-e-sabor:history:10019')
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM orders').get().n,10020)
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM order_items').get().n,50100)
  assert.equal(f.sqlite.prepare("SELECT count(*) n FROM orders WHERE status='Em preparo'").get().n,20)
  assert.deepEqual(f.sqlite.prepare('PRAGMA foreign_key_check').all(),[])
  assert.ok(prepares<=8,`fixture must not create one remote binding per row: ${prepares}`)
})
