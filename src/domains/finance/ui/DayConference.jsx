import { useEffect, useState } from 'react'
import AreaNavigation from '../../../app/navigation/AreaNavigation.jsx'
import { apiRequest } from '../../../infrastructure/api/httpClient.js'
import { getBusinessDate } from '../../../../shared/finance.js'
import PageHeader from '../../../shared/ui/PageHeader.jsx'
import Button from '../../../shared/ui/Button.jsx'
import ConfirmationDialog from '../../../shared/ui/ConfirmationDialog.jsx'
import './day-conference.css'

const formatCents = cents => new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(cents/100)
const parseCents = value => {
  const normalized=String(value).trim().replace(',','.')
  if(!/^\\d+(?:\\.\\d{1,2})?$/.test(normalized))return null
  const [whole,decimal='']=normalized.split('.')
  const cents=Number(whole)*100+Number(decimal.padEnd(2,'0'))
  return Number.isSafeInteger(cents) && cents <= 999999999999 ? cents : null
}
const statusLabel = status => status==='com_ressalva'?'Concluída com ressalva':'Conferida'
const today = () => getBusinessDate(new Date())

export default function DayConference({ canComplete=false }){
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

  useEffect(()=>{
    const controller=new AbortController()
    setLoading(true);setSummary(null);setError('');setAmounts({});setVerified({});setNote('')
    setDetail(null);setHistory(null)
    apiRequest('/api/finance/day-conference?date='+encodeURIComponent(date),{signal:controller.signal})
      .then(data=>{if(!controller.signal.aborted)setSummary(data)})
      .catch(err=>{if(!controller.signal.aborted)setError(err.message)})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false)})
    return ()=>controller.abort()
  },[date])

  const reload=async()=>{
    setLoading(true);setError('');setDialog(false)
    try{
      const data=await apiRequest('/api/finance/day-conference?date='+encodeURIComponent(date))
      setSummary(data);setVerified({});setAmounts({});setNote('')
    }catch(err){setError(err.message)}
    finally{setLoading(false)}
  }
  const latest=summary?.latest
  const stale=latest && latest.sourceVersion!==summary.sourceVersion
  const sameVersion=latest && !stale
  const rows=summary?.methods || []
  const count=rows.filter(row=>verified[row.method] && parseCents(amounts[row.method])!==null).length
  const totalGross=rows.reduce((n,row)=>n+row.grossCents,0)
  const totalRefund=rows.reduce((n,row)=>n+row.refundCents,0)
  const totalNet=totalGross-totalRefund
  const allComplete=rows.length>0 && count===rows.length
  const differences=rows.filter(row=>verified[row.method] && parseCents(amounts[row.method])!==null
    && parseCents(amounts[row.method])!==row.netCents)
  const canSubmit=canComplete && allComplete && (!differences.length||Boolean(note.trim()))
    && !sameVersion && !loading && !submitting

  const openDetail=async method=>{
    setDetail({method,entries:[],nextPage:1,error:''});setDetailLoading(true)
    try{
      const params=new URLSearchParams({date,method,page:'1'})
      const result=await apiRequest('/api/finance/day-conference/entries?'+params)
      setDetail({method,...result,error:''})
    }catch(err){setDetail({method,entries:[],nextPage:null,error:err.message})}
    finally{setDetailLoading(false)}
  }
  const moreDetail=async()=>{
    if(!detail?.nextPage||detailLoading)return
    const method=detail.method,page=detail.nextPage;setDetailLoading(true)
    try{
      const result=await apiRequest('/api/finance/day-conference/entries?'+new URLSearchParams({date,method,page:String(page)}))
      setDetail(current=>current?.method===method?{...current,entries:[...current.entries,...result.entries],nextPage:result.nextPage,error:''}:current)
    }catch(err){setDetail(current=>({...current,error:err.message}))}
    finally{setDetailLoading(false)}
  }
  const openHistory=async()=>{
    setHistoryLoading(true);setHistory([])
    try{
      const result=await apiRequest('/api/finance/day-conference/history')
      setHistory(result.history)
    }catch(err){setError(err.message)}
    finally{setHistoryLoading(false)}
  }
  const finish=async()=>{
    if(!canSubmit)return
    setSubmitting(true);setError('')
    try{
      await apiRequest('/api/finance/day-conference',{
        method:'POST',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({
          date,sourceVersion:summary.sourceVersion,requestKey:crypto.randomUUID(),
          lines:rows.map(row=>({method:row.method,checkedCents:parseCents(amounts[row.method]),verified:Boolean(verified[row.method])})),
          note,
        }),
      })
      await reload()
    }catch(err){setDialog(false);setError(err.message);if(err.status===409)await reload()}
    finally{setSubmitting(false)}
  }

  return <>
    <AreaNavigation area="finance"/>
    <PageHeader eyebrow="Financeiro" title="Conferência do Dia"
      description="Compare os recebimentos registrados no Mesiva com o PIX, o relatório de transações de cartões e as entradas em dinheiro." />
    <div className="day-conference-actions">
      <label>Data do recebimento <input type="date" value={date} max={today()} onChange={event=>setDate(event.target.value)} /></label>
      <Button variant="secondary" onClick={reload} disabled={loading||submitting}>Atualizar</Button>
      <Button variant="secondary" onClick={openHistory} disabled={historyLoading}>Histórico</Button>
    </div>
    {error&&<p role="alert" className="day-conference-error">{error}</p>}
    {loading?<p role="status">Carregando recebimentos…</p>:summary&&<>
      <section className="day-conference-stats" aria-label="Resumo dos recebimentos">
        <div className="surface-card"><small>Recebimentos brutos</small><strong>{formatCents(totalGross)}</strong></div>
        <div className="surface-card"><small>Estornos identificados</small><strong>{formatCents(totalRefund)}</strong></div>
        <div className="surface-card"><small>Saldo líquido registrado</small><strong>{formatCents(totalNet)}</strong></div>
      </section>
      <p className="day-conference-note">O período considera a data financeira do Mesiva, não a data do pedido. Cartões: compare transações, não repasses líquidos futuros. Dinheiro: confira entradas, não o saldo da gaveta.</p>
      {latest&&<div className="day-conference-notice" role="status">
        <strong>{statusLabel(latest.status)} em {new Date(latest.createdAt).toLocaleString('pt-BR')}</strong>
        {stale?<span> • Os recebimentos foram alterados após essa conferência. É necessário conferir novamente.</span>
          :<span> • Conferência já registrada para estes recebimentos.</span>}
        <div>Responsável: {latest.userId || 'Usuário legado'} • Revisão {latest.revision}</div>
      </div>}
      {!rows.length?<div className="surface-card day-conference-empty">Nenhum recebimento registrado nesta data. Não há valores para conferir.</div>
        :<section className="day-conference-methods" aria-label="Conferência por forma de pagamento">
          {rows.map(row=>{
            const parsed=parseCents(amounts[row.method]??'')
            const isChecked=Boolean(verified[row.method])&&parsed!==null
            const diff=isChecked?parsed-row.netCents:null
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
                    value={amounts[row.method]??''} disabled={!canComplete||sameVersion}
                    onChange={event=>{setAmounts(prev=>({...prev,[row.method]:event.target.value}));setVerified(prev=>({...prev,[row.method]:false}))}} />
                </label>
                <label className="day-conference-verify"><input type="checkbox" checked={isChecked}
                  disabled={!canComplete||sameVersion||parsed===null}
                  onChange={event=>setVerified(prev=>({...prev,[row.method]:event.target.checked}))} /> Conferido</label>
                <button type="button" className="day-conference-detail" onClick={()=>openDetail(row.method)}>Ver lançamentos</button>
              </div>
            </article>
          })}
        </section>}
      {!sameVersion&&rows.length>0&&<section className="surface-card day-conference-finish">
        <div><h2>Concluir conferência</h2><p>{count} de {rows.length} formas verificadas. Diferenças por forma exigem justificativa mesmo se o total geral coincidir.</p></div>
        <label>Observação {differences.length?'(obrigatória para divergências)':'(opcional)'}
          <textarea rows={3} value={note} maxLength={1000} onChange={event=>setNote(event.target.value)} disabled={!canComplete}/>
        </label>
        <Button onClick={()=>setDialog(true)} disabled={!canSubmit}>Concluir conferência</Button>
        {!canComplete&&<small>Seu perfil pode consultar, mas não concluir conferências.</small>}
      </section>}
    </>}
    {detail&&<section className="surface-card day-conference-detail-panel" aria-label={'Lançamentos de '+detail.method}>
      <div className="day-conference-method-heading"><h2>Lançamentos — {detail.method}</h2>
        <Button variant="secondary" onClick={()=>setDetail(null)}>Fechar</Button></div>
      {detail.error&&<p role="alert">{detail.error}</p>}
      <div className="day-conference-detail-list">
      {detail.entries.map(entry=><div className="day-conference-entry" key={entry.id}>
        <div><strong>{entry.source==='order-payment'?'Recebimento':'Estorno'}</strong>
          <small>{entry.orderNumber?'Pedido #'+entry.orderNumber:'Recebimento compartilhado/sem pedido direto'}</small>
          <small>{entry.createdAt?new Date(entry.createdAt).toLocaleString('pt-BR'):'—'} • {entry.receiptId||entry.id}</small></div>
        <strong className={entry.type==='saida'?'day-conference-text-danger':''}>{entry.type==='saida'?'− ':''}{formatCents(entry.amountCents)}</strong>
      </div>)}
      </div>
      {detailLoading&&<p role="status">Carregando lançamentos…</p>}
      {detail.nextPage&&!detailLoading&&<Button variant="secondary" onClick={moreDetail}>Carregar mais</Button>}
    </section>}
    {history!==null&&<section className="surface-card day-conference-history">
      <div className="day-conference-method-heading"><h2>Últimas conferências</h2>
        <Button variant="secondary" onClick={()=>setHistory(null)}>Fechar</Button></div>
      {historyLoading?<p>Carregando histórico…</p>:history.length?history.map(item=><div className="day-conference-entry" key={item.id}>
        <div><strong>{item.date} • {statusLabel(item.status)}</strong>
          <small>Revisão {item.revision} • {new Date(item.createdAt).toLocaleString('pt-BR')} • {item.userId||'Usuário legado'}</small>
          {item.note&&<small>{item.note}</small>}</div>
        <strong>{formatCents(item.lines.reduce((total,line)=>total+line.checkedCents,0))}</strong>
      </div>):<p>Não há conferências anteriores.</p>}
    </section>}
    {dialog&&<ConfirmationDialog title="Confirmar conferência"
      message={differences.length?'Existem divergências. A conferência será registrada com ressalva, sem alterar pagamentos.':'Registrar esta conferência? Nenhum pagamento será alterado.'}
      details={<div>{rows.map(row=><p key={row.method}>{row.method}: Mesiva {formatCents(row.netCents)} · Conferido {formatCents(parseCents(amounts[row.method])||0)}</p>)}</div>}
      confirmLabel="Registrar conferência" confirmVariant="primary" submitting={submitting}
      onClose={()=>setDialog(false)} onConfirm={finish}/>}
  </>
}
