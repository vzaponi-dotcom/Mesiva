import test from 'node:test'
import assert from 'node:assert/strict'
import {getScopedReadCache} from './scopedReadCache.js'
import {createCollectionSyncGuard} from '../../app/runtime/data/dataSync.js'
const fixture=()=>{
 const guard=createCollectionSyncGuard(['orders']),cache=getScopedReadCache(guard,'A')
 const put=(key,data,version=cache.version)=>cache.set(key,data,{topics:['orders'],collections:['orders'],token:guard.beginQueryRead(['orders']),version})
 return {guard,cache,put}
}
test('bounded cache evicts the least recently visited result and skips oversized lists',()=>{
 const {cache,put}=fixture()
 for(let index=0;index<20;index++)put('query:'+index,{orders:[{id:String(index)}]})
 assert.equal(cache.get('query:0').orders[0].id,'0')
 put('query:20',{orders:[{id:'20'}]})
 assert.equal(cache.get('query:1'),null)
 assert.equal(cache.get('query:0').orders[0].id,'0')
 put('large',{products:Array.from({length:501},(_,id)=>({id}))})
 assert.equal(cache.get('large'),null)
})
test('unrelated printing events preserve results while data changes reject cached and late results',()=>{
 const {cache,put}=fixture()
 put('orders',{orders:[{id:'unknown',status:'unknown'}]})
 cache.invalidate(['printing'])
 assert.equal(cache.get('orders').orders[0].status,'unknown')
 const version=cache.version
 cache.invalidate(['orders'])
 put('late',{orders:[{id:'stale'}]},version)
 assert.equal(cache.get('orders'),null);assert.equal(cache.get('late'),null)
})

test('fresh source changes invalidate conflicting metadata and collections but preserve an unchanged source',()=>{
 const {guard,cache}=fixture()
 const snapshot=(price,clientIds=['one'])=>({business:{id:'A',name:'A'},products:[{id:'p',price}],clients:clientIds.map(id=>({id})),readModel:{completeCollections:['products','clients']}})
 const put=(key,data)=>cache.set('snapshot:'+key,data,{topics:['orders','settings','catalog','clients'],collections:['orders'],token:guard.beginQueryRead(['orders']),version:cache.version})
 put('products',snapshot(10));put('new-order',snapshot(10))
 assert.ok(cache.get('snapshot:products'))
 put('new-order',snapshot(20,['one','two']))
 assert.equal(cache.get('snapshot:products'),null)
 assert.equal(cache.get('snapshot:new-order').products[0].price,20)
 put('products',snapshot(20,['one','two']))
 assert.ok(cache.get('snapshot:new-order'))
 const changed=snapshot(20,['one','two']);changed.business.name='New business name'
 put('products',changed)
 assert.equal(cache.get('snapshot:new-order'),null)
})

test('a fresh oversized snapshot invalidates old canonical values even though the large result is not retained',()=>{
 const {guard,cache}=fixture()
 const options={topics:['orders'],collections:['orders'],token:guard.beginQueryRead(['orders']),version:cache.version}
 cache.set('snapshot:orders',{orders:[{id:'one',paymentStatus:'Pendente'}],readModel:{completeCollections:['orders'],orderScope:'active'}},options)
 cache.set('snapshot:comandas',{orders:[{id:'one',paymentStatus:'Pago'}],tables:Array.from({length:501},(_,id)=>({id})),readModel:{completeCollections:['orders','tables'],orderScope:'open-tabs'}},options)
 assert.equal(cache.get('snapshot:orders'),null)
 assert.equal(cache.get('snapshot:comandas'),null)
})
