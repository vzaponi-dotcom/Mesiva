import { prepareBusinessDefaults } from '../tenancy/businessDefaults.js'
import { createSettingsDb } from './settingsDb.js'
import { hashHumanPassword } from '../access/credentials.js'
import { prepareBuiltinRoles } from '../access/roles.js'

export async function createTenancyFixture(t,{operationalDefaults=false}={}) {
  const fixture = createSettingsDb()
  t?.after(fixture.close)
  const { db, sqlite } = fixture
  const now = new Date('2026-10-02T12:00:00.000Z')
  const timestamp = now.toISOString()
  const businesses = { A: 'company-A', B: 'company-B' }
  const accounts = { alice: 'account-alice', bob: 'account-bob', carol: 'account-carol', admin: 'account-admin', pending: 'account-pending' }
  const members = { aliceA: 'member-alice-A', aliceB: 'member-alice-B', bobA: 'member-bob-A', carolB: 'member-carol-B' }
  for (const [key, id] of Object.entries(businesses)) {
    if(operationalDefaults){
      await db.batch(prepareBusinessDefaults(db,{businessId:id,name:`Company ${key}`,now}))
      sqlite.prepare("UPDATE businesses SET access_status='active' WHERE id=?").run(id)
    }else{
    sqlite.prepare("INSERT INTO businesses(id,slug,name,created_at,updated_at,access_status) VALUES(?,?,?,?,?,'active')").run(id, id, `Company ${key}`, timestamp, timestamp)
    await db.batch(prepareBuiltinRoles(db, id, now))
    }
  }
  const verifier = await hashHumanPassword('Fixture password 2026!')
  for (const [name, id] of Object.entries(accounts)) {
    sqlite.prepare('INSERT INTO accounts(id,email_normalized,display_name,email_verified_at,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(id, `${name}@example.test`, name[0].toUpperCase() + name.slice(1), name === 'pending' ? null : timestamp, timestamp, timestamp)
    if (name !== 'pending') sqlite.prepare('INSERT INTO account_credentials(account_id,password_verifier,password_changed_at,created_at,updated_at) VALUES(?,?,?,?,?)').run(id, verifier, timestamp, timestamp, timestamp)
  }
  for (const [name, id] of Object.entries(members)) {
    const businessId = businesses[name.slice(-1)]
    const accountId = accounts[name.slice(0, -1)]
    const role = ['aliceA', 'carolB'].includes(name) ? 'manager' : 'operator'
    sqlite.prepare("INSERT INTO users(id,business_id,display_name,login_normalized,role_id,account_id,membership_state,created_at,updated_at) VALUES(?,?,?,?,?,?,'active',?,?)").run(id, businessId, name, `${name.slice(0, -1)}@example.test`, `${businessId}:${role}`, accountId, timestamp, timestamp)
  }
  for (const capability of ['platform.businesses.view', 'platform.businesses.create', 'platform.invitations.resend']) sqlite.prepare('INSERT INTO platform_grants(account_id,capability,created_at) VALUES(?,?,?)').run(accounts.admin, capability, timestamp)
  const contexts = {}
  for (const name of ['aliceA', 'aliceB', 'carolB', 'admin']) {
    const accountId = name === 'admin' ? accounts.admin : accounts[name.slice(0, -1)]
    const businessId = name === 'admin' ? null : businesses[name.slice(-1)]
    const userId = name === 'admin' ? null : members[name]
    const familyId = `family-${name}`, identitySessionId = `identity-session-${name}`, businessSessionId = businessId ? `business-session-${name}` : null
    const expiresAt = '2026-10-03T00:00:00.000Z'
    sqlite.prepare("INSERT INTO identity_session_families(id,account_id,device_mode,created_at,expires_at) VALUES(?,?,'shared',?,?)").run(familyId, accountId, timestamp, expiresAt)
    if (businessId) sqlite.prepare("INSERT INTO sessions(id,business_id,token_hash,created_at,expires_at,last_seen_at,user_id,device_mode) VALUES(?,?,?,?,?,?,?,'shared')").run(businessSessionId, businessId, `internal-${name}`, timestamp, expiresAt, timestamp, userId)
    sqlite.prepare('INSERT INTO identity_sessions(id,account_id,credential_revision,family_id,token_hash,context_id,scope,business_id,user_id,business_session_id,created_at,expires_at,last_seen_at) VALUES(?,?,1,?,?,?,?,?,?,?,?,?,?)').run(identitySessionId, accountId, familyId, `hash-${name}`, `context-${name}`, businessId ? 'business' : 'platform', businessId, userId, businessSessionId, timestamp, expiresAt, timestamp)
    sqlite.prepare('UPDATE identity_session_families SET current_identity_session_id = ? WHERE id = ?').run(identitySessionId, familyId)
    contexts[name] = { accountId, identitySessionId, familyId, businessId, userId, sessionId: businessSessionId, contextId: `context-${name}`, scope: businessId ? 'business' : 'platform', credentialRevision: 1, expiresAt, deviceMode: 'shared' }
  }
  return { ...fixture, now, accounts, businesses, members, contexts }
}
