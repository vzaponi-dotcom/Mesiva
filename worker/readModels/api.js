import {readKitchenSummary} from './kitchenSummary.js'
import {readCustomers,readCustomerRelationship,readCustomerDuplicates} from './customerReadRepository.js'
import {readReceivables,readFinanceOverview,readFinanceMovements} from './financeReadRepository.js'
import {readOrderHistory} from './orderHistoryRepository.js'
import {json} from '../http.js'
import {requireCapability} from '../access/authorization.js'
import {projectOrderList} from '../access/projections.js'
import {listActiveOrders} from '../orderReadRepository.js'
export const readModelsEnabled=env=>env.OPERATIONAL_READ_MODELS_ENABLED===true || env.OPERATIONAL_READ_MODELS_ENABLED==='true'
export async function handleReadModelsApi(request,env,context,url){
  if(!readModelsEnabled(env) || request.method!=='GET')return null
  if(url.pathname==='/api/reads/orders/kitchen-summary')return json(await readKitchenSummary(env.DB,context.businessId,{granted:context.granted}))
  if(url.pathname==='/api/reads/orders/history'){
    const query=Object.fromEntries(['period','filter','search','startDate','endDate','cursor','limit'].filter(key=>url.searchParams.has(key)).map(key=>[key,url.searchParams.get(key)]))
    return json(await readOrderHistory(env.DB,context.businessId,{...query,granted:context.granted}))
  }
  if(url.pathname==='/api/reads/orders/active'){
    requireCapability(context,'orders.view')
    return json({orders:projectOrderList(await listActiveOrders(env.DB,context.businessId),context.granted)})
  }
  const endpoints={
    '/api/reads/customers':readCustomers,
    '/api/reads/customers/duplicates':readCustomerDuplicates,
    '/api/reads/finance/receivables':readReceivables,
    '/api/reads/finance/overview':readFinanceOverview,
    '/api/reads/finance/movements':readFinanceMovements,
  }
  const relationship=/^\/api\/reads\/customers\/([^/]+)\/relationship$/.exec(url.pathname)
  const endpoint=Object.hasOwn(endpoints,url.pathname)?endpoints[url.pathname]:null
  if(endpoint || relationship){
    const allowed=['period','filter','search','startDate','endDate','cursor','limit','sort','mode','view','timing','groupKey','exactDateFilter','type','category','paymentMethod','name','phone','excludeId']
    const query=Object.fromEntries(allowed.filter(key=>url.searchParams.has(key)).map(key=>[key,url.searchParams.get(key)]))
    const options={...query,granted:context.granted}
    return json(endpoint?await endpoint(env.DB,context.businessId,options):await readCustomerRelationship(env.DB,context.businessId,decodeURIComponent(relationship[1]),options))
  }
  return null
}
