import test from 'node:test'
import assert from 'node:assert/strict'
import { createSettingsDb } from '../test-support/settingsDb.js'
import * as audit from './audit.js'

test('permitted attribution remains bounded private and truthful for renamed legacy system and unknown actors',async t=>{
  const {db,sqlite,close}=createSettingsDb();t.after(close)
  let module
  try { module=await import('./attribution.js') } catch {}
  assert.equal(typeof module?.loadOrderAttributions,'function')
  for(let i=0;i<120;i++)await db.batch([audit.prepareAuditEvent(db,{businessId:'amor-e-sabor',legacy:true},{action:'order.created',resourceType:'order',resourceId:`order-${i}`})])
  const prepare=db.prepare;let reads=0
  db.prepare=sql=>{const stmt=prepare(sql);return {...stmt,bind:(...values)=>{assert.ok(values.length<=100);reads++;return stmt.bind(...values)}}}
  const actors=await module.loadOrderAttributions(db,'amor-e-sabor',Array.from({length:121},(_,i)=>`order-${i}`))
  assert.equal(reads,2)
  assert.deepEqual(actors.get('order-0').createdBy,{type:'legacy',userId:null,displayName:'Acesso legado'})
  assert.deepEqual(actors.get('order-120').createdBy,{type:'unknown',userId:null,displayName:'Autor não identificado'})
  assert.equal(JSON.stringify([...actors]).includes('sessionId'),false)
  assert.equal((await module.loadOrderAttributions(db,'other',['order-0'])).get('order-0').createdBy.type,'unknown')
})

test('printing attribution uses accepted event order when observations share a clock millisecond',async t=>{
  const {db,sqlite,close}=createSettingsDb();t.after(close)
  const {loadPrintAttributions}=await import('./attribution.js')
  sqlite.exec(`INSERT INTO audit_events(id,business_id,occurred_at,actor_type,actor_name,action,resource_type,resource_id,result)
    VALUES('z','amor-e-sabor','2026-09-30T12:00:00.000Z','legacy','Acesso legado','printing.requested','print-job','job','success');
    INSERT INTO audit_events(id,business_id,occurred_at,actor_type,actor_name,action,resource_type,resource_id,result)
    VALUES('a','amor-e-sabor','2026-09-30T12:00:00.000Z','system','Sistema','printing.outcome.observed','print-job','job','unknown');`)
  assert.deepEqual((await loadPrintAttributions(db,'amor-e-sabor',['job'])).get('job'),{
    requestedBy:{type:'legacy',userId:null,displayName:'Acesso legado'},lastActionBy:{type:'system',userId:null,displayName:'Sistema'},
  })
})

test('attribution starts from the requested resources even with extensive order and printing audit history',async t=>{
  const {db,sqlite,close}=createSettingsDb();t.after(close)
  const {loadOrderAttributions,loadPrintAttributions}=await import('./attribution.js')
  for(const [kind,action] of [['order','order.created'],['print-job','printing.requested']])sqlite.prepare(`WITH RECURSIVE n(x) AS(SELECT 0 UNION ALL SELECT x+1 FROM n WHERE x<9999)
    INSERT INTO audit_events(id,business_id,occurred_at,actor_type,actor_name,action,resource_type,resource_id,result)
    SELECT ?||x,'amor-e-sabor','2026-10-14T12:00:00Z','system','Sistema',?,?,?||x,'success' FROM n`).run(kind+':audit:',action,kind,kind+':history:')
  sqlite.exec(`INSERT INTO audit_events(id,business_id,occurred_at,actor_type,actor_name,action,resource_type,resource_id,result) VALUES
    ('z-order','amor-e-sabor','2026-10-14T12:00:00Z','legacy','Acesso legado','order.created','order','target','success'),
    ('a-order','amor-e-sabor','2026-10-14T12:00:00Z','system','Sistema','order.created','order','target','success'),
    ('z-job','amor-e-sabor','2026-10-14T12:00:00Z','legacy','Acesso legado','printing.requested','print-job','target','success'),
    ('a-job','amor-e-sabor','2026-10-14T12:00:00Z','system','Sistema','printing.outcome.observed','print-job','target','unknown')`)
  const plans=[],prepare=db.prepare
  db.prepare=sql=>({bind:(...values)=>{
    plans.push(...sqlite.prepare('EXPLAIN QUERY PLAN '+sql).all(...values).map(row=>row.detail))
    return prepare(sql).bind(...values)
  }})
  const order=(await loadOrderAttributions(db,'amor-e-sabor',['target'])).get('target')
  const job=(await loadPrintAttributions(db,'amor-e-sabor',['target'])).get('target')
  assert.equal(order.createdBy.type,'system')
  assert.equal(job.requestedBy.type,'legacy');assert.equal(job.lastActionBy.type,'system')
  assert.equal(plans.filter(detail=>detail.includes('audit_events_resource_time_idx') && detail.includes('resource_id=?')).length,3)
  assert.equal(plans.some(detail=>detail.includes('audit_events_action_time_idx')),false)
})
