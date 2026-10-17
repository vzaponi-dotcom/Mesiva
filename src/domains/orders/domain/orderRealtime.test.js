import test from 'node:test'
import assert from 'node:assert/strict'
import { detectOperationalArrivals, getNewOperationalOrderIds, getOperationalOrderCount, operationalOrderIdSet } from './orderRealtime.js'

const scheduled = {
  id: 'scheduled-1', type: 'Entrega', status: 'Em preparo', createdAt: '2026-09-04T12:00:00.000Z',
  scheduledFor: '2026-09-04T15:00:00.000Z',
}

test('scheduled order outside operational window is excluded and alerts once at entry', () => {
  const before = operationalOrderIdSet([scheduled], new Date('2026-09-04T14:09:00Z'))
  assert.equal(before.has('scheduled-1'), false)
  assert.deepEqual(getNewOperationalOrderIds(before, [scheduled], new Date('2026-09-04T14:10:00Z')), ['scheduled-1'])
  assert.deepEqual(getNewOperationalOrderIds(new Set(['scheduled-1']), [scheduled], new Date('2026-09-04T14:11:00Z')), [])
})

test('Agora orders remain operational and cancelled orders stay excluded', () => {
  const now = new Date('2026-09-04T14:00:00Z')
  assert.deepEqual([...operationalOrderIdSet([{ id: 'now-1', status: 'Em preparo', createdAt: '2026-09-04T13:00:00Z' }], now)], ['now-1'])
  assert.deepEqual([...operationalOrderIdSet([{ id: 'cancelled-1', status: 'Cancelado', createdAt: '2026-09-04T13:00:00Z' }], now)], [])
})

test('scheduled arrival appears at the exact boundary and alerts only once', () => {
  const oneMillisecondBefore = new Date('2026-09-04T14:09:59.999Z')
  const atBoundary = new Date('2026-09-04T14:10:00.000Z')
  const before = detectOperationalArrivals(new Set(), [scheduled], oneMillisecondBefore, new Set())
  assert.deepEqual([...before.currentIds], [])
  assert.deepEqual(before.newIds, [])

  const arrival = detectOperationalArrivals(before.currentIds, [scheduled], atBoundary, new Set())
  assert.deepEqual([...arrival.currentIds], ['scheduled-1'])
  assert.deepEqual(arrival.newIds, ['scheduled-1'])

  const later = detectOperationalArrivals(arrival.currentIds, [scheduled], new Date('2026-09-04T14:11:00.000Z'), new Set(['scheduled-1']))
  assert.deepEqual([...later.currentIds], ['scheduled-1'])
  assert.deepEqual(later.newIds, [])
})

test('initialization after the boundary seeds current IDs without retroactive alerts', () => {
  const initialized = detectOperationalArrivals(undefined, [scheduled], new Date('2026-09-04T14:11:00.000Z'), new Set())
  assert.deepEqual([...initialized.currentIds], ['scheduled-1'])
  assert.deepEqual(initialized.newIds, [])
})

test('newly discovered immediate active orders exclude finished work', () => {
  const now = new Date('2026-09-17T12:00:00-03:00')
  const baseline = operationalOrderIdSet([{ id: 'old-active', status: 'Em preparo' }], now)
  const orders = [
    { id: 'old-active', status: 'Em preparo' },
    { id: 'new-active', status: 'Em preparo' },
    { id: 'finished', status: 'Finalizado' },
  ]
  assert.deepEqual(getNewOperationalOrderIds(baseline, orders, now), ['new-active'])
  assert.deepEqual([...operationalOrderIdSet(orders, now)], ['old-active', 'new-active'])
})

test('operational count uses the current timing policy and excludes future scheduled work', () => {
  const order = { id: 'scheduled-policy', type: 'Entrega', status: 'Em preparo', createdAt: '2026-09-21T12:00:00.000Z', scheduledFor: '2026-09-21T15:00:00.000Z' }
  const timing = { scheduledPrepLeadMinutes: 30, scheduledLateGraceMinutes: 15, immediateLateAfterMinutes: 30, immediateVeryLateAfterMinutes: 60 }
  assert.equal(getOperationalOrderCount([order], new Date('2026-09-21T14:29:59.000Z'), timing), 0)
  assert.equal(getOperationalOrderCount([order], new Date('2026-09-21T14:30:00.000Z'), timing), 1)
})

test('operational count excludes terminal and legacy finished statuses', () => {
  const now = new Date('2026-09-21T18:00:00-03:00')
  assert.equal(getOperationalOrderCount([
    { id: 'active', status: 'Em preparo' },
    { id: 'finalized', status: 'Finalizado' },
    { id: 'cancelled', status: 'Cancelado' },
    { id: 'delivered', status: 'Entregue' },
    { id: 'dispatched', status: 'Despachado' },
  ], now), 1)
})

test('a revision change on the same order ID never triggers another new-order arrival',()=>{
 const now=new Date('2026-10-10T18:00:00.000Z')
 const first=[{id:'o1',status:'Em preparo',createdAt:'2026-10-10T17:00:00.000Z',operationalRevision:0}]
 const established=detectOperationalArrivals(undefined,first,now,new Set())
 const changed=[{...first[0],operationalRevision:3,editPending:true}]
 const next=detectOperationalArrivals(established.currentIds,changed,now,new Set())
 assert.deepEqual(next.newIds,[])
 assert.deepEqual([...next.currentIds],['o1'])
})
