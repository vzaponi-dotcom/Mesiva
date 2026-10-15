import test from 'node:test'
import assert from 'node:assert/strict'
import { createTenancyFixture } from '../test-support/tenancyDb.js'
import { prepareAccountSession, authenticateAccountRequest } from '../identity/sessions.js'
import { commitIdentityStatements } from '../identity/transactions.js'
import { withBusinessSessionGuard } from './guardedBusinessDb.js'
import { handleRequest } from '../index.js'

const futureCapability = 'orders.edit'
async function setup(t) {
  const f = await createTenancyFixture(t)
  f.sqlite.prepare('INSERT INTO role_capabilities(business_id,role_id,capability) VALUES(?,?,?)')
    .run(f.businesses.A, `${f.businesses.A}:manager`, futureCapability)
  const session = await prepareAccountSession(f.db, { accountId:f.accounts.alice, businessId:f.businesses.A, scope:'business', expectedCredentialRevision:1 })
  await commitIdentityStatements(f.db, session.statements)
  const env = { DB:f.db, AUTH_MULTI_COMPANY_ENABLED:'true' }
  const request = path => new Request(`https://example.test${path}`, {headers:{cookie:`mesiva_session=${session.value.token}`, 'X-Mesiva-Context':session.value.contextId}})
  const context = await authenticateAccountRequest(request('/api/auth/session'), env)
  return {...f, env, request, context}
}

test('bootstrap accepts a stable role containing a future capability without granting or exposing it', async t => {
  const f = await setup(t)
  assert.equal(f.context.granted.has(futureCapability), false)
  const session = await handleRequest(f.request('/api/auth/session'), f.env)
  const view = await session.json()
  assert.equal(view.capabilities.includes(futureCapability), false)
  assert.equal(Object.hasOwn(view, 'roleGrantsSnapshot'), false)
  const bootstrap = await handleRequest(f.request('/api/bootstrap'), f.env)
  assert.equal(bootstrap.status, 200)
  assert.equal(Array.isArray((await bootstrap.json()).orders), true)
  assert.equal((await handleRequest(f.request('/api/orders'), f.env)).status, 200)
})

test('guard accepts stable future grants but rejects raw grant changes after authentication', async t => {
  const f = await setup(t)
  const guarded = withBusinessSessionGuard(f.db, f.context)
  assert.equal(await guarded.prepare('SELECT name FROM businesses WHERE id=?').bind(f.businesses.A).first('name'), 'Company A')
  f.sqlite.prepare('DELETE FROM role_capabilities WHERE business_id=? AND role_id=? AND capability=?')
    .run(f.businesses.A, `${f.businesses.A}:manager`, futureCapability)
  await assert.rejects(guarded.prepare('SELECT name FROM businesses WHERE id=?').bind(f.businesses.A).first(), {status:409, code:'SESSION_CONTEXT_CHANGED'})
})

test('guard rolls back writes if a future grant changes between validation and commit', async t => {
  const f = await setup(t), originalBatch = f.db.batch.bind(f.db)
  const guarded = withBusinessSessionGuard(f.db, f.context)
  let batchCalls = 0
  f.db.batch = async statements => {
    batchCalls++
    f.sqlite.prepare('DELETE FROM role_capabilities WHERE business_id=? AND role_id=? AND capability=?')
      .run(f.businesses.A, `${f.businesses.A}:manager`, futureCapability)
    return originalBatch(statements)
  }
  await assert.rejects(guarded.prepare('UPDATE businesses SET name=? WHERE id=?').bind('Changed', f.businesses.A).run(), {status:409, code:'SESSION_CONTEXT_CHANGED'})
  assert.equal(batchCalls, 1, 'race must reach the atomic batch assertion')
  assert.equal(f.sqlite.prepare('SELECT name FROM businesses WHERE id=?').get(f.businesses.A).name, 'Company A')
})

test('HTTP final validation rejects a future grant added after the operational read', async t => {
  const f = await setup(t), marked = new WeakSet(), prepare = f.db.prepare, originalBatch = f.db.batch
  f.sqlite.prepare('DELETE FROM role_capabilities WHERE business_id=? AND role_id=? AND capability=?')
    .run(f.businesses.A, `${f.businesses.A}:manager`, futureCapability)
  f.db.prepare = sql => {
    const statement = prepare(sql)
    if (!sql.includes('FROM order_items')) return statement
    return {...statement, bind(...values) { const bound = statement.bind(...values); marked.add(bound); return bound }}
  }
  f.db.batch = async statements => {
    const results = await originalBatch(statements)
    if (statements.some(statement => marked.has(statement))) {
      f.sqlite.prepare('INSERT INTO role_capabilities(business_id,role_id,capability) VALUES(?,?,?)')
        .run(f.businesses.A, `${f.businesses.A}:manager`, futureCapability)
    }
    return results
  }
  const response = await handleRequest(f.request('/api/orders'), f.env)
  assert.equal(response.status, 409)
  const body = await response.json()
  assert.equal(body.error.code, 'SESSION_CONTEXT_CHANGED')
  assert.equal(Object.hasOwn(body, 'orders'), false)
})