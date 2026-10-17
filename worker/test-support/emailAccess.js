import { createSettingsDb } from './settingsDb.js'
import { seedBuiltinRoles, BUILTIN_ROLES } from '../access/roles.js'
import { hashHumanPassword } from '../access/credentials.js'
import { sha256Hex } from '../auth.js'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, unlinkSync, rmdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { d1Adapter } from './settingsDb.js'

export const EMAIL_BUSINESS = 'amor-e-sabor'
export const EMAIL_NOW = new Date('2026-10-02T12:00:00.000Z')
export const EMAIL_PASSWORD = 'a quiet synthetic river flows'
export const EMAIL_CONFIG={AUTH_EMAIL_ENABLED:'true',RESEND_API_KEY:'synthetic-key',AUTH_EMAIL_FROM:'Mesiva <acesso@example.test>',AUTH_PUBLIC_ORIGIN:'https://staging.example.test'}
export const acceptedEmailOptions=(onSend)=>({env:EMAIL_CONFIG,deliver:async(_env,challenge)=>{onSend?.(challenge);return {status:'accepted'}}})

export function independentEmailClients(t,sqlite) {
  const directory = mkdtempSync(join(tmpdir(),'mesiva-email-race-'))
  const file = join(directory,'race.sqlite')
  sqlite.prepare('VACUUM INTO ?').run(file)
  const one = new DatabaseSync(file), two = new DatabaseSync(file)
  t.after(() => {one.close();two.close();unlinkSync(file);rmdirSync(directory)})
  return {one,two,first:d1Adapter(one),second:d1Adapter(two)}
}

export async function emailAccessFixture(t, { credential = true, verified = credential } = {}) {
  const fixture = createSettingsDb(); t.after(fixture.close)
  const {db,sqlite} = fixture
  await seedBuiltinRoles(db,EMAIL_BUSINESS,EMAIL_NOW)
  sqlite.prepare("UPDATE business_auth_state SET mode='user_only' WHERE business_id=?").run(EMAIL_BUSINESS)
  const add = (id,role,email,confirmed) => sqlite.prepare('INSERT INTO users(id,business_id,display_name,login_normalized,role_id,email_verified_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(id,EMAIL_BUSINESS,id,email,`${EMAIL_BUSINESS}:${role}`,confirmed ? EMAIL_NOW.toISOString() : null,EMAIL_NOW.toISOString(),EMAIL_NOW.toISOString())
  add('u1','manager','manager@example.test',verified)
  add('operator','operator','operator@example.test',true)
  const verifier = await hashHumanPassword(EMAIL_PASSWORD)
  for (const id of credential ? ['u1','operator'] : ['operator']) sqlite.prepare('INSERT INTO user_credentials(business_id,user_id,password_verifier,password_changed_at,created_at,updated_at) VALUES(?,?,?,?,?,?)')
    .run(EMAIL_BUSINESS,id,verifier,EMAIL_NOW.toISOString(),EMAIL_NOW.toISOString(),EMAIL_NOW.toISOString())
  const token = 's'.repeat(43)
  // Sessions used by live-clock HTTP tests must not expire as the calendar advances.
  // Historical credential and challenge timestamps remain deterministic.
  const activeSessionExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  if (credential) {
    for (const [id,hash] of [['session',await sha256Hex(token)],['second-session','second-hash']]) sqlite.prepare('INSERT INTO sessions(id,business_id,token_hash,user_id,device_mode,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(id,EMAIL_BUSINESS,hash,'u1','personal',EMAIL_NOW.toISOString(),activeSessionExpiresAt,EMAIL_NOW.toISOString())
  }
  const context = {businessId:EMAIL_BUSINESS,userId:'u1',roleId:`${EMAIL_BUSINESS}:manager`,displayName:'u1',sessionId:credential ? 'session' : null,deviceMode:'personal',granted:new Set(BUILTIN_ROLES.find(role => role.code==='manager').capabilities)}
  return {...fixture,context,token,verifier}
}
