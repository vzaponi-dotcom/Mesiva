import { businessEvent } from './access/audit.js'
import { getBusinessDate } from '../shared/finance.js'
import { formatOrderDisplayNumber } from '../shared/orderDisplayNumber.js'
import { mapMovementRow } from './financeRepository.js'
import { assertPaymentAllocationTotal, validateReceivableOrderIds } from './paymentValidation.js'
import { preparePolicyGuards, readPaymentMethodExpectations, rethrowPolicyChange } from './operationalPolicyGuards.js'
import { closeTableTabIfSettled, loadOrderById, mapTableTabRow } from './repositories.js'
import { clearSettingsAssertions, prepareSettingsAssertion } from './settingsTransactions.js'
import { centsToMoney } from './validation.js'

const repositoryError = (status, code, message) => Object.assign(new Error(message), { status, code })
const resultRows = (result) => Array.isArray(result?.results) ? result.results : []

const mapAllocation = (row) => ({
  id: row.id,
  receiptId: row.receipt_id,
  methodCode: row.method_code,
  methodLabel: row.method_label,
  amountCents: row.amount_cents,
  amount: centsToMoney(row.amount_cents),
  createdAt: row.created_at,
})

const mapReceipt = (row, allocations) => ({
  id: row.id,
  totalCents: row.total_cents,
  total: centsToMoney(row.total_cents),
  tableTabId: row.table_tab_id ?? null,
  paidAt: row.paid_at,
  createdAt: row.created_at,
  allocations,
})

export async function registerOrderPayment(db, businessId, orderId, rawAllocations, now = new Date()) {
  const orderRow = await db.prepare(`SELECT o.id, o.order_number, o.status, o.client_name_snapshot,
    o.table_tab_id, o.total_cents, p.id AS payment_id
    FROM orders o
    LEFT JOIN payments p ON p.order_id = o.id AND p.business_id = o.business_id
    WHERE o.id = ? AND o.business_id = ? LIMIT 1`).bind(orderId, businessId).first()
  if (!orderRow) throw repositoryError(404, 'ORDER_NOT_FOUND', 'Pedido não encontrado.')
  if (orderRow.status === 'Cancelado') throw repositoryError(409, 'ORDER_ALREADY_CANCELLED', 'Pedido cancelado não pode receber pagamento.')
  if (orderRow.payment_id) throw repositoryError(409, 'ORDER_ALREADY_PAID', 'Este pedido já foi pago.')
  if (orderRow.table_tab_id) throw repositoryError(409, 'TABLE_TAB_PAYMENT_REQUIRED', 'Pedidos de comanda devem ser recebidos pela comanda.')

  const allocations = assertPaymentAllocationTotal(rawAllocations, orderRow.total_cents)
  const paymentExpectation = await readPaymentMethodExpectations(db, businessId, allocations.map(({ methodCode }) => methodCode))
  const labels = new Map(paymentExpectation.methods.map(({ code, label }) => [code, label]))
  const paidAt = now.toISOString()
  const movementDate = getBusinessDate(now)
  const receiptId = crypto.randomUUID()
  const paymentId = crypto.randomUUID()
  const policyTxId = crypto.randomUUID()
  const receiptRow = {
    id: receiptId,
    business_id: businessId,
    table_tab_id: null,
    total_cents: orderRow.total_cents,
    paid_at: paidAt,
    created_at: paidAt,
  }
  const allocationRows = allocations.map(({ methodCode, amountCents }) => ({
    id: crypto.randomUUID(),
    business_id: businessId,
    receipt_id: receiptId,
    method_code: methodCode,
    method_label: labels.get(methodCode),
    amount_cents: amountCents,
    created_at: paidAt,
  }))
  const description = `${formatOrderDisplayNumber(orderRow).replace('Pedido', 'Pagamento pedido')} · ${orderRow.client_name_snapshot}`
  const movementRows = allocationRows.map((allocation) => ({
    id: crypto.randomUUID(),
    type: 'entrada',
    category: 'Vendas',
    description,
    value_cents: allocation.amount_cents,
    source: 'order-payment',
    order_id: orderId,
    payment_id: paymentId,
    payment_method: allocation.method_label,
    movement_date: movementDate,
    created_at: paidAt,
    updated_at: paidAt,
    receipt_id: receiptId,
    payment_allocation_id: allocation.id,
  }))

  const statements = [
    ...preparePolicyGuards(db, businessId, { paymentMethods: paymentExpectation }, policyTxId),
    db.prepare(`INSERT INTO payment_receipts
      (id, business_id, table_tab_id, total_cents, paid_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`).bind(receiptId, businessId, null, orderRow.total_cents, paidAt, paidAt),
  ]
  for (const allocation of allocationRows) {
    statements.push(
      db.prepare(`INSERT INTO payment_allocations
        (id, business_id, receipt_id, method_code, method_label, amount_cents, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(
        allocation.id, businessId, receiptId, allocation.method_code, allocation.method_label, allocation.amount_cents, paidAt,
      ),
      db.prepare(`UPDATE business_payment_methods SET first_used_at = ?
        WHERE business_id = ? AND code = ? AND first_used_at IS NULL`).bind(paidAt, businessId, allocation.method_code),
    )
  }
  statements.push(
    db.prepare(`INSERT INTO payments
      (id, business_id, order_id, receipt_id, amount_cents, method, paid_at, created_at)
      VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`).bind(paymentId, businessId, orderId, receiptId, orderRow.total_cents, paidAt, paidAt),
  )
  for (const movement of movementRows) {
    statements.push(db.prepare(`INSERT INTO movements
      (id, business_id, type, category, description, value_cents, source, order_id, payment_id,
       movement_date, created_at, payment_method, updated_at, receipt_id, payment_allocation_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      movement.id, businessId, movement.type, movement.category, movement.description, movement.value_cents,
      movement.source, orderId, paymentId, movementDate, paidAt, movement.payment_method, paidAt,
      receiptId, movement.payment_allocation_id,
    ))
  }
  statements.push(clearSettingsAssertions(db, policyTxId))

  try {
    await db.batch([...statements,businessEvent(db,businessId,{action:'payment.received',resourceType:'order',resourceId:orderId,now})])
  } catch (error) {
    const existingPayment = await db.prepare('SELECT id FROM payments WHERE order_id = ? AND business_id = ? LIMIT 1')
      .bind(orderId, businessId).first()
    if (existingPayment) throw repositoryError(409, 'ORDER_ALREADY_PAID', 'Este pedido já foi pago.')
    if (String(error?.message || '').includes('POLICY_CHANGED')) rethrowPolicyChange(error)
    throw error
  }

  const resolvedAllocations = allocationRows.map(mapAllocation)
  const receipt = mapReceipt(receiptRow, resolvedAllocations)
  const payment = { id: paymentId, orderId, receiptId, amount: centsToMoney(orderRow.total_cents), paidAt }
  const tableTab = await closeTableTabIfSettled(db, businessId, orderRow.table_tab_id, now)
  return {
    receipt,
    allocations: resolvedAllocations,
    payment,
    order: await loadOrderById(db, businessId, orderId),
    movements: movementRows.map(mapMovementRow),
    tableTab,
  }
}


const clientReceivablesConflict = () => repositoryError(
  409,
  'CLIENT_RECEIVABLES_PAYMENT_CONFLICT',
  'Os pedidos selecionados foram alterados. Atualize os dados e tente novamente.',
)

const CLIENT_RECEIVABLES_QUERY_CHUNK_SIZE = 20
const chunkReceivableOrders = (items, size = CLIENT_RECEIVABLES_QUERY_CHUNK_SIZE) => {
  const chunks = []
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size))
  return chunks
}

export async function registerClientOrdersPayment(
  db,
  businessId,
  clientId,
  rawOrderIds,
  rawAllocations,
  now = new Date(),
) {
  const orderIds = validateReceivableOrderIds(rawOrderIds)
  const normalizedClientId = typeof clientId === 'string' ? clientId.trim() : ''
  if (!normalizedClientId) throw repositoryError(400, 'VALIDATION_ERROR', 'Cliente inválido para recebimento.')

  const clientRow = await db.prepare('SELECT id, name FROM clients WHERE id = ? AND business_id = ? LIMIT 1')
    .bind(normalizedClientId, businessId).first()
  if (!clientRow) throw repositoryError(404, 'CLIENT_NOT_FOUND', 'Cliente não encontrado.')

  const selectedById = new Map()
  for (const idChunk of chunkReceivableOrders(orderIds)) {
    const placeholders = idChunk.map(() => '?').join(', ')
    const selectedResult = await db.prepare(`SELECT o.id, o.client_id, o.customer_identity_type, o.table_tab_id,
        o.status, o.total_cents, o.content_revision, o.created_at, p.id AS payment_id
      FROM orders o
      LEFT JOIN payments p ON p.order_id = o.id AND p.business_id = o.business_id
      WHERE o.business_id = ? AND o.id IN (${placeholders})`)
      .bind(businessId, ...idChunk).all()
    for (const row of resultRows(selectedResult)) selectedById.set(row.id, row)
  }
  if (selectedById.size !== orderIds.length) throw clientReceivablesConflict()

  const selected = orderIds.map((id) => selectedById.get(id))
  if (selected.some((order) => (
    !order
    || order.client_id !== normalizedClientId
    || order.customer_identity_type !== 'registered_client'
    || order.table_tab_id != null
    || order.status === 'Cancelado'
    || order.payment_id
    || !Number.isSafeInteger(Number(order.total_cents))
    || Number(order.total_cents) <= 0
  ))) throw clientReceivablesConflict()

  let authoritativeTotalCents = 0
  for (const order of selected) {
    const amount = Number(order.total_cents)
    if (authoritativeTotalCents > Number.MAX_SAFE_INTEGER - amount) {
      throw repositoryError(400, 'VALIDATION_ERROR', 'O total oficial do pagamento é inválido.')
    }
    authoritativeTotalCents += amount
  }

  const allocations = assertPaymentAllocationTotal(rawAllocations, authoritativeTotalCents)
  const paymentExpectation = await readPaymentMethodExpectations(
    db,
    businessId,
    allocations.map(({ methodCode }) => methodCode),
  )
  const labels = new Map(paymentExpectation.methods.map(({ code, label }) => [code, label]))
  const paidAt = now.toISOString()
  const movementDate = getBusinessDate(now)
  const receiptId = crypto.randomUUID()
  const policyTxId = crypto.randomUUID()
  const receiptRow = {
    id: receiptId,
    business_id: businessId,
    table_tab_id: null,
    total_cents: authoritativeTotalCents,
    paid_at: paidAt,
    created_at: paidAt,
  }
  const allocationRows = allocations.map(({ methodCode, amountCents }) => ({
    id: crypto.randomUUID(),
    business_id: businessId,
    receipt_id: receiptId,
    method_code: methodCode,
    method_label: labels.get(methodCode),
    amount_cents: amountCents,
    created_at: paidAt,
  }))
  const paymentRows = selected.map((order) => ({
    id: crypto.randomUUID(),
    order_id: order.id,
    amount_cents: Number(order.total_cents),
  }))
  const description = `Recebimento cliente · ${clientRow.name} · ${paymentRows.length} pedidos`
  const movementRows = allocationRows.map((allocation) => ({
    id: crypto.randomUUID(),
    type: 'entrada',
    category: 'Vendas',
    description,
    value_cents: allocation.amount_cents,
    source: 'order-payment',
    order_id: null,
    payment_id: null,
    payment_method: allocation.method_label,
    movement_date: movementDate,
    created_at: paidAt,
    updated_at: paidAt,
    receipt_id: receiptId,
    payment_allocation_id: allocation.id,
  }))

  const stateGuards = chunkReceivableOrders(selected).map((orderChunk, chunkIndex) => {
    const statePredicates = []
    const stateBindings = [normalizedClientId, businessId]
    for (const order of orderChunk) {
      statePredicates.push(`EXISTS (
        SELECT 1 FROM orders current_order
        LEFT JOIN payments current_payment
          ON current_payment.order_id = current_order.id
         AND current_payment.business_id = current_order.business_id
        WHERE current_order.id = ?
          AND current_order.business_id = ?
          AND current_order.client_id = ?
          AND current_order.customer_identity_type = 'registered_client'
          AND current_order.table_tab_id IS NULL
          AND current_order.status <> 'Cancelado'
          AND current_order.total_cents = ?
          AND current_order.content_revision = ?
          AND current_payment.id IS NULL
      )`)
      stateBindings.push(order.id, businessId, normalizedClientId, Number(order.total_cents), Number(order.content_revision || 0))
    }
    return prepareSettingsAssertion(
      db,
      policyTxId,
      `client-receivables-state-${chunkIndex + 1}`,
      `EXISTS (SELECT 1 FROM clients WHERE id = ? AND business_id = ?) AND ${statePredicates.join(' AND ')}`,
      stateBindings,
    )
  })

  const statements = [
    ...preparePolicyGuards(db, businessId, { paymentMethods: paymentExpectation }, policyTxId),
    ...stateGuards,
    db.prepare(`INSERT INTO payment_receipts
      (id, business_id, table_tab_id, total_cents, paid_at, created_at)
      VALUES (?, ?, NULL, ?, ?, ?)`).bind(
      receiptId, businessId, authoritativeTotalCents, paidAt, paidAt,
    ),
  ]

  for (const allocation of allocationRows) {
    statements.push(
      db.prepare(`INSERT INTO payment_allocations
        (id, business_id, receipt_id, method_code, method_label, amount_cents, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(
        allocation.id,
        businessId,
        receiptId,
        allocation.method_code,
        allocation.method_label,
        allocation.amount_cents,
        paidAt,
      ),
      db.prepare(`UPDATE business_payment_methods SET first_used_at = ?
        WHERE business_id = ? AND code = ? AND first_used_at IS NULL`).bind(
        paidAt,
        businessId,
        allocation.method_code,
      ),
    )
  }

  for (const payment of paymentRows) {
    statements.push(
      db.prepare(`INSERT INTO payments
        (id, business_id, order_id, receipt_id, amount_cents, method, paid_at, created_at)
        VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`).bind(
        payment.id,
        businessId,
        payment.order_id,
        receiptId,
        payment.amount_cents,
        paidAt,
        paidAt,
      ),
    )
  }

  for (const movement of movementRows) {
    statements.push(
      db.prepare(`INSERT INTO movements
        (id, business_id, type, category, description, value_cents, source, order_id, payment_id,
         movement_date, created_at, payment_method, updated_at, receipt_id, payment_allocation_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?)`).bind(
        movement.id,
        businessId,
        movement.type,
        movement.category,
        movement.description,
        movement.value_cents,
        movement.source,
        movement.movement_date,
        movement.created_at,
        movement.payment_method,
        movement.updated_at,
        receiptId,
        movement.payment_allocation_id,
      ),
    )
  }
  statements.push(clearSettingsAssertions(db, policyTxId))

  try {
    await db.batch([...statements,...paymentRows.map(payment=>businessEvent(db,businessId,{action:'payment.received',resourceType:'order',resourceId:payment.order_id,now}))])
  } catch (error) {
    const message = String(error?.message || '')
    if (message.includes('POLICY_CHANGED')) rethrowPolicyChange(error)
    if (/SETTINGS_INVALID|UNIQUE constraint failed:\s*payments\.order_id/i.test(message)) {
      throw clientReceivablesConflict()
    }
    throw error
  }

  const resolvedAllocations = allocationRows.map(mapAllocation)
  return {
    receipt: mapReceipt(receiptRow, resolvedAllocations),
    allocations: resolvedAllocations,
    payments: paymentRows.map((payment) => ({
      id: payment.id,
      orderId: payment.order_id,
      receiptId,
      amount: centsToMoney(payment.amount_cents),
      paidAt,
    })),
    orders: await Promise.all(orderIds.map((orderId) => loadOrderById(db, businessId, orderId))),
    movements: movementRows.map(mapMovementRow),
  }
}


export async function registerTableTabPayment(db, businessId, tableTabId, rawAllocations, now = new Date()) {
  const tabRow = await db.prepare(`SELECT id, table_id, table_identifier, tab_number, status, opened_at, closed_at
    FROM table_tabs WHERE id = ? AND business_id = ? LIMIT 1`).bind(tableTabId, businessId).first()
  if (!tabRow) throw repositoryError(404, 'TABLE_TAB_NOT_FOUND', 'Comanda não encontrada.')
  if (tabRow.status !== 'open') throw repositoryError(409, 'TABLE_TAB_ALREADY_CLOSED', 'Esta comanda já foi encerrada.')

  const pendingResult = await db.prepare(`SELECT o.id, o.order_number, o.client_name_snapshot, o.total_cents, o.content_revision
    FROM orders o
    LEFT JOIN payments p ON p.order_id = o.id AND p.business_id = o.business_id
    WHERE o.business_id = ? AND o.table_tab_id = ? AND o.status <> 'Cancelado' AND p.id IS NULL
    ORDER BY o.created_at ASC`).bind(businessId, tableTabId).all()
  const pending = resultRows(pendingResult)
  const authoritativeTotalCents = pending.reduce((sum, order) => sum + Number(order.total_cents || 0), 0)
  if (!pending.length || !Number.isSafeInteger(authoritativeTotalCents) || authoritativeTotalCents <= 0) {
    throw repositoryError(409, 'TABLE_TAB_NOT_PAYABLE', 'Esta comanda não possui saldo pendente para receber.')
  }

  const allocations = assertPaymentAllocationTotal(rawAllocations, authoritativeTotalCents)
  const paymentExpectation = await readPaymentMethodExpectations(
    db,
    businessId,
    allocations.map(({ methodCode }) => methodCode),
  )
  const labels = new Map(paymentExpectation.methods.map(({ code, label }) => [code, label]))
  const paidAt = now.toISOString()
  const movementDate = getBusinessDate(now)
  const receiptId = crypto.randomUUID()
  const policyTxId = crypto.randomUUID()
  const receiptRow = {
    id: receiptId,
    business_id: businessId,
    table_tab_id: tableTabId,
    total_cents: authoritativeTotalCents,
    paid_at: paidAt,
    created_at: paidAt,
  }
  const allocationRows = allocations.map(({ methodCode, amountCents }) => ({
    id: crypto.randomUUID(),
    business_id: businessId,
    receipt_id: receiptId,
    method_code: methodCode,
    method_label: labels.get(methodCode),
    amount_cents: amountCents,
    created_at: paidAt,
  }))
  const paymentRows = pending.map((order) => ({
    id: crypto.randomUUID(),
    order_id: order.id,
    amount_cents: Number(order.total_cents),
  }))
  const description = `Pagamento comanda #${tabRow.tab_number} · ${tabRow.table_identifier}`
  const movementRows = allocationRows.map((allocation) => ({
    id: crypto.randomUUID(),
    type: 'entrada',
    category: 'Vendas',
    description,
    value_cents: allocation.amount_cents,
    source: 'order-payment',
    order_id: null,
    payment_id: null,
    payment_method: allocation.method_label,
    movement_date: movementDate,
    created_at: paidAt,
    updated_at: paidAt,
    receipt_id: receiptId,
    payment_allocation_id: allocation.id,
  }))

  const tabSnapshotGuard = prepareSettingsAssertion(db,policyTxId,'table-member-count',
    `EXISTS(SELECT 1 FROM table_tabs WHERE id=? AND business_id=? AND status='open')
      AND (SELECT COUNT(*) FROM orders o LEFT JOIN payments p
        ON p.business_id=o.business_id AND p.order_id=o.id
        WHERE o.business_id=? AND o.table_tab_id=? AND o.status<>'Cancelado'
          AND p.id IS NULL)=?`,
    [tableTabId,businessId,businessId,tableTabId,pending.length])
  const orderRevisionGuards = pending.map((order,index)=>prepareSettingsAssertion(
    db,policyTxId,'table-order-'+index,
    `EXISTS(SELECT 1 FROM orders o LEFT JOIN payments p
      ON p.business_id=o.business_id AND p.order_id=o.id
      WHERE o.business_id=? AND o.id=? AND o.table_tab_id=?
        AND o.status<>'Cancelado' AND p.id IS NULL
        AND o.total_cents=? AND o.content_revision=?)`,
    [businessId,order.id,tableTabId,Number(order.total_cents),Number(order.content_revision||0)],
  ))
  const statements = [
    ...preparePolicyGuards(db, businessId, { paymentMethods: paymentExpectation }, policyTxId),
    tabSnapshotGuard,
    ...orderRevisionGuards,
    db.prepare(`INSERT INTO payment_receipts
      (id, business_id, table_tab_id, total_cents, paid_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`).bind(receiptId, businessId, tableTabId, authoritativeTotalCents, paidAt, paidAt),
  ]

  for (const allocation of allocationRows) {
    statements.push(
      db.prepare(`INSERT INTO payment_allocations
        (id, business_id, receipt_id, method_code, method_label, amount_cents, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(
        allocation.id,
        businessId,
        receiptId,
        allocation.method_code,
        allocation.method_label,
        allocation.amount_cents,
        paidAt,
      ),
      db.prepare(`UPDATE business_payment_methods SET first_used_at = ?
        WHERE business_id = ? AND code = ? AND first_used_at IS NULL`).bind(
        paidAt,
        businessId,
        allocation.method_code,
      ),
    )
  }

  for (const payment of paymentRows) {
    statements.push(
      db.prepare(`INSERT INTO payments
        (id, business_id, order_id, receipt_id, amount_cents, method, paid_at, created_at)
        VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`).bind(
        payment.id,
        businessId,
        payment.order_id,
        receiptId,
        payment.amount_cents,
        paidAt,
        paidAt,
      ),
    )
  }

  for (const movement of movementRows) {
    statements.push(
      db.prepare(`INSERT INTO movements
        (id, business_id, type, category, description, value_cents, source, order_id, payment_id,
         movement_date, created_at, payment_method, updated_at, receipt_id, payment_allocation_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?)`).bind(
        movement.id,
        businessId,
        movement.type,
        movement.category,
        movement.description,
        movement.value_cents,
        movement.source,
        movement.movement_date,
        movement.created_at,
        movement.payment_method,
        movement.updated_at,
        receiptId,
        movement.payment_allocation_id,
      ),
    )
  }

  const closeTableTabStatement = db.prepare(`UPDATE table_tabs
    SET status = 'closed', closed_at = ?, updated_at = ?
    WHERE id = ? AND business_id = ? AND status = 'open'`).bind(
      paidAt,
      paidAt,
      tableTabId,
      businessId,
    )
  statements.push(closeTableTabStatement)
  statements.push(clearSettingsAssertions(db, policyTxId))

  let batchResults
  try {
    batchResults = await db.batch([...statements,...paymentRows.map(payment=>businessEvent(db,businessId,{action:'payment.received',resourceType:'order',resourceId:payment.order_id,now}))])
  } catch (error) {
    const message = String(error?.message || '')
    if (/TABLE_TAB_HAS_UNPAID_ORDERS|TABLE_TAB_PAYMENT_INVALID|SETTINGS_INVALID|UNIQUE constraint failed:\s*payments\.order_id/i.test(message)) {
      throw repositoryError(409, 'TABLE_TAB_PAYMENT_CONFLICT', 'A comanda foi alterada durante o pagamento. Atualize os dados e tente novamente.')
    }
    if (message.includes('POLICY_CHANGED')) rethrowPolicyChange(error)
    throw error
  }

  const closeResult = batchResults?.[statements.indexOf(closeTableTabStatement)]
  if (closeResult?.meta && Number(closeResult.meta.changes || 0) !== 1) {
    throw repositoryError(409, 'TABLE_TAB_PAYMENT_CONFLICT', 'A comanda foi alterada durante o pagamento. Atualize os dados e tente novamente.')
  }

  const resolvedAllocations = allocationRows.map(mapAllocation)
  const receipt = mapReceipt(receiptRow, resolvedAllocations)
  return {
    receipt,
    allocations: resolvedAllocations,
    payments: paymentRows.map((payment) => ({
      id: payment.id,
      orderId: payment.order_id,
      receiptId,
      amount: centsToMoney(payment.amount_cents),
      paidAt,
    })),
    orders: await Promise.all(pending.map((order) => loadOrderById(db, businessId, order.id))),
    movements: movementRows.map(mapMovementRow),
    tableTab: mapTableTabRow({ ...tabRow, status: 'closed', closed_at: paidAt }),
  }
}
