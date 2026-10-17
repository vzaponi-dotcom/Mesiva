import { readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
const root=fileURLToPath(new URL('../../',import.meta.url))
// Uses the pinned Wrangler cache already required by local D1 gates.
const cache=process.env.npm_config_cache ?? (process.platform==='win32' ? join(process.env.LOCALAPPDATA,'npm-cache') : join(homedir(),'.npm'))
const candidates=readdirSync(join(cache,'_npx')).map(name=>join(cache,'_npx',name,'node_modules/wrangler/package.json'))
const wranglerPackage=candidates.find(path=>{try{return JSON.parse(readFileSync(path,'utf8')).version==='4.128.0'}catch{return false}})
if(!wranglerPackage) throw new Error('Wrangler 4.128.0 must be cached before the local D1 benchmark.')
const miniflarePath=createRequire(wranglerPackage).resolve('miniflare')
const {Miniflare,convertV4MiniflareOptions}=await import(pathToFileURL(miniflarePath))
const {createSettingsDb}=await import(pathToFileURL(`${root}/worker/test-support/settingsDb.js`))
const {listPrintJobs}=await import(pathToFileURL(`${root}/worker/orderPrintingRepository.js`))
const fixture=createSettingsDb(), captured=[]
const recording={...fixture.db,prepare(sql){const s=fixture.db.prepare(sql); return {...s,bind(...values){captured.push({sql,values});return s.bind(...values)}}}}
await listPrintJobs(recording,'amor-e-sabor',{now:new Date()})
// Audited selections from production commit e595f7ed (06/10/2026).
const before=[
  {
    "sql": "INSERT INTO audit_events(id,business_id,occurred_at,actor_type,actor_user_id,actor_name,session_id,action,resource_type,resource_id,result,metadata_json)\n    SELECT ? || selected.id,?,?,?,?,?,?,?,?,selected.id,?,? FROM (SELECT print_jobs.id FROM print_jobs\n    WHERE print_jobs.business_id = ?\n      AND (\n        (print_jobs.status = 'processing' AND print_jobs.processing_started_at <= ?)\n        OR (print_jobs.status = 'requires_attention' AND print_jobs.last_error_code = 'PRINT_OUTCOME_UNKNOWN')\n      )\n      AND NOT EXISTS (\n    SELECT 1 FROM print_job_attempts a\n    WHERE a.business_id = print_jobs.business_id\n      AND a.job_id = print_jobs.id\n      AND a.submission_started_at IS NOT NULL\n      AND a.resolution IS NULL\n      AND a.status <> 'complete'\n  )) selected",
    "values": [
      "baseline:",
      "amor-e-sabor",
      "2026-10-14T19:30:57.163Z",
      "system",
      null,
      "Sistema",
      null,
      "printing.requeued",
      "print-job",
      "safe_unsubmitted",
      "{}",
      "amor-e-sabor",
      "2026-10-14T19:28:57.163Z"
    ]
  },
  {
    "sql": "INSERT INTO audit_events(id,business_id,occurred_at,actor_type,actor_user_id,actor_name,session_id,action,resource_type,resource_id,result,metadata_json)\n    SELECT ? || selected.id,?,?,?,?,?,?,?,?,selected.id,?,CASE WHEN selected.station_id IS NULL THEN '{}' ELSE json_object('stationId',selected.station_id) END FROM (SELECT print_jobs.id,\n    (SELECT s.id FROM print_stations s WHERE s.business_id=print_jobs.business_id\n      AND s.id=COALESCE((SELECT a.station_id FROM print_job_attempts a\n        WHERE a.business_id=print_jobs.business_id AND a.job_id=print_jobs.id\n          AND a.resolution IS NULL AND a.submission_started_at IS NOT NULL\n        ORDER BY a.attempt_number DESC LIMIT 1),print_jobs.station_id)) AS station_id\n    FROM print_jobs WHERE print_jobs.business_id = ? AND (\n      EXISTS (SELECT 1 FROM print_job_attempts a WHERE a.job_id=print_jobs.id AND a.business_id = ? AND a.status IN ('submitting', 'spooling', 'printing')\n    AND a.resolution IS NULL AND a.submission_started_at <= ?)\n      OR (status IN ('awaiting_confirmation','processing') AND EXISTS (\n        SELECT 1 FROM print_job_attempts a WHERE a.business_id=print_jobs.business_id\n          AND a.job_id=print_jobs.id AND a.status='unknown' AND a.resolution IS NULL))\n    )) selected",
    "values": [
      "baseline:",
      "amor-e-sabor",
      "2026-10-14T19:30:57.163Z",
      "system",
      null,
      "Sistema",
      null,
      "printing.outcome.observed",
      "print-job",
      "unknown",
      "amor-e-sabor",
      "amor-e-sabor",
      "2026-10-14T19:28:57.163Z"
    ]
  }
]
const baselineOccurredAt=before[0].values[2]
const benchmarkNow=new Date(), benchmarkCutoff=new Date(benchmarkNow.getTime()-120000).toISOString()
for(const query of before) query.values=query.values.map(value=> typeof value==='string' && /^2026-10-14T/.test(value) ? (value===baselineOccurredAt ? benchmarkNow.toISOString() : benchmarkCutoff) : value)
const after=captured.filter(x=>x.sql.startsWith('INSERT INTO audit_events')&&x.sql.includes(' selected'))
const schema=fixture.sqlite.prepare("SELECT name,sql,type FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END").all()
const mf=new Miniflare((convertV4MiniflareOptions ?? (options=>options))({modules:true,script:'export default {fetch(){return new Response("ok")}}',d1Databases:{DB:'d1-read-budget'},compatibilityDate:'2026-09-01'}))
try {
 const db=await mf.getD1Database('DB')
 for(const row of schema.filter(x=>!['print_job_attempts_unresolved_status_idx','print_job_attempts_job_lookup_idx'].includes(x.name))) await db.prepare(row.sql).run()
 await db.prepare("INSERT INTO businesses(id,slug,name,created_at,updated_at) VALUES('amor-e-sabor','amor-e-sabor','Fictícia','2026-10-14','2026-10-14')").run()
 const measure=async(name,queries)=>{const result=await db.batch(queries.map(({sql,values})=>db.prepare(sql).bind(...values)));return {name,rows_read:result.reduce((sum,r)=>sum+r.meta.rows_read,0),rows_written:result.reduce((sum,r)=>sum+r.meta.rows_written,0),per_statement:result.map(r=>r.meta.rows_read)}}
 const metrics=[await measure('empty-before',before)]
 const newIndexes=schema.filter(x=>['print_job_attempts_unresolved_status_idx','print_job_attempts_job_lookup_idx'].includes(x.name))
 for(const row of newIndexes) await db.prepare(row.sql).run()
 metrics.push(await measure('empty-after',after))
 for(const row of newIndexes) await db.prepare(`DROP INDEX ${row.name}`).run()
 await db.prepare(`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<1000)
 INSERT INTO print_jobs(id,business_id,type,trigger,status,copies_requested,copies_printed,snapshot_json,created_at,available_at)
 SELECT 'history-'||x,'amor-e-sabor','test','manual','printed',1,1,'{}','2026-10-14','2026-10-14' FROM n`).run()
 await db.prepare(`INSERT INTO print_job_attempts(id,business_id,job_id,copy_number,attempt_number,spool_job_name,status,submission_started_at,created_at,updated_at)
 SELECT 'attempt-'||id,business_id,id,1,1,'spool-'||id,'complete','2026-10-14','2026-10-14','2026-10-14' FROM print_jobs`).run()
 metrics.push(await measure('history-1000-before',before))
 for(const row of schema.filter(x=>['print_job_attempts_unresolved_status_idx','print_job_attempts_job_lookup_idx'].includes(x.name))) await db.prepare(row.sql).run()
 metrics.push(await measure('history-1000-after',after))
 for(const {sql,values} of after) {
  const plans=(await db.prepare('EXPLAIN QUERY PLAN '+sql).bind(...values).all()).results.map(row=>row.detail)
  assert.ok(!plans.some(detail=>/SEARCH (?:print_jobs|a) USING (?:COVERING )?INDEX .*\(business_id=\?\)$/.test(detail)),plans.join('; '))
 }
 const full=await listPrintJobs(db,'amor-e-sabor',{scope:'active',now:new Date()})
 console.log(JSON.stringify({metrics,activeJobs:full.jobs?.length},null,2))
 assert.ok(metrics.at(-1).rows_read<100, 'Historical growth must not become the recovery read budget')
 assert.equal(metrics.at(-1).rows_written,0)
}finally{fixture.close();await mf.dispose()}
