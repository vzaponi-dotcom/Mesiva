import test from 'node:test'
import assert from 'node:assert/strict'
import { createPaymentApi } from './paymentApi.js'

test('paymentApi sends canonical allocations for standalone order, whole-table and client-batch routes', async () => {
  const calls = []
  const api = createPaymentApi({
    request: async (...args) => { calls.push(args); return {} },
    json: (method, body) => ({ method, body: JSON.stringify(body) }),
  })

  const allocations = [
    { methodCode: 'cash', amountCents: 3000 },
    { methodCode: 'pix', amountCents: 5000 },
  ]
  await api.registerOrderPayment('o 1', allocations)
  await api.registerTableTabPayment('tab 1', allocations)
  await api.registerClientOrdersPayment('client 1', ['o1', 'o2'], allocations)

  assert.deepEqual(calls.map(([url, options]) => [url, options.method, JSON.parse(options.body)]), [
    ['/api/orders/o%201/payment', 'POST', { allocations }],
    ['/api/table-tabs/tab%201/payment', 'POST', { allocations }],
    ['/api/clients/client%201/receivables/payment', 'POST', { orderIds: ['o1', 'o2'], allocations }],
  ])
})

test('Task 14 supplementary settlement posts exact mutation and money snapshot',async()=>{
 const calls=[]
 const api=createPaymentApi({request:async(...args)=>{calls.push(args);return {}},
   json:(method,body)=>({method,body:JSON.stringify(body)})})
 const payload={mutationId:'edit-receive-1',expectedContentRevision:3,expectedTotalCents:9500,
   expectedNetReceivedCents:8000,allocations:[{methodCode:'pix',amountCents:1000},{methodCode:'cash',amountCents:500}]}
 await api.registerSupplementalPayment('order 1',payload)
 assert.deepEqual(calls.map(([url,options])=>[url,options.method,JSON.parse(options.body)]),
   [['/api/orders/order%201/supplemental-payment','POST',payload]])
})

test('single-order API includes an explicitly chosen receipt date without changing legacy payloads', async () => {
  const calls = []
  const api = createPaymentApi({
    request: async (...args) => { calls.push(args); return {} },
    json: (method, body) => ({ method, body: JSON.stringify(body) }),
  })
  const allocations = [{ methodCode: 'pix', amountCents: 5000 }]
  await api.registerOrderPayment('first', allocations, { receivedDate: '2026-10-15' })
  await api.registerOrderPayment('second', allocations)
  assert.deepEqual(calls.map(([,options]) => JSON.parse(options.body)), [
    { allocations, receivedDate: '2026-10-15' },
    { allocations },
  ])
})


test('shared client and comanda requests include optional receipt date while keeping legacy payload shape',async()=>{
  const calls=[]
  const api=createPaymentApi({request:async(...args)=>{calls.push(args);return {}},
    json:(method,body)=>({method,body:JSON.stringify(body)})})
  const allocations=[{methodCode:'pix',amountCents:2000}]
  await api.registerTableTabPayment('t',allocations,{receivedDate:'2026-10-15'})
  await api.registerTableTabPayment('t2',allocations)
  await api.registerClientOrdersPayment('c',['o1','o2'],allocations,{mutationId:'key-1',receivedDate:'2026-10-15'})
  await api.registerClientOrdersPayment('c',['o3','o4'],allocations,{mutationId:'key-2'})
  assert.deepEqual(calls.map(([,o])=>JSON.parse(o.body)),[
    {allocations,receivedDate:'2026-10-15'},
    {allocations},
    {orderIds:['o1','o2'],allocations,mutationId:'key-1',receivedDate:'2026-10-15'},
    {orderIds:['o3','o4'],allocations,mutationId:'key-2'},
  ])
})
