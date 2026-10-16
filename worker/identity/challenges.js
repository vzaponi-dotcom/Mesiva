import { registerCommittedEffect } from '../realtime/committedEffects.js'
import { sessionRevocationEffects } from '../realtime/effectCatalog.js'
import { apiError } from '../http.js'
import { sha256Hex } from '../auth.js'
import { hashHumanPassword, verifyHumanPassword } from '../access/credentials.js'
import { randomIdentityToken, loadAccountSessionRow, prepareSessionSnapshotAssertion, prepareAccountSession, contextChanged } from './sessions.js'
import { commitIdentityStatements, prepareIdentityAssertion } from './transactions.js'
import { prepareIdentityAudit } from './audit.js'

export const invalidIdentityChallenge = () => apiError(400, 'INVALID_EMAIL_CHALLENGE', 'Link inválido ou expirado. Solicite um novo link.')
const eligibleChallenge = `SELECT h.* FROM identity_challenges h JOIN accounts a ON a.id = h.account_id
  LEFT JOIN account_credentials c ON c.account_id = a.id WHERE h.token_hash = ? AND h.consumed_at IS NULL
  AND h.revoked_at IS NULL AND h.expires_at > ? AND a.active = 1 AND a.email_normalized = h.email_normalized
  AND ((h.purpose = 'activation' AND a.email_verified_at IS NULL AND c.account_id IS NULL)
    OR (h.purpose = 'password_reset' AND a.email_verified_at IS NOT NULL AND c.version = 1 AND c.revision = h.expected_revision))`

export function prepareCredentialChallengeRevocation(db, accountId, now = new Date()) {
  return db.prepare('UPDATE identity_challenges SET revoked_at = ? WHERE account_id = ? AND consumed_at IS NULL AND revoked_at IS NULL').bind(now.toISOString(), accountId)
}

export function prepareGlobalSessionRevocation(db, accountId, now = new Date(), preserveFamilyId = null) {
  const timestamp = now.toISOString()
  return [
    registerCommittedEffect(db.prepare('UPDATE identity_sessions SET revoked_at = COALESCE(revoked_at,?) WHERE account_id = ? AND revoked_at IS NULL RETURNING id,business_id').bind(timestamp, accountId),result=>sessionRevocationEffects(result,accountId)),
    db.prepare('UPDATE identity_session_families SET revoked_at = COALESCE(revoked_at,?) WHERE account_id = ? AND (? IS NULL OR id != ?)').bind(timestamp, accountId, preserveFamilyId, preserveFamilyId),
    db.prepare('UPDATE sessions SET revoked_at = COALESCE(revoked_at,?) WHERE user_id IN (SELECT id FROM users WHERE account_id = ?)').bind(timestamp, accountId),
  ]
}

export async function prepareIdentityChallenge(db, { accountId, purpose, expectedRevision = null, now = new Date() }) {
  if (!['activation', 'password_reset'].includes(purpose)) throw invalidIdentityChallenge()
  const account = await db.prepare('SELECT email_normalized FROM accounts WHERE id = ?').bind(accountId).first()
  if (!account) throw invalidIdentityChallenge()
  const id = crypto.randomUUID(), token = randomIdentityToken(), timestamp = now.toISOString()
  const expiresAt = new Date(now.getTime() + (purpose === 'activation' ? 24 * 3600_000 : 30 * 60_000)).toISOString()
  const predicate = `SELECT EXISTS(SELECT 1 FROM accounts a LEFT JOIN account_credentials c ON c.account_id = a.id
    WHERE a.id = ? AND a.email_normalized = ? AND a.active = 1 AND ${purpose === 'activation'
      ? 'a.email_verified_at IS NULL AND c.account_id IS NULL'
      : 'a.email_verified_at IS NOT NULL AND c.version = 1 AND c.revision = ?'})`
  return { statements: [
    prepareIdentityAssertion(db, crypto.randomUUID(), predicate, [accountId, account.email_normalized, ...(purpose === 'password_reset' ? [expectedRevision] : [])]),
    prepareCredentialChallengeRevocation(db, accountId, now),
    db.prepare('INSERT INTO identity_challenges(id,account_id,purpose,email_normalized,token_hash,expected_revision,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?)')
      .bind(id, accountId, purpose, account.email_normalized, await sha256Hex(token), purpose === 'password_reset' ? expectedRevision : null, timestamp, expiresAt),
    prepareIdentityAudit(db, { accountId, action: 'challenge.issued', now }),
  ], value: { id, subjectId: id, accountId, token, purpose, email: account.email_normalized, expiresAt } }
}

async function loadChallenge(db, token, now) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw invalidIdentityChallenge()
  const hash = await sha256Hex(token)
  const row = await db.prepare(eligibleChallenge).bind(hash, now.toISOString()).first()
  if (!row) throw invalidIdentityChallenge()
  return { row, hash }
}

export async function inspectIdentityChallenge(db, { token, now = new Date() }) {
  const { row } = await loadChallenge(db, token, now)
  return { purpose: row.purpose, expiresAt: row.expires_at }
}

export async function completeIdentityChallenge(db, { token, password, now = new Date(), monotonicNow = () => performance.now() }) {
  const started = monotonicNow()
  const { row, hash } = await loadChallenge(db, token, now)
  const verifier = await hashHumanPassword(password)
  const commitNow = new Date(now.getTime() + Math.max(0, Math.floor(monotonicNow() - started)))
  const timestamp = commitNow.toISOString()
  const credential = row.purpose === 'activation'
    ? db.prepare('INSERT INTO account_credentials(account_id,password_verifier,version,revision,password_changed_at,created_at,updated_at) VALUES (?,?,1,1,?,?,?)').bind(row.account_id, verifier, timestamp, timestamp, timestamp)
    : db.prepare('UPDATE account_credentials SET password_verifier = ?,version = 1,revision = revision + 1,password_changed_at = ?,updated_at = ? WHERE account_id = ? AND revision = ?').bind(verifier, timestamp, timestamp, row.account_id, row.expected_revision)
  try {
    await commitIdentityStatements(db, [
      prepareIdentityAssertion(db, crypto.randomUUID(), `SELECT EXISTS(${eligibleChallenge} AND h.id = ? AND h.account_id = ?)`, [hash, timestamp, row.id, row.account_id]),
      credential,
      db.prepare('UPDATE accounts SET email_verified_at = COALESCE(email_verified_at,?),updated_at = ? WHERE id = ?').bind(timestamp, timestamp, row.account_id),
      db.prepare('UPDATE identity_challenges SET consumed_at = ? WHERE id = ?').bind(timestamp, row.id),
      prepareCredentialChallengeRevocation(db, row.account_id, commitNow),
      ...prepareGlobalSessionRevocation(db, row.account_id, commitNow),
      prepareIdentityAudit(db, { accountId: row.account_id, action: 'challenge.completed', now: commitNow }),
    ])
  } catch (error) {
    if (/CHECK constraint failed: ok\s*=\s*1/.test(String(error?.message))) throw invalidIdentityChallenge()
    throw error
  }
  return { completed: true, purpose: row.purpose }
}

export async function changeAccountPassword(db, context, { currentPassword, password }, now = new Date()) {
  const started = performance.now()
  const row = await loadAccountSessionRow(db, context?.identitySessionId, now)
  if (!row || row.account_id !== context.accountId || row.context_id !== context.contextId) throw contextChanged()
  const credential = await db.prepare('SELECT password_verifier,revision FROM account_credentials WHERE account_id = ?').bind(context.accountId).first()
  if (!credential || credential.revision !== row.credential_revision) throw contextChanged()
  if (!await verifyHumanPassword(currentPassword, credential.password_verifier)) throw apiError(400, 'INVALID_CURRENT_PASSWORD', 'A senha atual está incorreta.')
  const verifier = await hashHumanPassword(password)
  const commitNow = new Date(now.getTime() + Math.max(0, Math.floor(performance.now() - started)))
  const current = await loadAccountSessionRow(db, row.id, commitNow)
  const successor = current ? await prepareAccountSession(db, { accountId: row.account_id, expectedCredentialRevision: row.credential_revision + 1,
    scope: row.scope, businessId: row.business_id, familyId: row.family_id, expiresAt: row.expires_at, deviceMode: row.device_mode, now: commitNow }) : null
  const timestamp = commitNow.toISOString()
  try {
    await commitIdentityStatements(db, [
      prepareIdentityAssertion(db, crypto.randomUUID(), `SELECT EXISTS(SELECT 1 FROM accounts a JOIN account_credentials c ON c.account_id = a.id
        WHERE a.id = ? AND a.active = 1 AND a.email_verified_at IS NOT NULL AND c.revision = ? AND c.password_verifier = ?)`, [row.account_id, row.credential_revision, credential.password_verifier]),
      ...(current ? [prepareSessionSnapshotAssertion(db, current, commitNow)] : []),
      db.prepare('UPDATE account_credentials SET password_verifier = ?,revision = revision + 1,password_changed_at = ?,updated_at = ? WHERE account_id = ?').bind(verifier, timestamp, timestamp, row.account_id),
      prepareCredentialChallengeRevocation(db, row.account_id, commitNow),
      ...prepareGlobalSessionRevocation(db, row.account_id, commitNow, successor ? row.family_id : null),
      ...(successor?.statements || []),
      prepareIdentityAudit(db, { accountId: row.account_id, action: 'password.changed', now: commitNow }),
    ])
  } catch (error) {
    if (/CHECK constraint failed: ok\s*=\s*1/.test(String(error?.message))) throw contextChanged()
    throw error
  }
  return { changed: true, ...(successor?.value || {}) }
}
