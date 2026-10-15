import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createRealtimeClient } from '../../../infrastructure/realtime/realtimeClient.js'
const NO_TRANSPORT_OPTIONS=Object.freeze({})
export function useRealtimeRuntime({accessContextId,enabled=false,api,visible,operational=false,onUnauthorized=()=>{},transport=NO_TRANSPORT_OPTIONS}={}) {
  const [pageVisible,setPageVisible]=useState(()=>globalThis.document?.visibilityState!=='hidden')
  const [snapshot,setSnapshot]=useState(null)
  const owner=useRef(accessContextId),unauthorized=useRef(onUnauthorized)
  owner.current=accessContextId;unauthorized.current=onUnauthorized
  const activityVisible=visible ?? pageVisible
  const visibility=useRef(activityVisible);visibility.current=activityVisible
  // Clock/socket injection is the same transport boundary used by TV and runtime gates.
  const clock=transport.clock,createSocket=transport.createSocket,random=transport.random
  const client=useMemo(()=>createRealtimeClient({api,clock,createSocket,random,onUnauthorized:error=>{
    if(owner.current===accessContextId)unauthorized.current(error)
  }}),[accessContextId,api,clock,createSocket,random])
  useLayoutEffect(()=>{
    const unsubscribe=client.subscribeState(state=>setSnapshot({client,state}))
    if(enabled && accessContextId)client.start({visible:visibility.current,operational})
    return()=>{unsubscribe();client.stop()}
  // Activity changes are handled without replacing the contextual transport.
  },[accessContextId,client,enabled]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{client.setActivity({visible:activityVisible,operational})},[activityVisible,client,operational])
  useEffect(()=>{
    const changed=()=>setPageVisible(globalThis.document?.visibilityState!=='hidden')
    const focused=()=>{if(globalThis.document?.visibilityState!=='hidden')client.requestRefresh()}
    globalThis.document?.addEventListener?.('visibilitychange',changed)
    globalThis.window?.addEventListener?.('focus',focused)
    return()=>{globalThis.document?.removeEventListener?.('visibilitychange',changed);globalThis.window?.removeEventListener?.('focus',focused)}
  },[client])
  const subscribeInvalidations=useMemo(()=>fn=>client.subscribeInvalidations(event=>{
    if(owner.current===accessContextId && visibility.current)return fn(event)
  }),[accessContextId,client])
  return useMemo(()=>({state:snapshot?.client===client?snapshot.state:'stopped',subscribeInvalidations}),[client,snapshot,subscribeInvalidations])
}
