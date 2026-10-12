import { apiError } from '../http.js'
import { APPLICATION_CAPABILITIES, SETTINGS_MANAGE_TO_VIEW } from '../../shared/settingsAccess.js'
import { clearSettingsAssertions, prepareSettingsAssertion } from '../settingsTransactions.js'

const knownCapabilities=new Set(APPLICATION_CAPABILITIES)
const contextExpired=()=>apiError(409,'SESSION_CONTEXT_CHANGED','Sua sessão ou permissão mudou. Atualize antes de continuar.')
const sameGrants=(expected,rows)=>{
  const active=new Set(rows.map(row=>row.capability).filter(capability=>knownCapabilities.has(capability)))
  for(const [manage,view] of Object.entries(SETTINGS_MANAGE_TO_VIEW))
    if(active.has(manage))active.add(view)
  return expected instanceof Set &&
    JSON.stringify([...expected].sort())===JSON.stringify([...active].sort())
}

// A fresh facade per request; never mutate the shared environment or D1 binding.
// Multi-company sessions are protected by withBusinessSessionGuard before this
// facade. Personal/legacy sessions also require an atomic snapshot assertion at
// the commit boundary, rather than checking permissions only on HTTP entry/exit.
export function withAuditContext(db, context) {
  const actor=Object.freeze({...context})
  const prepare=db.prepare.bind(db)
  const batch=async(statements)=>{
    if(!actor.sessionId || !['legacy','enrollment','user_only'].includes(actor.authMode))
      return db.batch(statements)
    const transactionId=crypto.randomUUID()
    const at=new Date().toISOString()
    let predicate,bindings
    if(actor.userId){
      if(!actor.roleId)throw contextExpired()
      const roleGrants=await db.prepare(`SELECT capability FROM role_capabilities
        WHERE business_id=? AND role_id=? ORDER BY capability`)
        .bind(actor.businessId,actor.roleId).all()
      const raw=roleGrants.results||[]
      if(!sameGrants(actor.granted,raw))throw contextExpired()
      predicate=`EXISTS(SELECT 1 FROM sessions s
        JOIN users u ON u.id=s.user_id AND u.business_id=s.business_id
        JOIN roles r ON r.id=u.role_id AND r.business_id=u.business_id AND r.active=1
        JOIN business_auth_state a ON a.business_id=s.business_id
        WHERE s.id=? AND s.business_id=? AND s.user_id=?
          AND s.revoked_at IS NULL AND s.expires_at>?
          AND u.active=1 AND u.role_id=? AND a.mode=?
          AND (SELECT COALESCE(json_group_array(capability),'[]') FROM (
            SELECT capability FROM role_capabilities
              WHERE business_id=s.business_id AND role_id=r.id ORDER BY capability
          ))=?)`
      bindings=[actor.sessionId,actor.businessId,actor.userId,at,actor.roleId,
        actor.authMode,JSON.stringify(raw.map(row=>row.capability))]
    }else{
      predicate=`EXISTS(SELECT 1 FROM sessions s
        JOIN business_auth_state a ON a.business_id=s.business_id
        WHERE s.id=? AND s.business_id=? AND s.user_id IS NULL
          AND s.revoked_at IS NULL AND s.expires_at>?
          AND a.mode=? AND a.mode IN ('legacy','enrollment'))`
      bindings=[actor.sessionId,actor.businessId,at,actor.authMode]
    }
    const guard=prepareSettingsAssertion(db,transactionId,'authorized-session',predicate,bindings)
    try{
      const result=await db.batch([guard,...statements,clearSettingsAssertions(db,transactionId)])
      return result.slice(1,-1)
    }catch(error){
      if(/SETTINGS_INVALID|SETTINGS_REVISION_CONFLICT/.test(String(error?.message||'')))throw contextExpired()
      throw error
    }
  }
  return {prepare,batch,auditContext:actor}
}

// Direct internal repository calls predate individual access. They explicitly
// retain legacy evidence; HTTP callers always install an authenticated context.
export const auditContext = (db, businessId) => {
  const context = db.auditContext || { businessId, legacy: true, displayName: 'Acesso legado' }
  if (context.businessId !== businessId) throw apiError(403, 'FORBIDDEN', 'Negócio inválido.')
  return context
}

export function prepareAuditEvent(db, context, { action, resourceType = null, resourceId = null, outcome = 'success', metadata = {}, now = new Date(), onlyIfChanged = false }) {
  const actorType = context.actorType || (context.legacy ? 'legacy' : context.userId ? 'user' : 'system')
  const safe = {}
  if (['shared','personal'].includes(metadata.deviceMode)) safe.deviceMode = metadata.deviceMode
  if (['legacy','enrollment','user_only'].includes(metadata.authMode)) safe.authMode = metadata.authMode
  if (context.stationId) safe.stationId = context.stationId
  return db.prepare(`INSERT INTO audit_events
    (id,business_id,occurred_at,actor_type,actor_user_id,actor_name,session_id,action,resource_type,resource_id,result,metadata_json)
    SELECT ?,?,?,?,?,?,?,?,?,?,?,? ${onlyIfChanged ? 'WHERE changes() > 0' : ''}`)
    .bind(crypto.randomUUID(),context.businessId,now.toISOString(),actorType,actorType === 'user' ? context.userId : null,
      actorType === 'system' ? 'Sistema' : actorType === 'legacy' ? 'Acesso legado' : context.displayName,
      context.sessionId || null,action,resourceType,resourceId,outcome,JSON.stringify(safe))
}

export const businessEvent = (db,businessId,event) => prepareAuditEvent(db,auditContext(db,businessId),event)

// selectSql is a repository-owned SELECT of resource IDs, never request SQL.
// Used before a matching bulk UPDATE in the same batch so each accepted row has
// one event and competing/repeated operations cannot duplicate past outcomes.
export function prepareAuditSelection(db,businessId,event,selectSql,bindings=[],{stationFromSelection=false}={}) {
  const context=auditContext(db,businessId)
  const type=context.actorType || (context.legacy ? 'legacy' : context.userId ? 'user' : 'system')
  // Only repository-owned SELECTs may provide a station already joined to this tenant.
  const metadataSql = stationFromSelection
    ? "CASE WHEN selected.station_id IS NULL THEN '{}' ELSE json_object('stationId',selected.station_id) END"
    : '?'
  const metadataBindings = stationFromSelection ? [] : [JSON.stringify(context.stationId?{stationId:context.stationId}:{})]
  return db.prepare(`INSERT INTO audit_events(id,business_id,occurred_at,actor_type,actor_user_id,actor_name,session_id,action,resource_type,resource_id,result,metadata_json)
    SELECT ? || selected.id,?,?,?,?,?,?,?,?,selected.id,?,${metadataSql} FROM (${selectSql}) selected`)
    .bind(`${crypto.randomUUID()}:`,businessId,(event.now||new Date()).toISOString(),type,type==='user'?context.userId:null,
      type==='system'?'Sistema':type==='legacy'?'Acesso legado':context.displayName,context.sessionId||null,event.action,event.resourceType,event.outcome||'success',...metadataBindings,...bindings)
}

// Explicitly called at a repository mutation boundary. D1 returns the original
// statement result; its audit is conditional on that immediately preceding write.
export function auditedMutation(db,businessId,statement,event) {
  const execute = async () => (await db.batch([statement,businessEvent(db,businessId,{...event,onlyIfChanged:true})]))[0]
  return { run: execute, all: execute, first: async () => (await execute()).results?.[0] || null }
}

export async function listActivity(db,businessId,{userId,from,to,type,cursor,limit=50}={}) {
  limit = Number(limit)
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw apiError(400,'INVALID_ACTIVITY_FILTER','Limite inválido.')
  const where=['business_id=?'],values=[businessId]
  for (const [value,column,operator] of [[userId,'actor_user_id','='],[type,'action','='],[from,'occurred_at','>='],[to,'occurred_at','<=']]) {
    if (value) {
      if (typeof value !== 'string' || value.length > 200 || (column==='occurred_at' && !Number.isFinite(Date.parse(value)))) throw apiError(400,'INVALID_ACTIVITY_FILTER','Filtro inválido.')
      where.push(`${column}${operator}?`); values.push(column==='occurred_at' ? new Date(value).toISOString() : value)
    }
  }
  if (cursor) {
    let position
    try { position=JSON.parse(atob(cursor)) } catch { throw apiError(400,'INVALID_ACTIVITY_CURSOR','Página inválida.') }
    if (!Array.isArray(position) || position.length!==2 || position.some(v=>typeof v!=='string' || v.length>200) || !Number.isFinite(Date.parse(position[0]))) throw apiError(400,'INVALID_ACTIVITY_CURSOR','Página inválida.')
    where.push('(occurred_at < ? OR (occurred_at = ? AND id < ?))'); values.push(position[0],position[0],position[1])
  }
  const {results}=await db.prepare(`SELECT id,occurred_at,actor_type,actor_user_id,actor_name,action,resource_type,resource_id,result
    FROM audit_events WHERE ${where.join(' AND ')} ORDER BY occurred_at DESC,id DESC LIMIT ?`).bind(...values,limit+1).all()
  const rows=results.slice(0,limit),last=rows.at(-1)
  return {items:rows.map(row=>({id:row.id,occurredAt:row.occurred_at,actor:{type:row.actor_type,userId:row.actor_user_id,displayName:row.actor_name},
    action:row.action,resourceType:row.resource_type,resourceId:row.resource_id,outcome:row.result})),nextCursor:results.length>limit?btoa(JSON.stringify([last.occurred_at,last.id])):null}
}

// Security attempts have no business mutation to compose with.
export function prepareSecurityEvent(db, { businessId, action, result, context = null, metadata = {}, now = new Date() }) {
  const safe = {}
  if (['shared','personal'].includes(metadata.deviceMode)) safe.deviceMode = metadata.deviceMode
  if (['legacy','enrollment','user_only'].includes(metadata.authMode)) safe.authMode = metadata.authMode
  const actorType = context?.userId ? 'user' : context?.legacy ? 'legacy' : 'system'
  return db.prepare(`INSERT INTO audit_events
    (id,business_id,occurred_at,actor_type,actor_user_id,actor_name,session_id,action,result,metadata_json)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(), businessId, now.toISOString(), actorType,
      context?.userId || null, context?.displayName || 'Sistema', context?.sessionId || null, action, result, JSON.stringify(safe))
}
export async function recordSecurityEvent(db, options) {
  await prepareSecurityEvent(db, options).run()
}
