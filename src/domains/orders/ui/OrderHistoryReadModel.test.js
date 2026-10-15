import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import {act} from 'react-test-renderer'
import {workspaceHarness,renderWithNavigation,nodeText,buttonNamed} from '../../../test-support/renderWorkspace.js'
const order={id:'old-order',orderNumber:1,client:'Ana',type:'Retirada',status:'Finalizado',total:20,subtotal:20,paymentStatus:'Pendente',createdAt:'2020-01-01T15:00:00.000Z',finishedAt:'2020-01-01T16:00:00.000Z',items:[{id:'item',name:'Prato',quantity:1,unitPrice:20}]}
const page=orders=>({orders,summary:{all:200,finalized:180,cancelled:20,days:{'2020-01-01':180}},validRange:true,queryKey:'query-A'})
async function setup(t,initial,props={}){
  const h=await workspaceHarness(t),{default:History}=await h.load('/src/domains/orders/ui/OrderHistory.jsx')
  let update
  function Host(){const [model,setModel]=React.useState(initial);update=setModel;return React.createElement(History,{orders:[],readModel:model,queryState:{period:'all'},granted:new Set(['orders.history']),canCancelOrders:false,...props})}
  const renderer=await renderWithNavigation(h,Host)
  return {renderer,update:model=>act(async()=>update(model))}
}
test('scoped history displays global counts and requests another page without computing totals from loaded rows',async t=>{
  let more=0
  const model={ownerKey:'owner-A',status:'ready',data:page([order]),hasMore:true,loadNext:async()=>{more++}}
  const {renderer}=await setup(t,model)
  assert.match(nodeText(buttonNamed(renderer.root,'Todos')),/200/)
  assert.match(nodeText(renderer.root.findByProps({className:'toolbar-count'})),/200 registro/)
  assert.equal(renderer.root.findAllByType('article').length,1)
  const button=buttonNamed(renderer.root,'Carregar mais pedidos');assert.ok(button)
  await act(async()=>button.props.onClick())
  assert.equal(more,1)
})
test('detail remains available outside the current page through the official point loader',async t=>{
  const calls=[],model={ownerKey:'owner-A',status:'ready',data:page([order]),hasMore:true,loadNext:async()=>{},loadOrderById:async id=>{calls.push(id);return {...order,client:'Ana atualizada'}}}
  const {renderer,update}=await setup(t,model)
  await act(async()=>renderer.root.findByType('article').props.onClick({target:{closest:()=>null}}))
  assert.equal(renderer.root.findAllByProps({role:'dialog'}).length,1)
  await update({...model,data:page([{...order,id:'second',orderNumber:2,client:'Bruno'}])})
  assert.deepEqual(calls,['old-order'])
  assert.match(nodeText(renderer.root.findByProps({role:'dialog'})),/Ana atualizada/)
})
test('a late detail response from the old access owner cannot appear in another context',async t=>{
  let release
  const model={ownerKey:'owner-A',status:'ready',data:page([order]),loadOrderById:()=>new Promise(resolve=>{release=resolve})}
  const {renderer,update}=await setup(t,model)
  await act(async()=>renderer.root.findByType('article').props.onClick({target:{closest:()=>null}}))
  await update({...model,data:page([])})
  assert.equal(typeof release,'function')
  await update({...model,ownerKey:'owner-B',data:page([]),loadOrderById:async()=>null})
  await act(async()=>release(order))
  assert.equal(renderer.root.findAllByProps({role:'dialog'}).length,0)
})

test('closing historical detail cancels acceptance of a pending payment preparation',async t=>{
  let release,accept
  const model={ownerKey:'owner-A',status:'ready',data:page([order])}
  const {renderer}=await setup(t,model,{granted:new Set(['orders.history','payments.receive']),onRegisterPayment:(_id,_source,options)=>{accept=options?.isCurrent;return new Promise(resolve=>{release=resolve})}})
  await act(async()=>renderer.root.findByType('article').props.onClick({target:{closest:()=>null}}))
  await act(async()=>buttonNamed(renderer.root,'Registrar pagamento').props.onClick())
  assert.equal(typeof accept,'function');assert.equal(accept(),true)
  await act(async()=>buttonNamed(renderer.root,'Fechar').props.onClick())
  assert.equal(accept(),false)
  await act(async()=>release(false))
  assert.equal(renderer.root.findAllByProps({role:'dialog'}).length,0)
})
