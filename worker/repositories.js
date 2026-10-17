import { registerCommittedEffect } from './realtime/committedEffects.js'
import { businessEvent, auditedMutation } from './access/audit.js'
import { LATEST_OPERATIONAL_EDIT_JOIN, OPERATIONAL_EDIT_SELECT_FIELDS, projectOperationalEdit } from './orderEditSignalsRepository.js'
import { formatClientPhone, normalizeClientPhone } from '../shared/clientIdentity.js'
import { projectBootstrap } from './access/projections.js'
import { getBusinessDate } from '../shared/finance.js'
import { createOrderPrintDocument } from '../shared/orderPrintDocument.js'
import { resolveAutomaticOrderPrintAvailableAt, resolvePrintCopies } from '../shared/printContextPolicy.js'
import { formatOrderDisplayNumber } from '../shared/orderDisplayNumber.js'
import { formatProductPresentation } from '../shared/productCatalog.js'
import { mapMovementRow, loadFinanceSettings } from './financeRepository.js'
import { calculateCheckoutTotals } from './orderCheckout.js'
import { assertPaymentAllocationTotal, validatePaymentAllocations } from './paymentValidation.js'
import { prepareAutomaticPrintJobStatement } from './orderPrintingRepository.js'
import { listTables, requireExpectedOpenTableTab, reserveNextTableTabNumber } from './tableRepository.js'
import { centsToMoney } from './validation.js'
import { clearSettingsAssertions, prepareSettingsAssertion } from './settingsTransactions.js'
import { preparePolicyGuards, readOrderModalityExpectation, readPaymentMethodExpectations, readPrintingPolicyExpectation, rethrowPolicyChange } from './operationalPolicyGuards.js'
import { loadOperations } from './operationSettingsRepository.js'
import { parseOrderTimingPolicySnapshot, serializeOrderTimingPolicySnapshot } from '../shared/orderTiming.js'
import { mapOrderPaymentFields, PAYMENT_ALLOCATIONS_JSON_SELECT } from './orderPaymentReadModel.js'

const rows = (result) => Array.isArray(result?.results) ? result.results : []
const repositoryError = (status, code, message) => Object.assign(new Error(message), { status, code })

export const mapClientRow = (row) => ({ id: row.id, name: row.name, phone: formatClientPhone(row.phone), address: row.address || '' })
export const mapProductRow = (row) => {
  const product = {
    id: row.id,
    category: row.category,
    size: row.size || '',
    name: row.name,
    price: centsToMoney(row.price_cents),
  }
  const hasStructuredPresentation = Object.hasOwn(row, 'presentation_type')
    || Object.hasOwn(row, 'presentation_value')
    || Object.hasOwn(row, 'presentation_unit')
  if (!hasStructuredPresentation) return product
  return {
    ...product,
    presentationType: row.presentation_type || (row.size && !['Un', 'Unidade'].includes(row.size) ? 'size' : 'unit'),
    presentationValue: row.presentation_value || (row.size && !['Un', 'Unidade'].includes(row.size) ? row.size : ''),
    presentationUnit: row.presentation_unit || '',
  }
}
export const mapTableTabRow = (row) => ({
  id: row.id,
  tableId: row.table_id ?? null,
  tableIdentifier: row.table_identifier,
  tabNumber: Number(row.tab_number),
  status: row.status,
  openedAt: row.opened_at,
  closedAt: row.closed_at ?? null,
})

export const mapOrderItemRow = (row) => ({
  id: row.id,
  productId: row.product_id ?? null,
  name: row.name_snapshot,
  category: row.category_snapshot || '',
  size: row.size_snapshot || '',
  quantity: Number(row.quantity) || 1,
  catalogPrice: centsToMoney(row.catalog_price_cents),
  unitPrice: centsToMoney(row.unit_price_cents),
  priceReason: row.price_reason || '',
  note: row.note || '',
})

export const mapOrderRow = (row, items = []) => {
  const firstItem = items[0] ?? null
  const paid = Boolean(row.payment_id)
  const payment = mapOrderPaymentFields(row)
  const refundMovementId = row.refund_movement_id ?? null
  const adjustmentMode = row.adjustment_mode || 'fixed'
  const adjustmentValue = adjustmentMode === 'percentage'
    ? Number(row.adjustment_value || 0) / 100
    : centsToMoney(row.adjustment_value)
  const customerIdentityType = row.customer_identity_type || (row.client_id ? 'registered_client' : 'guest_name')
  const tableIdentifier = row.table_identifier ?? row.reservation_table_name ?? null
  const client = customerIdentityType === 'table' && tableIdentifier
    ? row.client_id && row.client_name_snapshot ? `${tableIdentifier} · ${row.client_name_snapshot}` : tableIdentifier
    : row.client_name_snapshot

  return {
    id: row.id,
    orderNumber: Number(row.order_number),
    ...projectOperationalEdit(row),
    contentRevision: Number(row.content_revision || 0),
    lastEditedAt: row.last_edited_at ?? null,
    clientId: row.client_id ?? null,
    client,
    clientPhone: row.client_phone_snapshot || '',
    clientAddress: row.client_address_snapshot || '',
    customerIdentityType,
    tableTabId: row.table_tab_id ?? null,
    tableIdentifier,
    tableReservationId: row.table_reservation_id ?? null,
    tableReservationStatus: row.table_reservation_status ?? null,
    reservationTableId: row.reservation_table_id ?? null,
    reservationTableName: row.reservation_table_name ?? null,
    reservationRevision: row.reservation_revision == null ? null : Number(row.reservation_revision),
    type: row.type,
    status: row.status,
    productName: firstItem?.name ?? '',
    size: firstItem?.size ?? '',
    quantity: firstItem?.quantity ?? 1,
    subtotal: centsToMoney(row.subtotal_cents ?? row.total_cents),
    deliveryFee: centsToMoney(row.delivery_fee_cents),
    adjustment: {
      type: row.adjustment_type || 'none',
      mode: adjustmentMode,
      value: adjustmentValue,
      amount: centsToMoney(row.adjustment_amount_cents),
      reason: row.adjustment_reason || '',
    },
    total: centsToMoney(row.total_cents),
    orderDate: row.order_date,
    date: row.order_date,
    scheduledFor: row.scheduled_for ?? null,
    promisedPaymentDate: row.promised_payment_date ?? null,
    isBackdated: Boolean(row.is_backdated),
    createdAt: row.created_at,
    finishedAt: row.finished_at ?? null,
    cancelledAt: row.cancelled_at ?? null,
    cancelReason: row.cancel_reason ?? null,
    cancelReasonLabel: row.cancel_reason_label ?? row.cancel_reason ?? null,
    cancelReasonNote: row.cancel_reason_note ?? '',
    timingPolicySnapshot: parseOrderTimingPolicySnapshot(row.timing_policy_snapshot_json),
    ...payment,
    paidAmount: paid ? centsToMoney(row.paid_amount_cents) : 0,
    refundMovementId,
    refundedAt: row.refund_created_at ?? null,
    refundState: row.status === 'Cancelado' && paid ? (refundMovementId ? 'refunded' : 'pending') : 'none',
    items,
  }
}

const productSelectFields = 'id, category, size, presentation_type, presentation_value, presentation_unit, name, price_cents'
const orderSelect = `SELECT o.id, o.order_number, o.client_id, o.client_name_snapshot, o.client_phone_snapshot, o.client_address_snapshot, o.customer_identity_type, o.table_tab_id, o.type, o.order_date, o.status, o.scheduled_for, o.promised_payment_date, o.is_backdated, o.subtotal_cents, o.delivery_fee_cents, o.adjustment_type, o.adjustment_mode, o.adjustment_value, o.adjustment_amount_cents, o.adjustment_reason, o.total_cents, o.content_revision, o.last_edited_at, o.created_at, o.finished_at, o.cancelled_at, o.cancel_reason, o.cancel_reason_note, cr.label AS cancel_reason_label, o.timing_policy_snapshot_json, p.id AS payment_id, p.method AS payment_method, p.paid_at, ${PAYMENT_ALLOCATIONS_JSON_SELECT}, p.amount_cents AS paid_amount_cents, r.id AS refund_movement_id, r.created_at AS refund_created_at, tt.table_identifier AS table_identifier, tr.id AS table_reservation_id, tr.status AS table_reservation_status, tr.table_id AS reservation_table_id, COALESCE(rt.name, tr.table_name_snapshot) AS reservation_table_name, tr.revision AS reservation_revision, ${OPERATIONAL_EDIT_SELECT_FIELDS} FROM orders o LEFT JOIN payments p ON p.order_id = o.id AND p.business_id = o.business_id LEFT JOIN movements r ON r.order_id = o.id AND r.business_id = o.business_id AND r.source = 'order-refund' LEFT JOIN business_cancel_reasons cr ON cr.business_id = o.business_id AND cr.id = o.cancel_reason LEFT JOIN table_tabs tt ON tt.id = o.table_tab_id AND tt.business_id = o.business_id LEFT JOIN table_reservations tr ON tr.order_id = o.id AND tr.business_id = o.business_id LEFT JOIN tables rt ON rt.id = tr.table_id AND rt.business_id = tr.business_id ${LATEST_OPERATIONAL_EDIT_JOIN}`
const itemSelect = `SELECT id, order_id, product_id, name_snapshot, category_snapshot, size_snapshot, quantity, catalog_price_cents, unit_price_cents, price_reason, note, created_at FROM order_items`
const productSnapshotSize = (row) => {
  const presentation = formatProductPresentation(mapProductRow(row))
  return presentation === 'Unidade' ? 'Un' : presentation
}

export const loadBootstrap = async (db, businessId, effectiveBusinessConfig, granted) => {
  const business = await db.prepare(`SELECT
      b.id,
      b.name,
      CASE WHEN bp.logo_object_key IS NOT NULL THEN 1 ELSE 0 END AS has_logo,
      CASE WHEN bp.logo_object_key IS NOT NULL THEN bp.logo_updated_at ELSE NULL END AS logo_version
    FROM businesses b
    LEFT JOIN business_profiles bp ON bp.business_id = b.id
    WHERE b.id = ?
    LIMIT 1`).bind(businessId).first()
  const clientsResult = await db.prepare(`SELECT id, name, phone, address FROM clients WHERE business_id = ? ORDER BY name COLLATE NOCASE ASC`).bind(businessId).all()
  const productsResult = await db.prepare(`SELECT ${productSelectFields} FROM products WHERE business_id = ? AND active = 1 ORDER BY name COLLATE NOCASE ASC`).bind(businessId).all()
  const ordersResult = await db.prepare(`${orderSelect} WHERE o.business_id = ? ORDER BY o.created_at DESC`).bind(businessId).all()
  const itemsResult = await db.prepare(`${itemSelect} WHERE business_id = ? ORDER BY created_at ASC, rowid ASC`).bind(businessId).all()
  const tableTabsResult = await db.prepare(`SELECT id, table_id, table_identifier, tab_number, status, opened_at, closed_at FROM table_tabs WHERE business_id = ? ORDER BY opened_at DESC`).bind(businessId).all()
  const tables = await listTables(db, businessId)
  const movementsResult = await db.prepare(`SELECT m.id, m.type, m.category, m.description, m.value_cents, m.source, m.order_id, m.payment_id,
    m.receipt_id, m.payment_allocation_id,
    fc.label AS category_label,
    CASE WHEN m.source = 'order-payment' THEN COALESCE(m.payment_method, p.method) ELSE m.payment_method END AS payment_method,
    m.movement_date, m.created_at, m.updated_at
    FROM movements m
    LEFT JOIN payments p ON p.id = m.payment_id AND p.business_id = m.business_id
    LEFT JOIN business_finance_categories fc ON fc.business_id = m.business_id AND fc.id = m.category
    WHERE m.business_id = ? AND m.deleted_at IS NULL
    ORDER BY m.created_at DESC`).bind(businessId).all()
  const financeSettings = await loadFinanceSettings(db, businessId)
  const itemsByOrder = new Map()
  for (const itemRow of rows(itemsResult)) {
    const current = itemsByOrder.get(itemRow.order_id) ?? []
    current.push(mapOrderItemRow(itemRow))
    itemsByOrder.set(itemRow.order_id, current)
  }
  const payload = {
    business: business
      ? {
          id: business.id,
          name: business.name,
          hasLogo: Boolean(business.has_logo),
          logoVersion: business.has_logo ? (business.logo_version ?? null) : null,
        }
      : { id: businessId, name: 'Estabelecimento', hasLogo: false, logoVersion: null },
    clients: rows(clientsResult).map(mapClientRow),
    products: rows(productsResult).map(mapProductRow),
    orders: rows(ordersResult).map((orderRow) => mapOrderRow(orderRow, itemsByOrder.get(orderRow.id) ?? [])),
    tables,
    tableTabs: rows(tableTabsResult).map(mapTableTabRow),
    movements: rows(movementsResult).map(mapMovementRow),
    financeSettings,
    ...(effectiveBusinessConfig ? { effectiveBusinessConfig } : {}),
  }
  return granted instanceof Set ? projectBootstrap(payload, granted) : payload
}

const findClientRow = (db, businessId, id) => db.prepare(`SELECT id, name, phone, address FROM clients WHERE id = ? AND business_id = ? LIMIT 1`).bind(id, businessId).first()
const findClientByPhone = (db, businessId, phone, excludeId = null) => excludeId
  ? db.prepare(`SELECT id, name, phone, address FROM clients WHERE business_id = ? AND phone = ? AND id <> ? LIMIT 1`).bind(businessId, phone, excludeId).first()
  : db.prepare(`SELECT id, name, phone, address FROM clients WHERE business_id = ? AND phone = ? LIMIT 1`).bind(businessId, phone).first()
const findProductRow = (db, businessId, id) => db.prepare(`SELECT ${productSelectFields} FROM products WHERE id = ? AND business_id = ? AND active = 1 LIMIT 1`).bind(id, businessId).first()
const duplicatePhoneError = (client) => repositoryError(409, 'CLIENT_PHONE_EXISTS', `Telefone já cadastrado para ${client?.name || 'outro cliente'}.`)
const isPhoneTriggerCollision = (error) => String(error?.message || error).includes('CLIENT_PHONE_DUPLICATE')

export const createClient = async (db, businessId, input, now = new Date()) => {
  const id = crypto.randomUUID()
  const timestamp = now.toISOString()
  const phone = normalizeClientPhone(input.phone)
  if (phone) {
    const duplicate = await findClientByPhone(db, businessId, phone)
    if (duplicate) throw duplicatePhoneError(duplicate)
  }

  try {
    await auditedMutation(db, businessId, db.prepare(`INSERT INTO clients (id, business_id, name, phone, address, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(id, businessId, input.name, phone, input.address, timestamp, timestamp), {action:'client.created',resourceType:'client',resourceId:id,now}).run()
  } catch (error) {
    if (!isPhoneTriggerCollision(error)) throw error
    throw duplicatePhoneError(phone ? await findClientByPhone(db, businessId, phone) : null)
  }
  return mapClientRow({ id, name: input.name, phone, address: input.address })
}

export const updateClient = async (db, businessId, id, input, now = new Date()) => {
  if (!(await findClientRow(db, businessId, id))) return null
  const phone = normalizeClientPhone(input.phone)
  if (phone) {
    const duplicate = await findClientByPhone(db, businessId, phone, id)
    if (duplicate) throw duplicatePhoneError(duplicate)
  }

  try {
    await auditedMutation(db, businessId, db.prepare(`UPDATE clients SET name = ?, phone = ?, address = ?, updated_at = ? WHERE id = ? AND business_id = ?`).bind(input.name, phone, input.address, now.toISOString(), id, businessId), {action:'client.updated',resourceType:'client',resourceId:id,now}).run()
  } catch (error) {
    if (!isPhoneTriggerCollision(error)) throw error
    throw duplicatePhoneError(phone ? await findClientByPhone(db, businessId, phone) : null)
  }
  return mapClientRow({ id, name: input.name, phone, address: input.address })
}

export const deleteClient = async (db, businessId, id, now = new Date()) => {
  if (!(await findClientRow(db, businessId, id))) return false
  await auditedMutation(db, businessId, db.prepare('DELETE FROM clients WHERE id = ? AND business_id = ?').bind(id, businessId), {action:'client.deleted',resourceType:'client',resourceId:id,now}).run()
  return true
}

export const createProduct = async (db, businessId, input, now = new Date()) => {
  const id = crypto.randomUUID()
  const timestamp = now.toISOString()
  await auditedMutation(db, businessId, db.prepare(`INSERT INTO products (id, business_id, category, size, name, price_cents, active, created_at, updated_at, presentation_type, presentation_value, presentation_unit) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`).bind(
    id,
    businessId,
    input.category,
    input.size,
    input.name,
    input.priceCents,
    timestamp,
    timestamp,
    input.presentationType,
    input.presentationValue,
    input.presentationUnit,
  ), {action:'product.created',resourceType:'product',resourceId:id,now}).run()
  return mapProductRow({
    id,
    category: input.category,
    size: input.size,
    name: input.name,
    price_cents: input.priceCents,
    presentation_type: input.presentationType,
    presentation_value: input.presentationValue,
    presentation_unit: input.presentationUnit,
  })
}

export const updateProduct = async (db, businessId, id, input, now = new Date()) => {
  if (!(await findProductRow(db, businessId, id))) return null
  if (input.presentationType === undefined) {
    await auditedMutation(db, businessId, db.prepare(`UPDATE products SET category = ?, size = ?, name = ?, price_cents = ?, updated_at = ? WHERE id = ? AND business_id = ? AND active = 1`).bind(
      input.category,
      input.size,
      input.name,
      input.priceCents,
      now.toISOString(),
      id,
      businessId,
    ), {action:'product.updated',resourceType:'product',resourceId:id,now}).run()
    return mapProductRow({ id, category: input.category, size: input.size, name: input.name, price_cents: input.priceCents })
  }
  await auditedMutation(db, businessId, db.prepare(`UPDATE products SET category = ?, size = ?, name = ?, price_cents = ?, updated_at = ?, presentation_type = ?, presentation_value = ?, presentation_unit = ? WHERE id = ? AND business_id = ? AND active = 1`).bind(
    input.category,
    input.size,
    input.name,
    input.priceCents,
    now.toISOString(),
    input.presentationType,
    input.presentationValue,
    input.presentationUnit,
    id,
    businessId,
  ), {action:'product.updated',resourceType:'product',resourceId:id,now}).run()
  return mapProductRow({
    id,
    category: input.category,
    size: input.size,
    name: input.name,
    price_cents: input.priceCents,
    presentation_type: input.presentationType,
    presentation_value: input.presentationValue,
    presentation_unit: input.presentationUnit,
  })
}

export const deleteProduct = async (db, businessId, id, now = new Date()) => {
  if (!(await findProductRow(db, businessId, id))) return false
  await auditedMutation(db, businessId, db.prepare(`UPDATE products SET active = 0, updated_at = ? WHERE id = ? AND business_id = ? AND active = 1`).bind(now.toISOString(), id, businessId), {action:'product.deleted',resourceType:'product',resourceId:id,now}).run()
  return true
}

const backdatedOperationalTimestamp = (orderDate) => `${orderDate}T15:00:00.000Z`
const TABLE_RESERVATION_DURATION_MINUTES = 120

export const loadOrderById = async (db, businessId, id) => {
  const row = await db.prepare(`${orderSelect} WHERE o.id = ? AND o.business_id = ? LIMIT 1`).bind(id, businessId).first()
  if (!row) return null
  const itemsResult = await db.prepare(`${itemSelect} WHERE order_id = ? AND business_id = ? ORDER BY created_at ASC, rowid ASC`).bind(id, businessId).all()
  return mapOrderRow(row, rows(itemsResult).map(mapOrderItemRow))
}

const legacyCheckoutInput = (input) => ({
  ...input,
  customerIdentity: input.customerIdentity ?? { type: 'registered_client', clientId: input.clientId },
  items: [{ productId: input.productId, quantity: input.quantity, note: '' }],
  deliveryFeeCents: 0,
  adjustment: { type: 'none', mode: 'fixed', storedValue: 0, reason: '' },
  paymentAllocations: null,
})

export const createOrder = async (db, businessId, rawInput, now = new Date()) => {
  const input = Array.isArray(rawInput.items) && rawInput.items.length ? rawInput : legacyCheckoutInput(rawInput)
  const idempotencyKey = input.idempotencyKey || crypto.randomUUID()

  const existing = await db.prepare('SELECT id FROM orders WHERE business_id = ? AND idempotency_key = ? LIMIT 1').bind(businessId, idempotencyKey).first()
  if (existing?.id) return loadOrderById(db, businessId, existing.id)

  const customerIdentity = input.customerIdentity ?? { type: 'registered_client', clientId: input.clientId }
  const requestedAllocations = input.paymentAllocations == null ? null : validatePaymentAllocations(input.paymentAllocations)
  if (customerIdentity.type === 'table' && requestedAllocations) {
    throw repositoryError(400, 'TABLE_ORDER_PAYMENT_NOT_ALLOWED', 'Pedidos de mesa devem ser recebidos pelo pagamento integral da comanda.')
  }
  const policyExpectations = {}
  policyExpectations.operations = await readOrderModalityExpectation(db, businessId, input.type)
  if (requestedAllocations) {
    policyExpectations.paymentMethods = await readPaymentMethodExpectations(
      db,
      businessId,
      requestedAllocations.map(({ methodCode }) => methodCode),
    )
  }
  let clientId = null
  let clientSnapshot = ''
  let clientPhoneSnapshot = ''
  let clientAddressSnapshot = ''
  let tableTabId = null
  let tableIdentifier = null
  let pendingTableTab = null
  let pendingReservation = null
  if (customerIdentity.type === 'registered_client') {
    const client = await db.prepare('SELECT id, name, phone, address FROM clients WHERE id = ? AND business_id = ? LIMIT 1').bind(customerIdentity.clientId, businessId).first()
    if (!client) throw repositoryError(404, 'CLIENT_NOT_FOUND', 'Cliente não encontrado.')
    clientId = client.id
    clientSnapshot = client.name
    clientPhoneSnapshot = formatClientPhone(client.phone)
    clientAddressSnapshot = client.address || ''
  } else if (customerIdentity.type === 'guest_name') {
    clientSnapshot = customerIdentity.value
  } else if (customerIdentity.type === 'table') {
    if (customerIdentity.clientId) {
      const client = await db.prepare('SELECT id, name, phone, address FROM clients WHERE id = ? AND business_id = ? LIMIT 1').bind(customerIdentity.clientId, businessId).first()
      if (!client) throw repositoryError(404, 'CLIENT_NOT_FOUND', 'Cliente não encontrado.')
      clientId = client.id
      clientSnapshot = client.name
      clientPhoneSnapshot = formatClientPhone(client.phone)
      clientAddressSnapshot = client.address || ''
    }
    const reservationMode = Boolean(input.scheduledFor)
    if (reservationMode) {
      if (input.expectedTableTabId) {
        throw repositoryError(400, 'RESERVATION_TABLE_TAB_NOT_ALLOWED', 'Reservas não podem ser vinculadas a uma comanda aberta.')
      }
      const table = await db.prepare(`SELECT id, name, is_active
        FROM tables WHERE id = ? AND business_id = ? LIMIT 1`).bind(customerIdentity.tableId, businessId).first()
      if (!table) throw repositoryError(404, 'TABLE_NOT_FOUND', 'Mesa não encontrada.')
      if (!table.is_active) throw repositoryError(409, 'TABLE_INACTIVE', 'A mesa está inativa.')
      tableIdentifier = table.name
      if (!clientSnapshot) clientSnapshot = table.name
      pendingReservation = {
        id: crypto.randomUUID(),
        tableId: table.id,
        tableName: table.name,
      }
    } else {
      let tableTab
      if (input.expectedTableTabId) {
        tableTab = await requireExpectedOpenTableTab(db, businessId, customerIdentity.tableId, input.expectedTableTabId)
      } else {
        const table = await db.prepare(`SELECT id, name, is_active
          FROM tables WHERE id = ? AND business_id = ? LIMIT 1`).bind(customerIdentity.tableId, businessId).first()
        if (!table) throw repositoryError(404, 'TABLE_NOT_FOUND', 'Mesa não encontrada.')
        if (!table.is_active) throw repositoryError(409, 'TABLE_INACTIVE', 'A mesa está inativa.')
        const openRow = await db.prepare(`SELECT id, table_id, table_identifier, tab_number, status, opened_at, closed_at
          FROM table_tabs WHERE business_id = ? AND table_id = ? AND status = 'open' LIMIT 1`).bind(businessId, table.id).first()
        if (openRow) {
          tableTab = mapTableTabRow(openRow)
        } else {
          const timestamp = now.toISOString()
          tableTab = {
            id: crypto.randomUUID(), tableId: table.id, tableIdentifier: table.name,
            tabNumber: await reserveNextTableTabNumber(db, businessId, now), status: 'open',
            openedAt: timestamp, closedAt: null,
          }
          pendingTableTab = tableTab
        }
      }
      if (!clientSnapshot) clientSnapshot = tableTab.tableIdentifier
      tableTabId = tableTab.id
      tableIdentifier = tableTab.tableIdentifier
    }
  } else {
    throw repositoryError(400, 'INVALID_CUSTOMER_IDENTITY', 'Identificação do pedido inválida.')
  }

  const pricedItems = []
  for (const item of input.items) {
    const product = await db.prepare(`SELECT ${productSelectFields} FROM products WHERE id = ? AND business_id = ? AND active = 1 LIMIT 1`).bind(item.productId, businessId).first()
    if (!product) throw repositoryError(404, 'PRODUCT_NOT_FOUND', 'Produto não encontrado.')
    pricedItems.push({ ...item, product, priceCents: product.price_cents })
  }

  const today = getBusinessDate(now)
  const scheduledFor = input.scheduledFor || null
  if (input.orderDate > today && !scheduledFor) {
    throw repositoryError(400, 'ORDER_DATE_IN_FUTURE', 'A data do pedido não pode estar no futuro.')
  }
  if (input.orderDate < today && scheduledFor) {
    throw repositoryError(400, 'ORDER_SCHEDULE_INVALID', 'Pedido agendado não pode usar uma data retroativa.')
  }

  const historical = input.orderDate < today && !scheduledFor
  const scheduledOperations = scheduledFor ? await loadOperations(db, businessId) : null
  const isBackdated = historical ? 1 : 0
  const createdAt = historical ? backdatedOperationalTimestamp(input.orderDate) : now.toISOString()
  const finishedAt = historical ? createdAt : null
  const status = historical ? 'Finalizado' : 'Em preparo'
  let automaticCopies = null
  if (status === 'Em preparo') {
    policyExpectations.printing = await readPrintingPolicyExpectation(db, businessId)
    automaticCopies = resolvePrintCopies({
      jobType: 'order', customerIdentityType: customerIdentity.type, tableTabId,
      policy: policyExpectations.printing.policy,
    })
  }
  const deliveryFeeCents = Number(input.deliveryFeeCents) || 0
  const adjustment = input.adjustment || { type: 'none', mode: 'fixed', storedValue: 0, reason: '' }
  const totals = calculateCheckoutTotals(pricedItems, deliveryFeeCents, adjustment)
  const paymentAllocations = requestedAllocations
    ? assertPaymentAllocationTotal(requestedAllocations, totals.totalCents)
    : null
  const orderId = crypto.randomUUID()
  const sequenceRow = await db.prepare(`INSERT INTO order_sequences (business_id, last_order_number)
    VALUES (?, 1)
    ON CONFLICT (business_id) DO UPDATE SET last_order_number = order_sequences.last_order_number + 1
    RETURNING last_order_number`).bind(businessId).first()
  const orderNumber = Number(sequenceRow?.last_order_number)
  if (!Number.isInteger(orderNumber) || orderNumber < 1) throw new Error('ORDER_NUMBER_ALLOCATION_FAILED')

  if (pendingReservation) {
    const scheduledAt = new Date(scheduledFor)
    if (Number.isNaN(scheduledAt.getTime())) throw repositoryError(400, 'ORDER_SCHEDULE_INVALID', 'Horário agendado inválido.')
    pendingReservation.scheduledFor = scheduledAt.toISOString()
    pendingReservation.endsAt = new Date(
      scheduledAt.getTime() + TABLE_RESERVATION_DURATION_MINUTES * 60_000,
    ).toISOString()
  }

  const orderStatement = db.prepare(`INSERT INTO orders (id, business_id, order_number, client_id, client_name_snapshot, customer_identity_type, table_tab_id, type, order_date, status, scheduled_for, is_backdated, subtotal_cents, delivery_fee_cents, adjustment_type, adjustment_mode, adjustment_value, adjustment_amount_cents, adjustment_reason, total_cents, created_at, finished_at, idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
    orderId,
    businessId,
    orderNumber,
    clientId,
    clientSnapshot,
    customerIdentity.type,
    tableTabId,
    input.type,
    input.orderDate,
    status,
    scheduledFor,
    isBackdated,
    totals.subtotalCents,
    deliveryFeeCents,
    adjustment.type || 'none',
    adjustment.mode || 'fixed',
    Number(adjustment.storedValue) || 0,
    totals.adjustmentAmountCents,
    adjustment.reason || '',
    totals.totalCents,
    createdAt,
    finishedAt,
    idempotencyKey,
  )

  if(tableTabId || pendingReservation)registerCommittedEffect(orderStatement,{businessId,topics:['tables','reservations'],orderIds:[]})
  const contactSnapshotStatement = db.prepare(`UPDATE orders SET client_phone_snapshot = ?, client_address_snapshot = ?
    WHERE id = ? AND business_id = ?`).bind(clientPhoneSnapshot, clientAddressSnapshot, orderId, businessId)
  const policyTxId = crypto.randomUUID()
  const policyGuards = preparePolicyGuards(db, businessId, policyExpectations, policyTxId)
  const tableTabGuard = pendingTableTab
    ? prepareSettingsAssertion(db, policyTxId, 'state', `
      EXISTS (SELECT 1 FROM tables WHERE id = ? AND business_id = ? AND is_active = 1)
      AND NOT EXISTS (SELECT 1 FROM table_tabs WHERE business_id = ? AND table_id = ? AND status = 'open')`,
    [pendingTableTab.tableId, businessId, businessId, pendingTableTab.tableId])
    : null
  const reservationTableGuard = pendingReservation
    ? prepareSettingsAssertion(db, policyTxId, 'reservation-table',
      'EXISTS (SELECT 1 FROM tables WHERE id = ? AND business_id = ? AND is_active = 1)',
      [pendingReservation.tableId, businessId])
    : null
  const tableTabStatement = pendingTableTab
    ? db.prepare(`INSERT INTO table_tabs (
      id, business_id, table_id, table_identifier, tab_number, status, opened_at, closed_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'open', ?, NULL, ?, ?)`).bind(
      pendingTableTab.id, businessId, pendingTableTab.tableId, pendingTableTab.tableIdentifier,
      pendingTableTab.tabNumber, pendingTableTab.openedAt, pendingTableTab.openedAt, pendingTableTab.openedAt,
    )
    : null
  const reservationStatement = pendingReservation
    ? db.prepare(`INSERT INTO table_reservations (
      id, business_id, order_id, table_id, table_name_snapshot, status,
      scheduled_for, ends_at, duration_minutes, revision,
      converted_table_tab_id, converted_at, cancelled_at, no_show_at,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'reserved', ?, ?, ?, 1, NULL, NULL, NULL, NULL, ?, ?)`).bind(
      pendingReservation.id,
      businessId,
      orderId,
      pendingReservation.tableId,
      pendingReservation.tableName,
      pendingReservation.scheduledFor,
      pendingReservation.endsAt,
      TABLE_RESERVATION_DURATION_MINUTES,
      createdAt,
      createdAt,
    )
    : null
  const statements = [
    ...policyGuards,
    ...(reservationTableGuard ? [reservationTableGuard] : []),
    ...(tableTabGuard ? [tableTabGuard, tableTabStatement] : []),
    orderStatement,
    contactSnapshotStatement,
    ...(reservationStatement ? [reservationStatement] : []),
  ]
  for (const item of pricedItems) {
    statements.push(db.prepare(`INSERT INTO order_items (id, business_id, order_id, product_id, name_snapshot, category_snapshot, size_snapshot, quantity, catalog_price_cents, unit_price_cents, price_reason, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      crypto.randomUUID(),
      businessId,
      orderId,
      item.product.id,
      item.product.name,
      item.product.category || '',
      productSnapshotSize(item.product),
      item.quantity,
      item.product.price_cents,
      item.product.price_cents,
      '',
      item.note || '',
      createdAt,
    ))
  }

  let paymentLabels = null
  if (paymentAllocations) {
    paymentLabels = new Map(policyExpectations.paymentMethods.methods.map(({ code, label }) => [code, label]))
    const receiptId = crypto.randomUUID()
    const paymentId = crypto.randomUUID()
    const paidAt = now.toISOString()
    const movementDate = getBusinessDate(now)
    const description = `${formatOrderDisplayNumber({ orderNumber }).replace('Pedido', 'Pagamento pedido')} · ${clientSnapshot}`
    const movementStatements = []
    statements.push(db.prepare(`INSERT INTO payment_receipts
      (id, business_id, table_tab_id, total_cents, paid_at, created_at)
      VALUES (?, ?, NULL, ?, ?, ?)`).bind(receiptId, businessId, totals.totalCents, paidAt, paidAt))
    for (const allocation of paymentAllocations) {
      const allocationId = crypto.randomUUID()
      const methodLabel = paymentLabels.get(allocation.methodCode)
      statements.push(db.prepare(`INSERT INTO payment_allocations
        (id, business_id, receipt_id, method_code, method_label, amount_cents, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(
        allocationId, businessId, receiptId, allocation.methodCode, methodLabel, allocation.amountCents, paidAt,
      ))
      statements.push(db.prepare(`UPDATE business_payment_methods SET first_used_at = ?
        WHERE business_id = ? AND code = ? AND first_used_at IS NULL`).bind(paidAt, businessId, allocation.methodCode))
      movementStatements.push(db.prepare(`INSERT INTO movements
        (id, business_id, type, category, description, value_cents, source, order_id, payment_id,
         movement_date, created_at, payment_method, updated_at, receipt_id, payment_allocation_id)
        VALUES (?, ?, 'entrada', 'Vendas', ?, ?, 'order-payment', ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
        crypto.randomUUID(), businessId, description, allocation.amountCents, orderId, paymentId,
        movementDate, paidAt, methodLabel, paidAt, receiptId, allocationId,
      ))
    }
    statements.push(db.prepare(`INSERT INTO payments
      (id, business_id, order_id, receipt_id, amount_cents, method, paid_at, created_at)
      VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`).bind(
      paymentId, businessId, orderId, receiptId, totals.totalCents, paidAt, paidAt,
    ))
    statements.push(...movementStatements)
  }

  if (status === 'Em preparo') {
    const business = await db.prepare('SELECT name FROM businesses WHERE id = ? LIMIT 1').bind(businessId).first()
    const printDocument = createOrderPrintDocument({
      businessName: business?.name || 'Estabelecimento',
      orderId,
      orderNumber,
      orderDate: input.orderDate,
      createdAt,
      type: input.type,
      scheduledFor: scheduledFor || '',
      scheduleLabel: scheduledFor ? (pendingReservation ? 'RESERVA' : 'AGENDADO') : '',
      customerIdentityType: customerIdentity.type,
      tableIdentifier,
      hasOptionalClient: Boolean(clientId),
      customer: {
        name: clientSnapshot,
        phone: clientPhoneSnapshot,
        address: clientAddressSnapshot,
      },
      items: pricedItems.map((item) => ({
        name: item.product.name,
        presentation: productSnapshotSize(item.product),
        quantity: item.quantity,
        note: item.note || '',
        unitPriceCents: item.product.price_cents,
      })),
      subtotalCents: totals.subtotalCents,
      deliveryFeeCents,
      adjustment: {
        type: adjustment.type || 'none',
        amountCents: totals.adjustmentAmountCents,
        reason: adjustment.reason || '',
      },
      totalCents: totals.totalCents,
      payment: {
        status: paymentAllocations ? 'Pago' : 'Pendente',
        method: paymentAllocations?.length === 1 ? paymentLabels.get(paymentAllocations[0].methodCode) : '',
      },
    })
    const automaticAvailableAt = resolveAutomaticOrderPrintAvailableAt({
      type: input.type,
      customerIdentityType: customerIdentity.type,
      orderDate: input.orderDate,
      createdAt,
      scheduledFor,
    }, scheduledOperations?.data?.timing)
    statements.push(prepareAutomaticPrintJobStatement(db, businessId, {
      orderId,
      copies: automaticCopies,
      document: printDocument,
      createdAt,
      availableAt: automaticAvailableAt,
    }))
  }

  if (policyGuards.length || tableTabGuard || reservationTableGuard) statements.push(clearSettingsAssertions(db, policyTxId))

  try {
    await db.batch([...statements, businessEvent(db,businessId,{action:'order.created',resourceType:'order',resourceId:orderId,now}), ...(paymentAllocations ? [businessEvent(db,businessId,{action:'payment.received',resourceType:'order',resourceId:orderId,now})] : []), ...(adjustment.type !== 'none' ? [businessEvent(db,businessId,{action:'order.price.adjusted',resourceType:'order',resourceId:orderId,now})] : [])])
  } catch (error) {
    const collided = await db.prepare('SELECT id FROM orders WHERE business_id = ? AND idempotency_key = ? LIMIT 1').bind(businessId, idempotencyKey).first()
    if (collided?.id) return loadOrderById(db, businessId, collided.id)
    if (String(error?.message || '').includes('TABLE_RESERVATION_CONFLICT')) {
      throw repositoryError(409, 'TABLE_RESERVATION_CONFLICT', 'Esta mesa já possui uma reserva nesse horário. Escolha outra mesa ou outro horário.')
    }
    if (/TABLE_TAB_NOT_OPEN/i.test(String(error?.message || ''))) {
      throw repositoryError(409, 'TABLE_TAB_CHANGED', 'A comanda mudou ou foi encerrada. Atualize os dados e tente novamente.')
    }
    if (pendingTableTab && String(error?.message || '').includes('SETTINGS_INVALID')) {
      throw repositoryError(409, 'TABLE_TAB_CHANGED', 'A comanda mudou ou foi encerrada. Atualize os dados e tente novamente.')
    }
    if (pendingReservation && String(error?.message || '').includes('SETTINGS_INVALID')) {
      throw repositoryError(409, 'TABLE_INACTIVE', 'A mesa está inativa. Atualize os dados e tente novamente.')
    }
    if (String(error?.message || '').includes('POLICY_CHANGED')) {
      rethrowPolicyChange(error)
    }
    throw error
  }

  return loadOrderById(db, businessId, orderId)
}

export const updateOrderStatus = async (db, businessId, id, now = new Date()) => {
  const order = await loadOrderById(db, businessId, id)
  if (!order) return null
  if (order.status === 'Finalizado') return order
  if (order.status === 'Cancelado') throw repositoryError(409, 'ORDER_ALREADY_CANCELLED', 'Pedido cancelado não pode ser reaberto ou finalizado novamente.')
  if (order.status !== 'Em preparo') throw repositoryError(409, 'ORDER_STATUS_CHANGED', 'O estado do pedido mudou. Atualize os dados e tente novamente.')
  const operations = await loadOperations(db, businessId)
  const txId = crypto.randomUUID()
  const policyGuard = prepareSettingsAssertion(db, txId, 'policy',
    'coalesce((SELECT revision FROM business_operation_settings WHERE business_id = ?), 0) = ?',
    [businessId, operations.revision])
  const stateGuard = prepareSettingsAssertion(db, txId, 'state',
    "EXISTS (SELECT 1 FROM orders WHERE id = ? AND business_id = ? AND status = 'Em preparo' AND content_revision = ? AND total_cents = ?)",
    [id,businessId,Number(order.contentRevision||0),Math.round(Number(order.total||0)*100)])
  const update = db.prepare(`UPDATE orders SET status = 'Finalizado', finished_at = COALESCE(finished_at, ?),
    timing_policy_snapshot_json = COALESCE(timing_policy_snapshot_json, ?)
    WHERE id = ? AND business_id = ? AND status = 'Em preparo'`).bind(
    now.toISOString(), serializeOrderTimingPolicySnapshot(operations.data.timing), id, businessId)
  try {
    await db.batch([policyGuard, stateGuard, update, clearSettingsAssertions(db, txId), businessEvent(db,businessId,{action:'order.finalized',resourceType:'order',resourceId:id,now})])
  } catch (error) {
    const refreshed = await loadOrderById(db, businessId, id)
    if (refreshed?.status === 'Finalizado') return refreshed
    if (refreshed?.status === 'Cancelado') throw repositoryError(409, 'ORDER_ALREADY_CANCELLED', 'Pedido cancelado não pode ser reaberto ou finalizado novamente.')
    if (String(error?.message || '').includes('POLICY_CHANGED')) rethrowPolicyChange(error)
    if (String(error?.message || '').includes('SETTINGS_INVALID')) {
      throw repositoryError(409, 'ORDER_STATUS_CHANGED', 'O estado do pedido mudou. Atualize os dados e tente novamente.')
    }
    throw error
  }
  return loadOrderById(db, businessId, id)
}

export const closeTableTabIfSettled = async (db, businessId, tableTabId, now = new Date()) => {
  if (!tableTabId) return null
  const pending = await db.prepare(`SELECT COUNT(*) AS count
    FROM orders o LEFT JOIN payments p ON p.order_id = o.id AND p.business_id = o.business_id
    WHERE o.business_id = ? AND o.table_tab_id = ? AND o.status <> 'Cancelado' AND p.id IS NULL`).bind(businessId, tableTabId).first()
  if (Number(pending?.count || 0) > 0) return null

  const timestamp = now.toISOString()
  await registerCommittedEffect(db.prepare(`UPDATE table_tabs SET status = 'closed', closed_at = COALESCE(closed_at, ?), updated_at = ?
    WHERE id = ? AND business_id = ? AND status = 'open'`).bind(timestamp, timestamp, tableTabId, businessId),{businessId,topics:['tables'],orderIds:[]}).run()
  const row = await db.prepare(`SELECT id, table_id, table_identifier, tab_number, status, opened_at, closed_at FROM table_tabs
    WHERE id = ? AND business_id = ? LIMIT 1`).bind(tableTabId, businessId).first()
  return row ? mapTableTabRow(row) : null
}

export const createMovement = async (db, businessId, input, now = new Date()) => {
  const id = crypto.randomUUID()
  const createdAt = now.toISOString()
  const movementDate = getBusinessDate(now)
  await auditedMutation(db, businessId, db.prepare(`INSERT INTO movements (id, business_id, type, category, description, value_cents, source, order_id, payment_id, movement_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, businessId, input.type, input.category, input.description, input.valueCents, 'manual', null, null, movementDate, createdAt), {action:'finance.movement.created',resourceType:'movement',resourceId:id,now}).run()
  return mapMovementRow({ id, type: input.type, category: input.category, description: input.description, value_cents: input.valueCents, source: 'manual', order_id: null, payment_id: null, movement_date: movementDate, created_at: createdAt })
}
