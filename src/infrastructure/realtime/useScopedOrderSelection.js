import {useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react'
const LIMIT=100
export function useScopedOrderSelection({scopeKey,isEligible=()=>true,refreshKey,loadOrdersByIds,onError=()=>{}}={}){
  const [state,setState]=useState({scopeKey,records:[]}),[checking,setChecking]=useState({scopeKey,pending:false})
  const owner=useRef(scopeKey),inputs=useRef(null),selected=useRef([])
  owner.current=scopeKey;inputs.current={isEligible,loadOrdersByIds,onError}
  const records=state.scopeKey===scopeKey?state.records:[]
  selected.current=records
  useLayoutEffect(()=>{setState({scopeKey,records:[]});setChecking({scopeKey,pending:false})},[scopeKey])
  const toggle=useCallback(order=>{
    if(owner.current!==scopeKey||!order?.id)return false
    const existing=selected.current.some(value=>value.id===order.id)
    if(!existing&&(!inputs.current.isEligible(order)||selected.current.length>=LIMIT))return false
    setState(current=>{const records=current.scopeKey===scopeKey?current.records:[];return{scopeKey,records:records.some(value=>value.id===order.id)?records.filter(value=>value.id!==order.id):[...records,order].slice(0,LIMIT)}})
    return true
  },[scopeKey])
  const selectVisible=useCallback(orders=>{
    if(owner.current!==scopeKey)return false
    setState(current=>{
      const selected=new Map((current.scopeKey===scopeKey?current.records:[]).map(order=>[order.id,order]))
      for(const order of orders || [])if(order?.id&&inputs.current.isEligible(order)&&(selected.has(order.id)||selected.size<LIMIT))selected.set(order.id,order)
      return{scopeKey,records:[...selected.values()]}
    });return true
  },[scopeKey])
  const clear=useCallback(()=>{setState({scopeKey,records:[]});return true},[scopeKey])
  useEffect(()=>{
    const ids=selected.current.map(order=>order.id),load=inputs.current.loadOrdersByIds
    if(!ids.length||!load)return undefined
    let cancelled=false
    const controller=typeof AbortController==='function'?new AbortController():null
    setChecking({scopeKey,pending:true})
    Promise.resolve().then(()=>load(ids,{signal:controller?.signal})).then(orders=>{
      if(cancelled||owner.current!==scopeKey||orders===false)return
      const wanted=new Set(ids),canonical=new Map((orders || []).map(order=>[order.id,order]))
      setState(current=>current.scopeKey!==scopeKey?current:{scopeKey,records:current.records.flatMap(order=>{
        if(!wanted.has(order.id))return[order]
        const fresh=canonical.get(order.id)
        return fresh&&inputs.current.isEligible(fresh)?[fresh]:[]
      })})
    }).catch(error=>{if(!cancelled&&owner.current===scopeKey&&error?.name!=='AbortError')inputs.current.onError(error)})
      .finally(()=>{if(!cancelled&&owner.current===scopeKey)setChecking({scopeKey,pending:false})})
    return()=>{cancelled=true;controller?.abort()}
  // Page changes validate only explicitly selected IDs; absence in a page is never deletion.
  },[scopeKey,refreshKey,loadOrdersByIds])
  return {records,ids:records.map(order=>order.id),total:records.reduce((sum,order)=>sum+Math.max(0,Math.round((Number(order.total)||0)*100)),0)/100,
    limit:LIMIT,validating:checking.scopeKey===scopeKey&&checking.pending,toggle,selectVisible,clear}
}
