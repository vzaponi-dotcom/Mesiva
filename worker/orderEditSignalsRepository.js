import { auditedMutation } from './access/audit.js'
const error=(status,code,message)=>Object.assign(new Error(message),{status,code})
const rows=result=>Array.isArray(result?.results)?result.results:[]
const itemDetails = item => item && typeof item==='object' ? {
  name:String(item.name||'Produto'),
  quantity:Math.max(1,Math.trunc(Number(item.quantity)||1)),
  note:String(item.note||'').slice(0,300),
  size:String(item.size||''),
} : null
export function safeOrderEditSummary(value){
  let parsed
  try{parsed=typeof value==='string'?JSON.parse(value):value}catch{return {items:[]}}
  return {items:(Array.isArray(parsed?.items)?parsed.items:[]).slice(0,200).map(entry=>({
    kind:['added','removed','modified'].includes(entry?.kind)?entry.kind:'modified',
    before:itemDetails(entry?.before),after:itemDetails(entry?.after),
  }))}
}
// Ignore changes only to fees/adjustments, which cannot trigger a kitchen alert.
const hasItemChange="json_array_length(json_extract(h.changes_json,'$.items')) > 0"
export const LATEST_OPERATIONAL_EDIT_JOIN=[
  'LEFT JOIN order_edit_revisions oer',
  'ON oer.business_id=o.business_id AND oer.order_id=o.id AND oer.revision=(',
  'SELECT MAX(h.revision) FROM order_edit_revisions h',
  'WHERE h.business_id=o.business_id AND h.order_id=o.id AND '+hasItemChange+')',
  'LEFT JOIN order_kitchen_edit_acknowledgements oea',
  'ON oea.business_id=oer.business_id AND oea.order_id=oer.order_id AND oea.revision=oer.revision',
].join(' ')
export const OPERATIONAL_EDIT_SELECT_FIELDS=[
  'oer.revision AS operational_edit_revision',
  'oer.edited_at AS operational_edited_at',
  'oer.changes_json AS operational_changes_json',
  'oea.revision AS acknowledged_edit_revision',
].join(', ')
export function projectOperationalEdit(row){
  if(!row?.operational_edit_revision)return {}
  return {
    operationalRevision:Number(row.operational_edit_revision),
    lastOperationalEditAt:row.operational_edited_at || null,
    editPending:row.acknowledged_edit_revision == null,
    editSummary:safeOrderEditSummary(row.operational_changes_json),
  }
}
export async function loadOperationalEditSignals(db,businessId){
  const sql=[
    'SELECT er.order_id,er.revision,er.edited_at,er.changes_json,ack.revision AS acknowledged_revision',
    'FROM order_edit_revisions er',
    'LEFT JOIN order_kitchen_edit_acknowledgements ack',
    'ON ack.business_id=er.business_id AND ack.order_id=er.order_id AND ack.revision=er.revision',
    "WHERE er.business_id=? AND json_array_length(json_extract(er.changes_json,'$.items'))>0",
    'AND er.revision=(SELECT MAX(h.revision) FROM order_edit_revisions h',
    'WHERE h.business_id=er.business_id AND h.order_id=er.order_id',
    "AND json_array_length(json_extract(h.changes_json,'$.items'))>0)",
  ].join(' ')
  const result=await db.prepare(sql).bind(businessId).all()
  return new Map((Array.isArray(result?.results)?result.results:[]).map(row=>[row.order_id,{
    operationalRevision:Number(row.revision),
    lastOperationalEditAt:row.edited_at,
    editPending:row.acknowledged_revision == null,
    editSummary:safeOrderEditSummary(row.changes_json),
  }]))
}
export async function acknowledgeOperationalOrderEdit(db,businessId,orderId,revision,actorId,now=new Date()){
  if(!Number.isSafeInteger(revision)||revision<1)
    throw error(400,'ORDER_EDIT_REVISION_INVALID','Revisão inválida.')
  const signal=(await loadOperationalEditSignals(db,businessId)).get(orderId)
  if(!signal){
    const present=await db.prepare('SELECT 1 FROM orders WHERE id=? AND business_id=?').bind(orderId,businessId).first()
    throw present ? error(409,'ORDER_EDIT_NOT_PENDING','Este pedido não tem alteração operacional pendente.')
      : error(404,'ORDER_NOT_FOUND','Pedido não encontrado.')
  }
  if(signal.operationalRevision!==revision)
    throw error(409,'ORDER_EDIT_REVISION_CHANGED','Uma revisão mais recente exige confirmação.')
  if(!signal.editPending)return true
  if(!actorId)throw error(403,'FORBIDDEN','A confirmação requer um usuário autorizado.')
  const sql=[
    'INSERT OR IGNORE INTO order_kitchen_edit_acknowledgements',
    '(business_id,order_id,revision,acknowledged_by_user_id,acknowledged_at)',
    'SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM order_edit_revisions er',
    'WHERE er.business_id=? AND er.order_id=? AND er.revision=?',
    "AND json_array_length(json_extract(er.changes_json,'$.items'))>0",
    'AND er.revision=(SELECT MAX(h.revision) FROM order_edit_revisions h',
    'WHERE h.business_id=er.business_id AND h.order_id=er.order_id',
    "AND json_array_length(json_extract(h.changes_json,'$.items'))>0))",
  ].join(' ')
  const statement=db.prepare(sql).bind(businessId,orderId,revision,actorId,now.toISOString(),businessId,orderId,revision)
  const result=await auditedMutation(db,businessId,statement,{
    action:'order.edit.acknowledged',resourceType:'order',resourceId:orderId,now,
  }).run()
  if(!result?.meta?.changes){
    const latest=(await loadOperationalEditSignals(db,businessId)).get(orderId)
    if(latest?.operationalRevision!==revision)
      throw error(409,'ORDER_EDIT_REVISION_CHANGED','O pedido mudou durante a confirmação.')
  }
  return true
}
