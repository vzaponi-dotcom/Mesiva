import test from 'node:test'
import assert from 'node:assert/strict'
import { createSettingsDb } from './test-support/settingsDb.js'
import { createReportingRepository } from './reporting/repository.js'
import { createReportingService } from './reporting/service.js'
import { readReceivedToday, readFinanceTotals } from './readModels/movementReads.js'

const at = '2026-10-17T15:00:00.000Z'
const period = day => ({ from: day, to: day, period: 'custom' })

test('Task 10: shared/split and supplemental receipts reconcile reporting, movements and commercial receivables by distinct business dates', async t => {
  const { db, sqlite, close } = createSettingsDb()
  t.after(close)
  sqlite.exec(`
    INSERT INTO businesses(id,slug,name,created_at,updated_at) VALUES
      ('task10-a','task10-a','A','2026-10-01','2026-10-01'),
      ('task10-b','task10-b','B','2026-10-01','2026-10-01');
    INSERT INTO orders(id,business_id,order_number,client_name_snapshot,type,order_date,status,subtotal_cents,total_cents,created_at) VALUES
      ('o1','task10-a',1,'Ana','Entrega','2026-10-17','Finalizado',5500,5500,'${at}'),
      ('o2','task10-a',2,'Ana','Entrega','2026-10-17','Finalizado',4000,4000,'${at}');
    INSERT INTO payment_receipts(id,business_id,total_cents,paid_at,received_date,created_at) VALUES
      ('shared','task10-a',8000,'${at}','2026-10-15','${at}'),
      ('supp','task10-a',1500,'${at}','2026-10-17','${at}'),
      ('other-business','task10-b',3000,'${at}','2026-10-15','${at}');
    INSERT INTO payment_allocations(id,business_id,receipt_id,method_code,method_label,amount_cents,created_at) VALUES
      ('cash','task10-a','shared','cash','Dinheiro',3000,'${at}'),
      ('pix','task10-a','shared','pix','Pix',5000,'${at}'),
      ('supp-pix','task10-a','supp','pix','Pix',1500,'${at}'),
      ('foreign','task10-b','other-business','pix','Pix',3000,'${at}');
    INSERT INTO payments(id,business_id,order_id,receipt_id,amount_cents,paid_at,created_at) VALUES
      ('p1','task10-a','o1','shared',4000,'${at}','${at}'),
      ('p2','task10-a','o2','shared',4000,'${at}','${at}');
    INSERT INTO order_settlement_entries(id,business_id,order_id,kind,amount_cents,receipt_id,mutation_id,actor_name,created_at) VALUES
      ('supp-1','task10-a','o1','supplemental_payment',1500,'supp','supp-1','Operador','${at}');
    INSERT INTO movements(id,business_id,type,category,description,value_cents,source,order_id,movement_date,created_at,receipt_id,payment_allocation_id) VALUES
      ('mcash','task10-a','entrada','sales','Dinheiro',3000,'order-payment',NULL,'2026-10-15','${at}','shared','cash'),
      ('mpix','task10-a','entrada','sales','Pix',5000,'order-payment',NULL,'2026-10-15','${at}','shared','pix'),
      ('msupp','task10-a','entrada','sales','Complemento',1500,'order-payment','o1','2026-10-17','${at}','supp','supp-pix'),
      ('refund','task10-a','saida','refunds','Devolução',1000,'order-refund','o2','2026-10-15','${at}',NULL,NULL);
  `)
  const repository=createReportingRepository(db),service=createReportingService(repository)
  const prior=await service.sales('task10-a',period('2026-10-15'))
  const business=await service.sales('task10-b',period('2026-10-15'))
  assert.equal(prior.data.salesCents,0,'commercial orders remain on order_date')
  assert.equal(prior.data.receivedCents,8000,'shared receipt counted exactly once')
  assert.equal(prior.data.refundsCents,1000)
  assert.deepEqual(prior.data.receivedSeries,[{date:'2026-10-15',cents:8000}])
  assert.deepEqual(prior.data.paymentMix,[{method:'Dinheiro',amountCents:3000},{method:'Pix',amountCents:5000}])
  assert.equal(business.data.receivedCents,3000,'business scope is independent')
  assert.equal((await service.sales('task10-a',{...period('2026-10-15'),paymentMethod:'pix'})).data.receivedCents,5000)
  assert.equal((await service.sales('task10-a',{...period('2026-10-15'),paymentMethod:'cash'})).data.receivedCents,3000)
  const granted=new Set(['finance.movements'])
  assert.equal(await readReceivedToday(db,'task10-a',granted,'2026-10-15'),70)
  assert.equal(await readReceivedToday(db,'task10-a',granted,'2026-10-17'),15)
  assert.equal(await readReceivedToday(db,'task10-b',granted,'2026-10-15'),0)
  assert.equal(await readReceivedToday(db,'task10-a',new Set(),'2026-10-15'),0)
  const current=await service.sales('task10-a',period('2026-10-17'))
  assert.equal(current.data.salesCents,9500)
  assert.equal(current.data.receivedCents,1500)
  assert.equal(current.data.receivableCents,1000,'a refund is pending to be collected again')
  assert.deepEqual(current.data.salesSeries,[{date:'2026-10-17',cents:9500}])
  assert.deepEqual(current.data.receivedSeries,[{date:'2026-10-17',cents:1500}])
  const totals=await readFinanceTotals(db,'task10-a',granted)
  assert.deepEqual(totals.totals,{entries:95,exits:10,balance:85})
  const detail=await repository.getOrderDetail('task10-a','o1')
  assert.deepEqual(detail.paymentAllocations.map(x=>[x.receipt_id,x.received_date,x.amount_cents]),[
    ['shared','2026-10-15',3000],['shared','2026-10-15',5000],['supp','2026-10-17',1500],
  ])
  assert.equal(detail.paidCents,5500)
  assert.equal((await repository.getOrderDetail('task10-b','o1')),null)
  const report15=await service.overview('task10-a',period('2026-10-15'))
  assert.equal(report15.data.metrics.receivedCents,8000)
  assert.equal(report15.data.metrics.refundsCents,1000)
})

test('Task 10: real-D1 budget contract requires fixed query count, tenant isolation, zero writes and bounded history growth', async()=>{
  const {assertEffectiveReceiptBudget}=await import('../scripts/infra/effective-receipt-date-d1-gate.mjs')
  const sample=(count,reads)=>({rows_read:reads,rows_written:0,requests:count,tenantScoped:true})
  const valid={baseline:{small:sample(1,8),large:sample(1,8)},after:{small:sample(1,12),large:sample(1,12)},legacy:{small:sample(1,8),large:sample(1,9)}}
  assert.equal(assertEffectiveReceiptBudget(valid),true)
  assert.throws(()=>assertEffectiveReceiptBudget({...valid,after:{...valid.after,large:sample(1,2500)}}),/history|growth|budget/i)
  assert.throws(()=>assertEffectiveReceiptBudget({...valid,legacy:{...valid.legacy,small:sample(1,8),large:sample(1,50)}}),/history|growth|budget/i)
  assert.throws(()=>assertEffectiveReceiptBudget({...valid,after:{...valid.after,small:{...sample(1,12),rows_written:1}}}),/writes|written/i)
  assert.throws(()=>assertEffectiveReceiptBudget({...valid,after:{...valid.after,small:{...sample(1,12),tenantScoped:false}}}),/tenant|scope/i)
})
