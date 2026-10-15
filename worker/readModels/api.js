import {readOrderHistory} from './orderHistoryRepository.js'
import {json} from '../http.js'
import {requireCapability} from '../access/authorization.js'
import {projectOrderList} from '../access/projections.js'
import {listActiveOrders} from '../orderReadRepository.js'
export const readModelsEnabled=env=>env.OPERATIONAL_READ_MODELS_ENABLED===true || env.OPERATIONAL_READ_MODELS_ENABLED==='true'
export async function handleReadModelsApi(request,env,context,url){
  if(!readModelsEnabled(env) || request.method!=='GET')return null
  if(url.pathname==='/api/reads/orders/history'){
    const query=Object.fromEntries(['period','filter','search','startDate','endDate','cursor','limit'].filter(key=>url.searchParams.has(key)).map(key=>[key,url.searchParams.get(key)]))
    return json(await readOrderHistory(env.DB,context.businessId,{...query,granted:context.granted}))
  }
  if(url.pathname==='/api/reads/orders/active'){
    requireCapability(context,'orders.view')
    return json({orders:projectOrderList(await listActiveOrders(env.DB,context.businessId),context.granted)})
  }
  return null
}
