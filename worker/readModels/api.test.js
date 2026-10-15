import test from 'node:test'
import assert from 'node:assert/strict'
import {createTenancyFixture} from '../test-support/tenancyDb.js'
import {prepareAccountSession} from '../identity/sessions.js'
import {commitIdentityStatements} from '../identity/transactions.js'
import {seedOperationalReadFixture} from '../test-support/operationalReadFixture.js'
import {handleRequest} from '../index.js'
async function setup(t){
  const f=await createTenancyFixture(t,{operationalDefaults:true})
  const prepared=await prepareAccountSession(f.db,{accountId:f.accounts.alice,businessId:f.businesses.A,scope:'business',expectedCredentialRevision:1})
  await commitIdentityStatements(f.db,prepared.statements)
  const env={DB:f.db,AUTH_MULTI_COMPANY_ENABLED:'true',AUTH_EMAIL_ENABLED:'true',OPERATIONAL_READ_MODELS_ENABLED:'true'}
  return {...f,env,request:path=>new Request('https://example.test'+path,{headers:{cookie:`mesiva_session=${prepared.value.token}`,'X-Mesiva-Context':prepared.value.contextId}})}
}
test('scoped bootstrap is opt-in, isolated and attributable while the legacy response remains complete',async t=>{
  const f=await setup(t),own=await seedOperationalReadFixture(f.db,{businessId:f.businesses.A,activeOrders:1,historicalOrders:1})
  await seedOperationalReadFixture(f.db,{businessId:f.businesses.B,activeOrders:1})
  const response=await handleRequest(f.request('/api/bootstrap?surface=orders&businessId='+f.businesses.B),f.env)
  assert.equal(response.status,200)
  const data=await response.json()
  assert.equal(data.readModel?.surface,'orders')
  assert.deepEqual(data.orders.map(o=>o.id),own.activeIds)
  assert.ok(data.orders[0].attribution)
  const legacy=await (await handleRequest(f.request('/api/bootstrap'),f.env)).json()
  assert.equal(legacy.readModel,undefined);assert.equal(legacy.orders.length,2)
  const disabled=await (await handleRequest(f.request('/api/bootstrap?surface=orders'),{...f.env,OPERATIONAL_READ_MODELS_ENABLED:'false'})).json()
  assert.equal(disabled.readModel,undefined);assert.equal(disabled.orders.length,2)
})
test('new read routes remain business-authenticated and reject unsupported surface values',async t=>{
  const f=await setup(t)
  assert.equal((await handleRequest(new Request('https://example.test/api/reads/orders/active'),f.env)).status,401)
  const response=await handleRequest(f.request('/api/reads/orders/active'),f.env)
  assert.equal(response.status,200);assert.deepEqual((await response.json()).orders,[])
  for(const surface of ['constructor','unknown','../orders'])assert.equal((await handleRequest(f.request('/api/bootstrap?surface='+encodeURIComponent(surface)),f.env)).status,400)
})

test('surface capabilities and counters cannot reveal operational data to a history-only reader',async t=>{
  const f=await setup(t)
  f.sqlite.prepare("DELETE FROM role_capabilities WHERE business_id=? AND role_id=? AND capability IN ('orders.view','comandas.view')").run(f.businesses.A,f.businesses.A+':manager')
  await seedOperationalReadFixture(f.db,{businessId:f.businesses.A,activeOrders:1,historicalOrders:1})
  assert.equal((await handleRequest(f.request('/api/bootstrap?surface=orders'),f.env)).status,403)
  assert.equal((await handleRequest(f.request('/api/reads/orders/active'),f.env)).status,403)
  const response=await handleRequest(f.request('/api/bootstrap?surface=history'),f.env)
  assert.equal(response.status,200)
  const payload=await response.json()
  assert.deepEqual(payload.readModel.counters,{orders:0,comandas:0})
  assert.equal(Object.hasOwn(payload,'orders'),false)
})

test('history pages remain tenant scoped and readable with history capability only',async t=>{
  const f=await setup(t)
  await seedOperationalReadFixture(f.db,{businessId:f.businesses.A,historicalOrders:2,activeOrders:1})
  await seedOperationalReadFixture(f.db,{businessId:f.businesses.B,historicalOrders:2})
  f.sqlite.prepare("DELETE FROM role_capabilities WHERE business_id=? AND role_id=? AND capability='orders.view'").run(f.businesses.A,f.businesses.A+':manager')
  const response=await handleRequest(f.request('/api/reads/orders/history?limit=1&businessId='+f.businesses.B),f.env)
  assert.equal(response.status,200)
  const data=await response.json()
  assert.equal(data.orders.length,1);assert.equal(data.summary.all,2);assert.ok(data.nextCursor)
  assert.ok(data.orders[0].id.startsWith(f.businesses.A+':history:'))
  assert.ok(data.orders[0].attribution)
  assert.equal((await handleRequest(new Request('https://example.test/api/reads/orders/history'),f.env)).status,401)
})

test('revocation during a streamed history read rejects the response before exposing any rows',async t=>{
  const f=await setup(t)
  await seedOperationalReadFixture(f.db,{businessId:f.businesses.A,historicalOrders:200,itemsPerOrder:2})
  const prepare=f.db.prepare;let revoked=false
  const wrap=(statement,sql)=>({...statement,bind:(...values)=>wrap(statement.bind(...values),sql),execute(){
    const result=statement.execute()
    if(!revoked && sql.includes('AS search_items')){
      revoked=true
      f.sqlite.prepare("DELETE FROM role_capabilities WHERE business_id=? AND role_id=? AND capability='orders.history'").run(f.businesses.A,f.businesses.A+':manager')
    }
    return result
  }})
  f.db.prepare=sql=>wrap(prepare(sql),sql)
  const response=await handleRequest(f.request('/api/reads/orders/history?search=prato'),f.env)
  assert.equal(revoked,true);assert.equal(response.status,409)
  const payload=await response.json()
  assert.equal(Object.hasOwn(payload,'orders'),false)
})

test('customer and financial read routes are isolated, gated and reject denied capabilities',async t=>{
  const f=await setup(t)
  for(const path of ['/api/reads/customers','/api/reads/finance/receivables','/api/reads/finance/overview','/api/reads/finance/movements']){
    const response=await handleRequest(f.request(path+'?businessId='+f.businesses.B),f.env)
    assert.equal(response.status,200,path)
    assert.equal((await handleRequest(new Request('https://example.test'+path),f.env)).status,401,path)
  }
  f.sqlite.prepare("INSERT INTO clients(id,business_id,name,phone,address,created_at,updated_at) VALUES('read-client',?,'Fictício','11999998888','','2020','2020')").run(f.businesses.A)
  const profile=await handleRequest(f.request('/api/reads/customers/read-client/relationship'),f.env)
  assert.equal(profile.status,200);assert.equal((await profile.json()).profile.orderCount,0)
  assert.equal((await handleRequest(f.request('/api/reads/customers?sort=constructor'),f.env)).status,400)
  f.sqlite.prepare("DELETE FROM role_capabilities WHERE business_id=? AND role_id=? AND capability IN ('clients.view','finance.receivables','finance.movements','finance.movements.manage','finance.overview')").run(f.businesses.A,f.businesses.A+':manager')
  for(const path of ['/api/reads/customers','/api/reads/customers/read-client/relationship','/api/reads/finance/receivables','/api/reads/finance/overview','/api/reads/finance/movements'])assert.equal((await handleRequest(f.request(path),f.env)).status,403,path)
})

test('kitchen summary stays business-authenticated and preserves history grant visibility',async t=>{
 const f=await setup(t)
 assert.equal((await handleRequest(new Request('https://example.test/api/reads/orders/kitchen-summary'),f.env)).status,401)
 const response=await handleRequest(f.request('/api/reads/orders/kitchen-summary'),f.env)
 assert.equal(response.status,200);assert.equal((await response.json()).finishedToday,0)
 f.sqlite.prepare("DELETE FROM role_capabilities WHERE business_id=? AND role_id=? AND capability='orders.view'").run(f.businesses.A,f.businesses.A+':manager')
 assert.equal((await handleRequest(f.request('/api/reads/orders/kitchen-summary'),f.env)).status,403)
})
