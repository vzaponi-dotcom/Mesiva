import {apiError} from '../http.js'
export function readableOrderStatuses(granted){
  return [...(granted?.has('orders.view')?['Em preparo','Agendado']:[]),...(granted?.has('orders.history')?['Finalizado','Cancelado']:[])]
}
export function prepareFinancialCandidateIds(db,businessId,{kind='unpaid',granted}={}){
  if(!['unpaid','refund'].includes(kind))throw apiError(400,'INVALID_FINANCIAL_SCOPE','Tipo de pendência inválido.')
  const statuses=readableOrderStatuses(granted)
  if(!statuses.length)return null
  return db.prepare(`SELECT c.order_id AS id FROM order_financial_candidates c
    CROSS JOIN order_financial_candidate_source s ON s.business_id=c.business_id AND s.order_id=c.order_id
    WHERE c.business_id=? AND c.kind=? AND s.candidate_kind=c.kind
      AND s.status IN (${statuses.map(()=>'?').join(',')}) ORDER BY c.order_id`).bind(businessId,kind,...statuses)
}
export async function listFinancialCandidateIds(db,businessId,options={}){
  const query=prepareFinancialCandidateIds(db,businessId,options)
  return query?((await query.all()).results || []).map(row=>row.id):[]
}
