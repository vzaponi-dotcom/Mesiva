import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { getBootstrap } from '../../../infrastructure/api/bootstrapApi.js'
import { ordersApi } from '../../../domains/orders/index.js'
import { createCollectionSyncGuard, removeById, upsertById, upsertManyById, upsertManyInCreatedOrder } from './dataSync.js'

export const GLOBAL_SYNC_INTERVAL_MS = 5_000
export const ORDER_SYNC_INTERVAL_MS = 2_000

const DATA_COLLECTIONS = ['clients', 'products', 'orders', 'tables', 'tableTabs', 'movements', 'financeSettings']
const PAYMENT_COLLECTIONS = ['orders', 'movements', 'tableTabs', 'tables']

const defaultApi = { getBootstrap, getOrders: ordersApi.getOrders, getOrdersByIds: ordersApi.getOrdersByIds }
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
  const bootstrapStateRef=useRef(bootstrapState)
  bootstrapStateRef.current=bootstrapState

  const syncGuardRef = useRef(createCollectionSyncGuard(DATA_COLLECTIONS))
  const bootstrapSyncInFlightRef = useRef(false)
  const ordersSyncInFlightRef = useRef(false)
  const officialRevisionRef = useRef(0)
  const officialTablesRef = useRef([])
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

  const applyBootstrapCollections = useCallback((data, token) => {
    const guard = syncGuardRef.current
    const receipt = {
      data,
      collectionsApplied: DATA_COLLECTIONS.filter(key=>guard.canApply(token,key)),
      applied: PAYMENT_COLLECTIONS.filter((key) => Array.isArray(data?.[key]) && guard.canApply(token, key)),
    }
    if (PAYMENT_COLLECTIONS.some((key) => guard.canApply(token, key))) officialRevisionRef.current += 1
    if (guard.canApply(token, 'clients')) setClients(Array.isArray(data?.clients) ? data.clients : [])
    if (guard.canApply(token, 'products')) setProducts(Array.isArray(data?.products) ? data.products : [])
    if (guard.canApply(token, 'orders')) setOrders(Array.isArray(data?.orders) ? data.orders : [])
    if (guard.canApply(token, 'tables')) commitTables(Array.isArray(data?.tables) ? data.tables : [])
    if (guard.canApply(token, 'tableTabs')) setTableTabs(Array.isArray(data?.tableTabs) ? data.tableTabs : [])
    if (guard.canApply(token, 'movements')) setMovements(Array.isArray(data?.movements) ? data.movements : [])
    if (guard.canApply(token, 'financeSettings')) setFinanceSettings(data?.financeSettings ?? null)
    if (data?.business?.id && data?.business?.name) setBusiness(data.business)
    if (data?.effectiveBusinessConfig) setBootstrapEffectiveConfig(data.effectiveBusinessConfig)
    return receipt
  }, [commitTables])

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

    syncGuardRef.current.markMutation(changed)
    if (changed.some((key) => PAYMENT_COLLECTIONS.includes(key))) officialRevisionRef.current += 1
    if (order) setOrders((current) => upsertById(current, order))
    if (Array.isArray(nextOrders) && nextOrders.length) setOrders((current) => upsertManyById(current, nextOrders))
    if (Array.isArray(deletedOrderIds) && deletedOrderIds.length) setOrders((current) => current.filter(({ id }) => !deletedOrderIds.includes(id)))
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
  }, [accessContextId, commitTables, renderGuard])

  const refreshBootstrap = useCallback(({ background = false } = {}) => {
    if (bootstrapSyncInFlightRef.current) return bootstrapSyncInFlightRef.current
    const guard = syncGuardRef.current
    const readAccessContext = accessContextRef.current
    const token = guard.beginRead(DATA_COLLECTIONS)
    if (!background) setBootstrapState('loading')

    const read = async () => {
      try {
        const configVersion = readEffectiveConfigVersion(effectiveConfigVersionRef.current)
        const data = await apiRef.current.getBootstrap(background ? configVersion : undefined)
        if (guard !== syncGuardRef.current || readAccessContext !== accessContextRef.current) return false
        const receipt = applyBootstrapCollections(data, token)
        if (!background) setBootstrapState('ready')
        return receipt
      } catch (error) {
        if (guard !== syncGuardRef.current || readAccessContext !== accessContextRef.current) return false
        if (error?.code === 'SESSION_CONTEXT_CHANGED' || error?.status === 401 || (error?.status === 403 && error?.code === 'ACCESS_CHANGED')) onUnauthorizedRef.current(error)
        else if (!background) setBootstrapState('error')
        return false
      } finally {
        if (guard === syncGuardRef.current) bootstrapSyncInFlightRef.current = false
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
    const token = guard.beginRead(['orders'])
    const read = async () => {
      try {
        const data = await apiRef.current.getOrders()
        if (guard !== syncGuardRef.current || readAccessContext !== accessContextRef.current || !Array.isArray(data?.orders) || !guard.canApply(token, 'orders')) return false
        officialRevisionRef.current += 1
        setOrders(data.orders)
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
  }, [])

  const readOrdersByIds = useCallback(async ids => {
    const unique=[...new Set(ids || [])]
    if(!unique.length)return {applied:true}
    if(unique.length>99)return {applied:false,needsSnapshot:true}
    if(ordersSyncInFlightRef.current)return {applied:false,retryMs:250}
    const guard=syncGuardRef.current,readAccessContext=accessContextRef.current,token=guard.beginRead(['orders'])
    const read=async()=>{
      try {
        const data=await apiRef.current.getOrdersByIds(unique)
        if(guard!==syncGuardRef.current || readAccessContext!==accessContextRef.current || !guard.canApply(token,'orders'))return {applied:false,retryMs:250}
        if(!Array.isArray(data?.orders) || data.orders.some(order=>!unique.includes(order?.id)))return {applied:false,retryMs:30_000}
        officialRevisionRef.current+=1
        setOrders(current=>upsertManyInCreatedOrder(current,data.orders))
        const returned=new Set(data.orders.map(order=>order.id))
        return unique.some(id=>!returned.has(id))?{applied:false,needsSnapshot:true}:{applied:true}
      } catch(error){
        if(guard===syncGuardRef.current && readAccessContext===accessContextRef.current && (error?.code==='SESSION_CONTEXT_CHANGED' || error?.status===401 || error?.status===403 && error?.code==='ACCESS_CHANGED'))onUnauthorizedRef.current(error)
        return {applied:false,retryMs:30_000}
      } finally {if(guard===syncGuardRef.current)ordersSyncInFlightRef.current=false}
    }
    const pending=read();ordersSyncInFlightRef.current=pending;return pending
  },[])
  const refreshOrdersByIds=useCallback(async ids=>(await readOrdersByIds(ids)).applied,[readOrdersByIds])

  const resetOperationalData = useCallback(() => {
    syncGuardRef.current = createCollectionSyncGuard(DATA_COLLECTIONS)
    bootstrapSyncInFlightRef.current = false
    ordersSyncInFlightRef.current = false
    officialRevisionRef.current = 0
    officialTablesRef.current = []
    setBusiness(null)
    setBootstrapEffectiveConfig(null)
    setBootstrapState('idle')
    setClients([])
    setProducts([])
    setOrders([])
    setTables([])
    setTableTabs([])
    setMovements([])
    setFinanceSettings(null)
  }, [])

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
        result={applied:Boolean(receipt) && receipt.collectionsApplied?.length===DATA_COLLECTIONS.length,retryMs:receipt?250:30_000}
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
  },[accessContextId,globalSyncEnabled,realtimeOrdersEnabled,readOrdersByIds,refreshBootstrapSilently,refreshOrders,subscribeRealtime])

  return useMemo(() => {
    const currentAccess = stateAccessContextRef.current === accessContextId
    return {
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
      refreshOrdersByIds,
      applyOfficialEffects,
      resetOperationalData,
      getSyncGuard: () => syncGuardRef.current,
      getOfficialRevision: () => officialRevisionRef.current,
      getOfficialTables: () => stateAccessContextRef.current === accessContextRef.current ? officialTablesRef.current : [],
    }
  }, [
    accessContextId,
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
