import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { act } from 'react-test-renderer'
import { workspaceHarness, buttonNamed, nodeText } from '../../../test-support/renderWorkspace.js'

const summary = (date='2026-10-15') => ({date,sourceVersion:'a'.repeat(64),latest:null,integrityIssues:0,
  methods:[{method:'Pix',grossCents:20000,refundCents:0,netCents:20000,count:1},
    {method:'Dinheiro',grossCents:5000,refundCents:0,netCents:5000,count:1}]})

async function mount(t, fetchImpl, props={}) {
  const h=await workspaceHarness(t)
  const original=globalThis.fetch
  globalThis.fetch=fetchImpl
  t.after(()=>{globalThis.fetch=original})
  const {default:Component}=await h.load('/src/domains/finance/ui/DayConference.jsx')
  const {ContextApi}=await h.load('/src/infrastructure/api/ContextApi.js')
  const {createContextHttpClient}=await h.load('/src/infrastructure/api/contextHttpClient.js')
  const {NavigationProvider}=await h.load('/src/app/navigation/NavigationContext.jsx')
  const client=createContextHttpClient({context:{contextId:'company-a'},fetchImpl})
  const screen=await h.render(ContextApi.Provider,{value:client,children:React.createElement(NavigationProvider,{
    activeTab:'day-conference',granted:new Set(['finance.movements']),requestNavigation(){},
    children:React.createElement(Component,{canComplete:true,...props}),
  })})
  return {screen,h}
}
const response = data => Response.json(data)
const text = screen => [screen.toJSON()].flat().filter(Boolean).map(nodeText).join('')
const amounts = screen => screen.root.findAllByType('input').filter(n=>n.props.inputMode==='decimal')
const verify = screen => screen.root.findAllByType('input').filter(n=>n.props.type==='checkbox')

test('conference uses the authenticated company HTTP client and loads no details until requested',async t=>{
  const calls=[]
  const {screen}=await mount(t,async(path,options)=>{
    calls.push(path)
    if(new Headers(options.headers).get('X-Mesiva-Context')!=='company-a')return Response.json({error:{message:'Contexto ausente'}},{status:409})
    return response(summary())
  })
  assert.match(text(screen),/250,00/)
  assert.equal(calls.length,1)
  assert.ok(calls[0].startsWith('/api/finance/day-conference?'))
})

test('late detail responses cannot reopen a closed panel or leak into a different date',async t=>{
  let resolveDetail,restored=0
  const {screen}=await mount(t,async path=>path.includes('/entries?')
    ?new Promise(resolve=>{resolveDetail=resolve}):response(summary(new URL(path,'http://local').searchParams.get('date'))))
  let pending
  await act(async()=>{pending=screen.root.findAllByType('button').find(n=>nodeText(n)==='Ver lançamentos').props.onClick({currentTarget:{focus(){restored++}}})})
  await act(async()=>buttonNamed(screen.root,'Fechar').props.onClick())
  assert.equal(restored,1)
  await act(async()=>{resolveDetail(response({entries:[{id:'old',receiptId:'OLD-DAY',amountCents:20000,type:'entrada',source:'order-payment'}],nextPage:null}));await pending})
  assert.doesNotMatch(text(screen),/OLD-DAY|Lançamentos —/)
})

test('compensated differences stay divergent and a network retry keeps the same request key',async t=>{
  const sent=[]
  const {screen}=await mount(t,async(path,options)=>{
    if(options.method==='POST'){
      sent.push(JSON.parse(options.body))
      throw new TypeError('Falha de rede')
    }
    return response(summary())
  })
  await act(async()=>{
    amounts(screen)[0].props.onChange({target:{value:'100,00'}})
    amounts(screen)[1].props.onChange({target:{value:'150,00'}})
  })
  assert.ok(verify(screen).every(field=>!field.props.checked))
  assert.match(text(screen),/-R\$\s*100,00/,'the difference recalculates before individual verification')
  await act(async()=>{for(const field of verify(screen))field.props.onChange({target:{checked:true}})})
  assert.equal((text(screen).match(/Divergente/g)||[]).length,2)
  assert.equal(buttonNamed(screen.root,'Concluir conferência').props.disabled,true)
  await act(async()=>screen.root.findByType('textarea').props.onChange({target:{value:'PIX −100 e dinheiro +100.'}}))
  for(let i=0;i<2;i++){
    await act(async()=>buttonNamed(screen.root,'Concluir conferência').props.onClick())
    await act(async()=>buttonNamed(screen.root,'Registrar conferência').props.onClick())
  }
  assert.equal(sent.length,2)
  assert.equal(sent[0].requestKey,sent[1].requestKey)
})

test('read-only and blocked writers cannot conclude or change checked values',async t=>{
  const {screen}=await mount(t,async()=>response(summary()),{writesBlocked:true})
  assert.ok(amounts(screen).every(n=>n.props.disabled))
})

test('explicit refresh discards the history panel so an old list cannot contradict a new completion',async t=>{
  const {screen}=await mount(t,async path=>response(path.includes('/history?date=')?{history:[{
    id:'old-history',date:'2026-10-14',status:'conferida',revision:1,createdAt:'2026-10-14T15:00:00Z',
    note:'HISTÓRICO ANTIGO',lines:[],
  }]}:summary()))
  await act(async()=>buttonNamed(screen.root,'Ver revisões').props.onClick())
  assert.match(text(screen),/HISTÓRICO ANTIGO/)
  await act(async()=>buttonNamed(screen.root,'Atualizar').props.onClick())
  assert.doesNotMatch(text(screen),/HISTÓRICO ANTIGO/)
})

test('CSV downloads the complete selected date through the company client and history filters that date',async t=>{
  const calls=[],downloads=[]
  const {screen,h}=await mount(t,async path=>{
    calls.push(path)
    if(path.includes('/history?'))return response({history:[]})
    if(path.includes('/entries?')){
      const query=new URL(path,'http://local').searchParams,method=query.get('method')
      return response({entries:[{id:method,method,date:query.get('date'),type:'entrada',source:'order-payment',
        createdAt:'2026-10-23T15:00:00Z',amountCents:method==='Pix'?20000:5000}],nextPage:null})
    }
    return response(summary())
  })
  h.document.createElement=()=>({click(){downloads.push(this.download)}})
  await act(async()=>buttonNamed(screen.root,'CSV de lançamentos').props.onClick())
  const date=screen.root.findAllByType('input').find(n=>n.props.type==='date').props.value
  assert.deepEqual(downloads,['mesiva-recebimentos-'+date+'.csv'])
  assert.equal(calls.filter(path=>path.includes('/entries?')).length,2)
  assert.match(text(screen),/CSV completo/)
  await act(async()=>buttonNamed(screen.root,'Ver revisões').props.onClick())
  assert.ok(calls.includes('/api/finance/day-conference/history?date='+date))
})

test('approved comparison layout keeps Pix first and updates informed and difference indicators without extra reads',async t=>{
  const calls=[]
  const {screen}=await mount(t,async path=>{calls.push(path);return response(summary())})
  const statCards=screen.root.findAll(n=>n.props?.className?.includes('day-conference-stat surface-card') ||
    n.props?.className?.includes('surface-card day-conference-stat'))
  assert.equal(statCards.length,3)
  const methodRows=screen.root.findAll(n=>n.props?.className==='day-conference-table-row')
  assert.equal(methodRows.length,2)
  assert.match(nodeText(methodRows[0]),/Pix/)
  assert.match(nodeText(methodRows[1]),/Dinheiro/)
  assert.match(text(screen),/Valor informado/)
  assert.match(text(screen),/Campos em branco não entram na soma/)
  await act(async()=>{
    amounts(screen)[0].props.onChange({target:{value:'200,00'}})
    amounts(screen)[1].props.onChange({target:{value:'50,00'}})
  })
  assert.match(text(screen),/Conferido no banco, caixa e maquininhas/)
  assert.equal(calls.length,1,'editing must not trigger additional D1 requests')
})

test('receipt drawer keeps technical IDs collapsed, shows amounts and times, and pages only on request',async t=>{
  const calls=[]
  let day
  const entries=page=>page===1?[
    {id:'movement-pix-a',receiptId:'receipt-pix-a',date:day,createdAt:day+'T22:40:35Z',amountCents:57400,type:'entrada',source:'order-payment'},
    {id:'movement-pix-b',receiptId:'receipt-pix-b',date:day,createdAt:day+'T22:40:23Z',amountCents:22200,type:'entrada',source:'order-payment',orderNumber:331,orderId:'order-b'},
  ]:[
    {id:'movement-refund',receiptId:'receipt-refund',date:day,createdAt:day+'T21:10:00Z',amountCents:1000,type:'saida',source:'order-refund'},
  ]
  const {screen}=await mount(t,async path=>{
    calls.push(path)
    const params=new URL(path,'http://local').searchParams
    day=params.get('date')
    if(path.includes('/entries?')){
      const page=Number(params.get('page'))
      return response({entries:entries(page),nextPage:page===1?2:null})
    }
    const data=summary()
    data.methods[0].count=3
    return response(data)
  })
  assert.equal(calls.length,1,'initial screen loads just the summary')
  await act(async()=>buttonNamed(screen.root,'Ver lançamentos').props.onClick({currentTarget:{focus(){}}}))
  const receiptCards=()=>screen.root.findAll(n=>n.props.className==='day-conference-receipt')
  assert.equal(receiptCards().length,2)
  assert.match(nodeText(receiptCards()[0]),/PIX recebido/)
  assert.match(nodeText(receiptCards()[0]),/574,00/)
  assert.match(nodeText(receiptCards()[0]),/Sem pedido diretamente vinculado/)
  assert.match(nodeText(receiptCards()[1]),/Pedido #331/)
  assert.match(text(screen),/Exibindo 2 de 3/)
  const technical=screen.root.findAllByType('details').filter(n=>n.props.className==='day-conference-receipt-details')
  assert.equal(technical.length,2)
  assert.ok(technical.every(n=>n.props.open!==true),'technical identifiers must be collapsed')
  assert.match(nodeText(technical[0]),/movement-pix-a/)
  assert.equal(calls.length,2,'expanding native details requires no API call')
  await act(async()=>buttonNamed(screen.root,'Carregar mais').props.onClick())
  assert.equal(receiptCards().length,3)
  assert.match(nodeText(receiptCards()[2]),/Estorno/)
  assert.match(text(screen),/Exibindo 3 de 3/)
  assert.equal(calls.length,3,'only explicit pagination loads the next page')
})

test('conference amount input masks BRL cents including negatives and never persists partial typing',async t=>{
  const calls=[]
  const {screen}=await mount(t,async path=>{calls.push(path);return response(summary())})
  await act(async()=>amounts(screen)[0].props.onChange({target:{value:'123456'}}))
  assert.equal(amounts(screen)[0].props.value,'R$ 1.234,56')
  await act(async()=>amounts(screen)[0].props.onChange({target:{value:'-1050'}}))
  assert.equal(amounts(screen)[0].props.value,'-R$ 10,50')
  await act(async()=>amounts(screen)[0].props.onChange({target:{value:''}}))
  assert.equal(amounts(screen)[0].props.value,'')
  assert.equal(verify(screen)[0].props.checked,false)
  assert.equal(calls.length,1)
})

test('order snapshot is lazy, uses the company request and does not imply the shared receipt belongs to one order',async t=>{
  const calls=[]
  const {screen}=await mount(t,async (path)=>{
    calls.push(path)
    if(path.includes('/orders/by-ids'))return response({orders:[{
      id:'o-1',orderNumber:37,client:'Maria',type:'Retirada',status:'Finalizado',
      orderDate:'2026-10-15',total:120,items:[{id:'item-a',name:'Pizza',quantity:2}],
    }]})
    if(path.includes('/entries?'))return response({nextPage:null,entries:[{
      id:'movement-1',receiptId:'shared-1',date:'2026-10-15',createdAt:'2026-10-15T16:30:00Z',
      amountCents:20000,source:'order-payment',type:'entrada',linkedOrders:[
        {id:'o-1',number:37,client:'Maria'},{id:'o-2',number:38,client:'João'},
      ],
    }]})
    return response(summary())
  },{canViewOrders:true})
  await act(async()=>buttonNamed(screen.root,'Ver lançamentos').props.onClick({currentTarget:{focus(){}}}))
  assert.match(text(screen),/compartilhado entre 2 pedidos/)
  assert.match(text(screen),/Maria/)
  assert.equal(calls.filter(x=>x.includes('/orders/by-ids')).length,0,'order details must not load on list open')
  await act(async()=>screen.root.findAllByType('button').find(n=>nodeText(n)==='Ver pedido').props.onClick())
  assert.match(text(screen),/Pizza/)
  assert.match(text(screen),/Dados atualmente registrados/)
  assert.equal(calls.filter(x=>x.includes('/orders/by-ids')).length,1,'only clicked order loads')
})
