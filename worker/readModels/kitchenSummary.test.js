import test from 'node:test'
import assert from 'node:assert/strict'
import {createSettingsDb} from '../test-support/settingsDb.js'
import {seedOperationalReadFixture} from '../test-support/operationalReadFixture.js'
const businessId='amor-e-sabor',now=new Date('2026-10-15T12:00:00Z')
test('finished-today counter preserves Date.parse, status, history grants and business isolation without historical payloads',async t=>{
 const f=createSettingsDb();t.after(f.close)
 const {readKitchenSummary}=await import('./kitchenSummary.js')
 const ids=await seedOperationalReadFixture(f.db,{businessId,historicalOrders:5})
 for(const [i,stamp] of ['2026-10-15T02:59:59.999Z','2026-10-15T03:00:00.000Z','2026-10-16T02:59:59.999Z','2026-10-16T03:00:00.000Z','2026-10-15T11:00:00-03:00'].entries())f.sqlite.prepare('UPDATE orders SET finished_at=? WHERE id=?').run(stamp,ids.historicalIds[i])
 assert.deepEqual(await readKitchenSummary(f.db,businessId,{granted:new Set(['orders.view','orders.history']),now}),{finishedToday:3,businessDate:'2026-10-15'})
 assert.equal((await readKitchenSummary(f.db,businessId,{granted:new Set(['orders.view']),now})).finishedToday,0)
 await assert.rejects(readKitchenSummary(f.db,businessId,{granted:new Set(['orders.history']),now}),{status:403})
 const prepare=f.db.prepare,plans=[]
 f.db.prepare=sql=>({bind:(...values)=>{plans.push(...f.sqlite.prepare('EXPLAIN QUERY PLAN '+sql).all(...values).map(r=>r.detail));return prepare(sql).bind(...values)}})
 await seedOperationalReadFixture({...f.db,prepare},{businessId,historicalOrders:10000,historicalOffset:100000,itemsPerOrder:1})
 assert.equal((await readKitchenSummary(f.db,businessId,{granted:new Set(['orders.view','orders.history']),now})).finishedToday,3)
 assert.ok(plans.every(p=>!/^SCAN orders\b/.test(p)),plans.join('\n'))
})
