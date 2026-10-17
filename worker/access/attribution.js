const unknown = () => ({type:'unknown',userId:null,displayName:'Autor não identificado'})
const actor = row => ({type:row.actor_type,userId:row.actor_user_id,displayName:row.actor_name})

// IDs have already passed operational read authorization. Sequential chunks
// reserve a bind for the tenant; rank limits output to the needed snapshots.
// Pin the existing resource index: action IN + window ordering can otherwise
// make SQLite scan the entire tenant action history for a single requested ID.
export async function loadOrderAttributions(db,businessId,orderIds) {
  const ids=[...new Set(orderIds)],result=new Map(ids.map(id=>[id,{createdBy:unknown(),finalizedBy:unknown(),paidBy:unknown()}]))
  for(let offset=0;offset<ids.length;offset+=99) {
    const chunk=ids.slice(offset,offset+99)
    const {results}=await db.prepare(`SELECT resource_id,action,actor_type,actor_user_id,actor_name FROM (
      SELECT resource_id,action,actor_type,actor_user_id,actor_name,
      ROW_NUMBER() OVER (PARTITION BY resource_id,action ORDER BY occurred_at DESC,rowid DESC) AS rank
      FROM audit_events INDEXED BY audit_events_resource_time_idx WHERE business_id=? AND resource_type='order' AND result='success'
      AND action IN ('order.created','order.finalized','payment.received') AND resource_id IN (${chunk.map(()=>'?').join(',')})
    ) WHERE rank=1`).bind(businessId,...chunk).all()
    for(const row of results) result.get(row.resource_id)[{'order.created':'createdBy','order.finalized':'finalizedBy','payment.received':'paidBy'}[row.action]]=actor(row)
  }
  return result
}

export async function loadPrintAttributions(db,businessId,jobIds) {
  const ids=[...new Set(jobIds)],result=new Map(ids.map(id=>[id,{requestedBy:unknown(),lastActionBy:unknown()}]))
  for(let offset=0;offset<ids.length;offset+=99) {
    const chunk=ids.slice(offset,offset+99)
    const {results}=await db.prepare(`SELECT resource_id,slot,actor_type,actor_user_id,actor_name FROM (
      SELECT resource_id,'lastActionBy' AS slot,actor_type,actor_user_id,actor_name,
      ROW_NUMBER() OVER (PARTITION BY resource_id ORDER BY occurred_at DESC,rowid DESC) AS rank
      FROM audit_events INDEXED BY audit_events_resource_time_idx WHERE business_id=? AND resource_type='print-job' AND resource_id IN (${chunk.map(()=>'?').join(',')})
    ) WHERE rank=1`).bind(businessId,...chunk).all()
    for(const row of results) result.get(row.resource_id).lastActionBy=actor(row)
    const first=await db.prepare(`SELECT resource_id,actor_type,actor_user_id,actor_name FROM (
      SELECT resource_id,actor_type,actor_user_id,actor_name,ROW_NUMBER() OVER (PARTITION BY resource_id ORDER BY occurred_at,rowid) AS rank
      FROM audit_events INDEXED BY audit_events_resource_time_idx WHERE business_id=? AND resource_type='print-job' AND action IN ('printing.requested','printing.reprint.requested')
      AND resource_id IN (${chunk.map(()=>'?').join(',')})
    ) WHERE rank=1`).bind(businessId,...chunk).all()
    for(const row of first.results) result.get(row.resource_id).requestedBy=actor(row)
  }
  return result
}

// Called only after route-specific projection. Never traverses audit activity
// rows or grants more data: attaches three-field actors to permitted records.
export async function attachOperationalAttributions(db,businessId,payload,{reportOrder=false}={}) {
  const orders=[],payments=[],jobs=[]
  const visit=(value,key='')=>{
    if(!value || typeof value!=='object') return
    if(Array.isArray(value)){for(const entry of value)visit(entry,key);return}
    if((['order','orders'].includes(key) || (reportOrder && key==='data')) && value.id)orders.push(value)
    if(['payment','payments'].includes(key) && value.orderId)payments.push(value)
    if(['job','jobs','printJob'].includes(key) && value.id && Object.hasOwn(value,'document'))jobs.push(value)
    for(const [childKey,child] of Object.entries(value))if(!['items','metadata','actor','attribution'].includes(childKey))visit(child,childKey)
  }
  visit(payload)
  const attribution=await loadOrderAttributions(db,businessId,[...orders.map(o=>o.id),...payments.map(p=>p.orderId)])
  for(const order of orders)order.attribution=attribution.get(order.id)
  for(const payment of payments)payment.receivedBy=attribution.get(payment.orderId).paidBy
  const printing=await loadPrintAttributions(db,businessId,jobs.map(j=>j.id))
  for(const job of jobs)job.attribution=printing.get(job.id)
  return payload
}
