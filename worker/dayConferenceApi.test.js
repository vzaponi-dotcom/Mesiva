import test from 'node:test'
import assert from 'node:assert/strict'
import { createTenancyFixture } from './test-support/tenancyDb.js'
import { prepareAccountSession } from './identity/sessions.js'
import { commitIdentityStatements } from './identity/transactions.js'
import { handleRequest } from './index.js'

const path='/api/finance/day-conference',day='2026-10-15',origin='https://example.test'
const request=(session,suffix='',options={})=>new Request(origin+path+suffix,{
  ...options,headers:{cookie:`mesiva_session=${session.token}`,'X-Mesiva-Context':session.contextId,
    origin,'content-type':'application/json',...options.headers},
})
async function setup(t){
  const f=await createTenancyFixture(t),sessions={}
  for(const [key,accountId,businessId] of [['A',f.accounts.alice,f.businesses.A],['B',f.accounts.carol,f.businesses.B]]){
    const prepared=await prepareAccountSession(f.db,{accountId,businessId,expectedCredentialRevision:1,scope:'business'})
    await commitIdentityStatements(f.db,prepared.statements);sessions[key]=prepared.value
    f.sqlite.prepare(`INSERT INTO payment_receipts(id,business_id,total_cents,paid_at,received_date,created_at)
      VALUES(?,?,?,'2026-10-17T15:00:00Z',?,'2026-10-17T15:00:00Z')`).run('r-'+key,businessId,key==='A'?1000:9900,day)
    f.sqlite.prepare(`INSERT INTO payment_allocations(id,business_id,receipt_id,method_label,amount_cents,created_at)
      VALUES(?,?,?,'Pix',?,'2026-10-17T15:00:00Z')`).run('a-'+key,businessId,'r-'+key,key==='A'?1000:9900)
    f.sqlite.prepare(`INSERT INTO movements(id,business_id,type,category,description,value_cents,source,movement_date,created_at,receipt_id,payment_allocation_id,payment_method)
      VALUES(?,?,'entrada','sales','Teste',?,'order-payment',?,'2026-10-17T15:00:00Z',?,?,'Pix')`).run('m-'+key,businessId,key==='A'?1000:9900,day,'r-'+key,'a-'+key)
  }
  return {...f,sessions,env:{DB:f.db,AUTH_MULTI_COMPANY_ENABLED:'true'}}
}

test('discrepancy API derives company and actor, enforces capabilities/origin and preserves receipt data',async t=>{
  const f=await setup(t),s=f.sessions.A
  const summary=await (await handleRequest(request(s,'?date='+day),f.env)).json()
  await handleRequest(request(s,'',{method:'POST',body:JSON.stringify({
    date:day,sourceVersion:summary.sourceVersion,requestKey:'discrepancy-api-request',note:'Valor não localizado.',
    lines:[{method:'Pix',checkedCents:900,verified:true}],
  })}),f.env)
  const listResponse=await handleRequest(request(s,'/discrepancies?status=pending'),f.env)
  assert.equal(listResponse.status,200)
  const list=await listResponse.json(),id=list.items[0].id
  assert.equal(list.items.length,1);assert.equal(list.items[0].differenceCents,-100)
  assert.equal((await handleRequest(request(f.sessions.B,'/discrepancies/'+id),f.env)).status,404)
  const suffix='/discrepancies/'+id+'/resolve',body=JSON.stringify({reason:'conference_error',note:'Extrato correto conferido.',confirmed:true,businessId:f.businesses.B,resolvedActorName:'Impostor'})
  assert.equal((await handleRequest(request(s,suffix,{method:'POST',body,headers:{origin:'https://foreign.test'}}),f.env)).status,403)
  assert.equal((await handleRequest(request(s,suffix,{method:'POST',body:'null'}),f.env)).status,400)
  const done=await handleRequest(request(s,suffix,{method:'POST',body}),f.env)
  assert.equal(done.status,200)
  const data=(await done.json()).discrepancy
  assert.equal(data.status,'resolved');assert.notEqual(data.resolvedActorName,'Impostor')
  assert.equal(data.resolvedBy,'member-alice-A')
  assert.equal(f.sqlite.prepare('SELECT value_cents FROM movements WHERE id=?').get('m-A').value_cents,1000)
  f.sqlite.prepare("DELETE FROM role_capabilities WHERE business_id=? AND role_id=? AND capability='finance.movements.manage'").run(f.businesses.A,f.businesses.A+':manager')
  assert.equal((await handleRequest(request(s,'/discrepancies?status=resolved'),f.env)).status,200)
  assert.equal((await handleRequest(request(s,suffix,{method:'POST',body}),f.env)).status,403)
  f.sqlite.prepare("DELETE FROM role_capabilities WHERE business_id=? AND role_id=? AND capability='finance.movements'").run(f.businesses.A,f.businesses.A+':manager')
  assert.equal((await handleRequest(request(s,'/discrepancies?status=resolved'),f.env)).status,403)
})

test('authenticated API isolates totals, entries, immutable snapshots and actor across companies',async t=>{
  const f=await setup(t)
  const a=await handleRequest(request(f.sessions.A,'?date='+day),f.env)
  assert.equal(a.status,200)
  const state=await a.json()
  assert.equal(state.methods[0].grossCents,1000)
  const entries=await handleRequest(request(f.sessions.A,'/entries?'+new URLSearchParams({date:day,method:'Pix',sourceVersion:state.sourceVersion})),f.env)
  assert.deepEqual((await entries.json()).entries.map(e=>e.id),['m-A'])
  const payload={date:day,sourceVersion:state.sourceVersion,requestKey:'api-conference-0000001',
    lines:[{method:'Pix',checkedCents:1000,verified:true}],businessId:f.businesses.B,userId:'forged',actorName:'Forged'}
  const done=await handleRequest(request(f.sessions.A,'',{method:'POST',body:JSON.stringify(payload)}),f.env)
  assert.equal(done.status,201)
  const saved=(await done.json()).conference
  assert.equal(saved.userId,f.members.aliceA)
  assert.equal(saved.actorName,'aliceA')
  assert.equal(saved.revision,1)
  const foreign=await handleRequest(request(f.sessions.B,'/history'),f.env)
  assert.deepEqual((await foreign.json()).history,[])
  const history=await handleRequest(request(f.sessions.A,'/history'),f.env)
  assert.equal((await history.json()).history[0].id,saved.id)
  const selected=await handleRequest(request(f.sessions.A,'/history?date='+day),f.env)
  assert.equal((await selected.json()).history[0].id,saved.id)
  const otherDay=await handleRequest(request(f.sessions.A,'/history?date=2026-10-14'),f.env)
  assert.deepEqual((await otherDay.json()).history,[])
})

test('API rejects stale context, absent grants, missing completion permission, CSRF and invalid JSON',async t=>{
  const f=await setup(t),s=f.sessions.A
  assert.equal((await handleRequest(request(s,'?date='+day,{headers:{'X-Mesiva-Context':'old'}}),f.env)).status,409)
  assert.equal((await handleRequest(request(s,'',{method:'POST',headers:{origin:'https://foreign.test'},body:'{}'}),f.env)).status,403)
  for(const body of ['null','[]','{'])assert.equal((await handleRequest(request(s,'',{method:'POST',body}),f.env)).status,400)
  f.sqlite.prepare("DELETE FROM role_capabilities WHERE business_id=? AND role_id=? AND capability='finance.movements.manage'").run(f.businesses.A,f.businesses.A+':manager')
  assert.equal((await handleRequest(request(s,'?date='+day),f.env)).status,200)
  assert.equal((await handleRequest(request(s,'',{method:'POST',body:'{}'}),f.env)).status,403)
  f.sqlite.prepare("DELETE FROM role_capabilities WHERE business_id=? AND role_id=? AND capability='finance.movements'").run(f.businesses.A,f.businesses.A+':manager')
  assert.equal((await handleRequest(request(s,'?date='+day),f.env)).status,403)
})

test('API validates dates, page, method and source version before running detail queries',async t=>{
  const f=await setup(t),s=f.sessions.A
  for(const query of ['?date=2026-02-30','?date=9999-01-01','/history?date=2026-02-30',
    '/entries?date='+day+'&method=Pix&page=0','/entries?date='+day+'&method=Pix',
    '/entries?date='+day+'&method=&sourceVersion='+'a'.repeat(64)]){
    assert.equal((await handleRequest(request(s,query),f.env)).status,400,query)
  }
})
