import test from 'node:test'
import assert from 'node:assert/strict'
const modulePromise=import('./operational-read-d1-benchmark.mjs').catch(()=>({}))
const query=()=>({sql:'SELECT id FROM orders WHERE business_id=?',values:['amor-e-sabor'],rows_read:8,rows_written:0})
const sample=(reads=8,count=1)=>({rows_read:reads,rows_written:0,returnedCount:count,tenantScoped:true,queries:[{...query(),rows_read:reads}]})
function setReads(sample,reads){sample.rows_read=reads;sample.queries[0].rows_read=reads}
function report(){return {
  schemaVersion:43,fixture:{activeOrders:20,itemsPerOrder:5,historySizes:[1000,10000]},
  baseline:{empty:{tv:sample(8,0)},small:{tv:sample(12000,20)},large:{tv:sample(120000,20)}},
  after:{empty:{tv:sample(8,0),byIds:{...sample(0,0),queries:[]}},small:{tv:sample(240,20),byIds:sample(16)},large:{tv:sample(240,20),byIds:sample(16)}},
  queryPlans:{tv:['SEARCH o USING INDEX orders_business_active_created_idx (business_id=?)','SEARCH i USING INDEX order_items_business_order_created_idx (business_id=? AND order_id=?)'],byIds:['SEARCH o USING INDEX orders_business_id_id_unique (business_id=? AND id=?)','SEARCH order_items USING INDEX order_items_business_order_created_idx (business_id=? AND order_id=?)']},
}}
async function validate(value){
  const module=await modulePromise
  assert.equal(typeof module.assertOperationalReadBudget,'function','missing assertOperationalReadBudget')
  return module.assertOperationalReadBudget(value)
}

test('read budget accepts bounded candidates and no-query empty ID reads',async()=>{
  assert.equal(await validate(report()),true)
})
for(const [name,mutate,message] of [
  ['TV scans beyond candidate budget',r=>{setReads(r.after.large.tv,2000)},/TV|read budget/],
  ['point read exceeds budget',r=>{setReads(r.after.large.byIds,201)},/IDs|point/],
  ['empty TV exceeds budget',r=>{setReads(r.after.empty.tv,101)},/empty|vazia/],
  ['read performs writes',r=>{r.after.small.tv.rows_written=1},/writes|escritas/],
  ['history growth multiplies reads',r=>{setReads(r.after.large.tv,900)},/history|histórico/],
  ['unscoped tenant sample',r=>{r.after.large.byIds.tenantScoped=false},/tenant|empresa/],
  ['missing captured TV query',r=>{r.after.empty.tv.queries=[]},/capture|captur/],
  ['empty IDs unexpectedly query',r=>{r.after.empty.byIds.queries=[query()]},/empty IDs|IDs vazios/],
  ['legacy business item scan',r=>{r.queryPlans.tv=['SEARCH i USING INDEX order_items_business_idx (business_id=?)']},/plan|plano/],
  ['missing point-read index plan',r=>{r.queryPlans.byIds=[]},/plan|plano/],
  ['missing metrics',r=>{delete r.after.small.tv.rows_read},/metric|métrica/],
  ['incorrect fixture candidate count',r=>{r.after.large.tv.returnedCount=0},/candidate|candidato/],
])test(`read budget rejects ${name}`,async()=>{
  const value=report();mutate(value)
  await assert.rejects(validate(value),message)
})

test('TV equivalence matches orders and items independently of concurrent completion order',async()=>{
  const module=await modulePromise
  assert.equal(typeof module.assertSameTvReads,'function','missing assertSameTvReads')
  const orders={sql:'SELECT id FROM orders',results:[{id:'one',status:'Em preparo'}]}
  const beforeItems={sql:'SELECT i.order_id FROM order_items i INNER JOIN orders o',results:[{order_id:'one',quantity:1}]}
  const afterItems={...beforeItems,sql:'SELECT i.order_id FROM orders o CROSS JOIN order_items i'}
  assert.doesNotThrow(()=>module.assertSameTvReads([orders,beforeItems],[afterItems,orders]))
  assert.throws(()=>module.assertSameTvReads([orders,beforeItems],[{...afterItems,results:[]},orders]),/TV read contract differs/)
})

test('scope check accepts business-owned settings and rejects foreign or unscoped reads',async()=>{
  const module=await modulePromise
  assert.equal(typeof module.isScopedOperationalRead,'function','missing isScopedOperationalRead')
  assert.equal(module.isScopedOperationalRead('SELECT h.revision FROM businesses b LEFT JOIN business_operation_settings h ON h.business_id=b.id WHERE b.id = ?',['own'],'own'),true)
  assert.equal(module.isScopedOperationalRead('SELECT id FROM orders WHERE business_id=?',['own'],'own'),true)
  assert.equal(module.isScopedOperationalRead('SELECT id FROM orders WHERE business_id=?',['foreign'],'own'),false)
  assert.equal(module.isScopedOperationalRead('SELECT id FROM orders WHERE ? IS NOT NULL',['own'],'own'),false)
})

test('empty TV candidate budget accounts separately for unchanged schema guard overhead',async()=>{
  const value=report()
  const metadata={sql:'SELECT h.revision FROM businesses b LEFT JOIN business_operation_settings h ON h.business_id=b.id WHERE b.id=?',values:['amor-e-sabor'],rows_read:353,rows_written:0}
  value.baseline.empty={tv:{...sample(353,0),queries:[metadata]}}
  value.after.empty.tv={...sample(354,0),queries:[metadata,{...query(),rows_read:1}]}
  assert.equal(await validate(value),true)
})

test('read budget rejects growth of fixed schema overhead separately from candidates',async()=>{
  const value=report()
  value.after.empty.tv={...sample(100,0),queries:[{sql:'SELECT h.revision FROM businesses b LEFT JOIN business_operation_settings h ON h.business_id=b.id WHERE b.id=?',values:['amor-e-sabor'],rows_read:100,rows_written:0}]}
  await assert.rejects(validate(value),/schema overhead/)
})
