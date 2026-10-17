import { registerCommittedEffect } from './realtime/committedEffects.js'
import { auditedMutation } from './access/audit.js'
import { isScheduledWaiting } from '../shared/orderTiming.js'
import { normalizeKitchenTvModality } from '../shared/kitchenTvModality.js'
import { loadOperations } from './operationSettingsRepository.js'

const SELECT_CONTROL = `SELECT business_id, revision, requested_page, requested_modality, updated_at,
  reported_revision, reported_page, reported_page_count,
  reported_viewport_width, reported_viewport_height,
  reported_visible_order_ids_json, reported_at
  FROM kitchen_tv_display_control WHERE business_id = ?`

const parseVisibleOrderIds = (value) => {
  if (!value) return []
  const parsed = JSON.parse(value)
  return Array.isArray(parsed) ? parsed.map(String) : []
}

const mapControl = (row) => ({
  revision: Number(row?.revision ?? 0),
  requestedPage: Number(row?.requested_page ?? 1),
  requestedModality: normalizeKitchenTvModality(row?.requested_modality),
  updatedAt: row?.updated_at ?? null,
  telemetry: row?.reported_at ? {
    appliedRevision: Number(row.reported_revision ?? 0),
    currentPage: Number(row.reported_page),
    pageCount: Number(row.reported_page_count),
    viewportWidth: Number(row.reported_viewport_width),
    viewportHeight: Number(row.reported_viewport_height),
    visibleOrderIds: parseVisibleOrderIds(row.reported_visible_order_ids_json),
    reportedAt: row.reported_at,
  } : null,
})

export async function loadKitchenTvControl(db, businessId) {
  return mapControl(await db.prepare(SELECT_CONTROL).bind(businessId).first())
}

export async function setKitchenTvRequestedPage(db, businessId, page, now = new Date()) {
  const updatedAt = now.toISOString()
  await auditedMutation(db,businessId,db.prepare(`INSERT INTO kitchen_tv_display_control (
      business_id, revision, requested_page, updated_at
    ) VALUES (?, 1, ?, ?)
    ON CONFLICT(business_id) DO UPDATE SET
      revision = kitchen_tv_display_control.revision + 1,
      requested_page = excluded.requested_page,
      updated_at = excluded.updated_at`)
    .bind(businessId, page, updatedAt),{action:'kitchen-tv.page.updated',resourceType:'settings',resourceId:'kitchen-tv',now}).run()
  return loadKitchenTvControl(db, businessId)
}

export async function setKitchenTvRequestedModality(db, businessId, modality, now = new Date()) {
  const requestedModality = normalizeKitchenTvModality(modality)
  const updatedAt = now.toISOString()
  await auditedMutation(db,businessId,db.prepare(`INSERT INTO kitchen_tv_display_control (
      business_id, revision, requested_page, requested_modality, updated_at
    ) VALUES (?, 1, 1, ?, ?)
    ON CONFLICT(business_id) DO UPDATE SET
      revision = kitchen_tv_display_control.revision + 1,
      requested_page = 1,
      requested_modality = excluded.requested_modality,
      updated_at = excluded.updated_at`)
    .bind(businessId, requestedModality, updatedAt),{action:'kitchen-tv.modality.updated',resourceType:'settings',resourceId:'kitchen-tv',now}).run()
  return loadKitchenTvControl(db, businessId)
}

export async function reportKitchenTvDisplay(db, businessId, report, now = new Date()) {
  const reportedAt = now.toISOString()
  const previous=(await loadKitchenTvControl(db,businessId)).telemetry
  const projection=value=>[value?.appliedRevision,value?.currentPage,value?.pageCount,value?.viewportWidth,value?.viewportHeight,value?.visibleOrderIds]
  const changed=JSON.stringify(projection(previous))!==JSON.stringify(projection(report))
  const statement = db.prepare(`INSERT INTO kitchen_tv_display_control (
      business_id, revision, requested_page, updated_at,
      reported_revision, reported_page, reported_page_count,
      reported_viewport_width, reported_viewport_height,
      reported_visible_order_ids_json, reported_at
    ) VALUES (?, 0, 1, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(business_id) DO UPDATE SET
      reported_revision = excluded.reported_revision,
      reported_page = excluded.reported_page,
      reported_page_count = excluded.reported_page_count,
      reported_viewport_width = excluded.reported_viewport_width,
      reported_viewport_height = excluded.reported_viewport_height,
      reported_visible_order_ids_json = excluded.reported_visible_order_ids_json,
      reported_at = excluded.reported_at`)
    .bind(
      businessId,
      reportedAt,
      report.appliedRevision,
      report.currentPage,
      report.pageCount,
      report.viewportWidth,
      report.viewportHeight,
      JSON.stringify(report.visibleOrderIds),
      reportedAt,
    )
  registerCommittedEffect(statement,changed?{businessId,topics:['kitchen-tv'],orderIds:[]}:null)
  await commitIdentityStatements(db,[prepareIdentityAssertion(db,crypto.randomUUID(),"SELECT EXISTS(SELECT 1 FROM businesses WHERE id=? AND lifecycle_status='enabled')",[businessId]),statement])
  return loadKitchenTvControl(db, businessId)
}

export async function listKitchenTvHiddenOrderIds(db, businessId) {
  const result = await db.prepare(`SELECT order_id
    FROM kitchen_tv_hidden_orders
    WHERE business_id = ?
    ORDER BY hidden_at ASC, order_id ASC`)
    .bind(businessId)
    .all()
  return (result?.results ?? []).map(({ order_id }) => String(order_id))
}

const loadVisibilityCandidate = async (db, businessId, orderId) => db.prepare(`SELECT
    id, status, type, order_date, created_at, scheduled_for, finished_at, cancelled_at
  FROM orders
  WHERE business_id = ? AND id = ?`)
  .bind(businessId, orderId)
  .first()

export async function getKitchenTvOrderControlEligibility(db, businessId, orderId, now = new Date()) {
  const order = await loadVisibilityCandidate(db, businessId, orderId)
  if (!order) return { exists: false, eligible: false }
  if (order.status !== 'Em preparo' || order.finished_at || order.cancelled_at) {
    return { exists: true, eligible: false }
  }

  const operations = await loadOperations(db, businessId)
  const timingOrder = {
    status: order.status,
    type: order.type,
    orderDate: order.order_date,
    createdAt: order.created_at,
    scheduledFor: order.scheduled_for,
  }
  return {
    exists: true,
    eligible: !isScheduledWaiting(timingOrder, now, operations.data.timing),
  }
}

export async function hideKitchenTvOrder(db, businessId, orderId, now = new Date()) {
  const eligibility = await getKitchenTvOrderControlEligibility(db, businessId, orderId, now)
  if (!eligibility.eligible) return false

  await auditedMutation(db,businessId,db.prepare(`INSERT OR IGNORE INTO kitchen_tv_hidden_orders
      (business_id, order_id, hidden_at)
    VALUES (?, ?, ?)`)
    .bind(businessId, orderId, now.toISOString()),{action:'kitchen-tv.order.hidden',resourceType:'order',resourceId:orderId,now}).run()
  return true
}

export async function restoreKitchenTvOrder(db, businessId, orderId, now = new Date()) {
  await auditedMutation(db,businessId,db.prepare('DELETE FROM kitchen_tv_hidden_orders WHERE business_id = ? AND order_id = ?')
    .bind(businessId, orderId),{action:'kitchen-tv.order.restored',resourceType:'order',resourceId:orderId,now}).run()
  return true
}
import { prepareIdentityAssertion, commitIdentityStatements } from './identity/transactions.js'
