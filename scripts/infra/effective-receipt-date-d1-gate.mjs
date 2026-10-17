// Real D1/workerd receipt-period budget and legacy-fallback gate. No remote binding.
// Uses the same 4.128.0 Miniflare runtime already cached by the existing CI gates.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { businessDateRangeUtc } from '../../worker/reporting/businessDate.js'

const CURRENT = `WITH period_receipts AS (
  SELECT id,business_id,total_cents,paid_at,received_date FROM payment_receipts
  WHERE business_id=? AND received_date>=? AND received_date<=?
  UNION ALL
  SELECT id,business_id,total_cents,paid_at,received_date FROM payment_receipts
  WHERE business_id=? AND received_date IS NULL AND paid_at>=? AND paid_at<?
) SELECT id,total_cents FROM period_receipts ORDER BY id`
const BEFORE = `SELECT id,total_cents FROM payment_receipts
  WHERE business_id=? AND paid_at>=? AND paid_at<? ORDER BY id`

const verify = (sample, name) => {
  for (const key of ['rows_read','rows_written','requests']) {
    assert.ok(Number.isSafeInteger(sample[key]) && sample[key]>=0,`${name}: invalid ${key}`)
  }
  assert.equal(sample.rows_written,0,`${name}: read queries must perform zero writes`)
  assert.equal(sample.requests,1,`${name}: receipt period must use one SQL request`)
  assert.equal(sample.tenantScoped,true,`${name}: tenant scope missing`)
}
export function assertEffectiveReceiptBudget(report) {
  for (const scope of ['baseline','after','legacy']) {
    for (const size of ['small','large']) verify(report[scope][size],scope+'.'+size)
  }
  for (const scope of ['after','legacy']) {
    const small=report[scope].small.rows_read,large=report[scope].large.rows_read
    assert.ok(large-small<=Math.max(40,Math.ceil(small*0.2)),
      `${scope}: history growth exceeds indexed read budget (${small} to ${large})`)
  }
  for (const size of ['small','large']) {
    assert.ok(report.after[size].rows_read <= report.baseline[size].rows_read+120,
      `${size}: date-aware query exceeds baseline overhead budget`)
  }
  return true
}

export async function runEffectiveReceiptDateD1Gate() {
  const root=fileURLToPath(new URL('../../',import.meta.url))
  const cache=process.env.npm_config_cache ??
    (process.platform==='win32'?join(process.env.LOCALAPPDATA,'npm-cache'):join(homedir(),'.npm'))
  const packages=readdirSync(join(cache,'_npx')).map(n=>join(cache,'_npx',n,'node_modules/wrangler/package.json'))
  const packagePath=packages.find(path=>{try{return JSON.parse(readFileSync(path,'utf8')).version==='4.128.0'}catch{return false}})
  assert.ok(packagePath,'Wrangler 4.128.0 must be cached before the real-D1 receipt gate')
  const {Miniflare,convertV4MiniflareOptions}=await import(pathToFileURL(createRequire(packagePath).resolve('miniflare')))
  const {createSettingsDb}=await import(pathToFileURL(join(root,'worker/test-support/settingsDb.js')))
  const fixture=createSettingsDb()
  const mf=new Miniflare((convertV4MiniflareOptions??(o=>o))({
    modules:true,script:'export default {fetch(){return new Response("ok")}}',
    d1Databases:{DB:'effective-receipt-budget'},compatibilityDate:'2026-09-01',
  }))
  try {
    const db=await mf.getD1Database('DB')
    const schema=fixture.sqlite.prepare(`SELECT type,name,sql FROM sqlite_schema
      WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
      ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END`).all()
    const financialIndex=schema.find(row=>row.name==='payment_receipts_business_received_date_idx')
    assert.ok(financialIndex?.sql,'migration 0052 index is required')
    for(const entry of schema.filter(row=>row.name!==financialIndex.name)){
      await db.prepare(entry.sql).run()
    }
    // Existing business configuration is copied exactly like the operational D1 gate.
    const batch=[]
    for(const table of schema.filter(row=>row.type==='table')){
      for(const row of fixture.sqlite.prepare(`SELECT * FROM ${table.name}`).all()){
        const columns=Object.keys(row)
        batch.push(db.prepare(`INSERT INTO ${table.name} (${columns.join(',')})
          VALUES (${columns.map(()=>'?').join(',')})`).bind(...Object.values(row)))
        if(batch.length>=100)await db.batch(batch.splice(0))
      }
    }
    if(batch.length)await db.batch(batch)
    const biz='amor-e-sabor',foreign='effective-receipt-foreign'
    await db.prepare(`INSERT INTO businesses(id,slug,name,created_at,updated_at)
      VALUES(?,?,?,'2026-10-01','2026-10-01')`).bind(foreign,foreign,'Another establishment').run()
    const seed=async(start,count)=>db.prepare(`WITH RECURSIVE seq(n) AS
      (SELECT 0 UNION ALL SELECT n+1 FROM seq WHERE n+1<?)
      INSERT INTO payment_receipts(id,business_id,total_cents,paid_at,received_date,created_at)
      SELECT 'history-' || (?+n), ?,100,
        '2020-01-01T15:00:00.000Z',
        CASE WHEN n%2=0 THEN '2020-01-01' ELSE NULL END,
        '2020-01-01T15:00:00.000Z' FROM seq`).bind(count,start,biz).run()
    const insert= db.prepare(`INSERT INTO payment_receipts
      (id,business_id,total_cents,paid_at,received_date,created_at) VALUES(?,?,?,?,?,?)`)
    await db.batch([
      insert.bind('retro',biz,10000,'2026-10-17T15:00:00.000Z','2026-10-15','2026-10-17T15:00:00.000Z'),
      insert.bind('today',biz,3000,'2026-10-17T16:00:00.000Z','2026-10-17','2026-10-17T16:00:00.000Z'),
      insert.bind('dst-legacy',biz,900,'2018-12-01T02:30:00.000Z',null,'2018-12-01T02:30:00.000Z'),
      insert.bind('other',foreign,9000,'2026-10-17T15:00:00.000Z','2026-10-15','2026-10-17T15:00:00.000Z'),
    ])
    const values=(businessId,day)=>{
      const [start,end]=businessDateRangeUtc(day,day)
      return {before:[businessId,start,end],after:[businessId,day,day,businessId,start,end]}
    }
    const sample=async(sql,params,tenant)=>{
      assert.ok(sql.includes('business_id=?') && params[0]===tenant,'period query must scope business')
      const result=await db.prepare(sql).bind(...params).all()
      assert.ok(result.meta && Number.isSafeInteger(result.meta.rows_read),'D1/workerd meta.rows_read missing')
      assert.ok(Number.isSafeInteger(result.meta.rows_written),'D1/workerd meta.rows_written missing')
      return {
        rows_read:result.meta.rows_read,rows_written:result.meta.rows_written,
        requests:1,tenantScoped:true,receiptIds:result.results.map(row=>row.id),
      }
    }
    const budget={runtime:'Miniflare D1/workerd local, Wrangler 4.128.0',fixture:{small:1000,large:10000},
      baseline:{},after:{},legacy:{},indexCreation:null,queryPlan:[],
    }
    await seed(0,1000)
    const params=values(biz,'2026-10-15'),legacy=values(biz,'2018-12-01')
    budget.baseline.small=await sample(BEFORE,params.before,biz)
    const indexMeta=(await db.prepare(financialIndex.sql).run()).meta
    budget.indexCreation={rows_read:indexMeta.rows_read,rows_written:indexMeta.rows_written,atHistoricalRows:1000}
    budget.after.small=await sample(CURRENT,params.after,biz)
    budget.legacy.small=await sample(CURRENT,legacy.after,biz)
    await seed(1000,9000)
    budget.baseline.large=await sample(BEFORE,params.before,biz)
    budget.after.large=await sample(CURRENT,params.after,biz)
    budget.legacy.large=await sample(CURRENT,legacy.after,biz)
    budget.queryPlan=(await db.prepare('EXPLAIN QUERY PLAN '+CURRENT).bind(...params.after).all()).results.map(row=>row.detail)
    assert.ok(budget.queryPlan.some(line=>line.includes('payment_receipts_business_received_date_idx')),
      'dated receipts require business+financial-date index')
    assert.ok(budget.queryPlan.some(line=>line.includes('payment_receipts_business_paid_idx')),
      'legacy NULL fallback requires business+paid_at index')
    assert.deepEqual(budget.after.large.receiptIds,['retro'])
    assert.deepEqual(budget.baseline.large.receiptIds,[],'prior query is an intentionally different financial date contract')
    assert.deepEqual(budget.legacy.large.receiptIds,['dst-legacy'],'historical DST day must remain queryable')
    assert.deepEqual((await sample(CURRENT,values(foreign,'2026-10-15').after,foreign)).receiptIds,['other'])
    assert.deepEqual((await sample(CURRENT,values(biz,'2026-10-17').after,biz)).receiptIds,['today'])
    assert.equal((await db.prepare(`SELECT count(*) n FROM payment_receipts
      WHERE business_id=? AND received_date IS NULL`).bind(biz).first('n')),5001,
      'historical NULL rows remain intact, never blindly backfilled')
    budget.passed=assertEffectiveReceiptBudget(budget)
    return budget
  } finally {
    fixture.close()
    await mf.dispose()
  }
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const result=await runEffectiveReceiptDateD1Gate()
  console.log(JSON.stringify(result))
}
