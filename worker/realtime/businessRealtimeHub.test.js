import assert from 'node:assert/strict'
import test from 'node:test'
import { createHubFixture } from './test-support/hubFixture.js'
let module = {}
try { module = await import('./businessRealtimeHub.js') } catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error }
function setup(env={}) {
  assert.equal(typeof module.BusinessRealtimeHub, 'function', 'missing BusinessRealtimeHub')
  const fixture=createHubFixture()
  return {...fixture,hub:new module.BusinessRealtimeHub(fixture.ctx,env,fixture.options)}
}
async function connect(f,overrides={}) {
  const descriptor={...f.descriptor,...overrides}
  const issued=await f.hub.issueTicket(descriptor)
  const accepted=await f.hub.consumeTicket(issued.ticket)
  assert.deepEqual(accepted,descriptor)
  const response=await f.hub.fetch(new Request('https://realtime.internal/connect',{headers:{upgrade:'websocket','X-Mesiva-Realtime-Descriptor':JSON.stringify(accepted)}}))
  assert.equal(response.status,101)
  return f.sockets.at(-1)
}

test('ticket is consumed once even concurrently and only its hash is stored',async()=>{
  const f=setup(),issued=await f.hub.issueTicket(f.descriptor)
  assert.match(issued.ticket,/^[a-f0-9]{64}\.[A-Za-z0-9_-]{43}$/)
  assert.equal(JSON.stringify([...f.storage.data]).includes(issued.ticket),false)
  const results=await Promise.all([f.hub.consumeTicket(issued.ticket),f.hub.consumeTicket(issued.ticket)])
  assert.equal(results.filter(Boolean).length,1)
  assert.deepEqual(results.find(Boolean),f.descriptor)
})
test('expired ticket is rejected at the sixty second boundary',async()=>{
  const f=setup(),issued=await f.hub.issueTicket(f.descriptor)
  f.clock.now+=60000
  assert.equal(await f.hub.consumeTicket(issued.ticket),null)
})
test('hibernation restores revision and subscriptions from persisted state and attachments',async()=>{
  const f=setup(),socket=await connect(f)
  const first=await f.hub.publish({topics:['orders'],orderIds:['order-A']})
  f.hub=new module.BusinessRealtimeHub(f.ctx,{},f.options)
  const second=await f.hub.publish({topics:['orders'],orderIds:['order-B']})
  assert.ok(BigInt(second)>BigInt(first))
  assert.deepEqual(socket.messages.at(-1).orderIds,['order-B'])
})
test('expired lease receives no IDs and cannot be renewed',async()=>{
  const f=setup(),socket=await connect(f),ready=socket.messages[0]
  f.clock.now+=75000
  await f.hub.publish({topics:['orders'],orderIds:['private-order']})
  assert.equal(socket.messages.some(message=>message.orderIds?.includes('private-order')),false)
  assert.equal(socket.readyState,3)
  await assert.rejects(f.hub.renew(ready.connectionId,f.descriptor))
})
test('foreign topics and order IDs are filtered per subscriber',async()=>{
  const f=setup(),socket=await connect(f,{topics:['printing']})
  await f.hub.publish({topics:['orders'],orderIds:['private-order']})
  assert.equal(socket.messages.length,1)
  await f.hub.publish({topics:['orders','printing'],orderIds:['private-order']})
  assert.deepEqual(socket.messages.at(-1).topics,['printing'])
  assert.deepEqual(socket.messages.at(-1).orderIds,[])
})
test('overflow requests resync instead of sending oversized IDs',async()=>{
  const f=setup(),socket=await connect(f)
  await f.hub.publish({topics:['orders'],orderIds:Array.from({length:100},(_,i)=>`order-${i}`)})
  assert.equal(socket.messages.at(-1).type,'resync_required')
  assert.deepEqual(socket.messages.at(-1).orderIds,[])
})
test('slow or broken socket is closed without blocking peers',async()=>{
  const f=setup(),slow=await connect(f),peer=await connect(f)
  slow.failSend=true
  await f.hub.publish({topics:['orders'],orderIds:['order-A']})
  assert.equal(slow.readyState,3)
  assert.deepEqual(peer.messages.at(-1).orderIds,['order-A'])
})
test('tickets and connections obey bounded company and principal limits',async()=>{
  const f=setup({REALTIME_MAX_CONNECTIONS:'2',REALTIME_MAX_CONNECTIONS_PER_PRINCIPAL:'1',REALTIME_MAX_PENDING_TICKETS:'2'})
  await connect(f)
  await assert.rejects(connect(f))
  await connect(f,{principalId:'account-B',sessionId:'session-B',contextId:'context-B'})
  await assert.rejects(connect(f,{principalId:'account-C'}))
  const pending=setup({REALTIME_MAX_PENDING_TICKETS:'2'})
  await pending.hub.issueTicket(pending.descriptor);await pending.hub.issueTicket(pending.descriptor)
  await assert.rejects(pending.hub.issueTicket(pending.descriptor))
  pending.clock.now+=60000
  await pending.hub.issueTicket(pending.descriptor)
})
test('renewal cannot cross principal/context/auth snapshot and invalidation closes only matching sockets',async()=>{
  const f=setup(),a=await connect(f),b=await connect(f,{principalId:'account-B',sessionId:'session-B',contextId:'context-B'})
  const connectionId=a.messages[0].connectionId
  await assert.rejects(f.hub.renew(connectionId,{...f.descriptor,principalId:'account-B'}))
  f.clock.now+=60000
  const renewed=await f.hub.renew(connectionId,f.descriptor)
  assert.equal(Date.parse(renewed.expiresAt),f.clock.now+75000)
  await f.hub.invalidate({scope:'session',id:'session-A'})
  assert.equal(a.readyState,3);assert.equal(b.readyState,1)
  assert.equal(a.messages.at(-1).type,'access_changed')
})
test('cross-company descriptors and external upgrades are denied, client input never publishes',async()=>{
  const f=setup(),socket=await connect(f)
  await assert.rejects(f.hub.issueTicket({...f.descriptor,businessId:'company-B'}))
  const response=await f.hub.fetch(new Request('https://example.test/connect',{headers:{upgrade:'websocket'}}))
  assert.equal(response.status,404)
  const revision=await f.storage.get('revision')
  await f.hub.webSocketMessage(socket,JSON.stringify({type:'invalidate',orderIds:['injected']}))
  assert.equal(socket.readyState,3)
  assert.equal(await f.storage.get('revision'),revision)
})

test('unacknowledged output is bounded when the runtime has no bufferedAmount',async()=>{
  const f=setup(),slow=await connect(f),peer=await connect(f,{principalId:'account-B',sessionId:'session-B',contextId:'context-B'})
  delete slow.bufferedAmount
  for(let i=0;i<40;i++) {
    await f.hub.publish({topics:['orders'],orderIds:[`order-${i}`]})
    await f.hub.webSocketMessage(peer,JSON.stringify({version:1,type:'ack',revision:peer.messages.at(-1).revision}))
  }
  assert.equal(slow.readyState,3)
  assert.ok(slow.messages.length<=33,'ready plus at most32 notifications may queue without an ack')
  assert.equal(peer.readyState,1)
  assert.deepEqual(peer.messages.at(-1).orderIds,['order-39'])
})
test('acks acknowledge only sent revisions and never advance the hub revision',async()=>{
  const f=setup(),socket=await connect(f)
  const revision=await f.hub.publish({topics:['orders'],orderIds:['order-A']})
  await f.hub.webSocketMessage(socket,JSON.stringify({version:1,type:'ack',revision}))
  assert.equal(socket.readyState,1)
  assert.equal(await f.storage.get('revision'),revision)
  await f.hub.webSocketMessage(socket,JSON.stringify({version:1,type:'ack',revision:(BigInt(revision)+1n).toString()}))
  assert.equal(socket.readyState,3)
})
