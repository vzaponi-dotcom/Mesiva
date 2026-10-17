import test from 'node:test'
import assert from 'node:assert/strict'
import { createSettingsDb } from './test-support/settingsDb.js'
import { createReportingRepository } from './reporting/repository.js'

test('Task 10: populated 0052 upgrade backfills only unanimous movements, preserves ambiguous legacy and company boundaries',async t=>{
  const beforeMigration=(file,sqlite)=>{
    if(!file.startsWith('0052_'))return
    const at='2026-10-17T15:00:00.000Z'
    for(const company of ['historical-a','historical-b'])
      sqlite.prepare("INSERT INTO businesses(id,slug,name,created_at,updated_at) VALUES(?,?,?,'2026-10-01','2026-10-01')")
        .run(company,company,company)
    const receipt=sqlite.prepare('INSERT INTO payment_receipts(id,business_id,total_cents,paid_at,created_at) VALUES(?,?,?,?,?)')
    for(const [id,business,amount,paidAt] of [
      ['unanimous','historical-a',1000,at],
      ['disagreement','historical-a',2000,at],
      ['without-movements','historical-a',3000,'2018-12-01T02:30:00.000Z'],
      ['foreign-receipt','historical-b',4000,at],
    ])receipt.run(id,business,amount,paidAt,paidAt)
    const allocation=sqlite.prepare(`INSERT INTO payment_allocations
      (id,business_id,receipt_id,method_label,amount_cents,created_at)
      VALUES(?,?,?,'Pix',?,?)`)
    for(const [id,business,cents,receiptId] of [
      ['c1','historical-a',700,'unanimous'],['c2','historical-a',300,'unanimous'],
      ['d1','historical-a',1000,'disagreement'],['d2','historical-a',1000,'disagreement'],
      ['f1','historical-b',4000,'foreign-receipt'],
    ])allocation.run(id,business,receiptId,cents,at)
    const movement=sqlite.prepare(`INSERT INTO movements(id,business_id,type,category,description,
      value_cents,source,movement_date,created_at,receipt_id,payment_allocation_id)
      VALUES(?,?,'entrada','sales','Migração',?,'order-payment',?,?,?,?)`)
    for(const [id,business,cents,date,receiptId] of [
      ['c1','historical-a',700,'2026-10-15','unanimous'],
      ['c2','historical-a',300,'2026-10-15','unanimous'],
      ['d1','historical-a',1000,'2026-10-14','disagreement'],
      ['d2','historical-a',1000,'2026-10-15','disagreement'],
      ['f1','historical-b',4000,'2026-10-15','foreign-receipt'],
    ])movement.run(id,business,cents,date,at,receiptId,id)
  }
  const {sqlite,db,close}=createSettingsDb({beforeMigration})
  t.after(close)
  assert.deepEqual(sqlite.prepare(`SELECT id,received_date FROM payment_receipts
    WHERE business_id='historical-a' ORDER BY id`).all(),[
    {id:'disagreement',received_date:null},
    {id:'unanimous',received_date:'2026-10-15'},
    {id:'without-movements',received_date:null},
  ])
  assert.equal(sqlite.prepare("SELECT received_date FROM payment_receipts WHERE id='foreign-receipt'").get().received_date,'2026-10-15')
  assert.equal(sqlite.prepare("SELECT paid_at FROM payment_receipts WHERE id='without-movements'").get().paid_at,'2018-12-01T02:30:00.000Z')
  const audits=sqlite.prepare(`SELECT r.id,COUNT(m.id) AS movement_count,
      MIN(m.movement_date) AS min_day,MAX(m.movement_date) AS max_day
    FROM payment_receipts r LEFT JOIN movements m
      ON m.business_id=r.business_id AND m.receipt_id=r.id
      AND m.deleted_at IS NULL AND m.type='entrada' AND m.source='order-payment'
    WHERE r.business_id='historical-a' AND r.received_date IS NULL
    GROUP BY r.id ORDER BY r.id`).all()
  assert.deepEqual(audits,[
    {id:'disagreement',movement_count:2,min_day:'2026-10-14',max_day:'2026-10-15'},
    {id:'without-movements',movement_count:0,min_day:null,max_day:null},
  ],'ambiguous receipts must be visible for operator review, not silently normalized')
  const repository=createReportingRepository(db)
  const period=(day)=>({from:day,to:day})
  assert.deepEqual((await repository.loadOverview('historical-a',period('2026-10-15'))).receipts.map(x=>x.total_cents),[1000])
  assert.deepEqual((await repository.loadOverview('historical-a',period('2018-12-01'))).receipts.map(x=>x.total_cents),[3000],
    '2018 DST reads must resolve NULL receipts in Sao Paulo calendar')
  assert.deepEqual((await repository.loadOverview('historical-b',period('2026-10-15'))).receipts.map(x=>x.total_cents),[4000])
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM payment_receipts WHERE received_date IS NULL").get().n,2)
  assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[])
  const plan=sqlite.prepare(`EXPLAIN QUERY PLAN SELECT id FROM payment_receipts
    WHERE business_id=? AND received_date BETWEEN ? AND ?`).all('historical-a','2026-10-15','2026-10-15')
  assert.ok(plan.some(x=>x.detail.includes('payment_receipts_business_received_date_idx')),JSON.stringify(plan))
})
