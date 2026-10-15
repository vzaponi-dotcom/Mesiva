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
