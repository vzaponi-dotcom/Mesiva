import {getScopedBootstrapCollections,getScopedOperationalState} from '../../../../shared/scopedReads.js'
import {createScopedReadsApi} from '../../../infrastructure/api/scopedReadsApi.js'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { getBootstrap } from '../../../infrastructure/api/bootstrapApi.js'
import { ordersApi } from '../../../domains/orders/index.js'
import { createCollectionSyncGuard, removeById, upsertById, upsertManyById, upsertManyInCreatedOrder } from './dataSync.js'

export const GLOBAL_SYNC_INTERVAL_MS = 5_000
export const ORDER_SYNC_INTERVAL_MS = 2_000

const DATA_COLLECTIONS = ['clients', 'products', 'orders', 'tables', 'tableTabs', 'movements', 'financeSettings']
const GUARD_COLLECTIONS=[...DATA_COLLECTIONS,'operationalCounters']
const scopedApi=createScopedReadsApi()
const minimalOrder=order=>({id:order.id,status:order.status,createdAt:order.createdAt,scheduledFor:order.scheduledFor ?? null})
const activeOrder=order=>['Em preparo','Agendado'].includes(order.status)
const PAYMENT_COLLECTIONS = ['orders', 'movements', 'tableTabs', 'tables']

const defaultApi = { getActiveOrders:scopedApi.getActiveOrders, getBootstrap, getOrders: ordersApi.getOrders, getOrdersByIds: ordersApi.getOrdersByIds }
export const createRefreshSubscription = ({
  run,
  intervalMs,
  windowObject = globalThis.window,
  documentObject = globalThis.document,
  setIntervalFn = globalThis.setInterval,
  clearIntervalFn = globalThis.clearInterval,
}) => {
  let cancelled = false
  const refresh = () => {
    if (!cancelled) void run()
  }
  const refreshWhenVisible = () => {
    if (documentObject?.visibilityState === 'visible') refresh()
  }

  refresh()
  const timer = setIntervalFn(refreshWhenVisible, intervalMs)
  const handleVisibilityChange = () => refreshWhenVisible()
  const handleFocus = () => refresh()
  documentObject?.addEventListener?.('visibilitychange', handleVisibilityChange)
  windowObject?.addEventListener?.('focus', handleFocus)

  return () => {
    cancelled = true
    clearIntervalFn(timer)
    documentObject?.removeEventListener?.('visibilitychange', handleVisibilityChange)
    windowObject?.removeEventListener?.('focus', handleFocus)
  }
}

const readEffectiveConfigVersion = (value) => typeof value === 'function' ? value() : value

export function useOperationalDataRuntime({
  api = defaultApi,
  realtime,
  surface,
  onUnauthorized = () => {},
  globalSyncEnabled = false,
  ordersSyncEnabled = false,
  effectiveConfigVersion = null,
  accessContextId = null,
} = {}) {
  const [business, setBusiness] = useState(null)
  const [bootstrapEffectiveConfig, setBootstrapEffectiveConfig] = useState(null)
  const [bootstrapState, setBootstrapState] = useState('idle')
  const [products, setProducts] = useState([])
  const [clients, setClients] = useState([])
  const [orders, setOrders] = useState([])
  const [tables, setTables] = useState([])
  const [tableTabs, setTableTabs] = useState([])
  const [movements, setMovements] = useState([])
  const [financeSettings, setFinanceSettings] = useState(null)
  const [surfaceState,setSurfaceState]=useState({surface:null,status:'idle'})
  const appliedSurfaceRef=useRef(null)
  const [readModelEnabled,setReadModelEnabled]=useState(false)
  const modeRef=useRef(false)
  const [operationalOrders,setOperationalOrders]=useState([])
  const [openTableTabIds,setOpenTableTabIds]=useState(null)
  const [operationalCounters,setOperationalCounters]=useState({orders:0,comandas:0})
  const [readModelRevision,setReadModelRevision]=useState(0)
  const surfaceRef=useRef(surface);surfaceRef.current=surface
  const bootstrapOwnerRef=useRef(null)
  const bootstrapStateRef=useRef(bootstrapState)
  bootstrapStateRef.current=bootstrapState

  const syncGuardRef = useRef(createCollectionSyncGuard(GUARD_COLLECTIONS))
  const bootstrapSyncInFlightRef = useRef(false)
  const ordersSyncInFlightRef = useRef(false)
  const officialRevisionRef = useRef(0)
  const officialTablesRef = useRef([])
  const officialOrdersRef=useRef([])
  const effectiveConfigVersionRef = useRef(effectiveConfigVersion)
  const onUnauthorizedRef = useRef(onUnauthorized)
  const apiRef = useRef(api)
  const accessContextRef = useRef(accessContextId)
  const stateAccessContextRef = useRef(accessContextId)
  const renderGuard = syncGuardRef.current
  // Invalidate at render time, before an older read or mutation can commit.
  accessContextRef.current = accessContextId

  useEffect(() => { effectiveConfigVersionRef.current = effectiveConfigVersion }, [effectiveConfigVersion])
  useEffect(() => { onUnauthorizedRef.current = onUnauthorized }, [onUnauthorized])
  apiRef.current = api

  const commitTables = useCallback((nextTables) => {
    officialTablesRef.current = nextTables
    setTables(nextTables)
  }, [])

  const commitOrders=useCallback(next=>{
    const value=typeof next==='function'?next(officialOrdersRef.current):next
    officialOrdersRef.current=value;setOrders(value)
  },[])

  const applyBootstrapCollections = useCallback((data, token) => {
    const guard = syncGuardRef.current
    const declared=getScopedBootstrapCollections(data),selected=declared ?? DATA_COLLECTIONS,operational=getScopedOperationalState(data)
    const allowed=key=>selected.includes(key)&&guard.canApply(token,key)
    const receipt = {
      data,expectedCollections:selected,
      collectionsApplied:selected.filter(key=>guard.canApply(token,key)),
      metadataApplied:guard.canApply(token,'operationalCounters'),
      applied:PAYMENT_COLLECTIONS.filter(key=>Array.isArray(data?.[key])&&allowed(key)),
    }
    modeRef.current=declared!==null;setReadModelEnabled(declared!==null)
    if(selected.some(key=>PAYMENT_COLLECTIONS.includes(key)&&allowed(key)))officialRevisionRef.current+=1
    if(allowed('clients'))setClients(Array.isArray(data?.clients)?data.clients:[])
    if(allowed('products'))setProducts(Array.isArray(data?.products)?data.products:[])
    if(allowed('orders'))commitOrders(Array.isArray(data?.orders)?data.orders:[])
    if(allowed('tables'))commitTables(Array.isArray(data?.tables)?data.tables:[])
    if(allowed('tableTabs'))setTableTabs(Array.isArray(data?.tableTabs)?data.tableTabs:[])
    if(allowed('movements'))setMovements(Array.isArray(data?.movements)?data.movements:[])
    if(allowed('financeSettings'))setFinanceSettings(data?.financeSettings ?? null)
    if(declared && receipt.metadataApplied){
      setOperationalCounters(operational.counters)
      setOperationalOrders(operational.orders)
      setOpenTableTabIds(operational.tabs)
    }
    if (data?.business?.id && data?.business?.name) setBusiness(data.business)
    if (data?.effectiveBusinessConfig) setBootstrapEffectiveConfig(data.effectiveBusinessConfig)
    return receipt
  }, [commitTables,commitOrders])

  const applyOfficialEffects = useCallback(({
    order,
    orders: nextOrders,
    deletedOrderIds,
    movement,
    movements: nextMovements,
    deletedMovementId,
    financeSettings: nextFinanceSettings,
    table,
    tables: nextTables,
    tableTab,
    client,
    deletedClientId,
    product,
    deletedProductId,
  }) => {
    if (accessContextRef.current !== accessContextId || renderGuard !== syncGuardRef.current) return false
    const changed = []
    if (order || Array.isArray(nextOrders) || deletedOrderIds?.length) changed.push('orders')
    if (movement || deletedMovementId || Array.isArray(nextMovements)) changed.push('movements')
    if (nextFinanceSettings !== undefined) changed.push('financeSettings')
    if (table || Array.isArray(nextTables)) changed.push('tables')
    if (tableTab) changed.push('tableTabs')
    if (client || deletedClientId) changed.push('clients')
    if (product || deletedProductId) changed.push('products')

    syncGuardRef.current.markMutation([...changed,...(changed.some(key=>['orders','tableTabs','tables'].includes(key))?['operationalCounters']:[])])
    if(changed.length)setReadModelRevision(value=>value+1)
    if(modeRef.current){
      const effectOrders=[...(order?[order]:[]),...(Array.isArray(nextOrders)?nextOrders:[])]
      if(effectOrders.length || deletedOrderIds?.length)setOperationalOrders(current=>upsertManyById(current,effectOrders.map(minimalOrder)).filter(value=>activeOrder(value)&&!deletedOrderIds?.includes(value.id)))
      if(tableTab)setOpenTableTabIds(current=>tableTab.status==='open'?[...new Set([...(current || []),tableTab.id])]:(current || []).filter(id=>id!==tableTab.id))
    }
    if (changed.some((key) => PAYMENT_COLLECTIONS.includes(key))) officialRevisionRef.current += 1
    if (order) commitOrders((current) => upsertById(current, order))
    if (Array.isArray(nextOrders) && nextOrders.length) commitOrders((current) => upsertManyById(current, nextOrders))
    if (Array.isArray(deletedOrderIds) && deletedOrderIds.length) commitOrders((current) => current.filter(({ id }) => !deletedOrderIds.includes(id)))
    if (movement) setMovements((current) => upsertById(current, movement))
    if (Array.isArray(nextMovements) && nextMovements.length) setMovements((current) => upsertManyById(current, nextMovements))
    if (deletedMovementId) setMovements((current) => removeById(current, deletedMovementId))
    if (nextFinanceSettings !== undefined) setFinanceSettings(nextFinanceSettings)
    if (table) commitTables(upsertById(officialTablesRef.current, table))
    if (Array.isArray(nextTables)) commitTables(nextTables)
    if (tableTab) setTableTabs((current) => upsertById(current, tableTab))
    if (client) setClients((current) => upsertById(current, client))
    if (deletedClientId) setClients((current) => removeById(current, deletedClientId))
    if (product) setProducts((current) => upsertById(current, product))
    if (deletedProductId) setProducts((current) => removeById(current, deletedProductId))

    return {
      applied: changed,
      data: {
        orders: nextOrders,
        movements: nextMovements,
        tableTabs: tableTab ? [tableTab] : undefined,
        tables: nextTables,
      },
    }
  }, [accessContextId, commitTables,commitOrders, renderGuard])

  const refreshBootstrap = useCallback(({ background = false } = {}) => {
    if(bootstrapSyncInFlightRef.current && bootstrapOwnerRef.current?.surface===surfaceRef.current)return bootstrapSyncInFlightRef.current
    bootstrapOwnerRef.current?.controller?.abort()
    const owner={surface:surfaceRef.current,controller:typeof AbortController==='function'?new AbortController():null}
    bootstrapOwnerRef.current=owner
    if(owner.surface!==undefined&&appliedSurfaceRef.current!==owner.surface)setSurfaceState({surface:owner.surface,status:'loading'})
    const guard = syncGuardRef.current
    const readAccessContext = accessContextRef.current
    const token = guard.beginRead(GUARD_COLLECTIONS)
    if (!background) setBootstrapState('loading')

    const read = async () => {
      try {
        const configVersion = readEffectiveConfigVersion(effectiveConfigVersionRef.current)
        const data = owner.surface===undefined?await apiRef.current.getBootstrap(background?configVersion:undefined):await apiRef.current.getBootstrap(background?configVersion:undefined,{surface:owner.surface,signal:owner.controller?.signal})
        if (guard !== syncGuardRef.current || readAccessContext !== accessContextRef.current || owner!==bootstrapOwnerRef.current || owner.surface!==surfaceRef.current) return false
        if(data.readModel && owner.surface!==undefined && data.readModel.surface!==owner.surface)throw new TypeError('Unexpected bootstrap surface')
        const receipt = applyBootstrapCollections(data, token)
        appliedSurfaceRef.current=owner.surface;setSurfaceState({surface:owner.surface,status:'ready'})
        if(bootstrapStateRef.current!=='ready')setBootstrapState('ready')
        return receipt
      } catch (error) {
        if (guard !== syncGuardRef.current || readAccessContext !== accessContextRef.current || owner!==bootstrapOwnerRef.current) return false
        if (error?.code === 'SESSION_CONTEXT_CHANGED' || error?.status === 401 || (error?.status === 403 && error?.code === 'ACCESS_CHANGED')) onUnauthorizedRef.current(error)
        else {if(!background)setBootstrapState('error');if(appliedSurfaceRef.current!==owner.surface)setSurfaceState({surface:owner.surface,status:'error'})}
        return false
      } finally {
        if(bootstrapOwnerRef.current===owner){bootstrapSyncInFlightRef.current=false;bootstrapOwnerRef.current=null}
      }
    }

    const pending = read()
    bootstrapSyncInFlightRef.current = pending
    return pending
  }, [applyBootstrapCollections])

  const refreshBootstrapSilently = useCallback(() => refreshBootstrap({ background: true }), [refreshBootstrap])

  const refreshOrders = useCallback(async () => {
    if (ordersSyncInFlightRef.current) return ordersSyncInFlightRef.current
    const guard = syncGuardRef.current
    const readAccessContext = accessContextRef.current
    const token = guard.beginRead(['orders','operationalCounters'])
    const readSurface=surfaceRef.current
    const read = async () => {
      try {
        const data = await (modeRef.current?apiRef.current.getActiveOrders():apiRef.current.getOrders())
        if (guard !== syncGuardRef.current || readAccessContext !== accessContextRef.current || readSurface!==surfaceRef.current || !Array.isArray(data?.orders) || !guard.canApply(token, 'orders')) return false
        officialRevisionRef.current += 1
        commitOrders(data.orders)
        if(modeRef.current&&guard.canApply(token,'operationalCounters'))setOperationalOrders(data.orders.filter(activeOrder).map(minimalOrder))
        return data.orders
      } catch (error) {
        if (guard === syncGuardRef.current && readAccessContext === accessContextRef.current && (error?.code === 'SESSION_CONTEXT_CHANGED' || error?.status === 401 || (error?.status === 403 && error?.code === 'ACCESS_CHANGED'))) onUnauthorizedRef.current(error)
        return false
      } finally {
        if (guard === syncGuardRef.current) ordersSyncInFlightRef.current = false
      }
    }
    const pending = read()
    ordersSyncInFlightRef.current = pending
    return pending
  }, [commitOrders])

  const readOrdersByIds = useCallback(async ids => {
    const unique=[...new Set(ids || [])]
    if(!unique.length)return {applied:true}
    if(unique.length>99)return {applied:false,needsSnapshot:true}
    if(ordersSyncInFlightRef.current)return {applied:false,retryMs:250}
    const guard=syncGuardRef.current,readAccessContext=accessContextRef.current,token=guard.beginRead(['orders','operationalCounters'])
    const read=async()=>{
      try {
        const data=await apiRef.current.getOrdersByIds(unique)
        if(guard!==syncGuardRef.current || readAccessContext!==accessContextRef.current || !guard.canApply(token,'orders'))return {applied:false,retryMs:250}
        if(!Array.isArray(data?.orders) || data.orders.some(order=>!unique.includes(order?.id)))return {applied:false,retryMs:30_000}
        officialRevisionRef.current+=1
        commitOrders(current=>upsertManyInCreatedOrder(current,data.orders))
        if(modeRef.current&&guard.canApply(token,'operationalCounters'))setOperationalOrders(current=>upsertManyById(current,data.orders.map(minimalOrder)).filter(activeOrder))
        const returned=new Set(data.orders.map(order=>order.id))
        return unique.some(id=>!returned.has(id))?{applied:false,needsSnapshot:true}:{applied:true}
      } catch(error){
        if(guard===syncGuardRef.current && readAccessContext===accessContextRef.current && (error?.code==='SESSION_CONTEXT_CHANGED' || error?.status===401 || error?.status===403 && error?.code==='ACCESS_CHANGED'))onUnauthorizedRef.current(error)
        return {applied:false,retryMs:30_000}
      } finally {if(guard===syncGuardRef.current)ordersSyncInFlightRef.current=false}
    }
    const pending=read();ordersSyncInFlightRef.current=pending;return pending
  },[commitOrders])
  const refreshOrdersByIds=useCallback(async ids=>(await readOrdersByIds(ids)).applied,[readOrdersByIds])

  const refreshOrdersForAction=useCallback(async ids=>{
    if(!Array.isArray(ids)||ids.length<1||ids.length>100||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!id.trim()))return false
    const owner=accessContextRef.current,guard=syncGuardRef.current
    for(let offset=0;offset<ids.length;offset+=99){
      let accepted=false
      for(let attempt=0;attempt<2&&!accepted;attempt++){
        await Promise.all([bootstrapSyncInFlightRef.current,ordersSyncInFlightRef.current].filter(Boolean))
        if(owner!==accessContextRef.current||guard!==syncGuardRef.current)return false
        const result=await readOrdersByIds(ids.slice(offset,offset+99))
        if(owner!==accessContextRef.current||guard!==syncGuardRef.current)return false
        accepted=result.applied
        if(result.needsSnapshot)return false
      }
      if(!accepted)return false
    }
    return true
  },[readOrdersByIds])

  const resetOperationalData = useCallback(() => {
    bootstrapOwnerRef.current?.controller?.abort();bootstrapOwnerRef.current=null
    appliedSurfaceRef.current=null;setSurfaceState({surface:null,status:'idle'})
    modeRef.current=false;setReadModelEnabled(false);setOperationalOrders([]);setOpenTableTabIds(null);setOperationalCounters({orders:0,comandas:0});setReadModelRevision(0)
    syncGuardRef.current = createCollectionSyncGuard(GUARD_COLLECTIONS)
    bootstrapSyncInFlightRef.current = false
    ordersSyncInFlightRef.current = false
    officialRevisionRef.current = 0
    officialTablesRef.current = []
    setBusiness(null)
    setBootstrapEffectiveConfig(null)
    setBootstrapState('idle')
    setClients([])
    setProducts([])
    commitOrders([])
    setTables([])
    setTableTabs([])
    setMovements([])
    setFinanceSettings(null)
  }, [commitOrders])

  useLayoutEffect(() => {
    if (stateAccessContextRef.current === accessContextId) return
    stateAccessContextRef.current = accessContextId
    resetOperationalData()
  }, [accessContextId, resetOperationalData])

  useEffect(() => {
    if (realtime || !globalSyncEnabled || bootstrapState !== 'ready') return undefined
    return createRefreshSubscription({
      run: refreshBootstrapSilently,
      intervalMs: GLOBAL_SYNC_INTERVAL_MS,
    })
  }, [bootstrapState, globalSyncEnabled, realtime, refreshBootstrapSilently])

  useEffect(() => {
    if (realtime || !ordersSyncEnabled || bootstrapState !== 'ready') return undefined
    return createRefreshSubscription({
      run: refreshOrders,
      intervalMs: ORDER_SYNC_INTERVAL_MS,
    })
  }, [bootstrapState, ordersSyncEnabled, realtime, refreshOrders])

  useEffect(()=>{if(surface!==undefined&&bootstrapStateRef.current!=='idle')void refreshBootstrapSilently()},[surface,refreshBootstrapSilently])

  const subscribeRealtime=realtime?.subscribeInvalidations
  const realtimeOrdersEnabled=globalSyncEnabled || ordersSyncEnabled
  useEffect(()=>{
    if(!subscribeRealtime || !realtimeOrdersEnabled)return undefined
    const guard=syncGuardRef.current,context=accessContextId
    let dirty=null,scheduled=null,inFlight=null,retryTimer=null,disposed=false
    const current=()=>!disposed && guard===syncGuardRef.current && context===accessContextRef.current
    function merge(work){
      dirty ??= {full:false,ids:new Set()}
      dirty.full ||= work.full
      if(!dirty.full)for(const id of work.ids){dirty.ids.add(id);if(dirty.ids.size>99){dirty.full=true;break}}
      if(dirty.full)dirty.ids.clear()
    }
    function schedule(){
      if(!current() || !dirty || retryTimer!==null || inFlight || scheduled)return
      scheduled=Promise.resolve().then(()=>{
        scheduled=null
        if(!current())return
        inFlight=drain().finally(()=>{inFlight=null;schedule()})
        return inFlight
      })
    }
    const retry=ms=>{retryTimer=setTimeout(()=>{retryTimer=null;schedule()},ms)}
    async function drain(){
      const work=dirty;dirty=null
      await Promise.all([bootstrapSyncInFlightRef.current,ordersSyncInFlightRef.current].filter(Boolean))
      if(!current())return
      if(bootstrapStateRef.current!=='ready'){merge(work);retry(250);return}
      let result
      if(work.full && globalSyncEnabled){
        const receipt=await refreshBootstrapSilently()
        result={applied:Boolean(receipt) && receipt.collectionsApplied?.length===(receipt.expectedCollections?.length ?? DATA_COLLECTIONS.length)&&receipt.metadataApplied!==false,retryMs:receipt?250:30_000}
      } else if(work.full){
        const orders=await refreshOrders()
        result={applied:Array.isArray(orders),retryMs:30_000}
      } else result=await readOrdersByIds([...work.ids])
      if(!current() || result.applied)return
      if(result.needsSnapshot)work.full=true
      merge(work)
      if(!result.needsSnapshot)retry(result.retryMs || 30_000)
    }
    const unsubscribe=subscribeRealtime(event=>{
      if(!current())return
      const topics=event.topics || []
      const other=globalSyncEnabled && topics.some(topic=>['tables','reservations','clients','catalog','finance','settings'].includes(topic))
      if(!other && !topics.includes('orders'))return
      merge({full:other || event.requiresFullRefresh || !event.orderIds?.length,ids:event.orderIds || []})
      schedule();return scheduled || inFlight
    })
    return()=>{disposed=true;unsubscribe();if(retryTimer!==null)clearTimeout(retryTimer)}
  },[accessContextId,surface,globalSyncEnabled,realtimeOrdersEnabled,readOrdersByIds,refreshBootstrapSilently,refreshOrders,subscribeRealtime])

  const getSyncGuard=useCallback(()=>syncGuardRef.current,[])
  const getOfficialRevision=useCallback(()=>officialRevisionRef.current,[])
  const getOfficialOrders=useCallback(()=>stateAccessContextRef.current===accessContextRef.current?officialOrdersRef.current:[],[])
  const getOfficialTables=useCallback(()=>stateAccessContextRef.current===accessContextRef.current?officialTablesRef.current:[],[])
  return useMemo(() => {
    const currentAccess = stateAccessContextRef.current === accessContextId
    return {
      surfaceState:currentAccess&&surfaceState.surface===surface?surfaceState.status:'loading',
      readModelEnabled:currentAccess&&readModelEnabled,
      readModelRevision:currentAccess?readModelRevision:0,
      operationalOrders:currentAccess?operationalOrders:[],
      operationalCounters:currentAccess?{...operationalCounters,comandas:openTableTabIds?.length ?? operationalCounters.comandas}:{orders:0,comandas:0},
      business: currentAccess ? business : null,
      bootstrapState: currentAccess ? bootstrapState : 'idle',
      bootstrapEffectiveConfig: currentAccess ? bootstrapEffectiveConfig : null,
      clients: currentAccess ? clients : [],
      products: currentAccess ? products : [],
      orders: currentAccess ? orders : [],
      tables: currentAccess ? tables : [],
      tableTabs: currentAccess ? tableTabs : [],
      movements: currentAccess ? movements : [],
      financeSettings: currentAccess ? financeSettings : null,
      refreshBootstrap,
      refreshBootstrapSilently,
      refreshOrders,
      refreshOrdersByIds,refreshOrdersForAction,
      applyOfficialEffects,
      resetOperationalData,
      getSyncGuard,getOfficialRevision,getOfficialTables,getOfficialOrders,
    }
  }, [
    accessContextId,
    surface,surfaceState,getSyncGuard,getOfficialRevision,getOfficialTables,getOfficialOrders,refreshOrdersForAction,
    readModelEnabled,readModelRevision,operationalOrders,operationalCounters,openTableTabIds,
    applyOfficialEffects,
    business,
    bootstrapEffectiveConfig,
    bootstrapState,
    clients,
    financeSettings,
    movements,
    orders,
    products,
    refreshBootstrap,
    refreshBootstrapSilently,
    refreshOrders,
    refreshOrdersByIds,
    resetOperationalData,
    tableTabs,
    tables,
  ])
}
