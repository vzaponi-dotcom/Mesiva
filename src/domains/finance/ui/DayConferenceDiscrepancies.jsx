import { useCallback, useEffect, useRef, useState } from 'react'
import Button from '../../../shared/ui/Button.jsx'
import SystemSelect from '../../../shared/ui/SystemSelect.jsx'
import { CONFERENCE_RESOLUTION_REASONS } from '../../../../shared/dayConferenceDiscrepancies.js'

const endpoint='/api/finance/day-conference/discrepancies'
const money=value=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(value/100)
const day=value=>new Intl.DateTimeFormat('pt-BR',{timeZone:'UTC'}).format(new Date(value+'T12:00:00Z'))
const timestamp=value=>new Date(value).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})
const emptyDraft=()=>({reason:'',note:'',reference:'',confirmed:false})

export default function DayConferenceDiscrepancies({request,visible,status,canResolve,writesBlocked,onReview,onBusyChange}){
  const [list,setList]=useState({request,items:[],nextCursor:null})
  const [selected,setSelected]=useState(null),[draft,setDraft]=useState(emptyDraft)
  const [loading,setLoading]=useState(false),[error,setError]=useState(''),[success,setSuccess]=useState('')
  const [submitting,setSubmitting]=useState(false),[uncertain,setUncertain]=useState(false),[attempt,setAttempt]=useState(null)
  const life=useRef(null),generation=useRef(0),busy=useRef(false),drafts=useRef(new Map())
  const heading=useRef(null),listHeading=useRef(null),returnFocus=useRef(false),owner=useRef(request)
  const load=useCallback(async(cursor=null,append=false)=>{
    const signal=life.current.signal,version=++generation.current
    setLoading(true);setError('')
    try{
      const data=await request(endpoint+'?'+new URLSearchParams({status,...(cursor?{cursor}:{})}),{signal})
      if(signal.aborted||version!==generation.current)return
      if(!Array.isArray(data?.items))throw new Error('Lista indisponível. Tente novamente.')
      setList(previous=>({request,items:append?[...previous.items,...data.items]:data.items,nextCursor:data.nextCursor||null}))
    }catch(err){if(!signal.aborted&&version===generation.current)setError(err.message)}
    finally{if(!signal.aborted&&version===generation.current)setLoading(false)}
  },[request,status])
  useEffect(()=>{
    const controller=new AbortController();life.current=controller;generation.current++
    if(owner.current!==request){drafts.current.clear();owner.current=request}
    setSelected(null);setError('');setSuccess('');setUncertain(false);setAttempt(null)
    busy.current=false;setSubmitting(false);onBusyChange(false)
    setList({request,items:[],nextCursor:null})
    if(visible)load()
    return ()=>{controller.abort();onBusyChange(false)}
  // A lista só é consultada por abertura/ação explícita; sem polling ou leitura por foco.
  },[request,visible,load,onBusyChange])
  const selectedId=selected?.id
  useEffect(()=>{
    if(selectedId)heading.current?.focus()
    else if(returnFocus.current){listHeading.current?.focus();returnFocus.current=false}
  },[selectedId])
  if(!visible)return null
  const current=list.request===request
  const open=async(item)=>{
    const signal=life.current.signal,version=++generation.current
    setLoading(true);setError('');setSuccess('')
    try{
      const data=await request(endpoint+'/'+encodeURIComponent(item.id),{signal})
      if(signal.aborted||version!==generation.current)return
      if(!data?.discrepancy?.id)throw new Error('Divergência indisponível. Tente novamente.')
      setSelected(data.discrepancy);setDraft(drafts.current.get(item.id)||emptyDraft());setUncertain(false);setAttempt(null)
    }catch(err){if(!signal.aborted&&version===generation.current)setError(err.message)}
    finally{if(!signal.aborted&&version===generation.current)setLoading(false)}
  }
  const change=(field,value)=>{
    const updated={...draft,[field]:value};setDraft(updated);drafts.current.set(selected.id,updated)
  }
  const back=()=>{returnFocus.current=true;setSelected(null);setError('');setSuccess('');setUncertain(false);setAttempt(null)}
  const updateSelected=value=>{
    setSelected(value)
    if(value.status==='resolved'){
      drafts.current.delete(value.id)
      setList(previous=>({...previous,items:previous.items.filter(item=>item.id!==value.id)}))
    }
  }
  const verifyResult=async()=>{
    if(busy.current)return
    const signal=life.current.signal;setLoading(true);setError('')
    try{
      const data=await request(endpoint+'/'+encodeURIComponent(selected.id),{signal})
      if(signal.aborted)return
      if(!data?.discrepancy?.id)throw new Error('Registro indisponível. Tente novamente.')
      updateSelected(data.discrepancy);setUncertain(false)
      if(data.discrepancy.status==='pending')setSuccess('Ainda não há solução registrada. Você pode reenviar a mesma solução.')
    }catch(err){if(!signal.aborted)setError(err.message)}
    finally{if(!signal.aborted)setLoading(false)}
  }
  const resolve=async(event)=>{
    event.preventDefault()
    if(busy.current||!canResolve||writesBlocked||selected.status!=='pending')return
    const payload=attempt||{...draft,note:draft.note.trim(),reference:draft.reference.trim()}
    if(!payload.reason||!payload.note||!payload.confirmed||(payload.reason==='source_corrected'&&!payload.reference)){
      setError('Informe o motivo, a solução e a confirmação; correções de origem exigem referência.');return
    }
    setAttempt(payload);busy.current=true;setSubmitting(true);onBusyChange(true);setError('');setSuccess('')
    const signal=life.current.signal
    try{
      const data=await request(endpoint+'/'+encodeURIComponent(selected.id)+'/resolve',{
        method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload),signal,
      })
      if(signal.aborted)return
      if(!data?.discrepancy?.id||data.discrepancy.status!=='resolved')throw new Error('Resposta não confirmada. Verifique o registro.')
      updateSelected(data.discrepancy);setUncertain(false)
      setSuccess('Solução registrada. A conferência original e os valores financeiros foram preservados.')
    }catch(err){
      if(signal.aborted)return
      setError(err.message)
      if(err.code==='DISCREPANCY_ALREADY_RESOLVED'){
        setUncertain(true)
      }else if(!err.status||err.status>=500)setUncertain(true)
      else setAttempt(null)
    }finally{busy.current=false;if(!signal.aborted){setSubmitting(false);onBusyChange(false)}}
  }
  const disabled=!canResolve||writesBlocked||submitting||loading||uncertain||Boolean(attempt)
  return <section className="day-discrepancies" aria-label="Tratamento de divergências">
    {error&&<p role="alert" className="day-conference-error">{error}</p>}
    {success&&<p role="status" className="day-conference-notice">{success}</p>}
    {loading&&<p role="status">Carregando divergências…</p>}
    {current&&selected?<>
      <button type="button" className="day-conference-back" onClick={back} disabled={submitting||loading}>← Voltar à lista</button>
      <div className="day-conference-panel-heading"><div><h2 ref={heading} tabIndex={-1}>{selected.method} · {day(selected.date)}</h2>
        <p>Revisão {selected.revision} · {selected.status==='resolved'?'Resolvida':'Pendente'}</p></div>
      </div>
      <div className="day-discrepancy-grid">
        <div className="day-discrepancy-stack">
          <section className="surface-card day-discrepancy-panel"><h3>O que foi encontrado</h3>
            <div className="day-discrepancy-values">
              <div><small>Mesiva</small><strong>{money(selected.netCents)}</strong></div>
              <div><small>Conferido</small><strong>{money(selected.checkedCents)}</strong></div>
              <div><small>Diferença</small><strong className="day-conference-text-danger">{money(selected.differenceCents)}</strong></div>
            </div>
            <h3>Justificativa original</h3><p className="day-discrepancy-note">{selected.conferenceNote}</p>
            <small>{selected.actorName||'Usuário legado'} · {timestamp(selected.createdAt)}</small>
            <div className="day-discrepancy-section"><Button variant="secondary" onClick={event=>onReview(selected,event.currentTarget)} disabled={submitting||loading}>Revisar lançamentos atuais</Button>
              <p className="day-conference-note">Consulta os recebimentos atuais desta forma e data. Eles podem ter mudado após a conferência.</p></div>
          </section>
          <section className="surface-card day-discrepancy-panel"><h3>Histórico do tratamento</h3>
            <div className="day-discrepancy-event"><strong>Conferência concluída com ressalva</strong>
              <small>{selected.actorName||'Usuário legado'} · {timestamp(selected.createdAt)}</small><p>Diferença de {money(selected.differenceCents)} registrada para análise.</p></div>
            {selected.status==='resolved'?<div className="day-discrepancy-event"><strong>Divergência resolvida</strong>
              <small>{selected.resolvedActorName} · {timestamp(selected.resolvedAt)}</small>
              <p>{CONFERENCE_RESOLUTION_REASONS[selected.resolutionReason]}</p><p className="day-discrepancy-note">{selected.resolutionNote}</p>
              {selected.resolutionReference&&<p>Referência: {selected.resolutionReference}</p>}</div>
              :<p className="day-conference-note">Aguardando análise e registro da solução.</p>}
          </section>
        </div>
        <section className="surface-card day-discrepancy-panel">
          {selected.status==='resolved'?<><h3>Solução registrada</h3><p>{CONFERENCE_RESOLUTION_REASONS[selected.resolutionReason]}</p>
            <p className="day-discrepancy-note">{selected.resolutionNote}</p>{selected.resolutionReference&&<p>Referência: {selected.resolutionReference}</p>}
            <small>{selected.resolvedActorName} · {timestamp(selected.resolvedAt)}</small>
            <p className="day-conference-note">A diferença original permanece no histórico. A solução não altera valores financeiros.</p></>
            :<><h3>Registrar solução</h3><p className="day-conference-note">Registre a causa e a providência tomada após revisar os comprovantes.</p>
              {!canResolve&&<p className="day-conference-note">Seu acesso permite consultar. Resolver exige permissão de gestão financeira.</p>}
              {writesBlocked&&!submitting&&<p role="status" className="day-conference-notice">A gravação está bloqueada. Verifique a conexão e a sessão.</p>}
              {uncertain&&<p role="status" className="day-conference-notice">A resposta não foi confirmada ou já existe uma solução. Verifique o registro ou reenvie a mesma solução.</p>}
              <form onSubmit={resolve} className="form-stack">
                <div className="day-discrepancy-field"><span>Como foi resolvida?</span><SystemSelect label="Como foi resolvida?"
                  value={draft.reason} disabled={disabled} placeholder="Selecione o resultado da análise"
                  options={Object.entries(CONFERENCE_RESOLUTION_REASONS).map(([value,label])=>({value,label}))}
                  onChange={value=>change('reason',value)}/></div>
                {draft.reason==='source_corrected'&&<><p className="day-conference-note">Faça a correção no fluxo de origem antes de encerrar. Aqui você registra a referência.</p>
                  <label className="day-discrepancy-field">Referência da correção<input value={draft.reference} required maxLength={200} disabled={disabled} onChange={event=>change('reference',event.target.value)}/></label></>}
                {draft.reason==='conference_error'&&<p className="day-conference-note">Explique o valor encontrado na revisão. A conferência original continuará preservada.</p>}
                {draft.reason==='accepted_difference'&&<p className="day-conference-note">Explique a causa e por que a diferença foi aceita. Ela permanece no histórico.</p>}
                <label className="day-discrepancy-field">O que foi verificado e qual foi a solução?<textarea rows={4} value={draft.note} required maxLength={1000} disabled={disabled} onChange={event=>change('note',event.target.value)}/></label>
                <label className="day-discrepancy-check"><input type="checkbox" checked={draft.confirmed} disabled={disabled} onChange={event=>change('confirmed',event.target.checked)}/>Revisei a divergência e confirmo a solução descrita.</label>
                <p className="day-conference-note">Esta ação encerra o acompanhamento. Não cria despesas, estornos ou cobranças e não altera recebimentos. A solução registrada não poderá ser editada.</p>
                <div className="form-actions"><Button type="button" variant="secondary" onClick={back} disabled={submitting||loading}>Continuar depois</Button>
                  {uncertain&&<Button type="button" variant="secondary" onClick={verifyResult} disabled={submitting||loading}>Verificar registro</Button>}
                  <Button type="submit" state={submitting?'loading':'idle'} loadingLabel="Registrando…" disabled={!canResolve||writesBlocked||submitting||loading}>Registrar solução</Button></div>
              </form>
            </>}
        </section>
      </div>
    </>:current&&<section className="surface-card day-discrepancy-panel">
      <div className="day-conference-panel-heading"><div><h2 ref={listHeading} tabIndex={-1}>{status==='pending'?'Divergências pendentes':'Divergências resolvidas'}</h2>
        <p>{status==='pending'?'Todos os dias com pendências, inclusive datas anteriores.':'Soluções registradas com a conferência original preservada.'}</p></div>
        <Button variant="secondary" onClick={()=>load()} disabled={loading}>Atualizar lista</Button></div>
      {list.items.map(item=><article key={item.id} className="day-discrepancy-row"><div><strong>{item.method}</strong><small>{day(item.date)} · Revisão {item.revision}</small></div>
        <div><strong className="day-conference-text-danger">{money(item.differenceCents)}</strong><small>{item.differenceCents<0?'A menos na conferência':'A mais na conferência'}</small></div>
        <div><strong>{item.status==='resolved'?'Resolvida':'Pendente'}</strong><small>{item.status==='resolved'?item.resolvedActorName:item.actorName||'Usuário legado'}</small></div>
        <Button variant="secondary" onClick={event=>open(item,event)} disabled={loading}>{status==='pending'?'Analisar':'Ver solução'}</Button></article>)}
      {!loading&&!error&&!list.items.length&&<p className="day-conference-empty">{status==='pending'?'Nenhuma divergência pendente.':'Nenhuma divergência resolvida.'}</p>}
      {list.nextCursor&&<Button variant="secondary" onClick={()=>load(list.nextCursor,true)} disabled={loading}>Carregar mais divergências</Button>}
    </section>}
  </section>
}
