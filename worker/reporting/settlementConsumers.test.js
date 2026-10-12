import test from 'node:test'
import assert from 'node:assert/strict'
import {createSettingsDb} from '../test-support/settingsDb.js'
import {createReportingRepository} from './repository.js'
import {createReportingService} from './service.js'
import {loadOrderPrintDocument} from '../orderPrintDocumentRepository.js'

const B='amor-e-sabor', DATE='2026-10-12', AT='2026-10-12T15:00:00.000Z'
const QUERY={from:DATE,to:DATE,page:1,pageSize:30}
function setup(t) {
  const f=createSettingsDb();t.after(f.close)
  const s=f.sqlite
  for(const [index,[id,total]] of [['partial',9500],['overpaid',6500],['refunded',8000]].entries()) {
    s.prepare(`INSERT INTO orders(id,business_id,order_number,client_name_snapshot,type,order_date,status,
      subtotal_cents,total_cents,created_at) VALUES(?,?,?,'Cliente','Entrega',?,'Finalizado',?,?,?)`)
      .run(id,B,index+1,DATE,total,total,AT)
    const r=id+'-receipt'
    s.prepare('INSERT INTO payment_receipts(id,business_id,total_cents,paid_at,created_at) VALUES(?,?,?,?,?)')
      .run(r,B,8000,AT,AT)
    s.prepare('INSERT INTO payment_allocations(id,business_id,receipt_id,method_code,method_label,amount_cents,created_at) VALUES(?,?,?,?,?,?,?)')
      .run(id+'-allocation',B,r,'cash','Dinheiro',8000,AT)
    s.prepare('INSERT INTO payments(id,business_id,order_id,receipt_id,amount_cents,method,paid_at,created_at) VALUES(?,?,?,?,?,NULL,?,?)')
      .run(id+'-payment',B,id,r,8000,AT,AT)
  }
  s.prepare(`INSERT INTO movements(id,business_id,type,category,description,value_cents,source,order_id,
    movement_date,created_at,updated_at) VALUES('refund-1000',?,'saida','Estornos','Parcial',1000,'order-edit-refund','refunded',?,?,?)`)
    .run(B,DATE,AT,AT)
  s.prepare(`INSERT INTO order_settlement_entries(id,business_id,order_id,kind,amount_cents,
    movement_id,mutation_id,actor_name,created_at) VALUES('entry-1000',?,'refunded','refund',1000,'refund-1000','mut-1000','Operador',?)`)
    .run(B,AT)
  return f
}

test('Task 13 overview and sales use current outstanding balances and one real refund movement',async t=>{
  const {db}=setup(t)
  const repository=createReportingRepository(db)
  const orders=(await repository.loadOverview(B,QUERY)).orders
  assert.deepEqual(orders.map(o=>[o.id,o.gross_received_cents,o.refunded_cents]),
    [['partial',8000,0],['overpaid',8000,0],['refunded',8000,1000]])
  const overview=await createReportingService(repository).overview(B,QUERY)
  assert.equal(overview.data.metrics.receivableCents,2500)
  assert.equal(overview.data.metrics.refundsCents,1000)
  assert.equal(overview.data.metrics.receivedCents,24000)
  const sales=await createReportingService(repository).sales(B,QUERY)
  assert.equal(sales.data.receivableCents,2500)
  assert.equal(sales.data.receivableCount,2)
  assert.equal(sales.data.refundsCents,1000)
  assert.equal(sales.data.receivedCents,24000)
})

test('Task 13 detail, drawer, receivable filter and ticket never call a partly-paid order Paid',async t=>{
  const {db}=setup(t)
  const repository=createReportingRepository(db)
  const pending=await repository.listDetail(B,{...QUERY,receivable:'unpaid'})
  assert.deepEqual(pending.items.map(o=>o.id).sort(),['partial','refunded'])
  const all=await repository.listDetail(B,QUERY)
  const part=all.items.find(o=>o.id==='partial')
  assert.equal(part.paidCents,8000)
  assert.equal(part.pendingCents,1500)
  assert.equal(part.paymentStatus,'Parcialmente pago')
  const over=all.items.find(o=>o.id==='overpaid')
  assert.equal(over.refundDueCents,1500)
  const drawer=await repository.getOrderDetail(B,'partial')
  assert.equal(drawer.pendingCents,1500)
  assert.equal(drawer.paymentStatus,'Parcialmente pago')
  const ticket=await loadOrderPrintDocument(db,B,'partial')
  assert.equal(ticket.payment.status,'Parcialmente pago')
  const overTicket=await loadOrderPrintDocument(db,B,'overpaid')
  assert.equal(overTicket.payment.status,'Devolução pendente')
})

test('Task 13 supplemental receipt methods count once and can filter orders by new payment method',async t=>{
  const {db,sqlite:s}=setup(t)
  s.prepare("UPDATE orders SET total_cents=9500,subtotal_cents=9500 WHERE id='partial'").run()
  s.prepare('INSERT INTO payment_receipts(id,business_id,total_cents,paid_at,created_at) VALUES(?,?,?,?,?)')
    .run('supp-receipt',B,1500,AT,AT)
  s.prepare('INSERT INTO payment_allocations(id,business_id,receipt_id,method_code,method_label,amount_cents,created_at) VALUES(?,?,?,?,?,?,?)')
    .run('supp-pix',B,'supp-receipt','pix','Pix',1000,AT)
  s.prepare('INSERT INTO payment_allocations(id,business_id,receipt_id,method_code,method_label,amount_cents,created_at) VALUES(?,?,?,?,?,?,?)')
    .run('supp-cash',B,'supp-receipt','cash','Dinheiro',500,AT)
  s.prepare(`INSERT INTO order_settlement_entries(id,business_id,order_id,kind,amount_cents,receipt_id,
    mutation_id,actor_name,created_at) VALUES('supp-entry',?,'partial','supplemental_payment',1500,'supp-receipt','supp-key','Operador',?)`)
    .run(B,AT)
  const repository=createReportingRepository(db)
  const method=await repository.listDetail(B,{...QUERY,paymentMethod:'Pix'})
  assert.ok(method.items.some(o=>o.id==='partial'))
  const source=await repository.loadSales(B,{...QUERY,paymentMethod:'Pix'})
  assert.deepEqual(source.receipts.map(r=>r.total_cents),[1000])
  const all=await repository.loadSales(B,QUERY)
  assert.equal(all.receipts.reduce((sum,r)=>sum+r.total_cents,0),25500)
  const drawer=await repository.getOrderDetail(B,'partial')
  assert.equal(drawer.paidCents,9500)
  assert.equal(drawer.pendingCents,0)
  assert.ok(drawer.paymentAllocations.some(a=>a.receipt_id==='supp-receipt'))
})
