import {apiError} from '../http.js'
import {requireCapability} from '../access/authorization.js'
import {listOrdersByIds} from '../orderReadRepository.js'
import {mapOrderRow} from '../repositories.js'
import {sha256Hex} from '../auth.js'
import {getBusinessDate} from '../../shared/finance.js'
import {getHistoryView,selectHistoryOrders,historyTimestamp,resolveHistoryQuery} from '../../shared/orderHistoryQuery.js'
import {businessDateRangeUtc} from '../reporting/businessDate.js'
import {parseReadLimit,encodeReadCursor,decodeReadCursor} from './query.js'
import {HISTORY_TIMESTAMP_SQL as time,HISTORY_STATUS_SQL as terminal,HISTORY_LEGACY_SQL as legacy} from './historySql.js'
const rows=result=>result.results || []
const stamp=order=>Date.parse(historyTimestamp(order)) || 0
const day=order=>{const value=historyTimestamp(order);return value && Number.isFinite(Date.parse(value))?getBusinessDate(new Date(value)):'unknown'}
const compare=(a,b)=>stamp(b)-stamp(a) || (a.id<b.id?1:a.id>b.id?-1:0)
const afterCursor=(order,cursor)=>!cursor || stamp(order)<cursor[0] || stamp(order)===cursor[0] && order.id<cursor[1]
const counts=row=>({all:Number(row?.all || 0),finalized:Number(row?.finalized || 0),cancelled:Number(row?.cancelled || 0)})
function parseQuery(input,now){
  const query={period:input.period || 'all',filter:input.filter || 'all',search:input.search || '',startDate:input.startDate,endDate:input.endDate}
  if(!['all','today','yesterday','7d','custom'].includes(query.period) || !['all','finalized','cancelled'].includes(query.filter)
    || typeof query.search!=='string' || query.search.length>500)throw apiError(400,'INVALID_HISTORY_QUERY','Filtros do histórico inválidos.')
  return {...query,...resolveHistoryQuery(query,now)}
}
export async function readOrderHistory(db,businessId,{granted,now=new Date(),...input}={}){
  requireCapability({granted},'orders.history')
  const query=parseQuery(input,now),limit=parseReadLimit(input.limit)
  const queryKey=await sha256Hex(JSON.stringify([businessId,query.period,query.filter,query.search,query.period==='all'?null:query.start,query.period==='all'?null:query.end]))
  const cursor=decodeReadCursor(input.cursor,queryKey)
  const base={queryKey,completeWithinScope:false,validRange:query.validRange}
  if(!query.validRange)return {...base,orders:[],summary:{all:0,finalized:0,cancelled:0,days:{}},nextCursor:null}
  const hasLegacy=Boolean(await db.prepare(`SELECT 1 AS legacy FROM orders WHERE business_id=? AND ${terminal} AND ${legacy} LIMIT 1`).bind(businessId).first())
  if(query.search || hasLegacy)return readCompatibleHistory(db,businessId,{query,limit,cursor,base,now,hasLegacy})
  const clauses=['business_id=?',terminal],values=[businessId]
  if(query.period!=='all'){
    const [from,to]=businessDateRangeUtc(query.start,query.end)
    clauses.push(`(${time}) >= ? AND (${time}) < ?`);values.push(from,to)
  }
  const summary=counts(await db.prepare(`SELECT COUNT(*) AS "all",SUM(status='Finalizado') AS finalized,SUM(status='Cancelado') AS cancelled
    FROM orders WHERE ${clauses.join(' AND ')}`).bind(...values).first())
  const selectedClauses=[...clauses],selectedValues=[...values]
  if(query.filter!=='all')selectedClauses.push(query.filter==='finalized'?"status='Finalizado'":"status='Cancelado'")
  const dayClauses=[...selectedClauses],dayValues=[...selectedValues]
  const select=`SELECT id,(${time}) AS history_at FROM orders INDEXED BY orders_business_history_time_idx WHERE ${selectedClauses.join(' AND ')}`
  const take=limit+1
  let selection
  if(cursor){
    const at=new Date(cursor[0]).toISOString()
    selection={sql:`SELECT id,history_at FROM (${select} AND (${time})=? AND id<? ORDER BY id DESC LIMIT ?)
      UNION ALL SELECT id,history_at FROM (${select} AND (${time})<? ORDER BY history_at DESC,id DESC LIMIT ?)
      ORDER BY history_at DESC,id DESC LIMIT ?`,values:[...selectedValues,at,cursor[1],take,...selectedValues,at,take,take]}
  }else selection={sql:`${select} ORDER BY history_at DESC,id DESC LIMIT ?`,values:[...selectedValues,take]}
  const selected=rows(await db.prepare(selection.sql).bind(...selection.values).all())
  const page=selected.slice(0,limit),more=selected.length>limit
  const payload=await pagePayload(db,businessId,page.map(row=>row.id),query,now)
  summary.days={}
  for(const selectedDay of new Set(page.map(row=>getBusinessDate(new Date(row.history_at))))){
    const [from,to]=businessDateRangeUtc(selectedDay,selectedDay)
    summary.days[selectedDay]=Number(await db.prepare(`SELECT COUNT(*) AS n FROM orders
      WHERE ${dayClauses.join(' AND ')} AND (${time})>=? AND (${time})<?`).bind(...dayValues,from,to).first('n') || 0)
  }
  const last=page.at(-1)
  return {...base,orders:payload,summary,nextCursor:more?encodeReadCursor(base.queryKey,[Date.parse(last.history_at),last.id]):null}
}
async function pagePayload(db,businessId,ids,query,now){
  const payload=await listOrdersByIds(db,businessId,ids)
  const eligible=new Map(getHistoryView(payload,query,now).orders.map(order=>[order.id,order]))
  return ids.map(id=>eligible.get(id)).filter(Boolean)
}
async function readCompatibleHistory(db,businessId,{query,limit,cursor,base,now,hasLegacy}){
  // Exact NFD substring semantics include item notes. Stream bounded minimal
  // records; only the selected page receives the official complete payload.
  const qualified=time.replace(/\b(status|cancelled_at|finished_at|created_at)\b/g,'o.$1')
  const itemSearch=query.search?`(SELECT json_group_array(json_array(name_snapshot,category_snapshot,size_snapshot,note)) FROM
    (SELECT name_snapshot,category_snapshot,size_snapshot,note FROM order_items
      WHERE business_id=o.business_id AND order_id=o.id ORDER BY created_at ASC,rowid ASC))`:"'[]'"
  const summary={all:0,finalized:0,cancelled:0},dayCounts=new Map()
  let top=[]
  // A legacy row does not turn every normalized row into an unbounded scan.
  // The subsets are disjoint; legacy dates keep Date.parse semantics.
  for(const legacyMode of hasLegacy?[false,true]:[false]){
    const extra=[],rangeValues=[]
    if(!legacyMode && hasLegacy)extra.push(`AND NOT ${legacy}`)
    if(!legacyMode && query.period!=='all'){
      const [from,to]=businessDateRangeUtc(query.start,query.end)
      extra.push(`AND (${qualified})>=? AND (${qualified})<?`);rangeValues.push(from,to)
    }
    let scanAfter=null
    while(true){
      const candidate=historyBatchCandidates(businessId,{hasLegacy:legacyMode,scanAfter,extra,rangeValues})
      const order=legacyMode?'selected.id ASC':'selected.history_at DESC,selected.id DESC'
      const batch=rows(await db.prepare(`SELECT o.id,o.status,o.created_at,o.finished_at,o.cancelled_at,o.client_id,o.client_name_snapshot,
        o.customer_identity_type,o.table_tab_id,o.type,o.order_number,tt.table_identifier,COALESCE(rt.name,tr.table_name_snapshot) AS reservation_table_name,
        selected.history_at,${itemSearch} AS search_items
        FROM (${candidate.sql}) selected
        CROSS JOIN orders o ON o.business_id=? AND o.id=selected.id
        LEFT JOIN table_tabs tt ON tt.id=o.table_tab_id AND tt.business_id=o.business_id
        LEFT JOIN table_reservations tr ON tr.order_id=o.id AND tr.business_id=o.business_id
        LEFT JOIN tables rt ON rt.id=tr.table_id AND rt.business_id=tr.business_id
        ORDER BY ${order}`).bind(...candidate.values,businessId).all())
      if(!batch.length)break
      const headers=batch.map(row=>{
        const items=JSON.parse(row.search_items).map(([name,category,size,note])=>({name,category,size,note}))
        const mapped=mapOrderRow(row,items)
        return {id:mapped.id,status:mapped.status,client:mapped.client,orderNumber:mapped.orderNumber,type:mapped.type,
          createdAt:mapped.createdAt,finishedAt:mapped.finishedAt,cancelledAt:mapped.cancelledAt,items}
      })
      const view=selectHistoryOrders(headers,query,now)
      for(const key of ['all','finalized','cancelled'])summary[key]+=view.counts[key]
      const boundary=top.length>=limit+1?top.at(-1):null
      for(const order of view.orders){
        const key=day(order);dayCounts.set(key,(dayCounts.get(key)||0)+1)
        if(afterCursor(order,cursor) && (!boundary || compare(order,boundary)<0))top.push(order)
      }
      top.sort(compare);top=top.slice(0,limit+1)
      scanAfter={id:batch.at(-1).id,at:batch.at(-1).history_at}
      if(batch.length<128)break
    }
  }
  const page=top.slice(0,limit),more=top.length>limit,days=new Set(page.map(day))
  summary.days=Object.fromEntries([...days].map(key=>[key,dayCounts.get(key)||0]))
  return {...base,orders:await pagePayload(db,businessId,page.map(order=>order.id),query,now),summary,
    nextCursor:more?encodeReadCursor(base.queryKey,[stamp(page.at(-1)),page.at(-1).id]):null}
}

function historyBatchCandidates(businessId,{hasLegacy,scanAfter,extra,rangeValues}){
  if(hasLegacy)return {
    sql:`SELECT id,(${time}) AS history_at FROM orders INDEXED BY orders_business_history_legacy_idx
      WHERE business_id=? AND ${terminal} AND ${legacy} AND id>? ORDER BY id ASC LIMIT 128`,values:[businessId,scanAfter?.id || ''],
  }
  const range=extra.join(' ').replace(/\bo\./g,'')
  const select=`SELECT id,(${time}) AS history_at FROM orders INDEXED BY orders_business_history_time_idx
    WHERE business_id=? AND ${terminal} ${range}`
  const values=[businessId,...rangeValues]
  // SQLite does not reliably seek a row-value comparison whose first column is
  // an expression. Separate equal-time/id and older-time ranges: both can seek
  // the compound index, including thousands of records sharing one timestamp.
  if(scanAfter)return {
    sql:`SELECT id,history_at FROM (${select} AND (${time})=? AND id<? ORDER BY id DESC LIMIT 128)
      UNION ALL SELECT id,history_at FROM (${select} AND (${time})<? ORDER BY history_at DESC,id DESC LIMIT 128)
      ORDER BY history_at DESC,id DESC LIMIT 128`,
    values:[...values,scanAfter.at,scanAfter.id,...values,scanAfter.at],
  }
  return {sql:`${select} ORDER BY history_at DESC,id DESC LIMIT 128`,values}
}
