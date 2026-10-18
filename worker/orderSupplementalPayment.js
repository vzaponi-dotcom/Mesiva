import { auditContext, businessEvent } from './access/audit.js'
import { formatOrderDisplayNumber } from '../shared/orderDisplayNumber.js'
import { mapMovementRow } from './financeRepository.js'
import { deriveOrderSettlementBalance, PAYMENT_SETTLEMENT_SQL_SELECT } from './orderPaymentReadModel.js'
import { assertPaymentAllocationTotal, resolveReceivedDate, validatePaymentAllocations } from './paymentValidation.js'
import { readPaymentMethodExpectations, preparePolicyGuards, rethrowPolicyChange } from './operationalPolicyGuards.js'
import { loadOrderById } from './repositories.js'
import { hashSettingsPayload, prepareSettingsAssertion, clearSettingsAssertions } from './settingsTransactions.js'
import { centsToMoney } from './validation.js'

const fail = (status, code, message) => Object.assign(new Error(message), { status, code })
const conflict = () => fail(409, 'ORDER_SUPPLEMENTAL_CONFLICT', 'O saldo do pedido mudou. Atualize antes de cobrar novamente.')
const invalid = () => fail(400, 'VALIDATION_ERROR', 'Dados de cobrança complementar inválidos.')
const positive = n => Number.isSafeInteger(n) && n > 0
const nonnegative = n => Number.isSafeInteger(n) && n >= 0

function validateInput(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw invalid()
  const allowed = new Set(['mutationId','expectedContentRevision','expectedTotalCents','expectedNetReceivedCents','allocations','receivedDate'])
  if (Object.keys(raw).some(key => !allowed.has(key))) throw invalid()
  if (typeof raw.mutationId !== 'string' || !raw.mutationId.trim()
    || raw.mutationId.trim().length > 128 || raw.mutationId !== raw.mutationId.trim()
    || !nonnegative(raw.expectedContentRevision) || !positive(raw.expectedTotalCents)
    || !nonnegative(raw.expectedNetReceivedCents)) throw invalid()
  return {
    mutationId: raw.mutationId,
    expectedContentRevision: raw.expectedContentRevision,
    expectedTotalCents: raw.expectedTotalCents,
    expectedNetReceivedCents: raw.expectedNetReceivedCents,
    allocations: validatePaymentAllocations(raw.allocations),
    ...(raw.receivedDate !== undefined ? { receivedDate: raw.receivedDate } : {}),
  }
}

const stateSql = `SELECT o.id,o.order_number,o.client_name_snapshot,o.table_tab_id,
  o.status,o.total_cents,o.content_revision,p.id AS payment_id,
  ${PAYMENT_SETTLEMENT_SQL_SELECT}
  FROM orders o LEFT JOIN payments p
    ON p.business_id=o.business_id AND p.order_id=o.id
  WHERE o.business_id=? AND o.id=? LIMIT 1`

const mutationSql = `SELECT r.request_hash,r.result_json,e.id AS entry_id,
  e.receipt_id,e.amount_cents,e.created_at,
  pr.total_cents AS receipt_total_cents,pr.paid_at,pr.received_date
  FROM order_supplemental_mutation_receipts r
  JOIN order_settlement_entries e
    ON e.business_id=r.business_id AND e.order_id=r.order_id AND e.id=r.settlement_entry_id
  JOIN payment_receipts pr
    ON pr.business_id=e.business_id AND pr.id=e.receipt_id
  WHERE r.business_id=? AND r.order_id=? AND r.mutation_id=? LIMIT 1`

const storedMutation = (db,businessId,orderId,mutationId) =>
  db.prepare(mutationSql).bind(businessId,orderId,mutationId).first()

async function replay(db,businessId,orderId,record,hash) {
  if (record.request_hash !== hash) throw conflict()
  const allocationsResult = await db.prepare(`SELECT id,receipt_id,method_code,method_label,amount_cents,created_at
    FROM payment_allocations WHERE business_id=? AND receipt_id=? ORDER BY created_at,id`)
    .bind(businessId,record.receipt_id).all()
  const allocations = (allocationsResult.results || []).map(row=>({
    id:row.id, receiptId:row.receipt_id, methodCode:row.method_code,
    methodLabel:row.method_label, amountCents:row.amount_cents,
    amount:centsToMoney(row.amount_cents), createdAt:row.created_at,
  }))
  const movementResult=await db.prepare(`SELECT id,type,category,description,value_cents,source,order_id,payment_id,
    payment_method,movement_date,created_at,updated_at,receipt_id,payment_allocation_id
    FROM movements WHERE business_id=? AND receipt_id=? AND source='order-payment'
    ORDER BY created_at,id`).bind(businessId,record.receipt_id).all()
  return {
    entry:{id:record.entry_id,orderId,receiptId:record.receipt_id,amountCents:record.amount_cents,createdAt:record.created_at},
    receipt:{id:record.receipt_id,totalCents:record.receipt_total_cents,
      total:centsToMoney(record.receipt_total_cents),tableTabId:null,
      paidAt:record.paid_at,receivedDate:record.received_date??null,
      createdAt:record.created_at,allocations},
    allocations,
    movements:(movementResult.results||[]).map(mapMovementRow),
    order:await loadOrderById(db,businessId,orderId),
  }
}

// Financial settlement writer. HTTP routes are capability-gated; the UI can
// invoke this after saving an edit or later from A receber. No automatic bank
// transfer or reprint is performed. Commit all money/audit evidence atomically.
export async function registerOrderSupplementalPayment(db,businessId,orderId,raw,now=new Date()) {
  const input=validateInput(raw)
  const day=resolveReceivedDate(input.receivedDate,now)
  const requestHash=await hashSettingsPayload(input)
  const row=await db.prepare(stateSql).bind(businessId,orderId).first()
  if(!row)throw fail(404,'ORDER_NOT_FOUND','Pedido não encontrado.')
  const previous=await storedMutation(db,businessId,orderId,input.mutationId)
  if(previous)return replay(db,businessId,orderId,previous,requestHash)

  if(!['Em preparo','Finalizado'].includes(row.status) || !row.payment_id
    || row.content_revision!==input.expectedContentRevision
    || row.total_cents!==input.expectedTotalCents)throw conflict()
  let balance
  try {
    balance=deriveOrderSettlementBalance({
      totalCents:row.total_cents,grossReceivedCents:row.gross_received_cents,
      refundedCents:row.refunded_cents,
    })
  }catch {throw conflict()}
  if(balance.netReceivedCents!==input.expectedNetReceivedCents
    || balance.dueCents<=0 || balance.refundDueCents>0)throw conflict()
  const allocations=assertPaymentAllocationTotal(input.allocations,balance.dueCents)
  const methods=await readPaymentMethodExpectations(db,businessId,allocations.map(a=>a.methodCode))
  const labels=new Map(methods.methods.map(m=>[m.code,m.label]))
  const actor=auditContext(db,businessId)
  const name=typeof actor.displayName==='string' && actor.displayName.trim()
    ? actor.displayName.trim().slice(0,120):'Acesso legado'
  const at=now.toISOString()
  const transactionId=crypto.randomUUID(),receiptId=crypto.randomUUID(),entryId=crypto.randomUUID()
  const description=`${formatOrderDisplayNumber(row).replace('Pedido','Complemento pedido')} · ${row.client_name_snapshot}`

  // The snapshot is re-read under the same transaction lock, guarding against
  // editing, cancellation, full payment, another supplement, or a refund
  // between initial read and commit.
  const guard=prepareSettingsAssertion(db,transactionId,'supplemental-balance',
    `EXISTS(SELECT 1 FROM (
      SELECT o.id,o.status,o.content_revision,o.total_cents,o.business_id,
        p.id AS payment_id,${PAYMENT_SETTLEMENT_SQL_SELECT}
      FROM orders o LEFT JOIN payments p
        ON p.business_id=o.business_id AND p.order_id=o.id
      WHERE o.business_id=? AND o.id=?
    ) snapshot WHERE snapshot.status IN ('Em preparo','Finalizado')
      AND snapshot.content_revision=? AND snapshot.total_cents=?
      AND snapshot.payment_id=?
      AND snapshot.gross_received_cents>=snapshot.refunded_cents
      AND snapshot.gross_received_cents-snapshot.refunded_cents=?
      AND snapshot.total_cents-(snapshot.gross_received_cents-snapshot.refunded_cents)=?
      AND NOT EXISTS(SELECT 1 FROM table_reservations tr
        WHERE tr.business_id=snapshot.business_id AND tr.order_id=snapshot.id AND tr.status='reserved')
    )`,
    [businessId,orderId,input.expectedContentRevision,input.expectedTotalCents,
      row.payment_id,input.expectedNetReceivedCents,balance.dueCents])

  const allocationsRows=allocations.map(({methodCode,amountCents})=>({
    id:crypto.randomUUID(),businessId,receiptId,methodCode,
    methodLabel:labels.get(methodCode),amountCents,createdAt:at,
  }))
  const movementRows=allocationsRows.map(a=>({
    id:crypto.randomUUID(),type:'entrada',category:'Vendas',description,
    value_cents:a.amountCents,source:'order-payment',order_id:orderId,
    payment_id:null,payment_method:a.methodLabel,movement_date:day,
    created_at:at,updated_at:at,receipt_id:receiptId,payment_allocation_id:a.id,
  }))
  const statements=[
    ...preparePolicyGuards(db,businessId,{paymentMethods:methods},transactionId),
    guard,
    db.prepare(`INSERT INTO payment_receipts
      (id,business_id,table_tab_id,total_cents,paid_at,received_date,created_at)
      VALUES(?,?,NULL,?,?,?,?)`).bind(receiptId,businessId,balance.dueCents,at,day,at),
  ]
  for(const a of allocationsRows) {
    statements.push(
      db.prepare(`INSERT INTO payment_allocations
        (id,business_id,receipt_id,method_code,method_label,amount_cents,created_at)
        VALUES(?,?,?,?,?,?,?)`).bind(a.id,businessId,receiptId,a.methodCode,a.methodLabel,a.amountCents,at),
      db.prepare(`UPDATE business_payment_methods SET first_used_at=?
        WHERE business_id=? AND code=? AND first_used_at IS NULL`).bind(at,businessId,a.methodCode),
    )
  }
  for(const m of movementRows) statements.push(
    db.prepare(`INSERT INTO movements
      (id,business_id,type,category,description,value_cents,source,order_id,payment_id,
       payment_method,movement_date,created_at,updated_at,receipt_id,payment_allocation_id)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(m.id,businessId,m.type,m.category,m.description,m.value_cents,m.source,m.order_id,
        null,m.payment_method,m.movement_date,at,at,receiptId,m.payment_allocation_id),
  )
  statements.push(
    db.prepare(`INSERT INTO order_settlement_entries
      (id,business_id,order_id,kind,amount_cents,receipt_id,mutation_id,actor_user_id,actor_name,created_at)
      VALUES(?,?,?,'supplemental_payment',?,?,?,?,?,?)`)
      .bind(entryId,businessId,orderId,balance.dueCents,receiptId,input.mutationId,actor.userId||null,name,at),
    db.prepare(`INSERT INTO order_supplemental_mutation_receipts
      (business_id,order_id,mutation_id,request_hash,settlement_entry_id,result_json,created_at)
      VALUES(?,?,?,?,?,?,?)`).bind(businessId,orderId,input.mutationId,requestHash,
      entryId,JSON.stringify({entryId,receiptId,amountCents:balance.dueCents}),at),
    businessEvent(db,businessId,{action:'payment.supplemental-received',resourceType:'order',resourceId:orderId,now}),
    clearSettingsAssertions(db,transactionId),
  )
  try {
    await db.batch(statements)
  }catch(cause) {
    // An uncertain transport response may happen AFTER D1 commits. Confirm
    // the immutable receipt first, with the original hash, before deciding.
    const persisted=await storedMutation(db,businessId,orderId,input.mutationId)
    if(persisted)return replay(db,businessId,orderId,persisted,requestHash)
    if(String(cause?.message||'').includes('POLICY_CHANGED'))rethrowPolicyChange(cause)
    if(/SETTINGS_REVISION_CONFLICT|SETTINGS_INVALID|UNIQUE constraint|ORDER_SETTLEMENT/.test(String(cause?.message||'')))throw conflict()
    throw cause
  }
  const saved=await storedMutation(db,businessId,orderId,input.mutationId)
  if(!saved)throw fail(503,'ORDER_SUPPLEMENTAL_RESULT_UNAVAILABLE','Cobrança registrada. Consulte o pedido antes de tentar novamente.')
  return replay(db,businessId,orderId,saved,requestHash)
}
