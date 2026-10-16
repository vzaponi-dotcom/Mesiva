import { registerCommittedEffect } from '../realtime/committedEffects.js'
import { loadAccountSessionRow, prepareAccountSession, prepareSessionSnapshotAssertion, contextChanged } from '../identity/sessions.js'
import { commitIdentityStatements } from '../identity/transactions.js'
import { prepareIdentityAudit } from '../identity/audit.js'

export async function selectAccountScope(db, context, { scope, businessId = null, contextId }, now = new Date(), { monotonicNow = () => performance.now() } = {}) {
  const startedAt = monotonicNow()
  if (!context || !contextId || context.contextId !== contextId) throw contextChanged()
  const row = await loadAccountSessionRow(db, context.identitySessionId, now)
  if (!row || row.account_id !== context.accountId || row.family_id !== context.familyId || row.context_id !== contextId) throw contextChanged()
  const prepared = await prepareAccountSession(db, { accountId: context.accountId, expectedCredentialRevision: row.credential_revision,
    scope, businessId, familyId: row.family_id, expiresAt: row.expires_at, deviceMode: row.device_mode, now })
  // Include elapsed asynchronous work without losing the injected wall clock.
  const commitNow = new Date(now.getTime() + Math.max(0, Math.floor(monotonicNow() - startedAt)))
  try {
    await commitIdentityStatements(db, [prepareSessionSnapshotAssertion(db, row, commitNow), ...prepared.statements,
      registerCommittedEffect(db.prepare('UPDATE identity_sessions SET revoked_at = ? WHERE id = ?').bind(commitNow.toISOString(), row.id),row.business_id?{businessId:row.business_id,topics:[],orderIds:[],invalidations:[{scope:'session',id:row.id}]}:null),
      ...(row.business_session_id ? [db.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ? AND business_id = ?').bind(commitNow.toISOString(), row.business_session_id, row.business_id)] : []),
      prepareIdentityAudit(db, { accountId: context.accountId, sessionId: prepared.value.identitySessionId, action: 'session.selected', now: commitNow }),
    ])
  } catch (error) {
    if (/CHECK constraint failed: ok\s*=\s*1/.test(String(error?.message))) throw contextChanged()
    throw error
  }
  return prepared.value
}
