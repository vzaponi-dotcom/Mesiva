import {getBusinessDate} from '../../shared/finance.js'
import {getFinancePeriodRange} from '../../shared/cashFlowReadRules.js'
import {getOrderItemDisplayName} from '../../shared/orderCartRead.js'
import {readableOrderStatuses} from './financialCandidates.js'
const rows=result=>result.results || []
export async function readDashboardAnalytics(db,businessId,{granted,period,now,paymentMix}){
  const today=getBusinessDate(now),range=getFinancePeriodRange({key:period},today)
  const dates=Array.from({length:period==='today'?1:period==='7d'?7:30},(_,i)=>{
    const day=new Date(`${range.startDate}T12:00:00.000Z`);day.setUTCDate(day.getUTCDate()+i);return day.toISOString().slice(0,10)
  })
  const buckets=new Map(dates.map(date=>[date,{date,label:date.slice(8,10)+'/'+date.slice(5,7),sales:0,orders:0}]))
  const statuses=readableOrderStatuses(granted).filter(status=>status!=='Cancelado')
  let products=[],mealsSold=0
  if(statuses.length){
    const activeOnly=!granted.has('orders.history'),where=`o.business_id=? AND o.status IN (${statuses.map(()=>'?').join(',')}) AND o.order_date>=? AND o.order_date<=?`
    const index=activeOnly?'orders_business_active_read_id_idx':'orders_business_date_idx'
    // Include the literal predicate needed by the active-only partial index.
    const predicate=where+(activeOnly?" AND o.status IN ('Em preparo','Agendado')":'')
    const values=[businessId,...statuses,range.startDate,range.endDate]
    const daily=rows(await db.prepare(`SELECT o.order_date,COUNT(*) AS count,SUM(CASE WHEN o.total_cents>0 THEN o.total_cents ELSE 0 END) AS cents FROM orders o INDEXED BY ${index} WHERE ${predicate} GROUP BY o.order_date`).bind(...values).all())
    for(const row of daily){const bucket=buckets.get(row.order_date);if(bucket){bucket.orders=Number(row.count);bucket.sales=Number(row.cents)/100}}
    // Aggregate item fields in D1; never transfer complete historical order/item payloads for charts.
    const quantities=rows(await db.prepare(`SELECT i.product_id,COALESCE(i.name_snapshot,'Produto') AS name,
      COALESCE(i.size_snapshot,'') AS size,COALESCE(i.category_snapshot,'') AS category,
      SUM(CASE WHEN CAST(i.quantity AS INTEGER)>0 THEN CAST(i.quantity AS INTEGER) ELSE 1 END) AS quantity,
      MAX(o.created_at||char(1)||printf('%020d',9223372036854775807-o.rowid)||char(1)||printf('%020d',9223372036854775807-COALESCE(i.rowid,0))) AS first_key
      FROM orders o INDEXED BY ${index} LEFT JOIN order_items i ON i.business_id=o.business_id AND i.order_id=o.id
      WHERE ${predicate} GROUP BY i.product_id,i.name_snapshot,i.size_snapshot,i.category_snapshot`).bind(...values).all())
    const grouped=new Map()
    for(const row of quantities){
      const label=getOrderItemDisplayName(row),key=row.product_id?`id:${row.product_id}`:`label:${label.toLocaleLowerCase('pt-BR')}`
      const current=grouped.get(key)
      grouped.set(key,{key,label:current&&current.firstKey>row.first_key?current.label:label,quantity:(current?.quantity || 0)+Number(row.quantity),firstKey:current&&current.firstKey>row.first_key?current.firstKey:row.first_key})
      if(['Refeições','Marmita'].includes(row.category))mealsSold+=Number(row.quantity)
    }
    products=[...grouped.values()].sort((a,b)=>b.quantity-a.quantity||a.label.localeCompare(b.label,'pt-BR')).slice(0,10).map(({firstKey:_,...item})=>item)
  }
  const daily=[...buckets.values()],sales=daily.reduce((sum,b)=>sum+b.sales,0),orderCount=daily.reduce((sum,b)=>sum+b.orders,0)
  return {metrics:{sales,orderCount,averageTicket:orderCount?sales/orderCount:0},daily,topProducts:products,mealsSold,paymentMix}
}
