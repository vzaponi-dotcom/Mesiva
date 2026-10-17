import test from 'node:test'
import assert from 'node:assert/strict'
import {NAVIGATION_DESTINATIONS} from '../src/app/navigation/registry.js'
const module=()=>import('./scopedReads.js')
test('surface contract covers the current navigation registry without inheriting object prototype keys',async()=>{
  const m=await module()
  for(const destination of NAVIGATION_DESTINATIONS)assert.ok(m.READ_SURFACE_IDS.includes(destination.id),destination.id)
  assert.ok(m.READ_SURFACE_IDS.includes('shell'))
  assert.equal(new Set(m.READ_SURFACE_IDS).size,m.READ_SURFACE_IDS.length)
})
test('scoped collection metadata is explicit and legacy payloads remain distinguishable',async()=>{
  const {getScopedBootstrapCollections}=await module()
  assert.equal(getScopedBootstrapCollections({orders:[]}),null)
  assert.deepEqual(getScopedBootstrapCollections({orders:[],readModel:{version:1,completeCollections:['orders']}}),['orders'])
  for(const data of [{readModel:{version:1,completeCollections:['orders']}},{orders:[],readModel:{version:1,completeCollections:['orders','orders']}},{orders:[],readModel:{version:2,completeCollections:['orders']}}])assert.throws(()=>getScopedBootstrapCollections(data))
})

test('operational metadata validates counts, unique candidate identities and authorized status shapes',async()=>{
  const {getScopedOperationalState}=await module()
  assert.equal(getScopedOperationalState({orders:[]}),null)
  const base={readModel:{version:1,completeCollections:[],counters:{orders:1,comandas:0},operationalOrders:[{id:'a',status:'Agendado',createdAt:'2026-10-15',scheduledFor:'2030-01-01'}],openTableTabIds:[]}}
  assert.equal(getScopedOperationalState(base).orders.length,1)
  for(const patch of [{counters:{orders:-1,comandas:0}},{operationalOrders:[{id:'a',status:'Finalizado'}]},{operationalOrders:[{id:'a',status:'Em preparo'},{id:'a',status:'Em preparo'}]},{openTableTabIds:['a','a']}])assert.throws(()=>getScopedOperationalState({readModel:{...base.readModel,...patch}}))
})
