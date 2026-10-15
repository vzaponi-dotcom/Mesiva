import {getOperationalOrderCount} from '../../shared/orderRealtimeRead.js'
import {mapClientRow,mapProductRow,mapTableTabRow} from '../repositories.js'
import {listActiveOrders,listOrdersByIds} from '../orderReadRepository.js'
import {listTables} from '../tableRepository.js'
import {projectBootstrap} from '../access/projections.js'
import {loadFinanceSettings} from '../financeRepository.js'
import {requireReadSurface} from './query.js'
const rows=result=>Array.isArray(result?.results)?result.results:[]
export async function loadSurfaceSnapshot(db,businessId,{surface='shell',granted=new Set(),effectiveBusinessConfig,currentTiming=effectiveBusinessConfig?.operations?.timing,now=new Date()}={}){
  requireReadSurface(granted,surface)
  const business=await db.prepare(`SELECT b.id,b.name,
    CASE WHEN bp.logo_object_key IS NOT NULL THEN 1 ELSE 0 END AS has_logo,
    CASE WHEN bp.logo_object_key IS NOT NULL THEN bp.logo_updated_at ELSE NULL END AS logo_version
    FROM businesses b LEFT JOIN business_profiles bp ON bp.business_id=b.id WHERE b.id=? LIMIT 1`).bind(businessId).first()
  const payload={business:business?{id:business.id,name:business.name,hasLogo:Boolean(business.has_logo),logoVersion:business.has_logo?(business.logo_version??null):null}:{id:businessId,name:'Estabelecimento',hasLogo:false,logoVersion:null}}
  if(effectiveBusinessConfig)payload.effectiveBusinessConfig=effectiveBusinessConfig
  const operationalOrders=granted.has('orders.view')?rows(await db.prepare("SELECT id,status,created_at,scheduled_for FROM orders WHERE business_id=? AND status IN ('Em preparo','Agendado') ORDER BY created_at DESC,id DESC").bind(businessId).all()).map(row=>({id:row.id,status:row.status,createdAt:row.created_at,scheduledFor:row.scheduled_for ?? null})):[]
  const openTableTabIds=granted.has('comandas.view')?rows(await db.prepare("SELECT id FROM table_tabs WHERE business_id=? AND status='open' ORDER BY id").bind(businessId).all()).map(row=>row.id):[]
  const counters={orders:getOperationalOrderCount(operationalOrders,now,currentTiming),comandas:openTableTabIds.length}
  const tableScope=['new-order','tables','comandas'].includes(surface)
  if(tableScope && granted.has('tables.view'))payload.tables=await listTables(db,businessId)
  if(tableScope && granted.has('comandas.view')){
    payload.tableTabs=rows(await db.prepare(`SELECT id,table_id,table_identifier,tab_number,status,opened_at,closed_at
      FROM table_tabs WHERE business_id=? AND status='open' ORDER BY opened_at DESC,id DESC`).bind(businessId).all()).map(mapTableTabRow)
  }
  let orderScope=null
  if(surface==='orders'){
    payload.orders=await listActiveOrders(db,businessId);orderScope='active'
  }else if(tableScope && granted.has('comandas.view') && (granted.has('orders.view') || granted.has('orders.history'))){
    const selected=await db.prepare(`SELECT o.id FROM table_tabs tabs CROSS JOIN orders o
      ON o.business_id=tabs.business_id AND o.table_tab_id=tabs.id
      WHERE tabs.business_id=? AND tabs.status='open' ORDER BY o.created_at DESC,o.id DESC`).bind(businessId).all()
    const currentTabIds=new Set(payload.tableTabs.map(tab=>tab.id))
    payload.orders=(await listOrdersByIds(db,businessId,rows(selected).map(row=>row.id))).filter(order=>currentTabIds.has(order.tableTabId))
    orderScope='open-tabs'
  }
  if(surface==='new-order' && granted.has('clients.view'))payload.clients=rows(await db.prepare('SELECT id,name,phone,address FROM clients WHERE business_id=? ORDER BY name COLLATE NOCASE ASC').bind(businessId).all()).map(mapClientRow)
  if(['new-order','products'].includes(surface) && granted.has('products.view'))payload.products=rows(await db.prepare(`SELECT id,category,size,presentation_type,presentation_value,presentation_unit,name,price_cents
    FROM products WHERE business_id=? AND active=1 ORDER BY name COLLATE NOCASE ASC`).bind(businessId).all()).map(mapProductRow)
  if(['dashboard','finance','receivables'].includes(surface) && ['finance.overview','finance.movements','finance.movements.manage'].some(cap=>granted.has(cap)))payload.financeSettings=await loadFinanceSettings(db,businessId)
  const projected=projectBootstrap(payload,granted)
  return {...projected,readModel:{version:1,surface,completeCollections:Object.keys(projected).filter(key=>['clients','products','orders','tables','tableTabs','movements','financeSettings'].includes(key)),orderScope,counters,operationalOrders,openTableTabIds}}
}
