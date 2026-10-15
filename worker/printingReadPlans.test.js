import test from 'node:test'
import assert from 'node:assert/strict'
import {createTenancyFixture} from './test-support/tenancyDb.js'
import {purgeExpiredTerminalPrintJobs,getPrintQueueSummary} from './orderPrintingRepository.js'

test('retention and summary bound terminal history by date, preserving UTC totals and tenant isolation',async t=>{
  const f=await createTenancyFixture();t.after(f.close)
  const {db,sqlite}=f,businessId=f.businesses.A,now=new Date('2026-10-15T15:00:00.000Z')
  const add=sqlite.prepare(`INSERT INTO print_jobs(id,business_id,type,trigger,status,copies_requested,copies_printed,snapshot_json,created_at,processed_at,discarded_at)
    VALUES(?,?,'test','manual',?,1,0,'{}',?,?,?)`)
  for(let i=0;i<3000;i++)add.run('history:'+i,businessId,'printed','2026-10-14T12:00:00Z','2026-10-14T12:00:00Z',null)
  add.run('today',businessId,'printed','2020-01-01','2026-10-15T00:00:00.000Z',null)
  add.run('fallback-date',businessId,'printed','2026-10-15T01:00:00.000Z',null,null)
  add.run('other-company',f.businesses.B,'printed','2026-10-15T01:00:00.000Z',null,null)
  add.run('expired',businessId,'discarded','2020-01-01',null,'2020-01-01')
  add.run('pending',businessId,'pending','2020-01-01',null,null)
  add.run('uncertain',businessId,'requires_attention','2020-01-01',null,null)
  sqlite.prepare(`INSERT INTO print_job_attempts(id,business_id,job_id,station_id,copy_number,spool_job_name,attempt_number,status,submission_started_at,created_at,updated_at)
    VALUES('unknown',?,'uncertain',NULL,1,'unknown-spool',1,'unknown','2020-01-01','2020-01-01','2020-01-01')`).run(businessId)
  const plans=[],prepare=db.prepare
  db.prepare=sql=>({bind:(...values)=>{
    plans.push(...sqlite.prepare('EXPLAIN QUERY PLAN '+sql).all(...values).map(r=>r.detail))
    return prepare(sql).bind(...values)
  }})
  assert.equal(await purgeExpiredTerminalPrintJobs(db,businessId,now),1)
  assert.deepEqual(await getPrintQueueSummary(db,businessId,now),{
    active:2,pending:1,awaitingConfirmation:0,awaitingSecondCopy:0,attention:1,discardable:1,completedToday:2,safeBacklog:1,
  })
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM print_jobs').get().n,3005)
  assert.ok(plans.some(p=>p.includes('print_jobs_terminal_expiry_idx') && p.includes('<expr><?')),plans.join('\n'))
  assert.ok(plans.some(p=>p.includes('print_jobs_printed_time_idx') && p.includes('<expr>>?')),plans.join('\n'))
  assert.ok(plans.some(p=>p.includes('print_jobs_nonterminal_idx')),plans.join('\n'))
})
