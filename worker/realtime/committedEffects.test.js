import test from 'node:test'
import assert from 'node:assert/strict'
import { createSettingsDb } from '../test-support/settingsDb.js'
import { createManagementFixture } from '../test-support/companyManagementDb.js'
import { withBusinessSessionGuard } from '../tenancy/guardedBusinessDb.js'
import { businessEvent, prepareAuditSelection, withAuditContext, recordSecurityEvent } from '../access/audit.js'
import { registerCommittedEffect, withCommittedEffects, publishCommittedEffect } from './committedEffects.js'

const effect={businessId:'amor-e-sabor',topics:['clients'],orderIds:[]}
function fixture(t) {
  const f=createSettingsDb();t.after(f.close)
  const events=[]
  return {...f,events,db:withCommittedEffects(f.db,{onCommitted:e=>events.push(e)})}
}
const insert=db=>db.prepare("INSERT INTO clients(id,business_id,name,created_at,updated_at) VALUES(?,?,?,?,?)").bind('c','amor-e-sabor','Client','2026-10-14','2026-10-14')

test('failed batch emits nothing and rolls back business/audit together',async t=>{
  const f=fixture(t)
  f.sqlite.exec("CREATE TRIGGER reject_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT,'audit unavailable'); END")
  await assert.rejects(f.db.batch([registerCommittedEffect(insert(f.db),effect),businessEvent(f.db,'amor-e-sabor',{action:'client.created',resourceType:'client',resourceId:'c'})]),/audit unavailable/)
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM clients').get().n,0)
  assert.deepEqual(f.events,[])
})

test('committed batch preserves results, changes() positions and groups related effects',async t=>{
  const f=fixture(t)
  const result=await f.db.batch([registerCommittedEffect(insert(f.db),effect),f.db.prepare('SELECT changes() changed'),businessEvent(f.db,'amor-e-sabor',{action:'order.cancelled',resourceType:'order',resourceId:'o1'}),businessEvent(f.db,'amor-e-sabor',{action:'payment.refunded',resourceType:'order',resourceId:'o1'}),businessEvent(f.db,'amor-e-sabor',{action:'printing.requested',resourceType:'print-job',resourceId:'j1'})])
  assert.equal(result.length,5);assert.equal(result[0].meta.changes,1);assert.deepEqual(result[1].results,[{changed:1}])
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM audit_events').get().n,3)
  assert.equal(f.events.length,1)
  assert.deepEqual(new Set(f.events[0].topics),new Set(['clients','orders','tables','reservations','finance','kitchen-tv','printing']))
  assert.deepEqual(f.events[0].orderIds,['o1'])
})

test('idempotent zero-change retry, read, and security audit emit nothing',async t=>{
  const f=fixture(t)
  await registerCommittedEffect(f.db.prepare("UPDATE clients SET name='Unused' WHERE id='missing'"),effect).run()
  await f.db.prepare('SELECT 1').first()
  await businessEvent(f.db,'amor-e-sabor',{action:'client.updated',resourceType:'client',resourceId:'missing',onlyIfChanged:true}).run()
  await recordSecurityEvent(f.db,{businessId:'amor-e-sabor',action:'login.success',result:'success'})
  assert.deepEqual(f.events,[])
})

test('metadata survives bind, audit and session facades before final auth failure',async t=>{
  const f=await createManagementFixture(t),events=[]
  const db=withAuditContext(withBusinessSessionGuard(withCommittedEffects(f.db,{onCommitted:e=>events.push(e)}),f.contexts.aliceA,{now:f.now}),f.contexts.aliceA)
  const statement=registerCommittedEffect(db.prepare('UPDATE businesses SET name=? WHERE id=? RETURNING name'),{businessId:f.businesses.A,topics:['settings'],orderIds:[]})
  assert.equal(await statement.bind('Committed',f.businesses.A).first('name'),'Committed')
  f.sqlite.prepare("UPDATE businesses SET lifecycle_status='suspended' WHERE id=?").run(f.businesses.A)
  await assert.rejects(db.prepare('SELECT 1').first(),{status:409})
  assert.equal(events.length,1);assert.deepEqual(events[0].topics,['settings'])
  assert.equal(f.sqlite.prepare('SELECT name FROM businesses WHERE id=?').get(f.businesses.A).name,'Committed')
})

test('bulk audit selection emits only when candidates actually exist',async t=>{
  const f=fixture(t)
  const selection=()=>prepareAuditSelection(f.db,'amor-e-sabor',{action:'printing.discarded',resourceType:'print-job'},"SELECT id FROM clients WHERE business_id=?",['amor-e-sabor'])
  await selection().run();assert.equal(f.events.length,0)
  await insert(f.db).run()
  await f.db.batch([selection(),f.db.prepare("UPDATE clients SET name='Changed' WHERE business_id='amor-e-sabor'")])
  assert.equal(f.events.length,1);assert.deepEqual(f.events[0].topics,['printing'])
})

test('returned committed tenant identifiers route revocations without extra reads',async t=>{
  const f=fixture(t)
  await insert(f.db).run()
  const statement=registerCommittedEffect(f.db.prepare("UPDATE clients SET name='Changed' RETURNING business_id"),result=>result.results.map(row=>({businessId:row.business_id,topics:[],orderIds:[],invalidations:[{scope:'principal',id:'account'}]})))
  await statement.all()
  assert.equal(f.events.length,1);assert.deepEqual(f.events[0].invalidations,[{scope:'principal',id:'account'}])
})

test('publisher failure never rejects a confirmed mutation or retries it',async t=>{
  const f=fixture(t),pending=[],calls=[]
  const env={REALTIME_ENABLED:'true',BUSINESS_REALTIME:{idFromName:name=>name,get:()=>({publish:async()=>{calls.push('publish');throw new Error('offline')}})}}
  const db=withCommittedEffects(f.db,{onCommitted:e=>publishCommittedEffect(env,e.businessId,e,{waitUntil:p=>pending.push(p)})})
  await registerCommittedEffect(insert(db),effect).run()
  await Promise.all(pending)
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM clients').get().n,1)
  assert.deepEqual(calls,['publish'])
})
