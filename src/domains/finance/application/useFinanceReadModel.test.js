import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import {act,create} from 'react-test-renderer'
import {createCollectionSyncGuard} from '../../../app/runtime/data/dataSync.js'
test('receivable owners separate filtered pages, selected group and quick search without loading full orders',async t=>{
 const {useFinanceReadModel}=await import('./useFinanceReadModel.js'),calls=[];let current,renderer
 const api={getReceivables:async q=>{calls.push(q);return{orders:[],entries:[],groups:[],group:null,summary:{today:{count:200,amount:4000}},matchingCount:200,queryKey:JSON.stringify(q),nextCursor:null}}}
 // Keep the guard stable, as the App's contextual owner does.
 const guard=createCollectionSyncGuard(['orders','movements','financeSettings'])
 function Stable(){current=useFinanceReadModel({api,accessContextId:'A',guard,enabled:true,surface:'receivables',queryState:{search:'Ana',displayMode:'client',activeView:'pending',timingFilter:'overdue',sortMode:'recent',selectedEntryKey:'client:c'},quickOpen:true,quickSearch:'Prato'});return null}
 await act(async()=>{renderer=create(React.createElement(Stable))});t.after(()=>renderer.unmount())
 assert.equal(calls.length,3);assert.equal(current.main.data.summary.today.count,200)
 assert.ok(calls.some(q=>q.mode==='client'&&q.search==='Ana'&&q.timing==='overdue'))
 assert.ok(calls.some(q=>q.mode==='orders'&&q.groupKey==='client:c'))
 assert.ok(calls.some(q=>q.mode==='quick'&&q.search==='Prato'&&!q.timing))
})
test('finance movement and refund queries are independent and dashboard uses only overview',async t=>{
 const {useFinanceReadModel}=await import('./useFinanceReadModel.js'),calls=[],guard=createCollectionSyncGuard(['orders','movements','financeSettings']);let renderer,current
 const api={getMovements:async q=>{calls.push('movements');return{movements:[],totals:{entries:100,exits:10,balance:90},summary:{count:200}}},getReceivables:async q=>{calls.push(q.view);return{orders:[],matchingCount:100}},getFinanceOverview:async q=>{calls.push(q.period);return{dashboard:{totals:{salesToday:20}}}}}
 function Harness(props){current=useFinanceReadModel({api,guard,accessContextId:'A',enabled:true,surface:'finance',...props});return null}
 await act(async()=>{renderer=create(React.createElement(Harness))});t.after(()=>renderer.unmount())
 assert.deepEqual(calls,['movements','refunds']);assert.equal(current.main.data.totals.entries,100)
 await act(async()=>renderer.update(React.createElement(Harness,{surface:'dashboard',queryState:{period:'7d'}})))
 assert.equal(calls.at(-1),'7d');assert.equal(current.main.data.dashboard.totals.salesToday,20)
})
