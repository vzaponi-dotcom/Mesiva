import test from 'node:test'
import assert from 'node:assert/strict'
test('scoped read adapters use contextual HTTP, explicit query fields and cancellation',async()=>{
  const {createScopedReadsApi}=await import('./scopedReadsApi.js'),calls=[],controller=new AbortController()
  const api=createScopedReadsApi({request:async(...args)=>{calls.push(args);return {orders:[]}}})
  await api.getHistory({period:'all',search:'João / almoço',limit:50,cursor:'opaque',businessId:'not-authority'},{signal:controller.signal})
  const url=new URL(calls[0][0],'https://example.test')
  assert.equal(url.pathname,'/api/reads/orders/history');assert.equal(url.searchParams.get('search'),'João / almoço')
  assert.equal(url.searchParams.has('businessId'),false);assert.equal(calls[0][1].signal,controller.signal)
  await api.getActiveOrders();assert.equal(calls.at(-1)[0],'/api/reads/orders/active')
  await api.getCustomerRelationship('client/with-slash',{filter:'pending'})
  assert.equal(new URL(calls.at(-1)[0],'https://example.test').pathname,'/api/reads/customers/client%2Fwith-slash/relationship')
})
