import { linkCommittedStatement, inheritCommittedEffect } from '../realtime/committedEffects.js'
import { loadAccountSessionRow, prepareSessionSnapshotAssertion, prepareSessionSnapshotCheck, contextChanged, getRoleGrantsSnapshot } from '../identity/sessions.js'

// A request-owned facade. Use the original binding for guards, never itself.
export function withBusinessSessionGuard(db, context, { now = new Date(), monotonicNow = () => performance.now() } = {}) {
  const started = monotonicNow(), originals = new WeakMap(), reads = new WeakSet()
  const roleGrantsSnapshot = getRoleGrantsSnapshot(context) ?? (context.granted ? JSON.stringify([...context.granted].sort()) : undefined)
  const execute = async statements => {
    const currentNow = new Date(now.getTime() + Math.max(0, Math.floor(monotonicNow() - started)))
    const row = await loadAccountSessionRow(db, context.identitySessionId, currentNow)
    if (!row || row.scope !== 'business' || row.business_id !== context.businessId || row.account_id !== context.accountId || row.context_id !== context.contextId
      || context.roleVersion !== undefined && row.role_version !== context.roleVersion
      || context.credentialRevision !== undefined && row.credential_revision !== context.credentialRevision
      || roleGrantsSnapshot !== undefined && roleGrantsSnapshot !== row.role_grants_json) throw contextChanged()
    const raw = statements.map(statement => originals.get(statement) || statement)
    if (raw.every(statement => reads.has(statement))) {
      // D1 batch reads share one transactional snapshot. Recheck authorization
      // in that snapshot and reject before returning any rows; final HTTP
      // response validation remains in place for changes after this batch.
      const results = await db.batch([prepareSessionSnapshotCheck(db,row,currentNow),...raw])
      if (results[0]?.results?.[0]?.ok !== 1) throw contextChanged()
      return results.slice(1)
    }
    try {
      const results = await db.batch([prepareSessionSnapshotAssertion(db,row,currentNow),...raw,db.prepare('DELETE FROM identity_tx_assertions')])
      return results.slice(1,-1)
    } catch (error) {
      if (/CHECK constraint failed: ok\s*=\s*1/.test(String(error?.message))) throw contextChanged()
      throw error
    }
  }
  const wrap = (statement, readOnly = false) => {
    if (readOnly) reads.add(statement)
    const facade = {
      bind: (...values) => inheritCommittedEffect(facade,wrap(statement.bind(...values),readOnly)),
      async first(column) { const row = (await execute([statement]))[0]?.results?.[0]; return row ? column === undefined ? row : row[column] : null },
      async all() { return (await execute([statement]))[0] },
      async run() { return (await execute([statement]))[0] },
    }
    originals.set(facade,statement)
    return linkCommittedStatement(facade,statement)
  }
  return { prepare: sql => wrap(db.prepare(sql), /^\s*SELECT\b/i.test(sql)), batch: execute }
}
