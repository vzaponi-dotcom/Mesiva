import {getScopedReadCache} from './scopedReadCache.js'
import {useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react'
const EMPTY=Object.freeze([])
const PAGE_COLLECTIONS=['orders','clients','movements','entries','groups']
const unavailable=()=>Promise.resolve(false)
function mergePage(previous,next){
  const result={...previous,...next}
  for(const key of PAGE_COLLECTIONS)if(Array.isArray(next[key])){
    const values=new Map((previous?.[key] || []).map(value=>[value.id || value.key,value]))
    for(const value of next[key])values.set(value.id || value.key,value)
    result[key]=[...values.values()]
  }
  if(previous?.summary?.days && next.summary?.days)result.summary={...next.summary,days:{...previous.summary.days,...next.summary.days}}
  return result
}
const denied=error=>error?.status===401 || error?.status===403 || error?.code==='SESSION_CONTEXT_CHANGED'
export function useScopedQuery({accessContextId,queryKey,load,realtime,topics=EMPTY,collections=EMPTY,guard,officialRevision,enabled=false,onUnauthorized=()=>{}}={}){
  const owner=JSON.stringify([accessContextId,queryKey]),[state,setState]=useState(null)
  const currentRender=useRef(null),inputs=useRef(null),actions=useRef(null),revision=useRef(null)
  currentRender.current={owner,guard,enabled}
  inputs.current={load,topics,collections,onUnauthorized}
  const cache=getScopedReadCache(guard,accessContextId),cacheKey='query:'+queryKey
  const subscribe=realtime?.subscribeInvalidations
  useLayoutEffect(()=>{
    let disposed=false,stopped=false,job=null,retryTimer=null,queued=null,payload=enabled?cache?.get(cacheKey,officialRevision):null,controller=null
    const current=()=>!disposed&&!stopped&&enabled&&currentRender.current.owner===owner&&currentRender.current.guard===guard&&currentRender.current.enabled
    const update=(status,error=null)=>setState({owner,guard,data:payload,status,error})
    revision.current={owner,value:officialRevision}
    function defer(ms){
      queued='full'
      if(retryTimer===null)retryTimer=setTimeout(()=>{retryTimer=null;if(current())void drain()},ms)
    }
    async function attempt(kind){
      if(!current())return false
      const selected=inputs.current.collections,cacheVersion=cache?.version,readRevision=revision.current?.value
      const token=guard?.beginQueryRead?.(selected) ?? guard?.beginRead?.(selected)
      controller=typeof AbortController==='function'?new AbortController():null
      update(kind==='next'?'loading-next':'loading')
      try{
        const value=await inputs.current.load({cursor:kind==='next'?payload?.nextCursor:undefined,signal:controller?.signal})
        if(!current())return false
        if(value===false || token&&selected.some(key=>!guard.canApply(token,key))){defer(250);return false}
        if(kind==='next' && payload?.queryKey && value?.queryKey!==payload.queryKey)throw Object.assign(new Error('A consulta mudou.'),{code:'READ_QUERY_CHANGED',status:409})
        payload=kind==='next'?mergePage(payload,value):value
        cache?.set(cacheKey,payload,{topics:inputs.current.topics,collections:selected,token,version:cacheVersion,officialRevision:readRevision})
        update('ready');return true
      }catch(error){
        if(!current() || error?.name==='AbortError')return false
        if(denied(error)){
          cache?.invalidate();payload=null;queued=null;update('error',error);stopped=true;inputs.current.onUnauthorized(error)
        }else if(error?.code==='READ_QUERY_CHANGED' && kind==='next'){
          cache?.delete(cacheKey);payload=null;queued='full';update('loading')
        }else{update('error',error);defer(30000)}
        return false
      }finally{controller=null}
    }
    function drain(){
      if(!current() || job || retryTimer!==null || !queued)return job || Promise.resolve(false)
      const kind=queued;queued=null
      const task=Promise.resolve().then(()=>attempt(kind)).finally(()=>{
        if(job===task)job=null
        if(current() && queued && retryTimer===null)return drain()
      })
      job=task;return task
    }
    function request(kind='full',force=false){
      if(!current())return Promise.resolve(false)
      if(kind==='next' && (job || !payload?.nextCursor))return job || Promise.resolve(false)
      queued=queued==='full'?'full':kind
      if(force && retryTimer!==null){clearTimeout(retryTimer);retryTimer=null}
      return drain()
    }
    actions.current={owner,reload:()=>request('full',true),invalidate:()=>request(),loadNext:()=>request('next')}
    const unsubscribe=enabled&&subscribe?subscribe(event=>{
      if(!current())return false
      if(event.topics?.length?!event.topics.some(topic=>inputs.current.topics.includes(topic)):!event.requiresFullRefresh)return false
      return request()
    }):null
    if(enabled && payload)update('ready')
    else if(enabled)void request()
    else setState({owner,guard,data:null,status:'idle',error:null})
    return()=>{disposed=true;unsubscribe?.();controller?.abort();if(retryTimer!==null)clearTimeout(retryTimer)}
  // Read functions and topic lists update through refs without restarting the owner.
  },[owner,guard,enabled,subscribe,cache]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{
    if(revision.current?.owner===owner && revision.current.value!==officialRevision){
      revision.current.value=officialRevision
      if(actions.current?.owner===owner)void actions.current.invalidate()
    }
  },[officialRevision,owner])
  const reload=useCallback(()=>actions.current?.reload() ?? unavailable(),[])
  const loadNext=useCallback(()=>actions.current?.loadNext() ?? unavailable(),[])
  const cached=enabled?cache?.get(cacheKey,officialRevision):null
  const active=enabled && state?.owner===owner && state?.guard===guard?state:cached?{data:cached,status:'ready',error:null}:null
  return useMemo(()=>({ownerKey:accessContextId,queryKey,data:active?.data ?? null,status:active?.status || (enabled?'loading':'idle'),error:active?.error || null,
    reload,loadNext,hasMore:Boolean(active?.data?.nextCursor)}),[accessContextId,queryKey,active,enabled,reload,loadNext])
}
