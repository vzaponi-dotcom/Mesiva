import { registerCommittedEffect } from '../realtime/committedEffects.js'
import { apiError } from '../http.js'

const actions = new Set(['business.created', 'invitation.issued', 'invitation.resent', 'invitation.delivery.accepted', 'invitation.delivery.rejected', 'invitation.delivery.uncertain', 'administrator.prepared', 'legacy.finalized', 'account.recovery.issued', 'business.suspended', 'business.resumed', 'business.deleted', 'business.restored', 'membership.revoked', 'membership.reactivated', 'invitation.cancelled'])
const factKeys = new Set(['from', 'to', 'accessStatus', 'membershipState', 'active', 'managementRevision'])
export function preparePlatformAudit(db, context, { action, businessId = null, result = 'success', reason = null, resourceType = null, resourceId = null, metadata = {}, now = new Date() }) {
  if (context?.scope !== 'platform' || !context.accountId) throw apiError(403, 'FORBIDDEN', 'Evento administrativo inválido.')
  if (!actions.has(action) || !['success', 'denied', 'failure'].includes(result)) throw apiError(400, 'INVALID_PLATFORM_EVENT', 'Evento administrativo inválido.')
  const safe = Object.fromEntries(Object.entries(metadata).filter(([key,value]) => factKeys.has(key) && (typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value) || typeof value === 'string' && value.length <= 100)))
  return registerCommittedEffect(db.prepare('INSERT INTO platform_audit_events(id,account_id,business_id,action,result,created_at,reason,resource_type,resource_id,metadata_json) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(), context.accountId, businessId, action, result, now.toISOString(), reason, resourceType, resourceId, JSON.stringify(safe)), businessId && result==='success' && ['business.suspended','business.deleted','business.resumed','business.restored','membership.revoked','membership.reactivated'].includes(action)?{businessId,topics:['settings'],orderIds:[],invalidations:[{scope:'business',id:businessId}]}:null)
}
