import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { useOrderPaymentWorkflow } from './useOrderPaymentWorkflow.js'

const deferred = () => {
  let resolve
  let reject
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail })
  return { promise, resolve, reject }
}

const order = (id, overrides = {}) => ({
  id,
  client: `Cliente ${id}`,
  type: 'Entrega',
  status: 'Em preparo',
  paymentStatus: 'Pendente',
  total: 40,
  ...overrides,
})

const labels = { pix: 'Pix', cash: 'Dinheiro' }
const paidEffects = (source, allocations = [{ methodCode: 'pix', amountCents: Math.round(source.total * 100) }]) => {
  const receiptId = `receipt-${source.id}`
  const resolved = allocations.map((allocation, index) => ({
    id: `allocation-${source.id}-${index}`,
    receiptId,
    methodCode: allocation.methodCode,
    methodLabel: labels[allocation.methodCode] || allocation.methodCode,
    amountCents: allocation.amountCents,
    amount: allocation.amountCents / 100,
  }))
  const movements = resolved.map((allocation, index) => ({
    id: `movement-${source.id}-${index}`,
    type: 'entrada',
    value: allocation.amount,
    source: 'order-payment',
    paymentMethod: allocation.methodLabel,
  }))
  return {
    receipt: {
      id: receiptId,
      totalCents: Math.round(source.total * 100),
      total: source.total,
      paidAt: '2026-09-21T15:00:00.000Z',
      tableTabId: null,
      allocations: resolved,
    },
    allocations: resolved,
    payment: { id: `payment-${source.id}`, orderId: source.id, receiptId, amount: source.total },
    order: {
      ...source,
      paymentStatus: 'Pago',
      paymentMethod: resolved.length === 1 ? resolved[0].methodLabel : null,
      paidAmount: source.total,
    },
    movements,
    tableTab: null,
  }
}

const paymentOptions = [
  { code: 'pix', value: 'Pix', label: 'Pix' },
  { code: 'cash', value: 'Dinheiro', label: 'Dinheiro' },
]

async function mountWorkflow(overrides = {}) {
  let latest
  let renderer
  let requestKey = null
  const keys = []
  const effects = []
  const successes = []
  const errors = []
  let refreshCalls = 0
  let guard = 1
  let orders = overrides.orders || [order('a')]
  const props = {
    api: overrides.api || { registerOrderPayment: async (id, allocations) => paidEffects(orders.find((item) => item.id === id) || orders[0], allocations) },
    orders,
    granted: overrides.granted || new Set(['orders.view', 'orders.history', 'payments.receive']),
    canReceivePayments: overrides.canReceivePayments ?? true,
    writesBlocked: overrides.writesBlocked ?? false,
    paymentOptions,
    defaultPaymentMethod: 'Pix',
    getSyncGuard: () => guard,
    applyOfficialEffects: (effect) => effects.push(effect),
    refreshOfficialData: async () => { refreshCalls += 1 },
    setRequestKey: (value) => {
      requestKey = typeof value === 'function' ? value(requestKey) : value
      keys.push(requestKey)
    },
    onSuccess: (message) => successes.push(message),
    onError: (error) => errors.push(error),
    ...overrides.props,
  }

  function Probe(currentProps) {
    latest = useOrderPaymentWorkflow(currentProps)
    return null
  }

  await act(async () => {
    renderer = TestRenderer.create(React.createElement(Probe, props))
  })

  return {
    getLatest: () => latest,
    effects,
    keys,
    successes,
    errors,
    getRefreshCalls: () => refreshCalls,
    setGuard: (value) => { guard = value },
    setOrders: async (nextOrders) => {
      orders = nextOrders
      await act(async () => renderer.update(React.createElement(Probe, { ...props, orders })))
    },
    unmount: () => renderer.unmount(),
  }
}

test('double submit sends one canonical allocation request and applies plural authoritative movements once', async () => {
  const source = order('101')
  const pending = deferred()
  const calls = []
  const probe = await mountWorkflow({
    orders: [source],
    api: {
      registerOrderPayment: (...args) => {
        calls.push(args)
        return pending.promise
      },
    },
  })

  await act(async () => assert.equal(probe.getLatest().open(source.id, 'orders'), true))
  assert.deepEqual(probe.getLatest().dialog.allocations, [{ methodCode: 'pix', amountCents: 4000 }])
  let first
  await act(async () => {
    first = probe.getLatest().dialog.submit()
    assert.equal(await probe.getLatest().dialog.submit(), false)
  })
  assert.deepEqual(calls, [[source.id, [{ methodCode: 'pix', amountCents: 4000 }]]])

  const official = { ...paidEffects(source), deletedOrderIds: ['hidden-order'] }
  await act(async () => {
    pending.resolve(official)
    assert.equal(await first, true)
  })

  assert.deepEqual(probe.effects, [official])
  assert.equal(probe.getLatest().dialog, null)
  assert.deepEqual(probe.successes, ['Pagamento recebido via Pix'])
  probe.unmount()
})

test('split composition sends canonical codes and reports a multi-form success without optimistic receipt state', async () => {
  const source = order('150', { total: 80 })
  const calls = []
  const probe = await mountWorkflow({
    orders: [source],
    api: {
      registerOrderPayment: async (id, allocations) => {
        calls.push([id, allocations])
        return paidEffects(source, allocations)
      },
    },
  })

  await act(async () => probe.getLatest().open(source.id, 'orders'))
  await act(async () => probe.getLatest().dialog.setAllocations([
    { methodCode: 'cash', amountCents: 3000 },
    { methodCode: 'pix', amountCents: 5000 },
  ]))
  assert.equal(probe.getLatest().dialog.composition.valid, true)

  await act(async () => assert.equal(await probe.getLatest().dialog.submit(), true))

  assert.deepEqual(calls, [[source.id, [
    { methodCode: 'cash', amountCents: 3000 },
    { methodCode: 'pix', amountCents: 5000 },
  ]]])
  assert.deepEqual(probe.successes, ['Pagamento recebido em 2 formas'])
  assert.equal(probe.effects[0].movements.length, 2)
  probe.unmount()
})

test('response A applies official effects without closing or changing composition of target B', async () => {
  const orderA = order('201')
  const orderB = order('202', { status: 'Finalizado' })
  const pendingA = deferred()
  const pendingB = deferred()
  const calls = []
  const probe = await mountWorkflow({
    orders: [orderA, orderB],
    api: {
      registerOrderPayment: (id, allocations) => {
        calls.push([id, allocations])
        return id === orderA.id ? pendingA.promise : pendingB.promise
      },
    },
  })

  await act(async () => probe.getLatest().open(orderA.id, 'orders'))
  let submissionA
  await act(async () => { submissionA = probe.getLatest().dialog.submit() })
  await act(async () => probe.getLatest().close())
  await act(async () => probe.getLatest().open(orderB.id, 'history'))
  await act(async () => probe.getLatest().dialog.setAllocations([{ methodCode: 'cash', amountCents: 4000 }]))
  let submissionB
  await act(async () => { submissionB = probe.getLatest().dialog.submit() })

  await act(async () => {
    pendingA.resolve(paidEffects(orderA))
    await submissionA
  })

  assert.equal(probe.getLatest().dialog.order.id, orderB.id)
  assert.deepEqual(probe.getLatest().dialog.allocations, [{ methodCode: 'cash', amountCents: 4000 }])
  assert.equal(probe.getLatest().dialog.submitting, true)
  assert.deepEqual(probe.successes, [])

  await act(async () => {
    pendingB.resolve(paidEffects(orderB, [{ methodCode: 'cash', amountCents: 4000 }]))
    await submissionB
  })
  assert.deepEqual(calls, [
    [orderA.id, [{ methodCode: 'pix', amountCents: 4000 }]],
    [orderB.id, [{ methodCode: 'cash', amountCents: 4000 }]],
  ])
  probe.unmount()
})

test('stale session guard ignores an old payment response', async () => {
  const source = order('301')
  const pending = deferred()
  const probe = await mountWorkflow({
    orders: [source],
    api: { registerOrderPayment: () => pending.promise },
  })

  await act(async () => probe.getLatest().open(source.id, 'orders'))
  let submission
  await act(async () => { submission = probe.getLatest().dialog.submit() })
  probe.setGuard(2)

  await act(async () => {
    pending.resolve(paidEffects(source))
    assert.equal(await submission, false)
  })

  assert.deepEqual(probe.effects, [])
  assert.deepEqual(probe.successes, [])
  probe.unmount()
})

test('409 refreshes official data once without retrying POST', async () => {
  const source = order('401')
  const calls = []
  const conflict = Object.assign(new Error('Conflito'), { status: 409 })
  const probe = await mountWorkflow({
    orders: [source],
    api: {
      registerOrderPayment: async (...args) => {
        calls.push(args)
        throw conflict
      },
    },
  })

  await act(async () => probe.getLatest().open(source.id, 'orders'))
  await act(async () => assert.equal(await probe.getLatest().dialog.submit(), false))

  assert.equal(calls.length, 1)
  assert.equal(probe.getRefreshCalls(), 1)
  assert.deepEqual(probe.effects, [])
  assert.equal(probe.errors[0], conflict)
  assert.equal(probe.getLatest().dialog.submitting, false)
  probe.unmount()
})

test('network uncertainty refreshes official data without optimistic payment or POST retry', async () => {
  const source = order('501')
  const calls = []
  const error = new TypeError('network')
  const probe = await mountWorkflow({
    orders: [source],
    api: {
      registerOrderPayment: async (...args) => {
        calls.push(args)
        throw error
      },
    },
  })

  await act(async () => probe.getLatest().open(source.id, 'orders'))
  await act(async () => assert.equal(await probe.getLatest().dialog.submit(), false))

  assert.equal(calls.length, 1)
  assert.equal(probe.getRefreshCalls(), 1)
  assert.deepEqual(probe.effects, [])
  assert.equal(probe.getLatest().dialog.order.paymentStatus, 'Pendente')
  assert.equal(probe.errors[0], error)
  probe.unmount()
})

test('Receivables opens the same workflow with the latest default and without operational source eligibility', async () => {
  const source = order('601', { status: 'Finalizado' })
  const probe = await mountWorkflow({
    orders: [source],
    granted: new Set(['payments.receive']),
  })

  await act(async () => assert.equal(probe.getLatest().open(source.id), true))
  assert.equal(probe.getLatest().dialog.order.id, source.id)
  assert.deepEqual(probe.getLatest().dialog.allocations, [{ methodCode: 'pix', amountCents: 4000 }])
  probe.unmount()
})

test('Task 13/16 legacy full-payment is blocked for partial, while its due is collected only by supplement', async () => {
  const probe=await mountWorkflow({orders:[
    order('partial',{paymentId:'pay-partial',paymentStatus:'Parcialmente pago',dueCents:1500,total:95}),
    order('refund',{paymentId:'pay-refund',paymentStatus:'Devolução pendente',dueCents:0,total:65}),
    order('unpaid',{paymentStatus:'Pendente',dueCents:3000,total:30}),
  ]})
  await act(async()=>{
    assert.equal(probe.getLatest().open('partial','orders'),false)
    assert.equal(probe.getLatest().open('partial',null),false)
    assert.equal(probe.getLatest().open('refund',null),false)
    assert.equal(probe.getLatest().open('unpaid',null),true)
  })
  assert.equal(probe.getLatest().dialog.composition.totalCents,3000)
  probe.unmount()
})

test('Task 16: saved partial order can later receive only the due balance from Receivables',async()=>{
 const source=order('partial-later',{paymentId:'original',paymentStatus:'Parcialmente pago',
   total:95,totalCents:9500,netReceivedCents:8000,dueCents:1500,contentRevision:3})
 const calls=[]
 const probe=await mountWorkflow({orders:[source],granted:new Set(['payments.receive']),
   api:{
     registerOrderPayment:()=>{throw Error('legacy full-payment endpoint must not run')},
     registerSupplementalPayment:async(id,payload)=>{calls.push({id,payload});return paidEffects(source,payload.allocations)},
   }})
 await act(async()=>assert.equal(probe.getLatest().open(source.id),true))
 assert.equal(probe.getLatest().dialog.totalCents,1500)
 assert.deepEqual(probe.getLatest().dialog.allocations,[{methodCode:'pix',amountCents:1500}])
 await act(async()=>assert.equal(await probe.getLatest().dialog.submit(),true))
 assert.equal(calls.length,1)
 assert.equal(calls[0].id,source.id)
 assert.equal(calls[0].payload.expectedContentRevision,3)
 assert.equal(calls[0].payload.expectedTotalCents,9500)
 assert.equal(calls[0].payload.expectedNetReceivedCents,8000)
 assert.deepEqual(calls[0].payload.allocations,[{methodCode:'pix',amountCents:1500}])
 assert.equal(typeof calls[0].payload.mutationId,'string')
 assert.deepEqual(probe.errors,[])
 probe.unmount()
})
test('Task 16: refund-due is never offered as a collection and partial stays outside legacy Orders payment shortcut',async()=>{
 const partial=order('partial',{paymentId:'p1',paymentStatus:'Parcialmente pago',
   total:95,totalCents:9500,netReceivedCents:8000,dueCents:1500,contentRevision:2})
 const refund=order('refund',{paymentId:'p2',paymentStatus:'Devolução pendente',
   total:65,totalCents:6500,netReceivedCents:8000,dueCents:0})
 const probe=await mountWorkflow({orders:[partial,refund]})
 await act(async()=>{
   assert.equal(probe.getLatest().open('partial','orders'),false)
   assert.equal(probe.getLatest().open('refund'),false)
   assert.equal(probe.getLatest().open('partial'),true)
 })
 probe.unmount()
})
