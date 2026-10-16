import {apiRequest} from './httpClient.js'
const queryKeys=['period','filter','search','startDate','endDate','cursor','limit','sort','mode','view','clientId','groupBy','timing','groupKey','exactDateFilter','type','category','paymentMethod','name','phone','excludeId']
export function createScopedReadsApi({request=apiRequest}={}){
  const read=(path,query={},options={})=>{
    const params=new URLSearchParams()
    for(const key of queryKeys)if(query[key]!==undefined && query[key]!==null && query[key]!=='')params.set(key,String(query[key]))
    const url=path+(params.size?'?'+params:'')
    return options.signal?request(url,{signal:options.signal}):request(url)
  }
  return Object.freeze({
    getKitchenSummary:(options={})=>read('/api/reads/orders/kitchen-summary',{},options),
    getActiveOrders:(options={})=>read('/api/reads/orders/active',{},options),
    getHistory:(query,options)=>read('/api/reads/orders/history',query,options),
    getCustomers:(query,options)=>read('/api/reads/customers',query,options),
    getCustomerDuplicates:(query,options)=>read('/api/reads/customers/duplicates',query,options),
    getCustomerRelationship:(id,query,options)=>read(`/api/reads/customers/${encodeURIComponent(id)}/relationship`,query,options),
    getReceivables:(query,options)=>read('/api/reads/finance/receivables',query,options),
    getFinanceOverview:(query,options)=>read('/api/reads/finance/overview',query,options),
    getMovements:(query,options)=>read('/api/reads/finance/movements',query,options),
  })
}
