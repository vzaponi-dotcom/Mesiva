import assert from 'node:assert/strict'
import {readFileSync,readdirSync,appendFileSync} from 'node:fs'
import {homedir} from 'node:os'
import {join,resolve} from 'node:path'
import {createRequire} from 'node:module'
import {fileURLToPath,pathToFileURL} from 'node:url'

const candidateRows=sample=>sample.queries.filter(q=>/\bFROM (?:orders|order_items)\b/i.test(q.sql)).reduce((sum,q)=>sum+q.rows_read,0)
const overheadRows=sample=>sample.rows_read-candidateRows(sample)

export function assertOperationalReadBudget(report) {
  const current=report.after
  for(const [label,sample] of Object.entries({emptyTv:current.empty.tv,smallTv:current.small.tv,largeTv:current.large.tv,smallIds:current.small.byIds,largeIds:current.large.byIds})){
    for(const key of ['rows_read','rows_written'])assert.ok(Number.isSafeInteger(sample[key]) && sample[key]>=0,`${label}: invalid metric ${key}`)
    assert.equal(sample.rows_written,0,`${label}: selections must not perform writes`)
    assert.equal(sample.tenantScoped,true,`${label}: tenant scope missing`)
    assert.ok(sample.queries.length>0,`${label}: no queries captured`)
    assert.equal(sample.queries.reduce((sum,q)=>sum+q.rows_read,0),sample.rows_read,`${label}: read metric mismatch`)
    assert.ok(sample.queries.every(q=>q.rows_written===0),`${label}: query performs writes`)
  }
  assert.equal(current.empty.tv.returnedCount,0,'empty TV candidates')
  assert.ok(candidateRows(current.empty.tv)<=100,'empty TV candidate read budget')
  assert.ok(current.empty.tv.rows_read<=1000,'empty TV total read budget')
  for(const size of ['empty','small','large'])assert.ok(overheadRows(current[size].tv)<=overheadRows(report.baseline.empty.tv)+16,'fixed schema overhead grew beyond baseline')
  for(const size of ['small','large']){
    assert.equal(current[size].tv.returnedCount,20,'TV candidate count differs from fixture')
    assert.equal(current[size].byIds.returnedCount,1,'IDs candidate count differs from fixture')
    assert.ok(current[size].tv.rows_read<=1000,'TV read budget exceeded')
    assert.ok(current[size].byIds.rows_read<=200,'point IDs read budget exceeded')
  }
  assert.equal(current.empty.byIds.queries.length,0,'empty IDs must not query')
  assert.equal(current.empty.byIds.rows_read,0,'empty IDs must not read')
  assert.equal(current.empty.byIds.rows_written,0,'empty IDs must not write')
  for(const kind of ['tv','byIds']){
    const smaller=current.small[kind].rows_read,larger=current.large[kind].rows_read
    assert.ok(larger-smaller<=Math.max(16,Math.ceil(smaller*0.10)),`${kind}: history growth increased reads`)
  }
  const tvPlans=report.queryPlans.tv,idsPlans=report.queryPlans.byIds
  assert.ok(tvPlans.some(p=>p.includes('orders_business_active_created_idx')),'TV plan lacks active candidate index')
  assert.ok(tvPlans.some(p=>p.includes('order_items_business_order_created_idx') && p.includes('order_id=?')),'TV plan lacks candidate item lookup')
  assert.ok(!tvPlans.some(p=>p.includes('order_items_business_idx')),'TV plan scans business item history')
  assert.ok(idsPlans.some(p=>/SEARCH o .*\bid=\?/.test(p)),'IDs plan lacks order lookup')
  assert.ok(idsPlans.some(p=>p.includes('order_items_business_order_created_idx') && p.includes('order_id=?')),'IDs plan lacks candidate item lookup')
  return true
}

export function assertSameTvReads(before,after) {
  const orderRows=queries=>queries.find(q=>q.sql.includes('FROM orders') && !q.sql.includes('i.order_id'))?.results
  const itemRows=queries=>queries.find(q=>q.sql.includes('i.order_id'))?.results
  assert.ok(orderRows(before) && orderRows(after),'TV order queries were not captured')
  assert.ok(itemRows(before) && itemRows(after),'TV item queries were not captured')
  assert.deepEqual(orderRows(after),orderRows(before),'TV read contract differs: orders')
  assert.deepEqual(itemRows(after),itemRows(before),'TV read contract differs: items')
}
// Diagnostic guard for the repository's two tenant lookup forms, not authorization.
export function isScopedOperationalRead(sql,values,businessId) {
  return values[0]===businessId && (/\bbusiness_id\s*=\s*\?/i.test(sql)
    || (/\bFROM businesses b\b/i.test(sql) && /\bWHERE b\.id\s*=\s*\?/i.test(sql)))
}
function recordReads(db,businessId) {
  const queries=[],raw=[]
  const prepare=(sql,values=[])=>({
    bind:(...bound)=>prepare(sql,bound),
    async all(){
      const result=await db.prepare(sql).bind(...values).all()
      const rowsRead=result.meta.rows_read,rowsWritten=result.meta.rows_written
      const plan=(await db.prepare('EXPLAIN QUERY PLAN '+sql).bind(...values).all()).results.map(row=>row.detail)
      queries.push({sql,values,rows_read:rowsRead,rows_written:rowsWritten,plan})
      raw.push({sql,results:result.results})
      return result
    },
    async first(column){const result=await this.all();const row=result.results[0];return row ? column===undefined ? row : row[column] : null},
  })
  return {db:{prepare},raw,summarize(returnedCount){return {
    rows_read:queries.reduce((sum,q)=>sum+q.rows_read,0),rows_written:queries.reduce((sum,q)=>sum+q.rows_written,0),
    candidate_rows_read:candidateRows({queries}),overhead_rows_read:queries.filter(q=>!/\bFROM (?:orders|order_items)\b/i.test(q.sql)).reduce((sum,q)=>sum+q.rows_read,0),
    returnedCount,tenantScoped:queries.every(q=>isScopedOperationalRead(q.sql,q.values,businessId)),queries,
  }}}
}

export async function runOperationalReadBenchmark() {
  const progress=stage=>{if(process.env.OPERATIONAL_D1_PROGRESS_FILE)appendFileSync(process.env.OPERATIONAL_D1_PROGRESS_FILE,JSON.stringify({at:new Date().toISOString(),stage})+'\n')}
  progress('start')
  const root=fileURLToPath(new URL('../../',import.meta.url))
  const cache=process.env.npm_config_cache ?? (process.platform==='win32'?join(process.env.LOCALAPPDATA,'npm-cache'):join(homedir(),'.npm'))
  const packages=readdirSync(join(cache,'_npx')).map(n=>join(cache,'_npx',n,'node_modules/wrangler/package.json'))
  const pkg=packages.find(p=>{try{return JSON.parse(readFileSync(p,'utf8')).version==='4.128.0'}catch{return false}})
  assert.ok(pkg,'Wrangler 4.128.0 must be cached before the D1 read gate')
  const {Miniflare,convertV4MiniflareOptions}=await import(pathToFileURL(createRequire(pkg).resolve('miniflare')))
  const {createSettingsDb}=await import(pathToFileURL(join(root,'worker/test-support/settingsDb.js')))
  const {seedOperationalReadFixture}=await import(pathToFileURL(join(root,'worker/test-support/operationalReadFixture.js')))
  const {loadKitchenTvState}=await import(pathToFileURL(join(root,'worker/kitchenTvReadRepository.js')))
  const {listOrders,listOrdersByIds}=await import(pathToFileURL(join(root,'worker/orderReadRepository.js')))
  const baseline=JSON.parse(readFileSync(new URL('fixtures/operational-read-baseline.json',import.meta.url),'utf8'))
  assert.equal(baseline.commit,'7bfd06659828054ecb8f7dc386bbc78b000f75c6')
  assert.equal(baseline.queries.length,4,'published TV must have four captured read queries')
  const businessId='amor-e-sabor',foreignId='operational-read-foreign'
  progress('modules_loaded')
  const fixture=createSettingsDb({beforeSpecB(sqlite){sqlite.prepare(`INSERT INTO businesses(id,slug,name,created_at,updated_at)
    VALUES(?,?,?,'2026-10-13','2026-10-13')`).run(foreignId,foreignId,'Empresa fictícia')}})
  const mf=new Miniflare((convertV4MiniflareOptions??(o=>o))({modules:true,script:'export default {fetch(){return new Response("ok")}}',d1Databases:{DB:'operational-read-budget'},compatibilityDate:'2026-09-01'}))
  const names=['orders_business_active_created_idx','order_items_business_order_created_idx']
  try{
    progress('runtime_start')
    const db=await mf.getD1Database('DB')
    progress('runtime_ready')
    const schema=fixture.sqlite.prepare("SELECT type,name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END").all()
    for(const row of schema.filter(row=>!names.includes(row.name)))await db.prepare(row.sql).run()
    progress('schema_ready')
    const seeded=[]
    for(const table of schema.filter(row=>row.type==='table')){
      for(const row of fixture.sqlite.prepare(`SELECT * FROM ${table.name}`).all()){
        const columns=Object.keys(row)
        seeded.push(db.prepare(`INSERT INTO ${table.name} (${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')})`).bind(...Object.values(row)))
        if(seeded.length>=100)await db.batch(seeded.splice(0))
      }
    }
    if(seeded.length)await db.batch(seeded)
    progress('defaults_seeded')
    const addIndexes=async()=>{for(const row of schema.filter(row=>names.includes(row.name)))await db.prepare(row.sql).run()}
    const removeIndexes=async()=>{for(const name of names)await db.prepare(`DROP INDEX ${name}`).run()}
    const publishedTv=async()=>{
      const recorded=recordReads(db,businessId)
      for(const q of baseline.queries)await recorded.db.prepare(q.sql).bind(...q.values).all()
      const orders=recorded.raw.find(q=>q.sql.includes('FROM orders')).results
      return {reading:recorded.summarize(orders.length),raw:recorded.raw}
    }
    const currentTv=async()=>{
      const recorded=recordReads(db,businessId),value=await loadKitchenTvState(recorded.db,businessId)
      return {reading:recorded.summarize(value.orders.length),raw:recorded.raw,value}
    }
    const byIds=async(ids)=>{
      const recorded=recordReads(db,businessId),value=await listOrdersByIds(recorded.db,businessId,ids)
      return {reading:recorded.summarize(value.length),value}
    }
    const fullList=async()=>{
      const recorded=recordReads(db,businessId),value=await listOrders(recorded.db,businessId)
      return recorded.summarize(value.length)
    }
    const assertSameTv=(before,after)=>assertSameTvReads(before.raw,after.raw)
    const report={schemaVersion:43,fixture:{activeOrders:20,itemsPerOrder:5,historySizes:[1000,10000]},baseline:{sourceCommit:baseline.commit,sourceSha256:baseline.sourceSha256},after:{},queryPlans:{}}
    progress('empty_start')
    const emptyBefore=await publishedTv()
    await addIndexes()
    const emptyAfter=await currentTv();assertSameTv(emptyBefore,emptyAfter)
    report.baseline.empty={tv:emptyBefore.reading}
    report.after.empty={tv:emptyAfter.reading,byIds:(await byIds([])).reading}
    await removeIndexes()
    progress('small_seed_start')
    const own=await seedOperationalReadFixture(db,{historicalOrders:1000,activeOrders:20})
    const foreign=await seedOperationalReadFixture(db,{businessId:foreignId,activeOrders:1})
    const ids=[own.activeIds[0],foreign.activeIds[0]],expected=[own.activeIds[0]]
    progress('small_read_start')
    const smallBefore=await publishedTv()
    report.baseline.small={tv:smallBefore.reading,orders:await fullList()}
    await addIndexes()
    const smallAfter=await currentTv(),smallIds=await byIds(ids);assertSameTv(smallBefore,smallAfter)
    assert.deepEqual(smallIds.value.map(o=>o.id),expected)
    assert.equal(smallIds.value[0].items.length,5)
    report.after.small={tv:smallAfter.reading,byIds:smallIds.reading}
    progress('large_seed_start')
    await seedOperationalReadFixture(db,{historicalOrders:9000,historicalOffset:1020})
    await removeIndexes()
    progress('large_read_start')
    const largeBefore=await publishedTv()
    report.baseline.large={tv:largeBefore.reading,orders:await fullList()}
    await addIndexes()
    const largeAfter=await currentTv(),largeIds=await byIds(ids);assertSameTv(largeBefore,largeAfter)
    assert.deepEqual(largeIds.value.map(o=>o.id),expected)
    assert.equal(largeIds.value[0].items.length,5)
    report.after.large={tv:largeAfter.reading,byIds:largeIds.reading}
    report.queryPlans={tv:largeAfter.reading.queries.flatMap(q=>q.plan),byIds:largeIds.reading.queries.flatMap(q=>q.plan)}
    progress('validate_report')
    try { report.passed=assertOperationalReadBudget(report) } catch (error) { report.passed=false;report.failure=error.message }
    return report
  }finally{progress('dispose_start');fixture.close();await mf.dispose();progress('disposed')}
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const report=await runOperationalReadBenchmark()
  console.log(JSON.stringify(report))
  if(!report.passed)process.exitCode=1
}
