import test from 'node:test'
import assert from 'node:assert/strict'
import {financialReadFixture,businessId,now,allReadGrants as granted,pay} from '../test-support/financialReadFixture.js'
import {listOrders} from '../orderReadRepository.js'
import * as receivables from '../../src/domains/finance/domain/receivables.js'
const orderRules={isOrderCancelled:o=>o.status==='Cancelado',isOrderPaid:o=>o.paymentStatus==='Pago',getPendingAmount:o=>o.paymentStatus==='Pago'?0:Math.max(0,Number(o.total)||0)}
const reader=async()=>import('./financeReadRepository.js')
test('receivables retain full summary/forecast and old pending while returning only the requested page',async t=>{
  const f=await financialReadFixture(t),{readReceivables}=await reader(),orders=await listOrders(f.db,businessId)
  const summary=receivables.calculateReceivableSummary(orders,'2026-10-15',orderRules),forecast=receivables.buildReceivablesForecast(orders,'2026-10-15',7,orderRules)
  for(const query of [{},{sort:'recent'},{sort:'value-desc'},{timing:'overdue'},{timing:'upcoming'},{search:'feijão'},{search:'no match'}]){
    let expected=receivables.buildPendingReceivableEntries(orders,'2026-10-15',orderRules)
    if(query.timing)expected=expected.filter(e=>e.timing.status===query.timing)
    if(query.search)expected=expected.filter(e=>JSON.stringify(e.order).toLowerCase().includes(query.search))
    expected=receivables.sortReceivableEntries(expected,query.sort)
    const seen=[];let cursor
    do{
      const result=await readReceivables(f.db,businessId,{...query,mode:'orders',granted,now,limit:30,cursor})
      assert.deepEqual(result.summary,summary);assert.deepEqual(result.forecast,forecast)
      assert.ok(result.orders.length<=30);assert.ok(result.entries.every(e=>e.order.items.length===2))
      seen.push(...result.entries.map(e=>e.key));cursor=result.nextCursor
    }while(cursor)
    assert.deepEqual(seen,expected.map(e=>e.key),JSON.stringify(query))
  }
})
test('client groups expose complete totals but page their orders independently for selection across pages',async t=>{
  const f=await financialReadFixture(t),{readReceivables}=await reader(),all=await listOrders(f.db,businessId)
  const expected=receivables.sortReceivableGroups(receivables.groupReceivableEntriesByClient(receivables.buildPendingReceivableEntries(all,'2026-10-15',orderRules)))
  const result=await readReceivables(f.db,businessId,{granted,now,mode:'client'})
  assert.deepEqual(result.groups.map(g=>[g.key,g.total,g.count]),expected.map(g=>[g.key,g.total,g.count]))
  assert.equal(result.matchingGroupCount,expected.length)
  const page=await readReceivables(f.db,businessId,{granted,now,mode:'client',limit:1})
  assert.equal(page.matchingGroupCount,expected.length);assert.equal(page.groups.length,1)
  assert.ok(result.groups.every(g=>!Object.hasOwn(g,'orders')&&!Object.hasOwn(g,'entries')))
  const first=await readReceivables(f.db,businessId,{granted,now,mode:'orders',groupKey:'client:customer-a',limit:50})
  const second=await readReceivables(f.db,businessId,{granted,now,mode:'orders',groupKey:'client:customer-a',limit:50,cursor:first.nextCursor})
  assert.equal(first.group.count,expected.find(g=>g.key==='client:customer-a').count)
  assert.equal(new Set([...first.orders,...second.orders].map(o=>o.id)).size,100)
})
test('concurrent receipt removes the paid candidate and capability projection protects totals/refunds',async t=>{
  const f=await financialReadFixture(t),{readReceivables}=await reader()
  const before=await readReceivables(f.db,businessId,{granted,now,mode:'orders'})
  pay(f.sqlite,before.orders[0].id)
  const after=await readReceivables(f.db,businessId,{granted,now,mode:'orders'})
  assert.equal(after.summary.overdue.count+after.summary.today.count+after.summary.upcoming.count,before.summary.overdue.count+before.summary.today.count+before.summary.upcoming.count-1)
  const active=await readReceivables(f.db,businessId,{granted:new Set(['finance.receivables','orders.view']),now,mode:'orders'})
  assert.ok(active.orders.every(o=>o.status==='Em preparo'));assert.equal(active.summary.overdue.count,1)
  const none=await readReceivables(f.db,businessId,{granted:new Set(['finance.receivables']),now})
  assert.deepEqual(none.orders,[]);assert.equal(none.summary.overdue.count,0)
  await assert.rejects(readReceivables(f.db,businessId,{granted:new Set(['payments.receive','orders.history']),now}),{status:403})
  const refunds=await readReceivables(f.db,businessId,{granted:new Set(['finance.movements','orders.history']),now,view:'refunds'})
  assert.deepEqual(refunds.orders.map(o=>o.id),[f.ids.historicalIds[0]])
})

async function movementsFixture(t){
  const f=await financialReadFixture(t,4)
  f.sqlite.exec("INSERT INTO finance_settings(business_id,opening_balance_cents,opening_date,created_at,updated_at) VALUES('amor-e-sabor',10000,'2026-10-10','2020','2020')")
  const insert=f.sqlite.prepare("INSERT INTO movements(id,business_id,type,category,description,value_cents,source,movement_date,created_at,payment_method) VALUES(?,'amor-e-sabor',?,'other_income',?,?,'manual',?,?,?)")
  for(let i=0;i<115;i++)insert.run('movement-'+String(i).padStart(3,'0'),i%3===0?'saida':'entrada',i===5?'Café especial':'Movimento fictício',123+i,i<5?'2020-01-01':'2026-10-15','2026-10-15T12:00:00.000Z',i%2?'Pix':null)
  f.sqlite.exec("UPDATE movements SET deleted_at='2026-10-15' WHERE id='movement-000'")
  return f
}
test('finance movement pages keep global totals and opening balance, excluding soft deletions and respecting filters',async t=>{
  const f=await movementsFixture(t),{readFinanceMovements}=await reader()
  const {loadBootstrap}=await import('../repositories.js'),{calculateCurrentBalance,filterFinanceHistory}=await import('../../shared/cashFlowReadRules.js')
  const official=await loadBootstrap(f.db,businessId,null,granted)
  for(const query of [{},{search:'cafe'},{type:'saida'},{paymentMethod:'__missing__'},{period:'today'}]){
    const expected=filterFinanceHistory(official.movements,query).filter(m=>query.period!=='today'||m.movementDate==='2026-10-15'),seen=[];let cursor
    do{
      const result=await readFinanceMovements(f.db,businessId,{...query,granted,now,cursor,limit:40})
      assert.equal(Math.round(result.currentBalance*100),Math.round(calculateCurrentBalance(official.movements,official.financeSettings)*100))
      assert.equal(Math.round(result.totals.entries*100),official.movements.filter(m=>m.type==='entrada').reduce((n,m)=>n+Math.round(m.value*100),0))
      assert.equal(result.summary.count,expected.length)
      seen.push(...result.movements.map(m=>m.id));cursor=result.nextCursor
    }while(cursor)
    // Equal timestamp rows now have a stable ID tie-breaker for pagination.
    assert.deepEqual(new Set(seen),new Set(expected.map(m=>m.id)));assert.equal(seen.length,expected.length)
  }
  await assert.rejects(readFinanceMovements(f.db,businessId,{granted:new Set(['finance.overview']),now}),{status:403})
})
test('finance overview and dashboard preserve canonical totals, period analytics and resource capabilities',async t=>{
  const f=await movementsFixture(t),{readFinanceOverview}=await reader()
  const {loadBootstrap}=await import('../repositories.js'),analytics=await import('../../src/app/surfaces/dashboard/dashboardAnalytics.js')
  const official=await loadBootstrap(f.db,businessId,null,granted)
  for(const period of ['today','7d','30d']){
    const result=await readFinanceOverview(f.db,businessId,{granted,now,period})
    const expectedNow=new Date('2026-10-15T12:00:00')
    assert.deepEqual(result.dashboard.analytics.metrics,analytics.calculatePeriodMetrics(official.orders,period,expectedNow))
    assert.deepEqual(result.dashboard.analytics.daily,analytics.buildDailySeries(official.orders,period,expectedNow))
    assert.deepEqual(result.dashboard.analytics.topProducts,analytics.getTopProducts(official.orders,period,expectedNow))
    assert.equal(result.dashboard.analytics.mealsSold,analytics.getMealsSold(official.orders,period,expectedNow))
    assert.deepEqual(result.dashboard.analytics.paymentMix,analytics.getPaymentMix(official.movements,period,expectedNow))
    assert.equal(result.dashboard.totals.receivables,official.orders.filter(o=>o.status!=='Cancelado'&&o.paymentStatus!=='Pago').reduce((n,o)=>n+o.total,0))
    assert.equal(result.pendingRefundOrders.length,1)
  }
  const noResources=await readFinanceOverview(f.db,businessId,{granted:new Set(['finance.overview']),now})
  assert.equal(noResources.dashboard.totals.receivables,0);assert.equal(noResources.dashboard.totals.receivedToday,0)
  assert.deepEqual(noResources.pendingRefundOrders,[]);assert.equal(noResources.totals.balance,0)
})

test('fixed pending candidates are indexed independently of 10k paid retained orders',async t=>{
  const f=await financialReadFixture(t,4),{readReceivables}=await reader()
  const {seedOperationalReadFixture}=await import('../test-support/operationalReadFixture.js')
  await seedOperationalReadFixture(f.db,{businessId,historicalOrders:10000,historicalOffset:100000,itemsPerOrder:0})
  f.sqlite.exec("INSERT INTO payment_receipts(id,business_id,total_cents,paid_at,created_at) VALUES('history-receipt','amor-e-sabor',10000000,'2020','2020'); INSERT INTO payments(id,business_id,order_id,receipt_id,amount_cents,paid_at,created_at) SELECT 'paid-history:'||id,business_id,id,'history-receipt',1000,'2020','2020' FROM orders WHERE order_number>=100001")
  const plans=[],prepare=f.db.prepare
  f.db.prepare=sql=>({bind:(...values)=>{plans.push(...f.sqlite.prepare('EXPLAIN QUERY PLAN '+sql).all(...values).map(r=>r.detail));return prepare(sql).bind(...values)}})
  const result=await readReceivables(f.db,businessId,{granted,now,mode:'orders'})
  assert.equal(result.orders.length,5)
  assert.ok(plans.some(p=>p.includes('order_financial_candidates_kind_idx')),plans.join('\n'))
  assert.equal(plans.some(p=>/^SCAN (orders|o|payments|p|c)\b/.test(p)),false,plans.join('\n'))
})

test('movement pagination never splits the official receipt/payment composition between pages',async t=>{
  const f=await financialReadFixture(t,4),{readFinanceMovements}=await reader(),orderId=f.ids.historicalIds[1]
  const receipt='receipt-'+orderId,paymentId='payment-'+orderId,at=now.toISOString()
  f.sqlite.prepare('DELETE FROM payment_allocations WHERE receipt_id=?').run(receipt)
  for(let i=0;i<3;i++){
    const allocation='split-'+i
    f.sqlite.prepare("INSERT INTO payment_allocations(id,business_id,receipt_id,method_label,amount_cents,created_at) VALUES(?,'amor-e-sabor',?,'Pix',?,?)").run(allocation,receipt,i===2?400:300,at)
    f.sqlite.prepare("INSERT INTO movements(id,business_id,type,category,description,value_cents,source,order_id,payment_id,receipt_id,payment_allocation_id,movement_date,created_at,payment_method) VALUES(?,'amor-e-sabor','entrada','sales','Pedido recebido',?,'order-payment',?,?,?,?,'2026-10-15',?,'Pix')").run('split-movement-'+i,i===2?400:300,orderId,paymentId,receipt,allocation,at)
  }
  const first=await readFinanceMovements(f.db,businessId,{granted,now,limit:1})
  assert.equal(first.movements.length,3)
  assert.equal(first.summary.count,1)
  assert.equal(first.movements.reduce((sum,m)=>sum+Math.round(m.value*100),0),1000)
  assert.equal(first.nextCursor,null)
})

test('table reservations and tabs retain the official exclusions without dropping unrelated old debt',async t=>{
  const f=await financialReadFixture(t,4),{readReceivables}=await reader()
  f.sqlite.exec("INSERT INTO tables(id,business_id,name,name_key,sort_order,created_at,updated_at) VALUES('read-table','amor-e-sabor','Mesa Fictícia','MESA FICTÍCIA',1,'2020','2020'); INSERT INTO table_tabs(id,business_id,table_id,table_identifier,tab_number,status,opened_at,created_at,updated_at) VALUES('read-tab','amor-e-sabor','read-table','Mesa Fictícia',1,'open','2020','2020','2020')")
  f.sqlite.prepare("UPDATE orders SET customer_identity_type='table',table_tab_id='read-tab',type='Local' WHERE id=?").run(f.ids.historicalIds[2])
  f.sqlite.prepare("UPDATE orders SET type='Local' WHERE id=?").run(f.ids.activeIds[0])
  f.sqlite.prepare("INSERT INTO table_reservations(id,business_id,order_id,table_id,table_name_snapshot,status,scheduled_for,ends_at,duration_minutes,created_at,updated_at) VALUES('read-reservation','amor-e-sabor',?,'read-table','Mesa Fictícia','reserved','2030-01-01T12:00:00Z','2030-01-01T13:00:00Z',60,'2020','2020')").run(f.ids.activeIds[0])
  const official=await listOrders(f.db,businessId),result=await readReceivables(f.db,businessId,{granted,now,mode:'orders'})
  assert.deepEqual(result.summary,receivables.calculateReceivableSummary(official,'2026-10-15',orderRules))
  assert.deepEqual(new Set(result.orders.map(o=>o.id)),new Set(receivables.buildPendingReceivableEntries(official,'2026-10-15',orderRules).map(e=>e.order.id)))
  assert.ok(result.orders.some(o=>o.id===f.ids.historicalIds[3]))
})
test('dashboard aggregation matches legacy labels, quantities, no-item fallback and active-only scope at business midnight',async t=>{
  const f=await financialReadFixture(t,4),{readFinanceOverview}=await reader(),analytics=await import('../../src/app/surfaces/dashboard/dashboardAnalytics.js')
  f.sqlite.exec("UPDATE orders SET order_date='2026-10-14'; UPDATE order_items SET name_snapshot='  Marmita   Grande ',size_snapshot='Grande',quantity=2 WHERE rowid%3=0; DELETE FROM order_items WHERE order_id=(SELECT id FROM orders WHERE status='Em preparo' LIMIT 1)")
  const midnight=new Date('2026-10-15T01:00:00.000Z'),calendar=new Date('2026-10-14T12:00:00')
  for(const scope of [granted,new Set(['finance.overview','orders.view'])]){
    const all=(await listOrders(f.db,businessId)).filter(o=>scope.has('orders.history')||o.status==='Em preparo')
    const result=await readFinanceOverview(f.db,businessId,{granted:scope,now:midnight,period:'today'})
    assert.deepEqual(result.dashboard.analytics.topProducts,analytics.getTopProducts(all,'today',calendar))
    assert.equal(result.dashboard.analytics.mealsSold,analytics.getMealsSold(all,'today',calendar))
    assert.equal(result.dashboard.totals.salesToday,all.filter(o=>o.status!=='Cancelado').reduce((sum,o)=>sum+o.total,0))
  }
})
