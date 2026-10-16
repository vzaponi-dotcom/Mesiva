import {useScopedQuery} from '../../../infrastructure/realtime/useScopedQuery.js'

export function useFinanceReadModel({api,accessContextId,realtime,guard,officialRevision,onUnauthorized,enabled=false,surface,queryState={},quickOpen=false,quickSearch=''}={}){
  const common={accessContextId,realtime,guard,officialRevision,onUnauthorized,topics:['orders','finance','settings'],collections:['orders','movements','financeSettings']}
  const {search='',displayMode='client',activeView='pending',timingFilter='all',sortMode='urgency',exactDateFilter,selectedEntryKey,period='30d'}=queryState
  const receivables={search,mode:displayMode,view:activeView,timing:timingFilter,sort:sortMode,exactDateFilter}
  const movementQuery={}
  for(const key of ['period','type','category','paymentMethod','search','startDate','endDate'])if(queryState[key])movementQuery[key]=queryState[key]
  const mainQuery=surface==='receivables'?receivables:surface==='dashboard'?{period}:movementQuery
  const main=useScopedQuery({...common,enabled,queryKey:JSON.stringify([surface,mainQuery]),load:({cursor,signal})=>{
    if(surface==='receivables')return api.getReceivables({...mainQuery,cursor},{signal})
    if(surface==='dashboard')return api.getFinanceOverview(mainQuery,{signal})
    return api.getMovements({...mainQuery,cursor},{signal})
  }})
  const groupQuery={...receivables,mode:'orders',groupKey:selectedEntryKey}
  const group=useScopedQuery({...common,enabled:enabled&&surface==='receivables'&&activeView==='pending'&&displayMode==='client'&&Boolean(selectedEntryKey),
    queryKey:JSON.stringify(['receivable-group',groupQuery]),load:({cursor,signal})=>api.getReceivables({...groupQuery,cursor},{signal})})
  const quick=useScopedQuery({...common,enabled:enabled&&surface==='receivables'&&quickOpen,queryKey:JSON.stringify(['quick',quickSearch]),
    load:({cursor,signal})=>api.getReceivables({mode:'quick',view:'pending',search:quickSearch,sort:'urgency',cursor},{signal})})
  const refunds=useScopedQuery({...common,enabled:enabled&&surface==='finance',queryKey:'refunds',
    load:({cursor,signal})=>api.getReceivables({mode:'orders',view:'refunds',cursor},{signal})})
  return {main,group,quick,refunds}
}
