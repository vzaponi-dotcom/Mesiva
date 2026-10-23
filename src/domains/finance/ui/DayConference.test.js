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
  await act(async()=>buttonNamed(screen.root,'Histórico').props.onClick())
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
  await act(async()=>buttonNamed(screen.root,'Exportar CSV do dia').props.onClick())
  const date=screen.root.findAllByType('input').find(n=>n.props.type==='date').props.value
  assert.deepEqual(downloads,['mesiva-recebimentos-'+date+'.csv'])
  assert.equal(calls.filter(path=>path.includes('/entries?')).length,2)
  assert.match(text(screen),/CSV completo/)
  await act(async()=>buttonNamed(screen.root,'Histórico').props.onClick())
  assert.ok(calls.includes('/api/finance/day-conference/history?date='+date))
})
