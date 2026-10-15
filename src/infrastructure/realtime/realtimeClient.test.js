import test from 'node:test'
import assert from 'node:assert/strict'
import { createRealtimeClient } from './realtimeClient.js'
import { clientFixture, settle } from './test-support/clientFixture.js'
async function setup(t,options={}){const f=clientFixture();Object.assign(f.api,options.api);const client=createRealtimeClient({...f,random:()=>0.5,onUnauthorized:error=>f.unauthorized=error,...options,api:f.api});t.after(()=>client.stop());client.subscribeInvalidations(e=>f.events.push(e));client.subscribeState(s=>f.states.push(s));client.start();await settle();return Object.assign(f,{client})}

test('burst coalesces at 250ms, acknowledges validated receipts and bounds IDs',async t=>{
  const f=await setup(t),s=f.sockets[0];s.ready(f.clock);await f.clock.tick(250);f.events.length=0
  s.invalidate('2',['o1']);s.invalidate('3',['o2']);await f.clock.tick(249);assert.deepEqual(f.events,[])
  await f.clock.tick(1);assert.deepEqual(f.events,[{topics:['orders'],orderIds:['o1','o2'],requiresFullRefresh:false}])
  assert.deepEqual(s.sent.slice(-2),[{version:1,type:'ack',revision:'2'},{version:1,type:'ack',revision:'3'}])
  s.invalidate('4',Array.from({length:99},(_,i)=>`a${i}`));s.invalidate('5',['overflow']);await f.clock.tick(250)
  assert.equal(f.events.at(-1).requiresFullRefresh,true);assert.deepEqual(f.events.at(-1).orderIds,[])
})
test('reconnect backs off 1,2,4,8,16,30 seconds while HTTP fallback remains bounded',async t=>{
  const attempts=[]
  const f=await setup(t,{api:{prepare:async()=>{attempts.push(Date.now());throw Object.assign(new Error('offline'),{status:503})}}})
  attempts.length=0
  f.api.prepare=async()=>{attempts.push(f.clock.now());throw Object.assign(new Error('offline'),{status:503})}
  assert.equal(f.states.at(-1),'fallback')
  await f.clock.tick(61_000)
  assert.deepEqual(attempts.map(at=>at-Date.parse('2026-10-14T15:00:00Z')),[1000,3000,7000,15000,31000,61000])
  // Background snapshots remain on the 30-second fallback cadence.
  assert.equal(f.states.includes('live'),false)
  assert.ok(f.events.length<=4)
  assert.equal(f.clock.timers.size<=3,true)
})
test('lease renews at sixty seconds and no legacy reads occur while live',async t=>{
  const f=await setup(t),s=f.sockets[0];s.ready(f.clock);await f.clock.tick(250);f.events.length=0
  await f.clock.tick(59_749);assert.equal(f.renewals.length,0);assert.deepEqual(f.events,[])
  await f.clock.tick(1);assert.deepEqual(f.renewals,[{id:'connection',at:Date.parse('2026-10-14T15:01:00Z')}])
  await f.clock.tick(15_001);assert.equal(s.closed,false);assert.deepEqual(f.events,[])
})
test('lost publication still reconciles at five minutes even at the same revision',async t=>{
  const f=await setup(t);f.sockets[0].ready(f.clock);await f.clock.tick(250);f.events.length=0
  await f.clock.tick(299_749);assert.deepEqual(f.events,[])
  await f.clock.tick(251);assert.equal(f.events.length,1);assert.equal(f.events[0].requiresFullRefresh,true)
})
test('hidden visual tab suspends, focus resyncs, and an operational socket keeps its lease',async t=>{
  const f=await setup(t);f.sockets[0].ready(f.clock);await f.clock.tick(250);f.events.length=0
  f.client.setActivity({visible:false,operational:false});assert.equal(f.states.at(-1),'suspended')
  await f.clock.tick(300_000);assert.deepEqual(f.events,[])
  f.client.setActivity({visible:true,operational:false});await settle();f.sockets.at(-1).ready(f.clock);await f.clock.tick(250)
  assert.equal(f.events.at(-1).requiresFullRefresh,true)
  f.events.length=0;const live=f.sockets.at(-1)
  f.client.setActivity({visible:false,operational:true});live.invalidate('2');await f.clock.tick(60_250)
  assert.equal(live.closed,false);assert.deepEqual(f.events,[]);assert.ok(f.renewals.length>0)
  f.client.setActivity({visible:true,operational:true});await f.clock.tick(250);assert.equal(f.events.at(-1).requiresFullRefresh,true)
})
test('stopped generation cannot dispatch a late prepare or socket callback',async t=>{
  let resolve
  const f=await setup(t,{api:{prepare:()=>new Promise(r=>resolve=r)}})
  f.client.stop();resolve({enabled:true,ticket:'a'.repeat(64)+'.'+'b'.repeat(43),socketPath:'/api/realtime/socket',protocol:'mesiva.realtime.v1'});await settle()
  assert.equal(f.sockets.length,0);await f.clock.tick(300_000);assert.deepEqual(f.events,[])
})
for(const mode of ['disabled','404'])test(`${mode} uses 30-second HTTP fallback without reconnect storm`,async t=>{
  let prepares=0
  const f=await setup(t,{api:{prepare:async()=>{prepares++;if(mode==='404')throw Object.assign(new Error('old server'),{status:404});return {enabled:false}}}})
  await f.clock.tick(250);f.events.length=0;await f.clock.tick(30_250)
  assert.equal(f.states.at(-1),'fallback');assert.equal(f.events.length,1);assert.equal(prepares,1)
})
test('expired unrenewed lease closes locally and late renewal cannot reopen it',async t=>{
  let renew
  const f=await setup(t,{api:{renew:()=>new Promise(r=>renew=r)}}),s=f.sockets[0]
  s.ready(f.clock);await f.clock.tick(75_001);assert.equal(s.closed,true)
  renew({expiresAt:new Date(f.clock.now()+75_000).toISOString()});await settle();assert.notEqual(f.states.at(-1),'live')
})
test('access changed is delivered to session owner and invalid input never receives ACK',async t=>{
  const f=await setup(t),s=f.sockets[0];s.ready(f.clock)
  s.message({version:1,type:'invalidate',revision:'2',topics:['orders'],orderIds:['o'],private:'forged'})
  assert.deepEqual(s.sent,[])
  // A fresh valid connection receives an access change without exposing an ID.
  await f.clock.tick(1000);const next=f.sockets.at(-1);next.ready(f.clock)
  next.message({version:1,type:'access_changed',revision:'3',topics:[],orderIds:[]})
  assert.equal(f.unauthorized.code,'SESSION_CONTEXT_CHANGED');assert.equal(f.states.at(-1),'stopped')
})

test('timed-out preparation aborts its HTTP request before retry',async t=>{
  let signal
  const f=await setup(t,{api:{prepare:({signal:current})=>{signal=current;return new Promise(()=>{})}}})
  assert.equal(signal.aborted,false)
  await f.clock.tick(10_001)
  assert.equal(signal.aborted,true);assert.equal(f.states.at(-1),'fallback')
})

test('one slow refresh keeps later invalidations dirty and bounded until it finishes',async t=>{
  const f=await setup(t);f.sockets[0].ready(f.clock);await f.clock.tick(250);f.events.length=0
  let resolve
  const remove=f.client.subscribeInvalidations(()=>new Promise(r=>resolve=r));t.after(remove)
  const s=f.sockets[0];s.invalidate('2',['first']);await f.clock.tick(250)
  s.invalidate('3',['second']);await f.clock.tick(1000)
  assert.equal(f.events.length,1)
  resolve();remove();await settle();await f.clock.tick(250)
  assert.equal(f.events.length,2);assert.deepEqual(f.events.at(-1).orderIds,['second'])
})
