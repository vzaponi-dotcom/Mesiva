import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import AreaNavigation from '../../../app/navigation/AreaNavigation.jsx'
import { apiRequest } from '../../../infrastructure/api/httpClient.js'
import { ContextApi } from '../../../infrastructure/api/ContextApi.js'
import { getBusinessDate } from '../../../../shared/finance.js'
import { formatSignedBRLCurrencyInput, formatSignedBRLCurrencyValue } from '../../../shared/utils/formFormatting.js'
import PageHeader from '../../../shared/ui/PageHeader.jsx'
import Icon from '../../../shared/ui/Icon.jsx'
import Modal from '../../../shared/ui/Modal.jsx'
import Button from '../../../shared/ui/Button.jsx'
import ConfirmationDialog from '../../../shared/ui/ConfirmationDialog.jsx'
import DayConferenceDiscrepancies from './DayConferenceDiscrepancies.jsx'
import { buildDayConferenceCsv } from '../application/dayConferenceCsv.js'
import './day-conference.css'

const formatCents = cents => new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(cents/100)
const noop=()=>{}
const parseCents = value => {
  const text=String(value??''),digits=text.replace(/\D/g,'')
  if(!digits||digits.length>12)return null
  const cents=Number(digits)*(text.trim().startsWith('-')?-1:1)
  return Number.isSafeInteger(cents)&&Math.abs(cents)<=999999999999?cents:null
}
const maskCents = value => {
  const text=String(value??''),digits=text.replace(/\D/g,'').slice(0,12)
  return formatSignedBRLCurrencyInput((text.trim().startsWith('-')?'-':'')+digits)
}
const formatTimestamp = value => new Date(value).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})
const formatEntryTime = value => value ? new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',hour:'2-digit',minute:'2-digit',
}).format(new Date(value)) : 'Horário não informado'
const entryTitle = (entry, method) => entry.source === 'order-edit-refund'
  ? 'Devolução após edição' : entry.type === 'saida' ? 'Estorno' : method.toLocaleUpperCase('pt-BR') + ' recebido'
const receiptClients = linked => [...new Set(linked.map(order=>order.client?.trim()).filter(Boolean))]
const receiptName = (entry, method, linked) => {
  if(entry.type==='saida')return entryTitle(entry,method)
  const clients=receiptClients(linked)
  return clients.length===1?clients[0]:entryTitle(entry,method)
}
const receiptAssociation = (entry, linked) => linked.length>1
  ? linked.length+' pedidos vinculados'
  : linked.length===1 ? 'Pedido #'+(linked[0].number||'sem número')
    : entry.orderNumber ? 'Pedido #'+entry.orderNumber : 'Sem pedido diretamente vinculado'
const statusLabel = status => status==='com_ressalva'?'Concluída com ressalva':'Conferida'
const today = () => getBusinessDate(new Date())
const readableDate = value => new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(value + 'T12:00:00Z'))
const methodRank = value => {
  const method = String(value).toLocaleLowerCase('pt-BR')
  if (method.includes('pix')) return 0
  if (method.includes('dinheiro') || method.includes('espécie')) return 1
  if (method.includes('débito') || method.includes('debito')) return 2
  if (method.includes('crédito') || method.includes('credito')) return 3
  return 4
}
const methodPresentation = value => {
  const method = String(value).toLocaleLowerCase('pt-BR')
  if (method.includes('pix')) return { icon: 'pix', description: 'Confira no extrato bancário' }
  if (method.includes('dinheiro') || method.includes('espécie')) return { icon: 'cash', description: 'Confira entradas em espécie, sem saldo de gaveta' }
  if (method.includes('débito') || method.includes('debito')) return { icon: 'card', description: 'Confira transações da maquininha' }
  if (method.includes('crédito') || method.includes('credito')) return { icon: 'card', description: 'Confira transações da maquininha' }
  return { icon: 'receipt', description: 'Confira o comprovante da forma registrada' }
}
const completedValues = data => {
  const lines = data?.latest?.sourceVersion === data?.sourceVersion ? data.latest.lines : []
  return {
    amounts: Object.fromEntries(lines.map(line => [line.method,formatSignedBRLCurrencyValue(line.checkedCents/100)])),
    verified: Object.fromEntries(lines.map(line => [line.method,true])),
    note: lines.length ? data.latest.note : '',
  }
}


const checkedTotalCents = revision => (revision?.lines||[]).reduce((sum,line)=>sum+line.checkedCents,0)
const revisionChangeCents = (revision,previous) => previous&&revision.date===previous.date
  ? checkedTotalCents(revision)-checkedTotalCents(previous):null
const formatChangeCents = cents => (cents>0?'+ ':cents<0?'− ':'')+formatCents(Math.abs(cents))

function ConferenceRevisionCard({revision,mostRecent=false,previous=null,sourceVersion=null,expanded=false,onToggle=null}) {
  const total=checkedTotalCents(revision)
  const variation=revisionChangeCents(revision,previous)
  const outdated=Boolean(sourceVersion&&revision.sourceVersion!==sourceVersion)
  return <article className={'day-conference-revision'+(mostRecent?' day-conference-revision-latest':'')}>
    <div className="day-conference-revision-top">
      <div className="day-conference-revision-info">
        <span className={'day-conference-revision-label'+(mostRecent?' day-conference-revision-label-latest':'')}>
          {mostRecent?'Mais recente':'Revisão anterior'}
        </span>
        <strong>Revisão {revision.revision} · {formatEntryTime(revision.createdAt)}</strong>
        <small>{revision.actorName||revision.userId||'Usuário legado'} · {formatTimestamp(revision.createdAt)}</small>
      </div>
      <div className="day-conference-revision-amount">
        <strong>{formatCents(total)}</strong>
        <small>{statusLabel(revision.status)}</small>
      </div>
    </div>
    {outdated&&<p className="day-conference-revision-outdated">
      <Icon name="info" size={14}/> {mostRecent?'Os recebimentos mudaram após esta revisão.':'Registro histórico: os recebimentos mudaram depois.'}
    </p>}
    {revision.note&&<p className="day-conference-revision-note-label">Com observações registradas</p>}
    {variation!==null&&<div className="day-conference-revision-change">
      <span>Variação do valor conferido desde a revisão anterior</span>
      <strong>{variation===0?'Sem alteração':formatChangeCents(variation)}</strong>
    </div>}
    {onToggle&&<button type="button" className="day-conference-revision-toggle"
      onClick={onToggle} aria-expanded={expanded}>
      {expanded?'Ocultar valores':'Ver valores desta revisão'}
      <Icon name={expanded?'arrow-down':'arrow-right'} size={16}/>
    </button>}
    {expanded&&<div className="day-conference-revision-details">
      <h3>Valores registrados nesta revisão</h3>
      <ul className="day-conference-revision-methods">
        {(revision.lines||[]).map(line=><li key={line.method}>
          <strong className="day-conference-revision-method-name">{line.method}</strong>
          <dl className="day-conference-revision-values">
            <div><dt>Conferido</dt><dd>{formatCents(line.checkedCents)}</dd></div>
            <div><dt>Diferença</dt><dd className={line.differenceCents===0?'day-conference-revision-match':'day-conference-revision-mismatch'}>{formatCents(line.differenceCents)}</dd></div>
            <div><dt>Líquido Mesiva</dt><dd>{formatCents(line.netCents)}</dd></div>
            <div><dt>Bruto / estornos</dt><dd>{formatCents(line.grossCents)} / {formatCents(line.refundCents)}</dd></div>
          </dl>
        </li>)}
      </ul>
      {revision.note&&<div className="day-conference-revision-note">
        <strong>Observações registradas</strong><p>{revision.note}</p>
      </div>}
      <small className="day-conference-revision-snapshot-note">Valores preservados conforme a conferência foi concluída. Não são recalculados com recebimentos posteriores.</small>
    </div>}
  </article>
}

export default function DayConference({ canComplete=false, canViewOrders=false, writesBlocked=false, setRequestKey=noop }){
  const client=useContext(ContextApi)
  const request=client?.request || apiRequest
  const reads=useRef(null)
  const detailGeneration=useRef(0)
  const orderGeneration=useRef(0)
  const drawerScrollPositions=useRef({receipts:0,orders:0})
  const historyGeneration=useRef(0)
  const submission=useRef(null)
  const submittingRef=useRef(false)
  const exportOperation=useRef(null)
  const detailPanel=useRef(null),detailOpener=useRef(null),historyPanel=useRef(null),historyOpener=useRef(null)
  const [date,setDate]=useState(today)
  const [tab,setTab]=useState('conference'),[discrepancyBusy,setDiscrepancyBusy]=useState(false)
  const discrepancyLock=useRef(false)
  const onDiscrepancyBusy=useCallback(value=>{
    setDiscrepancyBusy(value)
    if(value){discrepancyLock.current=true;setRequestKey('day-conference:discrepancy')}
    else if(discrepancyLock.current){
      discrepancyLock.current=false
      setRequestKey(current=>current==='day-conference:discrepancy'?null:current)
    }
  },[setRequestKey])
  const [summary,setSummary]=useState(null)
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')
  const [amounts,setAmounts]=useState({})
  const [verified,setVerified]=useState({})
  const [note,setNote]=useState('')
  const [dialog,setDialog]=useState(false)
  const [discardChange,setDiscardChange]=useState(null)
  const [submitting,setSubmitting]=useState(false)
  const [detail,setDetail]=useState(null)
  const [detailLoading,setDetailLoading]=useState(false)
  const [detailView,setDetailView]=useState({level:'receipts',entryId:null,orderId:null,previous:'receipts'})
  const [orderPreview,setOrderPreview]=useState(null)
  const [history,setHistory]=useState(null)
  const [historyLoading,setHistoryLoading]=useState(false)
  const [expandedHistoryId,setExpandedHistoryId]=useState(null)
  const [historyError,setHistoryError]=useState('')
  const [uncertain,setUncertain]=useState(false)
  const [success,setSuccess]=useState('')
  const [exporting,setExporting]=useState(false)
  const historyOpen=history!==null
  useEffect(()=>{
    if(!detail)return
    const scroller=detailPanel.current?.closest?.('.modal-body')
    if(scroller)scroller.scrollTop=drawerScrollPositions.current[detailView.level]??0
    detailPanel.current?.querySelector?.('.day-conference-navigation-title')?.focus?.({preventScroll:true})
  },[detailView,detail?.method])
  useEffect(()=>{if(historyOpen)historyPanel.current?.focus()},[historyOpen])

  useEffect(()=>{
    const controller=new AbortController()
    reads.current=controller
    detailGeneration.current++;orderGeneration.current++;historyGeneration.current++
    setLoading(true);setSummary(null);setError('');setAmounts({});setVerified({});setNote('')
    setDetail(null);setDetailView({level:'receipts',entryId:null,orderId:null,previous:'receipts'});setOrderPreview(null);setHistory(null);setExpandedHistoryId(null);setHistoryError('');setDetailLoading(false);setHistoryLoading(false);setSuccess('');setUncertain(false);setDialog(false)
    submission.current=null;setExporting(false);setDiscardChange(null)
    request('/api/finance/day-conference?date='+encodeURIComponent(date),{signal:controller.signal})
      .then(data=>{
        if(controller.signal.aborted)return
        if(!data||!Array.isArray(data.methods))throw new Error('Resposta inválida. Atualize os recebimentos.')
        const values=completedValues(data)
        setSummary(data);setAmounts(values.amounts);setVerified(values.verified);setNote(values.note)
      })
      .catch(err=>{if(!controller.signal.aborted)setError(err.message)})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false)})
    return ()=>{controller.abort();exportOperation.current?.abort();exportOperation.current=null}
  },[date,request])

  const reload=async()=>{
    exportOperation.current?.abort();exportOperation.current=null;setExporting(false)
    const signal=reads.current.signal
    setLoading(true);setError('');setDialog(false)
    detailGeneration.current++;orderGeneration.current++;setDetail(null);setDetailView({level:'receipts',entryId:null,orderId:null,previous:'receipts'});setOrderPreview(null);setDetailLoading(false)
    historyGeneration.current++;setHistory(null);setExpandedHistoryId(null);setHistoryError('');setHistoryLoading(false)
    try{
      const data=await request('/api/finance/day-conference?date='+encodeURIComponent(date),{signal})
      if(signal.aborted)return
      if(!data||!Array.isArray(data.methods))throw new Error('Resposta inválida. Atualize os recebimentos.')
      const values=completedValues(data)
      setSummary(data);setAmounts(values.amounts);setVerified(values.verified);setNote(values.note)
      setUncertain(false);submission.current=null
    }catch(err){if(!signal.aborted){setSummary(null);setError(err.message)}}
    finally{if(!signal.aborted)setLoading(false)}
  }
  const latest=summary?.latest
  const stale=latest && (latest.sourceVersion!==summary.sourceVersion || summary.integrityIssues>0)
  const sameVersion=latest && !stale
  const rows=(summary?.methods || []).toSorted((a,b)=>methodRank(a.method)-methodRank(b.method)||a.method.localeCompare(b.method,'pt-BR'))
  const count=rows.filter(row=>verified[row.method] && parseCents(amounts[row.method])!==null).length
  const totalGross=rows.reduce((n,row)=>n+row.grossCents,0)
  const totalRefund=rows.reduce((n,row)=>n+row.refundCents,0)
  const totalNet=totalGross-totalRefund
  const allValuesEntered=rows.length>0 && rows.every(row=>parseCents(amounts[row.method]??'')!==null)
  const totalEntered=allValuesEntered?rows.reduce((sum,row)=>sum+parseCents(amounts[row.method]),0):null
  const totalDifference=allValuesEntered?totalEntered-totalNet:null
  const totalEditRefund=rows.reduce((n,row)=>n+(row.editRefundCents || 0),0)
  const allComplete=rows.length>0 && count===rows.length
  const differences=rows.filter(row=>verified[row.method] && parseCents(amounts[row.method])!==null
    && parseCents(amounts[row.method])!==row.netCents)
  const canSubmit=canComplete && allComplete && (!differences.length||Boolean(note.trim()))
    && !sameVersion && !loading && !submitting && !writesBlocked && !summary?.integrityIssues
  const fieldsDisabled=!canComplete||sameVersion||writesBlocked||submitting||uncertain
  const hasDraft=!sameVersion&&(Object.values(amounts).some(Boolean)||Boolean(note.trim()))
  const applyChange=nextDate=>{
    if(nextDate!==undefined){setDate(nextDate);return}
    setSuccess('')
    return reload()
  }
  const requestChange=nextDate=>{
    if(nextDate===date)return
    // Atualizar reconcilia um envio sem resposta, sem abandonar a tentativa.
    if(hasDraft&&(nextDate!==undefined||!uncertain)){
      setDiscardChange({date:nextDate});return
    }
    return applyChange(nextDate)
  }

  const exportCsv=async()=>{
    if(exportOperation.current||!summary||loading)return
    const operation=new AbortController();exportOperation.current=operation
    setExporting(true);setError('')
    try{
      const csv=await buildDayConferenceCsv({request,summary,signal:operation.signal})
      if(operation.signal.aborted)return
      const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}))
      try{
        const anchor=document.createElement('a');anchor.href=url
        anchor.download='mesiva-recebimentos-'+date+'.csv';anchor.click()
        setSuccess('CSV completo da data selecionada exportado.')
      }finally{URL.revokeObjectURL(url)}
    }catch(err){if(!operation.signal.aborted)setError(err.message)}
    finally{if(exportOperation.current===operation){exportOperation.current=null;setExporting(false)}}
  }

  const openDetail=async (method,opener,review=null)=>{
    detailOpener.current=opener;orderGeneration.current++;setOrderPreview(null)
    drawerScrollPositions.current={receipts:0,orders:0}
    setDetailView({level:'receipts',entryId:null,orderId:null,previous:'receipts'})
    const generation=++detailGeneration.current,signal=reads.current.signal
    const detailDate=review?.date||date
    let detailContext={method,date:detailDate,entries:[],nextPage:null,error:''}
    setDetail(detailContext);setDetailLoading(true)
    try{
      const state=review?await request('/api/finance/day-conference?'+new URLSearchParams({date:detailDate}),{signal}):summary
      if(signal.aborted||generation!==detailGeneration.current)return
      if(!state?.sourceVersion||!Array.isArray(state.methods))throw new Error('Recebimentos indisponíveis. Atualize e tente novamente.')
      const row=state.methods.find(item=>item.method===method)
      detailContext={...detailContext,sourceVersion:state.sourceVersion,netCents:row?.netCents||0,count:row?.count||0}
      const params=new URLSearchParams({date:detailDate,method,page:'1',sourceVersion:state.sourceVersion})
      const result=await request('/api/finance/day-conference/entries?'+params,{signal})
      if(signal.aborted||generation!==detailGeneration.current)return
      setDetail({...detailContext,...result,error:''})
    }catch(err){if(!signal.aborted&&generation===detailGeneration.current)setDetail({...detailContext,error:err.message})}
    finally{if(!signal.aborted&&generation===detailGeneration.current)setDetailLoading(false)}
  }
  const rememberDrawerScroll=level=>{
    const scroller=detailPanel.current?.closest?.('.modal-body')
    if(scroller&&level!=='order')drawerScrollPositions.current[level]=scroller.scrollTop
  }
  const viewReceiptOrders=entry=>{
    rememberDrawerScroll('receipts')
    drawerScrollPositions.current.orders=0
    setDetailView({level:'orders',entryId:entry.id,orderId:null,previous:'receipts'})
  }
  const backDrawer=()=>{
    orderGeneration.current++
    if(detailView.level==='order'){
      setDetailView({level:detailView.previous,entryId:detailView.entryId,orderId:null,previous:'receipts'})
    }else if(detailView.level==='orders'){
      rememberDrawerScroll('orders')
      setDetailView({level:'receipts',entryId:null,orderId:null,previous:'receipts'})
    }
  }
  const openOrderPreview=async (linked,entry)=>{
    if(!canViewOrders)return
    const previous=detailView.level==='orders'?'orders':'receipts'
    rememberDrawerScroll(previous)
    setDetailView({level:'order',entryId:entry.id,orderId:linked.id,previous})
    if(orderPreview?.id===linked.id&&orderPreview?.order&&!orderPreview.error)return
    const generation=++orderGeneration.current,detailVersion=detailGeneration.current,signal=reads.current.signal
    setOrderPreview({id:linked.id,loading:true})
    try{
      const result=await request('/api/orders/by-ids?ids='+encodeURIComponent(JSON.stringify([linked.id])),{signal})
      if(signal.aborted||generation!==orderGeneration.current||detailVersion!==detailGeneration.current)return
      const order=result?.orders?.find(order=>order.id===linked.id)
      setOrderPreview({id:linked.id,loading:false,order:order||null,error:order?'':'Pedido indisponível.'})
    }catch(err){
      if(!signal.aborted&&generation===orderGeneration.current&&detailVersion===detailGeneration.current){
        setOrderPreview({id:linked.id,loading:false,error:err.message||'Não foi possível consultar o pedido.'})
      }
    }
  }
  const closeDetail=()=>{
    detailGeneration.current++;orderGeneration.current++
    setOrderPreview(null);setDetail(null);setDetailLoading(false)
    setDetailView({level:'receipts',entryId:null,orderId:null,previous:'receipts'})
    detailOpener.current?.focus?.()
  }
  const moreDetail=async()=>{
    if(!detail?.nextPage||detailLoading)return
    const method=detail.method,page=detail.nextPage,signal=reads.current.signal,generation=detailGeneration.current;setDetailLoading(true)
    try{
      const result=await request('/api/finance/day-conference/entries?'+new URLSearchParams({date:detail.date,method,page:String(page),sourceVersion:detail.sourceVersion}),{signal})
      if(signal.aborted||generation!==detailGeneration.current)return
      setDetail(current=>current?.method===method?{...current,entries:[...current.entries,...result.entries],nextPage:result.nextPage,error:''}:current)
    }catch(err){if(!signal.aborted&&generation===detailGeneration.current)setDetail(current=>current?{...current,error:err.message}:current)}
    finally{if(!signal.aborted&&generation===detailGeneration.current)setDetailLoading(false)}
  }
  const openHistory=async event=>{
    historyOpener.current=event?.currentTarget
    const generation=++historyGeneration.current,signal=reads.current.signal
    setHistoryLoading(true);setHistoryError('');setExpandedHistoryId(null);setHistory([])
    try{
      const result=await request('/api/finance/day-conference/history?'+new URLSearchParams({date}),{signal})
      if(signal.aborted||generation!==historyGeneration.current)return
      if(!Array.isArray(result?.history))throw new Error('Histórico indisponível. Tente novamente.')
      setHistory(result.history)
      setExpandedHistoryId(result.history[0]?.id||null)
    }catch(err){if(!signal.aborted&&generation===historyGeneration.current)setHistoryError(err.message||'Não foi possível carregar o histórico.')}
    finally{if(!signal.aborted&&generation===historyGeneration.current)setHistoryLoading(false)}
  }
  const finish=async()=>{
    if(!canSubmit||submittingRef.current)return
    const signal=reads.current.signal
    const payload={date,sourceVersion:summary.sourceVersion,
      lines:rows.map(row=>({method:row.method,checkedCents:parseCents(amounts[row.method]),verified:Boolean(verified[row.method])})),note}
    const fingerprint=JSON.stringify(payload)
    if(submission.current?.fingerprint!==fingerprint)submission.current={fingerprint,requestKey:crypto.randomUUID()}
    submittingRef.current=true
    setSubmitting(true);setError('');setRequestKey('day-conference:'+submission.current.requestKey)
    try{
      const result=await request('/api/finance/day-conference',{
        method:'POST',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({...payload,requestKey:submission.current.requestKey}),
      })
      if(signal.aborted)return
      if(!result?.conference?.id)throw new Error('Resultado desconhecido. Verifique o registro antes de concluir novamente.')
      setSuccess('Conferência registrada com sucesso.');setDialog(false)
      setSummary(current=>({...current,latest:result.conference}))
      await reload()
    }catch(err){
      if(signal.aborted)return
      setDialog(false);setError(err.message)
      setUncertain(!err.status||err.status>=500)
    }
    finally{submittingRef.current=false;if(!signal.aborted){setSubmitting(false);setRequestKey(null)}}
  }

  return <>
    <AreaNavigation area="finance"/>
    <div className="day-conference-page">
      <PageHeader eyebrow="Financeiro / Recebimentos" title="Conferência do dia"
        description="Compare os recebimentos registrados no Mesiva com os valores dos seus comprovantes e controles externos."
        actions={tab==='conference'?<div className="day-conference-actions">
          <label className="day-conference-date"><Icon name="calendar" size={17}/><span className="day-conference-date-label">Data</span>
            <input type="date" aria-label="Data do recebimento" value={date} max={today()} disabled={submitting} onChange={event=>requestChange(event.target.value)}/>
          </label>
          <Button variant="secondary" icon="download" onClick={exportCsv}
            disabled={!summary||!summary.methods.length||loading||exporting||submitting}>{exporting?'Exportando…' :'Exportar CSV'}</Button>
          <Button variant="secondary" icon="history" onClick={()=>requestChange()} disabled={loading||submitting}>Atualizar</Button>
        </div>:null}/>
      <nav className="day-conference-tabs" aria-label="Conferência e divergências">
        {[['conference','Conferência'],['pending','Divergências pendentes'],['resolved','Resolvidas']].map(([value,label])=><button
          key={value} type="button" aria-current={tab===value?'page':undefined} disabled={submitting||discrepancyBusy}
          onClick={()=>setTab(value)}>{label}</button>)}
      </nav>
      <DayConferenceDiscrepancies key={client?.contextId||'legacy'} request={request} visible={tab!=='conference'}
        status={tab==='resolved'?'resolved':'pending'} canResolve={canComplete} writesBlocked={writesBlocked}
        onBusyChange={onDiscrepancyBusy} onReview={(item,opener)=>openDetail(item.method,opener,{date:item.date})}/>
      <div hidden={tab!=='conference'}>
      {error&&<p role="alert" className="day-conference-error">{error}</p>}
      {success&&<p role="status" className="day-conference-notice">{success}</p>}
      {uncertain&&<p role="status" className="day-conference-notice">A resposta não foi confirmada. Atualize para verificar o registro ou reenvie a mesma conferência com segurança.</p>}
      {loading?<p role="status">Carregando recebimentos…</p>:summary&&<>
        {!sameVersion&&<section className="day-conference-progress" aria-label="Andamento da conferência">
          <div>
            <div className="day-conference-progress-title">
              <strong>{readableDate(date)}</strong>
              <span className={stale?'day-conference-bad':'day-conference-pending'}>
                {stale?'Revisão necessária':allComplete?(differences.length?'Com divergências':'Pronta para concluir'):'Conferência em andamento'}
              </span>
            </div>
            <p>{stale?'Os recebimentos mudaram desde a última conferência. Confira novamente.':'Preencha e confirme cada forma de pagamento.'}</p>
            {latest&&<small>Revisão {latest.revision} · {latest.actorName||latest.userId||'Usuário legado'} · {formatTimestamp(latest.createdAt)}</small>}
          </div>
          <div className="day-conference-progress-meter">
            <strong>{count} de {rows.length} formas verificadas</strong>
            <div className="day-conference-progress-track" role="progressbar" aria-label="Formas verificadas" aria-valuemin={0} aria-valuemax={rows.length} aria-valuenow={count}>
              <span style={{width:(rows.length?count/rows.length*100:0)+'%'}}/>
            </div>
          </div>
        </section>}
        {totalEditRefund>0&&<p className="day-conference-note">A Visão geral não deduz devoluções após edição ({formatCents(totalEditRefund)}), já descontadas do líquido desta conferência. Bruto e líquido usam conceitos distintos.</p>}
        {summary.integrityIssues>0&&<p role="alert" className="day-conference-error">Há divergências entre movimentos, recibos e alocações. A conclusão está bloqueada; solicite revisão financeira. Nenhum pagamento foi alterado.</p>}
        {rows.some(row=>row.method==='Não informado')&&<p className="day-conference-notice">Há lançamentos sem forma identificável. Confira-os separadamente; estornos sem evidência não são atribuídos à forma original.</p>}
        <article className={'surface-card day-conference-main'+(sameVersion?' day-conference-completed':'')}>
          <div className="day-conference-panel-heading">
            <div><h2>{sameVersion?'Conferência por forma de pagamento':'Conferir por forma de pagamento'}</h2>
              <p>{sameVersion?'Valores registrados na conferência de '+readableDate(date)+'.':'Informe quanto encontrou externamente e confirme cada forma individualmente.'}</p>
              {sameVersion&&<small className="day-conference-completed-meta">Revisão {latest.revision} · {latest.actorName||latest.userId||'Usuário legado'} · {formatTimestamp(latest.createdAt)}</small>}
            </div>
            <div className="day-conference-panel-status">
              {sameVersion&&<span className={latest.status==='com_ressalva'?'day-conference-pending':'day-conference-good'}>{latest.status==='com_ressalva'?'Concluída com ressalva':'Concluída'}</span>}
              <span>{rows.reduce((sum,row)=>sum+row.count,0)} lançamentos</span>
            </div>
          </div>
          {rows.length?<div className="day-conference-table" aria-label="Conferência por forma de pagamento">
            <div className="day-conference-table-head" aria-hidden="true"><span>Forma de pagamento</span><span>Mesiva</span><span>Conferido</span><span>Diferença</span>{!sameVersion&&<span>Verificação</span>}<span>{sameVersion?'Detalhes':''}</span></div>
            {rows.map((row,index)=>{
              const parsed=parseCents(amounts[row.method]??'')
              const isChecked=Boolean(verified[row.method])&&parsed!==null
              const diff=parsed!==null?parsed-row.netCents:null
              const presentation=methodPresentation(row.method)
              const state=isChecked?(diff===0?'Conferido':'Divergente'):parsed===null?'Aguardando valor':'Não conferido'
              return <div className="day-conference-table-row" key={row.method}>
                <div className="day-conference-method-name">
                  <span className="day-conference-method-icon"><Icon name={presentation.icon} size={19}/></span>
                  <div><strong>{row.method}</strong>{!sameVersion&&<small>{presentation.description}</small>}</div>
                </div>
                <div className="day-conference-cell day-conference-cell-mesiva">
                  <small className="day-conference-value-label">Mesiva</small>
                  <strong>{formatCents(row.netCents)}</strong>
                  {(row.refundCents>0||row.grossCents!==row.netCents)&&<small>Bruto {formatCents(row.grossCents)} · Estornos {formatCents(row.refundCents)}</small>}
                </div>
                <div className="day-conference-cell day-conference-cell-input">
                  {sameVersion?<><small className="day-conference-value-label">Conferido</small><strong>{parsed===null?'—':formatCents(parsed)}</strong></>:<>
                  <label htmlFor={'day-conference-amount-'+index} className="day-conference-value-label">Conferido</label>
                  <input id={'day-conference-amount-'+index} inputMode="decimal" autoComplete="off" placeholder="R$ 0,00"
                    aria-label={'Valor conferido de '+row.method} value={amounts[row.method]??''} disabled={fieldsDisabled}
                    aria-invalid={Boolean(amounts[row.method])&&parsed===null}
                    aria-describedby={Boolean(amounts[row.method])&&parsed===null?'conference-amount-error-'+index:undefined}
                    onChange={event=>{setAmounts(prev=>({...prev,[row.method]:maskCents(event.target.value)}));setVerified(prev=>({...prev,[row.method]:false}))}}/>
                  {Boolean(amounts[row.method])&&parsed===null&&<small id={'conference-amount-error-'+index}>Informe um valor válido (ex.: -R$ 10,50).</small>}
                  </>}
                </div>
                <div className="day-conference-cell day-conference-cell-diff">
                  <small className="day-conference-value-label">Diferença</small>
                  <strong className={diff===null||(sameVersion&&diff===0)?'day-conference-muted':diff===0?'day-conference-positive':'day-conference-text-danger'}>{diff===null?'—':formatCents(diff)}</strong>
                </div>
                {!sameVersion&&<div className="day-conference-cell day-conference-cell-status">
                  <small className="day-conference-value-label">Verificação</small>
                  <span className={isChecked?(diff===0?'day-conference-good':'day-conference-bad'):'day-conference-pending'}>{!isChecked&&<Icon name="clock" size={12}/>} {state}</span>
                </div>}
                <div className="day-conference-cell day-conference-row-actions">
                  <button type="button" className="day-conference-detail" aria-label={'Ver lançamentos de '+row.method} onClick={event=>openDetail(row.method,event.currentTarget)}>
                    <Icon name="eye" size={16}/>{sameVersion?'Ver ':''}{row.count} {row.count===1?'lançamento':'lançamentos'}
                  </button>
                  {!sameVersion&&<label className="day-conference-check"><input type="checkbox" aria-label={'Conferir '+row.method} checked={isChecked}
                    disabled={fieldsDisabled||parsed===null} onChange={event=>setVerified(prev=>({...prev,[row.method]:event.target.checked}))}/>
                    <span>{isChecked?'Revisar':'Conferir'}</span>
                  </label>}
                </div>
              </div>
            })}
          </div>:<div className="day-conference-empty">Nenhum recebimento registrado nesta data. Não há valores para conferir.</div>}
          {rows.length>0&&<>
          <section className="day-conference-totals" aria-label="Totais da conferência">
            <div><small>Total no Mesiva</small><strong>{formatCents(totalNet)}</strong></div>
            <div><small>{sameVersion?'Total conferido':'Valor informado'}</small><strong>{totalEntered===null?'—':formatCents(totalEntered)}</strong></div>
            <div><small>Diferença total</small><strong className={totalDifference!==null&&totalDifference!==0?'day-conference-text-danger':''}>{totalDifference===null?'—':formatCents(totalDifference)}</strong></div>
          </section>
          {totalEntered===null&&<p className="day-conference-note">Preencha todas as formas para calcular o total.</p>}
          {differences.length>0&&totalDifference===0&&<p className="day-conference-note">Existem diferenças que se compensam entre formas. A conferência permanece com ressalva.</p>}
          {sameVersion?<div className="day-conference-recorded-notes"><h3>Observações</h3><p>{note.trim()||'Sem observações.'}</p></div>
            :<div className="day-conference-footer">
            <div className="day-conference-notes">
              <label htmlFor="day-conference-notes">Observações da conferência</label>
              <textarea id="day-conference-notes" rows={3} value={note} maxLength={1000}
                placeholder="Explique diferenças, lançamentos não encontrados ou providências necessárias…"
                onChange={event=>setNote(event.target.value)} disabled={fieldsDisabled}/>
              <small>{differences.length?'Justifique cada divergência, mesmo que a diferença geral seja zero.':'Observações opcionais quando todas as formas coincidem.'}</small>
            </div>
            <div className="day-conference-footer-actions">
              <Button icon="check" onClick={()=>setDialog(true)} disabled={!canSubmit}>Concluir conferência</Button>
              {!canSubmit&&canComplete&&!writesBlocked&&!summary?.integrityIssues&&
                <small role="status">{!allComplete?'Informe e marque como conferidas todas as formas de pagamento.':differences.length&&!note.trim()?'Justifique as divergências antes de concluir.':''}</small>}
              {!canComplete&&<small>Seu perfil pode consultar, mas não concluir conferências.</small>}
            </div>
          </div>}
          </>}
          <details className="day-conference-help">
            <summary><Icon name="info" size={16}/>O que exatamente estou conferindo?<Icon name="arrow-down" size={15}/></summary>
            <p><strong>Esta é a conferência de recebimentos, não do saldo físico da gaveta.</strong> Dinheiro: compare as entradas registradas; Pix: confira o extrato bancário; cartões: compare as transações da operadora, não repasses futuros. O valor Mesiva considera <strong>bruto {formatCents(totalGross)}</strong> e <strong>estornos {formatCents(totalRefund)}</strong> nesta data.</p>
          </details>
        </article>
        <section ref={historyPanel} tabIndex={-1} className="surface-card day-conference-history" aria-label="Histórico de conferências">
          <div className="day-conference-panel-heading day-conference-history-heading">
            <div><h2>Histórico de conferências</h2>
              <p>{readableDate(date)} · Consulte os valores e responsáveis de cada revisão.</p></div>
            {history===null?<Button variant="secondary" onClick={openHistory} disabled={historyLoading}>Ver revisões</Button>
              :<button type="button" className="day-conference-history-collapse" aria-label="Recolher histórico"
                onClick={()=>{historyGeneration.current++;setHistory(null);setExpandedHistoryId(null);setHistoryError('');setHistoryLoading(false);historyOpener.current?.focus?.()}}>
                <Icon name="arrow-up" size={16}/> Recolher histórico
              </button>}
          </div>
          {history===null
            ?latest?<ConferenceRevisionCard revision={latest} mostRecent sourceVersion={summary?.sourceVersion}/>
              :<div className="day-conference-history-empty"><Icon name="calendar" size={23}/>
                <strong>Nenhuma conferência concluída nesta data</strong>
                <span>Quando uma conferência for registrada, o responsável e os valores aparecerão aqui.</span>
              </div>
            :<>
              {!historyLoading&&!historyError&&<p className="day-conference-history-count">
                {history.length} {history.length===1?'revisão encontrada':'revisões encontradas'}
                {history.length===30?' · Limite de 30 revisões por consulta':''}
              </p>}
              {historyLoading?<p role="status" className="day-conference-note">Carregando histórico…</p>
                :historyError?<div role="alert" className="day-conference-error">
                  {historyError} <button type="button" onClick={openHistory}>Tentar novamente</button>
                </div>
                :history.length?<div className="day-conference-revisions">
                  {history.map((item,index)=><ConferenceRevisionCard key={item.id}
                    revision={item} mostRecent={index===0} previous={history[index+1]}
                    sourceVersion={item.date===date?summary?.sourceVersion:null}
                    expanded={expandedHistoryId===item.id}
                    onToggle={()=>setExpandedHistoryId(current=>current===item.id?null:item.id)}/>)}
                </div>
                :<div className="day-conference-history-empty"><Icon name="calendar" size={23}/>
                  <strong>Nenhuma revisão encontrada</strong>
                  <span>Não há conferências registradas para a data selecionada.</span>
                </div>}
            </>}
        </section>
      </>}
      </div>
      {detail&&<Modal
        title={detailView.level==='receipts'?'Recebimentos · '+detail.method:detailView.level==='orders'?'Pedidos do recebimento':'Detalhes do pedido'}
        onClose={closeDetail} className="day-conference-drawer" backdropClassName="day-conference-drawer-backdrop">
        <div ref={detailPanel} className="day-conference-drawer-content">
          {detailView.level==='receipts'&&<>
            <div className="day-conference-drawer-summary">
              <div className="day-conference-drawer-total">
                <div><small>Valor líquido registrado</small><strong>{formatCents(detail.netCents||0)}</strong></div>
                <p>{readableDate(detail.date)} · Confira os valores individuais com seus comprovantes externos.</p>
              </div>
            </div>
            <div className="day-conference-receipt-list-heading">
              <strong className="day-conference-navigation-title" tabIndex={-1}>Lançamentos</strong>
              <small>Exibindo {detail.entries.length} de {detail.count??detail.entries.length}</small>
            </div>
            {detail.error&&<p role="alert" className="day-conference-error">{detail.error}</p>}
            <div className="day-conference-receipt-list">
              {detail.entries.map(entry=>{
                const linked=canViewOrders?(entry.linkedOrders||[]):[]
                const registeredDay=entry.createdAt?getBusinessDate(new Date(entry.createdAt)):null
                return <article className="day-conference-receipt" key={entry.id}>
                  <div className="day-conference-receipt-heading">
                    <div>
                      <strong>{receiptName(entry,detail.method,linked)}</strong>
                      <small><Icon name="clock" size={13}/>{registeredDay&&registeredDay!==entry.date
                        ? 'Registrado em '+formatTimestamp(entry.createdAt)
                        : formatEntryTime(entry.createdAt)} · {receiptAssociation(entry,linked)}</small>
                    </div>
                    <strong className={entry.type==='saida'?'day-conference-text-danger':''}>{entry.type==='saida'?'− ':''}{formatCents(entry.amountCents)}</strong>
                  </div>
                  <div className="day-conference-receipt-foot">
                    <span>{entry.type==='saida'?'Devolução registrada':entryTitle(entry,detail.method)}</span>
                    {linked.length===1&&<button type="button" className="day-conference-drill-button" aria-label="Ver pedido"
                      onClick={()=>openOrderPreview(linked[0],entry)}>Ver pedido <Icon name="arrow-right" size={15}/></button>}
                    {linked.length>1&&<button type="button" className="day-conference-drill-button" aria-label={'Ver '+linked.length+' pedidos'}
                      onClick={()=>viewReceiptOrders(entry)}>Ver {linked.length} pedidos <Icon name="arrow-right" size={15}/></button>}
                  </div>
                </article>
              })}
            </div>
            {detailLoading&&<p role="status">Carregando lançamentos…</p>}
            {detail.nextPage&&!detailLoading&&<Button variant="secondary" onClick={moreDetail}>Carregar mais</Button>}
            {detail.nextPage&&<p className="day-conference-note">Subtotal dos lançamentos exibidos: {formatCents(detail.entries.reduce((sum,entry)=>sum+(entry.type==='saida'?-entry.amountCents:entry.amountCents),0))}. Carregue as próximas páginas para conferir tudo.</p>}
            {!detailLoading&&!detail.entries.length&&!detail.error&&<p className="day-conference-history-empty">Nenhum lançamento encontrado nesta forma de pagamento.</p>}
          </>}
          {detailView.level==='orders'&&(()=>{
            const entry=detail.entries.find(item=>item.id===detailView.entryId)
            if(!entry)return <p role="alert" className="day-conference-error">O recebimento não está mais disponível. Volte à lista de lançamentos.</p>
            const linked=entry.linkedOrders||[],clients=receiptClients(linked)
            return <>
              <button type="button" className="day-conference-back" aria-label="Voltar aos recebimentos" onClick={backDrawer}>
                <Icon name="arrow-left" size={17}/> Voltar aos recebimentos
              </button>
              <h3 className="day-conference-navigation-title" tabIndex={-1}>Pedidos do recebimento</h3>
              <div className="day-conference-drawer-total day-conference-receipt-summary">
                <div><small>Recebido em {detail.method}</small><strong>{formatCents(entry.amountCents)}</strong></div>
                <p>{clients.length===1?clients[0]+' · ':''}{linked.length} pedidos vinculados</p>
                <p>Valor da transação, não o total individual dos pedidos.</p>
              </div>
              <div className="day-conference-relevant-dates">
                <span>Data do recebimento: <strong>{readableDate(entry.date)}</strong></span>
                <span>Registrado no sistema em: <strong>{entry.createdAt?formatTimestamp(entry.createdAt):'Não informado'}</strong></span>
              </div>
              <div className="day-conference-order-list">
                {linked.map(order=><button key={order.id} type="button"
                  className="day-conference-order-list-item" onClick={()=>openOrderPreview(order,entry)}>
                  <span><strong>Pedido #{order.number||'sem número'}</strong>
                    {clients.length!==1&&<small>{order.client||'Cliente não informado'}</small>}</span>
                  <Icon name="arrow-right" size={18}/>
                </button>)}
              </div>
            </>
          })()}
          {detailView.level==='order'&&(()=>{
            const entry=detail.entries.find(item=>item.id===detailView.entryId)
            const linked=entry?.linkedOrders?.find(order=>order.id===detailView.orderId)
            const order=orderPreview?.id===detailView.orderId?orderPreview.order:null
            return <>
              <button type="button" className="day-conference-back" aria-label={detailView.previous==='orders'?'Voltar aos pedidos':'Voltar aos recebimentos'} onClick={backDrawer}>
                <Icon name="arrow-left" size={17}/> {detailView.previous==='orders'?'Voltar aos pedidos':'Voltar aos recebimentos'}
              </button>
              <h3 className="day-conference-navigation-title" tabIndex={-1}>Pedido #{order?.orderNumber||linked?.number||'sem número'}</h3>
              {orderPreview?.loading&&<p role="status">Carregando pedido…</p>}
              {orderPreview?.error&&<p role="alert" className="day-conference-error">{orderPreview.error}</p>}
              {order&&<>
                <div className="day-conference-order-payment-summary">
                  <div><span>Valor do recebimento em {detail.method}</span>
                    <strong>{formatCents(entry?.amountCents||0)}</strong></div>
                  {entry?.linkedOrders?.length>1&&<small>Este recebimento está vinculado a {entry.linkedOrders.length} pedidos; o valor acima não é a parcela individual deste pedido.</small>}
                </div>
                <div className="day-conference-order-overview">
                  <div><span>Cliente</span><strong>{order.client||linked?.client||'Não informado'}</strong></div>
                  <div><span>Situação</span><strong>{order.status||'Não informado'}</strong></div>
                  <div><span>Modalidade</span><strong>{order.type||'Não informada'}</strong></div>
                </div>
                <div className="day-conference-order-items">
                  <h4>Itens do pedido</h4>
                  {(order.items||[]).length
                    ?<ul>{order.items.map((item,index)=><li key={item.id||index}>
                      <span>{item.quantity}× {item.name||item.productName||'Item'}</span>
                    </li>)}</ul>
                    :<p>Sem itens disponíveis neste registro.</p>}
                  <div className="day-conference-order-total"><span>Total atual do pedido</span>
                    <strong>{formatCents(Math.round((order.total||0)*100))}</strong></div>
                </div>
                <div className="day-conference-relevant-dates">
                  {order.orderDate&&<span>Data do pedido: <strong>{readableDate(order.orderDate)}</strong></span>}
                  {entry?.date&&<span>Data do recebimento: <strong>{readableDate(entry.date)}</strong></span>}
                  <span>Registrado no sistema em: <strong>{entry?.createdAt?formatTimestamp(entry.createdAt):'Não informado'}</strong></span>
                </div>
                <p className="day-conference-order-disclaimer">Os dados acima são os atuais do pedido e podem ter sido editados após o pagamento. O valor do recebimento não é atribuído integralmente a cada pedido vinculado.</p>
              </>}
            </>
          })()}
        </div>
      </Modal>}
    {discardChange&&<ConfirmationDialog title="Descartar preenchimento?"
      message="Os valores e as observações ainda não registrados serão descartados. As conferências já concluídas serão preservadas."
      cancelLabel="Continuar conferindo"
      confirmLabel={discardChange.date===undefined?'Descartar e atualizar':'Descartar e trocar data'}
      onClose={()=>setDiscardChange(null)} onConfirm={()=>{
        const nextDate=discardChange.date
        setDiscardChange(null)
        return applyChange(nextDate)
      }}/>}
    {dialog&&<ConfirmationDialog title="Confirmar conferência" className="day-conference-confirmation-dialog"
      details={<section className="day-conference-confirmation" aria-label="Resumo da conferência a registrar">
        <div className="day-conference-confirmation-heading">
          <span className={'day-conference-confirmation-status'+(differences.length?' has-differences':'')}>{differences.length?'Com ressalva':'Sem divergências'}</span>
          <span>{readableDate(date)}</span>
        </div>
        <p className="day-conference-confirmation-intro">{differences.length
          ?`${differences.length} de ${rows.length} formas com divergência. Confira os valores antes de registrar.`
          :'Os valores informados conferem com os recebimentos registrados.'}</p>
        <table className="day-conference-confirmation-table">
          <caption>Comparação dos valores por forma de pagamento</caption>
          <thead><tr><th scope="col">Forma de pagamento</th><th scope="col">Mesiva</th><th scope="col">Conferido</th><th scope="col">Diferença</th></tr></thead>
          <tbody>{rows.map(row=>{
            const checked=parseCents(amounts[row.method])||0,difference=checked-row.netCents
            return <tr key={row.method} className={difference!==0?'has-differences':''}>
              <th scope="row">{row.method}</th>
              <td><span aria-hidden="true">Mesiva</span><strong>{formatCents(row.netCents)}</strong></td>
              <td><span aria-hidden="true">Conferido</span><strong>{formatCents(checked)}</strong></td>
              <td className="day-conference-confirmation-difference"><span aria-hidden="true">Diferença</span><strong>{formatCents(difference)}</strong></td>
            </tr>
          })}</tbody>
          <tfoot><tr><th scope="row">Total</th>
            <td><span aria-hidden="true">Mesiva</span><strong>{formatCents(totalNet)}</strong></td>
            <td><span aria-hidden="true">Conferido</span><strong>{formatCents(totalEntered??0)}</strong></td>
            <td className={totalDifference!==0?'day-conference-confirmation-total-difference':''}><span aria-hidden="true">Diferença</span><strong>{formatCents(totalDifference??0)}</strong></td>
          </tr></tfoot>
        </table>
        {differences.length>0&&totalDifference===0&&<p className="day-conference-confirmation-warning">As diferenças entre formas se compensam no total. A conferência continua com ressalva.</p>}
        {note.trim()&&<div className="day-conference-confirmation-note"><h3>{differences.length?'Justificativa das divergências':'Observações'}</h3><p>{note.trim()}</p></div>}
        <p className="day-conference-confirmation-footnote">{differences.length
          ?'O registro preserva esta conferência e cria as pendências para acompanhamento. Nenhum pagamento será alterado.'
          :'O registro preserva os valores desta conferência. Nenhum pagamento será alterado.'}</p>
      </section>}
      confirmLabel="Registrar conferência" confirmVariant="primary" submitting={submitting}
      onClose={()=>setDialog(false)} onConfirm={finish}/>}
    </div>
  </>
}
