import test from 'node:test'
import assert from 'node:assert/strict'
import {createSettingsDb} from '../test-support/settingsDb.js'
import {prepareIdentityAssertion} from '../identity/transactions.js'
const businessId='amor-e-sabor',at='2026-10-15T12:00:00.000Z'
const order=(sqlite,id,status='Finalizado')=>sqlite.prepare(`INSERT INTO orders(id,business_id,client_name_snapshot,type,order_date,status,subtotal_cents,total_cents,created_at)
  VALUES(?,?,'Cliente fictício','Retirada','2026-10-15',?,1000,1000,?)`).run(id,businessId,status,at)
function payment(sqlite,id,orderId){
  const receipt='receipt-'+orderId
  sqlite.prepare('INSERT OR IGNORE INTO payment_receipts(id,business_id,total_cents,paid_at,created_at) VALUES(?,?,1000,?,?)').run(receipt,businessId,at,at)
  sqlite.prepare('INSERT INTO payments(id,business_id,order_id,amount_cents,receipt_id,paid_at,created_at) VALUES(?,?,?,1000,?,?,?)').run(id,businessId,orderId,receipt,at,at)
}
const keys=sqlite=>sqlite.prepare('SELECT business_id,order_id,kind FROM order_financial_candidates ORDER BY business_id,order_id').all().map(r=>({...r}))
function assertSource(sqlite){
  const actual=keys(sqlite),source=sqlite.prepare('SELECT business_id,order_id,candidate_kind AS kind FROM order_financial_candidate_source WHERE candidate_kind IS NOT NULL ORDER BY business_id,order_id').all().map(r=>({...r}))
  assert.deepEqual(actual,source)
}
function refund(sqlite,id,orderId){sqlite.prepare(`INSERT INTO movements(id,business_id,type,category,description,value_cents,source,order_id,movement_date,created_at)
  VALUES(?,?,'saida','other_expense','Estorno fictício',1000,'order-refund',?,'2026-10-15',?)`).run(id,businessId,orderId,at)}
test('migration backfills only unpaid/refund keys and preserves all original business records',t=>{
  let before
  const f=createSettingsDb({beforeMigration(name,sqlite){
    if(!name.startsWith('0047_'))return
    for(const [id,status] of [['unpaid','Em preparo'],['old-unpaid','Finalizado'],['paid','Finalizado'],['refund','Cancelado'],['refunded','Cancelado'],['cancelled-unpaid','Cancelado']])order(sqlite,id,status)
    payment(sqlite,'payment-paid','paid');payment(sqlite,'payment-refund','refund');payment(sqlite,'payment-refunded','refunded');refund(sqlite,'old-refund','refunded')
    before=['orders','payments','movements','audit_events','print_jobs'].map(table=>sqlite.prepare('SELECT * FROM '+table+' ORDER BY rowid').all().map(r=>({...r})))
  }});t.after(f.close)
  assert.ok(before,'upgrade hook must run before candidate migration')
  assert.deepEqual(['orders','payments','movements','audit_events','print_jobs'].map(table=>f.sqlite.prepare('SELECT * FROM '+table+' ORDER BY rowid').all().map(r=>({...r}))),before)
  assert.deepEqual(keys(f.sqlite).map(k=>[k.order_id,k.kind]),[['old-unpaid','unpaid'],['refund','refund'],['unpaid','unpaid']])
  assertSource(f.sqlite)
})
test('candidate triggers follow payment, cancellation and refund within the same transaction',t=>{
  const f=createSettingsDb();t.after(f.close)
  order(f.sqlite,'target','Em preparo');assertSource(f.sqlite)
  assert.equal(keys(f.sqlite)[0].kind,'unpaid')
  payment(f.sqlite,'paid','target');assertSource(f.sqlite);assert.deepEqual(keys(f.sqlite),[])
  f.sqlite.exec("UPDATE orders SET status='Cancelado' WHERE id='target'");assertSource(f.sqlite)
  assert.equal(keys(f.sqlite)[0].kind,'refund')
  refund(f.sqlite,'refund','target');assertSource(f.sqlite);assert.deepEqual(keys(f.sqlite),[])
  f.sqlite.exec("DELETE FROM movements WHERE id='refund'");assertSource(f.sqlite)
  assert.equal(keys(f.sqlite)[0].kind,'refund')
  f.sqlite.exec("DELETE FROM payments WHERE id='paid'");assertSource(f.sqlite);assert.deepEqual(keys(f.sqlite),[])
  f.sqlite.exec("UPDATE orders SET status='Finalizado' WHERE id='target'");assertSource(f.sqlite)
  assert.equal(keys(f.sqlite)[0].kind,'unpaid')
})
test('failed payment rolls back source and candidates and triggers preserve outer SQL changes()',async t=>{
  const f=createSettingsDb();t.after(f.close);order(f.sqlite,'rollback')
  f.sqlite.prepare("INSERT INTO payment_receipts(id,business_id,total_cents,paid_at,created_at) VALUES('rollback-receipt',?,1000,?,?)").run(businessId,at,at)
  const insert=f.db.prepare("INSERT INTO payments(id,business_id,order_id,amount_cents,receipt_id,paid_at,created_at) VALUES('payment',?,'rollback',1000,'rollback-receipt',?,?)").bind(businessId,at,at)
  await assert.rejects(f.db.batch([insert,prepareIdentityAssertion(f.db,'failure','SELECT 0',[])]))
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM payments WHERE id='payment'").get().n,0)
  assertSource(f.sqlite);assert.equal(keys(f.sqlite)[0].kind,'unpaid')
  const result=await f.db.batch([insert,f.db.prepare('SELECT changes() AS n')])
  assert.equal(result[1].results[0].n,1);assertSource(f.sqlite);assert.deepEqual(keys(f.sqlite),[])
  const cancelled=await f.db.batch([f.db.prepare("UPDATE orders SET status='Cancelado' WHERE id='rollback'"),f.db.prepare('SELECT changes() AS n')])
  assert.equal(cancelled[1].results[0].n,1);assertSource(f.sqlite)
})
test('legacy falsey payment IDs stay unpaid and deleted refunds no longer reduce canonical net',t=>{
  const f=createSettingsDb();t.after(f.close);order(f.sqlite,'legacy')
  payment(f.sqlite,null,'legacy');assertSource(f.sqlite);assert.equal(keys(f.sqlite)[0].kind,'unpaid')
  f.sqlite.exec("UPDATE payments SET id='valid-id' WHERE order_id='legacy'");assertSource(f.sqlite);assert.deepEqual(keys(f.sqlite),[])
  f.sqlite.exec("UPDATE orders SET status='Cancelado' WHERE id='legacy'");refund(f.sqlite,'soft-refund','legacy')
  f.sqlite.exec("UPDATE movements SET deleted_at='2026-10-15' WHERE id='soft-refund'")
  assertSource(f.sqlite);assert.equal(keys(f.sqlite)[0].kind,'refund')
})
test('composite candidate ownership rejects another tenant and reads revalidate authoritative paid state',async t=>{
  const f=createSettingsDb();t.after(f.close);order(f.sqlite,'owned')
  assert.throws(()=>f.sqlite.prepare("INSERT INTO order_financial_candidates(business_id,order_id,kind) VALUES('another-company','owned','unpaid')").run(),/FOREIGN KEY/)
  payment(f.sqlite,'done','owned')
  f.sqlite.prepare("INSERT INTO order_financial_candidates(business_id,order_id,kind) VALUES(?,'owned','unpaid')").run(businessId)
  const {listFinancialCandidateIds}=await import('./financialCandidates.js')
  assert.deepEqual(await listFinancialCandidateIds(f.db,businessId,{kind:'unpaid',granted:new Set(['orders.history'])}),[])
})

test('retargeted payment/refund and order deletion update old/new keys and cache writes are idempotent',t=>{
  const f=createSettingsDb();t.after(f.close)
  order(f.sqlite,'one');order(f.sqlite,'two');payment(f.sqlite,'paid','one')
  f.sqlite.exec("UPDATE payments SET order_id='two' WHERE id='paid'");assertSource(f.sqlite)
  assert.deepEqual(keys(f.sqlite).map(k=>k.order_id),['one'])
  f.sqlite.exec("UPDATE orders SET status='Cancelado' WHERE id IN ('one','two')");refund(f.sqlite,'refund','two');assertSource(f.sqlite)
  f.sqlite.exec("UPDATE movements SET order_id='one' WHERE id='refund'");assertSource(f.sqlite)
  assert.deepEqual(keys(f.sqlite).map(k=>k.order_id),['two'])
  f.sqlite.exec("DELETE FROM movements;DELETE FROM payments;UPDATE orders SET status='Finalizado';")
  assertSource(f.sqlite)
  const before=f.sqlite.prepare('SELECT total_changes() AS n').get().n
  f.sqlite.exec("UPDATE orders SET status='Finalizado' WHERE id='one'")
  assert.equal(f.sqlite.prepare('SELECT total_changes() AS n').get().n-before,1,'unchanged derived keys must not be rewritten')
  f.sqlite.exec("DELETE FROM orders WHERE id='one'");assertSource(f.sqlite)
  assert.deepEqual(keys(f.sqlite).map(k=>k.order_id),['two'])
})
