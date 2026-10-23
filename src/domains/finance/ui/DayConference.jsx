import { useContext, useEffect, useRef, useState } from 'react'
import AreaNavigation from '../../../app/navigation/AreaNavigation.jsx'
import { apiRequest } from '../../../infrastructure/api/httpClient.js'
import { ContextApi } from '../../../infrastructure/api/ContextApi.js'
import { getBusinessDate } from '../../../../shared/finance.js'
import PageHeader from '../../../shared/ui/PageHeader.jsx'
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
    <PageHeader eyebrow="Financeiro" title="Conferência do Dia"
      description="Compare os recebimentos registrados no Mesiva com o PIX, o relatório de transações de cartões e as entradas em dinheiro." />
    <div className="day-conference-actions">
      <label>Data do recebimento <input type="date" value={date} max={today()} disabled={submitting} onChange={event=>setDate(event.target.value)} /></label>
      <Button variant="secondary" onClick={reload} disabled={loading||submitting}>Atualizar</Button>
      <Button variant="secondary" onClick={openHistory} disabled={historyLoading}>Histórico</Button>
      <Button variant="secondary" onClick={exportCsv} disabled={!summary||!summary.methods.length||loading||exporting||submitting}>{exporting?'Exportando…':'Exportar CSV do dia'}</Button>
    </div>
    {error&&<p role="alert" className="day-conference-error">{error}</p>}
    {success&&<p role="status" className="day-conference-notice">{success}</p>}
    {uncertain&&<p role="status" className="day-conference-notice">A resposta não foi confirmada. Atualize para verificar o registro ou reenvie a mesma conferência com segurança.</p>}
    {loading?<p role="status">Carregando recebimentos…</p>:summary&&<>
      <section className="day-conference-stats" aria-label="Resumo dos recebimentos">
        <div className="surface-card"><small>Recebimentos brutos</small><strong>{formatCents(totalGross)}</strong></div>
        <div className="surface-card"><small>Estornos identificados</small><strong>{formatCents(totalRefund)}</strong></div>
        <div className="surface-card"><small>Saldo líquido registrado</small><strong>{formatCents(totalNet)}</strong></div>
      </section>
      <p className="day-conference-note">O período considera a data financeira do Mesiva, não a data do pedido ou a confirmação no extrato bancário. Compare o valor externo líquido de estornos identificados. Cartões: compare transações, não repasses líquidos futuros. Dinheiro: confira entradas, não o saldo da gaveta.</p>
      {totalEditRefund>0&&<p className="day-conference-note">Recebido hoje na Visão geral para esta data: {formatCents(totalNet+totalEditRefund)}. Essa métrica não deduz as devoluções após edição ({formatCents(totalEditRefund)}), já descontadas do líquido desta conferência. O mix da Visão geral mostra os recebimentos brutos.</p>}
      {summary.integrityIssues>0&&<p role="alert" className="day-conference-error">Há divergências entre movimentos, recibos e alocações. A conclusão está bloqueada; solicite revisão financeira. Nenhum pagamento foi alterado.</p>}
      {rows.some(row=>row.method==='Não informado')&&<p className="day-conference-notice">Há lançamentos sem forma identificável. Confira-os separadamente; estornos sem evidência não são atribuídos à forma do pagamento original.</p>}
      {latest&&<div className="day-conference-notice" role="status">
        <strong>{statusLabel(latest.status)} em {formatTimestamp(latest.createdAt)}</strong>
        {stale?<span> • Os recebimentos foram alterados após essa conferência. É necessário conferir novamente.</span>
          :<span> • Conferência já registrada para estes recebimentos.</span>}
        <div>Responsável: {latest.actorName || latest.userId || 'Usuário legado'} • Revisão {latest.revision}</div>
        {latest.note&&<div>Observação: {latest.note}</div>}
      </div>}
      {!rows.length?<div className="surface-card day-conference-empty">Nenhum recebimento registrado nesta data. Não há valores para conferir.</div>
        :<section className="day-conference-methods" aria-label="Conferência por forma de pagamento">
          {rows.map((row,index)=>{
            const parsed=parseCents(amounts[row.method]??'')
            const isChecked=Boolean(verified[row.method])&&parsed!==null
            const diff=parsed!==null?parsed-row.netCents:null
            return <article className="surface-card day-conference-method" key={row.method}>
              <div className="day-conference-method-heading"><div><h2>{row.method}</h2><small>{row.count} movimentação(ões)</small></div>
                <span className={isChecked?(diff===0?'day-conference-good':'day-conference-bad'):'day-conference-pending'}>
                  {isChecked?(diff===0?'Sem diferença':'Divergente'):'Pendente'}
                </span>
              </div>
              <div className="day-conference-values">
                <div><small>Bruto</small><strong>{formatCents(row.grossCents)}</strong></div>
                <div><small>Estornos</small><strong>{formatCents(row.refundCents)}</strong></div>
                <div><small>Líquido Mesiva</small><strong>{formatCents(row.netCents)}</strong></div>
                <div><small>Diferença</small><strong className={diff!==null&&diff!==0?'day-conference-text-danger':''}>{diff===null?'—':formatCents(diff)}</strong></div>
              </div>
              <div className="day-conference-field-row">
                <label>Valor conferido externamente (R$)
                  <input inputMode="decimal" autoComplete="off" placeholder="0,00"
                    value={amounts[row.method]??''} disabled={fieldsDisabled} aria-invalid={Boolean(amounts[row.method])&&parsed===null}
                    aria-describedby={Boolean(amounts[row.method])&&parsed===null?'conference-amount-error-'+index:undefined}
                    onChange={event=>{setAmounts(prev=>({...prev,[row.method]:event.target.value}));setVerified(prev=>({...prev,[row.method]:false}))}} />
                  {Boolean(amounts[row.method])&&parsed===null&&<small id={'conference-amount-error-'+index}>Informe um valor com até duas casas decimais (ex.: -10,50).</small>}
                </label>
                <label className="day-conference-verify"><input type="checkbox" checked={isChecked}
                  disabled={fieldsDisabled||parsed===null}
                  onChange={event=>setVerified(prev=>({...prev,[row.method]:event.target.checked}))} /> Conferido</label>
                <button type="button" className="day-conference-detail" onClick={event=>openDetail(row.method,event.currentTarget)}>Ver lançamentos</button>
              </div>
            </article>
          })}
        </section>}
      {!sameVersion&&rows.length>0&&<section className="surface-card day-conference-finish">
        <div><h2>Concluir conferência</h2><p>{count} de {rows.length} formas verificadas. Diferenças por forma exigem justificativa mesmo se o total geral coincidir.</p></div>
        <label>Observação {differences.length?'(obrigatória para divergências)':'(opcional)'}
          <textarea rows={3} value={note} maxLength={1000} onChange={event=>setNote(event.target.value)} disabled={fieldsDisabled}/>
        </label>
        <Button onClick={()=>setDialog(true)} disabled={!canSubmit}>Concluir conferência</Button>
        {!canComplete&&<small>Seu perfil pode consultar, mas não concluir conferências.</small>}
      </section>}
    </>}
    {detail&&<section ref={detailPanel} tabIndex={-1} className="surface-card day-conference-detail-panel" aria-label={'Lançamentos de '+detail.method}>
      <div className="day-conference-method-heading"><h2>Lançamentos — {detail.method}</h2>
        <Button variant="secondary" onClick={()=>{detailGeneration.current++;setDetail(null);setDetailLoading(false);detailOpener.current?.focus()}}>Fechar</Button></div>
      {detail.error&&<p role="alert">{detail.error}</p>}
      <div className="day-conference-detail-list">
      {detail.entries.map(entry=><div className="day-conference-entry" key={entry.id}>
        <div><strong>{entry.source==='order-payment'?'Recebimento':entry.source==='order-edit-refund'?'Devolução após edição':'Estorno'}</strong>
          <small>{entry.orderNumber?'Pedido #'+entry.orderNumber:'Recebimento compartilhado/sem pedido direto'}</small>
          <small>Data financeira: {entry.date} • Registrado em {entry.createdAt?formatTimestamp(entry.createdAt):'—'}</small>
          <small>Movimento: {entry.id} • Recebimento: {entry.receiptId||'Sem vínculo legado'} • Pedido ID: {entry.orderId||'Sem vínculo direto'} • Ativo</small></div>
        <strong className={entry.type==='saida'?'day-conference-text-danger':''}>{entry.type==='saida'?'− ':''}{formatCents(entry.amountCents)}</strong>
      </div>)}
      </div>
      {detailLoading&&<p role="status">Carregando lançamentos…</p>}
      {detail.nextPage&&!detailLoading&&<Button variant="secondary" onClick={moreDetail}>Carregar mais</Button>}
      <p className="day-conference-note">Total {detail.nextPage?'parcial carregado':'dos lançamentos carregados'}: {formatCents(detail.entries.reduce((sum,entry)=>sum+(entry.type==='saida'?-entry.amountCents:entry.amountCents),0))}. {detail.nextPage?'Carregue as próximas páginas para conferir o total completo.':''}</p>
    </section>}
    {history!==null&&<section ref={historyPanel} tabIndex={-1} className="surface-card day-conference-history" aria-label="Histórico de conferências">
      <div className="day-conference-method-heading"><h2>Conferências de {date}</h2>
        <Button variant="secondary" onClick={()=>{historyGeneration.current++;setHistory(null);setHistoryLoading(false);historyOpener.current?.focus()}}>Fechar</Button></div>
      <p className="day-conference-note">Até 30 revisões da data selecionada. Altere a data do recebimento acima para pesquisar outro dia.</p>
      {historyLoading?<p>Carregando histórico…</p>:history.length?history.map(item=><div className="day-conference-entry" key={item.id}>
        <div><strong>{item.date} • {statusLabel(item.status)}</strong>
          <small>Revisão {item.revision} • {formatTimestamp(item.createdAt)} • {item.actorName||item.userId||'Usuário legado'}</small>
          {summary?.sourceVersion&&item.date===date&&item.sourceVersion!==summary.sourceVersion&&<small>Desatualizada em relação aos recebimentos desta data.</small>}
          {item.note&&<small>{item.note}</small>}
          <details><summary>Valores desta revisão</summary>{item.lines.map(line=><p key={line.method}>{line.method}: bruto {formatCents(line.grossCents)} • estornos {formatCents(line.refundCents)} • líquido {formatCents(line.netCents)} • conferido {formatCents(line.checkedCents)} • diferença {formatCents(line.differenceCents)}</p>)}</details></div>
        <strong>{formatCents(item.lines.reduce((total,line)=>total+line.checkedCents,0))}</strong>
      </div>):<p>Não há conferências anteriores.</p>}
    </section>}
    {dialog&&<ConfirmationDialog title="Confirmar conferência"
      message={differences.length?'Existem divergências. A conferência será registrada com ressalva, sem alterar pagamentos.':'Registrar esta conferência? Nenhum pagamento será alterado.'}
      details={<div>{rows.map(row=><p key={row.method}>{row.method}: Mesiva {formatCents(row.netCents)} · Conferido {formatCents(parseCents(amounts[row.method])||0)} · Diferença {formatCents((parseCents(amounts[row.method])||0)-row.netCents)}</p>)}</div>}
      confirmLabel="Registrar conferência" confirmVariant="primary" submitting={submitting}
      onClose={()=>setDialog(false)} onConfirm={finish}/>}
  </>
}
