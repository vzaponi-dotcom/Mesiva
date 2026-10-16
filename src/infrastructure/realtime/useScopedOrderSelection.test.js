import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import {act,create} from 'react-test-renderer'
const orders=Array.from({length:101},(_,i)=>({id:'o'+i,clientId:'c',paymentStatus:'Pendente',total:1}))
async function mount(t,props){
 const {useScopedOrderSelection}=await import('./useScopedOrderSelection.js');let current,renderer
 function Harness(p){current=useScopedOrderSelection({...props,...p});return null}
 await act(async()=>{renderer=create(React.createElement(Harness))});t.after(()=>renderer.unmount())
 return{get value(){return current},update:props=>renderer.update(React.createElement(Harness,props))}
}
const isEligible=o=>o?.clientId==='c'&&o.paymentStatus==='Pendente'
test('explicit selection survives page absence and prunes only canonical missing/paid identities on refresh',async t=>{
 let paid=false
 const h=await mount(t,{scopeKey:'A:c',isEligible,refreshKey:1,loadOrdersByIds:async ids=>ids.map(id=>({...orders.find(o=>o.id===id),paymentStatus:paid&&id==='o99'?'Pago':'Pendente'}))})
 await act(async()=>h.value.selectVisible(orders.slice(0,50)))
 await act(async()=>h.update({refreshKey:2}))
 assert.equal(h.value.ids.length,50)
 await act(async()=>h.value.selectVisible(orders.slice(50,100)))
 assert.equal(h.value.ids.length,100);assert.equal(h.value.total,100)
 paid=true;await act(async()=>h.update({refreshKey:3}))
 assert.equal(h.value.ids.length,99);assert.equal(h.value.ids.includes('o99'),false)
 assert.equal(h.value.ids.includes('o75'),true)
})
test('selection enforces 100 and eligibility and rejects late validation from another company',async t=>{
 let release
 const h=await mount(t,{scopeKey:'A:c',isEligible,refreshKey:1,loadOrdersByIds:()=>new Promise(resolve=>{release=resolve})})
 await act(async()=>h.value.selectVisible(orders))
 assert.equal(h.value.ids.length,100)
 await act(async()=>assert.equal(h.value.toggle({...orders[0],id:'other',clientId:'other-client'}),false))
 await act(async()=>h.update({refreshKey:2}))
 await act(async()=>h.update({scopeKey:'B:c',refreshKey:3}))
 assert.deepEqual(h.value.ids,[])
 await act(async()=>release?.(orders.slice(0,100)))
 assert.deepEqual(h.value.ids,[])
})
