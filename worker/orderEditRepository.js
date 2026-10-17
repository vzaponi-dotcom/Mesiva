import { auditContext, businessEvent } from './access/audit.js'
import { buildOrderEdit, validateOrderEditInput } from './orderEditValidation.js'
import { loadOrderById } from './repositories.js'
import { PAYMENT_SETTLEMENT_SQL_SELECT, mapOrderPaymentFields } from './orderPaymentReadModel.js'
import { clearSettingsAssertions, hashSettingsPayload, prepareSettingsAssertion } from './settingsTransactions.js'

const failure = (status,code,message) => Object.assign(new Error(message),{status,code})
const changedConflict = () => failure(409,'ORDER_EDIT_CONFLICT','O pedido mudou. Atualize e confira os itens antes de salvar.')
const rows = result => Array.isArray(result?.results) ? result.results : []
const getReceipt = (db,businessId,orderId,mutationId) => db.prepare(
  'SELECT request_hash,result_revision,changed,result_json FROM order_edit_mutation_receipts WHERE business_id=? AND order_id=? AND mutation_id=?'
).bind(businessId,orderId,mutationId).first()

async function receiptResponse(db,businessId,orderId,receipt,hash) {
  if (receipt.request_hash !== hash) throw changedConflict()
  const order=await loadOrderById(db,businessId,orderId)
  // The saved decision/revision is stable even if a later unrelated revision exists.
  return {order,changed:Boolean(receipt.changed),contentRevision:Number(receipt.result_revision)}
}

// This owns the mutation; it never calls checkout/createOrder and never creates
// payments, receipts, financial movements, automatic or manual printing jobs.
export async function updateExistingOrder(db,businessId,orderId,raw,options={},now=new Date()) {
  const input=validateOrderEditInput(raw)
  const hash=await hashSettingsPayload({
    expectedContentRevision:input.expectedContentRevision,mutationId:input.mutationId,
    items:input.items,deliveryFee:input.deliveryFee===undefined?null:input.deliveryFee,
    adjustment:input.adjustment===undefined?null:input.adjustment,
  })
  const existing=await getReceipt(db,businessId,orderId,input.mutationId)
  if(existing)return receiptResponse(db,businessId,orderId,existing,hash)

  const order=await db.prepare(
    'SELECT o.*,tr.status AS table_reservation_status FROM orders o '+
    'LEFT JOIN table_reservations tr ON tr.business_id=o.business_id AND tr.order_id=o.id '+
    'WHERE o.business_id=? AND o.id=? LIMIT 1'
  ).bind(businessId,orderId).first()
  if(!order)throw failure(404,'ORDER_NOT_FOUND','Pedido não encontrado.')
  if(order.status!=='Em preparo'||order.table_reservation_status==='reserved')
    throw failure(409,'ORDER_NOT_EDITABLE','Este pedido não está disponível para edição.')
  if(Number(order.content_revision)!==input.expectedContentRevision)throw changedConflict()

  const oldItems=rows(await db.prepare(
    'SELECT * FROM order_items WHERE business_id=? AND order_id=? ORDER BY created_at ASC,id ASC'
  ).bind(businessId,orderId).all())
  const products=new Map()
  for(const item of input.items.filter(item=>!item.id)) {
    if(products.has(item.productId))continue
    const product=await db.prepare('SELECT * FROM products WHERE business_id=? AND id=? LIMIT 1')
      .bind(businessId,item.productId).first()
    if(product)products.set(item.productId,product)
  }
  const plan=buildOrderEdit({order,existingItems:oldItems,catalogProducts:products,input,
    allowAdjustment:options.allowAdjustment===true})
  const payment=await db.prepare(
    'SELECT amount_cents FROM payments WHERE business_id=? AND order_id=? LIMIT 1'
  ).bind(businessId,orderId).first()
  // Financial balances are read before saving so a concurrent settlement
  // cannot be silently merged into an order-content edit.
  const financial=await db.prepare(`SELECT p.id AS payment_id,${PAYMENT_SETTLEMENT_SQL_SELECT}
    FROM orders o LEFT JOIN payments p
      ON p.business_id=o.business_id AND p.order_id=o.id
    WHERE o.business_id=? AND o.id=? LIMIT 1`).bind(businessId,orderId).first()
  if (!financial || Number(financial.gross_received_cents) < Number(financial.refunded_cents)) throw changedConflict()


  // Preserve printed/claimed evidence. Only an untouched, zero-copy pending
  // automatic job is eligible for a snapshot change with the same transaction.
  const queued=plan.changed ? await db.prepare(
    "SELECT id,status,copies_requested,copies_printed,snapshot_json FROM print_jobs "+
    "WHERE business_id=? AND order_id=? AND type='order' AND trigger='automatic' LIMIT 1"
  ).bind(businessId,orderId).first() : null
  const updateQueued=queued?.status==='pending' && Number(queued.copies_printed)===0
  let nextSnapshot=null
  if(updateQueued) {
    const before=JSON.parse(queued.snapshot_json)
    nextSnapshot=JSON.stringify({
      ...before,
      payment:{...before.payment,status:mapOrderPaymentFields({...financial,
        total_cents:plan.totals.totalCents}).paymentStatus},
      items:plan.items.map(item=>({
        name:item.name_snapshot, presentation:item.size_snapshot || '',
        quantity:item.quantity,note:item.note || '',
        unitPriceCents:item.unit_price_cents,
        lineTotalCents:item.quantity*item.unit_price_cents,
      })),
      financial:{
        ...before.financial,subtotalCents:plan.totals.subtotalCents,
        deliveryFeeCents:plan.deliveryFeeCents,
        adjustment:{
          type:plan.adjustment.type,amountCents:plan.totals.adjustmentAmountCents,
          reason:plan.adjustment.reason || '',
        },
        totalCents:plan.totals.totalCents,
      },
    })
  }

  const actor=auditContext(db,businessId)
  const at=now.toISOString(),revision=Number(order.content_revision)+(plan.changed?1:0)
  const transactionId=crypto.randomUUID()
  const guard=prepareSettingsAssertion(db,transactionId,'revision',
    `EXISTS(SELECT 1 FROM (
      SELECT o.business_id,o.id,o.status,o.content_revision,o.total_cents,
        p.amount_cents AS paid_amount_cents,
        ${PAYMENT_SETTLEMENT_SQL_SELECT}
      FROM orders o LEFT JOIN payments p ON p.business_id=o.business_id AND p.order_id=o.id
      WHERE o.business_id=? AND o.id=?
    ) snapshot
      WHERE snapshot.status='Em preparo'
        AND snapshot.content_revision=? AND snapshot.total_cents=?
        AND COALESCE(snapshot.paid_amount_cents,0)=?
        AND snapshot.gross_received_cents=?
        AND snapshot.refunded_cents=?
        AND NOT EXISTS(SELECT 1 FROM table_reservations tr
          WHERE tr.business_id=snapshot.business_id AND tr.order_id=snapshot.id AND tr.status='reserved')
    )`,
    [businessId,orderId,input.expectedContentRevision,Number(order.total_cents),
      Number(payment?.amount_cents||0),Number(financial.gross_received_cents),Number(financial.refunded_cents)])
  const statements=[guard]
  for(const [index,productId] of [...new Set(input.items.filter(x=>!x.id).map(x=>x.productId))].entries()){
    const item=products.get(productId)
    statements.push(prepareSettingsAssertion(db,transactionId,'product-'+index,
      'EXISTS(SELECT 1 FROM products WHERE business_id=? AND id=? AND active=1 AND price_cents=?)',
      [businessId,productId,Number(item?.price_cents??-1)]))
  }
  if(updateQueued) {
    statements.push(prepareSettingsAssertion(db,transactionId,'automatic-print',
      "EXISTS(SELECT 1 FROM print_jobs WHERE id=? AND business_id=? AND order_id=? "+
      "AND type='order' AND trigger='automatic' AND status='pending' "+
      "AND copies_printed=0 AND copies_requested=? AND snapshot_json=?)",
      [queued.id,businessId,orderId,Number(queued.copies_requested),queued.snapshot_json]))
  }
  if(plan.changed){
    statements.push(db.prepare(
      'UPDATE orders SET subtotal_cents=?,delivery_fee_cents=?,adjustment_type=?,adjustment_mode=?, '+
      'adjustment_value=?,adjustment_amount_cents=?,adjustment_reason=?,total_cents=?,content_revision=content_revision+1,last_edited_at=? '+
      "WHERE business_id=? AND id=? AND status='Em preparo' AND content_revision=?"
    ).bind(plan.totals.subtotalCents,plan.deliveryFeeCents,plan.adjustment.type,
      plan.adjustment.mode,plan.adjustment.storedValue,plan.totals.adjustmentAmountCents,
      plan.adjustment.reason,plan.totals.totalCents,at,businessId,orderId,input.expectedContentRevision))
    const kept=new Set()
    for(const item of plan.items){
      if(item.id){
        kept.add(item.id)
        statements.push(db.prepare('UPDATE order_items SET quantity=?,note=? WHERE business_id=? AND order_id=? AND id=?')
          .bind(item.quantity,item.note,businessId,orderId,item.id))
      }else{
        item.id=crypto.randomUUID()
        const change=plan.changes.items.find(c=>c.kind==='added'&&c.after.id===null&&c.after.productId===item.product_id&&c.after.note===item.note&&c.after.quantity===item.quantity)
        if(change)change.after.id=item.id
        statements.push(db.prepare(
          'INSERT INTO order_items(id,business_id,order_id,product_id,name_snapshot,category_snapshot,size_snapshot, '+
          'quantity,catalog_price_cents,unit_price_cents,price_reason,note,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)'
        ).bind(item.id,businessId,orderId,item.product_id,item.name_snapshot,
          item.category_snapshot,item.size_snapshot,item.quantity,item.catalog_price_cents,
          item.unit_price_cents,item.price_reason||'',item.note,at))
      }
    }
    for(const old of oldItems.filter(x=>!kept.has(x.id))) {
      statements.push(db.prepare('DELETE FROM order_items WHERE business_id=? AND order_id=? AND id=?')
        .bind(businessId,orderId,old.id))
    }
    statements.push(db.prepare(
      'INSERT INTO order_edit_revisions(id,business_id,order_id,revision,actor_user_id,actor_name,edited_at, '+
      'before_total_cents,after_total_cents,changes_json) VALUES(?,?,?,?,?,?,?,?,?,?)'
    ).bind(crypto.randomUUID(),businessId,orderId,revision,actor.userId||null,
      actor.displayName||'Acesso legado',at,Number(order.total_cents),plan.totals.totalCents,
      JSON.stringify(plan.changes)))
    if(updateQueued){
      statements.push(db.prepare(
        "UPDATE print_jobs SET snapshot_json=? WHERE id=? AND business_id=? AND order_id=? "+
        "AND type='order' AND trigger='automatic' AND status='pending' AND copies_printed=0"
      ).bind(nextSnapshot,queued.id,businessId,orderId))
    }
    statements.push(businessEvent(db,businessId,{action:'order.edited',resourceType:'order',resourceId:orderId,now}))
  }
  statements.push(db.prepare(
    'INSERT INTO order_edit_mutation_receipts(business_id,order_id,mutation_id,request_hash,result_revision,changed,result_json,created_at) '+
    'VALUES(?,?,?,?,?,?,?,?)'
  ).bind(businessId,orderId,input.mutationId,hash,revision,plan.changed?1:0,
    JSON.stringify({contentRevision:revision,changed:plan.changed}),at))
  statements.push(clearSettingsAssertions(db,transactionId))
  try{
    await db.batch(statements)
  }catch(cause){
    const persisted=await getReceipt(db,businessId,orderId,input.mutationId)
    if(persisted)return receiptResponse(db,businessId,orderId,persisted,hash)
    if(/SETTINGS_REVISION_CONFLICT|SETTINGS_INVALID|POLICY_CHANGED|UNIQUE constraint/.test(String(cause?.message)))
      throw changedConflict()
    throw cause
  }
  return {order:await loadOrderById(db,businessId,orderId),changed:plan.changed,contentRevision:revision}
}
