import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { act } from 'react-test-renderer'
import { workspaceHarness, buttonNamed, nodeText } from '../../../test-support/renderWorkspace.js'

const item={id:'conference:0',date:'2026-10-15',method:'Pix',netCents:7700,checkedCents:6000,differenceCents:-1700,
  status:'pending',revision:1,actorName:'Marina',createdAt:'2026-10-15T15:00:00Z',conferenceNote:'Justificativa original.'}
const solved={...item,status:'resolved',resolutionReason:'conference_error',resolutionNote:'Extrato correto localizado.',
  resolutionReference:'',resolvedActorName:'Gestora',resolvedAt:'2026-10-24T15:00:00Z'}
const text=screen=>[screen.toJSON()].flat().filter(Boolean).map(nodeText).join('')
const submit=screen=>screen.root.findByType('form').props.onSubmit({preventDefault(){}})
async function mount(t,request,extra={}){
  const h=await workspaceHarness(t),{default:Component}=await h.load('/src/domains/finance/ui/DayConferenceDiscrepancies.jsx')
  const props={request,visible:true,status:'pending',canResolve:true,writesBlocked:false,onReview(){},onBusyChange(){},...extra}
  const screen=await h.render(Component,props)
  return {screen,rerender:updates=>act(async()=>screen.update(React.createElement(Component,{...props,...updates})))}
}
async function fill(screen){
  await act(async()=>screen.root.find(n=>typeof n.type==='function'&&n.type.name==='SystemSelect').props.onChange('conference_error'))
  await act(async()=>screen.root.findByType('textarea').props.onChange({target:{value:'Extrato correto localizado.'}}))
  await act(async()=>screen.root.findByProps({type:'checkbox'}).props.onChange({target:{checked:true}}))
}

test('list pagination stays lazy and detail keeps original values with no write on navigation',async t=>{
  const calls=[],reviews=[]
  const {screen}=await mount(t,async(path,options)=>{calls.push([path,options]);return path.includes('conference%3A0')?{discrepancy:item}
    :path.includes('cursor=')?{items:[{...item,id:'old:0',date:'2020-01-01'}],nextCursor:null}:{items:[item],nextCursor:'next'}},
  {onReview:(...args)=>reviews.push(args)})
  assert.equal(calls.length,1)
  await act(async()=>buttonNamed(screen.root,'Carregar mais divergências').props.onClick())
  assert.equal(calls.length,2);assert.match(calls[1][0],/cursor=next/)
  assert.match(text(screen),/01\/01\/2020/)
  await act(async()=>buttonNamed(screen.root,'Analisar').props.onClick({currentTarget:{focus(){}}}))
  assert.match(text(screen),/Justificativa original/);assert.match(text(screen),/77,00/);assert.match(text(screen),/60,00/)
  await act(async()=>buttonNamed(screen.root,'Revisar lançamentos atuais').props.onClick({currentTarget:{}}))
  assert.equal(reviews[0][0].date,item.date)
  assert.equal(calls.length,3);assert.ok(calls.every(([,o])=>!o.method))
})

test('resolution validates input, records solution and cannot submit twice',async t=>{
  const posts=[],busy=[]
  let release
  const {screen}=await mount(t,async(path,options)=>{
    if(options.method==='POST'){posts.push(JSON.parse(options.body));return new Promise(resolve=>{release=()=>resolve({discrepancy:solved})})}
    return path.includes('conference%3A0')?{discrepancy:item}:{items:[item],nextCursor:null}
  },{onBusyChange:value=>busy.push(value)})
  await act(async()=>buttonNamed(screen.root,'Analisar').props.onClick({currentTarget:{}}))
  await act(async()=>submit(screen));assert.equal(posts.length,0)
  await fill(screen)
  let pending
  await act(async()=>{pending=submit(screen);submit(screen)})
  assert.equal(posts.length,1);assert.equal(screen.root.findByType('textarea').props.disabled,true)
  await act(async()=>{release();await pending})
  assert.match(text(screen),/Solução registrada/);assert.match(text(screen),/Justificativa original/)
  assert.match(text(screen),/valores financeiros foram preservados/)
  assert.equal(busy.at(-1),false)
})

test('lost response keeps the exact payload for retry and verification reconciles the winner',async t=>{
  const posts=[]
  let resolved=false
  const {screen}=await mount(t,async(path,options)=>{
    if(options.method==='POST'){posts.push(options.body);resolved=true;throw new TypeError('Falha de rede')}
    return path.includes('conference%3A0')?{discrepancy:resolved?solved:item}:{items:[item],nextCursor:null}
  })
  await act(async()=>buttonNamed(screen.root,'Analisar').props.onClick({currentTarget:{}}))
  await fill(screen)
  await act(async()=>submit(screen));await act(async()=>submit(screen))
  assert.equal(posts.length,2);assert.equal(posts[0],posts[1])
  assert.equal(screen.root.findByType('textarea').props.disabled,true)
  await act(async()=>buttonNamed(screen.root,'Verificar registro').props.onClick())
  assert.match(text(screen),/Gestora/);assert.match(text(screen),/Solução registrada/)
  assert.equal(posts.length,2)
})

test('read-only and disconnected users can inspect but cannot resolve',async t=>{
  const calls=[]
  const {screen,rerender}=await mount(t,async(path,o)=>{calls.push(o);return path.includes('conference%3A0')?{discrepancy:item}:{items:[item],nextCursor:null}}, {canResolve:false})
  await act(async()=>buttonNamed(screen.root,'Analisar').props.onClick({currentTarget:{}}))
  assert.equal(screen.root.findByType('textarea').props.disabled,true)
  await act(async()=>submit(screen));assert.equal(calls.length,2)
  await rerender({canResolve:true,writesBlocked:true})
  await act(async()=>submit(screen));assert.equal(calls.length,2)
  assert.match(text(screen),/gravação está bloqueada/)
})

test('a changed context cancels late private responses',async t=>{
  let late,signal
  const oldRequest=async(path,options)=>path.includes('conference%3A0')?new Promise(resolve=>{late=resolve;signal=options.signal}):{items:[item],nextCursor:null}
  const {screen,rerender}=await mount(t,oldRequest)
  let pending
  await act(async()=>{pending=buttonNamed(screen.root,'Analisar').props.onClick({currentTarget:{}})})
  await rerender({request:async()=>({items:[],nextCursor:null})})
  assert.equal(signal.aborted,true)
  await act(async()=>{late({discrepancy:item});await pending})
  assert.doesNotMatch(text(screen),/Justificativa original|Marina/)
  assert.match(text(screen),/Nenhuma divergência pendente/)
})

test('a pending verification keeps attempted values locked until retry or explicit return',async t=>{
  const {screen}=await mount(t,async(path,o)=>{
    if(o.method==='POST')throw new TypeError('Falha de rede')
    return path.includes('conference%3A0')?{discrepancy:item}:{items:[item],nextCursor:null}
  })
  await act(async()=>buttonNamed(screen.root,'Analisar').props.onClick({currentTarget:{}}))
  await fill(screen)
  await act(async()=>submit(screen))
  await act(async()=>buttonNamed(screen.root,'Verificar registro').props.onClick())
  assert.match(text(screen),/reenviar a mesma solução/)
  assert.equal(screen.root.findByType('textarea').props.disabled,true,'the UI must not show edited values while retrying an earlier payload')
})
