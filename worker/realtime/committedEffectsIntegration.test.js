import test from 'node:test'
import assert from 'node:assert/strict'
import { handleRequest } from '../index.js'
import { createManagementFixture } from '../test-support/companyManagementDb.js'
import { withCommittedEffects } from './committedEffects.js'
import { prepareAccountSession, revokeBrowserFamily } from '../identity/sessions.js'
import { prepareGlobalSessionRevocation } from '../identity/challenges.js'
import { commitIdentityStatements } from '../identity/transactions.js'
import { selectAccountScope } from '../tenancy/scopeSelection.js'
import { activateKitchenTvApprovedRequest, revokeKitchenTvAccess } from '../kitchenTvRepository.js'
import { performBusinessManagement } from '../platform/managementCommands.js'

async function marked(t){const f=await createManagementFixture(t),events=[];return {...f,events,db:withCommittedEffects(f.db,{onCommitted:e=>events.push(e)})}}
test('logout, context switch and password revocation invalidate committed session targets in each company',async t=>{
  const f=await marked(t)
  await revokeBrowserFamily(f.db,f.contexts.aliceA,f.now)
  assert.ok(f.events.some(e=>e.businessId===f.businesses.A && e.invalidations.some(i=>i.scope==='session' && i.id===f.contexts.aliceA.identitySessionId)))
  f.events.length=0
  await selectAccountScope(f.db,f.contexts.aliceB,{scope:'business',businessId:f.businesses.B,contextId:f.contexts.aliceB.contextId},f.now)
  assert.ok(f.events.some(e=>e.businessId===f.businesses.B && e.invalidations.some(i=>i.scope==='session' && i.id===f.contexts.aliceB.identitySessionId)))
  const fresh=await prepareAccountSession(f.db,{accountId:f.accounts.alice,businessId:f.businesses.A,scope:'business',expectedCredentialRevision:1,now:f.now})
  await commitIdentityStatements(f.db,fresh.statements)
  f.events.length=0
  await commitIdentityStatements(f.db,prepareGlobalSessionRevocation(f.db,f.accounts.alice,f.now))
  assert.deepEqual(new Set(f.events.map(e=>e.businessId)),new Set([f.businesses.A,f.businesses.B]))
  assert.ok(f.events.every(e=>e.invalidations.some(i=>i.scope==='principal' && i.id===f.accounts.alice)))
})
test('TV activation and unpairing invalidate old access only after accepted writes',async t=>{
  const f=await marked(t),at=f.now.toISOString()
  f.sqlite.prepare('INSERT INTO kitchen_tv_pairing_requests(request_token_hash,pairing_code,approved_business_id,expires_at,created_at,approved_at) VALUES(?,?,?,?,?,?)').run('request','123456',f.businesses.A,'2026-10-03T00:00:00.000Z',at,at)
  await activateKitchenTvApprovedRequest(f.db,'request','tv-session',f.now)
  assert.ok(f.events.some(e=>e.businessId===f.businesses.A && e.invalidations.some(i=>i.scope==='business')))
  f.events.length=0
  await activateKitchenTvApprovedRequest(f.db,'missing','unused',f.now)
  assert.deepEqual(f.events,[])
  await revokeKitchenTvAccess(f.db,f.businesses.A,f.now)
  assert.ok(f.events.some(e=>e.invalidations.some(i=>i.scope==='business')))
})
test('platform suspension invalidates the committed company and idempotent replay is silent',async t=>{
  const f=await marked(t),target={businessId:f.businesses.A,operation:'suspend'},input={reason:'Manutenção',expectedRevision:0},options={idempotencyKey:crypto.randomUUID(),now:f.now}
  await performBusinessManagement({DB:f.db},f.contexts.admin,target,input,options)
  assert.ok(f.events.some(e=>e.businessId===f.businesses.A && e.invalidations.some(i=>i.scope==='business')))
  f.events.length=0
  await performBusinessManagement({DB:f.db},f.contexts.admin,target,input,options)
  assert.deepEqual(f.events,[])
})
test('HTTP commit followed by final authentication failure still publishes without repeating business write',async t=>{
  const f=await createManagementFixture(t),pending=[],published=[]
  const prepared=await prepareAccountSession(f.db,{accountId:f.accounts.alice,businessId:f.businesses.A,scope:'business',expectedCredentialRevision:1})
  await commitIdentityStatements(f.db,prepared.statements)
  const original=f.db.batch.bind(f.db)
  let changed=false
  f.db.batch=async statements=>{const result=await original(statements);if(!changed && f.sqlite.prepare('SELECT count(*) n FROM clients').get().n){changed=true;f.sqlite.prepare('UPDATE roles SET version=version+1 WHERE business_id=?').run(f.businesses.A)}return result}
  const env={DB:f.db,AUTH_MULTI_COMPANY_ENABLED:'true',REALTIME_ENABLED:'true',BUSINESS_REALTIME:{idFromName:n=>n,get:()=>({publish:async e=>published.push(e),invalidate:async()=>{}})}}
  const request=new Request('https://example.test/api/clients',{method:'POST',headers:{origin:'https://example.test',cookie:`mesiva_session=${prepared.value.token}`,'X-Mesiva-Context':prepared.value.contextId,'content-type':'application/json'},body:JSON.stringify({name:'Fictício'})})
  const response=await handleRequest(request,env,{waitUntil:p=>pending.push(p)})
  await Promise.all(pending)
  assert.equal(response.status,409)
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM clients').get().n,1)
  assert.deepEqual(published,[{topics:['clients'],orderIds:[]}])
  assert.equal(env.DB,f.db)
})
