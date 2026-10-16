import {requireCapability} from '../access/authorization.js'
import {getBusinessDate} from '../../shared/finance.js'
import {businessDateRangeUtc} from '../reporting/businessDate.js'
export async function readKitchenSummary(db,businessId,{granted,now=new Date()}={}){
  requireCapability({granted},'orders.view')
  const businessDate=getBusinessDate(now)
  if(!granted.has('orders.history'))return{finishedToday:0,businessDate}
  const [from,to]=businessDateRangeUtc(businessDate,businessDate)
  let finishedToday=Number(await db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE business_id=? AND status='Finalizado'
    AND finished_at>=? AND finished_at<? AND strftime('%Y-%m-%dT%H:%M:%fZ',finished_at) IS finished_at`).bind(businessId,from,to).first('n') || 0)
  let after=''
  for(;;){
    const batch=(await db.prepare(`SELECT id,finished_at FROM orders WHERE business_id=? AND status='Finalizado'
      AND finished_at IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ',finished_at) IS NOT finished_at AND id>?
      ORDER BY id LIMIT 128`).bind(businessId,after).all()).results || []
    for(const row of batch){const stamp=Date.parse(row.finished_at);if(Number.isFinite(stamp)&&getBusinessDate(new Date(stamp))===businessDate)finishedToday++}
    if(batch.length<128)break
    after=batch.at(-1).id
  }
  return {finishedToday,businessDate}
}
