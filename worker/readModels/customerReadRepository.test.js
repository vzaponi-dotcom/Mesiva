import test from 'node:test'
import assert from 'node:assert/strict'
import {financialReadFixture,businessId,now,allReadGrants as granted} from '../test-support/financialReadFixture.js'
import {listOrders} from '../orderReadRepository.js'
import {mapClientRow} from '../repositories.js'
import {buildClientRelationships,filterAndSortClients} from '../../src/domains/customers/domain/clientList.js'
const reader=async()=>import('./customerReadRepository.js')
test('customer pages preserve full relationship totals, sorting and filters without attaching historical items',async t=>{
  const f=await financialReadFixture(t),{readCustomers}=await reader()
  const clients=f.sqlite.prepare('SELECT * FROM clients').all().map(mapClientRow),orders=await listOrders(f.db,businessId)
  const profiles=buildClientRelationships(clients,orders,{now})
  for(const query of [{},{sort:'orders'},{sort:'recent'},{sort:'name-desc'},{filter:'pending'},{filter:'inactive'},{filter:'empty'},{search:'joão'},{search:'joao'}]){
    const expected=filterAndSortClients(clients,{...query,relationships:profiles}),seen=[];let cursor
    do{
      const result=await readCustomers(f.db,businessId,{...query,granted,now,limit:1,cursor})
      assert.equal(result.summary.count,expected.length);assert.equal(result.completeHistory,true)
      for(const client of result.clients){
        for(const key of ['orderCount','cancelledCount','total','pending','average','lastPurchase','daysSincePurchase','frequencyDays'])assert.deepEqual(client.profile[key],profiles.get(client.id)[key],key)
        assert.equal(Object.hasOwn(client.profile,'orders'),false)
      }
      seen.push(...result.clients.map(c=>c.id));cursor=result.nextCursor
    }while(cursor)
    assert.deepEqual(seen,expected.map(c=>c.id),JSON.stringify(query))
  }
})
test('relationship summary includes all authorized orders, favorites and old pending across pages',async t=>{
  const f=await financialReadFixture(t),{readCustomerRelationship}=await reader(),orders=await listOrders(f.db,businessId)
  const client=mapClientRow(f.sqlite.prepare("SELECT * FROM clients WHERE id='customer-a'").get())
  const expected=buildClientRelationships([client],orders,{now}).get(client.id)
  for(const filter of ['all','pending','finished','cancelled']){
    const wanted=expected.orders.filter(o=>filter==='pending'?o.status!=='Cancelado'&&o.paymentStatus!=='Pago':filter==='finished'?o.status==='Finalizado':filter==='cancelled'?o.status==='Cancelado':true)
    const seen=[];let cursor
    do{
      const result=await readCustomerRelationship(f.db,businessId,client.id,{filter,granted,now,limit:50,cursor})
      for(const key of ['orderCount','total','pending','favorites','frequencyDays'])assert.deepEqual(result.profile[key],expected[key],key)
      assert.equal(Object.hasOwn(result.profile,'orders'),false)
      assert.ok(result.orders.length<=50);seen.push(...result.orders.map(o=>o.id));cursor=result.nextCursor
    }while(cursor)
    assert.deepEqual(seen,wanted.map(o=>o.id))
  }
})
test('customer read capabilities never reveal denied historical orders or permit cross-tenant cursor reuse',async t=>{
  const f=await financialReadFixture(t),{readCustomers,readCustomerRelationship}=await reader()
  const active=new Set(['clients.view','orders.view']),plans=[],prepare=f.db.prepare
  f.db.prepare=sql=>({bind:(...values)=>{plans.push(...f.sqlite.prepare('EXPLAIN QUERY PLAN '+sql).all(...values).map(r=>r.detail));return prepare(sql).bind(...values)}})
  const partial=await readCustomerRelationship(f.db,businessId,'customer-a',{granted:active,now})
  assert.equal(partial.completeHistory,false);assert.equal(partial.profile.orderCount,2)
  assert.ok(partial.orders.every(o=>o.status==='Em preparo'))
  assert.ok(plans.some(p=>p.includes('orders_business_active_read_id_idx')),plans.join('\n'))
  const noOrders=await readCustomerRelationship(f.db,businessId,'customer-a',{granted:new Set(['clients.view']),now})
  assert.equal(noOrders.profile.orderCount,0);assert.deepEqual(noOrders.orders,[])
  await assert.rejects(readCustomers(f.db,businessId,{granted:new Set(['orders.history'])}),{status:403})
  const first=await readCustomers(f.db,businessId,{granted,now,limit:1})
  await assert.rejects(readCustomers(f.db,'other-company',{granted,now,cursor:first.nextCursor}),{status:400})
  await assert.rejects(readCustomerRelationship(f.db,'other-company','customer-a',{granted,now}),{status:404})
})

test('an order moved to another customer between selection and hydration is not returned in the previous relationship',async t=>{
  const f=await financialReadFixture(t,4),{readCustomerRelationship}=await reader(),prepare=f.db.prepare
  let moved=false
  f.db.prepare=sql=>({bind:(...values)=>{
    const statement=prepare(sql).bind(...values)
    return {...statement,async all(){
      const result=await statement.all()
      if(!moved && sql.includes('ORDER BY o.created_at DESC,o.rowid ASC')){
        moved=true;f.sqlite.prepare("UPDATE orders SET client_id='customer-b' WHERE id=?").run(f.ids.activeIds[0])
      }
      return result
    }}
  }})
  const result=await readCustomerRelationship(f.db,businessId,'customer-a',{granted,now})
  assert.equal(moved,true);assert.ok(result.orders.every(o=>o.clientId==='customer-a'))
  assert.equal(result.orders.some(o=>o.id===f.ids.activeIds[0]),false)
})
