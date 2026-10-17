import test from 'node:test'
import assert from 'node:assert/strict'
import { handleRequest } from './index.js'
import { createTenancyFixture } from './test-support/tenancyDb.js'
import { seedOperationalReadFixture } from './test-support/operationalReadFixture.js'
import { prepareAccountSession } from './identity/sessions.js'
import { commitIdentityStatements } from './identity/transactions.js'
import { prepareAuditEvent } from './access/audit.js'

async function setup(t) {
  const f = await createTenancyFixture(t)
  const own = await seedOperationalReadFixture(f.db,{businessId:f.businesses.A,activeOrders:2,historicalOrders:1})
  const foreign = await seedOperationalReadFixture(f.db,{businessId:f.businesses.B,activeOrders:1})
  const prepared = await prepareAccountSession(f.db,{accountId:f.accounts.alice,businessId:f.businesses.A,scope:'business',expectedCredentialRevision:1})
  await commitIdentityStatements(f.db,prepared.statements)
  const session=prepared.value
  const request = (path,marker=session.contextId) => new Request(`https://example.test${path}`,{headers:{cookie:`mesiva_session=${session.token}`,'X-Mesiva-Context':marker}})
  const read = (ids,marker) => handleRequest(request(`/api/orders/by-ids?ids=${encodeURIComponent(JSON.stringify(ids))}`,marker),f.env)
  f.env={DB:f.db,AUTH_MULTI_COMPANY_ENABLED:'true'}
  return {...f,own,foreign,session,request,read}
}

test('by IDs retains the official list projection and safe audit attributions',async t=>{
  const f=await setup(t), id=f.own.activeIds[0]
  await f.db.batch([prepareAuditEvent(f.db,{businessId:f.businesses.A,userId:f.members.aliceA,displayName:'Alice fictícia',sessionId:f.session.businessSessionId},
    {action:'order.created',resourceType:'order',resourceId:id})])
  const list=await handleRequest(f.request('/api/orders'),f.env)
  assert.equal(list.status,200)
  const all=await list.json(), selected=await f.read([id,id,f.own.historicalIds[0],'missing'])
  assert.equal(selected.status,200)
  assert.equal(selected.headers.get('cache-control'),'no-store')
  const payload=await selected.json()
  assert.equal(payload.orders.length,2)
  for(const order of payload.orders)assert.deepEqual(order,all.orders.find(o=>o.id===order.id))
  assert.deepEqual(payload.orders.find(o=>o.id===id).attribution.createdBy,{type:'user',userId:f.members.aliceA,displayName:'Alice fictícia'})
  assert.equal(JSON.stringify(payload).includes(f.session.businessSessionId),false)
})

test('by IDs never accepts another business from IDs or query parameters',async t=>{
  const f=await setup(t)
  const response=await handleRequest(f.request(`/api/orders/by-ids?businessId=${f.businesses.B}&ids=${encodeURIComponent(JSON.stringify([...f.own.activeIds,...f.foreign.activeIds]))}`),f.env)
  assert.equal(response.status,200)
  assert.deepEqual((await response.json()).orders.map(o=>o.id).sort(),[...f.own.activeIds].sort())
  assert.deepEqual((await (await f.read(f.foreign.activeIds)).json()).orders,[])
  assert.equal((await f.read(f.own.activeIds,'another-context')).status,409)
})

test('by IDs applies view/history capabilities and rejects callers without either',async t=>{
  const f=await setup(t),role=`${f.businesses.A}:manager`
  f.sqlite.prepare(`DELETE FROM role_capabilities WHERE business_id=? AND role_id=? AND capability='orders.history'`).run(f.businesses.A,role)
  let response=await f.read([...f.own.activeIds,...f.own.historicalIds])
  assert.equal(response.status,200)
  assert.deepEqual((await response.json()).orders.map(o=>o.id).sort(),[...f.own.activeIds].sort())
  f.sqlite.prepare(`INSERT INTO role_capabilities(business_id,role_id,capability) VALUES(?,?,'orders.history')`).run(f.businesses.A,role)
  f.sqlite.prepare(`DELETE FROM role_capabilities WHERE business_id=? AND role_id=? AND capability='orders.view'`).run(f.businesses.A,role)
  response=await f.read([...f.own.activeIds,...f.own.historicalIds])
  assert.equal(response.status,200)
  assert.deepEqual((await response.json()).orders.map(o=>o.id),f.own.historicalIds)
  f.sqlite.prepare(`DELETE FROM role_capabilities WHERE business_id=? AND role_id=? AND capability='orders.history'`).run(f.businesses.A,role)
  assert.equal((await f.read(f.own.activeIds)).status,403)
})

test('by IDs rejects malformed parameters and 100 unique IDs while allowing 99',async t=>{
  const f=await setup(t)
  for(const query of ['','?ids=invalid','?ids=null','?ids=%7B%7D',...[[null],[1],[''],['   '],['x'.repeat(201)],Array.from({length:100},(_,i)=>`id-${i}`)].map(ids=>`?ids=${encodeURIComponent(JSON.stringify(ids))}`)]){
    const response=await handleRequest(f.request(`/api/orders/by-ids${query}`),f.env)
    assert.equal(response.status,400,query)
    assert.equal((await response.json()).error.code,'INVALID_ORDER_IDS')
  }
  assert.equal((await f.read(Array.from({length:99},(_,i)=>`id-${i}`))).status,200)
  assert.equal((await f.read(Array(100).fill(f.own.activeIds[0]))).status,200)
  assert.deepEqual((await (await f.read([])).json()).orders,[])
})

test('by IDs rejects changed context after the read without exposing its payload',async t=>{
  const f=await setup(t),marked=new WeakSet(),prepare=f.db.prepare,batch=f.db.batch
  f.db.prepare=sql=>{
    const statement=prepare(sql)
    if(!sql.includes('FROM orders o'))return statement
    return {...statement,bind(...values){const bound=statement.bind(...values);marked.add(bound);return bound}}
  }
  f.db.batch=async statements=>{
    const result=await batch(statements)
    if(statements.some(s=>marked.has(s)))f.sqlite.prepare('UPDATE identity_sessions SET context_id=? WHERE id=?').run('changed-after-read',f.session.identitySessionId)
    return result
  }
  const response=await f.read(f.own.activeIds)
  assert.equal(response.status,409)
  const payload=await response.json()
  assert.equal(payload.error.code,'SESSION_CONTEXT_CHANGED')
  assert.equal(Object.hasOwn(payload,'orders'),false)
})

test('by IDs denies revoked or expired sessions before querying orders',async t=>{
  const f=await setup(t)
  f.sqlite.prepare("UPDATE identity_sessions SET revoked_at='2026-10-01' WHERE id=?").run(f.session.identitySessionId)
  assert.equal((await f.read(f.own.activeIds)).status,401)
  f.sqlite.prepare('UPDATE identity_sessions SET revoked_at=NULL WHERE id=?').run(f.session.identitySessionId)
  t.mock.timers.enable({apis:['Date'],now:Date.parse(f.session.expiresAt)+1})
  assert.equal((await f.read(f.own.activeIds)).status,401)
})
