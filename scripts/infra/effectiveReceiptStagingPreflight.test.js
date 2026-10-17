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
