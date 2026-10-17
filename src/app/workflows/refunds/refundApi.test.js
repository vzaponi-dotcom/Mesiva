import test from 'node:test'
import assert from 'node:assert/strict'
import { createRefundApi } from './refundApi.js'

test('refundApi posts the existing refund payload', async () => {
  const calls = []

  const api = createRefundApi({
    request: async (...args) => {
      calls.push(args)
      return { order: {}, movement: {} }
    },
    json: (method, body) => ({
      method,
      body: JSON.stringify(body),
    }),
  })

  await api.refundOrder('o 1', { refundMethod: 'Dinheiro' })

  assert.equal(calls[0][0], '/api/orders/o%201/refund')
  assert.equal(calls[0][1].method, 'POST')
  assert.deepEqual(JSON.parse(calls[0][1].body), { refundMethod: 'Dinheiro' })
})

test('Task 14 manual partial refund posts an exact amount with durable mutation identity',async()=>{
 const calls=[]
 const api=createRefundApi({request:async(...args)=>{calls.push(args);return {}},
   json:(method,body)=>({method,body:JSON.stringify(body)})})
 const payload={mutationId:'refund-1',expectedContentRevision:4,expectedTotalCents:6500,
   expectedNetReceivedCents:8000,amountCents:1000,refundMethod:'Pix'}
 await api.registerPartialRefund('order 1',payload)
 assert.deepEqual(calls.map(([url,options])=>[url,options.method,JSON.parse(options.body)]),
   [['/api/orders/order%201/partial-refund','POST',payload]])
})
