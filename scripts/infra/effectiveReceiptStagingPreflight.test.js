import test from 'node:test'
import assert from 'node:assert/strict'

test('Task 11: pre-migration audit never queries a column absent before migration 0052', async () => {
  const { buildReceiptAuditSql, auditEffectiveReceipts } = await import('./effective-receipt-staging-preflight.mjs')
  const preSql=buildReceiptAuditSql(false),postSql=buildReceiptAuditSql(true)
  assert.doesNotMatch(preSql, /\br\.received_date\b/)
  assert.match(preSql, /payment_receipts r/)
  assert.match(preSql, /m\.business_id=r\.business_id/)
  assert.match(preSql, /m\.receipt_id=r\.id/)
  assert.match(postSql, /r\.received_date/)
  for(const sql of [preSql,postSql]){
    assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE)\b/i)
    assert.match(sql,/COUNT\(\*\)/)
    assert.match(sql,/source='order-payment'/)
  }
  const calls=[]
  const result=await auditEffectiveReceipts({query:async sql=>{
    calls.push(sql)
    return calls.length===1
      ? [{name:'id'},{name:'business_id'},{name:'paid_at'}]
      : [{classification:'consensus_legacy',receipts:4},{classification:'legacy_no_movement',receipts:1}]
  },log() {}})
  assert.equal(result.hasReceivedDate,false)
  assert.equal(result.receipts,5)
  assert.equal(result.needsManualReview,5)
  assert.equal(calls.length,2)
})

test('Task 11: fail closed on mismatched movements or unknown audit classifications before staging writes',async()=>{
  const {auditEffectiveReceipts}=await import('./effective-receipt-staging-preflight.mjs')
  const run=rows=>auditEffectiveReceipts({query:async sql=>sql.startsWith('PRAGMA')
    ? [{name:'id'},{name:'business_id'},{name:'paid_at'},{name:'received_date'}]
    : rows, log() {}})
  await assert.rejects(run([{classification:'BLOCKED_conflicting_movements',receipts:1}]),/conflict|BLOCKED|audit/i)
  await assert.rejects(run([{classification:'BLOCKED_receipt_movement_mismatch',receipts:2}]),/conflict|BLOCKED|audit/i)
  await assert.rejects(run([{classification:'unknown_new_class',receipts:3}]),/unknown|class|audit/i)
  await assert.rejects(run([{classification:'canonical',receipts:-1}]),/invalid|count|audit/i)
  const good=await run([{classification:'canonical',receipts:20},{classification:'consensus_legacy',receipts:4}])
  assert.equal(good.receipts,24)
  assert.equal(good.hasReceivedDate,true)
})

test('Task 11: schema mismatch and zero rows cannot be mistaken for successful audit',async()=>{
  const {auditEffectiveReceipts}=await import('./effective-receipt-staging-preflight.mjs')
  await assert.rejects(auditEffectiveReceipts({query:async()=>[],log() {}}),/schema|missing|audit/i)
  await assert.rejects(auditEffectiveReceipts({query:async sql=>sql.startsWith('PRAGMA')
    ? [{name:'id'},{name:'business_id'},{name:'paid_at'}] : [],log() {}}),/missing|rows|audit/i)
})


test('Task 11: audit query runs on real SQLite schema both immediately before and after migration 0052',async t=>{
  const {createSettingsDb}=await import('../../worker/test-support/settingsDb.js')
  const {buildReceiptAuditSql}=await import('./effective-receipt-staging-preflight.mjs')
  let checkedBefore=false
  const f=createSettingsDb({beforeMigration(file,sqlite){
    if(!file.startsWith('0052_'))return
    checkedBefore=true
    const columns=sqlite.prepare('PRAGMA table_info(payment_receipts)').all()
    assert.ok(!columns.some(x=>x.name==='received_date'))
    const empty=sqlite.prepare(buildReceiptAuditSql(false)).all().map(x=>({...x}))
    assert.deepEqual(empty,[{classification:'empty',receipts:0}])
  }})
  t.after(f.close)
  assert.ok(checkedBefore,'0052 preflight boundary was not reached')
  const after=f.sqlite.prepare(buildReceiptAuditSql(true)).all().map(x=>({...x}))
  assert.deepEqual(after,[{classification:'empty',receipts:0}])
  f.sqlite.exec("INSERT INTO businesses(id,slug,name,created_at,updated_at) VALUES('preflight-a','preflight-a','A','2026-10-17','2026-10-17')")
  f.sqlite.exec("INSERT INTO payment_receipts(id,business_id,total_cents,paid_at,received_date,created_at) VALUES('date-a','preflight-a',500,'2026-10-17T15:00:00.000Z','2026-10-15','2026-10-17T15:00:00.000Z'),('null-b','preflight-a',300,'2018-12-01T02:30:00.000Z',NULL,'2018-12-01T02:30:00.000Z')")
  assert.deepEqual(f.sqlite.prepare(buildReceiptAuditSql(true)).all().map(x=>({...x})),[
    {classification:'canonical',receipts:1},
    {classification:'legacy_no_movement',receipts:1},
  ])
})
