import {apiError} from '../http.js'
import {requireCapability} from '../access/authorization.js'
import {projectOrderList} from '../access/projections.js'
import {listOrdersByIds} from '../orderReadRepository.js'
import {mapClientRow} from '../repositories.js'
import {sha256Hex} from '../auth.js'
import {buildClientRelationships,filterAndSortClients} from '../../shared/customerReadRules.js'
import {readOrderHeaders,readHeaderItems} from './orderHeaders.js'
import {parseReadLimit,rankPage,readEnum,readSearch} from './query.js'
const withoutOrders=profile=>{const {orders:_,...summary}=profile;return summary}
const completeHistory=granted=>granted.has('orders.view')&&granted.has('orders.history')
export async function readCustomers(db,businessId,{granted,now=new Date(),...input}={}){
  requireCapability({granted},'clients.view')
  const search=readSearch(input.search),sort=readEnum(input.sort,['name-asc','name-desc','recent','orders'],'name-asc')
  const filter=readEnum(input.filter,['all','pending','inactive','empty'],'all'),complete=completeHistory(granted)
  const clients=(await db.prepare('SELECT id,name,phone,address FROM clients WHERE business_id=? ORDER BY name COLLATE NOCASE ASC').bind(businessId).all()).results.map(mapClientRow)
  const profiles=buildClientRelationships(clients,await readOrderHeaders(db,businessId,{granted,customersOnly:true}),{now})
  const selected=filterAndSortClients(clients,{search,sort,filter:complete?filter:'all',relationships:profiles})
  const queryKey=await sha256Hex(JSON.stringify([businessId,'clients',search,sort,filter,[...granted].sort()]))
  const {page,nextCursor}=rankPage(selected,{queryKey,cursor:input.cursor,limit:parseReadLimit(input.limit)})
  return {clients:page.map(client=>({...client,profile:withoutOrders(profiles.get(client.id))})),summary:{count:selected.length},completeHistory:complete,completeWithinScope:false,nextCursor,queryKey}
}
export async function readCustomerRelationship(db,businessId,id,{granted,now=new Date(),...input}={}){
  requireCapability({granted},'clients.view')
  const filter=readEnum(input.filter,['all','pending','finished','cancelled'],'all')
  const row=await db.prepare('SELECT id,name,phone,address FROM clients WHERE business_id=? AND id=?').bind(businessId,id).first()
  if(!row)throw apiError(404,'CLIENT_NOT_FOUND','Cliente não encontrado.')
  const client=mapClientRow(row),headers=await readOrderHeaders(db,businessId,{granted,clientId:id})
  let profile=buildClientRelationships([client],headers,{now}).get(id)
  // Only favorites need historical item fields; order details remain paginated.
  if(completeHistory(granted)){
    const purchases=await readHeaderItems(db,businessId,profile.orders.filter(order=>order.status!=='Cancelado'))
    profile={...profile,favorites:buildClientRelationships([client],purchases,{now}).get(id).favorites}
  }
  const eligible=order=>filter==='pending'?order.paymentStatus!=='Pago'&&order.status!=='Cancelado':filter==='finished'?order.status==='Finalizado':filter==='cancelled'?order.status==='Cancelado':true
  const selected=profile.orders.filter(eligible)
  const queryKey=await sha256Hex(JSON.stringify([businessId,'client',id,filter,[...granted].sort()]))
  const {page,nextCursor}=rankPage(selected,{queryKey,cursor:input.cursor,limit:parseReadLimit(input.limit)})
  const official=new Map(projectOrderList(await listOrdersByIds(db,businessId,page.map(o=>o.id)),granted).filter(order=>order.clientId===id&&eligible(order)).map(o=>[o.id,o]))
  return {client,profile:withoutOrders(profile),orders:page.map(o=>official.get(o.id)).filter(Boolean),summary:{count:selected.length},completeHistory:completeHistory(granted),completeWithinScope:false,nextCursor,queryKey}
}
