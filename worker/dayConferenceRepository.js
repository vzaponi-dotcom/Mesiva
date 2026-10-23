import { apiError } from './http.js'
import { getBusinessDate } from '../shared/finance.js'
import { sha256Hex } from './auth.js'
import { hashSettingsPayload } from './settingsTransactions.js'
import { auditContext } from './access/audit.js'
import { businessDateRangeUtc } from './reporting/businessDate.js'
import { MOVEMENT_PAYMENT_METHOD_SQL } from './financeRepository.js'

const LIST_LIMIT = 50
const sourceClause = `((m.type='entrada' AND m.source='order-payment')
  OR (m.type='saida' AND m.source IN ('order-refund','order-edit-refund')))`
const methodSql = `COALESCE(${MOVEMENT_PAYMENT_METHOD_SQL},'Não informado')`
const sourceRevisionSql = `COALESCE((SELECT revision FROM daily_receipt_source_revisions
  WHERE business_id=? AND business_date=?),0)`

export function readConferenceDate(date, now = new Date()) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)
    || !Number.isFinite(Date.parse(date + 'T00:00:00Z'))
    || new Date(date + 'T00:00:00Z').toISOString().slice(0,10) !== date
    || date > getBusinessDate(now)) {
    throw apiError(400, 'INVALID_CONFERENCE_DATE', 'Informe uma data válida até hoje.')
  }
  return date
}

const summaryQuery = `SELECT ${methodSql} AS method,
    SUM(CASE WHEN m.type='entrada' THEN m.value_cents ELSE 0 END) AS gross_cents,
    SUM(CASE WHEN m.type='saida' THEN m.value_cents ELSE 0 END) AS refund_cents,
    SUM(CASE WHEN m.source='order-edit-refund' THEN m.value_cents ELSE 0 END) AS edit_refund_cents,
    COUNT(*) AS movement_count, MAX(m.created_at) AS last_created,
    SUM(CASE WHEN m.source='order-payment' AND (a.id IS NULL OR r.id IS NULL
      OR a.receipt_id<>m.receipt_id OR a.amount_cents<>m.value_cents
      OR (r.received_date IS NOT NULL AND r.received_date<>m.movement_date)
      OR (NULLIF(a.method_label,'') IS NOT NULL AND a.method_label<>${methodSql})) THEN 1 ELSE 0 END) AS invalid_count,
    MAX(m.id) AS last_id
    FROM movements m
    LEFT JOIN payments p ON p.business_id=m.business_id AND p.id=m.payment_id
    LEFT JOIN payment_allocations a ON a.business_id=m.business_id AND a.id=m.payment_allocation_id
    LEFT JOIN payment_receipts r ON r.business_id=m.business_id AND r.id=m.receipt_id
    WHERE m.business_id=? AND m.movement_date=? AND m.deleted_at IS NULL AND ${sourceClause}
    GROUP BY ${methodSql} ORDER BY ${methodSql} COLLATE NOCASE, ${methodSql}`
// Check official receipts too: an absent movement cannot be found by a movement-only query.
const sourceQuery = `SELECT ${sourceRevisionSql} AS revision,
  (SELECT COUNT(*) FROM (
    SELECT id,business_id,total_cents FROM payment_receipts WHERE business_id=? AND received_date=?
    UNION
    SELECT id,business_id,total_cents FROM payment_receipts
    WHERE business_id=? AND received_date IS NULL AND paid_at>=? AND paid_at<?
    UNION
    SELECT r.id,r.business_id,r.total_cents FROM movements m
    JOIN payment_receipts r ON r.business_id=m.business_id AND r.id=m.receipt_id
    WHERE m.business_id=? AND m.movement_date=? AND m.deleted_at IS NULL AND m.source='order-payment'
  ) r WHERE r.total_cents<>COALESCE((SELECT SUM(a.amount_cents) FROM payment_allocations a
    WHERE a.business_id=r.business_id AND a.receipt_id=r.id),0)
    OR EXISTS (SELECT 1 FROM payment_allocations a WHERE a.business_id=r.business_id AND a.receipt_id=r.id
      AND (SELECT COUNT(*) FROM movements m WHERE m.business_id=r.business_id AND m.receipt_id=r.id
        AND m.payment_allocation_id=a.id AND m.source='order-payment' AND m.type='entrada'
        AND m.deleted_at IS NULL AND m.movement_date=? AND m.value_cents=a.amount_cents)<>1)
  ) AS receipt_issues`
const sourceBindings = (businessId,date) => {
  const [start,end]=businessDateRangeUtc(date,date)
  return [businessId,date,businessId,date,businessId,start,end,businessId,date,date]
}
const prepareSource = (db,businessId,date) => db.prepare(sourceQuery).bind(...sourceBindings(businessId,date))
const summaryFromRows = async (results, date, source) => {
  const methods = results.map(row => ({
    method: row.method, grossCents: Number(row.gross_cents), refundCents: Number(row.refund_cents),
    netCents: Number(row.gross_cents) - Number(row.refund_cents), count: Number(row.movement_count),
    editRefundCents: Number(row.edit_refund_cents),
  }))
  if (methods.some(row => Object.values(row).some(value => typeof value === 'number' && !Number.isSafeInteger(value)))) {
    throw apiError(422,'CONFERENCE_AMOUNT_OVERFLOW','O volume desta data excede o limite monetário seguro.')
  }
  for (const field of ['grossCents','refundCents','netCents']) {
    if (!Number.isSafeInteger(methods.reduce((sum,row)=>sum+row[field],0))) {
      throw apiError(422,'CONFERENCE_AMOUNT_OVERFLOW','O volume desta data excede o limite monetário seguro.')
    }
  }
  const sourceVersion = await sha256Hex(JSON.stringify([date,source.revision]))
  const integrityIssues=Number(source.receipt_issues)+results.reduce((sum,row)=>sum+Number(row.invalid_count),0)
  return { date, sourceVersion, methods, integrityIssues }
}

async function readSummarySnapshot(db, businessId, date) {
  const [group,source] = await db.batch([
    db.prepare(summaryQuery).bind(businessId,date),
    prepareSource(db,businessId,date),
  ])
  const revision = source.results[0].revision
  return { summary:await summaryFromRows(group.results || [],date,source.results[0]),revision }
}
export async function readDayConferenceSummary(db, businessId, date) {
  return (await readSummarySnapshot(db,businessId,date)).summary
}

// Batch both GET reads under one business-session assertion and one D1 snapshot.
export async function readDayConferenceState(db,businessId,date) {
  const [group,source,latest]=await db.batch([
    db.prepare(summaryQuery).bind(businessId,date),
    prepareSource(db,businessId,date),
    db.prepare(`SELECT * FROM daily_receipt_conferences WHERE business_id=? AND business_date=?
      ORDER BY revision DESC LIMIT 1`).bind(businessId,date),
  ])
  return {...await summaryFromRows(group.results||[],date,source.results[0]),latest:decodeConference(latest.results?.[0])}
}

export async function readDayConferenceEntries(db, businessId, date, method, page, sourceVersion=null, includeOrders=false) {
  if (typeof method !== 'string' || !method || method.length > 80) throw apiError(400, 'INVALID_CONFERENCE_METHOD', 'Forma de pagamento inválida.')
  const offset = (page - 1) * LIST_LIMIT
  const query = db.prepare(`SELECT m.id,m.receipt_id,m.order_id,
    o.order_number,o.client_name_snapshot,m.movement_date,m.created_at,m.type,m.source,m.value_cents,
    ${methodSql} AS method
    FROM movements m INDEXED BY movements_business_date_active_idx
    LEFT JOIN orders o ON o.business_id=m.business_id AND o.id=m.order_id
    LEFT JOIN payments p ON p.business_id=m.business_id AND p.id=m.payment_id
    LEFT JOIN payment_allocations a ON a.business_id=m.business_id AND a.id=m.payment_allocation_id
    WHERE m.business_id=? AND m.movement_date=? AND m.deleted_at IS NULL
      AND ${sourceClause} AND ${methodSql}=?
    ORDER BY m.created_at DESC,m.id DESC LIMIT ? OFFSET ?`)
    .bind(businessId,date,method,LIST_LIMIT+1,offset)
  const [source,entries]=await db.batch([
    db.prepare(`SELECT ${sourceRevisionSql} AS revision`).bind(businessId,date),query,
  ])
  if(sourceVersion!==null && await sha256Hex(JSON.stringify([date,source.results[0].revision]))!==sourceVersion) {
    throw apiError(409,'CONFERENCE_CHANGED','Os lançamentos mudaram. Atualize os recebimentos antes de consultar novamente.')
  }
  const results=(entries.results || []).slice(0,LIST_LIMIT)
  const linked=new Map()
  if(includeOrders){
    // Bulk resolution for shared receipts; avoid per-movement order queries and false one-to-one attribution.
    const receiptIds=[...new Set(results.filter(row=>!row.order_id&&row.receipt_id).map(row=>row.receipt_id))]
    if(receiptIds.length){
      const placeholders=receiptIds.map(()=>'?').join(',')
      const {results:links=[]}=await db.prepare(`SELECT refs.receipt_id,o.id,o.order_number,o.client_name_snapshot
        FROM (
          SELECT receipt_id,order_id FROM payments WHERE business_id=? AND receipt_id IN (${placeholders})
          UNION
          SELECT receipt_id,order_id FROM order_settlement_entries WHERE business_id=? AND receipt_id IN (${placeholders})
            AND kind='supplemental_payment'
        ) refs JOIN orders o ON o.business_id=? AND o.id=refs.order_id
        ORDER BY refs.receipt_id,o.order_number,o.id`).bind(businessId,...receiptIds,businessId,...receiptIds,businessId).all()
      for(const row of links){
        const orders=linked.get(row.receipt_id)||[]
        orders.push({id:row.id,number:row.order_number,client:row.client_name_snapshot||null})
        linked.set(row.receipt_id,orders)
      }
    }
  }
  return {
    entries:results.map(row=>({
      id:row.id,receiptId:row.receipt_id,orderId:row.order_id,orderNumber:row.order_number,
      date:row.movement_date,createdAt:row.created_at,type:row.type,source:row.source,
      amountCents:Number(row.value_cents),method:row.method,
      linkedOrders:!includeOrders?[]:row.order_id
        ?[{id:row.order_id,number:row.order_number,client:row.client_name_snapshot||null}]
        :(linked.get(row.receipt_id)||[]),
    })),
    nextPage:(entries.results||[]).length>LIST_LIMIT?page+1:null,
  }
}

const decodeConference = row => row ? ({
  id:row.id,date:row.business_date,revision:row.revision,status:row.status,
  sourceVersion:row.source_version,note:row.note,userId:row.user_id,actorName:row.actor_name,
  createdAt:row.created_at,lines:JSON.parse(row.snapshot_json),
}) : null

export async function readDayConferenceHistory(db,businessId,date=null) {
  const sql = `SELECT * FROM daily_receipt_conferences WHERE business_id=?${date?' AND business_date=?':''}
    ORDER BY business_date DESC,revision DESC LIMIT 30`
  const { results=[] } = await db.prepare(sql).bind(businessId,...(date?[date]:[])).all()
  return results.map(decodeConference)
}

export async function completeDayConference(db,businessId,userId,input,now=new Date()){
  const date=readConferenceDate(input.date,now)
  const requestKey=input.requestKey
  if(typeof requestKey!=='string'||requestKey.length<16||requestKey.length>120)throw apiError(400,'INVALID_CONFERENCE_KEY','Identificador de envio inválido.')
  const lines=input.lines
  if(!Array.isArray(lines)||!lines.length||lines.length>200)throw apiError(400,'INVALID_CONFERENCE_LINES','Confira todas as formas de pagamento registradas.')
  const byMethod=new Map()
  for(const line of lines){
    if(typeof line?.method!=='string'||byMethod.has(line.method)||line.verified!==true
      ||line.method.length>80||!Number.isSafeInteger(line.checkedCents)||Math.abs(line.checkedCents)>999999999999)
      throw apiError(400,'INVALID_CONFERENCE_LINES','Verifique os valores informados para cada forma.')
    byMethod.set(line.method,line)
  }
  if(typeof input.sourceVersion!=='string'||!/^[a-f0-9]{64}$/.test(input.sourceVersion))throw apiError(400,'INVALID_CONFERENCE_VERSION','Atualize os recebimentos antes de conferir.')
  if(input.note!==undefined&&typeof input.note!=='string')throw apiError(400,'INVALID_CONFERENCE_NOTE','Observação inválida.')
  const note=(input.note || '').trim()
  if(note.length>1000)throw apiError(400,'INVALID_CONFERENCE_NOTE','Justifique as diferenças (até 1.000 caracteres).')
  const requestHash=await hashSettingsPayload({date,sourceVersion:input.sourceVersion,note,userId,
    lines:[...byMethod.values()].map(({method,checkedCents})=>({method,checkedCents})).sort((a,b)=>a.method.localeCompare(b.method))})
  const readReplay=async()=>{
    const row=await db.prepare('SELECT * FROM daily_receipt_conferences WHERE business_id=? AND request_key=?').bind(businessId,requestKey).first()
    if(!row)return null
    if(row.request_hash!==requestHash)throw apiError(409,'CONFERENCE_KEY_REUSED','Este envio já foi usado para outra conferência. Atualize a tela.')
    return decodeConference(row)
  }
  const existing=await readReplay()
  if(existing)return existing
  const {summary,revision}=await readSummarySnapshot(db,businessId,date)
  if(summary.sourceVersion!==input.sourceVersion)throw apiError(409,'CONFERENCE_CHANGED','Os recebimentos mudaram. Atualize a tela e confira novamente.')
  if(summary.integrityIssues)throw apiError(409,'CONFERENCE_SOURCE_INCONSISTENT','Há divergências entre movimentos, recibos e alocações. A conclusão está bloqueada; solicite revisão financeira.')
  if(lines.length!==summary.methods.length)throw apiError(400,'INVALID_CONFERENCE_LINES','Confira todas as formas de pagamento registradas.')
  const snapshot=summary.methods.map(method=>{
    const line=byMethod.get(method.method)
    if(!line)throw apiError(400,'INVALID_CONFERENCE_LINES','Verifique todas as formas de pagamento.')
    return {...method,checkedCents:line.checkedCents,differenceCents:line.checkedCents-method.netCents}
  })
  const divergent=snapshot.some(line=>line.differenceCents!==0)
  if(snapshot.some(line=>!Number.isSafeInteger(line.differenceCents)))throw apiError(400,'INVALID_CONFERENCE_LINES','Diferença fora do limite monetário seguro.')
  if(divergent&&!note)throw apiError(400,'INVALID_CONFERENCE_NOTE','Justifique as diferenças (até 1.000 caracteres).')
  const id=crypto.randomUUID(),createdAt=now.toISOString()
  const actorName=auditContext(db,businessId).displayName || 'Acesso legado'
  // The source predicate and revision allocation execute in the same SQL write.
  const [inserted,saved]=await db.batch([db.prepare(`INSERT OR IGNORE INTO daily_receipt_conferences
    (id,business_id,business_date,revision,source_version,snapshot_json,note,status,user_id,request_key,created_at,actor_name,request_hash)
    SELECT ?,?,?,(SELECT COALESCE(MAX(revision),0)+1 FROM daily_receipt_conferences
      WHERE business_id=? AND business_date=?),?,?,?,?,?,?,?,?,?
    WHERE EXISTS (SELECT 1 FROM (${sourceQuery}) s WHERE s.revision=? AND s.receipt_issues=0)`)
    .bind(id,businessId,date,businessId,date,summary.sourceVersion,JSON.stringify(snapshot),note,
      divergent?'com_ressalva':'conferida',userId||null,requestKey,createdAt,actorName,requestHash,...sourceBindings(businessId,date),revision),
    db.prepare('SELECT * FROM daily_receipt_conferences WHERE business_id=? AND id=?').bind(businessId,id),
  ])
  if(inserted.meta?.changes===0){
    const replay=await readReplay()
    if(replay)return replay
    const current=await readDayConferenceSummary(db,businessId,date)
    if(current.integrityIssues)throw apiError(409,'CONFERENCE_SOURCE_INCONSISTENT','Há divergências entre movimentos, recibos e alocações. A conclusão está bloqueada; solicite revisão financeira.')
    if(current.sourceVersion!==input.sourceVersion)throw apiError(409,'CONFERENCE_CHANGED','Os recebimentos mudaram. Atualize a tela e confira novamente.')
    throw apiError(409,'CONFERENCE_ALREADY_DONE','Este dia já foi conferido com estes recebimentos. Consulte o histórico.')
  }
  return decodeConference(saved.results[0])
}
