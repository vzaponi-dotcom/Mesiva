import assert from 'node:assert/strict'
import test from 'node:test'
import { createOrderEditDraftContext } from './newOrderDraft.js'
import { buildOrderEditPayload, addEditCartItem, updateEditCartItem } from '../domain/orderCart.js'

const order={
  id:'order-42',orderNumber:42,contentRevision:4,status:'Em preparo',type:'Entrega',
  customerIdentityType:'guest_name',client:'Joana',clientId:null,orderDate:'2026-10-10',
  subtotal:80,total:80,deliveryFee:0,
  adjustment:{type:'none',mode:'fixed',value:0,reason:''},
  items:[{id:'i-a',productId:'old',name:'Comida antiga',category:'Refeições',size:'P',unitPrice:40,quantity:2,note:'sem cebola'}],
}
test('editing context uses authoritative order identity, content revision and immutable customer snapshot',()=>{
 const result=createOrderEditDraftContext(order,{returnDestination:'orders'})
 assert.equal(result.mode,'edit-order')
 assert.deepEqual(result.orderContext,{
   id:'order-42',orderNumber:42,expectedContentRevision:4,
   originalTotal:80,totalCents:8000,netReceivedCents:0,
   paid:false,paymentId:null,tableTabId:null,customerLabel:'Joana',
 })
 assert.equal(result.initialDraft.type,'Entrega')
 assert.equal(result.initialDraft.items[0].persistedItemId,'i-a')
 assert.equal(result.initialDraft.items[0].lineId,'i-a')
 assert.equal(result.initialDraft.items[0].unitPrice,40)
 const payload=buildOrderEditPayload(result.initialDraft)
 assert.equal(payload.items[0].id,'i-a')
 assert.deepEqual(Object.keys(payload).sort(),['adjustment','deliveryFee','items'])
})
test('legacy lines remain distinct from current-catalog additions, preserving historic prices',()=>{
 const draft=createOrderEditDraftContext(order).initialDraft
 const updated=addEditCartItem(draft.items,{id:'old',name:'Comida nova',category:'Refeições',price:65})
 assert.equal(updated.length,2)
 assert.equal(updated[0].persistedItemId,'i-a')
 assert.equal(updated[0].unitPrice,40)
 assert.equal(updated[1].persistedItemId,null)
 assert.equal(updated[1].unitPrice,65)
 assert.equal(updated[1].productId,'old')
 const reduced=updateEditCartItem(updated,'i-a',{quantity:1,note:'  sem   gelo '})
 assert.equal(reduced[0].persistedItemId,'i-a')
 assert.equal(reduced[0].note,'sem gelo')
 assert.equal(reduced.length,2)
})
test('request payload never sends order status, identity, old product repricing or payment fields',()=>{
 const initial=createOrderEditDraftContext(order).initialDraft
 const payload=buildOrderEditPayload({...initial,items:[...initial.items,{
   lineId:'new',persistedItemId:null,productId:'other',quantity:1,note:'gelo',unitPrice:99,
 }]})
 assert.deepEqual(payload.items,[{id:'i-a',quantity:2,note:'sem cebola'},{productId:'other',quantity:1,note:'gelo'}])
 assert.equal(Object.hasOwn(payload,'total'),false)
 assert.equal(Object.hasOwn(payload,'customerIdentity'),false)
 assert.equal(Object.hasOwn(payload,'orderDate'),false)
 assert.equal(Object.hasOwn(payload,'paymentAllocations'),false)
})
test('finalized, cancelled and reserved Local orders cannot open editor',()=>{
 for(const status of ['Finalizado','Cancelado'])assert.equal(createOrderEditDraftContext({...order,status}),null)
 assert.equal(createOrderEditDraftContext({...order,type:'Local',tableReservationStatus:'reserved'}),null)
})
