import test from 'node:test'
import assert from 'node:assert/strict'
import { createManagementFixture } from '../test-support/companyManagementDb.js'
import { withBusinessSessionGuard } from './guardedBusinessDb.js'
import { prepareAccountSession } from '../identity/sessions.js'
import { listEligibleBusinesses, loadEligibleBusinessLogo } from './eligibleBusinesses.js'
import { loadKitchenTvSessionByHash, activateKitchenTvApprovedRequest } from '../kitchenTvRepository.js'
import { reportKitchenTvDisplay } from '../kitchenTvControlRepository.js'

test('suspended and deleted companies cannot receive a human session or appear as eligible', async t => {
  const f=await createManagementFixture(t)
  for (const state of ['suspended','deleted']) {
    f.sqlite.prepare('UPDATE businesses SET lifecycle_status=? WHERE id=?').run(state,f.businesses.A)
    await assert.rejects(prepareAccountSession(f.db,{accountId:f.accounts.alice,expectedCredentialRevision:1,scope:'business',businessId:f.businesses.A,now:f.now}),{status:403})
    assert.deepEqual((await listEligibleBusinesses(f.db,f.accounts.alice)).map(b=>b.businessId),[f.businesses.B])
    assert.equal(await loadEligibleBusinessLogo(f.db,f.accounts.alice,f.businesses.A),null)
  }
})

test('session guard rolls back writes when suspension wins before batch commit', async t => {
  const f=await createManagementFixture(t), original=f.db.batch.bind(f.db)
  const guarded=withBusinessSessionGuard(f.db,f.contexts.aliceA,{now:f.now})
  f.db.batch=async statements=>{f.sqlite.prepare("UPDATE businesses SET lifecycle_status='suspended' WHERE id=?").run(f.businesses.A);return original(statements)}
  await assert.rejects(guarded.prepare('UPDATE businesses SET name=? WHERE id=? RETURNING id').bind('Changed',f.businesses.A).all(),{status:409})
  assert.equal(f.sqlite.prepare('SELECT name FROM businesses WHERE id=?').get(f.businesses.A).name,'Company A')
})

test('session guard preserves batch results, first(column) and changes-dependent statements', async t => {
  const f=await createManagementFixture(t), guarded=withBusinessSessionGuard(f.db,f.contexts.aliceA,{now:f.now})
  assert.equal(await guarded.prepare('SELECT name FROM businesses WHERE id=?').bind(f.businesses.A).first('name'),'Company A')
  const result=await guarded.batch([guarded.prepare('UPDATE businesses SET name=? WHERE id=?').bind('Renamed',f.businesses.A),guarded.prepare('SELECT changes() AS changed')])
  assert.equal(result[0].meta.changes,1)
  assert.equal(result[1].results[0].changed,1)
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM identity_tx_assertions').get().n,0)
})

test('suspended TV credential and preapproved pairing cannot reopen access', async t => {
  const f=await createManagementFixture(t), at=f.now.toISOString()
  f.sqlite.prepare('INSERT INTO kitchen_tv_access(business_id,session_token_hash,session_issued_at,created_at,updated_at) VALUES(?,?,?,?,?)').run(f.businesses.A,'tv-hash',at,at,at)
  f.sqlite.prepare('INSERT INTO kitchen_tv_pairing_requests(request_token_hash,pairing_code,approved_business_id,expires_at,created_at,approved_at) VALUES(?,?,?,?,?,?)').run('request-hash','123456',f.businesses.A,'2026-10-03T00:00:00.000Z',at,at)
  f.sqlite.prepare("UPDATE businesses SET lifecycle_status='suspended' WHERE id=?").run(f.businesses.A)
  assert.equal(await loadKitchenTvSessionByHash(f.db,'tv-hash'),null)
  assert.equal(await activateKitchenTvApprovedRequest(f.db,'request-hash','new-tv-hash',f.now),null)
})

test('multi-company TV requires initial activation even when lifecycle is enabled', async t => {
  const f=await createManagementFixture(t),at=f.now.toISOString()
  f.sqlite.prepare('INSERT INTO kitchen_tv_access(business_id,session_token_hash,session_issued_at,created_at,updated_at) VALUES(?,?,?,?,?)').run(f.businesses.A,'tv-pending',at,at,at)
  f.sqlite.prepare("UPDATE businesses SET access_status='pending' WHERE id=?").run(f.businesses.A)
  assert.equal(await loadKitchenTvSessionByHash(f.db,'tv-pending',undefined,{requireActive:true}),null)
})

test('display report cannot write state for a suspended company', async t => {
  const f=await createManagementFixture(t)
  f.sqlite.prepare("UPDATE businesses SET lifecycle_status='suspended' WHERE id=?").run(f.businesses.A)
  await assert.rejects(reportKitchenTvDisplay(f.db,f.businesses.A,{appliedRevision:0,currentPage:1,pageCount:1,viewportWidth:1280,viewportHeight:720,visibleOrderIds:[]},f.now))
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM kitchen_tv_display_control WHERE business_id=?').get(f.businesses.A).n,0)
})


test('read-only batches validate the same session snapshot without assertion-table writes',async t=>{
  const f=await createManagementFixture(t),guarded=withBusinessSessionGuard(f.db,f.contexts.aliceA,{now:f.now})
  const before=f.sqlite.prepare('SELECT total_changes() AS n').get().n
  const results=await guarded.batch([
    guarded.prepare('SELECT name FROM businesses WHERE id=?').bind(f.businesses.A),
    guarded.prepare('SELECT COUNT(*) AS n FROM businesses'),
  ])
  assert.equal(results[0].results[0].name,'Company A');assert.ok(results[1].results[0].n>0)
  assert.equal(f.sqlite.prepare('SELECT total_changes() AS n').get().n,before)
})

for(const change of ['suspend','grants','revoke'])test(`read-only session guard rejects ${change} winning before its batch`,async t=>{
  const f=await createManagementFixture(t),batch=f.db.batch.bind(f.db)
  const guarded=withBusinessSessionGuard(f.db,f.contexts.aliceA,{now:f.now})
  f.db.batch=async statements=>{
    if(change==='suspend')f.sqlite.prepare("UPDATE businesses SET lifecycle_status='suspended' WHERE id=?").run(f.businesses.A)
    if(change==='grants')f.sqlite.prepare("DELETE FROM role_capabilities WHERE role_id=(SELECT role_id FROM users WHERE id=?)").run(f.members.aliceA)
    if(change==='revoke')f.sqlite.prepare('UPDATE identity_sessions SET revoked_at=? WHERE id=?').run(f.now.toISOString(),f.contexts.aliceA.identitySessionId)
    return batch(statements)
  }
  await assert.rejects(guarded.prepare('SELECT name FROM businesses WHERE id=?').bind(f.businesses.A).first(),{status:409})
})

test('unclassified SQL and mixed mutations retain transactional assertions and changes()',async t=>{
  const f=await createManagementFixture(t),guarded=withBusinessSessionGuard(f.db,f.contexts.aliceA,{now:f.now})
  const before=f.sqlite.prepare('SELECT total_changes() AS n').get().n
  const result=await guarded.batch([
    guarded.prepare('WITH value(name) AS (SELECT ?) UPDATE businesses SET name=(SELECT name FROM value) WHERE id=?').bind('Changed',f.businesses.A),
    guarded.prepare('SELECT changes() AS n'),
  ])
  assert.equal(result[0].meta.changes,1);assert.equal(result[1].results[0].n,1)
  assert.equal(f.sqlite.prepare('SELECT total_changes() AS n').get().n-before,3)
})
