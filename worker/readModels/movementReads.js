import {mapMovementRow,loadFinanceSettings} from '../financeRepository.js'
import {filterFinanceHistory,getFinancePeriodRange} from '../../shared/cashFlowReadRules.js'
import {getBusinessDate} from '../../shared/finance.js'
import {apiError} from '../http.js'
import {decodeReadCursor,encodeReadCursor,readEnum,readSearch,readCalendarDate} from './query.js'
const movementSelect=`SELECT m.id,m.type,m.category,m.description,m.value_cents,m.source,m.order_id,m.payment_id,
 m.receipt_id,m.payment_allocation_id,fc.label AS category_label,
 CASE WHEN m.source='order-payment' THEN COALESCE(m.payment_method,p.method) ELSE m.payment_method END AS payment_method,
 m.movement_date,m.created_at,m.updated_at FROM movements m
 LEFT JOIN payments p ON p.business_id=m.business_id AND p.id=m.payment_id
 LEFT JOIN business_finance_categories fc ON fc.business_id=m.business_id AND fc.id=m.category`
const rows=result=>result.results || []
export const canReadMovements=granted=>granted.has('finance.movements')||granted.has('finance.movements.manage')
export async function readFinanceTotals(db,businessId,granted){
  const financeSettings=await loadFinanceSettings(db,businessId)
  if(!canReadMovements(granted))return {totals:{entries:0,exits:0,balance:0},currentBalance:financeSettings?Number(financeSettings.openingBalance):null,financeSettings}
  const result=await db.prepare(`SELECT COALESCE(SUM(CASE WHEN type='entrada' THEN value_cents ELSE 0 END),0) AS entries,
    COALESCE(SUM(CASE WHEN type='saida' THEN value_cents ELSE 0 END),0) AS exits,
    COALESCE(SUM(CASE WHEN movement_date>=? THEN CASE WHEN type='entrada' THEN value_cents WHEN type='saida' THEN -value_cents ELSE 0 END ELSE 0 END),0) AS opening_delta
    FROM movements WHERE business_id=? AND deleted_at IS NULL`).bind(financeSettings?.openingDate || '',businessId).first()
  const entries=Number(result?.entries || 0)/100,exits=Number(result?.exits || 0)/100
  return {totals:{entries,exits,balance:entries-exits},currentBalance:financeSettings?.openingDate&&Number.isFinite(Number(financeSettings.openingBalance))?Number(financeSettings.openingBalance)+Number(result?.opening_delta || 0)/100:null,financeSettings}
}
export async function readReceivedToday(db,businessId,granted,today){
  if(!canReadMovements(granted))return 0
  const result=await db.prepare(`SELECT COALESCE(SUM(CASE
    WHEN m.type='entrada' AND m.source='order-payment' THEN MAX(m.value_cents,0)
    WHEN m.type='saida' AND m.source='order-refund' THEN -MAX(m.value_cents,0)
    ELSE 0 END),0) AS cents FROM movements m
    WHERE m.business_id=? AND m.deleted_at IS NULL
      AND m.movement_date=? AND m.source IN ('order-payment','order-refund')`)
    .bind(businessId,today).first()
  return Number(result?.cents || 0)/100
}
export async function readPeriodMovements(db,businessId,granted,range){
  if(!canReadMovements(granted))return []
  return rows(await db.prepare(`${movementSelect} WHERE m.business_id=? AND m.deleted_at IS NULL AND m.movement_date>=? AND m.movement_date<=? ORDER BY m.created_at DESC,m.id DESC`).bind(businessId,range.startDate,range.endDate).all()).map(mapMovementRow)
}
export async function selectMovementPage(db,businessId,{queryKey,cursor,limit,now,...input}){
  const period=readEnum(input.period,['all','today','7d','30d','custom'],'all'),search=readSearch(input.search)
  const type=readEnum(input.type,['','entrada','saida'],'')
  const category=readSearch(input.category),paymentMethod=readSearch(input.paymentMethod)
  const range=period==='all'?null:getFinancePeriodRange({key:period,startDate:input.startDate,endDate:input.endDate},getBusinessDate(now))
  if(range && (!readCalendarDate(range.startDate) || !readCalendarDate(range.endDate) || range.startDate>range.endDate))throw apiError(400,'INVALID_READ_QUERY','Período inválido.')
  const clauses=['m.business_id=?','m.deleted_at IS NULL'],values=[businessId]
  if(range){clauses.push('m.movement_date>=? AND m.movement_date<=?');values.push(range.startDate,range.endDate)}
  if(type){clauses.push('m.type=?');values.push(type)}
  const decoded=decodeReadCursor(cursor,queryKey,{text:true})
  const grouped=!search&&!category&&!paymentMethod
  const summaryClauses=[...clauses],summaryValues=[...values]
  if(grouped){clauses.push(`(m.source<>'order-payment' OR m.receipt_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM movements newer WHERE newer.business_id=m.business_id AND newer.receipt_id=m.receipt_id
      AND newer.deleted_at IS NULL AND newer.source='order-payment' AND newer.receipt_id IS NOT NULL
      ${range?' AND newer.movement_date>=? AND newer.movement_date<=?':''}
      ${type?' AND newer.type=?':''}
      AND (newer.created_at>m.created_at OR newer.created_at=m.created_at AND newer.id>m.id)
  ))`);values.push(...(range?[range.startDate,range.endDate]:[]),...(type?[type]:[]))}
  const select=after=>{
    if(!after)return {sql:`${movementSelect} WHERE ${clauses.join(' AND ')} ORDER BY m.created_at DESC,m.id DESC LIMIT ?`,values:[...values,limit+1]}
    return {sql:`SELECT * FROM (${movementSelect} WHERE ${clauses.join(' AND ')} AND m.created_at=? AND m.id<? ORDER BY m.id DESC LIMIT ?)
      UNION ALL SELECT * FROM (${movementSelect} WHERE ${clauses.join(' AND ')} AND m.created_at<? ORDER BY m.created_at DESC,m.id DESC LIMIT ?)
      ORDER BY created_at DESC,id DESC LIMIT ?`,values:[...values,after[0],after[1],limit+1,...values,after[0],limit+1,limit+1]}
  }
  // Unfiltered history uses SQL counts and a bounded page. Exact NFD/category
  // compatibility is streamed only when a user explicitly applies those filters.
  if(grouped){
    const count=Number((await db.prepare(`SELECT COUNT(DISTINCT CASE WHEN m.source='order-payment' AND m.receipt_id IS NOT NULL THEN 'receipt:'||m.receipt_id ELSE 'movement:'||m.id END) AS n FROM movements m WHERE ${summaryClauses.join(' AND ')}`).bind(...summaryValues).first())?.n || 0)
    const query=select(decoded),selected=rows(await db.prepare(query.sql).bind(...query.values).all()),page=selected.slice(0,limit)
    const complete=new Map(page.map(row=>[row.id,row]))
    const receipts=[...new Set(page.filter(row=>row.source==='order-payment'&&row.receipt_id).map(row=>row.receipt_id))]
    const batchSize=99-(range?2:0)-(type?1:0)
    for(let offset=0;offset<receipts.length;offset+=batchSize){
      const ids=receipts.slice(offset,offset+batchSize)
      const parts=rows(await db.prepare(`${movementSelect} WHERE m.business_id=? AND m.deleted_at IS NULL AND m.source='order-payment' AND m.receipt_id IS NOT NULL AND m.receipt_id IN (${ids.map(()=>'?').join(',')})${range?' AND m.movement_date>=? AND m.movement_date<=?':''}${type?' AND m.type=?':''} ORDER BY m.created_at DESC,m.id DESC`).bind(businessId,...ids,...(range?[range.startDate,range.endDate]:[]),...(type?[type]:[])).all())
      for(const part of parts)complete.set(part.id,part)
    }
    return {movements:[...complete.values()].map(mapMovementRow),summary:{count},nextCursor:selected.length>limit?encodeReadCursor(queryKey,[page.at(-1).created_at,page.at(-1).id]):null}
  }
  const page=[];let count=0,after=null,more=false,last=null
  do{
    const query=select(after),batch=rows(await db.prepare(query.sql).bind(...query.values).all())
    for(const row of batch){
      const movement=mapMovementRow(row)
      if(!filterFinanceHistory([movement],{search,category,paymentMethod}).length)continue
      count++
      if(decoded && (row.created_at>decoded[0] || row.created_at===decoded[0]&&row.id>=decoded[1]))continue
      if(page.length<limit){page.push(movement);last=row}else more=true
    }
    const end=batch.at(-1);after=batch.length===limit+1?[end.created_at,end.id]:null
  }while(after)
  return {movements:page,summary:{count},nextCursor:more?encodeReadCursor(queryKey,[last.created_at,last.id]):null}
}
