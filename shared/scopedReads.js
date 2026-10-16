// Wire contract only; authorization remains in the Worker.
export const READ_SURFACE_IDS=Object.freeze([
  'shell','my-account','access-team','access-activity','settings-home',
  'settings-business-profile','settings-operations','settings-modalities','settings-payments',
  'settings-cancellations','settings-finance-categories','settings-kitchen-tv','settings-printing','settings-device',
  'orders','history','kitchen-tv-control','new-order','comandas','print-queue',
  'dashboard','reports','receivables','finance','clients','products','tables',
])
export const SCOPED_COLLECTIONS=Object.freeze(['clients','products','orders','tables','tableTabs','movements','financeSettings'])
export function getScopedBootstrapCollections(payload){
  if(payload?.readModel===undefined)return null
  const descriptor=payload.readModel,collections=descriptor?.completeCollections
  if(descriptor?.version!==1 || !Array.isArray(collections) || new Set(collections).size!==collections.length
    || collections.some(key=>!SCOPED_COLLECTIONS.includes(key) || !Object.hasOwn(payload,key)
      || (key==='financeSettings'?payload[key]!==null && (typeof payload[key]!=='object' || Array.isArray(payload[key])):!Array.isArray(payload[key])))){
    throw new TypeError('Invalid scoped bootstrap collections')
  }
  return [...collections]
}

export function getScopedOperationalState(payload){
  if(getScopedBootstrapCollections(payload)===null)return null
  const descriptor=payload.readModel,counters=descriptor.counters || {orders:0,comandas:0}
  const orders=descriptor.operationalOrders || [],tabs=descriptor.openTableTabIds ?? null
  const validId=value=>typeof value==='string'&&value.length>0&&value.length<=256
  if(![counters.orders,counters.comandas,...(counters.refunds===undefined?[]:[counters.refunds])].every(value=>Number.isSafeInteger(value)&&value>=0)
    || !Array.isArray(orders) || new Set(orders.map(order=>order?.id)).size!==orders.length
    || orders.some(order=>!validId(order?.id)||!['Em preparo','Agendado'].includes(order.status)
      || order.createdAt!==undefined&&typeof order.createdAt!=='string' || order.scheduledFor!==undefined&&order.scheduledFor!==null&&typeof order.scheduledFor!=='string')
    || tabs!==null&&(!Array.isArray(tabs)||tabs.some(id=>!validId(id))||new Set(tabs).size!==tabs.length))throw new TypeError('Invalid scoped operational metadata')
  return {counters,orders,tabs}
}
