import test from 'node:test'
import assert from 'node:assert/strict'
import {createSettingsDb} from '../test-support/settingsDb.js'
import {seedOperationalReadFixture} from '../test-support/operationalReadFixture.js'
import {listOrders} from '../orderReadRepository.js'
import {getHistoryView,historyTimestamp} from '../../src/domains/orders/domain/historyQuery.js'
const businessId='amor-e-sabor',now=new Date('2026-10-15T17:00:00.000Z'),granted=new Set(['orders.history'])
const reader=async()=> (await import('./orderHistoryRepository.js')).readOrderHistory
async function fixture(t,count=120){
  const f=createSettingsDb();t.after(f.close)
  const ids=await seedOperationalReadFixture(f.db,{businessId,historicalOrders:count,activeOrders:2,itemsPerOrder:2})
  f.sqlite.exec("UPDATE orders SET status='Cancelado',cancelled_at='2026-10-14T12:00:00.000Z' WHERE order_number%3=0 AND status='Finalizado'")
  if(count>3){
    f.sqlite.prepare("UPDATE orders SET client_name_snapshot='João Silva',finished_at='2026-10-15T03:00:00.000Z' WHERE id=?").run(ids.historicalIds[0])
    f.sqlite.prepare("UPDATE orders SET finished_at='2026-10-15T01:30:00.000Z' WHERE id=?").run(ids.historicalIds[1])
    f.sqlite.prepare("UPDATE order_items SET name_snapshot='Feijão Mineiro',category_snapshot='Almoço',size_snapshot='Grande',note='Sem açúcar' WHERE order_id=?").run(ids.historicalIds[1])
  }
  return {...f,ids}
}
const byHistory=(a,b)=>(Date.parse(historyTimestamp(b))||0)-(Date.parse(historyTimestamp(a))||0) || (a.id<b.id?1:a.id>b.id?-1:0)
test('history pages match existing filters, normalized item search, date timezone and full counts',async t=>{
  const f=await fixture(t),read=await reader(),all=await listOrders(f.db,businessId)
  for(const query of [{},{period:'today'},{period:'yesterday'},{period:'7d'},{period:'custom',startDate:'2026-10-13',endDate:'2026-10-15'},
    {filter:'cancelled'},{filter:'finalized'},{search:'feijao'},{search:'SEM ACUCAR'},{search:'joao'},{search:'Pedido #1'},
    {period:'custom',startDate:'invalid',endDate:'2026-10-15'}]){
    const expected=getHistoryView(all,query,now),seen=[],pageSummaries=[];let cursor
    do{
      const page=await read(f.db,businessId,{...query,granted,now,cursor,limit:50})
      seen.push(...page.orders);pageSummaries.push(page.summary)
      assert.equal(page.validRange,expected.validRange)
      assert.equal(page.completeWithinScope,false)
      assert.ok(page.orders.length<=50)
      cursor=page.nextCursor
    }while(cursor)
    assert.deepEqual(seen.map(o=>o.id),[...expected.orders].sort(byHistory).map(o=>o.id),JSON.stringify(query))
    for(const summary of pageSummaries)for(const key of ['all','finalized','cancelled'])assert.equal(summary[key],expected.counts[key],key)
  }
})
test('cursor is stable for tied timestamps, scoped to tenant/query and never authorizes reading by itself',async t=>{
  const f=await fixture(t),read=await reader()
  const first=await read(f.db,businessId,{granted,now,limit:50})
  assert.equal(first.orders.length,50);assert.ok(first.nextCursor)
  const second=await read(f.db,businessId,{granted,now,limit:50,cursor:first.nextCursor})
  assert.equal(new Set([...first.orders,...second.orders].map(o=>o.id)).size,100)
  for(const options of [{cursor:'not base64!'},{cursor:first.nextCursor,filter:'cancelled'},{cursor:first.nextCursor,search:'cliente'},
    {limit:101},{limit:0},{period:'unknown'},{filter:'DROP TABLE orders'}]){
    await assert.rejects(read(f.db,businessId,{granted,now,...options}),{status:400})
  }
  await assert.rejects(read(f.db,'another-company',{granted,now,cursor:first.nextCursor}),{status:400})
  await assert.rejects(read(f.db,businessId,{granted:new Set(['orders.view']),now,cursor:first.nextCursor}),{status:403})
})
test('legacy noncanonical and invalid timestamps preserve JS date semantics and remain reachable for all periods',async t=>{
  const f=await fixture(t,4),read=await reader()
  for(const [id,value] of [[f.ids.historicalIds[0],'2020'],[f.ids.historicalIds[1],'not-a-date'],[f.ids.historicalIds[3],'2026-10-14T23:30:00-03:00']])f.sqlite.prepare('UPDATE orders SET finished_at=? WHERE id=?').run(value,id)
  const expected=getHistoryView(await listOrders(f.db,businessId),{},now).orders.sort(byHistory)
  const result=await read(f.db,businessId,{granted,now})
  assert.deepEqual(result.orders.map(o=>o.id),expected.map(o=>o.id))
  assert.equal(result.summary.all,4)
})
test('ordinary history paging uses the tenant timeline index and loads item payloads only for the page',async t=>{
  const f=await fixture(t),read=await reader(),plans=[],itemBounds=[],prepare=f.db.prepare
  f.db.prepare=sql=>({bind:(...values)=>{
    plans.push(...f.sqlite.prepare('EXPLAIN QUERY PLAN '+sql).all(...values).map(r=>r.detail))
    if(/FROM order_items/.test(sql))itemBounds.push(values.length)
    return prepare(sql).bind(...values)
  }})
  const page=await read(f.db,businessId,{granted,now,limit:10})
  assert.equal(page.orders.length,10)
  assert.ok(plans.some(p=>p.includes('orders_business_history_time_idx')),plans.join('\n'))
  assert.equal(plans.some(p=>/^SCAN (orders|order_items|o)\b/.test(p)),false,plans.join('\n'))
  assert.deepEqual(itemBounds,[11])
  for(const [day,total] of Object.entries(page.summary.days)){
    const group=getHistoryView(await listOrders({...f.db,prepare},businessId),{},now).groups.find(g=>(g.date||'unknown')===day)
    assert.equal(total,group.orders.length)
  }
})

test('historical search bounds each header batch while keeping full result counts',async t=>{
  const f=await fixture(t,700),read=await reader(),prepare=f.db.prepare
  f.db.prepare=sql=>({bind:(...values)=>{
    const statement=prepare(sql).bind(...values)
    return {...statement,async all(){
      const result=await statement.all()
      if(result.results.some(row=>Object.hasOwn(row,'client_name_snapshot')))assert.ok(result.results.length<=128,'historical header batch is unbounded')
      return result
    }}
  }})
  const page=await read(f.db,businessId,{granted,now,search:'cliente',limit:10})
  assert.equal(page.orders.length,10)
  assert.equal(page.summary.all,699)
})
test('all-period cursor remains valid across midnight while relative periods require a new query',async t=>{
  const f=await fixture(t),read=await reader()
  const first=await read(f.db,businessId,{granted,now,limit:10})
  const nextDay=new Date('2026-10-16T17:00:00.000Z')
  const next=await read(f.db,businessId,{granted,now:nextDay,limit:10,cursor:first.nextCursor})
  assert.equal(next.orders.length,10)
  const relative=await read(f.db,businessId,{granted,now,limit:10,period:'7d'})
  assert.ok(relative.nextCursor)
  await assert.rejects(read(f.db,businessId,{granted,now:nextDay,period:'7d',cursor:relative.nextCursor}),{status:400})
})

test('search in a bounded period seeks that timeline range rather than scanning tenant history by ID',async t=>{
  const f=await fixture(t),read=await reader(),prepare=f.db.prepare,plans=[]
  f.db.prepare=sql=>({bind:(...values)=>{
    if(sql.includes('AS search_items'))plans.push(...f.sqlite.prepare('EXPLAIN QUERY PLAN '+sql).all(...values).map(row=>row.detail))
    return prepare(sql).bind(...values)
  }})
  const page=await read(f.db,businessId,{granted,now,period:'today',search:'prato'})
  assert.equal(page.orders.length,1)
  assert.ok(plans.some(plan=>plan.includes('orders_business_history_time_idx') && plan.includes('<expr>>?')),plans.join('\n'))
})

test('a tied-timestamp page cursor seeks the remaining IDs instead of revisiting the timeline prefix',async t=>{
  const f=await fixture(t),read=await reader(),first=await read(f.db,businessId,{granted,now,limit:10}),prepare=f.db.prepare,plans=[]
  f.db.prepare=sql=>({bind:(...values)=>{
    plans.push(...f.sqlite.prepare('EXPLAIN QUERY PLAN '+sql).all(...values).map(row=>row.detail))
    return prepare(sql).bind(...values)
  }})
  const second=await read(f.db,businessId,{granted,now,limit:10,cursor:first.nextCursor})
  assert.equal(second.orders.length,10)
  assert.ok(plans.some(plan=>plan.includes('orders_business_history_time_idx') && plan.includes('id<?')),plans.join('\n'))
})

test('one legacy timestamp does not force a recent query to walk the entire canonical history',async t=>{
  const f=await fixture(t),read=await reader(),prepare=f.db.prepare,plans=[]
  f.sqlite.prepare("UPDATE orders SET cancelled_at='2020' WHERE id=?").run(f.ids.historicalIds[119])
  f.db.prepare=sql=>({bind:(...values)=>{
    if(sql.includes('AS search_items'))plans.push(...f.sqlite.prepare('EXPLAIN QUERY PLAN '+sql).all(...values).map(row=>row.detail))
    return prepare(sql).bind(...values)
  }})
  const result=await read(f.db,businessId,{granted,now,period:'today',search:'prato'})
  assert.equal(result.orders.length,1)
  assert.ok(plans.some(plan=>plan.includes('orders_business_history_time_idx') && plan.includes('<expr>>?')),plans.join('\n'))
  assert.ok(plans.some(plan=>plan.includes('orders_business_history_legacy_idx') && plan.includes('id>?')),plans.join('\n'))
})
