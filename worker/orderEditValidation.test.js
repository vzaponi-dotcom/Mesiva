import test from 'node:test'
import assert from 'node:assert/strict'
import { validateOrderEditInput, buildOrderEdit } from './orderEditValidation.js'

const order = {
 id:'order-1', type:'Entrega',status:'Em preparo',subtotal_cents:8000,delivery_fee_cents:0,
 adjustment_type:'none', adjustment_mode:'fixed', adjustment_value:0,
 adjustment_amount_cents:0, adjustment_reason:'', total_cents:8000,
}
const items = [
 {id:'line-a',order_id:'order-1',product_id:'p-old',name_snapshot:'Antigo',category_snapshot:'Bebidas',size_snapshot:'Un',
 quantity:2,unit_price_cents:4000,catalog_price_cents:4000,price_reason:'',note:'sem gelo',created_at:'2026-10-01T10:00:00Z'},
]
const catalog = new Map([
 ['p-old',{id:'p-old',active:0,name:'Renomeado',category:'Bebidas',size:'P',price_cents:9900}],
 ['p-new',{id:'p-new',active:1,name:'Nova bebida',category:'Bebidas',size:'',price_cents:1500}],
 ['p-disabled',{id:'p-disabled',active:0,name:'Indisponível',category:'Bebidas',price_cents:300}],
])
const evaluate = (payload,overrides={}) => buildOrderEdit({
 order:{...order,...overrides.order},existingItems:overrides.items||items,catalogProducts:overrides.catalog||catalog,
 input:validateOrderEditInput(payload),allowAdjustment:overrides.allowAdjustment??true,
})
const update = (overrides={}) => ({expectedContentRevision:0,mutationId:'edit-key-1',
 items:[{id:'line-a',quantity:2,note:'sem gelo'}],...overrides})
test('old catalog prices survive item quantity and catalog changes with stable IDs',()=>{
 const out=evaluate(update({items:[{id:'line-a',quantity:3,note:'sem gelo'}]}))
 assert.equal(out.totals.totalCents,12000)
 assert.equal(out.items[0].id,'line-a')
 assert.equal(out.items[0].unit_price_cents,4000)
 assert.equal(out.items[0].name_snapshot,'Antigo')
 assert.equal(out.changes.items[0].before.quantity,2)
 assert.equal(out.changes.items[0].after.quantity,3)
})
test('new products use server prices, and repeated products are distinct editable lines',()=>{
 const out=evaluate(update({items:[{id:'line-a',quantity:2,note:'sem gelo'},{productId:'p-new',quantity:1,note:''},{productId:'p-new',quantity:2,note:'sem gelo'}]}))
 assert.equal(out.totals.totalCents,12500)
 assert.equal(out.items.length,3)
 assert.equal(out.items[1].unit_price_cents,1500)
 assert.equal(out.items[1].id,null)
 assert.deepEqual(out.changes.items.filter(x=>x.kind==='added').map(x=>x.after.quantity),[1,2])
 assert.throws(()=>evaluate(update({items:[{productId:'p-disabled',quantity:1}]})),{status:404,code:'PRODUCT_NOT_FOUND'})
})
test('reordering existing lines and normalized equivalent notes produce no operational change',()=>{
 const both=[...items,{...items[0],id:'line-b',product_id:'p-other',quantity:1,note:'com gelo'}]
 const out=evaluate(update({items:[{id:'line-b',quantity:1,note:' com  gelo '},{id:'line-a',quantity:2,note:' sem  gelo '}]}),{items:both,order:{subtotal_cents:12000,total_cents:12000}})
 assert.equal(out.changed,false)
 assert.deepEqual(out.changes.items,[])
})
test('reject unknown or foreign line IDs, counterfeit existing product and duplicate reuse',()=>{
 assert.throws(()=>evaluate(update({items:[{id:'other-order-line',quantity:1}]})),{status:400,code:'ORDER_EDIT_INVALID'})
 assert.throws(()=>evaluate(update({items:[{id:'line-a',productId:'p-new',quantity:1}]})),{status:400,code:'ORDER_EDIT_INVALID'})
 assert.throws(()=>evaluate(update({items:[{id:'line-a',quantity:1},{id:'line-a',quantity:1}]})),{status:400,code:'ORDER_EDIT_INVALID'})
})
test('canonical fee and adjustment recalculate server totals, requiring discount permission',()=>{
 const out=evaluate(update({deliveryFee:5,adjustment:{type:'discount',mode:'fixed',value:12,reason:'Cortesia'}}))
 assert.equal(out.totals.subtotalCents,8000)
 assert.equal(out.totals.adjustmentAmountCents,1200)
 assert.equal(out.totals.totalCents,7300)
 assert.equal(out.adjustment.storedValue,1200)
 assert.throws(()=>evaluate(update({adjustment:{type:'discount',value:1}}),{allowAdjustment:false}),{status:403,code:'FORBIDDEN'})
 assert.throws(()=>evaluate(update({deliveryFee:-5})),{status:400})
 assert.throws(()=>evaluate(update({deliveryFee:5}),{order:{type:'Retirada',delivery_fee_cents:0}}),{status:400})
})
test('request rejects lifecycle/payment/identity fields and bad quantities, no zero-item order',()=>{
 for(const payload of [
  update({items:[]}),update({type:'Retirada'}),update({orderDate:'2026-10-11'}),
  update({paymentAllocations:[{methodCode:'pix',amountCents:100}]}),
  update({tableTabId:'evil'}),update({totalCents:0}),
  update({items:[{id:'line-a',quantity:0}]}),update({items:[{id:'line-a',quantity:1.5}]}),
 ]) assert.throws(()=>evaluate(payload),{status:400})
 assert.throws(()=>evaluate(update(),{order:{status:'Finalizado'}}),{status:409})
 assert.throws(()=>evaluate(update(),{order:{status:'Cancelado'}}),{status:409})
})
test('payload requires stable content revision and mutation ID',()=>{
 for(const payload of [
  update({expectedContentRevision:-1}),update({expectedContentRevision:0.2}),
  update({mutationId:' '}),update({mutationId:'a'.repeat(129)}),
 ]) assert.throws(()=>validateOrderEditInput(payload),{status:400})
})
