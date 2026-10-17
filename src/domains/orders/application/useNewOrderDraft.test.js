import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { useNewOrderDraft } from './useNewOrderDraft.js'

const deferred = () => {
  let resolve
  const promise = new Promise((nextResolve) => { resolve = nextResolve })
  return { promise, resolve }
}

test('changed session owner rejects accepted checkout before dynamic callbacks and never replays', async () => {
  const pending = deferred()
  let owner = 'a', submits = 0
  const events = []
  const probe = await mountProbe({ getAccessOwner: () => owner, submitOrder: () => { submits++; return pending.promise }, canSubmit: () => true, commitOfficialEffects: () => events.push('effect'), onCommitted: () => events.push('navigation'), onSuccess: () => events.push('success'), onError: () => events.push('error') })
  await act(async () => probe.getLatest().open({ returnDestination: 'orders' }))
  let result
  await act(async () => { result = probe.getLatest().submit({}) })
  owner = 'b'
  await act(async () => { pending.resolve({ order: { id: 'old' } }); await result })
  assert.deepEqual(events, [])
  assert.equal(submits, 1)
  probe.unmount()
})

const mountProbe = async (props) => {
  let latest
  let renderer
  function Probe(currentProps) {
    latest = useNewOrderDraft(currentProps)
    return null
  }
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(Probe, props))
  })
  return {
    getLatest: () => latest,
    unmount: () => renderer.unmount(),
  }
}

test('stale checkout cannot commit after a newer draft opens', async () => {
  const pending = deferred()
  const committed = []
  const probe = await mountProbe({
    submitOrder: async () => pending.promise,
    canSubmit: () => true,
    commitOfficialEffects: (result) => committed.push(result),
    onCommitted: async () => {},
    onSuccess: () => {},
    onError: () => {},
    onConflict: async () => {},
  })

  await act(async () => { probe.getLatest().open({ returnDestination: 'orders' }) })
  let firstPromise
  await act(async () => {
    firstPromise = probe.getLatest().submit({ client: 'Ana' })
    await Promise.resolve()
  })
  await act(async () => { probe.getLatest().open({ returnDestination: 'comandas' }) })
  pending.resolve({ order: { id: 'o-1', status: 'Em preparo' } })
  await act(async () => { await firstPromise })

  assert.equal(committed.length, 0)
  assert.equal(probe.getLatest().context.returnDestination, 'comandas')
  probe.unmount()
})

test('current checkout commits before callbacks and clears the draft', async () => {
  const events = []
  const order = { id: 'o-2', status: 'Em preparo' }
  const probe = await mountProbe({
    submitOrder: async () => ({ order }),
    canSubmit: () => true,
    commitOfficialEffects: () => events.push('commit'),
    onCommitted: async () => { events.push('committed') },
    onSuccess: () => events.push('success'),
    onError: () => events.push('error'),
    onConflict: async () => {},
  })

  await act(async () => { probe.getLatest().open({ returnDestination: 'orders' }) })
  let result
  await act(async () => { result = await probe.getLatest().submit({ client: 'Ana' }) })

  assert.equal(result, true)
  assert.deepEqual(events, ['commit', 'committed', 'success'])
  assert.equal(probe.getLatest().context, null)
  assert.equal(probe.getLatest().checkoutPending, false)
  probe.unmount()
})


test('edit-reservation submit calls reservation PUT boundary instead of order POST and preserves official order identity', async () => {
  const calls = []
  const effects = []
  const successes = []
  const probe = await mountProbe({
    submitOrder: async (...args) => { calls.push(['create', ...args]); return {} },
    submitReservationEdit: async (...args) => {
      calls.push(['edit', ...args])
      return {
        reservation: { id: 'reservation-1', revision: 8, status: 'reserved' },
        order: { id: 'order-1', orderNumber: 81, status: 'Em preparo' },
        tables: [],
      }
    },
    refreshReservation: async () => null,
    canSubmit: () => true,
    commitOfficialEffects: (result) => effects.push(result),
    onCommitted: async () => {},
    onSuccess: (order) => successes.push(order),
    onError: () => {},
    onConflict: async () => {},
  })

  await act(async () => {
    probe.getLatest().open({
      mode: 'edit-reservation',
      returnDestination: 'comandas',
      tableId: 'table-3',
      expectedTableTabId: '',
      reservationContext: {
        id: 'reservation-1',
        orderId: 'order-1',
        orderNumber: 81,
        expectedRevision: 7,
        hasManualPrintHistory: false,
      },
      initialDraft: {},
    })
  })

  let result
  await act(async () => {
    result = await probe.getLatest().submit({
      type: 'Local',
      orderDate: '2026-10-10',
      scheduledFor: '2026-10-10T23:30:00.000Z',
      customerIdentity: { type: 'table', tableId: 'table-3' },
      items: [{ productId: 'p1', quantity: 1, note: '' }],
      deliveryFee: 0,
      adjustment: { type: 'none', mode: 'fixed', value: 0, reason: '' },
    })
  })

  assert.equal(result, true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], 'edit')
  assert.equal(calls[0][1], 'reservation-1')
  assert.equal(calls[0][2].expectedRevision, 7)
  assert.equal(calls.some(([kind]) => kind === 'create'), false)
  assert.equal(effects[0].order.id, 'order-1')
  assert.equal(effects[0].order.orderNumber, 81)
  assert.equal(successes[0].id, 'order-1')
  assert.equal(probe.getLatest().context, null)
  probe.unmount()
})

test('stale edit refreshes official reservation snapshot, reports conflict, and keeps editor open with the new revision', async () => {
  const conflict = Object.assign(new Error('Reserva alterada'), {
    status: 409,
    code: 'TABLE_RESERVATION_CHANGED',
  })
  const refreshed = {
    reservation: {
      id: 'reservation-1',
      orderId: 'order-1',
      tableId: 'table-2',
      tableName: 'Mesa 2',
      status: 'reserved',
      scheduledFor: '2026-10-10T23:00:00.000Z',
      revision: 9,
    },
    order: {
      id: 'order-1',
      orderNumber: 81,
      clientId: null,
      type: 'Local',
      orderDate: '2026-10-10',
      scheduledFor: '2026-10-10T23:00:00.000Z',
      items: [],
      adjustment: { type: 'none', mode: 'fixed', value: 0, reason: '' },
    },
    hasManualPrintHistory: false,
  }
  const conflicts = []
  const errors = []
  let editCalls = 0
  let refreshCalls = 0
  const probe = await mountProbe({
    submitOrder: async () => assert.fail('create endpoint must not run'),
    submitReservationEdit: async () => { editCalls += 1; throw conflict },
    refreshReservation: async (id) => {
      refreshCalls += 1
      assert.equal(id, 'reservation-1')
      return refreshed
    },
    canSubmit: () => true,
    commitOfficialEffects: () => assert.fail('conflict must not commit effects'),
    onCommitted: async () => {},
    onSuccess: () => assert.fail('conflict must not succeed'),
    onError: (error) => errors.push(error),
    onConflict: async (context) => conflicts.push(context),
  })

  await act(async () => {
    probe.getLatest().open({
      mode: 'edit-reservation',
      returnDestination: 'comandas',
      tableId: 'table-1',
      reservationContext: {
        id: 'reservation-1',
        orderId: 'order-1',
        orderNumber: 81,
        expectedRevision: 7,
      },
      initialDraft: {},
    })
  })
  await act(async () => {
    assert.equal(await probe.getLatest().submit({ type: 'Local' }), false)
  })

  assert.equal(editCalls, 1)
  assert.equal(refreshCalls, 1)
  assert.equal(errors[0], conflict)
  assert.equal(conflicts.length, 1)
  assert.equal(probe.getLatest().context.mode, 'edit-reservation')
  assert.equal(probe.getLatest().context.reservationContext.expectedRevision, 9)
  assert.equal(probe.getLatest().context.tableId, 'table-2')
  assert.notEqual(probe.getLatest().renderKey, null)
  probe.unmount()
})

test('policy change in edit mode returns the same review signal without clearing the draft', async () => {
  const policy = Object.assign(new Error('policy'), { code: 'POLICY_CHANGED', status: 409 })
  const errors = []
  const probe = await mountProbe({
    submitOrder: async () => assert.fail('create endpoint must not run'),
    submitReservationEdit: async () => { throw policy },
    refreshReservation: async () => null,
    canSubmit: () => true,
    commitOfficialEffects: () => {},
    onCommitted: async () => {},
    onSuccess: () => {},
    onError: (error) => errors.push(error),
    onConflict: async () => {},
  })
  await act(async () => {
    probe.getLatest().open({
      mode: 'edit-reservation',
      reservationContext: { id: 'r1', expectedRevision: 2 },
      initialDraft: {},
    })
  })
  let result
  await act(async () => { result = await probe.getLatest().submit({ type: 'Local' }) })
  assert.deepEqual(result, { ok: false, code: 'POLICY_CHANGED' })
  assert.equal(errors[0], policy)
  assert.equal(probe.getLatest().context.mode, 'edit-reservation')
  probe.unmount()
})

test('create reservation conflict keeps the same draft, exposes the server message, and renews idempotency for retry', async () => {
  const conflict = Object.assign(new Error('Esta mesa já possui uma reserva nesse horário. Escolha outra mesa ou outro horário.'), {
    status: 409,
    code: 'TABLE_RESERVATION_CONFLICT',
  })
  const keys = []
  let attempts = 0
  const errors = []
  const probe = await mountProbe({
    submitOrder: async (_payload, key) => {
      keys.push(key)
      attempts += 1
      if (attempts === 1) throw conflict
      return { order: { id: 'order-ok', status: 'Em preparo' } }
    },
    canSubmit: () => true,
    commitOfficialEffects: () => {},
    onCommitted: async () => {},
    onSuccess: () => {},
    onError: (error) => errors.push(error),
    onConflict: async () => {},
  })

  await act(async () => {
    probe.getLatest().open({ returnDestination: 'orders', tableId: 'table-2' })
  })

  let first
  await act(async () => {
    first = await probe.getLatest().submit({
      type: 'Local',
      scheduledFor: '2026-10-10T23:30:00.000Z',
    })
  })

  assert.deepEqual(first, {
    ok: false,
    code: 'TABLE_RESERVATION_CONFLICT',
    message: 'Esta mesa já possui uma reserva nesse horário. Escolha outra mesa ou outro horário.',
  })
  assert.equal(probe.getLatest().context.tableId, 'table-2')
  assert.equal(probe.getLatest().checkoutPending, false)
  assert.equal(errors[0], conflict)

  let second
  await act(async () => {
    second = await probe.getLatest().submit({
      type: 'Local',
      scheduledFor: '2026-10-11T01:00:00.000Z',
    })
  })

  assert.equal(second, true)
  assert.equal(keys.length, 2)
  assert.notEqual(keys[0], keys[1], 'retry after a payload-changing conflict needs a fresh idempotency key')
  assert.equal(probe.getLatest().context, null)
  probe.unmount()
})

test('Task 14 saved edit commits before presenting its independent financial intent', async()=>{
 const events=[]
 const probe=await mountProbe({
   getAccessOwner:()=> 'owner',
   submitOrderEdit:async(id,payload)=>{events.push(['saved',id,payload.mutationId]);return {order:{id,totalCents:9500,dueCents:1500}}},
   canSubmit:()=>true,
   commitOfficialEffects:()=>{events.push(['effects']);return true},
   onCommitted:async(_result,_context,intent)=>events.push(['settlement-offer',intent]),
   onSuccess:()=>events.push(['saved-not-paid']),
   onError:error=>{throw error},
 })
 await act(async()=>probe.getLatest().open({mode:'edit-order',
   orderContext:{id:'o-14',expectedContentRevision:0,originalTotal:80},
   initialDraft:{items:[]}}))
 let success
 await act(async()=>{success=await probe.getLatest().submit({items:[]},{intent:'receive'})})
 assert.equal(success,true)
 assert.equal(events[0][0],'saved')
 assert.deepEqual(events.slice(1),[['effects'],['settlement-offer','receive'],['saved-not-paid']])
 assert.equal(probe.getLatest().context,null)
 probe.unmount()
})
