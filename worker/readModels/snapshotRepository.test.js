import test from 'node:test'
import assert from 'node:assert/strict'
import {createSettingsDb} from '../test-support/settingsDb.js'
import {seedOperationalReadFixture} from '../test-support/operationalReadFixture.js'
const businessId='amor-e-sabor',read=async()=> (await import('./snapshotRepository.js')).loadSurfaceSnapshot
function setup(t){const f=createSettingsDb();t.after(f.close);return f}
test('empty scoped bootstrap declares only active orders and no historical collections',async t=>{
  const {db}=setup(t),load=await read()
  const result=await load(db,businessId,{surface:'orders',granted:new Set(['orders.view'])})
  assert.deepEqual(result.orders,[])
  assert.deepEqual(result.readModel.completeCollections,['orders'])
  assert.equal(result.readModel.orderScope,'active')
  assert.deepEqual(result.readModel.counters,{orders:0,comandas:0})
  assert.equal(Object.hasOwn(result,'movements'),false)
  assert.equal(Object.hasOwn(result,'tableTabs'),false)
})
test('common snapshot reads share one guarded batch and preserve counters', async t => {
  const { db } = setup(t), load = await read()
  const batch = db.batch.bind(db), lengths = []
  db.batch = async statements => { lengths.push(statements.length); return batch(statements) }
  const result = await load(db, businessId, { surface: 'clients', granted: new Set(['clients.view', 'orders.view', 'comandas.view']) })
  assert.deepEqual(lengths, [3])
  assert.deepEqual(result.readModel.counters, { orders: 0, comandas: 0 })
  assert.deepEqual(result.readModel.operationalOrders, [])
  assert.deepEqual(result.readModel.openTableTabIds, [])
})

test('new order batches permitted clients, catalog and open-tab reads',async t=>{
  const {db,sqlite}=setup(t),load=await read(),at='2026-10-16T12:00:00Z'
  sqlite.prepare("INSERT INTO clients(id,business_id,name,created_at,updated_at) VALUES('new-client',?,'Ana',?,?)").run(businessId,at,at)
  sqlite.prepare("INSERT INTO products(id,business_id,category,size,name,price_cents,active,created_at,updated_at) VALUES('new-product',?,'Bebidas','Un','Suco',3000,1,?,?)").run(businessId,at,at)
  const batch=db.batch.bind(db),lengths=[]
  db.batch=async statements=>{lengths.push(statements.length);return batch(statements)}
  const result=await load(db,businessId,{surface:'new-order',granted:new Set(['orders.create','orders.view','comandas.view','clients.view','products.view'])})
  assert.equal(lengths[0],6)
  assert.deepEqual(result.clients.map(c=>c.id),['new-client'])
  assert.deepEqual(result.products.map(p=>p.id),['new-product'])
  assert.deepEqual(result.tableTabs,[])
  assert.equal(result.readModel.orderScope,'open-tabs')
})

test('active selection stays indexed at 10k and 100k terminal orders with old and future active candidates',async t=>{
  const {db,sqlite}=setup(t),load=await read()
  const active=await seedOperationalReadFixture(db,{businessId,activeOrders:3})
  sqlite.prepare("UPDATE orders SET status='Agendado',scheduled_for='2030-01-01T12:00:00Z' WHERE id=?").run(active.activeIds[1])
  sqlite.prepare("UPDATE orders SET created_at='2020-01-01',finished_at='2020-01-02' WHERE id=?").run(active.activeIds[0])
  const plans=[],prepare=db.prepare
  db.prepare=sql=>({bind:(...values)=>{
    assert.ok(values.length<=100)
    if(/\bFROM (orders|order_items)\b/.test(sql))plans.push(...sqlite.prepare('EXPLAIN QUERY PLAN '+sql).all(...values).map(r=>r.detail))
    return prepare(sql).bind(...values)
  }})
  for(const [count,offset] of [[10000,100000],[90000,200000]]){
    await seedOperationalReadFixture({...db,prepare},{businessId,historicalOrders:count,historicalOffset:offset,itemsPerOrder:5})
    const snapshot=await load(db,businessId,{surface:'orders',granted:new Set(['orders.view','orders.history'])})
    assert.deepEqual(new Set(snapshot.orders.map(o=>o.id)),new Set(active.activeIds))
    assert.equal(snapshot.readModel.counters.orders,2)
  }
  assert.equal(plans.some(p=>/^SCAN (orders|order_items|o)\b/.test(p)),false,plans.join('\n'))
  assert.ok(plans.some(p=>p.includes('orders_business_current_status_idx')),plans.join('\n'))
  assert.ok(plans.some(p=>p.includes('order_items_business_order_created_idx') && p.includes('order_id=?')),plans.join('\n'))
})
test('order that finalizes between candidate selection and payload is not reintroduced as active',async t=>{
  const {db,sqlite}=setup(t),load=await read(),ids=await seedOperationalReadFixture(db,{businessId,activeOrders:1})
  const prepare=db.prepare;let raced=false
  db.prepare=sql=>({bind:(...values)=>{
    const statement=prepare(sql).bind(...values)
    return {...statement,async all(){
      const result=await statement.all()
      if(!raced && result.results.some(row=>row.id===ids.activeIds[0] && !Object.hasOwn(row,'status'))){
        raced=true;sqlite.prepare("UPDATE orders SET status='Finalizado',finished_at='2026-10-15' WHERE id=?").run(ids.activeIds[0])
      }
      return result
    }}
  }})
  const snapshot=await load(db,businessId,{surface:'orders',granted:new Set(['orders.view','orders.history'])})
  assert.equal(raced,true);assert.deepEqual(snapshot.orders,[])
})
test('open tabs retain old finalized orders while unrelated and closed-tab history remain outside the snapshot',async t=>{
  const {db,sqlite}=setup(t),load=await read(),ids=await seedOperationalReadFixture(db,{businessId,historicalOrders:3})
  sqlite.exec(`INSERT INTO tables(id,business_id,name,name_key,sort_order,is_active,created_at,updated_at) VALUES('snapshot-table','amor-e-sabor','Ficticia','FICTICIA',1,1,'2020','2020');
    INSERT INTO table_tabs(id,business_id,table_id,table_identifier,tab_number,status,opened_at,created_at,updated_at) VALUES
    ('snapshot-open','amor-e-sabor','snapshot-table','Ficticia',1001,'open','2020','2020','2020'),
    ('snapshot-closed','amor-e-sabor',NULL,'Antiga',1002,'closed','2020','2020','2020');`)
  sqlite.prepare('UPDATE orders SET table_tab_id=? WHERE id=?').run('snapshot-open',ids.historicalIds[0])
  sqlite.prepare('UPDATE orders SET table_tab_id=? WHERE id=?').run('snapshot-closed',ids.historicalIds[1])
  const result=await load(db,businessId,{surface:'comandas',granted:new Set(['orders.history','orders.view','comandas.view','tables.view'])})
  assert.deepEqual(result.tableTabs.map(t=>t.id),['snapshot-open'])
  assert.deepEqual(result.orders.map(o=>o.id),[ids.historicalIds[0]])
  assert.equal(result.readModel.orderScope,'open-tabs')
})

test('shell counters preserve scheduled preparation eligibility and expose only minimal authorized active identities',async t=>{
  const {db,sqlite}=setup(t),load=await read(),ids=await seedOperationalReadFixture(db,{businessId,activeOrders:2,historicalOrders:2})
  sqlite.prepare("UPDATE orders SET status='Agendado',scheduled_for='2030-01-01T12:00:00.000Z' WHERE id=?").run(ids.activeIds[1])
  const result=await load(db,businessId,{surface:'history',granted:new Set(['orders.view','orders.history']),now:new Date('2026-10-15T12:00:00Z')})
  assert.equal(result.readModel.counters.orders,1)
  assert.deepEqual(new Set(result.readModel.operationalOrders.map(o=>o.id)),new Set(ids.activeIds))
  assert.ok(result.readModel.operationalOrders.every(o=>!Object.hasOwn(o,'items')&&!Object.hasOwn(o,'client')))
  assert.equal(Object.hasOwn(result,'orders'),false)
})
