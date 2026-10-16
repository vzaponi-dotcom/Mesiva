import assert from 'node:assert/strict'
import test from 'node:test'
import { handleRequest } from '../index.js'
import { createTenancyFixture } from '../test-support/tenancyDb.js'
import { prepareAccountSession } from '../identity/sessions.js'
import { commitIdentityStatements } from '../identity/transactions.js'
import { createKitchenTvCredential } from '../kitchenTvAuth.js'
import { BusinessRealtimeHub } from './businessRealtimeHub.js'
import { createHubFixture } from './test-support/hubFixture.js'

const origin='https://example.test',protocol='mesiva.realtime.v1'
async function setup(t) {
  const f=await createTenancyFixture(t),hubs=new Map(),names=new Map()
  const namespace={
    idFromName(name){if(!names.has(name))names.set(name,(names.size+1).toString(16).padStart(64,'0'));return this.idFromString(names.get(name))},
    idFromString(value){if(!/^[a-f0-9]{64}$/.test(value))throw new TypeError('Invalid object id');return {toString:()=>value}},
    get(id){const key=id.toString();if(!hubs.has(key)){const fixture=createHubFixture();fixture.ctx.id=id;fixture.clock.now=Date.now();fixture.options.upgradeResponse=webSocket=>({status:101,headers:new Headers({'Sec-WebSocket-Protocol':protocol}),webSocket});hubs.set(key,{...fixture,hub:new BusinessRealtimeHub(fixture.ctx,{},fixture.options)})}return hubs.get(key).hub},
  }
  const env={DB:f.db,AUTH_MULTI_COMPANY_ENABLED:'true',REALTIME_ENABLED:'true',BUSINESS_REALTIME:namespace}
  const issue=async(accountId=f.accounts.alice,businessId=f.businesses.A)=>{
    const prepared=await prepareAccountSession(f.db,{accountId,businessId,scope:'business',expectedCredentialRevision:1})
    await commitIdentityStatements(f.db,prepared.statements);return prepared.value
  }
  const session=await issue()
  const post=(path,body={},current=session,extra={})=>handleRequest(new Request(origin+path,{method:'POST',headers:{origin,cookie:`mesiva_session=${current.token}`,'X-Mesiva-Context':current.contextId,'content-type':'application/json',...extra},body:JSON.stringify(body)}),env)
  const prepare=async()=>{const response=await post('/api/realtime/prepare');assert.equal(response.status,200,'missing authenticated realtime prepare');return response.json()}
  const upgrade=(ticket,current=session,extra={},query='')=>handleRequest(new Request(origin+'/api/realtime/socket'+query,{headers:{origin,upgrade:'websocket','sec-websocket-protocol':`${protocol}, ticket.${ticket}`,...(current?{cookie:`mesiva_session=${current.token}`} : {}),...extra}}),env)
  const sockets=()=>[...hubs.values()].flatMap(f=>f.sockets)
  return {...f,env,session,post,prepare,upgrade,issue,sockets,hubs}
}

test('prepare requires current context and origin; flag off retains HTTP compatibility',async t=>{
  const f=await setup(t)
  assert.equal((await f.post('/api/realtime/prepare',{},f.session,{'X-Mesiva-Context':'stale'})).status,409)
  assert.equal((await f.post('/api/realtime/prepare',{},f.session,{origin:'https://foreign.test'})).status,403)
  const result=await f.prepare()
  assert.equal(result.enabled,true);assert.equal(result.socketPath,'/api/realtime/socket');assert.equal(result.protocol,protocol)
  assert.equal(Object.hasOwn(result,'businessId'),false)
  f.env.REALTIME_ENABLED='false'
  const response=await f.post('/api/realtime/prepare')
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{enabled:false})
})
for(const [name,change] of [
  ['logout',f=>f.sqlite.prepare('UPDATE identity_sessions SET revoked_at=? WHERE id=?').run(new Date().toISOString(),f.session.identitySessionId)],
  ['context',f=>f.sqlite.prepare('UPDATE identity_sessions SET context_id=? WHERE id=?').run('new-context',f.session.identitySessionId)],
  ['credential',f=>f.sqlite.prepare('UPDATE account_credentials SET revision=revision+1 WHERE account_id=?').run(f.accounts.alice)],
  ['role',f=>f.sqlite.prepare('UPDATE roles SET version=version+1 WHERE business_id=? AND code=?').run(f.businesses.A,'manager')],
  ['membership',f=>f.sqlite.prepare('UPDATE users SET active=0 WHERE id=?').run(f.members.aliceA)],
  ['business',f=>f.sqlite.prepare("UPDATE businesses SET lifecycle_status='suspended' WHERE id=?").run(f.businesses.A)],
  ['unknown grant',f=>f.sqlite.prepare('INSERT INTO role_capabilities(business_id,role_id,capability) VALUES(?,?,?)').run(f.businesses.A,`${f.businesses.A}:manager`,'future.capability')],
]) test(`upgrade revalidates ${name} after prepare`,async t=>{
  const f=await setup(t),{ticket}=await f.prepare();change(f)
  assert.ok([401,403,409].includes((await f.upgrade(ticket)).status))
  assert.equal(f.sockets().length,0)
})
test('upgrade is single use even concurrently, sends no ticket in URL or response protocol',async t=>{
  const f=await setup(t),{ticket}=await f.prepare()
  const results=await Promise.all([f.upgrade(ticket),f.upgrade(ticket)])
  assert.equal(results.filter(response=>response.status===101).length,1)
  assert.equal(f.sockets().length,1)
  const accepted=results.find(response=>response.status===101)
  assert.equal(accepted.headers.get('Sec-WebSocket-Protocol'),protocol)
  assert.equal(JSON.stringify([...accepted.headers]).includes(ticket),false)
  const next=await f.prepare()
  const denied=await f.upgrade(next.ticket,f.session,{},'?ticket=forbidden')
  assert.equal(denied.status,400)
  assert.equal(JSON.stringify(await denied.json()).includes(next.ticket),false)
})
test('ticket cannot cross company, principal or origin',async t=>{
  const f=await setup(t),otherCompany=await f.issue(f.accounts.alice,f.businesses.B),otherPrincipal=await f.issue(f.accounts.bob,f.businesses.A)
  for(const current of [otherCompany,otherPrincipal]) {
    const {ticket}=await f.prepare()
    assert.ok([401,403,409].includes((await f.upgrade(ticket,current)).status))
  }
  const {ticket}=await f.prepare()
  assert.equal((await f.upgrade(ticket,f.session,{origin:'https://foreign.test'})).status,403)
  assert.equal(f.sockets().length,0)
})
test('renew rejects changed role and cannot extend another principal connection',async t=>{
  const f=await setup(t),{ticket}=await f.prepare()
  assert.equal((await f.upgrade(ticket)).status,101)
  const socket=f.sockets()[0],connectionId=socket.messages[0].connectionId
  const other=await f.issue(f.accounts.bob,f.businesses.A)
  assert.equal((await f.post('/api/realtime/renew',{connectionId},other)).status,403)
  assert.equal(socket.readyState,1)
  f.sqlite.prepare('UPDATE roles SET version=version+1 WHERE business_id=? AND code=?').run(f.businesses.A,'manager')
  const response=await f.post('/api/realtime/renew',{connectionId})
  assert.equal(response.status,409);assert.equal((await response.json()).error.code,'SESSION_CONTEXT_CHANGED')
  assert.equal(socket.readyState,3)
})
test('TV prepares with paired legacy header and upgrades without a human cookie',async t=>{
  const f=await setup(t),credential=await createKitchenTvCredential(),at=new Date().toISOString()
  f.sqlite.prepare('INSERT INTO kitchen_tv_access(business_id,session_token_hash,session_issued_at,paired_at,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(f.businesses.A,credential.tokenHash,at,at,at,at)
  const request=(path,body={})=>handleRequest(new Request(origin+path,{method:'POST',headers:{origin,'content-type':'application/json','x-kitchen-tv-session':credential.token},body:JSON.stringify(body)}),f.env)
  assert.equal((await f.post('/api/kitchen-tv/realtime/prepare')).status,401)
  const prepare=await request('/api/kitchen-tv/realtime/prepare')
  assert.equal(prepare.status,200)
  const {ticket}=await prepare.json()
  assert.equal((await f.upgrade(ticket,null)).status,101)
  const socket=f.sockets()[0],data=socket.deserializeAttachment()
  assert.deepEqual(data.access.topics,['orders','kitchen-tv'])
  assert.equal(JSON.stringify(data).includes(credential.token),false)
  assert.equal((await request('/api/kitchen-tv/realtime/renew',{connectionId:data.connectionId})).status,200)
  const next=await request('/api/kitchen-tv/realtime/prepare'),nextTicket=(await next.json()).ticket
  f.sqlite.prepare('UPDATE kitchen_tv_access SET revoked_at=? WHERE business_id=?').run(at,f.businesses.A)
  assert.equal((await f.upgrade(nextTicket,null)).status,401)
})

test('invalid opaque routing identity fails closed without reflecting the ticket',async t=>{
  const f=await setup(t),{ticket}=await f.prepare()
  f.env.BUSINESS_REALTIME.idFromString=()=>{throw new TypeError('Invalid opaque object identity')}
  const response=await f.upgrade(ticket)
  assert.equal(response.status,400)
  assert.equal(JSON.stringify(await response.json()).includes(ticket),false)
})
test('human topic subscriptions follow persisted capabilities and never expose forbidden order IDs',async t=>{
  const f=await setup(t),other=await f.issue(f.accounts.bob,f.businesses.A),role=`${f.businesses.A}:operator`
  f.sqlite.prepare('DELETE FROM role_capabilities WHERE business_id=? AND role_id=?').run(f.businesses.A,role)
  f.sqlite.prepare('INSERT INTO role_capabilities(business_id,role_id,capability) VALUES(?,?,?)').run(f.businesses.A,role,'clients.view')
  const prepared=await f.post('/api/realtime/prepare',{},other)
  assert.equal(prepared.status,200)
  assert.equal((await f.upgrade((await prepared.json()).ticket,other)).status,101)
  const socket=f.sockets()[0]
  assert.deepEqual(socket.deserializeAttachment().access.topics,['clients','settings'])
  const hub=[...f.hubs.values()][0].hub
  await hub.publish({topics:['orders','clients'],orderIds:['private-order']})
  assert.deepEqual(socket.messages.at(-1).topics,['clients'])
  assert.deepEqual(socket.messages.at(-1).orderIds,[])
})
