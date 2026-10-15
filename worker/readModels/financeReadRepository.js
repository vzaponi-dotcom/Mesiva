import {loadFinanceSettings} from '../financeRepository.js'
import {getFinancePeriodRange} from '../../shared/cashFlowReadRules.js'
import * as dashboardRules from '../../shared/dashboardReadRules.js'
import {readDashboardAnalytics} from './dashboardReads.js'
import {readFinanceTotals,readReceivedToday,readPeriodMovements,selectMovementPage,canReadMovements} from './movementReads.js'
import {requireCapability,requireAnyCapability} from '../access/authorization.js'
import {projectOrderList} from '../access/projections.js'
import {sha256Hex} from '../auth.js'
import {listOrdersByIds} from '../orderReadRepository.js'
import {getBusinessDate} from '../../shared/finance.js'
import {isOrderPaid,getPendingAmount} from '../../shared/orderPaymentRead.js'
import {getOrderItemsSearchText} from '../../shared/orderCartRead.js'
import {paymentSearchText} from '../../shared/paymentPresentation.js'
import * as receivables from '../../shared/receivableReadRules.js'
import {readOrderHeaders,readHeaderItems} from './orderHeaders.js'
import {parseReadLimit,rankPage,readEnum,readSearch,readCalendarDate} from './query.js'
const orderRules={isOrderCancelled:order=>order.status==='Cancelado',isOrderPaid,getPendingAmount}
const compactGroup=group=>{const {entries:_,orders:__,...metadata}=group;return metadata}
export async function readReceivables(db,businessId,{granted,now=new Date(),...input}={}){
  const view=readEnum(input.view,['pending','paid','refunds'],'pending')
  if(view==='refunds')requireAnyCapability({granted},['finance.movements','finance.movements.manage'])
  else requireCapability({granted},'finance.receivables')
  const mode=readEnum(input.mode,['orders','client','quick'],'client'),sort=readEnum(input.sort,['urgency','recent','value-desc'],'urgency')
  const timing=readEnum(input.timing,['all','overdue','today','upcoming'],'all'),search=readSearch(input.search).toLowerCase()
  const groupKey=readSearch(input.groupKey),exactDateFilter=readCalendarDate(input.exactDateFilter)
  const today=getBusinessDate(now),limit=parseReadLimit(input.limit)
  const receivedToday=await readReceivedToday(db,businessId,granted,today)
  const pending=await readOrderHeaders(db,businessId,{granted,kind:'unpaid'})
  const summary=receivables.calculateReceivableSummary(pending,today,orderRules),forecast=receivables.buildReceivablesForecast(pending,today,7,orderRules)
  let headers=view==='pending'?pending:await readOrderHeaders(db,businessId,{granted,kind:view==='refunds'?'refund':undefined,paid:view==='paid',searchPayments:Boolean(search)})
  if(search)headers=await readHeaderItems(db,businessId,headers)
  const matches=order=>!search || [order.client,view==='pending'?order.clientPhone:'',String(order.id),order.type,order.orderDate,getOrderItemsSearchText(order),view==='paid'?paymentSearchText(order.paymentAllocations,order.paymentMethod):''].join(' ').toLowerCase().includes(search)
  let entries
  if(view==='pending')entries=receivables.sortReceivableEntries(receivables.buildPendingReceivableEntries(headers,today,orderRules).filter(e=>matches(e.order)&&(timing==='all'||e.timing.status===timing)&&(!exactDateFilter||e.expectedDate===exactDateFilter)),sort)
  else{
    const candidates=view==='paid'?receivables.getPaidReceivableOrders(headers,orderRules):headers
    entries=candidates.filter(matches).sort((a,b)=>String(b.paidAt || '').localeCompare(String(a.paidAt || ''))).map(order=>({key:`${view==='paid'?'paid':'refund'}:${order.id}`,kind:'order',order,orders:[order],label:order.client || 'Pedido sem identificação',total:Number(order.total || 0),timing:{status:view==='paid'?'paid':'refund',daysOverdue:0}}))
  }
  const groups=receivables.sortReceivableGroups(receivables.groupReceivableEntriesByClient(entries),sort)
  const group=groupKey?groups.find(g=>g.key===groupKey):null
  if(groupKey)entries=group?.entries || []
  const queryKey=await sha256Hex(JSON.stringify([businessId,'receivables',view,mode,sort,timing,search,exactDateFilter || '',groupKey || '',today,[...granted].sort()]))
  if(mode==='client'&&view==='pending'&&!groupKey){
    const {page,nextCursor}=rankPage(groups,{queryKey,cursor:input.cursor,limit,key:g=>g.key})
    return {entries:[],orders:[],groups:page.map(compactGroup),summary,forecast,receivedToday,queryKey,nextCursor,completeWithinScope:false,matchingCount:entries.length}
  }
  const {page,nextCursor}=rankPage(entries,{queryKey,cursor:input.cursor,limit,key:e=>e.key})
  const official=new Map(projectOrderList(await listOrdersByIds(db,businessId,page.map(e=>e.order.id)),granted).map(o=>[o.id,o]))
  const finalEntries=page.filter(entry=>{
    const order=official.get(entry.order.id)
    return order && (view==='pending'?receivables.buildPendingReceivableEntries([order],today,orderRules).length===1: view==='paid'?order.status!=='Cancelado'&&isOrderPaid(order):order.status==='Cancelado'&&isOrderPaid(order)&&!order.refundMovementId)
  }).map(entry=>({...entry,order:official.get(entry.order.id),orders:[official.get(entry.order.id)]}))
  return {entries:finalEntries,orders:finalEntries.map(e=>e.order),groups:[],group:group?compactGroup(group):null,summary,forecast,receivedToday,queryKey,nextCursor,completeWithinScope:false,matchingCount:entries.length}
}

export async function readFinanceMovements(db,businessId,{granted,now=new Date(),...input}={}){
  requireAnyCapability({granted},['finance.movements','finance.movements.manage'])
  const queryKey=await sha256Hex(JSON.stringify([businessId,'movements',input.period || 'all',input.type || '',input.category || '',input.paymentMethod || '',input.search || '',input.startDate || '',input.endDate || '',input.period&&input.period!=='all'?getBusinessDate(now):null,[...granted].sort()]))
  return {...await readFinanceTotals(db,businessId,granted),...await selectMovementPage(db,businessId,{...input,queryKey,now,limit:parseReadLimit(input.limit)}),queryKey,completeWithinScope:false}
}
export async function readFinanceOverview(db,businessId,{granted,now=new Date(),...input}={}){
  requireAnyCapability({granted},['finance.overview','finance.movements','finance.movements.manage'])
  const period=readEnum(input.period,['today','7d','30d'],'30d'),today=getBusinessDate(now)
  const dateRange=getFinancePeriodRange({key:period},today)
  const pending=await readOrderHeaders(db,businessId,{granted,kind:'unpaid'})
  const movements=await readPeriodMovements(db,businessId,granted,dateRange)
  const calendarNow=new Date(`${today}T12:00:00`)
  const analytics=await readDashboardAnalytics(db,businessId,{granted,period,now,paymentMix:dashboardRules.getPaymentMix(movements,period,calendarNow)})
  const totals={salesToday:analytics.daily.find(day=>day.date===today)?.sales || 0,
    receivedToday:await readReceivedToday(db,businessId,granted,today),receivables:pending.reduce((sum,o)=>sum+getPendingAmount(o),0)}
  const refunds=canReadMovements(granted)?await readReceivables(db,businessId,{granted,now,view:'refunds',mode:'orders',limit:50}):null
  const financial=await readFinanceTotals(db,businessId,granted)
  // financeSettings has the same read capabilities as the legacy bootstrap.
  if(!financial.financeSettings)financial.financeSettings=await loadFinanceSettings(db,businessId)
  return {...financial,receivablesSummary:receivables.calculateReceivableSummary(pending,today,orderRules),pendingRefundOrders:refunds?.orders || [],
    refundSummary:{count:refunds?.matchingCount || 0},refundNextCursor:refunds?.nextCursor || null,dashboard:{totals,analytics},
    queryKey:await sha256Hex(JSON.stringify([businessId,'finance-overview',period,today,[...granted].sort()])),completeWithinScope:false}
}
