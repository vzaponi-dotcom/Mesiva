import { parseRealtimeMessage, REALTIME_PROTOCOL, REALTIME_TOPICS, REALTIME_MAX_IDS } from '../../../shared/realtimeProtocol.js'
const defaultClock={now:()=>Date.now(),setTimeout:(fn,ms)=>globalThis.setTimeout(fn,ms),clearTimeout:id=>globalThis.clearTimeout(id)}
const permanentAuth=error=>[401,403,409].includes(error?.status)
export function createRealtimeClient({api,createSocket=(url,protocols)=>new WebSocket(url,protocols),clock=defaultClock,random=Math.random,onUnauthorized=()=>{}}) {
  const consumers=new Set(),states=new Set(),timers=new Map()
  let state='stopped',running=false,generation=0,epoch=0,socket=null,connectionId=null,controller=null,retries=0,disabled=false
  let visible=true,operational=false,pending=null,flushing=false,revision=null
  const clear=name=>{if(timers.has(name)){clock.clearTimeout(timers.get(name));timers.delete(name)}}
  const valid=(g,e=epoch)=>running && generation===g && epoch===e
  const timer=(name,delay,callback)=>{clear(name);const g=generation;timers.set(name,clock.setTimeout(()=>{timers.delete(name);if(running && generation===g)callback()},Math.max(0,delay)))}
  const setState=next=>{if(state===next)return;state=next;for(const fn of states)fn(state)}
  const dropSocket=()=>{epoch++;controller?.abort();controller=null;if(socket){socket.onmessage=socket.onclose=socket.onerror=null;socket.close();socket=null}connectionId=null;for(const name of ['connect','renew','expiry'])clear(name)}
  function scheduleFlush(){if(pending && visible && !flushing && !timers.has('flush'))timer('flush',250,flush)}
  function enqueue({topics=REALTIME_TOPICS,orderIds=[],requiresFullRefresh=false}={}) {
    if(!running)return
    pending ??= {topics:new Set(),orderIds:new Set(),requiresFullRefresh:false}
    for(const topic of topics)pending.topics.add(topic)
    if(requiresFullRefresh || topics.includes('orders') && !orderIds.length)pending.requiresFullRefresh=true
    if(!pending.requiresFullRefresh)for(const id of orderIds){pending.orderIds.add(id);if(pending.orderIds.size>REALTIME_MAX_IDS){pending.requiresFullRefresh=true;break}}
    if(pending.requiresFullRefresh)pending.orderIds.clear()
    scheduleFlush()
  }
  async function flush(){
    if(!pending || !visible || flushing)return
    const g=generation,batch=pending;pending=null;flushing=true
    const event={topics:[...batch.topics],orderIds:[...batch.orderIds],requiresFullRefresh:batch.requiresFullRefresh}
    await Promise.allSettled([...consumers].map(fn=>Promise.resolve().then(()=>{if(running && generation===g && visible)return fn(event)})))
    if(generation!==g)return
    flushing=false;scheduleFlush()
  }
  function reconcile(){enqueue({requiresFullRefresh:true})}
  function scheduleReconciliation(){timer('reconcile',300_000*(0.9+random()*0.2),()=>{reconcile();scheduleReconciliation()})}
  function scheduleFallback(){if(timers.has('fallback'))return;timer('fallback',30_000,()=>{reconcile();scheduleFallback()})}
  function unauthorized(error){stop();onUnauthorized(error)}
  function fallback(error){
    if(!running)return
    if(permanentAuth(error)){unauthorized(error);return}
    const alreadyFallback=state==='fallback'
    dropSocket();clear('reconcile');setState('fallback');if(!alreadyFallback)reconcile();scheduleFallback()
    if(disabled)return
    const delay=Math.min(30_000,1000*2**Math.min(retries++,5))*(0.8+random()*0.4)
    timer('reconnect',delay,connect)
  }
  function setLease(expiresAt,g,e){
    const deadline=Date.parse(expiresAt)
    if(!Number.isFinite(deadline) || deadline<=clock.now()){fallback();return false}
    timer('expiry',Math.min(75_000,deadline-clock.now()),()=>{if(valid(g,e))fallback()})
    timer('renew',60_000,async()=>{
      try {const result=await api.renew(connectionId,{signal:controller.signal});if(!valid(g,e))return
        if(result?.enabled===false){disabled=true;fallback();return}
        setLease(result?.expiresAt,g,e)
      } catch(error){if(valid(g,e))fallback(error)}
    })
    return true
  }
  async function connect(){
    if(!running || !visible && !operational)return
    const g=generation,e=++epoch
    controller=new AbortController()
    timer('connect',10_000,()=>{if(valid(g,e))fallback()})
    try {
      const prepared=await api.prepare({signal:controller.signal})
      if(!valid(g,e))return
      if(prepared?.enabled===false){disabled=true;fallback();return}
      if(prepared?.protocol!==REALTIME_PROTOCOL || prepared.socketPath!=='/api/realtime/socket' || !/^[a-f0-9]{64}\.[A-Za-z0-9_-]{43}$/.test(prepared.ticket))throw new Error('INVALID_REALTIME_PREPARE')
      const url=new URL(prepared.socketPath,globalThis.location?.href || 'https://localhost')
      url.protocol=url.protocol==='https:'?'wss:':'ws:'
      const current=createSocket(url.href,[REALTIME_PROTOCOL,`ticket.${prepared.ticket}`]);socket=current
      current.onmessage=event=>{
        if(!valid(g,e))return
        const message=parseRealtimeMessage(event.data)
        if(!message){fallback();return}
        if(message.type==='access_changed'){unauthorized(Object.assign(new Error('Seu acesso mudou.'),{status:409,code:'SESSION_CONTEXT_CHANGED'}));return}
        if(message.type==='ready'){
          if(connectionId){fallback();return}
          connectionId=message.connectionId;revision=message.revision
          if(!setLease(message.expiresAt,g,e))return
          clear('connect');clear('fallback');clear('reconnect');retries=0;setState('live');reconcile();scheduleReconciliation();return
        }
        if(state!=='live'){fallback();return}
        if(revision===null || BigInt(message.revision)>BigInt(revision)){
          revision=message.revision
          enqueue({...message,requiresFullRefresh:message.type==='resync_required'})
        }
        // Receipt of the validated/enqueued hint, never confirmation of applying data.
        try {current.send(JSON.stringify({version:1,type:'ack',revision:message.revision}))}catch{fallback()}
      }
      current.onclose=current.onerror=()=>{if(valid(g,e))fallback()}
    } catch(error){if(!valid(g,e))return;if(error?.status===404)disabled=true;fallback(error)}
  }
  function stop(){running=false;generation++;for(const name of [...timers.keys()])clear(name);dropSocket();pending=null;flushing=false;revision=null;setState('stopped')}
  function start(activity={}){
    stop();visible=activity.visible ?? true;operational=activity.operational ?? false;running=true;disabled=false;retries=0
    if(!visible && !operational){setState('suspended');return}
    setState('connecting');void connect()
  }
  function setActivity(activity){
    const wasVisible=visible
    visible=activity.visible ?? visible;operational=activity.operational ?? operational
    if(!running)return
    if(!visible && !operational){
      for(const name of [...timers.keys()])clear(name)
      dropSocket();pending=null;setState('suspended');return
    }
    if(state==='suspended'){setState('connecting');void connect();return}
    if(visible && !wasVisible)reconcile()
  }
  return {start,stop,setActivity,requestRefresh:reconcile,
    subscribeInvalidations(fn){consumers.add(fn);return()=>consumers.delete(fn)},
    subscribeState(fn){states.add(fn);fn(state);return()=>states.delete(fn)},
  }
}
