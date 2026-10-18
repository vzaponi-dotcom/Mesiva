import {readableOrderStatuses} from './financialCandidates.js'
import {mapOrderItemRow} from '../repositories.js'
import {PAYMENT_ALLOCATIONS_JSON_SELECT,PAYMENT_SETTLEMENT_SQL_SELECT,PAYMENT_RECEIVED_DATE_SQL_SELECT,mapOrderPaymentFields} from '../orderPaymentReadModel.js'
const rows=result=>result.results || []
// Minimal canonical fields for totals and selection. Historical item payloads are not loaded here.
export async function readOrderHeaders(db,businessId,{granted,clientId,customersOnly=false,kind,paid=false,searchPayments=false,dateRange}={}){
  const statuses=readableOrderStatuses(granted)
  if(!statuses.length)return []
  const activeOnly=!granted.has('orders.history'),clauses=['o.business_id=?'],values=[businessId]
  const index=activeOnly?' INDEXED BY orders_business_active_read_id_idx':clientId?' INDEXED BY orders_business_client_read_idx':customersOnly?' INDEXED BY orders_business_customer_read_idx':dateRange?' INDEXED BY orders_business_date_idx':''
  if(activeOnly)clauses.push("o.status IN ('Em preparo','Agendado')")
  else{clauses.push(`o.status IN (${statuses.map(()=>'?').join(',')})`);values.push(...statuses)}
  if(clientId){clauses.push('o.client_id IS NOT NULL AND o.client_id=?');values.push(clientId)}
  else if(customersOnly)clauses.push('o.client_id IS NOT NULL')
  let from=`orders o${index}`
  if(kind){
    from=`order_financial_candidates c CROSS JOIN orders o${activeOnly?' INDEXED BY orders_business_active_read_id_idx':''} ON o.business_id=c.business_id AND o.id=c.order_id`
    clauses.push('c.business_id=? AND c.kind=?');values.push(businessId,kind)
    clauses.push('EXISTS(SELECT 1 FROM order_financial_candidate_source s WHERE s.business_id=o.business_id AND s.order_id=o.id AND s.candidate_kind=c.kind)')
  }
  if(dateRange){clauses.push('o.order_date>=? AND o.order_date<=?');values.push(dateRange.startDate,dateRange.endDate)}
  if(paid&&!activeOnly){from=`payments p CROSS JOIN orders o${activeOnly?' INDEXED BY orders_business_active_read_id_idx':''} ON o.business_id=p.business_id AND o.id=p.order_id`;clauses.push("p.business_id=? AND NULLIF(p.id,'') IS NOT NULL");values.push(businessId)}
  else if(paid)clauses.push("NULLIF(p.id,'') IS NOT NULL")
  const result=await db.prepare(`SELECT o.id,o.order_number,o.client_id,o.client_name_snapshot,o.client_phone_snapshot,
    o.customer_identity_type,o.table_tab_id,o.type,o.order_date,o.status,o.promised_payment_date,
    o.total_cents,o.content_revision,o.created_at,o.finished_at,o.cancelled_at,p.id AS payment_id,p.amount_cents AS paid_amount_cents,p.method AS payment_method,p.paid_at,${PAYMENT_RECEIVED_DATE_SQL_SELECT},
    ${searchPayments?PAYMENT_ALLOCATIONS_JSON_SELECT:`p.receipt_id,${PAYMENT_SETTLEMENT_SQL_SELECT}`},r.id AS refund_movement_id,tr.id AS table_reservation_id,tt.table_identifier
    FROM ${from}
    ${paid&&!activeOnly?'':'LEFT JOIN payments p ON p.business_id=o.business_id AND p.order_id=o.id'}
    LEFT JOIN movements r ON r.business_id=o.business_id AND r.order_id=o.id AND r.source='order-refund'
    LEFT JOIN table_reservations tr ON tr.business_id=o.business_id AND tr.order_id=o.id
    LEFT JOIN table_tabs tt ON tt.business_id=o.business_id AND tt.id=o.table_tab_id
    WHERE ${clauses.join(' AND ')} ORDER BY o.created_at DESC,o.rowid ASC`).bind(...values).all()
  return rows(result).map(row=>{
    const identity=row.customer_identity_type || (row.client_id?'registered_client':'guest_name')
    return {id:row.id,orderNumber:Number(row.order_number),clientId:row.client_id ?? null,
      client:identity==='table'&&row.table_identifier?row.client_id&&row.client_name_snapshot?`${row.table_identifier} · ${row.client_name_snapshot}`:row.table_identifier:row.client_name_snapshot,
      clientPhone:row.client_phone_snapshot || '',customerIdentityType:identity,tableTabId:row.table_tab_id ?? null,
      tableReservationId:row.table_reservation_id ?? null,type:row.type,status:row.status,total:Number(row.total_cents)/100,contentRevision:Number(row.content_revision || 0),
      orderDate:row.order_date,promisedPaymentDate:row.promised_payment_date ?? null,createdAt:row.created_at,
      finishedAt:row.finished_at,cancelledAt:row.cancelled_at,refundMovementId:row.refund_movement_id ?? null,...mapOrderPaymentFields(row),items:[]}
  })
}
export async function readHeaderItems(db,businessId,orders){
  const byId=new Map(orders.map(order=>[order.id,{...order,items:[]}]))
  for(let offset=0;offset<orders.length;offset+=99){
    const ids=orders.slice(offset,offset+99).map(order=>order.id)
    const result=await db.prepare(`SELECT order_id,product_id,name_snapshot,category_snapshot,size_snapshot,quantity,note
      FROM order_items WHERE business_id=? AND order_id IN (${ids.map(()=>'?').join(',')}) ORDER BY created_at ASC,rowid ASC`).bind(businessId,...ids).all()
    for(const row of rows(result))byId.get(row.order_id)?.items.push(mapOrderItemRow(row))
  }
  return orders.map(order=>byId.get(order.id))
}
