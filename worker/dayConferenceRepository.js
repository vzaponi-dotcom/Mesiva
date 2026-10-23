import { apiError } from './http.js'
import { getBusinessDate } from '../shared/finance.js'
import { sha256Hex } from './auth.js'

const LIST_LIMIT = 50
const sourceClause = `((m.type='entrada' AND m.source='order-payment')
  OR (m.type='saida' AND m.source IN ('order-refund','order-edit-refund')))`
const methodSql = "COALESCE(NULLIF(m.payment_method,''),NULLIF(p.method,''),'Não informado')"

export function readConferenceDate(date, now = new Date()) {
  if (typeof date !== 'string' || !/^\\d{4}-\\d{2}-\\d{2}$/.test(date)
    || !Number.isFinite(Date.parse(date + 'T00:00:00Z'))
    || new Date(date + 'T00:00:00Z').toISOString().slice(0,10) !== date
    || date > getBusinessDate(now)) {
    throw apiError(400, 'INVALID_CONFERENCE_DATE', 'Informe uma data válida até hoje.')
  }
  return date
}

export async function readDayConferenceSummary(db, businessId, date) {
  const { results = [] } = await db.prepare(`SELECT ${methodSql} AS method,
    SUM(CASE WHEN m.type='entrada' THEN m.value_cents ELSE 0 END) AS gross_cents,
    SUM(CASE WHEN m.type='saida' THEN m.value_cents ELSE 0 END) AS refund_cents,
    COUNT(*) AS movement_count, MAX(m.created_at) AS last_created,
    MAX(m.id) AS last_id
    FROM movements m
    LEFT JOIN payments p ON p.business_id=m.business_id AND p.id=m.payment_id
    WHERE m.business_id=? AND m.movement_date=? AND m.deleted_at IS NULL AND ${sourceClause}
    GROUP BY ${methodSql} ORDER BY ${methodSql} COLLATE NOCASE, ${methodSql}`).bind(businessId, date).all()
  const methods = results.map(row => ({
    method: row.method, grossCents: Number(row.gross_cents), refundCents: Number(row.refund_cents),
    netCents: Number(row.gross_cents) - Number(row.refund_cents), count: Number(row.movement_count),
  }))
  const sourceVersion = await sha256Hex(JSON.stringify(results))
  return { date, sourceVersion, methods }
}

export async function readDayConferenceEntries(db, businessId, date, method, page) {
  if (typeof method !== 'string' || !method || method.length > 80) throw apiError(400, 'INVALID_CONFERENCE_METHOD', 'Forma de pagamento inválida.')
  const offset = (page - 1) * LIST_LIMIT
  const { results = [] } = await db.prepare(`SELECT m.id,m.receipt_id,m.order_id,
    o.order_number,m.movement_date,m.created_at,m.type,m.source,m.value_cents,
    ${methodSql} AS method
    FROM movements m LEFT JOIN orders o ON o.business_id=m.business_id AND o.id=m.order_id
    LEFT JOIN payments p ON p.business_id=m.business_id AND p.id=m.payment_id
    WHERE m.business_id=? AND m.movement_date=? AND m.deleted_at IS NULL
      AND ${sourceClause} AND ${methodSql}=?
    ORDER BY m.created_at DESC,m.id DESC LIMIT ? OFFSET ?`)
    .bind(businessId,date,method,LIST_LIMIT+1,offset).all()
  return {
    entries: results.slice(0,LIST_LIMIT).map(row => ({
      id:row.id, receiptId:row.receipt_id, orderId:row.order_id, orderNumber:row.order_number,
      date:row.movement_date, createdAt:row.created_at, type:row.type, source:row.source,
      amountCents:Number(row.value_cents), method:row.method,
    })),
    nextPage: results.length > LIST_LIMIT ? page + 1 : null,
  }
}

const decodeConference = row => row ? ({
  id:row.id,date:row.business_date,revision:row.revision,status:row.status,
  sourceVersion:row.source_version,note:row.note,userId:row.user_id,
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
  const existing=await db.prepare(`SELECT * FROM daily_receipt_conferences WHERE business_id=? AND request_key=?`).bind(businessId,requestKey).first()
  if(existing)return decodeConference(existing)
  const summary=await readDayConferenceSummary(db,businessId,date)
  if(summary.sourceVersion!==input.sourceVersion)throw apiError(409,'CONFERENCE_CHANGED','Os recebimentos mudaram. Atualize a tela e confira novamente.')
  const lines=input.lines
  if(!Array.isArray(lines)||lines.length!==summary.methods.length||!lines.length)throw apiError(400,'INVALID_CONFERENCE_LINES','Confira todas as formas de pagamento registradas.')
  const byMethod=new Map()
  for(const line of lines){
    if(typeof line?.method!=='string'||byMethod.has(line.method)||line.verified!==true
      ||!Number.isSafeInteger(line.checkedCents)||line.checkedCents<0||line.checkedCents>999999999999)
      throw apiError(400,'INVALID_CONFERENCE_LINES','Verifique os valores informados para cada forma.')
    byMethod.set(line.method,line)
  }
  const snapshot=summary.methods.map(method=>{
    const line=byMethod.get(method.method)
    if(!line)throw apiError(400,'INVALID_CONFERENCE_LINES','Verifique todas as formas de pagamento.')
    return {...method,checkedCents:line.checkedCents,differenceCents:line.checkedCents-method.netCents}
  })
  const divergent=snapshot.some(line=>line.differenceCents!==0)
  const note=typeof input.note==='string'?input.note.trim():''
  if(note.length>1000||(divergent&&!note))throw apiError(400,'INVALID_CONFERENCE_NOTE','Justifique as diferenças (até 1.000 caracteres).')
  const id=crypto.randomUUID(),createdAt=now.toISOString()
  // Uma única escrita após a verificação; a restrição única protege contra fechamento duplicado.
  const inserted=await db.prepare(`INSERT OR IGNORE INTO daily_receipt_conferences
    (id,business_id,business_date,revision,source_version,snapshot_json,note,status,user_id,request_key,created_at)
    VALUES (?,?,?,(SELECT COALESCE(MAX(revision),0)+1 FROM daily_receipt_conferences
      WHERE business_id=? AND business_date=?),?,?,?,?,?,?,?)`)
    .bind(id,businessId,date,businessId,date,summary.sourceVersion,JSON.stringify(snapshot),note,
      divergent?'com_ressalva':'conferida',userId||null,requestKey,createdAt).run()
  if(inserted.meta?.changes===0){
    const replay=await db.prepare('SELECT * FROM daily_receipt_conferences WHERE business_id=? AND request_key=?').bind(businessId,requestKey).first()
    if(replay)return decodeConference(replay)
    throw apiError(409,'CONFERENCE_ALREADY_DONE','Este dia já foi conferido com estes recebimentos. Consulte o histórico.')
  }
  return {id,date,revision:null,status:divergent?'com_ressalva':'conferida',
    sourceVersion:summary.sourceVersion,note,userId,createdAt,lines:snapshot}
}
