import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { readFile } from 'node:fs/promises'
import { act, create } from 'react-test-renderer'
import {
  GLOBAL_SYNC_INTERVAL_MS,
  ORDER_SYNC_INTERVAL_MS,
  createRefreshSubscription,
  useOperationalDataRuntime,
} from './useOperationalDataRuntime.js'

const bootstrapFixture = () => ({
  business: { id: 'amor-e-sabor', name: 'Amor & Sabor', hasLogo: false, logoVersion: null },
  clients: [{ id: 'client-1', name: 'Ana' }],
  products: [{ id: 'product-1', name: 'Marmita' }],
  orders: [{ id: 'order-1', status: 'Em preparo' }],
  tables: [{ id: 'table-1', occupancy: 'occupied', openTableTab: { id: 'tab-1' } }],
  tableTabs: [{ id: 'tab-1', status: 'open' }],
  movements: [{ id: 'movement-1', type: 'entrada', value: 10 }],
  financeSettings: { openingBalance: 20 },
  effectiveBusinessConfig: { version: 'cfg-1', revisions: {} },
})

const deferred = () => {
  let resolve
  let reject
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

function createHarness({
  api,
  onUnauthorized = () => {},
  globalSyncEnabled = false,
  ordersSyncEnabled = false,
  effectiveConfigVersion = null,
  accessContextId = null,
  realtime,
  surface,
} = {}) {
  let current
  const renders = []
  const Harness = (props) => {
    current = useOperationalDataRuntime({
      api,
      onUnauthorized,
      globalSyncEnabled,
      ordersSyncEnabled,
      effectiveConfigVersion,
      accessContextId,
      realtime,
      surface,
      ...props,
    })
    renders.push(current)
    return null
  }
  return { Harness, getCurrent: () => current, getRenders: () => renders }
}

async function mountHarness(t, options) {
  const harness = createHarness(options)
  let renderer
  await act(async () => { renderer = create(React.createElement(harness.Harness)) })
  t.after(() => renderer.unmount())
  return { ...harness, update: (props) => renderer.update(React.createElement(harness.Harness, props)) }
}

test('access change clears private state and rejects pending bootstrap orders and mutation callbacks', async (t) => {
  const bootstrapRead = deferred(), ordersRead = deferred()
  let reads = 0
  const harness = await mountHarness(t, {
    accessContextId: 'manager-user:grants-1',
    api: { getBootstrap: async () => ++reads === 1 ? bootstrapFixture() : bootstrapRead.promise, getOrders: async () => ordersRead.promise },
  })
  await act(async () => { await harness.getCurrent().refreshBootstrap() })
  const oldEffects = harness.getCurrent().applyOfficialEffects
  let pendingBootstrap, pendingOrders
  await act(async () => {
    pendingBootstrap = harness.getCurrent().refreshBootstrapSilently()
    pendingOrders = harness.getCurrent().refreshOrders()
  })
  const renderIndex = harness.getRenders().length
  await act(async () => { harness.update({ accessContextId: 'operator-user:grants-2' }) })
  assert.deepEqual(harness.getRenders()[renderIndex].orders, [])
  assert.deepEqual(harness.getRenders()[renderIndex].movements, [])
  assert.equal(harness.getRenders()[renderIndex].bootstrapEffectiveConfig, null)
  assert.deepEqual(harness.getCurrent().orders, [])
  assert.deepEqual(harness.getCurrent().movements, [])
  assert.equal(harness.getCurrent().financeSettings, null)
  assert.equal(harness.getCurrent().bootstrapEffectiveConfig, null)
  bootstrapRead.resolve(bootstrapFixture())
  ordersRead.resolve({ orders: [{ id: 'private-old-order' }] })
  await act(async () => {
    assert.equal(await pendingBootstrap, false)
    assert.equal(await pendingOrders, false)
    assert.equal(oldEffects({ movement: { id: 'private-old-movement' }, order: { id: 'private-old-order' } }), false)
  })
  assert.deepEqual(harness.getCurrent().orders, [])
  assert.deepEqual(harness.getCurrent().movements, [])
})

test('first effect of the new session uses its rendered client before passive effects settle', async t => {
  const requests = []
  let renderer
  function Harness({ owner }) {
    const runtime = useOperationalDataRuntime({ accessContextId: owner, api: { getBootstrap: async () => { requests.push(owner); return bootstrapFixture() } } })
    React.useLayoutEffect(() => { void runtime.refreshBootstrap() }, [owner])
    return null
  }
  await act(async () => { renderer = create(React.createElement(Harness, { owner: 'A' })) })
  t.after(() => renderer.unmount())
  await act(async () => { renderer.update(React.createElement(Harness, { owner: 'B' })) })
  assert.deepEqual(requests, ['A', 'B'])
})

test('projected payment effects can update operational state without finance collections', async (t) => {
  const data = bootstrapFixture(); delete data.movements; delete data.financeSettings
  const harness = await mountHarness(t, { api: { getBootstrap: async () => data, getOrders: async () => ({ orders: [] }) } })
  await act(async () => { await harness.getCurrent().refreshBootstrap() })
  await act(async () => { harness.getCurrent().applyOfficialEffects({ order: { id: 'order-1', paymentStatus: 'Pago' }, payment: { id: 'payment-1' } }) })
  assert.equal(harness.getCurrent().orders[0].paymentStatus, 'Pago')
  assert.deepEqual(harness.getCurrent().movements, [])
  assert.equal(harness.getCurrent().financeSettings, null)
})

test('old unauthorized bootstrap and orders errors cannot affect the new session handler', async (t) => {
  for (const error of [{ status: 401 }, { status: 403, code: 'ACCESS_CHANGED' }]) {
    const pendingBootstrap = deferred(), pendingOrders = deferred(), notifications = []
    const harness = await mountHarness(t, { accessContextId: 'a', api: { getBootstrap: () => pendingBootstrap.promise, getOrders: () => pendingOrders.promise }, onUnauthorized: (value) => notifications.push(value) })
    let bootstrap, orders
    await act(async () => { bootstrap = harness.getCurrent().refreshBootstrap(); orders = harness.getCurrent().refreshOrders() })
    await act(async () => harness.update({ accessContextId: 'b' }))
    await act(async () => { pendingBootstrap.reject(error); pendingOrders.reject(error); await bootstrap; await orders })
    assert.deepEqual(notifications, [])
  }
})

test('current ACCESS_CHANGED refreshes the trusted session through the unauthorized callback', async (t) => {
  const notifications = [], error = { status: 403, code: 'ACCESS_CHANGED' }
  const harness = await mountHarness(t, { accessContextId: 'a', api: { getBootstrap: async () => { throw error } }, onUnauthorized: (value) => notifications.push(value) })
  await act(async () => { await harness.getCurrent().refreshBootstrap() })
  assert.deepEqual(notifications, [error])
})

test('projected status effects remove orders outside the current read grants', async (t) => {
  const harness = await mountHarness(t, { api: { getBootstrap: async () => bootstrapFixture(), getOrders: async () => ({ orders: [] }) } })
  await act(async () => { await harness.getCurrent().refreshBootstrap() })
  await act(async () => { harness.getCurrent().applyOfficialEffects({ deletedOrderIds: ['order-1'] }) })
  assert.deepEqual(harness.getCurrent().orders, [])
})

test('reset of an already empty runtime renews mutation callbacks and rejects the previous generation', async (t) => {
  const harness = await mountHarness(t)
  const previousEffects = harness.getCurrent().applyOfficialEffects
  await act(async () => { harness.getCurrent().resetOperationalData() })
  await act(async () => {
    assert.equal(previousEffects({ order: { id: 'old-order' } }), false)
    harness.getCurrent().applyOfficialEffects({ order: { id: 'new-order' } })
  })
  assert.deepEqual(harness.getCurrent().orders, [{ id: 'new-order' }])
})

test('createRefreshSubscription runs immediately, reacts to visible/focus, and cleans up', () => {
  let runCount = 0
  let intervalCallback
  let clearIntervalCalls = 0
  const removedEventNames = []
  const windowListeners = new Map()
  const documentListeners = new Map()
  const windowObject = {
    addEventListener(name, listener) { windowListeners.set(name, listener) },
    removeEventListener(name) { removedEventNames.push(name); windowListeners.delete(name) },
  }
  const documentObject = {
    visibilityState: 'visible',
    addEventListener(name, listener) { documentListeners.set(name, listener) },
    removeEventListener(name) { removedEventNames.push(name); documentListeners.delete(name) },
  }

  assert.equal(GLOBAL_SYNC_INTERVAL_MS, 5000)
  assert.equal(ORDER_SYNC_INTERVAL_MS, 2000)

  const unsubscribe = createRefreshSubscription({
    run: () => { runCount += 1 },
    intervalMs: GLOBAL_SYNC_INTERVAL_MS,
    windowObject,
    documentObject,
    setIntervalFn(callback) { intervalCallback = callback; return 'timer-1' },
    clearIntervalFn(token) { assert.equal(token, 'timer-1'); clearIntervalCalls += 1 },
  })

  assert.equal(runCount, 1)
  intervalCallback()
  assert.equal(runCount, 2)
  documentObject.visibilityState = 'hidden'
  intervalCallback()
  assert.equal(runCount, 2)
  documentObject.visibilityState = 'visible'
  documentListeners.get('visibilitychange')()
  windowListeners.get('focus')()
  assert.equal(runCount, 4)
  unsubscribe()
  assert.equal(clearIntervalCalls, 1)
  assert.deepEqual(removedEventNames.sort(), ['focus', 'visibilitychange'])
})

test('refreshBootstrap loads every official collection and effective config', async (t) => {
  const bootstrap = bootstrapFixture()
  const harness = await mountHarness(t, {
    api: {
      getBootstrap: async () => bootstrap,
      getOrders: async () => ({ orders: [] }),
    },
  })

  await act(async () => { await harness.getCurrent().refreshBootstrap() })
  const current = harness.getCurrent()
  assert.equal(current.bootstrapState, 'ready')
  assert.deepEqual(current.business, bootstrap.business)
  assert.deepEqual(current.bootstrapEffectiveConfig, bootstrap.effectiveBusinessConfig)
  assert.deepEqual(current.clients, bootstrap.clients)
  assert.deepEqual(current.products, bootstrap.products)
  assert.deepEqual(current.orders, bootstrap.orders)
  assert.deepEqual(current.tables, bootstrap.tables)
  assert.deepEqual(current.tableTabs, bootstrap.tableTabs)
  assert.deepEqual(current.movements, bootstrap.movements)
  assert.deepEqual(current.financeSettings, bootstrap.financeSettings)
})

test('a stale bootstrap cannot overwrite a newer official mutation', async (t) => {
  const pending = deferred()
  const harness = await mountHarness(t, {
    api: {
      getBootstrap: async () => pending.promise,
      getOrders: async () => ({ orders: [] }),
    },
  })

  let refreshPromise
  await act(async () => {
    refreshPromise = harness.getCurrent().refreshBootstrapSilently()
  })
  await act(async () => {
    harness.getCurrent().applyOfficialEffects({ order: { id: 'order-1', status: 'Finalizado' } })
  })
  pending.resolve(bootstrapFixture())
  await act(async () => { await refreshPromise })

  assert.equal(harness.getCurrent().orders[0].status, 'Finalizado')
})

test('bootstrap refresh is payment-agnostic and returns its official receipt', async (t) => {
  const harness = await mountHarness(t, {
    api: {
      getBootstrap: async () => bootstrapFixture(),
      getOrders: async () => ({ orders: [] }),
    },
  })

  let receipt
  await act(async () => {
    receipt = await harness.getCurrent().refreshBootstrapSilently()
  })

  assert.ok(receipt.applied.includes('orders'))
  assert.ok(receipt.applied.includes('movements'))
  assert.ok(receipt.applied.includes('tableTabs'))
  assert.ok(receipt.applied.includes('tables'))

  const source = await readFile(new URL('./useOperationalDataRuntime.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /legacyBridges/)
  assert.doesNotMatch(source, /capturePaymentOwners/)
  assert.doesNotMatch(source, /settlePaymentOwners/)
})

test('table commits update the official snapshot without invoking domain behavior', async (t) => {
  const bootstrap = bootstrapFixture()
  let tableCommitBridgeCalls = 0
  const harness = await mountHarness(t, {
    api: {
      getBootstrap: async () => bootstrap,
      getOrders: async () => ({ orders: [] }),
    },
    legacyBridges: {
      onTablesCommitted: () => { tableCommitBridgeCalls += 1 },
    },
  })

  await act(async () => { await harness.getCurrent().refreshBootstrap() })
  assert.equal(tableCommitBridgeCalls, 0)
  assert.deepEqual(harness.getCurrent().getOfficialTables().map(({ id }) => id), ['table-1'])
})

test('refreshOrders changes only orders', async (t) => {
  const bootstrap = bootstrapFixture()
  const nextOrders = [{ id: 'order-2', status: 'Em preparo' }]
  const harness = await mountHarness(t, {
    api: {
      getBootstrap: async () => bootstrap,
      getOrders: async () => ({ orders: nextOrders }),
    },
  })

  await act(async () => { await harness.getCurrent().refreshBootstrap() })
  const before = harness.getCurrent()
  const previousClients = before.clients
  const previousProducts = before.products
  const previousTables = before.tables
  const previousTableTabs = before.tableTabs
  const previousMovements = before.movements
  const previousFinanceSettings = before.financeSettings

  await act(async () => { await harness.getCurrent().refreshOrders() })
  const current = harness.getCurrent()
  assert.deepEqual(current.orders, nextOrders)
  assert.strictEqual(current.clients, previousClients)
  assert.strictEqual(current.products, previousProducts)
  assert.strictEqual(current.tables, previousTables)
  assert.strictEqual(current.tableTabs, previousTableTabs)
  assert.strictEqual(current.movements, previousMovements)
  assert.strictEqual(current.financeSettings, previousFinanceSettings)
})

test('resetOperationalData clears official state, replaces the guard, and resets revision', async (t) => {
  const bootstrap = bootstrapFixture()
  const harness = await mountHarness(t, {
    api: {
      getBootstrap: async () => bootstrap,
      getOrders: async () => ({ orders: [] }),
    },
  })

  await act(async () => { await harness.getCurrent().refreshBootstrap() })
  const firstGuard = harness.getCurrent().getSyncGuard()
  await act(async () => { harness.getCurrent().resetOperationalData() })
  const current = harness.getCurrent()

  assert.equal(current.bootstrapState, 'idle')
  assert.equal(current.business, null)
  assert.equal(current.bootstrapEffectiveConfig, null)
  assert.deepEqual(current.clients, [])
  assert.deepEqual(current.products, [])
  assert.deepEqual(current.orders, [])
  assert.deepEqual(current.tables, [])
  assert.deepEqual(current.tableTabs, [])
  assert.deepEqual(current.movements, [])
  assert.equal(current.financeSettings, null)
  assert.notStrictEqual(current.getSyncGuard(), firstGuard)
  assert.equal(current.getOfficialRevision(), 0)
  assert.deepEqual(current.getOfficialTables(), [])
})

test('a stale orders refresh cannot overwrite a newer official mutation', async (t) => {
  const pending = deferred()
  const bootstrap = bootstrapFixture()
  const harness = await mountHarness(t, {
    api: {
      getBootstrap: async () => bootstrap,
      getOrders: async () => pending.promise,
    },
  })

  await act(async () => { await harness.getCurrent().refreshBootstrap() })

  let refreshPromise
  await act(async () => {
    refreshPromise = harness.getCurrent().refreshOrders()
  })
  await act(async () => {
    harness.getCurrent().applyOfficialEffects({ order: { id: 'order-1', status: 'Finalizado' } })
  })

  pending.resolve({ orders: [{ id: 'order-1', status: 'Em preparo' }] })
  await act(async () => { await refreshPromise })

  assert.equal(harness.getCurrent().orders[0].status, 'Finalizado')
})


test('deletedClientId removes the accepted client and protects it from a stale bootstrap', async (t) => {
  const initial = bootstrapFixture()
  const pending = deferred()
  let bootstrapCalls = 0
  const harness = await mountHarness(t, {
    api: {
      getBootstrap: async () => {
        bootstrapCalls += 1
        return bootstrapCalls === 1 ? initial : pending.promise
      },
      getOrders: async () => ({ orders: [] }),
    },
  })

  await act(async () => { await harness.getCurrent().refreshBootstrap() })
  assert.deepEqual(harness.getCurrent().clients.map(({ id }) => id), ['client-1'])

  let refreshPromise
  await act(async () => {
    refreshPromise = harness.getCurrent().refreshBootstrapSilently()
  })
  await act(async () => {
    harness.getCurrent().applyOfficialEffects({ deletedClientId: 'client-1' })
  })

  pending.resolve(initial)
  await act(async () => { await refreshPromise })

  assert.deepEqual(harness.getCurrent().clients, [])
})


test('C8 accepted product delete survives an older bootstrap and does not change financial revision', async (t) => {
  const pending = deferred()
  let reads = 0
  const harness = await mountHarness(t, {
    api: {
      getBootstrap: async () => ++reads === 1 ? bootstrapFixture() : pending.promise,
      getOrders: async () => ({ orders: [] }),
    },
  })

  await act(async () => { await harness.getCurrent().refreshBootstrap() })
  let refreshPromise
  await act(async () => { refreshPromise = harness.getCurrent().refreshBootstrapSilently() })
  const revision = harness.getCurrent().getOfficialRevision()
  await act(async () => {
    harness.getCurrent().applyOfficialEffects({ deletedProductId: 'product-1' })
  })

  assert.deepEqual(harness.getCurrent().products, [])
  assert.equal(harness.getCurrent().getOfficialRevision(), revision)

  const stale = bootstrapFixture()
  stale.clients = [{ id: 'client-2', name: 'Bia' }]
  pending.resolve(stale)
  await act(async () => { await refreshPromise })

  assert.deepEqual(harness.getCurrent().products, [])
  assert.deepEqual(harness.getCurrent().clients, stale.clients)
  assert.equal(harness.getCurrent().getOfficialRevision(), revision + 1)
})

test('C8 product upsert protects products from stale bootstrap while unrelated collections still refresh', async (t) => {
  const pending = deferred()
  let reads = 0
  const harness = await mountHarness(t, {
    api: {
      getBootstrap: async () => ++reads === 1 ? bootstrapFixture() : pending.promise,
      getOrders: async () => ({ orders: [] }),
    },
  })

  await act(async () => { await harness.getCurrent().refreshBootstrap() })
  let refreshPromise
  await act(async () => { refreshPromise = harness.getCurrent().refreshBootstrapSilently() })
  const revision = harness.getCurrent().getOfficialRevision()
  const officialProduct = { id: 'product-1', name: 'Marmita atualizada', price: 35 }
  await act(async () => {
    harness.getCurrent().applyOfficialEffects({ product: officialProduct })
  })

  assert.deepEqual(harness.getCurrent().products, [officialProduct])
  assert.equal(harness.getCurrent().getOfficialRevision(), revision)

  const stale = bootstrapFixture()
  stale.clients = [{ id: 'client-3', name: 'Caio' }]
  pending.resolve(stale)
  await act(async () => { await refreshPromise })

  assert.deepEqual(harness.getCurrent().products, [officialProduct])
  assert.deepEqual(harness.getCurrent().clients, stale.clients)
})

test('C8 deleting a missing product is locally idempotent and non-financial', async (t) => {
  const harness = await mountHarness(t, {
    api: {
      getBootstrap: async () => bootstrapFixture(),
      getOrders: async () => ({ orders: [] }),
    },
  })

  await act(async () => { await harness.getCurrent().refreshBootstrap() })
  const before = harness.getCurrent().products
  const revision = harness.getCurrent().getOfficialRevision()

  await act(async () => {
    harness.getCurrent().applyOfficialEffects({ deletedProductId: 'missing-product' })
  })

  assert.deepEqual(harness.getCurrent().products, before)
  assert.equal(harness.getCurrent().getOfficialRevision(), revision)
})


test('C8 removes the collection escape hatch from the runtime contract', async (t) => {
  const h = await mountHarness(t, {
    api: {
      getBootstrap: async () => bootstrapFixture(),
      getOrders: async () => ({ orders: [] }),
    },
  })

  assert.equal(Object.hasOwn(h.getCurrent(), 'updateCollection'), false)

  const source = await readFile(new URL('./useOperationalDataRuntime.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /\bupdateCollection\b/)
})


test('silent bootstrap refresh immediately replaces only confirmed operation identity data', async (t) => {
  let reads = 0
  const initial = bootstrapFixture()
  const updated = {
    ...bootstrapFixture(),
    business: {
      id: 'amor-e-sabor',
      name: 'Amor & Sabor Renomeado',
      hasLogo: true,
      logoVersion: '2026-09-24T14:00:00.000Z',
    },
  }
  const harness = await mountHarness(t, {
    api: {
      getBootstrap: async () => ++reads === 1 ? initial : updated,
      getOrders: async () => ({ orders: [] }),
    },
  })

  await act(async () => { await harness.getCurrent().refreshBootstrap() })
  assert.deepEqual(harness.getCurrent().business, initial.business)

  await act(async () => { await harness.getCurrent().refreshBootstrapSilently() })
  assert.deepEqual(harness.getCurrent().business, updated.business)
})

const realtimeFixture=()=>{
  const listeners=new Set()
  return {state:'live',subscribeInvalidations(fn){listeners.add(fn);return()=>listeners.delete(fn)},emit(event){return Promise.all([...listeners].map(fn=>fn(event)))}}
}
const orderHint=id=>({topics:['orders'],orderIds:[id],requiresFullRefresh:false})

test('changed order is fetched by ID without dropping 10000 historical orders',async t=>{
  const realtime=realtimeFixture(),calls=[],history=Array.from({length:10000},(_,i)=>({id:'old-'+i,createdAt:'2025-01-01T00:00:00Z',status:'Finalizado'}))
  const harness=await mountHarness(t,{realtime,globalSyncEnabled:true,api:{getBootstrap:async()=>({...bootstrapFixture(),orders:history}),getOrders:async()=>{throw new Error('unexpected full orders')},getOrdersByIds:async ids=>{calls.push(ids);return {orders:[{id:'new',status:'Em preparo',createdAt:'2026-10-14T15:00:00Z'}]}}}})
  await act(async()=>harness.getCurrent().refreshBootstrap())
  await act(async()=>realtime.emit(orderHint('new')))
  assert.deepEqual(calls,[['new']]);assert.equal(harness.getCurrent().orders.length,10001)
  assert.equal(harness.getCurrent().orders[0].id,'new');assert.equal(harness.getCurrent().orders.at(-1).id,'old-9999')
})

test('partial response cannot overwrite a payment committed during the read',async t=>{
  const pending=deferred(),harness=await mountHarness(t,{api:{getBootstrap:async()=>bootstrapFixture(),getOrdersByIds:()=>pending.promise}})
  await act(async()=>harness.getCurrent().refreshBootstrap())
  let read
  await act(async()=>{read=harness.getCurrent().refreshOrdersByIds(['order-1'])})
  await act(async()=>harness.getCurrent().applyOfficialEffects({order:{id:'order-1',paymentStatus:'Pago',paymentId:'official'}}))
  pending.resolve({orders:[{id:'order-1',paymentStatus:'Pendente'}]})
  await act(async()=>assert.equal(await read,false))
  assert.equal(harness.getCurrent().orders[0].paymentId,'official')
})

test('rejected realtime read remains dirty and rereads after a local mutation',async t=>{
  t.mock.timers.enable({apis:['setTimeout']})
  const realtime=realtimeFixture(),pending=deferred();let reads=0
  const harness=await mountHarness(t,{realtime,globalSyncEnabled:true,api:{getBootstrap:async()=>bootstrapFixture(),getOrdersByIds:async()=>++reads===1?pending.promise:{orders:[{id:'order-1',paymentStatus:'Pago'}]}}})
  await act(async()=>harness.getCurrent().refreshBootstrap())
  let hint
  await act(async()=>{hint=realtime.emit(orderHint('order-1'))})
  await act(async()=>harness.getCurrent().applyOfficialEffects({order:{id:'order-1',paymentStatus:'Pago'}}))
  pending.resolve({orders:[{id:'order-1',paymentStatus:'Pendente'}]})
  await act(async()=>hint)
  assert.equal(harness.getCurrent().orders[0].paymentStatus,'Pago')
  await act(async()=>{t.mock.timers.tick(250)})
  assert.equal(reads,2);assert.equal(harness.getCurrent().orders[0].paymentStatus,'Pago')
})

test('missing ID retains history until an official snapshot succeeds',async t=>{
  const realtime=realtimeFixture(),snapshot=deferred();let bootstraps=0,pointReads=0
  const harness=await mountHarness(t,{realtime,globalSyncEnabled:true,api:{getBootstrap:async()=>++bootstraps===1?bootstrapFixture():snapshot.promise,getOrdersByIds:async()=>{pointReads++;return {orders:[]}}}})
  await act(async()=>harness.getCurrent().refreshBootstrap())
  await act(async()=>{void realtime.emit(orderHint('order-1'))})
  assert.equal(harness.getCurrent().orders[0].id,'order-1');assert.equal(bootstraps,2);assert.equal(pointReads,1)
  snapshot.resolve({...bootstrapFixture(),orders:[{id:'order-1',status:'Finalizado'}]})
  await act(async()=>{})
  assert.equal(harness.getCurrent().orders[0].status,'Finalizado')
})

test('live runtime removes legacy 5s and 2s intervals',async t=>{
  const intervals=[]
  t.mock.method(globalThis,'setInterval',(_fn,delay)=>{intervals.push(delay);return 1})
  t.mock.method(globalThis,'clearInterval',()=>{})
  const harness=await mountHarness(t,{realtime:realtimeFixture(),globalSyncEnabled:true,ordersSyncEnabled:true,api:{getBootstrap:async()=>bootstrapFixture(),getOrders:async()=>({orders:[]})}})
  await act(async()=>harness.getCurrent().refreshBootstrap())
  assert.deepEqual(intervals,[])
})

test('settings burst groups one bootstrap and never runs full orders in parallel',async t=>{
  const realtime=realtimeFixture();let bootstraps=0,orders=0
  const harness=await mountHarness(t,{realtime,globalSyncEnabled:true,ordersSyncEnabled:true,api:{getBootstrap:async()=>{bootstraps++;return bootstrapFixture()},getOrders:async()=>{orders++;return {orders:[]}}}})
  await act(async()=>harness.getCurrent().refreshBootstrap());bootstraps=0;orders=0
  await act(async()=>Promise.all([realtime.emit({topics:['settings'],orderIds:[],requiresFullRefresh:false}),realtime.emit(orderHint('order-1')),realtime.emit({topics:['finance'],orderIds:[],requiresFullRefresh:false})]))
  assert.equal(bootstraps,1);assert.equal(orders,0)
})

test('point response from an old access generation cannot apply in the new company',async t=>{
  const pending=deferred(),harness=await mountHarness(t,{accessContextId:'A',api:{getBootstrap:async()=>bootstrapFixture(),getOrdersByIds:()=>pending.promise}})
  await act(async()=>harness.getCurrent().refreshBootstrap())
  let read;await act(async()=>{read=harness.getCurrent().refreshOrdersByIds(['order-1'])})
  await act(async()=>harness.update({accessContextId:'B'}))
  pending.resolve({orders:[{id:'order-1',status:'Finalizado'}]})
  await act(async()=>assert.equal(await read,false))
  assert.deepEqual(harness.getCurrent().orders,[])
})

test('transient point-read failures retain dirty without retrying faster than fallback',async t=>{
  t.mock.timers.enable({apis:['setTimeout']})
  const realtime=realtimeFixture();let reads=0
  const harness=await mountHarness(t,{realtime,globalSyncEnabled:true,api:{getBootstrap:async()=>bootstrapFixture(),getOrdersByIds:async()=>{if(++reads===1)throw new Error('offline');return {orders:[{id:'order-1',status:'Finalizado'}]}}}})
  await act(async()=>harness.getCurrent().refreshBootstrap())
  await act(async()=>realtime.emit(orderHint('order-1')))
  assert.equal(reads,1)
  await act(async()=>{t.mock.timers.tick(29_999)})
  assert.equal(reads,1)
  await act(async()=>{t.mock.timers.tick(1)})
  assert.equal(reads,2);assert.equal(harness.getCurrent().orders[0].status,'Finalizado')
})

const scoped=(surface,collections,data={})=>({...data,readModel:{version:1,surface,completeCollections:collections,orderScope:collections.includes('orders')?'active':null,counters:{orders:1,comandas:0},operationalOrders:[{id:'active',status:'Em preparo',scheduledFor:null}],openTableTabIds:[]}})
test('scoped bootstrap replaces only declared collections, preserves other caches and passes the requested surface',async t=>{
  const calls=[],h=await mountHarness(t,{api:{getBootstrap:async(...args)=>{calls.push(args);return calls.length===1?bootstrapFixture():scoped('products',['products'],{products:[{id:'new-product'}]})}}})
  await act(async()=>h.getCurrent().refreshBootstrap())
  await act(async()=>h.update({surface:'products'}))
  assert.equal(h.getCurrent().readModelEnabled,true)
  assert.deepEqual(h.getCurrent().orders,bootstrapFixture().orders)
  assert.deepEqual(h.getCurrent().clients,bootstrapFixture().clients)
  assert.deepEqual(h.getCurrent().products,[{id:'new-product'}])
  assert.equal(calls.at(-1)[1].surface,'products')
})
test('scoped refreshOrders and full realtime fallback never call the integral orders endpoint',async t=>{
  const realtime=realtimeFixture(),calls=[]
  const h=await mountHarness(t,{realtime,globalSyncEnabled:true,api:{getBootstrap:async(...args)=>{calls.push(args);return scoped('history',[])},getOrders:async()=>{throw new Error('integral forbidden')},getActiveOrders:async()=>({orders:[{id:'active',status:'Em preparo'}]})}})
  await act(async()=>h.update({surface:'history'}))
  await act(async()=>h.getCurrent().refreshBootstrap())
  await act(async()=>h.getCurrent().refreshOrders())
  assert.deepEqual(h.getCurrent().orders.map(o=>o.id),['active'])
  await act(async()=>realtime.emit({topics:['orders'],orderIds:[],requiresFullRefresh:true}))
  assert.ok(calls.every(args=>args[1]?.surface==='history'))
  assert.equal(calls.length,2)
})
test('navigation during the first scoped bootstrap discards the previous surface and finishes loading the current one',async t=>{
  const old=deferred(),calls=[]
  const h=await mountHarness(t,{api:{getBootstrap:async(_v,{surface}={})=>{calls.push(surface);return surface==='orders'?old.promise:scoped(surface,[])}}})
  await act(async()=>h.update({surface:'orders'}))
  let first;await act(async()=>{first=h.getCurrent().refreshBootstrap()})
  await act(async()=>h.update({surface:'history'}))
  old.resolve(scoped('orders',['orders'],{orders:[{id:'old-surface'}]}))
  await act(async()=>{await first})
  assert.equal(h.getCurrent().bootstrapState,'ready')
  assert.deepEqual(h.getCurrent().orders,[])
  assert.equal(calls.at(-1),'history')
})
test('local committed effects update minimal operational identities and invalidate scoped queries without changing financial revision semantics',async t=>{
  const h=await mountHarness(t,{api:{getBootstrap:async()=>scoped('history',[])}})
  await act(async()=>h.getCurrent().refreshBootstrap())
  const revision=h.getCurrent().readModelRevision,financial=h.getCurrent().getOfficialRevision()
  await act(async()=>h.getCurrent().applyOfficialEffects({client:{id:'client',name:'Changed'}}))
  assert.equal(h.getCurrent().readModelRevision,revision+1)
  assert.equal(h.getCurrent().getOfficialRevision(),financial)
  await act(async()=>h.getCurrent().applyOfficialEffects({order:{id:'active',status:'Finalizado'},tableTab:{id:'new-tab',status:'open'}}))
  assert.deepEqual(h.getCurrent().operationalOrders,[])
  assert.equal(h.getCurrent().operationalCounters.comandas,1)
})

test('action reads resolve up to 100 canonical orders in bounded batches and expose them synchronously to official workflows',async t=>{
  const calls=[],h=await mountHarness(t,{accessContextId:'A',api:{getBootstrap:async()=>scoped('history',[]),getOrdersByIds:async ids=>{calls.push(ids);return {orders:ids.map(id=>({id,status:'Finalizado',paymentStatus:'Pendente'}))}}}})
  await act(async()=>h.getCurrent().refreshBootstrap())
  const ids=Array.from({length:100},(_,i)=>'order-'+i)
  await act(async()=>{assert.equal(await h.getCurrent().refreshOrdersForAction(ids),true);assert.equal(h.getCurrent().getOfficialOrders().length,100)})
  assert.deepEqual(calls.map(ids=>ids.length),[99,1])
  assert.equal(await h.getCurrent().refreshOrdersForAction([...ids,'too-many']),false)
})


test('navigation cache restores each surface snapshot without reading again on return',async t=>{
 const calls=[],h=await mountHarness(t,{accessContextId:'A',surface:'orders',api:{getBootstrap:async(_v,{surface})=>{calls.push(surface);const data=scoped(surface,['orders'],{orders:[{id:surface==='orders'?'kitchen-active':'tab-order'}]});data.readModel.orderScope=surface==='orders'?'active':'open-tabs';return data}}})
 await act(async()=>h.getCurrent().refreshBootstrap())
 await act(async()=>h.update({surface:'comandas'}))
 assert.equal(h.getCurrent().orders[0].id,'tab-order')
 await act(async()=>h.update({surface:'orders'}))
 assert.deepEqual(calls,['orders','comandas'])
 assert.equal(h.getCurrent().orders[0].id,'kitchen-active')
 assert.equal(h.getCurrent().surfaceState,'ready')
})

test('navigation cache never restores a snapshot after local data changed or the company changed',async t=>{
 const calls=[],h=await mountHarness(t,{accessContextId:'A',surface:'orders',api:{getBootstrap:async(_v,{surface})=>{calls.push(surface);return scoped(surface,[])}}})
 await act(async()=>h.getCurrent().refreshBootstrap())
 await act(async()=>h.update({surface:'clients'}))
 await act(async()=>h.getCurrent().applyOfficialEffects({client:{id:'new-client'}}))
 await act(async()=>h.update({surface:'orders'}))
 assert.deepEqual(calls,['orders','clients','orders'])
 await act(async()=>h.update({accessContextId:'B'}))
 assert.equal(h.getCurrent().bootstrapState,'idle')
 assert.deepEqual(h.getCurrent().orders,[])
 await act(async()=>h.getCurrent().refreshBootstrap())
 assert.equal(calls.length,4)
})


test('a newer official snapshot invalidates conflicting cached orders before returning to the kitchen',async t=>{
 let paid=false,reads=0
 const h=await mountHarness(t,{accessContextId:'A',surface:'orders',api:{getBootstrap:async(_v,{surface})=>{
  reads++;return scoped(surface,['orders'],{orders:[{id:'shared-order',status:'Em preparo',paymentStatus:paid?'Pago':'Pendente'}]})
 }}})
 await act(async()=>h.getCurrent().refreshBootstrap())
 paid=true
 await act(async()=>h.update({surface:'comandas'}))
 assert.equal(h.getCurrent().getOfficialOrders()[0].paymentStatus,'Pago')
 await act(async()=>h.update({surface:'orders'}))
 assert.equal(h.getCurrent().getOfficialOrders()[0].paymentStatus,'Pago')
 assert.equal(reads,3)
})
