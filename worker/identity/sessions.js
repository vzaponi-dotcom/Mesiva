import { registerCommittedEffect } from '../realtime/committedEffects.js'
import { sessionRevocationEffects } from '../realtime/effectCatalog.js'
import { cookieValue, sha256Hex } from '../auth.js'
import { apiError } from '../http.js'
import { APPLICATION_CAPABILITIES } from '../../shared/settingsAccess.js'
import { PLATFORM_CAPABILITIES } from '../../shared/companyAccess.js'
import { prepareIdentityAssertion, commitIdentityStatements } from './transactions.js'
import { prepareIdentityAudit } from './audit.js'

export const ACCOUNT_SESSION_DURATIONS = Object.freeze({ shared: 12 * 60 * 60, personal: 7 * 24 * 60 * 60 })
export const randomIdentityToken = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
export const contextChanged = () => apiError(409, 'SESSION_CONTEXT_CHANGED', 'Seu contexto mudou. Atualize a sessão antes de continuar.')
const forbidden = () => apiError(403, 'FORBIDDEN', 'Você não tem acesso a esse destino.')
const roleGrantsSql = `(SELECT json_group_array(capability) FROM
  (SELECT capability FROM role_capabilities WHERE business_id = u.business_id AND role_id = u.role_id ORDER BY capability))`
const platformGrantsSql = `(SELECT json_group_array(capability) FROM
  (SELECT capability FROM platform_grants WHERE account_id = s.account_id ORDER BY capability))`

const sessionSelect = `SELECT s.id,s.account_id,s.credential_revision,s.family_id,s.context_id,s.scope,s.business_id,s.user_id,
  s.business_session_id,s.expires_at,f.device_mode,a.display_name AS account_name,a.email_normalized,
  u.display_name,u.role_id,r.name AS role_name,r.version AS role_version,
  ${roleGrantsSql} AS role_grants_json,${platformGrantsSql} AS platform_grants_json
  FROM identity_sessions s JOIN accounts a ON a.id = s.account_id
  JOIN account_credentials c ON c.account_id = s.account_id
  JOIN identity_session_families f ON f.id = s.family_id AND f.account_id = s.account_id
  LEFT JOIN users u ON u.id = s.user_id AND u.business_id = s.business_id AND u.account_id = s.account_id
  LEFT JOIN roles r ON r.id = u.role_id AND r.business_id = u.business_id
  LEFT JOIN businesses b ON b.id = s.business_id
  LEFT JOIN sessions bs ON bs.id = s.business_session_id AND bs.business_id = s.business_id AND bs.user_id = s.user_id`
const eligibility = `a.active = 1 AND a.email_verified_at IS NOT NULL AND c.version = 1 AND c.revision = s.credential_revision
  AND s.revoked_at IS NULL AND f.revoked_at IS NULL AND f.current_identity_session_id = s.id
  AND s.expires_at > ? AND f.expires_at = s.expires_at
  AND (s.scope = 'identity' OR (s.scope = 'business' AND b.access_status = 'active' AND b.lifecycle_status = 'enabled' AND u.active = 1
    AND u.membership_state = 'active' AND r.active = 1 AND bs.revoked_at IS NULL AND bs.expires_at = s.expires_at)
    OR (s.scope = 'platform' AND EXISTS (SELECT 1 FROM platform_grants g WHERE g.account_id = s.account_id AND g.capability = 'platform.businesses.view')))`

export const loadAccountSessionRow = (db, id, now = new Date()) => db.prepare(`${sessionSelect} WHERE ${eligibility} AND s.id = ?`).bind(now.toISOString(), id).first()

export function prepareSessionSnapshotAssertion(db, row, now = new Date()) {
  return prepareIdentityAssertion(db, crypto.randomUUID(), `SELECT EXISTS(SELECT 1 FROM
    (${sessionSelect} WHERE ${eligibility} AND s.id = ?) current WHERE current.context_id = ?
    AND current.account_id = ? AND current.family_id = ? AND current.credential_revision = ?
    AND current.role_id IS ? AND current.role_version IS ? AND current.role_grants_json = ? AND current.platform_grants_json = ?)`,
  [now.toISOString(), row.id, row.context_id, row.account_id, row.family_id, row.credential_revision,
    row.role_id, row.role_version, row.role_grants_json, row.platform_grants_json])
}

export async function prepareAccountSession(db, {
  accountId, expectedCredentialRevision, scope = 'identity', businessId = null, familyId = null, expiresAt = null,
  deviceMode = 'shared', now = new Date(),
}) {
  if (!Object.hasOwn(ACCOUNT_SESSION_DURATIONS, deviceMode) || !['identity', 'business', 'platform'].includes(scope)
    || !Number.isSafeInteger(expectedCredentialRevision) || expectedCredentialRevision < 1 || (scope !== 'business' && businessId !== null)) {
    throw apiError(400, 'INVALID_SESSION_SCOPE', 'Seleção de acesso inválida.')
  }
  const timestamp = now.toISOString()
  const statements = [prepareIdentityAssertion(db, crypto.randomUUID(), `SELECT EXISTS(SELECT 1 FROM accounts a
    JOIN account_credentials c ON c.account_id = a.id WHERE a.id = ? AND a.active = 1 AND a.email_verified_at IS NOT NULL
    AND c.revision = ? AND c.version = 1)`, [accountId, expectedCredentialRevision])]
  if (familyId) {
    const family = await db.prepare('SELECT account_id,device_mode,expires_at,revoked_at FROM identity_session_families WHERE id = ?').bind(familyId).first()
    if (!family || family.account_id !== accountId || family.device_mode !== deviceMode || family.revoked_at
      || Date.parse(family.expires_at) <= now.getTime() || (expiresAt && expiresAt !== family.expires_at)) throw contextChanged()
    expiresAt = family.expires_at
    statements.push(prepareIdentityAssertion(db, crypto.randomUUID(), `SELECT EXISTS(SELECT 1 FROM identity_session_families
      WHERE id = ? AND account_id = ? AND device_mode = ? AND expires_at = ? AND expires_at > ? AND revoked_at IS NULL)`,
    [familyId, accountId, deviceMode, expiresAt, timestamp]))
  } else {
    familyId = crypto.randomUUID()
    const maximum = now.getTime() + ACCOUNT_SESSION_DURATIONS[deviceMode] * 1000
    expiresAt ??= new Date(maximum).toISOString()
    if (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= now.getTime() || Date.parse(expiresAt) > maximum) throw contextChanged()
    statements.push(db.prepare('INSERT INTO identity_session_families(id,account_id,device_mode,created_at,expires_at) VALUES (?,?,?,?,?)').bind(familyId, accountId, deviceMode, timestamp, expiresAt))
  }
  let userId = null, businessSessionId = null
  if (scope === 'business') {
    const member = await db.prepare(`SELECT u.id,u.role_id,r.version,
      ${roleGrantsSql} AS grants_json FROM users u JOIN roles r ON r.id = u.role_id AND r.business_id = u.business_id
      JOIN businesses b ON b.id = u.business_id WHERE u.business_id = ? AND u.account_id = ?
      AND u.active = 1 AND u.membership_state = 'active' AND r.active = 1 AND b.access_status = 'active' AND b.lifecycle_status = 'enabled'`).bind(businessId, accountId).first()
    if (!member) throw forbidden()
    userId = member.id
    businessSessionId = crypto.randomUUID()
    statements.push(prepareIdentityAssertion(db, crypto.randomUUID(), `SELECT EXISTS(SELECT 1 FROM users u
      JOIN roles r ON r.id = u.role_id AND r.business_id = u.business_id JOIN businesses b ON b.id = u.business_id
      WHERE u.id = ? AND u.business_id = ? AND u.account_id = ? AND u.active = 1 AND u.membership_state = 'active'
      AND u.role_id = ? AND r.version = ? AND r.active = 1 AND b.access_status = 'active' AND b.lifecycle_status = 'enabled' AND ${roleGrantsSql} = ?)`,
    [userId, businessId, accountId, member.role_id, member.version, member.grants_json]))
    statements.push(db.prepare(`INSERT INTO sessions(id,business_id,token_hash,created_at,expires_at,last_seen_at,user_id,device_mode)
      VALUES (?,?,?,?,?,?,?,?)`).bind(businessSessionId, businessId, await sha256Hex(randomIdentityToken()), timestamp, expiresAt, timestamp, userId, deviceMode))
  }
  if (scope === 'platform') {
    const { results } = await db.prepare('SELECT capability FROM platform_grants WHERE account_id = ? ORDER BY capability').bind(accountId).all()
    if (!results.some((row) => row.capability === 'platform.businesses.view')) throw forbidden()
    statements.push(prepareIdentityAssertion(db, crypto.randomUUID(), `SELECT
      (SELECT json_group_array(capability) FROM (SELECT capability FROM platform_grants WHERE account_id = ? ORDER BY capability)) = ?`,
    [accountId, JSON.stringify(results.map((row) => row.capability))]))
  }
  const token = randomIdentityToken(), identitySessionId = crypto.randomUUID(), contextId = crypto.randomUUID()
  statements.push(db.prepare(`INSERT INTO identity_sessions(id,account_id,credential_revision,family_id,token_hash,context_id,scope,
    business_id,user_id,business_session_id,created_at,expires_at,last_seen_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(identitySessionId, accountId, expectedCredentialRevision, familyId, await sha256Hex(token), contextId, scope,
      businessId, userId, businessSessionId, timestamp, expiresAt, timestamp))
  statements.push(db.prepare('UPDATE identity_session_families SET current_identity_session_id = ? WHERE id = ? AND account_id = ?').bind(identitySessionId, familyId, accountId))
  return { statements, value: { token, accountId, identitySessionId, familyId, contextId, expiresAt, deviceMode, scope,
    ...(scope === 'business' ? { businessId, userId, businessSessionId } : {}) } }
}

// Keep persisted grants private for snapshot validation; unknown grants never authorize.
const roleGrantsSnapshots = new WeakMap()
export const getRoleGrantsSnapshot = context => roleGrantsSnapshots.get(context)

function contextFromRow(row) {
  const context = { accountId: row.account_id, identitySessionId: row.id, familyId: row.family_id, scope: row.scope,
    contextId: row.context_id, expiresAt: row.expires_at, deviceMode: row.device_mode, credentialRevision: row.credential_revision,
    accountDisplayName: row.account_name, email: row.email_normalized, emailVerified: true }
  if (row.scope === 'business') Object.assign(context, { businessId: row.business_id, userId: row.user_id, sessionId: row.business_session_id,
    displayName: row.display_name, roleName: row.role_name, roleId: row.role_id, roleVersion: row.role_version, authMode: 'user_only', legacy: false,
    granted: new Set(JSON.parse(row.role_grants_json).filter((value) => APPLICATION_CAPABILITIES.includes(value))) })
  if (row.scope === 'platform') context.platformGranted = new Set(JSON.parse(row.platform_grants_json).filter((value) => PLATFORM_CAPABILITIES.includes(value)))
  if (row.scope === 'business') roleGrantsSnapshots.set(context, row.role_grants_json)
  return Object.freeze(context)
}

export async function authenticateAccountRequest(request, env, now = new Date()) {
  const token = cookieValue(request, 'mesiva_session')
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null
  const row = await env.DB.prepare(`${sessionSelect} WHERE ${eligibility} AND s.token_hash = ?`).bind(now.toISOString(), await sha256Hex(token)).first()
  if (!row) return null
  const updated = await env.DB.prepare('UPDATE identity_sessions SET last_seen_at = ? WHERE id = ? AND revoked_at IS NULL').bind(now.toISOString(), row.id).run()
  return updated.meta?.changes === 1 ? contextFromRow(row) : null
}

export function prepareBrowserFamilyRevocation(db, context, now = new Date()) {
  const timestamp = now.toISOString()
  return [
    db.prepare('UPDATE identity_session_families SET revoked_at = COALESCE(revoked_at,?) WHERE id = ? AND account_id = ?').bind(timestamp, context.familyId, context.accountId),
    registerCommittedEffect(db.prepare('UPDATE identity_sessions SET revoked_at = COALESCE(revoked_at,?) WHERE family_id = ? AND account_id = ? AND revoked_at IS NULL RETURNING id,business_id').bind(timestamp, context.familyId, context.accountId),sessionRevocationEffects),
    db.prepare(`UPDATE sessions SET revoked_at = COALESCE(revoked_at,?) WHERE id IN
      (SELECT business_session_id FROM identity_sessions WHERE family_id = ? AND account_id = ? AND business_session_id IS NOT NULL)`).bind(timestamp, context.familyId, context.accountId),
  ]
}

export async function revokeBrowserFamily(db, context, now = new Date()) {
  await commitIdentityStatements(db, [...prepareBrowserFamilyRevocation(db, context, now),
    prepareIdentityAudit(db, { accountId: context.accountId, sessionId: context.identitySessionId, action: 'session.revoked', now })])
}
