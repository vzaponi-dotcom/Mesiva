import { auditContext, businessEvent } from './access/audit.js'
import { getBusinessDate } from '../shared/finance.js'
import { PAYMENT_SETTLEMENT_SQL_SELECT, deriveOrderSettlementBalance } from './orderPaymentReadModel.js'
import { readPaymentMethodExpectation, preparePolicyGuards, rethrowPolicyChange } from './operationalPolicyGuards.js'
import { prepareSettingsAssertion, clearSettingsAssertions, hashSettingsPayload } from './settingsTransactions.js'
import { loadOrderById } from './repositories.js'
import { mapMovementRow } from './financeRepository.js'
import { formatOrderDisplayNumber } from '../shared/orderDisplayNumber.js'
import { validatePaymentMethod } from './validation.js'

const failure=(status,code,message)=>Object.assign(new Error(message),{status,code})
const conflict=()=>failure(409,'ORDER_PARTIAL_REFUND_CONFLICT','O saldo a devolver foi alterado. Atualize o pedido antes de continuar.')
const invalid=()=>failure(400,'VALIDATION_ERROR','Dados da devolução inválidos.')
const validNonnegative=n=>Number.isSafeInteger(n)&&n>=0

function validate(raw) {
  const keys=['mutationId','amountCents','refundMethod','expectedContentRevision','expectedTotalCents','expectedNetReceivedCents']
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(k=>!keys.includes(k)))throw invalid()
  if(typeof raw.mutationId!=='string'||!raw.mutationId.trim()||raw.mutationId!==raw.mutationId.trim()
    ||raw.mutationId.length>128||!validNonnegative(raw.expectedContentRevision)
    ||!validNonnegative(raw.expectedTotalCents)||!validNonnegative(raw.expectedNetReceivedCents)
    ||!Number.isSafeInteger(raw.amountCents)||raw.amountCents<=0)throw invalid()
  const refundMethod=validatePaymentMethod(raw.refundMethod)
  return {...raw,refundMethod}
}

const snapshotSql=`SELECT o.id,o.order_number,o.client_name_snapshot,o.content_revision,
  o.total_cents,o.status,o.table_tab_id,p.id AS payment_id,
  ${PAYMENT_SETTLEMENT_SQL_SELECT}
  FROM orders o LEFT JOIN payments p
    ON p.business_id=o.business_id AND p.order_id=o.id
  WHERE o.id=? AND o.business_id=? LIMIT 1`
const readReceipt=(db,biz,id,key)=>db.prepare(`SELECT r.request_hash,e.id AS entry_id,e.movement_id,e.amount_cents,e.created_at
  FROM order_partial_refund_mutation_receipts r
  JOIN order_settlement_entries e
    ON e.business_id=r.business_id AND e.order_id=r.order_id
      AND e.id=r.settlement_entry_id AND e.kind='refund'
  WHERE r.business_id=? AND r.order_id=? AND r.mutation_id=? LIMIT 1`).bind(biz,id,key).first()
const movementSql=`SELECT id,type,category,description,value_cents,source,order_id,payment_id,
  payment_method,movement_date,created_at,updated_at,receipt_id,payment_allocation_id
  FROM movements WHERE business_id=? AND id=? AND source='order-edit-refund' LIMIT 1`

async function replay(db,businessId,orderId,receipt,hash) {
  if(receipt.request_hash!==hash)throw conflict()
  const movementRow=await db.prepare(movementSql).bind(businessId,receipt.movement_id).first()
  if(!movementRow)throw failure(503,'ORDER_PARTIAL_REFUND_RESULT_UNAVAILABLE','Verifique a devolução antes de tentar novamente.')
  return {
    entry:{id:receipt.entry_id,orderId,movementId:receipt.movement_id,
      amountCents:receipt.amount_cents,createdAt:receipt.created_at},
    movement:{...mapMovementRow(movementRow),valueCents:movementRow.value_cents},
    order:await loadOrderById(db,businessId,orderId),
  }
}

// Internal-only command. No HTTP/public UI until financial staging acceptance.
// The actual cash exit is manually confirmed; this is accounting evidence,
// not a bank transfer.
export async function registerOrderPartialRefund(db,businessId,orderId,raw,now=new Date()) {
  const input=validate(raw)
  const hash=await hashSettingsPayload(input)
  const row=await db.prepare(snapshotSql).bind(orderId,businessId).first()
  if(!row)throw failure(404,'ORDER_NOT_FOUND','Pedido não encontrado.')
  const previous=await readReceipt(db,businessId,orderId,input.mutationId)
  if(previous)return replay(db,businessId,orderId,previous,hash)
  if(!['Em preparo','Finalizado'].includes(row.status)
    ||!row.payment_id||row.content_revision!==input.expectedContentRevision
    ||row.total_cents!==input.expectedTotalCents)throw conflict()
  let balance
  try {
    balance=deriveOrderSettlementBalance({
      totalCents:row.total_cents,grossReceivedCents:row.gross_received_cents,
      refundedCents:row.refunded_cents,
    })
  }catch {throw conflict()}
  if(balance.netReceivedCents!==input.expectedNetReceivedCents
    ||balance.refundDueCents<input.amountCents ||balance.refundDueCents<=0)throw conflict()
  const methodExpectation=await readPaymentMethodExpectation(db,businessId,input.refundMethod)
  const actor=auditContext(db,businessId)
  const actorName=(actor.displayName||'Acesso legado').trim().slice(0,120)
  const id=crypto.randomUUID(),movementId=crypto.randomUUID(),tx=crypto.randomUUID()
  const at=now.toISOString(),day=getBusinessDate(now)
  const description=`${formatOrderDisplayNumber(row).replace('Pedido','Devolução pedido')} · ${row.client_name_snapshot}`
  const guard=prepareSettingsAssertion(db,tx,'refund-balance',
    `EXISTS (SELECT 1 FROM (
      SELECT o.id,o.business_id,o.status,o.content_revision,o.total_cents,
        p.id AS payment_id,${PAYMENT_SETTLEMENT_SQL_SELECT}
      FROM orders o LEFT JOIN payments p ON p.business_id=o.business_id AND p.order_id=o.id
      WHERE o.business_id=? AND o.id=?
    ) x WHERE x.status IN ('Em preparo','Finalizado')
      AND x.content_revision=? AND x.total_cents=? AND x.payment_id=?
      AND x.gross_received_cents>=x.refunded_cents
      AND x.gross_received_cents-x.refunded_cents=?
      AND x.gross_received_cents-x.refunded_cents-x.total_cents>=?
    )`,[businessId,orderId,input.expectedContentRevision,input.expectedTotalCents,row.payment_id,
      input.expectedNetReceivedCents,input.amountCents])
  const movement=db.prepare(`INSERT INTO movements
    (id,business_id,type,category,description,value_cents,source,order_id,payment_id,
      movement_date,created_at,payment_method,updated_at)
    VALUES(?,?,'saida','Estornos',?,?,'order-edit-refund',?,?,?,?,?,?)`)
    .bind(movementId,businessId,`${description} · ${input.refundMethod}`,input.amountCents,
      orderId,row.payment_id,day,at,input.refundMethod,at)
  const statements=[
    ...preparePolicyGuards(db,businessId,{paymentMethods:methodExpectation},tx),
    guard,movement,
    db.prepare(`INSERT INTO order_settlement_entries
      (id,business_id,order_id,kind,amount_cents,movement_id,mutation_id,actor_user_id,actor_name,created_at)
      VALUES(?,?,?,'refund',?,?,?,?,?,?)`).bind(id,businessId,orderId,input.amountCents,
      movementId,input.mutationId,actor.userId||null,actorName,at),
    db.prepare(`INSERT INTO order_partial_refund_mutation_receipts
      (business_id,order_id,mutation_id,request_hash,settlement_entry_id,result_json,created_at)
      VALUES(?,?,?,?,?,?,?)`).bind(businessId,orderId,input.mutationId,hash,id,
      JSON.stringify({entryId:id,movementId,amountCents:input.amountCents}),at),
    businessEvent(db,businessId,{action:'payment.partial-refunded',resourceType:'order',resourceId:orderId,now}),
    clearSettingsAssertions(db,tx),
  ]
  try {await db.batch(statements)}
  catch(err){
    const persisted=await readReceipt(db,businessId,orderId,input.mutationId)
    if(persisted)return replay(db,businessId,orderId,persisted,hash)
    if(String(err?.message||'').includes('POLICY_CHANGED'))rethrowPolicyChange(err)
    if(/SETTINGS_INVALID|UNIQUE constraint|ORDER_SETTLEMENT|ORDER_PARTIAL_REFUND/.test(String(err?.message||'')))throw conflict()
    throw err
  }
  const saved=await readReceipt(db,businessId,orderId,input.mutationId)
  if(!saved)throw failure(503,'ORDER_PARTIAL_REFUND_RESULT_UNAVAILABLE','Verifique a devolução antes de tentar novamente.')
  return replay(db,businessId,orderId,saved,hash)
}
