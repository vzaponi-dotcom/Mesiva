import { useContext, useEffect, useRef, useState } from 'react'
import AreaNavigation from '../../../app/navigation/AreaNavigation.jsx'
import { apiRequest } from '../../../infrastructure/api/httpClient.js'
import { ContextApi } from '../../../infrastructure/api/ContextApi.js'
import { getBusinessDate } from '../../../../shared/finance.js'
import PageHeader from '../../../shared/ui/PageHeader.jsx'
import Icon from '../../../shared/ui/Icon.jsx'
import Modal from '../../../shared/ui/Modal.jsx'
import Button from '../../../shared/ui/Button.jsx'
import ConfirmationDialog from '../../../shared/ui/ConfirmationDialog.jsx'
import { buildDayConferenceCsv } from '../application/dayConferenceCsv.js'
import './day-conference.css'

const formatCents = cents => new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(cents/100)
const parseCents = value => {
  const normalized=String(value).trim().replace(',','.')
  if(!/^-?\d+(?:\.\d{1,2})?$/.test(normalized))return null
  const [whole,decimal='']=normalized.replace('-','').split('.')
  const cents=(Number(whole)*100+Number(decimal.padEnd(2,'0')))*(normalized.startsWith('-')?-1:1)
  return Number.isSafeInteger(cents) && Math.abs(cents) <= 999999999999 ? cents : null
}
const formatTimestamp = value => new Date(value).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})
const statusLabel = status => status==='com_ressalva'?'Concluída com ressalva':'Conferida'
const today = () => getBusinessDate(new Date())
const readableDate = value => new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(value + 'T12:00:00Z'))
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
    amounts: Object.fromEntries(lines.map(line => [line.method,(line.checkedCents/100).toFixed(2).replace('.',',')])),
    verified: Object.fromEntries(lines.map(line => [line.method,true])),
    note: lines.length ? data.latest.note : '',
  }
}

export default function DayConference({ canComplete=false, writesBlocked=false, setRequestKey=()=>{} }){
  const client=useContext(ContextApi)
  const request=client?.request || apiRequest
  const reads=useRef(null)
  const detailGeneration=useRef(0)
  const historyGeneration=useRef(0)
  const submission=useRef(null)
  const submittingRef=useRef(false)
  const exportOperation=useRef(null)
  const detailPanel=useRef(null),detailOpener=useRef(null),historyPanel=useRef(null),historyOpener=useRef(null)
  const [date,setDate]=useState(today)
  const [summary,setSummary]=useState(null)
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')
  const [amounts,setAmounts]=useState({})
  const [verified,setVerified]=useState({})
  const [note,setNote]=useState('')
  const [dialog,setDialog]=useState(false)
  const [submitting,setSubmitting]=useState(false)
  const [detail,setDetail]=useState(null)
  const [detailLoading,setDetailLoading]=useState(false)
  const [history,setHistory]=useState(null)
  const [historyLoading,setHistoryLoading]=useState(false)
  const [uncertain,setUncertain]=useState(false)
  const [success,setSuccess]=useState('')
  const [exporting,setExporting]=useState(false)
  const historyOpen=history!==null
  useEffect(()=>{detailPanel.current?.focus()},[detail?.method])
  useEffect(()=>{if(historyOpen)historyPanel.current?.focus()},[historyOpen])

  useEffect(()=>{
    const controller=new AbortController()
    reads.current=controller
    detailGeneration.current++;historyGeneration.current++
    setLoading(true);setSummary(null);setError('');setAmounts({});setVerified({});setNote('')
    setDetail(null);setHistory(null);setDetailLoading(false);setHistoryLoading(false);setSuccess('');setUncertain(false);setDialog(false)
    submission.current=null;setExporting(false)
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
    detailGeneration.current++;setDetail(null);setDetailLoading(false)
    historyGeneration.current++;setHistory(null);setHistoryLoading(false)
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
  const rows=summary?.methods || []
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

  const openDetail=async (method,opener)=>{
    detailOpener.current=opener
    const generation=++detailGeneration.current,signal=reads.current.signal
    setDetail({method,entries:[],nextPage:1,error:''});setDetailLoading(true)
    try{
      const params=new URLSearchParams({date,method,page:'1',sourceVersion:summary.sourceVersion})
      const result=await request('/api/finance/day-conference/entries?'+params,{signal})
      if(signal.aborted||generation!==detailGeneration.current)return
      setDetail({method,...result,error:''})
    }catch(err){if(!signal.aborted&&generation===detailGeneration.current)setDetail({method,entries:[],nextPage:null,error:err.message})}
    finally{if(!signal.aborted&&generation===detailGeneration.current)setDetailLoading(false)}
  }
  const moreDetail=async()=>{
    if(!detail?.nextPage||detailLoading)return
    const method=detail.method,page=detail.nextPage,signal=reads.current.signal,generation=detailGeneration.current;setDetailLoading(true)
    try{
      const result=await request('/api/finance/day-conference/entries?'+new URLSearchParams({date,method,page:String(page),sourceVersion:summary.sourceVersion}),{signal})
      if(signal.aborted||generation!==detailGeneration.current)return
      setDetail(current=>current?.method===method?{...current,entries:[...current.entries,...result.entries],nextPage:result.nextPage,error:''}:current)
    }catch(err){if(!signal.aborted&&generation===detailGeneration.current)setDetail(current=>current?{...current,error:err.message}:current)}
    finally{if(!signal.aborted&&generation===detailGeneration.current)setDetailLoading(false)}
  }
  const openHistory=async event=>{
    historyOpener.current=event?.currentTarget
    const generation=++historyGeneration.current,signal=reads.current.signal
    setHistoryLoading(true);setHistory([])
    try{
      const result=await request('/api/finance/day-conference/history?'+new URLSearchParams({date}),{signal})
      if(signal.aborted||generation!==historyGeneration.current)return
      setHistory(result.history)
    }catch(err){if(!signal.aborted&&generation===historyGeneration.current)setError(err.message)}
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
      <PageHeader eyebrow="Financeiro" title="Conferência do dia"
        description="Compare cada forma de recebimento registrada no Mesiva com seus comprovantes e controles externos."
        actions={<div className="day-conference-actions">
          <label className="day-conference-date"><Icon name="calendar" size={17}/><span>Data</span>
            <input type="date" aria-label="Data do recebimento" value={date} max={today()} disabled={submitting} onChange={event=>setDate(event.target.value)}/>
          </label>
          <Button variant="secondary" icon="download" onClick={exportCsv}
            disabled={!summary||!summary.methods.length||loading||exporting||submitting}>{exporting?'Exportando…':'CSV de lançamentos'}</Button>
          <Button variant="secondary" icon="history" onClick={reload} disabled={loading||submitting}>Atualizar</Button>
        </div>}/>
      {error&&<p role="alert" className="day-conference-error">{error}</p>}
      {success&&<p role="status" className="day-conference-notice">{success}</p>}
      {uncertain&&<p role="status" className="day-conference-notice">A resposta não foi confirmada. Atualize para verificar o registro ou reenvie a mesma conferência com segurança.</p>}
      {loading?<p role="status">Carregando recebimentos…</p>:summary&&<>
        <section className="day-conference-progress" aria-label="Andamento da conferência">
          <div>
            <div className="day-conference-progress-title">
              <strong>{readableDate(date)}</strong>
              <span className={stale?'day-conference-bad':sameVersion?'day-conference-good':'day-conference-pending'}>
                {stale?'Revisão necessária':sameVersion?statusLabel(latest.status):allComplete?(differences.length?'Com divergências':'Pronta para concluir'):'Conferência em andamento'}
              </span>
            </div>
            <p>{sameVersion?'Conferência registrada para estes recebimentos.':stale?'Os recebimentos mudaram desde a última conferência. Confira novamente.':count+' de '+rows.length+' formas de pagamento verificadas.'}</p>
            {latest&&<small>Revisão {latest.revision} · {latest.actorName||latest.userId||'Usuário legado'} · {formatTimestamp(latest.createdAt)}</small>}
          </div>
          <div className="day-conference-progress-track" role="progressbar" aria-label="Formas verificadas" aria-valuemin={0} aria-valuemax={rows.length} aria-valuenow={sameVersion?rows.length:count}>
            <span style={{width:(rows.length?(sameVersion?100:count/rows.length*100):0)+'%'}}/>
          </div>
        </section>
        <section className="day-conference-stats" aria-label="Resumo da conferência">
          <div className="surface-card day-conference-stat">
            <div className="day-conference-stat-title"><small>Registrado no Mesiva</small><span className="day-conference-stat-icon"><Icon name="receipt" size={18}/></span></div>
            <strong>{formatCents(totalNet)}</strong><p>Recebimentos líquidos da data</p>
          </div>
          <div className="surface-card day-conference-stat">
            <div className="day-conference-stat-title"><small>Valor informado</small><span className="day-conference-stat-icon is-success"><Icon name="check" size={18}/></span></div>
            <strong>{totalEntered===null?'—':formatCents(totalEntered)}</strong>
            <p>{totalEntered===null?'Campos em branco não entram na soma':'Conferido no banco, caixa e maquininhas'}</p>
          </div>
          <div className="surface-card day-conference-stat">
            <div className="day-conference-stat-title"><small>Diferença</small><span className={'day-conference-stat-icon'+(totalDifference!==null&&totalDifference!==0?' is-danger':'')}><Icon name="info" size={18}/></span></div>
            <strong className={totalDifference!==null&&totalDifference!==0?'day-conference-text-danger':''}>{totalDifference===null?'—':formatCents(totalDifference)}</strong>
            <p>{totalDifference===null?'Informe os valores de todas as formas':differences.length?'Verifique diferenças individuais':'Valores totais informados'}</p>
          </div>
        </section>
        {totalEditRefund>0&&<p className="day-conference-note">A Visão geral não deduz devoluções após edição ({formatCents(totalEditRefund)}), já descontadas do líquido desta conferência. Bruto e líquido usam conceitos distintos.</p>}
        {summary.integrityIssues>0&&<p role="alert" className="day-conference-error">Há divergências entre movimentos, recibos e alocações. A conclusão está bloqueada; solicite revisão financeira. Nenhum pagamento foi alterado.</p>}
        {rows.some(row=>row.method==='Não informado')&&<p className="day-conference-notice">Há lançamentos sem forma identificável. Confira-os separadamente; estornos sem evidência não são atribuídos à forma original.</p>}
        <article className="surface-card day-conference-main">
          <div className="day-conference-panel-heading">
            <div><h2>Conferir por forma de pagamento</h2><p>Informe o valor encontrado externamente. Clique em “Ver lançamentos” para auditar cada total.</p></div>
            <span>{rows.reduce((sum,row)=>sum+row.count,0)} lançamentos</span>
          </div>
          <div className="day-conference-hint"><Icon name="info" size={18}/><p><strong>Conferência de recebimentos, não de gaveta.</strong> Dinheiro: compare as entradas registradas, não o saldo físico. Pix: verifique o extrato. Cartões: confira as transações da operadora, não os repasses futuros. <strong>Bruto {formatCents(totalGross)} · Estornos {formatCents(totalRefund)}.</strong></p></div>
          {rows.length?<div className="day-conference-table" aria-label="Conferência por forma de pagamento">
            <div className="day-conference-table-head" aria-hidden="true"><span>Forma de pagamento</span><span>Mesiva</span><span>Conferido</span><span>Diferença</span><span>Verificação</span><span/></div>
            {rows.map((row,index)=>{
              const parsed=parseCents(amounts[row.method]??'')
              const isChecked=Boolean(verified[row.method])&&parsed!==null
              const diff=parsed!==null?parsed-row.netCents:null
              const presentation=methodPresentation(row.method)
              const state=sameVersion?'Encerrado':isChecked?(diff===0?'Conferido':'Divergente'):parsed===null?'Aguardando valor':'Não conferido'
              return <div className="day-conference-table-row" key={row.method}>
                <div className="day-conference-method-name">
                  <span className="day-conference-method-icon"><Icon name={presentation.icon} size={19}/></span>
                  <div><strong>{row.method}</strong><small>{presentation.description}</small></div>
                </div>
                <div className="day-conference-cell day-conference-cell-mesiva">
                  <small className="day-conference-value-label">Mesiva</small>
                  <strong>{formatCents(row.netCents)}</strong>
                  {(row.refundCents>0||row.grossCents!==row.netCents)&&<small>Bruto {formatCents(row.grossCents)} · Estornos {formatCents(row.refundCents)}</small>}
                </div>
                <div className="day-conference-cell day-conference-cell-input">
                  <label htmlFor={'day-conference-amount-'+index} className="day-conference-value-label">Conferido</label>
                  <input id={'day-conference-amount-'+index} inputMode="decimal" autoComplete="off" placeholder="0,00"
                    aria-label={'Valor conferido de '+row.method} value={amounts[row.method]??''} disabled={fieldsDisabled}
                    aria-invalid={Boolean(amounts[row.method])&&parsed===null}
                    aria-describedby={Boolean(amounts[row.method])&&parsed===null?'conference-amount-error-'+index:undefined}
                    onChange={event=>{setAmounts(prev=>({...prev,[row.method]:event.target.value}));setVerified(prev=>({...prev,[row.method]:false}))}}/>
                  {Boolean(amounts[row.method])&&parsed===null&&<small id={'conference-amount-error-'+index}>Informe um valor com até duas casas (ex.: -10,50).</small>}
                </div>
                <div className="day-conference-cell day-conference-cell-diff">
                  <small className="day-conference-value-label">Diferença</small>
                  <strong className={diff===null?'day-conference-muted':diff===0?'day-conference-positive':'day-conference-text-danger'}>{diff===null?'—':formatCents(diff)}</strong>
                </div>
                <div className="day-conference-cell day-conference-cell-status">
                  <small className="day-conference-value-label">Verificação</small>
                  <span className={sameVersion?'day-conference-closed':isChecked?(diff===0?'day-conference-good':'day-conference-bad'):'day-conference-pending'}>{state}</span>
                </div>
                <div className="day-conference-cell day-conference-row-actions">
                  <button type="button" className="day-conference-detail" onClick={event=>openDetail(row.method,event.currentTarget)}>
                    <Icon name="eye" size={16}/>Ver lançamentos
                  </button>
                  <label className="day-conference-check"><input type="checkbox" aria-label={'Conferir '+row.method} checked={isChecked}
                    disabled={fieldsDisabled||parsed===null} onChange={event=>setVerified(prev=>({...prev,[row.method]:event.target.checked}))}/>
                    <span>{isChecked?'Revisar':'Conferir'}</span>
                  </label>
                </div>
              </div>
            })}
          </div>:<div className="day-conference-empty">Nenhum recebimento registrado nesta data. Não há valores para conferir.</div>}
          {rows.length>0&&<div className="day-conference-footer">
            <div className="day-conference-notes">
              <label htmlFor="day-conference-notes">Observações da conferência</label>
              <textarea id="day-conference-notes" rows={3} value={note} maxLength={1000}
                placeholder="Explique diferenças, lançamentos não encontrados ou providências necessárias…"
                onChange={event=>setNote(event.target.value)} disabled={fieldsDisabled}/>
              <small>Se qualquer forma divergir, mesmo que a soma geral seja igual, informe uma justificativa.</small>
            </div>
            <div className="day-conference-footer-total">
              <small>Diferença total informada</small>
              <strong className={totalDifference!==null&&differences.length?'day-conference-text-danger':''}>{totalDifference===null?'—':formatCents(totalDifference)}</strong>
              {differences.length>0&&totalDifference===0&&<small>Existem diferenças que se compensam entre formas.</small>}
              {!sameVersion&&<Button icon="check" onClick={()=>setDialog(true)} disabled={!canSubmit}>Concluir conferência</Button>}
              {!canComplete&&<small>Seu perfil pode consultar, mas não concluir conferências.</small>}
            </div>
          </div>}
        </article>
        <section ref={historyPanel} tabIndex={-1} className="surface-card day-conference-history" aria-label="Histórico de conferências">
          <div className="day-conference-panel-heading">
            <div><h2>Histórico de conferências</h2><p>Registros concluídos para a data selecionada, com responsável, valores e ressalvas.</p></div>
            {history===null?<Button variant="secondary" onClick={openHistory} disabled={historyLoading}>Ver revisões</Button>
              :<Button variant="secondary" onClick={()=>{historyGeneration.current++;setHistory(null);setHistoryLoading(false);historyOpener.current?.focus()}}>Recolher</Button>}
          </div>
          {history===null?latest?<div className="day-conference-entry">
            <div><strong>{readableDate(date)} · {statusLabel(latest.status)}</strong>
              <small>Revisão {latest.revision} · {latest.actorName||latest.userId||'Usuário legado'} · {formatTimestamp(latest.createdAt)}</small>
              {stale&&<small>Revisão necessária: os recebimentos foram alterados.</small>}
              {latest.note&&<small>{latest.note}</small>}</div>
            <strong>{formatCents(latest.lines.reduce((sum,line)=>sum+line.checkedCents,0))}</strong>
          </div>:<p className="day-conference-history-empty">Nenhuma conferência concluída nesta data.</p>:
          <>
            <p className="day-conference-note">Até 30 revisões da data selecionada. Altere a data no topo para pesquisar outro dia.</p>
            {historyLoading?<p>Carregando histórico…</p>:history.length?history.map(item=><div className="day-conference-entry" key={item.id}>
              <div><strong>{readableDate(item.date)} · {statusLabel(item.status)}</strong>
                <small>Revisão {item.revision} · {formatTimestamp(item.createdAt)} · {item.actorName||item.userId||'Usuário legado'}</small>
                {summary?.sourceVersion&&item.date===date&&item.sourceVersion!==summary.sourceVersion&&<small>Desatualizada em relação aos recebimentos desta data.</small>}
                {item.note&&<small>{item.note}</small>}
                <details><summary>Valores desta revisão</summary>{item.lines.map(line=><p key={line.method}>{line.method}: bruto {formatCents(line.grossCents)} · estornos {formatCents(line.refundCents)} · líquido {formatCents(line.netCents)} · conferido {formatCents(line.checkedCents)} · diferença {formatCents(line.differenceCents)}</p>)}</details>
              </div><strong>{formatCents(item.lines.reduce((sum,line)=>sum+line.checkedCents,0))}</strong>
            </div>):<p>Não há conferências anteriores.</p>}
          </>}
        </section>
      </>}
      {detail&&<Modal title={'Recebimentos · '+detail.method} onClose={()=>{detailGeneration.current++;setDetail(null);setDetailLoading(false);detailOpener.current?.focus()}}
          className="day-conference-drawer" backdropClassName="day-conference-drawer-backdrop">
        <div ref={detailPanel} className="day-conference-drawer-content">
          <p className="day-conference-note">Data financeira: {readableDate(date)}. Cada linha mostra apenas a parcela desta forma de pagamento, não o total do pedido.</p>
          <div className="day-conference-drawer-total"><small>Valor líquido registrado</small>
            <strong>{formatCents(rows.find(row=>row.method===detail.method)?.netCents||0)}</strong></div>
          {detail.error&&<p role="alert" className="day-conference-error">{detail.error}</p>}
          {detail.entries.map(entry=><article className="day-conference-receipt" key={entry.id}>
            <div className="day-conference-receipt-heading">
              <div><strong>{entry.orderNumber?'Pedido #'+entry.orderNumber:'Recebimento sem pedido direto'}</strong>
                <small>{entry.source==='order-payment'?'Recebimento':entry.source==='order-edit-refund'?'Devolução após edição':'Estorno'}</small></div>
              <strong className={entry.type==='saida'?'day-conference-text-danger':''}>{entry.type==='saida'?'− ':''}{formatCents(entry.amountCents)}</strong>
            </div>
            <div className="day-conference-receipt-meta">
              <div><small>Data do recebimento</small><strong>{readableDate(entry.date)}</strong></div>
              <div><small>Registrado em</small><strong>{entry.createdAt?formatTimestamp(entry.createdAt):'—'}</strong></div>
              <div><small>Movimento</small><strong>{entry.id}</strong></div>
              <div><small>Recibo</small><strong>{entry.receiptId||'Sem vínculo legado'}</strong></div>
              {entry.orderId&&<div><small>Pedido ID</small><strong>{entry.orderId}</strong></div>}
            </div>
          </article>)}
          {detailLoading&&<p role="status">Carregando lançamentos…</p>}
          {detail.nextPage&&!detailLoading&&<Button variant="secondary" onClick={moreDetail}>Carregar mais</Button>}
          <p className="day-conference-note">Total {detail.nextPage?'parcial':'carregado'}: {formatCents(detail.entries.reduce((sum,entry)=>sum+(entry.type==='saida'?-entry.amountCents:entry.amountCents),0))}. {detail.nextPage?'Carregue as próximas páginas para conferir tudo.':''}</p>
        </div>
      </Modal>}
    {dialog&&<ConfirmationDialog title="Confirmar conferência"
      message={differences.length?'Existem divergências. A conferência será registrada com ressalva, sem alterar pagamentos.':'Registrar esta conferência? Nenhum pagamento será alterado.'}
      details={<div>{rows.map(row=><p key={row.method}>{row.method}: Mesiva {formatCents(row.netCents)} · Conferido {formatCents(parseCents(amounts[row.method])||0)} · Diferença {formatCents((parseCents(amounts[row.method])||0)-row.netCents)}</p>)}</div>}
      confirmLabel="Registrar conferência" confirmVariant="primary" submitting={submitting}
      onClose={()=>setDialog(false)} onConfirm={finish}/>}
  </>
}
