import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import {act} from 'react-test-renderer'
import {workspaceHarness,renderWithNavigation,nodeText,buttonNamed} from '../../../test-support/renderWorkspace.js'
const currency=value=>`R$ ${Number(value).toFixed(2)}`
const orderPresentation={formatOrderDate:value=>value,getOrderItemsSearchText:()=>'',getOrderItemsSummary:()=> 'Prato'}
const orderRules={isOrderCancelled:o=>o.status==='Cancelado',isOrderPaid:o=>o.paymentStatus==='Pago',getPendingAmount:o=>o.paymentStatus==='Pago'?0:o.total}
const summary={today:{amount:4000,count:200},upcoming:{amount:0,count:0},overdue:{amount:0,count:0}}
const orders=Array.from({length:120},(_,i)=>({id:'o'+i,orderNumber:i+1,client:'Cliente Fictício',clientId:'c',customerIdentityType:'registered_client',status:'Finalizado',paymentStatus:'Pendente',total:20,orderDate:'2026-10-15',items:[]}))
const entry=o=>({key:'order:'+o.id,kind:'order',order:o,orders:[o],label:o.client,total:o.total,expectedDate:o.orderDate,timing:{status:'today'}})
const group={key:'client:c',clientId:'c',label:'Cliente Fictício',kind:'client',total:4000,count:200,timing:{status:'today'}}
test('receivables use global server totals and keep selected IDs across independently loaded group pages',async t=>{
 const h=await workspaceHarness(t),{default:Receivables}=await h.load('/src/domains/finance/ui/Receivables.jsx'),targets=[]
 const api={getReceivables:async q=>({orders:q.groupKey?(q.cursor?orders.slice(50,100):orders.slice(0,50)):[],entries:q.groupKey?(q.cursor?orders.slice(50,100):orders.slice(0,50)).map(entry):[],group:q.groupKey?group:null,groups:q.groupKey?[]:[group],summary,forecast:{days:[]},receivedToday:100,matchingCount:200,matchingGroupCount:100,queryKey:q.groupKey?'group':'list',nextCursor:q.groupKey&&!q.cursor?'next':null})}
 const readContext={enabled:true,api,accessContextId:'A',loadOrdersByIds:async ids=>orders.filter(o=>ids.includes(o.id))}
 function Controlled(){const[q,setQ]=React.useState({search:'',displayMode:'client',activeView:'pending',timingFilter:'all',sortMode:'urgency',selectedEntryKey:null});return React.createElement(Receivables,{orders:[],currency,readContext,queryState:q,onQueryChange:patch=>setQ(v=>({...v,...patch})),orderPresentation,orderRules,onRegisterClientOrdersPayment:target=>targets.push(target)})}
 const screen=await renderWithNavigation(h,Controlled)
 assert.match(nodeText(screen.root.findByProps({className:'receivables-summary-grid'})),/4000.00200 pedido/)
 assert.match(nodeText(screen.root),/100 item/)
 await act(async()=>screen.root.findByProps({className:'receivable-client-card-header'}).props.onClick())
 let panel=screen.root.findByProps({className:'receivables-client-panel'})
 await act(async()=>panel.findAllByType('input')[0].props.onChange())
 await act(async()=>buttonNamed(panel,'Carregar mais pedidos').props.onClick())
 panel=screen.root.findByProps({className:'receivables-client-panel'})
 await act(async()=>panel.findAllByType('input')[75].props.onChange())
 assert.match(nodeText(panel.findByProps({className:'receivables-client-panel-footer'})),/2 pedidos selecionadosR\$ 40.00/)
 await act(async()=>buttonNamed(panel,'Receber selecionados').props.onClick())
 assert.deepEqual(targets,[{clientId:'c',orderIds:['o0','o75']}])
})
test('cash flow shows authoritative totals and logical receipt count independent of loaded page',async t=>{
 const h=await workspaceHarness(t),{default:Workspace}=await h.load('/src/domains/finance/ui/FinanceWorkspace.jsx')
 const api={getMovements:async()=>({movements:[],totals:{entries:5000,exits:100,balance:4900},currentBalance:4950,financeSettings:null,summary:{count:201},nextCursor:'next'}),getReceivables:async()=>({orders:[],matchingCount:0})}
 const screen=await renderWithNavigation(h,Workspace,{movements:[],currency,today:'2026-10-15',readContext:{enabled:true,api,accessContextId:'A'},canManageMovements:false})
 assert.match(nodeText(screen.root),/R\$ 5000.00/);assert.match(nodeText(screen.root),/201 registro/)
 assert.ok(buttonNamed(screen.root,'Carregar mais movimentações'))
})
test('dashboard renders full server metrics without deriving totals from an empty page',async t=>{
 const h=await workspaceHarness(t),{default:Dashboard}=await h.load('/src/app/surfaces/dashboard/DashboardSurface.jsx')
 const api={getFinanceOverview:async()=>({dashboard:{totals:{salesToday:2000,receivedToday:1000,receivables:500},analytics:{metrics:{sales:20000,orderCount:200,averageTicket:100},daily:[],topProducts:[],mealsSold:200,paymentMix:[]}}})}
 const screen=await renderWithNavigation(h,Dashboard,{orders:[],movements:[],currency,queryState:{period:'30d',valuesVisible:true},onQueryChange:()=>{},readContext:{enabled:true,api,accessContextId:'A'}})
 assert.match(nodeText(screen.root),/R\$ 2000.00/);assert.match(nodeText(screen.root),/R\$ 20000.00/)
})
