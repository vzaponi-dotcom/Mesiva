import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { useClientOrdersPaymentWorkflow } from './useClientOrdersPaymentWorkflow.js'

const deferred = () => {
  let resolve
  let reject
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail })
  return { promise, resolve, reject }
}

const order = (id, overrides = {}) => ({
  id,
  clientId: 'c1',
  client: 'Fernanda Albuquerque',
  customerIdentityType: 'registered_client',
  tableTabId: null,
  status: 'Finalizado',
  paymentStatus: 'Pendente',
  total: id === 'o1' ? 49 : 20,
  ...overrides,
})

const paymentOptions = [
  { code: 'pix', value: 'Pix', label: 'Pix' },
  { code: 'cash', value: 'Dinheiro', label: 'Dinheiro' },
]

const paidEffects = (sourceOrders, allocations) => {
  const receiptId = 'receipt-client'
  const resolved = allocations.map((allocation, index) => ({
    id: 'allocation-' + index,
    receiptId,
    methodCode: allocation.methodCode,
    methodLabel: allocation.methodCode === 'cash' ? 'Dinheiro' : 'Pix',
    amountCents: allocation.amountCents,
    amount: allocation.amountCents / 100,
  }))
  return {
    receipt: { id: receiptId, totalCents: 6900, total: 69, tableTabId: null, allocations: resolved },
    allocations: resolved,
    payments: sourceOrders.map((item) => ({
      id: 'payment-' + item.id,
      orderId: item.id,
      receiptId,
      amount: item.total,
    })),
    orders: sourceOrders.map((item) => ({
      ...item,
      paymentStatus: 'Pago',
      paymentReceiptId: receiptId,
      paymentMethod: resolved.length === 1 ? resolved[0].methodLabel : null,
      paymentAllocations: resolved,
      paidAmount: item.total,
    })),
    movements: resolved.map((allocation, index) => ({
      id: 'movement-' + index,
      source: 'order-payment',
      receiptId,
      paymentAllocationId: allocation.id,
      orderId: null,
      paymentId: null,
      paymentMethod: allocation.methodLabel,
      value: allocation.amount,
    })),
  }
}

async function mountWorkflow(overrides = {}) {
  let latest
  let renderer
  let requestKey = null
  let guard = 1
  let orders = overrides.orders || [order('o1'), order('o2')]
  const effects = []
  const successes = []
  const errors = []
  const calls = []
  let refreshCalls = 0

  const api = overrides.api || {
    registerClientOrdersPayment: async (...args) => {
      calls.push(args)
      return paidEffects(orders.filter((item) => args[1].includes(item.id)), args[2])
    },
  }

  const props = {
    api,
    orders,
    canReceivePayments: overrides.canReceivePayments ?? true,
    writesBlocked: overrides.writesBlocked ?? false,
    paymentOptions,
    defaultPaymentMethod: 'Pix',
    getSyncGuard: () => guard,
    applyOfficialEffects: (effect) => effects.push(effect),
    refreshOfficialData: async () => { refreshCalls += 1 },
    setRequestKey: (value) => {
      requestKey = typeof value === 'function' ? value(requestKey) : value
    },
    onSuccess: (message) => successes.push(message),
    onError: (error) => errors.push(error),
  }

  function Probe(currentProps) {
    latest = useClientOrdersPaymentWorkflow(currentProps)
    return null
  }

  await act(async () => {
    renderer = TestRenderer.create(React.createElement(Probe, props))
  })

  return {
    getLatest: () => latest,
    effects,
    successes,
    errors,
    calls,
    getRefreshCalls: () => refreshCalls,
    setGuard: (value) => { guard = value },
    setOrders: async (nextOrders) => {
      orders = nextOrders
      await act(async () => renderer.update(React.createElement(Probe, { ...props, orders })))
    },
    unmount: () => renderer.unmount(),
  }
}

test('client-orders workflow opens only an eligible 2..100 order selection from one registered client', async () => {
  const valid = [order('o1'), order('o2')]
  const probe = await mountWorkflow({ orders: valid })

  await act(async () => assert.equal(probe.getLatest().open({ clientId: 'c1', orderIds: ['o1', 'o2'] }), true))
  assert.equal(probe.getLatest().dialog.clientId, 'c1')
  assert.equal(probe.getLatest().dialog.clientName, 'Fernanda Albuquerque')
  assert.equal(probe.getLatest().dialog.totalCents, 6900)
  assert.deepEqual(probe.getLatest().dialog.orderIds, ['o1', 'o2'])
  assert.deepEqual(probe.getLatest().dialog.allocations, [{ methodCode: 'pix', amountCents: 6900 }])
  await act(async () => probe.getLatest().close())

  for (const invalid of [
    { clientId: 'c1', orderIds: ['o1'] },
    { clientId: 'c1', orderIds: ['o1', 'o1'] },
    { clientId: 'c1', orderIds: ['o1', 'missing'] },
    { clientId: 'c1', orderIds: ['o1', 'o2'], orders: [order('o1'), order('o2', { clientId: 'c2' })] },
    { clientId: 'c1', orderIds: ['o1', 'o2'], orders: [order('o1'), order('o2', { paymentStatus: 'Pago' })] },
    { clientId: 'c1', orderIds: ['o1', 'o2'], orders: [order('o1'), order('o2', { status: 'Cancelado' })] },
    { clientId: 'c1', orderIds: ['o1', 'o2'], orders: [order('o1'), order('o2', { tableTabId: 'tab-1' })] },
    { clientId: 'c1', orderIds: ['o1', 'o2'], orders: [order('o1'), order('o2', { customerIdentityType: 'guest_name', clientId: null })] },
  ]) {
    if (invalid.orders) await probe.setOrders(invalid.orders)
    await act(async () => assert.equal(probe.getLatest().open({ clientId: invalid.clientId, orderIds: invalid.orderIds }), false))
    if (invalid.orders) await probe.setOrders(valid)
  }

  probe.unmount()
})

test('mixed client selection charges outstanding amounts and keeps a mutation key for retry',async()=>{
 const calls=[]
 const probe=await mountWorkflow({orders:[order('o1',{total:95,dueCents:1500,paymentId:'p1',paymentStatus:'Parcialmente pago'}),order('o2')],api:{registerClientOrdersPayment:async(...args)=>{calls.push(args);throw Object.assign(new Error('Try again'),{status:503})}}})
 await act(async()=>probe.getLatest().open({clientId:'c1',orderIds:['o1','o2']}))
 assert.equal(probe.getLatest().dialog.totalCents,3500)
 await act(async()=>probe.getLatest().dialog.submit())
 await act(async()=>probe.getLatest().dialog.submit())
 assert.ok(calls[0][3].mutationId)
 assert.equal(calls[0][3].mutationId,calls[1][3].mutationId)
 probe.unmount()
})

test('double submit sends one atomic client payment request and applies authoritative plural effects once', async () => {
  const source = [order('o1'), order('o2')]
  const pending = deferred()
  const calls = []
  const probe = await mountWorkflow({
    orders: source,
    api: {
      registerClientOrdersPayment: (...args) => {
        calls.push(args)
        return pending.promise
      },
    },
  })

  await act(async () => probe.getLatest().open({ clientId: 'c1', orderIds: ['o1', 'o2'] }))
  let first
  await act(async () => {
    first = probe.getLatest().dialog.submit()
    assert.equal(await probe.getLatest().dialog.submit(), false)
  })
  assert.deepEqual(calls.map(args=>args.slice(0,3)), [['c1', ['o1', 'o2'], [{ methodCode: 'pix', amountCents: 6900 }]]])
  assert.equal(typeof calls[0][3].mutationId,'string')

  const official = { ...paidEffects(source, [{ methodCode: 'pix', amountCents: 6900 }]), deletedOrderIds: ['hidden-order'] }
  await act(async () => {
    pending.resolve(official)
    assert.equal(await first, true)
  })

  assert.deepEqual(probe.effects, [official])
  assert.equal(probe.getLatest().dialog, null)
  assert.deepEqual(probe.successes, ['Recebimento registrado: 2 pedidos de Fernanda Albuquerque quitados'])
  probe.unmount()
})

test('client-orders workflow preserves split composition and sends canonical allocations', async () => {
  const source = [order('o1'), order('o2')]
  const probe = await mountWorkflow({ orders: source })

  await act(async () => probe.getLatest().open({ clientId: 'c1', orderIds: ['o1', 'o2'] }))
  await act(async () => probe.getLatest().dialog.setAllocations([
    { methodCode: 'cash', amountCents: 3000 },
    { methodCode: 'pix', amountCents: 3900 },
  ]))

  assert.equal(probe.getLatest().dialog.composition.valid, true)
  await act(async () => assert.equal(await probe.getLatest().dialog.submit(), true))

  assert.deepEqual(probe.calls.map(args=>args.slice(0,3)), [[
    'c1',
    ['o1', 'o2'],
    [
      { methodCode: 'cash', amountCents: 3000 },
      { methodCode: 'pix', amountCents: 3900 },
    ],
  ]])
  assert.equal(probe.effects[0].movements.length, 2)
  probe.unmount()
})

test('409 and network uncertainty refresh official data once without retrying POST', async () => {
  for (const error of [
    Object.assign(new Error('Conflito'), { status: 409 }),
    new TypeError('network'),
    Object.assign(new Error('Servidor'), { status: 500 }),
  ]) {
    const calls = []
    const probe = await mountWorkflow({
      api: {
        registerClientOrdersPayment: async (...args) => {
          calls.push(args)
          throw error
        },
      },
    })

    await act(async () => probe.getLatest().open({ clientId: 'c1', orderIds: ['o1', 'o2'] }))
    await act(async () => assert.equal(await probe.getLatest().dialog.submit(), false))

    assert.equal(calls.length, 1)
    assert.equal(probe.getRefreshCalls(), 1)
    assert.deepEqual(probe.effects, [])
    assert.equal(probe.errors[0], error)
    probe.unmount()
  }
})

test('stale guard ignores old multi-order payment response', async () => {
  const pending = deferred()
  const probe = await mountWorkflow({
    api: { registerClientOrdersPayment: () => pending.promise },
  })

  await act(async () => probe.getLatest().open({ clientId: 'c1', orderIds: ['o1', 'o2'] }))
  let submission
  await act(async () => { submission = probe.getLatest().dialog.submit() })
  probe.setGuard(2)

  await act(async () => {
    pending.resolve(paidEffects([order('o1'), order('o2')], [{ methodCode: 'pix', amountCents: 6900 }]))
    assert.equal(await submission, false)
  })

  assert.deepEqual(probe.effects, [])
  assert.deepEqual(probe.successes, [])
  probe.unmount()
})

test('response A cannot close or replace a newer client payment target B', async () => {
  const orders = [
    order('o1'), order('o2'),
    order('b1', { clientId: 'c2', client: 'Luana', total: 30 }),
    order('b2', { clientId: 'c2', client: 'Luana', total: 40 }),
  ]
  const pendingA = deferred()
  const pendingB = deferred()
  const probe = await mountWorkflow({
    orders,
    api: {
      registerClientOrdersPayment: (clientId) => clientId === 'c1' ? pendingA.promise : pendingB.promise,
    },
  })

  await act(async () => probe.getLatest().open({ clientId: 'c1', orderIds: ['o1', 'o2'] }))
  let submissionA
  await act(async () => { submissionA = probe.getLatest().dialog.submit() })
  await act(async () => probe.getLatest().close())
  await act(async () => probe.getLatest().open({ clientId: 'c2', orderIds: ['b1', 'b2'] }))
  let submissionB
  await act(async () => { submissionB = probe.getLatest().dialog.submit() })

  await act(async () => {
    pendingA.resolve(paidEffects(orders.slice(0, 2), [{ methodCode: 'pix', amountCents: 6900 }]))
    await submissionA
  })

  assert.equal(probe.getLatest().dialog.clientId, 'c2')
  assert.equal(probe.getLatest().dialog.submitting, true)

  await act(async () => {
    pendingB.resolve(paidEffects(orders.slice(2), [{ methodCode: 'pix', amountCents: 7000 }]))
    await submissionB
  })
  probe.unmount()
})


test('capability and offline-write blocks prevent opening the batch payment workflow without API calls', async () => {
  for (const overrides of [
    { canReceivePayments: false, writesBlocked: false },
    { canReceivePayments: true, writesBlocked: true },
  ]) {
    const calls = []
    const probe = await mountWorkflow({
      ...overrides,
      api: {
        registerClientOrdersPayment: async (...args) => {
          calls.push(args)
          return paidEffects([order('o1'), order('o2')], args[2])
        },
      },
    })

    await act(async () => assert.equal(
      probe.getLatest().open({ clientId: 'c1', orderIds: ['o1', 'o2'] }),
      false,
    ))
    assert.equal(probe.getLatest().dialog, null)
    assert.equal(calls.length, 0)
    probe.unmount()
  }
})
