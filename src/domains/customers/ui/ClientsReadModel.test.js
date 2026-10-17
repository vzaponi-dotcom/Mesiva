import test from 'node:test'
import assert from 'node:assert/strict'
import {act} from 'react-test-renderer'
import {workspaceHarness,renderWithNavigation,nodeText,buttonNamed} from '../../../test-support/renderWorkspace.js'
const client={id:'c',name:'Cliente Fictício',phone:'11999998888',address:'Rua Fictícia'}
const orders=Array.from({length:120},(_,i)=>({id:'o'+i,orderNumber:i+1,clientId:'c',client:client.name,customerIdentityType:'registered_client',type:'Retirada',status:'Finalizado',paymentStatus:'Pendente',total:20,orderDate:'2020-01-01',createdAt:'2020-01-01T12:00:00Z',items:[]}))
const profile={orderCount:200,cancelledCount:0,total:4000,pending:4000,average:20,lastPurchase:'2020-01-01',daysSincePurchase:2000,frequencyDays:0,favorites:[{key:'meal',name:'Prato Fictício',quantity:200}]}
const granted=new Set(['clients.view','orders.view','orders.history','payments.receive'])
const realtimeFixture=()=>{const listeners=new Set();return{subscribeInvalidations:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},emit:event=>Promise.all([...listeners].map(fn=>fn(event)))}}
async function mount(t){
 const h=await workspaceHarness(t),{default:Clients}=await h.load('/src/domains/customers/ui/Clients.jsx'),realtime=realtimeFixture(),received=[],calls=[]
 const api={getCustomers:async q=>{calls.push(['list',q]);return{clients:[{...client,profile}],summary:{count:201,filters:{all:201,pending:1,inactive:1,empty:200}},completeHistory:true,queryKey:'clients',nextCursor:q.cursor?null:'clients-2'}},getCustomerRelationship:async(id,q)=>{calls.push(['profile',q]);return{client,profile,orders:q.cursor?orders.slice(50,100):orders.slice(0,50),summary:{count:200},queryKey:'profile-'+q.filter,nextCursor:q.cursor?null:'orders-2'}}}
 const readContext={enabled:true,api,accessContextId:'A',realtime,officialRevision:1,loadOrdersByIds:async ids=>ids.map(id=>orders.find(o=>o.id===id)),loadOrderById:async id=>orders.find(o=>o.id===id)}
 const renderer=await renderWithNavigation(h,Clients,{granted,readContext,clients:[],orders:[],canReceiveOrder:()=>true,onRegisterPayment:()=>true,onRegisterClientOrdersPayment:target=>received.push(target)})
 return{renderer,calls,received,realtime}
}
test('customer rows and profile use complete server totals and expose loading more instead of local page totals',async t=>{
 const {renderer}=await mount(t)
 assert.match(nodeText(renderer.root.findByProps({className:'client-list-caption'})),/201 clientes/)
 await act(async()=>buttonNamed(renderer.root,'Abrir perfil de Cliente Fictício').props.onClick())
 assert.match(nodeText(renderer.root.findByProps({role:'dialog'})),/Prato Fictício/)
 assert.match(nodeText(renderer.root.findByProps({role:'dialog'})),/200 cancelados|0 cancelados/)
 assert.ok(buttonNamed(renderer.root,'Carregar mais clientes'))
})
test('customer selection remains explicit between pages and refreshes and preserves the canonical batch target',async t=>{
 const {renderer,realtime,received,calls}=await mount(t)
 await act(async()=>buttonNamed(renderer.root,'Abrir perfil de Cliente Fictício').props.onClick())
 await act(async()=>buttonNamed(renderer.root.findByProps({role:'dialog'}),'Pedidos').props.onClick())
 await act(async()=>buttonNamed(renderer.root.findByProps({role:'dialog'}),'A receber').props.onClick())
 let checkboxes=renderer.root.findAll(node=>node.type==='input'&&node.props.type==='checkbox')
 assert.equal(checkboxes.length,50)
 await act(async()=>checkboxes[0].props.onChange())
 await act(async()=>buttonNamed(renderer.root,'Carregar mais pedidos').props.onClick())
 checkboxes=renderer.root.findAll(node=>node.type==='input'&&node.props.type==='checkbox')
 assert.equal(checkboxes.length,100)
 await act(async()=>checkboxes[75].props.onChange())
 await act(async()=>realtime.emit({topics:['orders']}))
 assert.match(nodeText(renderer.root),/2 pedidos selecionados/)
 await act(async()=>buttonNamed(renderer.root,'Receber selecionados').props.onClick())
 assert.deepEqual(received,[{clientId:'c',orderIds:['o0','o75']}])
 assert.ok(calls.some(([kind,q])=>kind==='profile'&&q.filter==='pending'))
})
