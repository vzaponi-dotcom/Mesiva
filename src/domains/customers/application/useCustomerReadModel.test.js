import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import {act,create} from 'react-test-renderer'
import {createCollectionSyncGuard} from '../../../app/runtime/data/dataSync.js'
test('customer list and profile are independent contextual queries and retain complete server totals',async t=>{
 const {useCustomerReadModel}=await import('./useCustomerReadModel.js'),calls=[],guard=createCollectionSyncGuard(['clients','orders']);let current,renderer
 const api={getCustomers:async q=>{calls.push(['list',q]);return{clients:[{id:'c',profile:{orderCount:200}}],summary:{count:300},nextCursor:null}},getCustomerRelationship:async(id,q)=>{calls.push(['profile',id,q]);return{client:{id},profile:{orderCount:200},orders:[{id:'o'}],nextCursor:null}}}
 function Harness(){current=useCustomerReadModel({api,guard,accessContextId:'A',enabled:true,search:'Ana',sort:'recent',filter:'pending',clientId:'c',orderFilter:'pending'}) ;return null}
 await act(async()=>{renderer=create(React.createElement(Harness))});t.after(()=>renderer.unmount())
 assert.equal(current.list.data.summary.count,300);assert.equal(current.relationship.data.profile.orderCount,200)
 assert.equal(calls.length,2);assert.equal(calls.find(c=>c[0]==='profile')[2].filter,'pending')
})
