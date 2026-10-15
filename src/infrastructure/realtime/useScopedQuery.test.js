import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import {act,create} from 'react-test-renderer'
import {createCollectionSyncGuard} from '../../app/runtime/data/dataSync.js'
const loadHook=async()=> (await import('./useScopedQuery.js')).useScopedQuery
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}}
function realtimeFixture(){const listeners=new Set();return {subscribeInvalidations:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},emit:event=>Promise.all([...listeners].map(fn=>fn(event)))}}
async function mount(t,options){
  const hook=await loadHook();let current,renderer
  function Harness(props){current=hook({...options,...props});return null}
  await act(async()=>{renderer=create(React.createElement(Harness))})
  t.after(()=>renderer.unmount())
  return {get current(){return current},update:props=>renderer.update(React.createElement(Harness,props))}
}
const options=load=>({accessContextId:'A',queryKey:'all',enabled:true,load,collections:['orders'],topics:['orders'],guard:createCollectionSyncGuard(['orders'])})
test('scoped query loads once and appends pages by identity while retaining server totals and day counts',async t=>{
  const calls=[],h=await mount(t,options(async({cursor})=>{calls.push(cursor);return cursor?{orders:[{id:'a',paid:true},{id:'b'}],summary:{all:200,days:{tomorrow:100}},queryKey:'server',nextCursor:null}:{orders:[{id:'a'}],summary:{all:200,days:{today:100}},queryKey:'server',nextCursor:'next'}}))
  assert.equal(h.current.status,'ready');assert.equal(h.current.hasMore,true)
  await act(async()=>h.current.loadNext())
  assert.deepEqual(calls,[undefined,'next']);assert.deepEqual(h.current.data.orders,[{id:'a',paid:true},{id:'b'}])
  assert.deepEqual(h.current.data.summary.days,{today:100,tomorrow:100});assert.equal(h.current.data.summary.all,200)
})
test('render-time owner/query changes hide old state and ignore late responses even before unmount',async t=>{
  const late=deferred(),h=await mount(t,options(()=>late.promise))
  await act(async()=>h.update({accessContextId:'B',queryKey:'other',load:async()=>({orders:[{id:'B'}],queryKey:'B'})}))
  assert.deepEqual(h.current.data.orders,[{id:'B'}])
  late.resolve({orders:[{id:'A-private'}]})
  await act(async()=>{})
  assert.deepEqual(h.current.data.orders,[{id:'B'}])
})
test('mutation during a query discards stale data, retains dirty and retries with one request in flight',async t=>{
  t.mock.timers.enable({apis:['setTimeout']})
  const pending=deferred(),guard=createCollectionSyncGuard(['orders']);let calls=0
  const h=await mount(t,{...options(()=>++calls===1?pending.promise:Promise.resolve({orders:[{id:'paid',paymentStatus:'Pago'}]})),guard})
  guard.markMutation(['orders']);pending.resolve({orders:[{id:'stale',paymentStatus:'Pendente'}]})
  await act(async()=>{})
  assert.equal(h.current.data,null);assert.equal(calls,1)
  await act(async()=>t.mock.timers.tick(250))
  assert.equal(calls,2);assert.equal(h.current.data.orders[0].paymentStatus,'Pago')
})
test('realtime hints and official mutation revision reload active queries without adding intervals',async t=>{
  const realtime=realtimeFixture(),intervals=[];let reads=0
  t.mock.method(globalThis,'setInterval',(_fn,ms)=>{intervals.push(ms);return 1})
  const h=await mount(t,{...options(async()=>({orders:[{id:String(++reads)}]})),realtime,officialRevision:1})
  assert.equal(reads,1)
  await act(async()=>realtime.emit({topics:['printing']}));assert.equal(reads,1)
  await act(async()=>realtime.emit({topics:['orders']}));assert.equal(reads,2)
  await act(async()=>h.update({officialRevision:2}));assert.equal(reads,3)
  assert.deepEqual(intervals,[])
})
test('changed page cursor reloads the first page but access denial clears state and stops retries',async t=>{
  let calls=0,denied=0
  const h=await mount(t,{...options(async({cursor})=>{calls++;if(cursor)throw Object.assign(new Error('changed'),{status:409,code:'READ_QUERY_CHANGED'});return{orders:[{id:'ok'}],queryKey:'server',nextCursor:'page'}}),onUnauthorized:()=>denied++})
  await act(async()=>h.current.loadNext())
  assert.equal(calls,3);assert.equal(denied,0);assert.deepEqual(h.current.data.orders,[{id:'ok'}])
  await act(async()=>h.update({queryKey:'denied',load:async()=>{throw Object.assign(new Error('denied'),{status:403})}}))
  assert.equal(h.current.data,null);assert.equal(denied,1)
})
test('transient failure retries only after 30 seconds and disabling clears private data and subscriptions',async t=>{
  t.mock.timers.enable({apis:['setTimeout']})
  const realtime=realtimeFixture();let reads=0
  const h=await mount(t,{...options(async()=>{if(++reads===1)throw new Error('offline');return {orders:[{id:'ok'}]}}),realtime})
  assert.equal(h.current.status,'error')
  await act(async()=>realtime.emit({topics:['orders']}));assert.equal(reads,1)
  await act(async()=>t.mock.timers.tick(30000));assert.equal(reads,2)
  await act(async()=>h.update({enabled:false}));assert.equal(h.current.data,null)
  await act(async()=>realtime.emit({topics:['orders']}));assert.equal(reads,2)
})
