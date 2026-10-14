import test from 'node:test'
import assert from 'node:assert/strict'
import { createSettingsDb } from './test-support/settingsDb.js'
import { listPrintJobs } from './orderPrintingRepository.js'

// Reintroducing an outer history walk or a business-only attempt lookup fails
// this budget even when an empty queue still returns the correct result.
test('aging plans avoid history walks and business-wide correlated attempt searches', async t => {
  const fixture = createSettingsDb(); t.after(fixture.close)
  const plans = []
  const db = { ...fixture.db, prepare(sql) {
    const statement = fixture.db.prepare(sql)
    return { ...statement, bind(...values) {
      if (sql.includes('INSERT INTO audit_events') && sql.includes(' selected')) {
        plans.push(...fixture.sqlite.prepare('EXPLAIN QUERY PLAN ' + sql).all(...values).map(row => row.detail))
      }
      return statement.bind(...values)
    } }
  } }
  assert.deepEqual(await listPrintJobs(db, 'amor-e-sabor', { now: new Date('2026-10-14T12:00:00Z') }), [])
  assert.ok(plans.length)
  const broad = plans.filter(detail => /SEARCH (?:print_jobs|a) USING (?:COVERING )?INDEX .*\(business_id=\?\)$/.test(detail))
  assert.deepEqual(broad, [], 'candidate and correlated searches must constrain status, id or job_id: ' + broad.join('; '))
})

const businessId='amor-e-sabor', at='2026-10-14T12:00:00.000Z'
const later=new Date('2026-10-14T12:03:00.000Z')
function addJob(sqlite,id,status='processing',tenant=businessId) {
  sqlite.prepare(`INSERT INTO print_jobs(id,business_id,type,trigger,status,copies_requested,copies_printed,snapshot_json,created_at,available_at,processing_started_at)
    VALUES(?,?,'test','manual',?,2,0,'{}',?,?,?)`).run(id,tenant,status,at,at,at)
}
function addAttempt(sqlite,id,job,status,submitted=at,resolution=null,tenant=businessId,number=1) {
  sqlite.prepare(`INSERT INTO print_job_attempts(id,business_id,job_id,copy_number,attempt_number,spool_job_name,status,submission_started_at,resolution,created_at,updated_at)
    VALUES(?,?,?,1,?,?,?, ?,?,?,?)`).run(id,tenant,job,number,'spool-'+id,status,submitted,resolution,at,at)
}

test('large terminal history is preserved and emits no recovery events on concurrent empty polls',async t=>{
  const {db,sqlite,close}=createSettingsDb();t.after(close)
  sqlite.exec('BEGIN')
  for(let n=0;n<1000;n++) {addJob(sqlite,'history-'+n,'printed');addAttempt(sqlite,'a-'+n,'history-'+n,'complete')}
  sqlite.exec('COMMIT')
  await Promise.all([listPrintJobs(db,businessId,{now:later,scope:'active'}),listPrintJobs(db,businessId,{now:later,scope:'active'})])
  assert.equal(sqlite.prepare('SELECT count(*) n FROM print_jobs').get().n,1000)
  assert.equal(sqlite.prepare('SELECT count(*) n FROM print_job_attempts').get().n,1000)
  assert.equal(sqlite.prepare('SELECT count(*) n FROM audit_events').get().n,0)
})

test('timeout candidates preserve unknown decisions, tenant isolation, recent sends and one audit per job',async t=>{
  const {db,sqlite,close}=createSettingsDb();t.after(close)
  sqlite.prepare(`INSERT INTO businesses(id,slug,name,created_at,updated_at) VALUES('foreign','foreign','Fictícia',?,?)`).run(at,at)
  for(const id of ['expired','recent','unknown','resolved','safe','prepared','terminal','foreign']) addJob(sqlite,id,id==='terminal'?'printed':'processing',id==='foreign'?'foreign':businessId)
  addAttempt(sqlite,'expired-1','expired','submitting')
  addAttempt(sqlite,'expired-2','expired','printing',at,null,businessId,2)
  addAttempt(sqlite,'recent-a','recent','spooling','2026-10-14T12:02:59.000Z')
  addAttempt(sqlite,'unknown-a','unknown','unknown')
  addAttempt(sqlite,'resolved-a','resolved','unknown',at,'manual_not_printed')
  addAttempt(sqlite,'prepared-a','prepared','prepared',null)
  addAttempt(sqlite,'terminal-a','terminal','printing')
  addAttempt(sqlite,'foreign-a','foreign','submitting',at,null,'foreign')
  sqlite.prepare('UPDATE print_jobs SET copies_printed=1 WHERE id=?').run('safe')
  await Promise.all([listPrintJobs(db,businessId,{now:later}),listPrintJobs(db,businessId,{now:later})])
  const status=id=>sqlite.prepare('SELECT status FROM print_jobs WHERE id=?').get(id).status
  assert.equal(status('expired'),'requires_attention');assert.equal(status('unknown'),'requires_attention')
  assert.equal(status('recent'),'processing');assert.equal(status('foreign'),'processing')
  for(const id of ['resolved','safe','prepared']) assert.equal(status(id),'pending')
  assert.equal(status('terminal'),'printed')
  assert.equal(sqlite.prepare("SELECT second_copy_requested_at FROM print_jobs WHERE id='safe'").get().second_copy_requested_at,later.toISOString())
  const outcomes=sqlite.prepare("SELECT resource_id FROM audit_events WHERE action='printing.outcome.observed' ORDER BY resource_id").all().map(row=>row.resource_id)
  assert.deepEqual(outcomes,['expired','terminal','unknown'])
  assert.equal(sqlite.prepare("SELECT count(*) n FROM audit_events WHERE resource_id='foreign'").get().n,0)
  assert.equal(sqlite.prepare("SELECT status FROM print_job_attempts WHERE id='terminal-a'").get().status,'unknown')
  assert.equal(sqlite.prepare("SELECT status FROM print_job_attempts WHERE id='foreign-a'").get().status,'submitting')
  const before=sqlite.prepare('SELECT count(*) n FROM audit_events').get().n
  await listPrintJobs(db,businessId,{now:later})
  assert.equal(sqlite.prepare('SELECT count(*) n FROM audit_events').get().n,before)
})
