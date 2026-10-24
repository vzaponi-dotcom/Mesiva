// Real local D1 metering; never opens a remote binding or production data.
import assert from 'node:assert/strict'
import { readFileSync,readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { createSettingsDb } from '../../worker/test-support/settingsDb.js'
import { readDayConferenceState,readDayConferenceEntries,readDayConferenceHistory,completeDayConference } from '../../worker/dayConferenceRepository.js'

const cache=process.env.npm_config_cache ?? (process.platform==='win32'?join(process.env.LOCALAPPDATA,'npm-cache'):join(homedir(),'.npm'))
const packagePath=readdirSync(join(cache,'_npx')).map(n=>join(cache,'_npx',n,'node_modules/wrangler/package.json'))
  .find(p=>{try{return JSON.parse(readFileSync(p,'utf8')).version==='4.128.0'}catch{return false}})
assert.ok(packagePath,'Cache Wrangler 4.128.0 before running the local conference gate')
const {Miniflare,convertV4MiniflareOptions}=await import(pathToFileURL(createRequire(packagePath).resolve('miniflare')))
const mf=new Miniflare((convertV4MiniflareOptions??(o=>o))({modules:true,
  script:'export default {fetch(){return new Response("ok")}}',d1Databases:{DB:'day-conference-budget'},compatibilityDate:'2026-09-01'}))
const fixture=createSettingsDb(),biz='amor-e-sabor',day='2026-10-15'
try{
  const db=await mf.getD1Database('DB')
  const schema=fixture.sqlite.prepare(`SELECT type,name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
    ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END`).all()
  for(const entry of schema)await db.prepare(entry.sql).run()
  await db.prepare(`INSERT INTO businesses(id,slug,name,created_at,updated_at) VALUES(?,?,?,'2026-10-01','2026-10-01')`).bind(biz,biz,'Fictitious business').run()
  const seed=async(prefix,count,date)=>{
    const receipt=await db.prepare(`WITH RECURSIVE seq(n) AS(SELECT 0 UNION ALL SELECT n+1 FROM seq WHERE n+1<?)
      INSERT INTO payment_receipts(id,business_id,total_cents,paid_at,received_date,created_at)
      SELECT ?||n,?,100,'2026-10-17T15:00:00Z',?,'2026-10-17T15:00:00Z' FROM seq`).bind(count,prefix,biz,date).run()
    await db.prepare(`INSERT INTO payment_allocations(id,business_id,receipt_id,method_label,amount_cents,created_at)
      SELECT 'a-'||id,business_id,id,'Pix',100,created_at FROM payment_receipts WHERE business_id=? AND id LIKE ?`).bind(biz,prefix+'%').run()
    const movement=await db.prepare(`INSERT INTO movements(id,business_id,type,category,description,value_cents,source,movement_date,created_at,payment_method,receipt_id,payment_allocation_id)
      SELECT 'm-'||id,business_id,'entrada','sales','Fictitious receipt',100,'order-payment',received_date,created_at,'Pix',id,'a-'||id
      FROM payment_receipts WHERE business_id=? AND id LIKE ?`).bind(biz,prefix+'%').run()
    return {receipts:receipt.meta,movements:movement.meta}
  }
  const plans=[],metrics=[]
  const measure=async(action)=>{
    const sample={queries:0,requests:0,rows_read:0,rows_written:0,sqlDurationMs:0,wallMs:0,payloadBytes:0}
    const capture=(sql,result)=>{
      sample.queries++;sample.rows_read+=result.meta.rows_read;sample.rows_written+=result.meta.rows_written
      sample.sqlDurationMs+=result.meta.duration || 0
      metrics.push({sql,rows_read:result.meta.rows_read,rows_written:result.meta.rows_written})
      return result
    }
    const prepare=(sql,values=[])=>{
      const raw=db.prepare(sql).bind(...values)
      return {raw,sql,values,bind:(...args)=>prepare(sql,args),
        async all(){sample.requests++;return capture(sql,await raw.all())},
        async first(column){sample.requests++;const row=capture(sql,await raw.all()).results[0];return row?(column===undefined?row:row[column]):null},
        async run(){sample.requests++;return capture(sql,await raw.run())},
      }
    }
    const metered={prepare,async batch(statements){sample.requests++;const results=await db.batch(statements.map(s=>s.raw));return results.map((r,i)=>capture(statements[i].sql,r))}}
    const start=performance.now(),value=await action(metered)
    sample.wallMs=Number((performance.now()-start).toFixed(2));sample.payloadBytes=Buffer.byteLength(JSON.stringify(value))
    for(const key of ['queries','requests','rows_read','rows_written'])assert.ok(Number.isSafeInteger(sample[key])&&sample[key]>=0)
    return {sample,value}
  }
  const dayWrites=await seed('day-',120,day)
  const historyWrites=await seed('history-small-',1000,'2020-01-01')
  const small=await measure(d=>readDayConferenceState(d,biz,day))
  const smallDetails=await measure(d=>readDayConferenceEntries(d,biz,day,'Pix',1,small.value.sourceVersion))
  await seed('history-large-',9000,'2020-01-01')
  const large=await measure(d=>readDayConferenceState(d,biz,day))
  assert.equal(large.value.methods[0].grossCents,12000)
  assert.equal(large.value.integrityIssues,0)
  assert.equal(small.sample.rows_written,0);assert.equal(large.sample.rows_written,0)
  assert.ok(large.sample.rows_read<=small.sample.rows_read+20,'history must not increase day reads')
  assert.equal(large.sample.queries,3);assert.equal(large.sample.requests,1)
  const details=await measure(d=>readDayConferenceEntries(d,biz,day,'Pix',1,large.value.sourceVersion))
  assert.equal(details.value.entries.length,50);assert.equal(details.value.nextPage,2)
  assert.equal(details.sample.rows_written,0)
  assert.ok(details.sample.rows_read<=smallDetails.sample.rows_read+20,'detail reads must not scan historical movements')
  assert.ok(details.sample.rows_read<=2000,'detail page must use the daily index')
  const body={date:day,sourceVersion:large.value.sourceVersion,requestKey:'gate-conference-000001',lines:[{method:'Pix',checkedCents:12000,verified:true}]}
  const complete=await measure(d=>completeDayConference(d,biz,'fictitious-operator',body,new Date('2026-10-17T18:00:00Z')))
  const replay=await measure(d=>completeDayConference(d,biz,'fictitious-operator',body,new Date('2026-10-17T18:00:00Z')))
  assert.equal(complete.value.id,replay.value.id);assert.equal(replay.sample.rows_written,0)
  const history=await measure(d=>readDayConferenceHistory(d,biz))
  assert.equal(history.value.length,1);assert.equal(history.sample.rows_written,0)
  const firstQueries=new Map(metrics.map(q=>[q.sql,q]))
  // Obtain bound plans from the real repository by intercepting a second read.
  const explainDb={prepare(sql){return {bind(...args){return {sql,args}}}},async batch(statements){
    for(const s of statements){plans.push({query:s.sql.split('\n')[0],plan:(await db.prepare('EXPLAIN QUERY PLAN '+s.sql).bind(...s.args).all()).results.map(r=>r.detail)})}
    return db.batch(statements.map(s=>db.prepare(s.sql).bind(...s.args)))
  }}
  await readDayConferenceState(explainDb,biz,day)
  await readDayConferenceEntries(explainDb,biz,day,'Pix',1,large.value.sourceVersion)
  assert.ok(plans.some(p=>p.plan.some(line=>line.includes('movements_business_date_active_idx'))))
  assert.ok(plans.some(p=>p.plan.some(line=>line.includes('payment_receipts_business_received_date_idx'))))
  assert.ok(plans.every(p=>p.plan.every(line=>!/^SCAN (?:m|payment_receipts)\b/.test(line))),'no full financial table scan')
  const beforeWrite=await db.prepare('SELECT total_changes() n').first('n')
  await db.prepare(`UPDATE movements SET description='Corrected evidence' WHERE business_id=? AND id='m-day-0'`).bind(biz).run()
  const updated=await readDayConferenceState(db,biz,day)
  assert.notEqual(updated.sourceVersion,large.value.sourceVersion)
  assert.equal(updated.latest.lines[0].grossCents,12000)
  assert.ok((await db.prepare('SELECT total_changes() n').first('n'))>beforeWrite)
  const report={runtime:'Miniflare D1/workerd local, Wrangler 4.128.0',
    scope:'Repository SQL only; excludes authentication/context guard and network. Wall time is local IPC, not Worker CPU.',
    fixture:{dailyReceipts:120,smallHistory:1000,largeHistory:10000},
    open:{small:small.sample,large:large.sample},details:{small:smallDetails.sample,large:details.sample},complete:complete.sample,replay:replay.sample,history:history.sample,
    receiptInsertMeta:dayWrites.receipts,movementInsertWithRevisionMeta:dayWrites.movements,historicalMovementInsertMeta:historyWrites.movements,
    plans,distinctQueries:firstQueries.size,passed:true}
  console.log(JSON.stringify(report))
}finally{fixture.close();await mf.dispose()}
