import { apiError } from '../http.js'
import { APPLICATION_CAPABILITIES, SETTINGS_MANAGE_TO_VIEW } from '../../shared/settingsAccess.js'
import { prepareSettingsAssertion, clearSettingsAssertions } from '../settingsTransactions.js'

const known=new Set(APPLICATION_CAPABILITIES)
const changed=()=>apiError(409,'SESSION_CONTEXT_CHANGED','Sua sessão ou permissão mudou. Atualize antes de continuar.')
const sameEffectiveGrants=(expected,source)=>{
  if(!(expected instanceof Set))return false
  const actual=new Set(source.filter(capability=>known.has(capability)))
  for(const [manage,view] of Object.entries(SETTINGS_MANAGE_TO_VIEW))
    if(actual.has(manage))actual.add(view)
  return JSON.stringify([...expected].sort())===JSON.stringify([...actual].sort())
}

// The multi-company DB has its own stricter identity/role assertion.
// Apply this narrower guard only to financial/operational critical commands
// issued under the standalone human-user session (not printing or TV routes).
export const withFinanceMutationGuard=(db,context)=>{
  if(!context?.userId || !context?.sessionId || !context?.roleId
    || context?.accountId || context?.identitySessionId
    || !['user_only','enrollment'].includes(context.authMode))return db

  return {
    prepare:db.prepare.bind(db),
    auditContext:db.auditContext,
    async batch(statements){
      const raw=await db.prepare(`SELECT capability FROM role_capabilities
        WHERE business_id=? AND role_id=? ORDER BY capability`)
        .bind(context.businessId,context.roleId).all()
      const caps=(raw.results||[]).map(row=>row.capability)
      if(!sameEffectiveGrants(context.granted,caps))throw changed()
      const stamp=new Date().toISOString(),tx=crypto.randomUUID()
      const predicate=`EXISTS(SELECT 1 FROM sessions s
        JOIN users u ON u.id=s.user_id AND u.business_id=s.business_id AND u.active=1
        JOIN roles r ON r.id=u.role_id AND r.business_id=u.business_id AND r.active=1
        JOIN business_auth_state auth ON auth.business_id=s.business_id
        WHERE s.id=? AND s.business_id=? AND s.user_id=?
          AND s.revoked_at IS NULL AND s.expires_at>?
          AND u.role_id=? AND auth.mode=?
          AND (SELECT COALESCE(json_group_array(capability),'[]') FROM
            (SELECT capability FROM role_capabilities
             WHERE business_id=s.business_id AND role_id=r.id ORDER BY capability))=?)`
      const bindings=[context.sessionId,context.businessId,context.userId,stamp,
        context.roleId,context.authMode,JSON.stringify(caps)]
      const guard=prepareSettingsAssertion(db,tx,'authorization-snapshot',predicate,bindings)
      try{
        const result=await db.batch([guard,...statements,clearSettingsAssertions(db,tx)])
        return result.slice(1,-1)
      }catch(error){
        if(/SETTINGS_INVALID|SETTINGS_REVISION_CONFLICT/.test(String(error?.message||''))){
          const current=await db.prepare(`SELECT CASE WHEN (${predicate}) THEN 1 ELSE 0 END AS allowed`)
            .bind(...bindings).first()
          if(!current?.allowed)throw changed()
        }
        throw error
      }
    },
  }
}
