import test from 'node:test'
import assert from 'node:assert/strict'
import { createSettingsDb } from '../test-support/settingsDb.js'
import { recordSecurityEvent } from './audit.js'
import * as audit from './audit.js'

test('official business mutation and safe resource-linked audit roll back together', async t => {
  const {db,sqlite,close}=createSettingsDb();t.after(close)
  assert.equal(typeof audit.prepareAuditEvent,'function')
  const context={businessId:'amor-e-sabor',legacy:true,displayName:'Acesso legado'}
  const event=()=>audit.prepareAuditEvent(db,context,{action:'client.created',resourceType:'client',resourceId:'c',outcome:'success',metadata:{password:'secret',token:'secret',actorLabel:'forged',address:'private'}})
  sqlite.exec("CREATE TRIGGER reject_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT,'audit unavailable'); END")
  const statement=()=>db.prepare("INSERT INTO clients(id,business_id,name,created_at,updated_at) VALUES('c','amor-e-sabor','Client','2026-09-30','2026-09-30')")
  await assert.rejects(db.batch([statement(),event()]),/audit unavailable/)
  assert.equal(sqlite.prepare("SELECT count(*) n FROM clients WHERE id='c'").get().n,0)
  sqlite.exec('DROP TRIGGER reject_audit')
  await db.batch([statement(),event()])
  const row=sqlite.prepare('SELECT * FROM audit_events').get()
  assert.equal(row.resource_id,'c');assert.equal(row.actor_name,'Acesso legado');assert.deepEqual(JSON.parse(row.metadata_json),{})
})
test('security events only persist allowlisted minimal metadata', async(t)=>{
  const {db,sqlite,close}=createSettingsDb();t.after(close)
  await recordSecurityEvent(db,{businessId:'amor-e-sabor',action:'login.blocked',result:'blocked',metadata:{deviceMode:'shared',password:'secret',identifier:'person',token:'raw',origin:'ip'}})
  const row=sqlite.prepare('SELECT * FROM audit_events').get()
  assert.equal(row.actor_type,'system');assert.deepEqual(JSON.parse(row.metadata_json),{deviceMode:'shared'})
})

test('Task 15 revoked role grant or session cannot commit a previously authorized business write',async t=>{
  const {db,sqlite,close}=createSettingsDb();t.after(close)
  const b='amor-e-sabor',at='2026-10-12T17:00:00.000Z'
  sqlite.prepare("INSERT INTO roles(id,business_id,code,name,active,version,is_builtin,created_at,updated_at) VALUES('role-t15',?,'t15','Teste',1,1,0,?,?)")
    .run(b,at,at)
  sqlite.prepare("INSERT INTO role_capabilities(business_id,role_id,capability) VALUES(?,'role-t15','payments.receive')").run(b)
  sqlite.prepare("INSERT INTO users(id,business_id,display_name,login_normalized,role_id,active,created_at,updated_at) VALUES('u-t15',?,'Pessoa','t15','role-t15',1,?,?)")
    .run(b,at,at)
  sqlite.prepare("INSERT INTO sessions(id,business_id,token_hash,created_at,expires_at,last_seen_at,user_id,device_mode) VALUES('s-t15',?,'hash-t15',?,'2030-01-01T00:00:00.000Z',?,'u-t15','personal')")
    .run(b,at,at)
  sqlite.prepare("UPDATE business_auth_state SET mode='user_only' WHERE business_id=?").run(b)
  const auth={businessId:b,sessionId:'s-t15',userId:'u-t15',roleId:'role-t15',
    granted:new Set(['payments.receive']),authMode:'user_only',legacy:false}
  const sessionDb=audit.withAuditContext(db,auth)
  const statement=()=>db.prepare("INSERT INTO clients(id,business_id,name,created_at,updated_at) VALUES('stale-write','amor-e-sabor','Stale','2026-10-12','2026-10-12')")
  sqlite.prepare("DELETE FROM role_capabilities WHERE business_id=? AND role_id='role-t15'").run(b)
  await assert.rejects(sessionDb.batch([statement()]),error=>error?.code==='SESSION_CONTEXT_CHANGED')
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM clients WHERE id='stale-write'").get().n,0)
  sqlite.prepare("INSERT INTO role_capabilities(business_id,role_id,capability) VALUES(?,'role-t15','payments.receive')").run(b)
  sqlite.prepare("UPDATE sessions SET revoked_at=? WHERE id='s-t15'").run(at)
  await assert.rejects(sessionDb.batch([statement()]),error=>error?.code==='SESSION_CONTEXT_CHANGED')
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM clients WHERE id='stale-write'").get().n,0)
})
