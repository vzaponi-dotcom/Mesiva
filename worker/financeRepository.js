import { businessEvent, auditedMutation } from './access/audit.js'
import { getMovementCategoryLabel, normalizeMovementCategory } from '../shared/finance.js'
import { loadFinanceCategories, prepareFinanceCategoryUse } from './financeCategoryRepository.js'
import { clearSettingsAssertions, prepareSettingsAssertion } from './settingsTransactions.js'
import { centsToMoney } from './validation.js'
import { preparePolicyGuards, readPaymentMethodExpectation } from './operationalPolicyGuards.js'

const repositoryError = (status, code, message) => Object.assign(new Error(message), { status, code })
const policyChanged = () => repositoryError(409, 'POLICY_CHANGED', 'As categorias financeiras foram alteradas. Atualize e tente novamente.')
const movementChanged = () => repositoryError(409, 'MOVEMENT_CHANGED', 'O movimento foi alterado. Atualize e tente novamente.')

// Aliases m/p/a: allocation labels are receipt evidence, never evidence of a refund method.
export const MOVEMENT_PAYMENT_METHOD_SQL = `CASE WHEN m.source='order-payment'
  THEN COALESCE(NULLIF(m.payment_method,''),NULLIF(a.method_label,''),NULLIF(p.method,''))
  ELSE NULLIF(m.payment_method,'') END`

export const mapMovementRow = (row) => ({
  id: row.id,
  type: row.type,
  category: row.category,
  categoryLabel: row.category_label ?? getMovementCategoryLabel(row),
  description: row.description,
  value: centsToMoney(row.value_cents),
  source: row.source || 'manual',
  orderId: row.order_id ?? null,
  paymentId: row.payment_id ?? null,
  receiptId: row.receipt_id ?? null,
  paymentAllocationId: row.payment_allocation_id ?? null,
  paymentMethod: row.payment_method ?? null,
  movementDate: row.movement_date,
  date: row.movement_date,
  createdAt: row.created_at,
  updatedAt: row.updated_at ?? row.created_at,
})

export const mapFinanceSettingsRow = (row) => row ? ({
  openingBalance: centsToMoney(row.opening_balance_cents),
  openingDate: row.opening_date,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
}) : null

export const loadFinanceSettings = async (db, businessId) => {
  const row = await db.prepare(`SELECT business_id, opening_balance_cents, opening_date, created_at, updated_at
    FROM finance_settings WHERE business_id = ? LIMIT 1`).bind(businessId).first()
  return mapFinanceSettingsRow(row)
}

const MOVEMENT_COLUMNS = `id, business_id, type, category,
  (SELECT label FROM business_finance_categories fc
    WHERE fc.business_id = movements.business_id AND fc.id = movements.category) AS category_label,
  description, value_cents, source, order_id, payment_id, receipt_id, payment_allocation_id,
  payment_method, movement_date, created_at, updated_at`
const loadActiveMovementRow = (db, businessId, id) => db.prepare(`SELECT ${MOVEMENT_COLUMNS}
  FROM movements WHERE id = ? AND business_id = ? AND deleted_at IS NULL LIMIT 1`).bind(id, businessId).first()

const assertManualMovement = (row) => {
  if (row?.source !== 'manual') {
    throw repositoryError(409, 'MOVEMENT_MANAGED_BY_SYSTEM', 'Movimentos gerados por pedidos não podem ser alterados pelo Financeiro.')
  }
}

async function activeCategoryContext(db, businessId, input) {
  const policy = await loadFinanceCategories(db, businessId)
  const expectedRevision = input.expectedRevision ?? policy.revision
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw policyChanged()
  const category = policy.data.items.find((item) => item.id === input.category)
  if (!category || category.type !== input.type || !category.active) throw policyChanged()
  return { expectedRevision }
}

async function commitMovement(db, statements) {
  try {
    const results = await db.batch(statements)
    return mapMovementRow(results.at(-1).results[0])
  } catch (error) {
    if (String(error?.message).includes('POLICY_CHANGED')) throw policyChanged()
    if (String(error?.message).includes('SETTINGS_INVALID')) throw movementChanged()
    throw error
  }
}

export const createManualMovement = async (db, businessId, input, now = new Date()) => {
  const { expectedRevision } = await activeCategoryContext(db, businessId, input)
  const paymentExpectation = await readPaymentMethodExpectation(db, businessId, input.paymentMethod)
  const id = crypto.randomUUID()
  const timestamp = now.toISOString()
  const txId = crypto.randomUUID()
  const paymentTxId = crypto.randomUUID()
  const categoryPolicyStatements = prepareFinanceCategoryUse(
    db, businessId, input.category, expectedRevision, txId, now,
  )
  const insert = db.prepare(`INSERT INTO movements (
    id, business_id, type, category, description, value_cents,
    source, order_id, payment_id, payment_method, movement_date, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
    id, businessId, input.type, input.category, input.description, input.valueCents, 'manual', null, null,
    input.paymentMethod, input.movementDate, timestamp, timestamp,
  )
  const select = db.prepare(`SELECT ${MOVEMENT_COLUMNS} FROM movements
    WHERE id = ? AND business_id = ? AND deleted_at IS NULL`).bind(id, businessId)
  return commitMovement(db, [...preparePolicyGuards(db, businessId, { paymentMethods: paymentExpectation }, paymentTxId),
    ...categoryPolicyStatements, insert, clearSettingsAssertions(db, txId), clearSettingsAssertions(db, paymentTxId), businessEvent(db,businessId,{action:'finance.movement.created',resourceType:'movement',resourceId:id,now}), select])
}

export const updateManualMovement = async (db, businessId, id, input, now = new Date()) => {
  const current = await loadActiveMovementRow(db, businessId, id)
  if (!current) return null
  assertManualMovement(current)
  const retainingExistingReference = current.type === input.type &&
    normalizeMovementCategory(current) === normalizeMovementCategory(input)
  const retainingPaymentMethod = current.payment_method === input.paymentMethod
  const storedCategory = retainingExistingReference ? current.category : input.category
  const updatedAt = now.toISOString()
  const txId = crypto.randomUUID()
  const stateGuard = prepareSettingsAssertion(db, txId, 'state',
    `EXISTS (SELECT 1 FROM movements WHERE id = ? AND business_id = ? AND deleted_at IS NULL
      AND source = 'manual' AND type = ? AND category = ? AND payment_method IS ?)`,
    [id, businessId, current.type, current.category, current.payment_method])
  const update = db.prepare(`UPDATE movements SET type = ?, category = ?, description = ?, value_cents = ?,
    payment_method = ?, movement_date = ?, updated_at = ?
    WHERE id = ? AND business_id = ? AND deleted_at IS NULL AND source = 'manual'`).bind(
    input.type, storedCategory, input.description, input.valueCents, input.paymentMethod, input.movementDate,
    updatedAt, id, businessId,
  )
  const select = db.prepare(`SELECT ${MOVEMENT_COLUMNS} FROM movements
    WHERE id = ? AND business_id = ? AND deleted_at IS NULL`).bind(id, businessId)

  const paymentTxId = crypto.randomUUID()
  const paymentExpectation = retainingPaymentMethod ? null : await readPaymentMethodExpectation(db, businessId, input.paymentMethod)
  const paymentGuards = paymentExpectation ? preparePolicyGuards(db, businessId, { paymentMethods: paymentExpectation }, paymentTxId) : []
  let statements
  if (retainingExistingReference) {
    statements = [...paymentGuards, stateGuard, update, clearSettingsAssertions(db, txId),
      ...(paymentGuards.length ? [clearSettingsAssertions(db, paymentTxId)] : []), select]
  } else {
    const { expectedRevision } = await activeCategoryContext(db, businessId, input)
    const categoryPolicyStatements = prepareFinanceCategoryUse(
      db, businessId, input.category, expectedRevision, txId, now,
    )
    statements = [...paymentGuards, ...categoryPolicyStatements, stateGuard, update, clearSettingsAssertions(db, txId),
      ...(paymentGuards.length ? [clearSettingsAssertions(db, paymentTxId)] : []), select]
  }
  statements.splice(statements.length-1,0,businessEvent(db,businessId,{action:'finance.movement.updated',resourceType:'movement',resourceId:id,now}))
  return commitMovement(db, statements)
}

export const softDeleteManualMovement = async (db, businessId, id, now = new Date()) => {
  const current = await loadActiveMovementRow(db, businessId, id)
  if (!current) return null
  assertManualMovement(current)
  const timestamp = now.toISOString()
  await auditedMutation(db, businessId, db.prepare(`UPDATE movements SET deleted_at = ?, updated_at = ?
    WHERE id = ? AND business_id = ? AND deleted_at IS NULL`).bind(timestamp, timestamp, id, businessId), {action:'finance.movement.deleted',resourceType:'movement',resourceId:id,now}).run()
  return id
}

export const upsertFinanceSettings = async (db, businessId, input, now = new Date()) => {
  const timestamp = now.toISOString()
  await auditedMutation(db, businessId, db.prepare(`INSERT INTO finance_settings (business_id, opening_balance_cents, opening_date, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(business_id) DO UPDATE SET opening_balance_cents = excluded.opening_balance_cents,
      opening_date = excluded.opening_date, updated_at = excluded.updated_at`).bind(
    businessId, input.openingBalanceCents, input.openingDate, timestamp, timestamp,
  ), {action:'settings.finance.updated',resourceType:'settings',resourceId:'finance',now}).run()
  return loadFinanceSettings(db, businessId)
}
