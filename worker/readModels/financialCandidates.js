import {apiError} from '../http.js'
export function readableOrderStatuses(granted){
  return [...(granted?.has('orders.view')?['Em preparo','Agendado']:[]),...(granted?.has('orders.history')?['Finalizado','Cancelado']:[])]
}
export async function listFinancialCandidateIds(db,businessId,{kind='unpaid',granted}={}){
  if(!['unpaid','refund'].includes(kind))throw apiError(400,'INVALID_FINANCIAL_SCOPE','Tipo de pendência inválido.')
  const statuses=readableOrderStatuses(granted)
  if(!statuses.length)return []
  const result=await db.prepare(`SELECT c.order_id AS id FROM order_financial_candidates c
    CROSS JOIN order_financial_candidate_source s ON s.business_id=c.business_id AND s.order_id=c.order_id
    WHERE c.business_id=? AND c.kind=? AND s.candidate_kind=c.kind
      AND s.status IN (${statuses.map(()=>'?').join(',')}) ORDER BY c.order_id`).bind(businessId,kind,...statuses).all()
  return (result.results || []).map(row=>row.id)
}
