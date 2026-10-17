import {getOperationalOrderCount} from '../../shared/orderRealtimeRead.js'
import {mapClientRow,mapProductRow,mapTableTabRow} from '../repositories.js'
import {listActiveOrders,listOrdersByIds} from '../orderReadRepository.js'
import {listTables} from '../tableRepository.js'
import {projectBootstrap} from '../access/projections.js'
import {loadFinanceSettings} from '../financeRepository.js'
import {requireReadSurface} from './query.js'
import {listFinancialCandidateIds} from './financialCandidates.js'
const rows=result=>Array.isArray(result?.results)?result.results:[]
export async function loadSurfaceSnapshot(db,businessId,{surface='shell',granted=new Set(),effectiveBusinessConfig,currentTiming=effectiveBusinessConfig?.operations?.timing,now=new Date(),timing}={}){
  requireReadSurface(granted,surface)
  let last=timing?performance.now():0
  const mark=key=>{if(timing){const now=performance.now();timing[key]=now-last;last=now}}
  const tableScope=['new-order','tables','comandas'].includes(surface)
  const tabScope=tableScope && granted.has('comandas.view')
  const clientScope=surface==='new-order' && granted.has('clients.view')
  const productScope=['new-order','products'].includes(surface) && granted.has('products.view')
  const tabOrders=tabScope && (granted.has('orders.view') || granted.has('orders.history'))
  const common=await db.batch([
    db.prepare(`SELECT b.id,b.name,
    CASE WHEN bp.logo_object_key IS NOT NULL THEN 1 ELSE 0 END AS has_logo,
    CASE WHEN bp.logo_object_key IS NOT NULL THEN bp.logo_updated_at ELSE NULL END AS logo_version
    FROM businesses b LEFT JOIN business_profiles bp ON bp.business_id=b.id WHERE b.id=? LIMIT 1`).bind(businessId),
    ...(granted.has('orders.view')?[db.prepare("SELECT id,status,created_at,scheduled_for FROM orders WHERE business_id=? AND status IN ('Em preparo','Agendado') ORDER BY created_at DESC,id DESC").bind(businessId)]:[]),
    ...(granted.has('comandas.view')?[db.prepare("SELECT id FROM table_tabs WHERE business_id=? AND status='open' ORDER BY id").bind(businessId)]:[]),
    ...(tabScope?[db.prepare(`SELECT id,table_id,table_identifier,tab_number,status,opened_at,closed_at
       FROM table_tabs WHERE business_id=? AND status='open' ORDER BY opened_at DESC,id DESC`).bind(businessId)]:[]),
    ...(tabOrders?[db.prepare(`SELECT o.id FROM table_tabs tabs CROSS JOIN orders o
      ON o.business_id=tabs.business_id AND o.table_tab_id=tabs.id
      WHERE tabs.business_id=? AND tabs.status='open' ORDER BY o.created_at DESC,o.id DESC`).bind(businessId)]:[]),
    ...(clientScope?[db.prepare('SELECT id,name,phone,address FROM clients WHERE business_id=? ORDER BY name COLLATE NOCASE ASC').bind(businessId)]:[]),
    ...(productScope?[db.prepare(`SELECT id,category,size,presentation_type,presentation_value,presentation_unit,name,price_cents
      FROM products WHERE business_id=? AND active=1 ORDER BY name COLLATE NOCASE ASC`).bind(businessId)]:[]),
  ])
  mark('snapCommon')
  const business=common[0]?.results?.[0]
  const payload={business:business?{id:business.id,name:business.name,hasLogo:Boolean(business.has_logo),logoVersion:business.has_logo?(business.logo_version??null):null}:{id:businessId,name:'Estabelecimento',hasLogo:false,logoVersion:null}}
  if(effectiveBusinessConfig)payload.effectiveBusinessConfig=effectiveBusinessConfig
  let index=1
  const operationalOrders=granted.has('orders.view')?rows(common[index++]).map(row=>({id:row.id,status:row.status,createdAt:row.created_at,scheduledFor:row.scheduled_for ?? null})):[]
  const openTableTabIds=granted.has('comandas.view')?rows(common[index++]).map(row=>row.id):[]
  const counters={orders:getOperationalOrderCount(operationalOrders,now,currentTiming),comandas:openTableTabIds.length}
  if(granted.has('finance.movements'))counters.refunds=(await listFinancialCandidateIds(db,businessId,{kind:'refund',granted})).length
  mark('snapRefunds')
  if(tableScope && granted.has('tables.view'))payload.tables=await listTables(db,businessId)
  if(tabScope)payload.tableTabs=rows(common[index++]).map(mapTableTabRow)
  const selectedTabOrders=tabOrders?rows(common[index++]).map(row=>row.id):[]
  mark('snapTables')
  let orderScope=null
  if(surface==='orders'){
    payload.orders=await listActiveOrders(db,businessId);orderScope='active'
  }else if(tabOrders){
    const currentTabIds=new Set(payload.tableTabs.map(tab=>tab.id))
    payload.orders=(await listOrdersByIds(db,businessId,selectedTabOrders)).filter(order=>currentTabIds.has(order.tableTabId))
    orderScope='open-tabs'
  }
  mark('snapOrders')
  if(clientScope)payload.clients=rows(common[index++]).map(mapClientRow)
  if(productScope)payload.products=rows(common[index++]).map(mapProductRow)
  if(['dashboard','finance','receivables'].includes(surface) && ['finance.overview','finance.movements','finance.movements.manage'].some(cap=>granted.has(cap)))payload.financeSettings=await loadFinanceSettings(db,businessId)
  const projected=projectBootstrap(payload,granted)
  mark('snapOther')
  return {...projected,readModel:{version:1,surface,completeCollections:Object.keys(projected).filter(key=>['clients','products','orders','tables','tableTabs','movements','financeSettings'].includes(key)),orderScope,counters,operationalOrders,openTableTabIds}}
}
