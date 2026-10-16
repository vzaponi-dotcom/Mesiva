import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { act,create } from 'react-test-renderer'
import { useRealtimeRuntime } from './useRealtimeRuntime.js'
import { clientFixture } from './test-support/clientFixture.js'

test('runtime keeps one contextual transport and rejects old owner callbacks at render',async t=>{
  const f=clientFixture(),events=[],transport={clock:null};let current
  Object.assign(transport,{clock:f.clock,createSocket:f.createSocket,random:()=>0.5})
  // Browser clock/socket boundaries are injected into the real transport.
  const Harness=props=>{current=useRealtimeRuntime({api:f.api,enabled:true,accessContextId:'A',visible:true,transport,...props});return null}
  let renderer
  await act(async()=>{renderer=create(React.createElement(Harness))});t.after(()=>renderer.unmount())
  const unsubscribe=current.subscribeInvalidations(e=>events.push(e));t.after(unsubscribe)
  const old=f.sockets[0],oldMessage=old.onmessage;await act(async()=>{old.ready(f.clock);await f.clock.tick(250)})
  assert.equal(current.state,'live');assert.equal(events.length,1)
  events.length=0
  await act(async()=>renderer.update(React.createElement(Harness,{accessContextId:'B'})))
  oldMessage({data:JSON.stringify({version:1,type:'invalidate',revision:'2',topics:['orders'],orderIds:['stale']})});await act(async()=>f.clock.tick(250))
  assert.deepEqual(events,[]);assert.equal(old.closed,true)
})
test('disabling the runtime cancels its socket and timers',async t=>{
  const f=clientFixture();let current
  const Harness=props=>{current=useRealtimeRuntime({api:f.api,enabled:true,accessContextId:'A',visible:true,operational:true,transport:{clock:f.clock,createSocket:f.createSocket},...props});return null}
  let renderer
  await act(async()=>{renderer=create(React.createElement(Harness))});t.after(()=>renderer.unmount())
  await act(async()=>renderer.update(React.createElement(Harness,{enabled:false})))
  await act(async()=>f.clock.tick(300_000))
  assert.equal(current.state,'stopped');assert.equal(f.sockets.length,1);assert.equal(f.clock.timers.size,0)
})


test('a continuously visible connected page does not refetch on focus, but resyncs after hiding and returning',async t=>{
 const previousWindow=globalThis.window,previousDocument=globalThis.document
 const window=new EventTarget(),document=Object.assign(new EventTarget(),{visibilityState:'visible'})
 globalThis.window=window;globalThis.document=document
 t.after(()=>{globalThis.window=previousWindow;globalThis.document=previousDocument})
 const f=clientFixture(),events=[],transport={clock:f.clock,createSocket:f.createSocket,random:()=>0.5};let current,renderer
 function Harness(){current=useRealtimeRuntime({api:f.api,enabled:true,accessContextId:'A',transport});return null}
 await act(async()=>{renderer=create(React.createElement(Harness))});t.after(()=>renderer.unmount())
 const unsubscribe=current.subscribeInvalidations(event=>events.push(event));t.after(unsubscribe)
 await act(async()=>{f.sockets[0].ready(f.clock);await f.clock.tick(250)})
 events.length=0
 await act(async()=>{window.dispatchEvent(new Event('focus'));await f.clock.tick(250)})
 assert.equal(events.length,0)
 document.visibilityState='hidden'
 await act(async()=>document.dispatchEvent(new Event('visibilitychange')))
 assert.equal(current.state,'suspended')
 document.visibilityState='visible'
 await act(async()=>document.dispatchEvent(new Event('visibilitychange')))
 await act(async()=>{f.sockets.at(-1).ready(f.clock);await f.clock.tick(250)})
 assert.equal(events.length,1);assert.equal(events[0].requiresFullRefresh,true)
})
