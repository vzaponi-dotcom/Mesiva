import {useScopedQuery} from '../../../infrastructure/realtime/useScopedQuery.js'
export function useCustomerReadModel({api,accessContextId,realtime,guard,officialRevision,onUnauthorized,enabled=false,search='',sort='name-asc',filter='all',clientId,orderFilter='all'}={}){
  const common={accessContextId,realtime,guard,officialRevision,onUnauthorized,topics:['clients','orders','finance','settings'],collections:['clients','orders']}
  const list=useScopedQuery({...common,enabled,queryKey:JSON.stringify(['customers',search,sort,filter]),
    load:({cursor,signal})=>api.getCustomers({search,sort,filter,cursor},{signal})})
  const relationship=useScopedQuery({...common,enabled:enabled&&Boolean(clientId),queryKey:JSON.stringify(['customer',clientId,orderFilter]),
    load:({cursor,signal})=>api.getCustomerRelationship(clientId,{filter:orderFilter,cursor},{signal})})
  return {list,relationship}
}
