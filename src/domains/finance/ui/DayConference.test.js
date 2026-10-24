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
const firstDetail = screen => screen.root.findAll(n=>n.type==='button'&&n.props.className==='day-conference-detail')[0]

test('discrepancies load only on demand and returning preserves the conference draft',async t=>{
  const calls=[]
  const {screen}=await mount(t,async path=>{calls.push(path);return response(path.includes('/discrepancies')?{items:[],nextCursor:null}:summary())})
  await act(async()=>amounts(screen)[0].props.onChange({target:{value:'10000'}}))
  assert.equal(calls.length,1)
  assert.ok(buttonNamed(screen.root,'Divergências pendentes'),'pending treatment must be available on this screen')
  await act(async()=>buttonNamed(screen.root,'Divergências pendentes').props.onClick())
  assert.equal(calls.length,2);assert.match(calls[1],/discrepancies\?status=pending/)
  assert.match(text(screen),/Nenhuma divergência pendente/)
  await act(async()=>buttonNamed(screen.root,'Conferência').props.onClick())
  assert.equal(amounts(screen)[0].props.value,'R$ 100,00')
  assert.equal(calls.length,2,'returning to a valid draft does not query again')
})

test('reviewing an old discrepancy keeps its own date and source on every drawer page',async t=>{
  const calls=[],old={id:'old:0',date:'2020-01-01',method:'Pix',netCents:100,checkedCents:90,differenceCents:-10,
    status:'pending',revision:1,actorName:'Marina',createdAt:'2020-01-01T15:00:00Z',conferenceNote:'Revisar extrato antigo.'}
  const {screen}=await mount(t,async path=>{
    calls.push(path)
    if(path.includes('/discrepancies/'))return response({discrepancy:old})
    if(path.includes('/discrepancies?'))return response({items:[old],nextCursor:null})
    if(path.includes('/entries?'))return response({entries:[],nextPage:path.includes('page=1')?2:null})
    return response({...summary(path.includes('2020-01-01')?'2020-01-01':'2026-10-15'),sourceVersion:'b'.repeat(64)})
  })
  await act(async()=>buttonNamed(screen.root,'Divergências pendentes').props.onClick())
  await act(async()=>buttonNamed(screen.root,'Analisar').props.onClick({currentTarget:{}}))
  await act(async()=>buttonNamed(screen.root,'Revisar lançamentos atuais').props.onClick({currentTarget:{focus(){}}}))
  const more=screen.root.findAll(n=>n.type==='button'&&nodeText(n).includes('Carregar mais'))[0]
  assert.ok(more)
  await act(async()=>more.props.onClick())
  const pages=calls.filter(path=>path.includes('/entries?'))
  assert.equal(pages.length,2)
  assert.ok(pages.every(path=>path.includes('date=2020-01-01')&&path.includes('sourceVersion='+'b'.repeat(64))))
  assert.match(pages[1],/page=2/)
})

test('resolving a discrepancy acquires and releases only its global navigation/write lock',async t=>{
  let key=null,release
  const item={id:'pending:0',date:'2026-10-15',method:'Pix',netCents:100,checkedCents:90,differenceCents:-10,status:'pending',
    revision:1,createdAt:'2026-10-15T15:00:00Z',conferenceNote:'Nota'}
  const {screen}=await mount(t,async(path,o)=>{
    if(o.method==='POST')return new Promise(resolve=>{release=()=>resolve(response({discrepancy:{...item,status:'resolved',
      resolutionReason:'conference_error',resolutionNote:'Conferido',resolvedAt:'2026-10-24T15:00:00Z',resolvedActorName:'Gestora'}}))})
    if(path.includes('/discrepancies/'))return response({discrepancy:item})
    if(path.includes('/discrepancies?'))return response({items:[item],nextCursor:null})
    return response(summary())
  },{setRequestKey:value=>{key=typeof value==='function'?value(key):value}})
  await act(async()=>buttonNamed(screen.root,'Divergências pendentes').props.onClick())
  await act(async()=>buttonNamed(screen.root,'Analisar').props.onClick({currentTarget:{}}))
  const select=screen.root.find(n=>typeof n.type==='function'&&n.type.name==='SystemSelect')
  await act(async()=>select.props.onChange('conference_error'))
  await act(async()=>screen.root.findByType('form').findByType('textarea').props.onChange({target:{value:'Conferido'}}))
  await act(async()=>screen.root.findByType('form').findByProps({type:'checkbox'}).props.onChange({target:{checked:true}}))
  let pending
  await act(async()=>{pending=screen.root.findByType('form').props.onSubmit({preventDefault(){}})})
  assert.equal(key,'day-conference:discrepancy')
  assert.equal(buttonNamed(screen.root,'Conferência').props.disabled,true)
  key='other-operation'
  await act(async()=>{release();await pending})
  assert.equal(key,'other-operation','resolution cleanup must not clear another operation')
})

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
  await act(async()=>{pending=firstDetail(screen).props.onClick({currentTarget:{focus(){restored++}}})})
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
  await act(async()=>buttonNamed(screen.root,'Exportar CSV').props.onClick())
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
  assert.match(text(screen),/Preencha todas as formas para calcular o total/)
  await act(async()=>{
    amounts(screen)[0].props.onChange({target:{value:'200,00'}})
    amounts(screen)[1].props.onChange({target:{value:'50,00'}})
  })
  assert.match(text(screen),/Conferido no banco, caixa e maquininhas/)
  assert.equal(calls.length,1,'editing must not trigger additional D1 requests')
})

for(const action of ['refresh','date'])test(`discard confirmation preserves an unfinished conference when cancelling ${action}`,async t=>{
  const calls=[]
  const {screen}=await mount(t,async path=>{
    calls.push(path)
    return response(summary(new URL(path,'http://local').searchParams.get('date')))
  })
  const dateInput=()=>screen.root.findAllByType('input').find(n=>n.props.type==='date')
  const initialDate=dateInput().props.value
  await act(async()=>{
    amounts(screen)[0].props.onChange({target:{value:'0'}})
    screen.root.findByType('textarea').props.onChange({target:{value:'Rascunho da conferência'}})
  })
  await act(async()=>verify(screen)[0].props.onChange({target:{checked:true}}))
  const change=()=>action==='refresh'?buttonNamed(screen.root,'Atualizar').props.onClick()
    :dateInput().props.onChange({target:{value:'2026-10-14'}})
  await act(async()=>change())
  assert.match(text(screen),/Descartar preenchimento/)
  assert.equal(calls.length,1,'opening the confirmation must not read or write data')
  assert.equal(dateInput().props.value,initialDate)
  await act(async()=>buttonNamed(screen.root,'Continuar conferindo').props.onClick())
  assert.equal(amounts(screen)[0].props.value,'R$ 0,00')
  assert.equal(verify(screen)[0].props.checked,true)
  assert.equal(screen.root.findByType('textarea').props.value,'Rascunho da conferência')
  assert.equal(calls.length,1)
  await act(async()=>change())
  await act(async()=>buttonNamed(screen.root,action==='refresh'?'Descartar e atualizar':'Descartar e trocar data').props.onClick())
  assert.equal(calls.length,2,'confirming performs only the requested read')
  assert.equal(dateInput().props.value,action==='refresh'?initialDate:'2026-10-14')
  assert.ok(amounts(screen).every(n=>n.props.value===''))
  assert.equal(screen.root.findByType('textarea').props.value,'')
})

test('notes alone are protected while an empty conference refreshes without confirmation',async t=>{
  const calls=[]
  const {screen}=await mount(t,async path=>{calls.push(path);return response(summary())})
  await act(async()=>buttonNamed(screen.root,'Atualizar').props.onClick())
  assert.equal(calls.length,2)
  assert.doesNotMatch(text(screen),/Descartar preenchimento/)
  await act(async()=>screen.root.findByType('textarea').props.onChange({target:{value:'Comprovante ainda em análise'}}))
  await act(async()=>buttonNamed(screen.root,'Atualizar').props.onClick())
  assert.match(text(screen),/Descartar preenchimento/)
  assert.equal(calls.length,2)
  await act(async()=>buttonNamed(screen.root,'Continuar conferindo').props.onClick())
  assert.equal(screen.root.findByType('textarea').props.value,'Comprovante ainda em análise')
})

test('manual refresh clears prior success and does not ask to discard a completed snapshot',async t=>{
  let conference,changed=false
  const {screen}=await mount(t,async(path,options)=>{
    if(options.method==='POST'){
      const payload=JSON.parse(options.body)
      conference={id:'completed',...payload,revision:1,status:'conferida',createdAt:'2026-10-23T15:00:00Z'}
      return response({conference})
    }
    return response({...summary(),sourceVersion:(changed?'b':'a').repeat(64),latest:conference??null})
  })
  await act(async()=>{
    amounts(screen)[0].props.onChange({target:{value:'200,00'}})
    amounts(screen)[1].props.onChange({target:{value:'50,00'}})
  })
  await act(async()=>{for(const field of verify(screen))field.props.onChange({target:{checked:true}})})
  await act(async()=>buttonNamed(screen.root,'Concluir conferência').props.onClick())
  await act(async()=>buttonNamed(screen.root,'Registrar conferência').props.onClick())
  assert.match(text(screen),/Conferência registrada com sucesso/)
  changed=true
  await act(async()=>buttonNamed(screen.root,'Atualizar').props.onClick())
  assert.match(text(screen),/Revisão necessária/)
  assert.doesNotMatch(text(screen),/Conferência registrada com sucesso|Descartar preenchimento/)
})

test('refresh can reconcile an uncertain submission without a discard prompt',async t=>{
  let reads=0
  const {screen}=await mount(t,async(path,options)=>{
    if(options.method==='POST')throw new TypeError('Resposta perdida')
    reads++;return response(summary())
  })
  await act(async()=>{
    amounts(screen)[0].props.onChange({target:{value:'200,00'}})
    amounts(screen)[1].props.onChange({target:{value:'50,00'}})
  })
  await act(async()=>{for(const field of verify(screen))field.props.onChange({target:{checked:true}})})
  await act(async()=>buttonNamed(screen.root,'Concluir conferência').props.onClick())
  await act(async()=>buttonNamed(screen.root,'Registrar conferência').props.onClick())
  assert.match(text(screen),/A resposta não foi confirmada/)
  await act(async()=>buttonNamed(screen.root,'Atualizar').props.onClick())
  assert.equal(reads,2)
  assert.doesNotMatch(text(screen),/Descartar preenchimento/)
})

test('receipt drawer shows pertinent dates, hides technical IDs and pages on demand',async t=>{
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
  assert.equal(calls.length,1)
  await act(async()=>firstDetail(screen).props.onClick({currentTarget:{focus(){}}}))
  const receiptCards=()=>screen.root.findAll(n=>n.props.className==='day-conference-receipt')
  assert.equal(receiptCards().length,2)
  assert.match(nodeText(receiptCards()[0]),/PIX recebido/)
  assert.match(nodeText(receiptCards()[0]),/574,00/)
  assert.match(nodeText(receiptCards()[0]),/Sem pedido diretamente vinculado/)
  assert.match(nodeText(receiptCards()[1]),/Pedido #331/)
  assert.match(text(screen),/Exibindo 2 de 3/)
  assert.doesNotMatch(text(screen),/movement-pix-a|receipt-pix-a|Dados técnicos|UUID/)
  assert.equal(calls.length,2,'rendering dates requires no extra request')
  await act(async()=>buttonNamed(screen.root,'Carregar mais').props.onClick())
  assert.equal(receiptCards().length,3)
  assert.match(nodeText(receiptCards()[2]),/Estorno/)
  assert.match(text(screen),/Exibindo 3 de 3/)
  assert.doesNotMatch(text(screen),/receipt-refund|movement-refund/)
  assert.equal(calls.length,3,'only explicit pagination loads more')
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

test('shared PIX is progressive: receipt, orders, order detail, back, without duplicate D1 reads',async t=>{
  const calls=[]
  const {screen}=await mount(t,async path=>{
    calls.push(path)
    if(path.includes('/orders/by-ids'))return response({orders:[{
      id:'o-1',orderNumber:37,client:'Maria',type:'Retirada',status:'Finalizado',
      orderDate:'2026-10-15',total:120,items:[{id:'item-a',name:'Pizza',quantity:2}],
    }]})
    if(path.includes('/entries?'))return response({nextPage:null,entries:[{
      id:'movement-1',receiptId:'shared-1',date:'2026-10-15',createdAt:'2026-10-15T16:30:00Z',
      amountCents:20000,source:'order-payment',type:'entrada',linkedOrders:[
        {id:'o-1',number:37,client:'Maria'},{id:'o-2',number:38,client:'Maria'},
      ],
    }]})
    return response(summary())
  },{canViewOrders:true})
  await act(async()=>firstDetail(screen).props.onClick({currentTarget:{focus(){}}}))
  assert.match(text(screen),/Maria/)
  assert.match(text(screen),/2 pedidos vinculados/)
  assert.equal((text(screen).match(/Maria/g)||[]).length,1,'common customer should not repeat across a receipt')
  assert.doesNotMatch(text(screen),/Pedido #37|Pedido #38|shared-1|movement-1/)
  assert.equal(calls.length,2)
  await act(async()=>buttonNamed(screen.root,'Ver 2 pedidos').props.onClick())
  assert.match(text(screen),/Pedidos do recebimento/)
  assert.match(text(screen),/Pedido #37/)
  assert.match(text(screen),/Pedido #38/)
  assert.doesNotMatch(text(screen),/PIX recebido|Dados técnicos|shared-1/)
  assert.equal(calls.length,2,'order list uses existing page data')
  await act(async()=>buttonNamed(screen.root,'Pedido #37').props.onClick())
  assert.match(text(screen),/Pizza/)
  assert.match(text(screen),/Total atual do pedido/)
  assert.match(text(screen),/Dados acima são os atuais|dados acima são os atuais/i)
  assert.match(text(screen),/Data do recebimento/)
  assert.match(text(screen),/Registrado no sistema em/)
  assert.doesNotMatch(text(screen),/Pedido #38|movement-1|shared-1/)
  assert.equal(calls.filter(path=>path.includes('/orders/by-ids')).length,1)
  await act(async()=>buttonNamed(screen.root,'Voltar aos pedidos').props.onClick())
  assert.match(text(screen),/Pedido #38/)
  assert.doesNotMatch(text(screen),/Pizza/)
  await act(async()=>buttonNamed(screen.root,'Voltar aos recebimentos').props.onClick())
  assert.match(text(screen),/Ver 2 pedidos/)
  assert.equal(calls.length,3,'back navigation must not reload D1')
})

test('single-order receipt opens detail directly and protects order data without grant',async t=>{
  const calls=[]
  const fetchImpl=async path=>{
    calls.push(path)
    if(path.includes('/orders/by-ids'))return response({orders:[{
      id:'order-a',orderNumber:331,client:'Luana',type:'Mesa',status:'Finalizado',
      orderDate:'2026-10-15',total:30,items:[{id:'food',quantity:1,name:'Pizza'}],
    }]})
    if(path.includes('/entries?'))return response({entries:[{
      id:'movement-private',receiptId:'private-receipt',date:'2026-10-15',
      createdAt:'2026-10-15T15:30:00Z',type:'entrada',source:'order-payment',amountCents:3000,
      linkedOrders:[{id:'order-a',number:331,client:'Luana'}],
    }],nextPage:null})
    return response(summary())
  }
  const {screen}=await mount(t,fetchImpl,{canViewOrders:true})
  await act(async()=>firstDetail(screen).props.onClick({currentTarget:{focus(){}}}))
  assert.match(text(screen),/Luana/)
  assert.match(text(screen),/Pedido #331/)
  await act(async()=>buttonNamed(screen.root,'Ver pedido').props.onClick())
  assert.match(text(screen),/Itens do pedido/)
  assert.doesNotMatch(text(screen),/private-receipt|movement-private/)
  await act(async()=>buttonNamed(screen.root,'Voltar aos recebimentos').props.onClick())
  assert.match(text(screen),/Luana/)
  assert.equal(calls.filter(path=>path.includes('/orders/by-ids')).length,1)

})

test('receipt list never exposes customer or drill action when order-read grant is absent',async t=>{
  const calls=[]
  const {screen}=await mount(t,async path=>{
    calls.push(path)
    if(path.includes('/entries?'))return response({entries:[{
      id:'movement-private',receiptId:'private-receipt',date:'2026-10-15',
      createdAt:'2026-10-15T15:30:00Z',type:'entrada',source:'order-payment',amountCents:3000,
      linkedOrders:[{id:'order-a',number:331,client:'Luana'}],
    }],nextPage:null})
    return response(summary())
  },{canViewOrders:false})
  await act(async()=>firstDetail(screen).props.onClick({currentTarget:{focus(){}}}))
  assert.doesNotMatch(text(screen),/Luana|Ver pedido|Ver 1 pedido|private-receipt|movement-private/)
  assert.equal(screen.root.findAllByType('button').filter(n=>nodeText(n)==='Ver pedido').length,0)
  assert.equal(calls.length,2,'unauthorized users cannot request order details')
})

test('revision history presents newest snapshot first with real variation and preserves older records',async t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-10-23T23:10:00Z')})
  const calls=[]
  const current=summary('2026-10-23')
  const sourceVersion=current.sourceVersion
  const oldVersion='b'.repeat(64)
  const line=(method,cents,net)=>({
    method,grossCents:net,refundCents:0,netCents:net,checkedCents:cents,
    differenceCents:cents-net,
  })
  const revisions=[
    {id:'revision-two',date:'2026-10-23',revision:2,sourceVersion,status:'conferida',
      createdAt:'2026-10-23T23:03:37Z',actorName:'Victor',
      note:'Caixa e extratos conferidos.',
      lines:[line('Dinheiro',29400,29400),line('Pix',22000,22000)]},
    {id:'revision-one',date:'2026-10-23',revision:1,sourceVersion:oldVersion,status:'conferida',
      createdAt:'2026-10-23T23:01:41Z',actorName:'Victor',
      note:'Nota preservada da revisão 1.',
      lines:[line('Dinheiro',21700,21700),line('Pix',22000,22000)]},
  ]
  current.latest=revisions[0]
  const {screen}=await mount(t,async path=>{
    calls.push(path)
    return response(path.includes('/history?')?{history:revisions}:current)
  })
  assert.match(text(screen),/Mais recente/)
  assert.equal(calls.length,1,'preview uses summary snapshot; list stays lazy')
  await act(async()=>buttonNamed(screen.root,'Ver revisões').props.onClick({currentTarget:{focus(){}}}))
  const cards=()=>screen.root.findAll(n=>typeof n.props?.className==='string'&&
    n.props.className.startsWith('day-conference-revision')&&n.type==='article')
  assert.equal(cards().length,2)
  assert.match(text(screen),/2 revisões encontradas/)
  assert.match(nodeText(cards()[0]),/514,00/)
  assert.match(nodeText(cards()[0]),/Variação do valor conferido desde a revisão anterior/)
  assert.match(nodeText(cards()[0]),/\+\s*R\$\s*77,00/)
  assert.match(nodeText(cards()[0]),/Dinheiro/)
  assert.match(nodeText(cards()[0]),/294,00/)
  assert.match(nodeText(cards()[0]),/Caixa e extratos conferidos/)
  assert.match(nodeText(cards()[1]),/437,00/)
  assert.match(nodeText(cards()[1]),/Registro histórico/)
  assert.doesNotMatch(text(screen),/Nota preservada da revisão 1\./,
    'older revision details should be collapsed by default')
  assert.equal(calls.length,2,'open history issues one bounded request')
  await act(async()=>buttonNamed(screen.root,'Ver valores desta revisão').props.onClick())
  assert.match(text(screen),/Nota preservada da revisão 1\./)
  assert.doesNotMatch(text(screen),/Caixa e extratos conferidos\./,
    'only selected revision expands')
  assert.match(text(screen),/217,00/)
  assert.equal(calls.length,2,'switching revisions never refetches D1')
  await act(async()=>buttonNamed(screen.root,'Recolher histórico').props.onClick())
  assert.equal(cards().length,1,'collapse reverts to summary preview')
  assert.doesNotMatch(text(screen),/Nota preservada da revisão 1\./)
  assert.equal(calls.length,2)
})

test('revision history does not invent totals when no previous revision exists',async t=>{
  const data=summary('2026-10-23')
  data.latest={id:'only-revision',date:'2026-10-23',revision:1,sourceVersion:data.sourceVersion,
    createdAt:'2026-10-23T15:00:00Z',status:'com_ressalva',actorName:'Operador',
    note:'PIX divergente.',lines:[{method:'Pix',grossCents:20000,refundCents:0,netCents:20000,
      checkedCents:19900,differenceCents:-100}]}
  const {screen}=await mount(t,async path=>response(path.includes('/history?')?{history:[data.latest]}:data))
  await act(async()=>buttonNamed(screen.root,'Ver revisões').props.onClick())
  assert.match(text(screen),/Concluída com ressalva/)
  assert.match(text(screen),/PIX divergente\./)
  assert.match(text(screen),/Diferença/)
  assert.match(text(screen),/-R\$\s*1,00/)
  assert.doesNotMatch(text(screen),/Variação do valor conferido desde a revisão anterior/)
})


test('Evolucao mostra progresso e orientacoes recolhiveis sem alterar leituras, calculos ou confirmacao',async t=>{
  const calls=[]
  const data=summary()
  data.methods[0].count=3
  data.methods[1].count=4
  const {screen}=await mount(t,async path=>{calls.push(path);return response(data)})
  assert.match(text(screen),/0 de 2 formas verificadas/)
  const guide=screen.root.findByType('details')
  assert.equal(guide.props.className,'day-conference-help')
  assert.match(nodeText(guide),/não do saldo físico da gaveta/)
  assert.equal(guide.props.open,undefined,'orientacao inicia recolhida')
  assert.match(nodeText(firstDetail(screen)),/3 lançamentos/)
  assert.equal(firstDetail(screen).props['aria-label'],'Ver lançamentos de Pix')
  assert.equal(screen.root.findAll(n=>n.props?.className==='day-conference-stat-icon').length,0)
  assert.equal(calls.length,1)
  await act(async()=>amounts(screen)[0].props.onChange({target:{value:'200,00'}}))
  assert.match(text(screen),/0 de 2 formas verificadas/)
  await act(async()=>verify(screen)[0].props.onChange({target:{checked:true}}))
  assert.match(text(screen),/1 de 2 formas verificadas/)
  assert.equal(buttonNamed(screen.root,'Concluir conferência').props.disabled,true)
  assert.equal(calls.length,1,'digitar e confirmar nao disparam consulta extra')
})
