import test from 'node:test'
import assert from 'node:assert/strict'

const loadSync = async () => {
  try { return await import('./dataSync.js') } catch { return {} }
}

test('local mutation makes an older read stale only for the affected collection', async () => {
  const sync = await loadSync()
  assert.equal(typeof sync.createCollectionSyncGuard, 'function')
  const guard = sync.createCollectionSyncGuard(['orders', 'movements', 'clients'])
  const token = guard.beginRead(['orders', 'movements', 'clients'])

  guard.markMutation(['orders'])

  assert.equal(guard.canApply(token, 'orders'), false)
  assert.equal(guard.canApply(token, 'movements'), true)
  assert.equal(guard.canApply(token, 'clients'), true)
})

test('newer read invalidates older response only for the collection read again', async () => {
  const { createCollectionSyncGuard } = await loadSync()
  const guard = createCollectionSyncGuard(['orders', 'movements'])
  const globalToken = guard.beginRead(['orders', 'movements'])
  const ordersToken = guard.beginRead(['orders'])

  assert.equal(guard.canApply(globalToken, 'orders'), false)
  assert.equal(guard.canApply(globalToken, 'movements'), true)
  assert.equal(guard.canApply(ordersToken, 'orders'), true)
})

test('entity helpers upsert without duplicates and remove by id', async () => {
  const sync = await loadSync()
  assert.equal(typeof sync.upsertById, 'function')
  assert.equal(typeof sync.upsertManyById, 'function')
  assert.equal(typeof sync.removeById, 'function')

  const initial = [{ id: 'a', value: 1 }, { id: 'b', value: 2 }]
  assert.deepEqual(sync.upsertById(initial, { id: 'b', value: 3 }), [{ id: 'a', value: 1 }, { id: 'b', value: 3 }])
  assert.deepEqual(sync.upsertById(initial, { id: 'c', value: 4 }), [{ id: 'c', value: 4 }, ...initial])
  assert.deepEqual(sync.upsertManyById(initial, [{ id: 'b', value: 5 }, { id: 'c', value: 6 }, { id: 'c', value: 6 }]), [
    { id: 'c', value: 6 }, { id: 'a', value: 1 }, { id: 'b', value: 5 },
  ])
  assert.deepEqual(sync.removeById(initial, 'a'), [{ id: 'b', value: 2 }])
})

test('point upserts keep created order, stable ties and historical members',async()=>{
  const sync=await loadSync()
  assert.equal(typeof sync.upsertManyInCreatedOrder,'function')
  const old=[{id:'b',createdAt:'2026-10-14'},{id:'a',createdAt:'2026-10-14'},{id:'history',createdAt:'2025-01-01'}]
  assert.deepEqual(sync.upsertManyInCreatedOrder(old,[{id:'history',createdAt:'2025-01-01',paid:true},{id:'new',createdAt:'2026-10-15'}]).map(e=>e.id),['new','b','a','history'])
  assert.equal(old[2].paid,undefined)
})
