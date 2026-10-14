import { businessEvent, auditedMutation, prepareAuditSelection, withAuditContext, auditContext } from './access/audit.js'
import { printingActor } from './access/printingAuthorization.js'
import { createTestPrintDocument } from '../shared/orderPrintDocument.js'
import { printDocumentEligibilitySql, canReadPrintJob } from './access/printingAuthorization.js'
import { isPrintQueueTerminal, resolvePrintQueueState } from '../shared/printQueue.js'
import { isForcePrintReason, isRetryablePrintJob } from '../shared/printQueueActions.js'
import { resolvePrintCopies } from '../shared/printContextPolicy.js'
import { clearSettingsAssertions } from './settingsTransactions.js'
import { preparePolicyGuards, readPrintingPolicyExpectation, rethrowPolicyChange } from './operationalPolicyGuards.js'

export const PRINT_PENDING_MAX_AGE_MS = 10 * 60 * 1000
export const PRINT_PROCESSING_MAX_AGE_MS = 2 * 60 * 1000
export const PRINT_STATION_HEARTBEAT_TIMEOUT_MS = 60 * 1000

const PRINT_STATION_PHYSICAL_STATES = new Set([
  'ready', 'verifying', 'printer_offline', 'printer_attention', 'qz_unavailable',
  'printer_not_found', 'unconfigured', 'unsupported',
])
const PRINT_RECOVERY_STATES = new Set(['normal', 'pending', 'active', 'deferred'])

const repositoryError = (status, code, message) => Object.assign(new Error(message), { status, code })
const rows = (result) => Array.isArray(result?.results) ? result.results : []
const timestamp = (value = new Date()) => value instanceof Date ? value.toISOString() : String(value)
const clampLimit = (value) => Math.min(200, Math.max(1, Number(value) || 100))
const assertCopies = (copies) => {
  const value = Number(copies)
  if (value !== 1 && value !== 2) throw repositoryError(400, 'INVALID_PRINT_COPIES', 'A quantidade de cópias deve ser 1 ou 2.')
  return value
}

const AUTOMATIC_ORDER_ELIGIBLE_SQL = `EXISTS (
  SELECT 1 FROM orders
  WHERE orders.id = print_jobs.order_id
    AND orders.business_id = print_jobs.business_id
    AND orders.status NOT IN ('Cancelado', 'Finalizado')
)`

const PRINT_JOB_SORT_SQL = Object.freeze({
  orderNumber: 'COALESCE(orders.order_number, table_tabs.tab_number)',
  jobId: 'print_jobs.id',
  status: 'print_jobs.status',
  trigger: 'print_jobs.trigger',
  createdAt: 'print_jobs.created_at',
})
const OPERATIONAL_PRINT_JOB_STATUSES = Object.freeze([
  'pending', 'processing', 'awaiting_confirmation', 'awaiting_second_copy', 'failed', 'requires_attention',
])
const PRINT_JOB_STATUS_FILTERS = Object.freeze({
  queued: ['pending'],
  waiting_station: ['pending'],
  printing: ['processing'],
  waiting_confirmation: ['awaiting_confirmation'],
  waiting_second_copy: ['awaiting_second_copy'],
  attention: ['failed', 'requires_attention'],
  printed: ['printed'],
  discarded: ['discarded'],
  pending: ['pending'],
  processing: ['processing'],
  awaiting_confirmation: ['awaiting_confirmation'],
  awaiting_second_copy: ['awaiting_second_copy'],
  failed: ['failed'],
  requires_attention: ['requires_attention'],
})
const PRINT_JOB_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

const LEGACY_FORCE_PRINT_REASON = 'ORDER_NOT_PRINTABLE'

const legacyForcePrintReason = async (db, businessId, job) => {
  if (job?.status !== 'requires_attention' || job?.trigger !== 'automatic' || job?.lastError?.code !== LEGACY_FORCE_PRINT_REASON) return null
  const order = await db.prepare(`SELECT status FROM orders WHERE id = ? AND business_id = ? LIMIT 1`)
    .bind(job.orderId, businessId).first()
  if (order?.status === 'Finalizado') return 'ORDER_FINALIZED_BEFORE_PRINT'
  if (order?.status === 'Cancelado') return 'ORDER_CANCELLED_BEFORE_PRINT'
  return null
}

const applyLegacyForcePrintReason = async (db, businessId, job) => {
  const reason = await legacyForcePrintReason(db, businessId, job)
  return reason ? { ...job, lastError: { ...job.lastError, code: reason } } : job
}

export const resolvePrintStationHealth = (station, now = new Date()) => {
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime()
  const seenMs = station?.lastSeenAt ? new Date(station.lastSeenAt).getTime() : Number.NaN
  const online = Number.isFinite(nowMs)
    && Number.isFinite(seenMs)
    && nowMs >= seenMs
    && nowMs - seenMs <= PRINT_STATION_HEARTBEAT_TIMEOUT_MS
  const qzReady = online && Boolean(station?.qzReady)
  const printerReady = online && Boolean(station?.printerReady)
  const physicalReady = (station?.physicalState ?? 'ready') === 'ready'
  const ready = Boolean(
    online
    && station?.isPrimary
    && station?.platform === 'windows'
    && qzReady
    && printerReady
    && physicalReady
  )
  return {
    online,
    qzReady,
    printerReady,
    ready,
    automaticReady: ready && Boolean(station?.autoPrintEnabled),
  }
}

const mapStationRow = (row, now = new Date()) => {
  if (!row) return null
  const station = {
    id: row.id,
    name: row.name,
    platform: row.platform,
    isPrimary: Boolean(row.is_primary),
    autoPrintEnabled: Boolean(row.auto_print_enabled),
    defaultCopies: Number(row.default_copies) || 2,
    configRevision: Number(row.config_revision) || 1,
    lastSeenAt: row.last_seen_at ?? null,
    qzReady: Boolean(row.qz_ready),
    printerReady: Boolean(row.printer_ready),
    lastReadyAt: row.last_ready_at ?? null,
    physicalState: row.physical_state ?? 'ready',
    physicalStatusText: row.physical_status_text ?? null,
    physicalStatusCode: row.physical_status_code ?? null,
    physicalStatusAt: row.physical_status_at ?? null,
    lastOfflineAt: row.last_offline_at ?? null,
    recoveryState: row.recovery_state ?? 'normal',
    recoveryJobId: row.recovery_job_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
  return { ...station, health: resolvePrintStationHealth(station, now) }
}

const mapJobRow = (row) => row ? ({
  id: row.id,
  orderId: row.order_id ?? null,
  tableTabId: row.table_tab_id ?? null,
  type: row.type,
  trigger: row.trigger,
  status: row.status,
  priority: Number(row.priority || 0),
  parentJobId: row.parent_job_id ?? null,
  copiesRequested: Number(row.copies_requested),
  copiesPrinted: Number(row.copies_printed || 0),
  stationId: row.station_id ?? null,
  document: JSON.parse(row.snapshot_json),
  createdAt: row.created_at,
  availableAt: row.available_at ?? row.created_at,
  processingStartedAt: row.processing_started_at ?? null,
  processedAt: row.processed_at ?? null,
  discardedAt: row.discarded_at ?? null,
  attentionReason: row.attention_reason ?? null,
  actionActorLabel: row.action_actor_label ?? null,
  actionAt: row.action_at ?? null,
  secondCopyPromptedAt: row.second_copy_prompted_at ?? null,
  secondCopyRequestedAt: row.second_copy_requested_at ?? null,
  secondCopySkippedAt: row.second_copy_skipped_at ?? null,
  lastError: row.last_error_code
    ? { code: row.last_error_code, message: row.last_error_message || '' }
    : null,
}) : null

const loadPrintStation = async (db, businessId, stationId, now = new Date()) => {
  const row = await db.prepare(`SELECT * FROM print_stations WHERE id = ? AND business_id = ? LIMIT 1`)
    .bind(stationId, businessId).first()
  return mapStationRow(row, now)
}

const loadPrimaryPrintStation = async (db, businessId, now = new Date()) => {
  const row = await db.prepare(`SELECT * FROM print_stations
    WHERE business_id = ? AND is_primary = 1
    LIMIT 1`).bind(businessId).first()
  return mapStationRow(row, now)
}

export const listPrintStations = async (db, businessId, now = new Date()) => {
  const result = await db.prepare(`SELECT * FROM print_stations
    WHERE business_id = ? ORDER BY created_at ASC, id ASC`)
    .bind(businessId).all()
  return rows(result).map((row) => mapStationRow(row, now))
}

export const upsertPrintStation = async (db, businessId, input, now = new Date()) => {
  const id = String(input.id || '')
  if (!id) throw repositoryError(400, 'PRINT_STATION_ID_REQUIRED', 'Identificador da estação é obrigatório.')
  const name = String(input.name || '').trim()
  if (!name) throw repositoryError(400, 'PRINT_STATION_NAME_REQUIRED', 'Nome da estação é obrigatório.')
  const platform = ['windows', 'android', 'other'].includes(input.platform) ? input.platform : 'other'
  const copies = assertCopies(input.defaultCopies ?? 2)
  const at = timestamp(now)

  await auditedMutation(db,businessId,db.prepare(`INSERT INTO print_stations (
      id, business_id, name, platform, is_primary, auto_print_enabled, default_copies,
      last_seen_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING`).bind(id, businessId, name, platform, input.autoPrintEnabled ? 1 : 0, copies, at, at, at),{action:'printing.station.updated',resourceType:'print-station',resourceId:id,now}).run()

  const station = await loadPrintStation(db, businessId, id, now)
  if (!station) throw repositoryError(409, 'PRINT_STATION_ID_CONFLICT', 'Esta estação pertence a outro negócio.')
  return station
}

export const setPrimaryPrintStation = async (db, businessId, stationId, now = new Date()) => {
  const station = await loadPrintStation(db, businessId, stationId, now)
  if (!station) throw repositoryError(404, 'PRINT_STATION_NOT_FOUND', 'Estação de impressão não encontrada.')
  const at = timestamp(now)
  await db.batch([
    db.prepare(`UPDATE print_stations SET is_primary = 0, updated_at = ?
      WHERE business_id = ? AND is_primary = 1 AND id <> ?`).bind(at, businessId, stationId),
    db.prepare(`UPDATE print_stations SET is_primary = 1, updated_at = ?
      WHERE id = ? AND business_id = ?`).bind(at, stationId, businessId),businessEvent(db,businessId,{action:'printing.primary.updated',resourceType:'print-station',resourceId:stationId,now,onlyIfChanged:true}),
  ])
  return loadPrintStation(db, businessId, stationId, now)
}

export const touchPrintStation = async (db, businessId, stationId, now = new Date()) => {
  const at = timestamp(now)
  const row = await db.prepare(`UPDATE print_stations SET last_seen_at = ?, updated_at = ?
    WHERE id = ? AND business_id = ?
    RETURNING *`)
    .bind(at, at, stationId, businessId).first()
  return mapStationRow(row, now)
}

export const loadPrimaryAutomaticPrintStation = async (db, businessId, now = new Date()) => {
  const row = await db.prepare(`SELECT * FROM print_stations
    WHERE business_id = ? AND is_primary = 1 AND auto_print_enabled = 1
    LIMIT 1`).bind(businessId).first()
  return mapStationRow(row, now)
}

export const prepareAutomaticPrintJobStatement = (db, businessId, input) => {
  const id = String(input.id || crypto.randomUUID())
  const copies = assertCopies(input.copies)
  const createdAt = timestamp(input.createdAt || new Date())
  return db.prepare(`INSERT INTO print_jobs (
      id, business_id, order_id, type, trigger, status, copies_requested, copies_printed,
      station_id, snapshot_json, created_at, available_at, processing_started_at, processed_at,
      last_error_code, last_error_message
    ) VALUES (?, ?, ?, 'order', 'automatic', 'pending', ?, 0, NULL, ?, ?, ?, NULL, NULL, NULL, NULL)`)
    .bind(id, businessId, input.orderId, copies, JSON.stringify(input.document), createdAt, timestamp(input.availableAt || input.createdAt || new Date()))
}

export const loadPrintJob = async (db, businessId, jobId) => {
  const row = await db.prepare(`SELECT * FROM print_jobs WHERE id = ? AND business_id = ? LIMIT 1`)
    .bind(jobId, businessId).first()
  return mapJobRow(row)
}

export const loadAutomaticPrintJobForOrder = async (db, businessId, orderId) => {
  const row = await db.prepare(`SELECT * FROM print_jobs
    WHERE business_id = ? AND order_id = ? AND type = 'order' AND trigger = 'automatic'
    LIMIT 1`).bind(businessId, orderId).first()
  return mapJobRow(row)
}

const routeIneligibleAutomaticJobsToAttention = async (db, businessId, now = new Date()) => {
  const at = timestamp(now)
  await db.prepare(`UPDATE print_jobs SET
      status = 'requires_attention', processed_at = ?,
      last_error_code = CASE WHEN (SELECT status FROM orders WHERE orders.id = print_jobs.order_id AND orders.business_id = print_jobs.business_id) = 'Finalizado' THEN 'ORDER_FINALIZED_BEFORE_PRINT' ELSE 'ORDER_CANCELLED_BEFORE_PRINT' END,
      last_error_message = 'O pedido foi finalizado ou cancelado antes da impressão automática.'
    WHERE business_id = ? AND type = 'order' AND trigger = 'automatic' AND status = 'pending'
      AND (last_error_code IS NULL OR last_error_code <> 'FORCE_PRINT_AUTHORIZED')
      AND NOT (copies_requested = 2 AND copies_printed = 1 AND second_copy_requested_at IS NOT NULL AND second_copy_skipped_at IS NULL)
      AND NOT ${AUTOMATIC_ORDER_ELIGIBLE_SQL}`)
    .bind(at, businessId).run()
}

const agePrintJobs = async (db, businessId, now = new Date()) => {
  const at = now instanceof Date ? now : new Date(now)
  const processedAt = at.toISOString()
  const processingCutoff = new Date(at.getTime() - PRINT_PROCESSING_MAX_AGE_MS).toISOString()

  await routeIneligibleAutomaticJobsToAttention(db, businessId, at)
  const unresolvedSubmittedAttempt = `EXISTS (
    SELECT 1 FROM print_job_attempts a
    WHERE a.business_id = print_jobs.business_id
      AND a.job_id = print_jobs.id
      AND a.submission_started_at IS NOT NULL
      AND a.resolution IS NULL
      AND a.status <> 'complete'
  )`
  // Keep each status branch indexable; an outer OR previously walked the
  // entire tenant history and repeated a business-wide attempt lookup per job.
  const safeStaleCandidates = `SELECT print_jobs.id FROM print_jobs
    WHERE print_jobs.business_id = ? AND print_jobs.status = 'processing'
      AND print_jobs.processing_started_at <= ? AND NOT ${unresolvedSubmittedAttempt}
    UNION
    SELECT print_jobs.id FROM print_jobs
    WHERE print_jobs.business_id = ? AND print_jobs.status = 'requires_attention'
      AND print_jobs.last_error_code = 'PRINT_OUTCOME_UNKNOWN'
      AND NOT ${unresolvedSubmittedAttempt}`
  const safeBindings = [businessId, processingCutoff, businessId]

  const expiredAttempt = `a.business_id = ? AND a.status IN ('submitting', 'spooling', 'printing')
    AND a.resolution IS NULL AND a.submission_started_at <= ?`
  // Drive the selection from unresolved attempts, rather than probing attempts
  // for every historical job. DISTINCT emits one audit event per matching job.
  // The unknown branch remains valid after the preceding attempt UPDATE.
  const timeoutCandidates = `SELECT DISTINCT print_jobs.id,
    (SELECT s.id FROM print_stations s WHERE s.business_id=print_jobs.business_id
      AND s.id=COALESCE((SELECT a.station_id FROM print_job_attempts a
        WHERE a.business_id=print_jobs.business_id AND a.job_id=print_jobs.id
          AND a.resolution IS NULL AND a.submission_started_at IS NOT NULL
        ORDER BY a.attempt_number DESC LIMIT 1),print_jobs.station_id)) AS station_id
    FROM (
      SELECT a.job_id FROM print_job_attempts a WHERE ${expiredAttempt}
      UNION ALL
      SELECT a.job_id FROM print_job_attempts a
      JOIN print_jobs j ON j.id=a.job_id AND j.business_id=a.business_id
      WHERE a.business_id=? AND a.status='unknown' AND a.resolution IS NULL
        AND j.status IN ('awaiting_confirmation','processing')
    ) candidates
    CROSS JOIN print_jobs
    WHERE print_jobs.id=candidates.job_id AND print_jobs.business_id=?`
  const candidateBindings = [businessId,processingCutoff,businessId,businessId]
  // Polling is not human execution. Stored station associations are validated
  // by the tenant join above, without requiring the timed-out station online.
  const systemDb=withAuditContext(db,{businessId,actorType:'system'})
  await db.batch([
    prepareAuditSelection(systemDb,businessId,{action:'printing.requeued',resourceType:'print-job',outcome:'safe_unsubmitted',now:at},
      safeStaleCandidates,safeBindings),
    db.prepare(`UPDATE print_jobs SET
      status = 'pending', station_id = NULL, processing_started_at = NULL, processed_at = NULL,
      second_copy_requested_at = CASE
        WHEN copies_printed > 0 AND copies_printed < copies_requested
          THEN COALESCE(second_copy_requested_at, ?)
        ELSE second_copy_requested_at
      END,
      last_error_code = NULL, last_error_message = NULL
      WHERE id IN (SELECT id FROM (${safeStaleCandidates})) AND business_id = ?`)
      .bind(processedAt,...safeBindings,businessId),
    prepareAuditSelection(systemDb,businessId,{action:'printing.outcome.observed',resourceType:'print-job',outcome:'unknown',now:at},
      timeoutCandidates,candidateBindings,{stationFromSelection:true}),
    db.prepare(`UPDATE print_job_attempts AS a SET
      status = 'unknown', last_event_at = ?, last_error_code = 'PRINT_OUTCOME_UNKNOWN',
      last_error_message = 'O resultado físico da impressão não foi confirmado.', updated_at = ?
      WHERE ${expiredAttempt}`).bind(processedAt,processedAt,businessId,processingCutoff),
    db.prepare(`UPDATE print_jobs SET
      status = 'requires_attention', processed_at = ?, last_error_code = 'PRINT_OUTCOME_UNKNOWN',
      last_error_message = 'O resultado físico da impressão não foi confirmado.'
      WHERE id IN (SELECT id FROM (${timeoutCandidates}))
        AND business_id=? AND status IN ('awaiting_confirmation','processing')`)
      .bind(processedAt,...candidateBindings,businessId),
  ])
}

const mapPrintQueueJobs = async (db, businessId, result, now) => {
  const station = await loadPrimaryPrintStation(db, businessId, now)
  return Promise.all(rows(result).map(async (row) => {
    const job = await applyLegacyForcePrintReason(db, businessId, mapJobRow(row))
    const attempt = await db.prepare(`SELECT id, status, resolution FROM print_job_attempts
      WHERE business_id = ? AND job_id = ? AND status = 'unknown' AND resolution IS NULL
      ORDER BY attempt_number DESC LIMIT 1`).bind(businessId, job.id).first()
    const stationReady = job?.trigger === 'automatic'
      ? Boolean(station?.health?.automaticReady)
      : Boolean(station?.health?.ready)
    return {
      ...job,
      attempt: attempt ? { id: attempt.id, status: attempt.status, resolution: attempt.resolution ?? null } : null,
      queueState: resolvePrintQueueState(job.status, { stationReady }),
    }
  }))
}

const isLegacyPrintJobRead = (options) => options.orderId || ![
  'scope', 'page', 'pageSize', 'sortBy', 'sortDir', 'status', 'trigger', 'search',
].some((key) => Object.hasOwn(options, key))

const normalizePage = (value) => Math.max(1, Math.floor(Number(value) || 1))
const normalizePageSize = (value) => Math.min(10, Math.max(1, Math.floor(Number(value) || 10)))

export const purgeExpiredTerminalPrintJobs = async (db, businessId, now = new Date()) => {
  const at = now instanceof Date ? now : new Date(now)
  const cutoff = new Date(at.getTime() - PRINT_JOB_RETENTION_MS).toISOString()
  const result = await db.prepare(`DELETE FROM print_jobs
    WHERE business_id = ? AND status IN ('printed', 'discarded')
      AND COALESCE(processed_at, discarded_at, created_at) <= ?`)
    .bind(businessId, cutoff).run()
  return Number(result?.meta?.changes || 0)
}

export const getPrintQueueSummary = async (db, businessId, now = new Date()) => {
  const at = now instanceof Date ? now : new Date(now)
  await purgeExpiredTerminalPrintJobs(db, businessId, at)
  const startOfToday = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate())).toISOString()
  const row = await db.prepare(`SELECT
      SUM(CASE WHEN status NOT IN ('printed', 'discarded') THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status = 'awaiting_confirmation' THEN 1 ELSE 0 END) AS awaiting_confirmation,
      SUM(CASE WHEN status = 'awaiting_second_copy' THEN 1 ELSE 0 END) AS awaiting_second_copy,
      SUM(CASE WHEN status IN ('failed', 'requires_attention') THEN 1 ELSE 0 END) AS attention,
      SUM(CASE WHEN status IN ('pending', 'queued', 'failed', 'requires_attention', 'awaiting_second_copy')
        AND NOT EXISTS (
          SELECT 1 FROM print_job_attempts
          WHERE print_job_attempts.business_id = print_jobs.business_id
            AND print_job_attempts.job_id = print_jobs.id
            AND print_job_attempts.submission_started_at IS NOT NULL
            AND print_job_attempts.resolution IS NULL
            AND print_job_attempts.status <> 'complete'
        ) THEN 1 ELSE 0 END) AS discardable,
      SUM(CASE WHEN status = 'printed' AND COALESCE(processed_at, created_at) >= ? THEN 1 ELSE 0 END) AS completed_today,
      SUM(CASE WHEN status = 'pending' AND copies_printed = 0 AND NOT EXISTS (
        SELECT 1 FROM print_job_attempts
        WHERE print_job_attempts.business_id = print_jobs.business_id
          AND print_job_attempts.job_id = print_jobs.id
          AND print_job_attempts.submission_started_at IS NOT NULL
      ) THEN 1 ELSE 0 END) AS safe_backlog
    FROM print_jobs WHERE business_id = ?`).bind(startOfToday, businessId).first()
  return {
    active: Number(row?.active || 0),
    pending: Number(row?.pending || 0),
    awaitingConfirmation: Number(row?.awaiting_confirmation || 0),
    awaitingSecondCopy: Number(row?.awaiting_second_copy || 0),
    attention: Number(row?.attention || 0),
    discardable: Number(row?.discardable || 0),
    completedToday: Number(row?.completed_today || 0),
    safeBacklog: Number(row?.safe_backlog || 0),
  }
}

export const listPrintJobs = async (db, businessId, options = {}) => {
  const now = options.now || new Date()
  await purgeExpiredTerminalPrintJobs(db, businessId, now)
  await agePrintJobs(db, businessId, now)

  if (isLegacyPrintJobRead(options)) {
    const limit = clampLimit(options.limit)
    const result = options.orderId
      ? await db.prepare(`SELECT * FROM print_jobs WHERE business_id = ? AND order_id = ?
        ORDER BY priority DESC, COALESCE(available_at, created_at) ASC, created_at ASC, id ASC
        LIMIT ?`).bind(businessId, options.orderId, limit).all()
      : await db.prepare(`SELECT * FROM print_jobs WHERE business_id = ?
        ORDER BY priority DESC, COALESCE(available_at, created_at) ASC, created_at ASC, id ASC
        LIMIT ?`).bind(businessId, limit).all()
    return mapPrintQueueJobs(db, businessId, result, now)
  }

  const statusFilter = String(options.status || '').trim().toLowerCase()
  const statuses = PRINT_JOB_STATUS_FILTERS[statusFilter] || OPERATIONAL_PRINT_JOB_STATUSES
  const pageSize = normalizePageSize(options.pageSize)
  const page = normalizePage(options.page)
  const sortBy = PRINT_JOB_SORT_SQL[options.sortBy] ? options.sortBy : 'createdAt'
  const sortDir = String(options.sortDir).toLowerCase() === 'asc' ? 'asc' : 'desc'
  const filters = [`print_jobs.business_id = ?`, `print_jobs.status IN (${statuses.map(() => '?').join(', ')})`]
  const bindings = [businessId, ...statuses]
  if (statusFilter === 'queued' || statusFilter === 'waiting_station') {
    const station = await loadPrimaryPrintStation(db, businessId, now)
    const wantsReady = statusFilter === 'queued'
    const matchingTriggers = []
    if (Boolean(station?.health?.automaticReady) === wantsReady) matchingTriggers.push('automatic')
    if (Boolean(station?.health?.ready) === wantsReady) matchingTriggers.push('manual')
    if (matchingTriggers.length === 0) filters.push('1 = 0')
    else {
      filters.push(`print_jobs.trigger IN (${matchingTriggers.map(() => '?').join(', ')})`)
      bindings.push(...matchingTriggers)
    }
  }
  if (options.trigger && ['automatic', 'manual'].includes(options.trigger)) {
    filters.push('print_jobs.trigger = ?')
    bindings.push(options.trigger)
  }
  const search = String(options.search || '').trim()
  if (search) {
    const pattern = `%${search}%`
    filters.push(`(CAST(orders.order_number AS TEXT) LIKE ? COLLATE NOCASE
      OR CAST(table_tabs.tab_number AS TEXT) LIKE ? COLLATE NOCASE
      OR orders.client_name_snapshot LIKE ? COLLATE NOCASE
      OR table_tabs.table_identifier LIKE ? COLLATE NOCASE)`)
    bindings.push(pattern, pattern, pattern, pattern)
  }
  const joins = `FROM print_jobs
    LEFT JOIN orders ON orders.id = print_jobs.order_id AND orders.business_id = print_jobs.business_id
    LEFT JOIN table_tabs ON table_tabs.id = COALESCE(print_jobs.table_tab_id, orders.table_tab_id) AND table_tabs.business_id = print_jobs.business_id`
  const where = `WHERE ${filters.join(' AND ')}`
  const count = await db.prepare(`SELECT COUNT(*) AS count ${joins} ${where}`).bind(...bindings).first()
  const totalItems = Number(count?.count || 0)
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
  const offset = (Math.min(page, totalPages) - 1) * pageSize
  const result = await db.prepare(`SELECT print_jobs.* ${joins} ${where}
    ORDER BY ${PRINT_JOB_SORT_SQL[sortBy]} ${sortDir.toUpperCase()}, print_jobs.created_at DESC, print_jobs.id ASC
    LIMIT ? OFFSET ?`).bind(...bindings, pageSize, offset).all()
  const jobs = await mapPrintQueueJobs(db, businessId, result, now)
  return {
    jobs,
    pageInfo: { page: Math.min(page, totalPages), pageSize, totalItems, totalPages },
  }
}

export const createManualOrderPrintJob = async (db, businessId, input, now = new Date()) => {
  const expectation = input.copies === undefined ? await readPrintingPolicyExpectation(db, businessId) : null
  const orderContext = expectation
    ? await db.prepare(`SELECT customer_identity_type, table_tab_id FROM orders
      WHERE id = ? AND business_id = ? LIMIT 1`).bind(input.orderId, businessId).first()
    : null
  const copies = resolvePrintCopies({
    jobType: 'order',
    customerIdentityType: orderContext?.customer_identity_type,
    tableTabId: orderContext?.table_tab_id,
    explicitCopies: input.copies,
    policy: expectation?.policy,
  })
  const at = timestamp(now)
  const id = String(input.id || crypto.randomUUID())
  const statement = db.prepare(`INSERT INTO print_jobs (
      id, business_id, order_id, type, trigger, status, copies_requested, copies_printed,
      station_id, snapshot_json, created_at, available_at, processing_started_at, processed_at,
      last_error_code, last_error_message, action_actor_label, action_at
    ) VALUES (?, ?, ?, 'order', 'manual', 'pending', ?, 0, NULL, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?)`)
    .bind(id, businessId, input.orderId, copies, JSON.stringify(input.document), at, at, input.actorLabel ?? null, input.actorLabel ? at : null)
  if (expectation) {
    const txId = crypto.randomUUID()
    try {
      await db.batch([
        ...preparePolicyGuards(db, businessId, { printing: expectation }, txId),
        statement,
        clearSettingsAssertions(db, txId), businessEvent(db,businessId,{action:'printing.requested',resourceType:'print-job',resourceId:id,now}),
      ])
    } catch (error) { rethrowPolicyChange(error) }
  } else await auditedMutation(db,businessId,statement,{action:'printing.requested',resourceType:'print-job',resourceId:id,now}).run()
  return loadPrintJob(db, businessId, id)
}

export const createManualTableTabPrintJob = async (db, businessId, input, now = new Date()) => {
  const expectation = input.copies === undefined ? await readPrintingPolicyExpectation(db, businessId) : null
  const copies = resolvePrintCopies({
    jobType: 'table-tab',
    tableTabId: input.tableTabId,
    explicitCopies: input.copies,
    policy: expectation?.policy,
  })
  const at = timestamp(now)
  const id = String(input.id || crypto.randomUUID())
  const statement = db.prepare(`INSERT INTO print_jobs (
      id, business_id, order_id, table_tab_id, type, trigger, status, copies_requested, copies_printed,
      station_id, snapshot_json, created_at, available_at, processing_started_at, processed_at,
      last_error_code, last_error_message, action_actor_label, action_at
    ) VALUES (?, ?, NULL, ?, 'table-tab', 'manual', 'pending', ?, 0, NULL, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?)`)
    .bind(id, businessId, input.tableTabId, copies, JSON.stringify(input.document), at, at, input.actorLabel ?? null, input.actorLabel ? at : null)
  if (expectation) {
    const txId = crypto.randomUUID()
    try {
      await db.batch([
        ...preparePolicyGuards(db, businessId, { printing: expectation }, txId),
        statement,
        clearSettingsAssertions(db, txId), businessEvent(db,businessId,{action:'printing.requested',resourceType:'print-job',resourceId:id,now}),
      ])
    } catch (error) { rethrowPolicyChange(error) }
  } else await auditedMutation(db,businessId,statement,{action:'printing.requested',resourceType:'print-job',resourceId:id,now}).run()
  return loadPrintJob(db, businessId, id)
}

export const createTestPrintJob = async (db, businessId, input, now = new Date()) => {
  const station = await loadPrintStation(db, businessId, input.stationId, now)
  if (!station) throw repositoryError(404, 'PRINT_STATION_NOT_FOUND', 'Estação de impressão não encontrada.')
  const at = timestamp(now)
  const id = String(input.id || crypto.randomUUID())
  const document = input.document || createTestPrintDocument({ businessName: input.businessName, createdAt: at })
  await auditedMutation(db,businessId,db.prepare(`INSERT INTO print_jobs (
      id, business_id, order_id, type, trigger, status, copies_requested, copies_printed,
      station_id, snapshot_json, created_at, available_at, processing_started_at, processed_at,
      last_error_code, last_error_message, action_actor_label, action_at
    ) VALUES (?, ?, NULL, 'test', 'manual', 'pending', 1, 0, NULL, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?)`).bind(id, businessId, JSON.stringify(document), at, at, input.actorLabel ?? null, input.actorLabel ? at : null),{action:'printing.requested',resourceType:'print-job',resourceId:id,now}).run()
  return loadPrintJob(db, businessId, id)
}

const requireStation = async (db, businessId, stationId, now = new Date()) => {
  const station = await loadPrintStation(db, businessId, stationId, now)
  if (!station) throw repositoryError(404, 'PRINT_STATION_NOT_FOUND', 'Estação de impressão não encontrada.')
  return station
}

const requirePrimaryQzPrintStation = async (db, businessId, stationId, now = new Date()) => {
  const station = await requireStation(db, businessId, stationId, now)
  if (!station.isPrimary) {
    throw repositoryError(409, 'PRINT_STATION_NOT_PRIMARY', 'Somente a estação principal pode executar trabalhos de impressão.')
  }
  if (station.platform !== 'windows') {
    throw repositoryError(409, 'PRINT_STATION_NOT_QZ_EXECUTOR', 'Somente a estação principal Windows com QZ pode executar trabalhos de impressão.')
  }
  return station
}

export const heartbeatPrintStation = async (db, businessId, stationId, health = {}, now = new Date()) => {
  const previous = await requirePrimaryQzPrintStation(db, businessId, stationId, now)
  const at = timestamp(now)
  const qzReady = Boolean(health.qzReady)
  const printerReady = qzReady && Boolean(health.printerReady)
  const hasPhysicalState = Object.hasOwn(health, 'physicalState')
  const physicalState = hasPhysicalState ? String(health.physicalState || '') : previous.physicalState
  if (hasPhysicalState && !PRINT_STATION_PHYSICAL_STATES.has(physicalState)) {
    throw repositoryError(400, 'INVALID_PRINT_STATION_PHYSICAL_STATE', 'Invalid printer physical state.')
  }
  const physicalStatusText = health.physicalStatusText == null ? null : String(health.physicalStatusText).slice(0, 500)
  const physicalStatusCode = health.physicalStatusCode == null ? null : Number(health.physicalStatusCode)
  if (physicalStatusCode != null && !Number.isInteger(physicalStatusCode)) {
    throw repositoryError(400, 'INVALID_PRINT_STATION_PHYSICAL_STATUS_CODE', 'Invalid printer physical status code.')
  }
  const wasUnavailable = !previous.health.online
    || (previous.physicalState !== 'ready' && previous.physicalState !== 'verifying')
  const becameReady = wasUnavailable && resolvePrintStationHealth({
    ...previous, lastSeenAt: at, qzReady, printerReady, physicalState,
  }, now).ready
  const row = hasPhysicalState
    ? await db.prepare(`UPDATE print_stations SET
        last_seen_at = ?, qz_ready = ?, printer_ready = ?,
        physical_state = ?, physical_status_text = ?, physical_status_code = ?, physical_status_at = ?,
        last_offline_at = CASE WHEN ? = 'printer_offline' THEN ? ELSE last_offline_at END,
        last_ready_at = CASE WHEN ? = 1 AND ? = 1 AND ? = 'ready' THEN ? ELSE last_ready_at END,
        updated_at = ?
      WHERE id = ? AND business_id = ?
      RETURNING *`)
      .bind(at, qzReady ? 1 : 0, printerReady ? 1 : 0, physicalState, physicalStatusText, physicalStatusCode, at,
        physicalState, at, qzReady ? 1 : 0, printerReady ? 1 : 0, physicalState, at, at, stationId, businessId)
      .first()
    : await db.prepare(`UPDATE print_stations SET
        last_seen_at = ?, qz_ready = ?, printer_ready = ?,
        last_ready_at = CASE WHEN ? = 1 AND ? = 1 THEN ? ELSE last_ready_at END,
        updated_at = ?
      WHERE id = ? AND business_id = ?
      RETURNING *`)
      .bind(at, qzReady ? 1 : 0, printerReady ? 1 : 0, qzReady ? 1 : 0, printerReady ? 1 : 0, at, at, stationId, businessId)
      .first()
  if (!row) throw repositoryError(404, 'PRINT_STATION_NOT_FOUND', 'Estação de impressão não encontrada.')
  const station = mapStationRow(row, now)
  if (!hasPhysicalState || !becameReady || station.recoveryState !== 'normal') return station
  const recovered = await db.prepare(`UPDATE print_stations SET recovery_state = 'pending', updated_at = ?
    WHERE id = ? AND business_id = ? AND recovery_state = 'normal'
      AND EXISTS (
        SELECT 1 FROM print_jobs
        WHERE print_jobs.business_id = print_stations.business_id
          AND print_jobs.status = 'pending' AND print_jobs.copies_printed = 0
          AND NOT EXISTS (
            SELECT 1 FROM print_job_attempts
            WHERE print_job_attempts.business_id = print_jobs.business_id
              AND print_job_attempts.job_id = print_jobs.id
              AND print_job_attempts.submission_started_at IS NOT NULL
          )
      )
    RETURNING *`).bind(at, stationId, businessId).first()
  return mapStationRow(recovered || row, now)
}

export const setPrintRecoveryState = async (db, businessId, stationId, state, now = new Date()) => {
  const nextState = String(state || '')
  if (!PRINT_RECOVERY_STATES.has(nextState)) {
    throw repositoryError(400, 'INVALID_PRINT_RECOVERY_STATE', 'Invalid print recovery state.')
  }
  const at = timestamp(now)
  const row = await auditedMutation(db,businessId,db.prepare(`UPDATE print_stations SET recovery_state = ?,
      recovery_job_id = CASE WHEN ? = 'normal' THEN NULL ELSE recovery_job_id END, updated_at = ?
    WHERE id = ? AND business_id = ? AND (
      (recovery_state = 'normal' AND ? = 'pending')
      OR (recovery_state = 'pending' AND ? IN ('active', 'deferred', 'normal'))
      OR (recovery_state = 'active' AND ? IN ('active', 'deferred', 'normal'))
      OR (recovery_state = 'deferred' AND ? IN ('active', 'normal'))
    ) AND (
      ? <> 'normal' OR recovery_job_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM print_jobs
        WHERE id = print_stations.recovery_job_id AND business_id = print_stations.business_id
          AND status NOT IN ('printed', 'discarded')
      )
    ) RETURNING *`).bind(nextState, nextState, at, stationId, businessId,
      nextState, nextState, nextState, nextState, nextState),{action:'printing.recovery.updated',resourceType:'print-station',resourceId:stationId,now}).first()
  if (row) return mapStationRow(row, now)
  const station = await loadPrintStation(db, businessId, stationId, now)
  if (!station) throw repositoryError(404, 'PRINT_STATION_NOT_FOUND', 'Print station not found.')
  if (nextState === 'normal' && station.recoveryJobId) {
    const recoveryJob = await loadPrintJob(db, businessId, station.recoveryJobId)
    if (recoveryJob && !isPrintQueueTerminal(recoveryJob.status)) {
      throw repositoryError(409, 'PRINT_RECOVERY_JOB_UNRESOLVED', 'O trabalho atual da recuperação ainda não foi resolvido.')
    }
  }
  throw repositoryError(409, 'PRINT_RECOVERY_TRANSITION_NOT_ALLOWED', 'Print recovery transition is not allowed.')
}

export const claimNextAutomaticPrintJob = async (db, businessId, stationId, now = new Date()) => {
  await agePrintJobs(db, businessId, now)
  const station = await requirePrimaryQzPrintStation(db, businessId, stationId, now)
  if (!station.autoPrintEnabled) {
    throw repositoryError(409, 'PRINT_STATION_NOT_PRIMARY', 'Somente a estação principal com impressão automática ativa pode assumir novos trabalhos.')
  }
  if (!station.health.ready) {
    throw repositoryError(409, 'PRINT_STATION_NOT_READY', 'A estação principal QZ não está pronta para imprimir.')
  }
  if (station.recoveryState !== 'normal') return null
  const at = timestamp(now)
  const candidateSql = `SELECT id FROM print_jobs
      WHERE business_id = ? AND type = 'order' AND trigger = 'automatic' AND status = 'pending' AND available_at <= ?
        AND (${AUTOMATIC_ORDER_ELIGIBLE_SQL} OR last_error_code = 'FORCE_PRINT_AUTHORIZED')
      ORDER BY priority DESC, COALESCE(available_at, created_at) ASC, created_at ASC, id ASC LIMIT 1`
  const candidateBindings = [businessId,at]
  const update = db.prepare(`UPDATE print_jobs SET
      status = 'processing', station_id = ?, processing_started_at = ?, processed_at = NULL,
      last_error_code = NULL, last_error_message = NULL
    WHERE id = (${candidateSql}) AND business_id = ? AND type = 'order' AND trigger = 'automatic' AND status = 'pending' AND available_at <= ?
    RETURNING *`)
    .bind(stationId, at, ...candidateBindings, businessId, at)
  const automaticDb=withAuditContext(db,printingActor(auditContext(db,businessId),{automatic:true,stationId}))
  const audit=prepareAuditSelection(automaticDb,businessId,{action:'printing.claimed',resourceType:'print-job',now},candidateSql,candidateBindings)
  const [,claimed]=await db.batch([audit,update])
  const row=claimed.results?.[0] || null
  return mapJobRow(row)
}

export const claimPrintJob = async (db, businessId, jobId, stationId, now = new Date(), granted) => {
  const station = await requirePrimaryQzPrintStation(db, businessId, stationId, now)
  if (station.recoveryState !== 'normal' && station.recoveryJobId !== jobId) {
    throw repositoryError(409, 'PRINT_RECOVERY_REQUIRED', 'Print recovery must be resolved before claiming jobs.')
  }
  await routeIneligibleAutomaticJobsToAttention(db, businessId, now)
  const at = timestamp(now)
  const row = await auditedMutation(db,businessId,db.prepare(`UPDATE print_jobs SET
      status = 'processing', station_id = ?, processing_started_at = ?, processed_at = NULL,
      last_error_code = NULL, last_error_message = NULL
    WHERE id = ? AND business_id = ?
      AND ${printDocumentEligibilitySql(granted)}
      AND ((status = 'pending' AND available_at <= ?)
        OR (status = 'awaiting_second_copy' AND copies_printed > 0 AND copies_printed < copies_requested))
      AND (trigger <> 'automatic' OR ${AUTOMATIC_ORDER_ELIGIBLE_SQL} OR last_error_code = 'FORCE_PRINT_AUTHORIZED'
        OR (copies_requested = 2 AND copies_printed = 1 AND second_copy_requested_at IS NOT NULL AND second_copy_skipped_at IS NULL))
    RETURNING *`).bind(stationId, at, jobId, businessId, at),{action:'printing.claimed',resourceType:'print-job',resourceId:jobId,now}).first()
  if (row) return mapJobRow(row)
  const existing = await loadPrintJob(db, businessId, jobId)
  if (!existing) throw repositoryError(404, 'PRINT_JOB_NOT_FOUND', 'Trabalho de impressão não encontrado.')
  throw repositoryError(409, 'PRINT_JOB_NOT_PENDING', 'Este trabalho de impressão não está pendente.')
}

export const markPrintJobPrinted = async (db, businessId, jobId, stationId, copiesPrinted, now = new Date()) => {
  const copies = assertCopies(copiesPrinted)
  const at = timestamp(now)
  const row = await auditedMutation(db,businessId,db.prepare(`UPDATE print_jobs SET
      status = CASE WHEN ? < copies_requested THEN 'awaiting_second_copy' ELSE 'printed' END,
      copies_printed = ?, processed_at = ?,
      last_error_code = NULL, last_error_message = NULL
    WHERE id = ? AND business_id = ? AND status = 'processing' AND station_id = ?
      AND ? > copies_printed AND ? <= copies_requested
    RETURNING *`).bind(copies, copies, at, jobId, businessId, stationId, copies, copies),{action:'printing.outcome.observed',resourceType:'print-job',resourceId:jobId,now,outcome:'reported_printed'}).first()
  if (row) {
    const job = mapJobRow(row)
    if (isPrintQueueTerminal(job.status)) {
      await db.prepare(`UPDATE print_stations SET recovery_job_id = NULL, updated_at = ?
        WHERE id = ? AND business_id = ? AND recovery_job_id = ?`)
        .bind(at, stationId, businessId, jobId).run()
    }
    return job
  }
  const existing = await loadPrintJob(db, businessId, jobId)
  if (!existing) throw repositoryError(404, 'PRINT_JOB_NOT_FOUND', 'Trabalho de impressão não encontrado.')
  throw repositoryError(409, 'PRINT_JOB_NOT_PROCESSING', 'Este trabalho não está sendo processado por esta estação.')
}

export const markPrintJobFailed = async (db, businessId, jobId, stationId, failure = {}, now = new Date()) => {
  const at = timestamp(now)
  const code = String(failure.code || 'PRINT_FAILED').slice(0, 100)
  const message = String(failure.message || 'Não foi possível imprimir o pedido.').slice(0, 500)
  const qzFailure = String(failure.transport || '').toLowerCase() === 'qz' || code.toUpperCase().startsWith('QZ_')
  const nextStatus = failure.uncertain || qzFailure ? 'requires_attention' : 'failed'
  const row = await auditedMutation(db,businessId,db.prepare(`UPDATE print_jobs SET
      status = ?, processed_at = ?, last_error_code = ?, last_error_message = ?
    WHERE id = ? AND business_id = ? AND status = 'processing' AND station_id = ?
    RETURNING *`).bind(nextStatus, at, code, message, jobId, businessId, stationId),{action:'printing.outcome.observed',resourceType:'print-job',resourceId:jobId,now,outcome:nextStatus === 'requires_attention' ? 'unknown' : 'failed'}).first()
  if (row) return mapJobRow(row)
  const existing = await loadPrintJob(db, businessId, jobId)
  if (!existing) throw repositoryError(404, 'PRINT_JOB_NOT_FOUND', 'Trabalho de impressão não encontrado.')
  throw repositoryError(409, 'PRINT_JOB_NOT_PROCESSING', 'Este trabalho não está sendo processado por esta estação.')
}

export const discardPrintJob = async (db, businessId, jobId, actorLabel = 'Sistema', now = new Date()) => {
  const existing = await loadPrintJob(db, businessId, jobId)
  if (!existing) throw repositoryError(404, 'PRINT_JOB_NOT_FOUND', 'Trabalho de impressão não encontrado.')
  if (existing.status === 'discarded') return existing

  const unresolvedAttempt = await db.prepare(`SELECT 1 FROM print_job_attempts
    WHERE business_id = ? AND job_id = ? AND submission_started_at IS NOT NULL
      AND resolution IS NULL AND status <> 'complete' LIMIT 1`).bind(businessId, jobId).first()
  if (unresolvedAttempt) {
    throw repositoryError(409, 'PRINT_JOB_DISCARD_NOT_ALLOWED', 'Este trabalho aguarda resolução de uma tentativa física.')
  }

  const discardable = ['pending', 'queued', 'failed', 'requires_attention'].includes(existing.status)
  if (!discardable) {
    throw repositoryError(409, 'PRINT_JOB_DISCARD_NOT_ALLOWED', 'Este trabalho de impressão não pode ser descartado neste estado.')
  }

  const at = timestamp(now)
  const actor = String(actorLabel || '').trim().slice(0, 100) || 'Sistema'
  const row = await auditedMutation(db,businessId,db.prepare(`UPDATE print_jobs SET
      status = 'discarded', discarded_at = ?, action_actor_label = ?, action_at = ?
    WHERE id = ? AND business_id = ?
      AND status IN ('pending', 'queued', 'failed', 'requires_attention')
      AND NOT EXISTS (
        SELECT 1 FROM print_job_attempts
        WHERE print_job_attempts.business_id = print_jobs.business_id
          AND print_job_attempts.job_id = print_jobs.id
          AND print_job_attempts.submission_started_at IS NOT NULL
          AND print_job_attempts.resolution IS NULL
          AND print_job_attempts.status <> 'complete'
      )
    RETURNING *`).bind(at, actor, at, jobId, businessId),{action:'printing.discarded',resourceType:'print-job',resourceId:jobId,now}).first()
  if (row) {
    await db.prepare(`UPDATE print_stations SET recovery_job_id = NULL, updated_at = ?
      WHERE business_id = ? AND recovery_job_id = ?`).bind(at, businessId, jobId).run()
    return mapJobRow(row)
  }

  const current = await loadPrintJob(db, businessId, jobId)
  if (current?.status === 'discarded') return current
  throw repositoryError(409, 'PRINT_JOB_DISCARD_NOT_ALLOWED', 'Este trabalho de impressão não pode ser descartado neste estado.')
}

export const discardOperationalPrintJobs = async (db, businessId, actorLabel = 'Sistema', now = new Date()) => {
  const at = timestamp(now)
  const actor = String(actorLabel || '').trim().slice(0, 100) || 'Sistema'
  const activeBefore = await db.prepare(`SELECT COUNT(*) AS count FROM print_jobs
    WHERE business_id = ? AND status NOT IN ('printed', 'discarded')`).bind(businessId).first()

  const candidateSql = `SELECT id FROM print_jobs WHERE business_id = ?
      AND status IN ('pending', 'queued', 'failed', 'requires_attention', 'awaiting_second_copy')
      AND NOT EXISTS (
        SELECT 1 FROM print_job_attempts
        WHERE print_job_attempts.business_id = print_jobs.business_id
          AND print_job_attempts.job_id = print_jobs.id
          AND print_job_attempts.submission_started_at IS NOT NULL
          AND print_job_attempts.resolution IS NULL
          AND print_job_attempts.status <> 'complete'
      )`
  const candidateBindings = [businessId]
  const update = db.prepare(`UPDATE print_jobs SET
      status = 'discarded',
      second_copy_skipped_at = CASE
        WHEN status = 'awaiting_second_copy' AND copies_requested = 2 AND copies_printed = 1
          THEN COALESCE(second_copy_skipped_at, ?)
        ELSE second_copy_skipped_at
      END,
      discarded_at = ?,
      action_actor_label = ?,
      action_at = ?
    WHERE id IN (${candidateSql})
    RETURNING *`)
    .bind(at, at, actor, at, ...candidateBindings)

  const audit = prepareAuditSelection(db,businessId,{action:'printing.discarded',resourceType:'print-job',now},candidateSql,candidateBindings)
  // A subquery keeps this atomic cleanup at two bindings for any queue size.
  const cleanup = db.prepare(`UPDATE print_stations SET recovery_job_id=NULL,updated_at=? WHERE business_id=?
    AND recovery_job_id IN (SELECT id FROM print_jobs WHERE business_id=print_stations.business_id AND status='discarded')`).bind(at,businessId)
  const results = await db.batch([audit,update,cleanup])
  const jobs = rows(results[1]).map(mapJobRow)

  const activeAfter = await db.prepare(`SELECT COUNT(*) AS count FROM print_jobs
    WHERE business_id = ? AND status NOT IN ('printed', 'discarded')`).bind(businessId).first()

  return {
    jobs,
    discardedCount: jobs.length,
    retainedCount: Math.max(0, Number(activeAfter?.count || 0)),
    activeBefore: Math.max(0, Number(activeBefore?.count || 0)),
  }
}

export const discardPendingPrintJobs = async (db, businessId, actorLabel = 'Sistema', now = new Date()) => {
  const at = timestamp(now)
  const actor = String(actorLabel || '').trim().slice(0, 100) || 'Sistema'
  const candidateSql = `SELECT id FROM print_jobs WHERE business_id = ? AND status = 'pending' AND copies_printed = 0
      AND NOT EXISTS (
        SELECT 1 FROM print_job_attempts
        WHERE print_job_attempts.business_id = print_jobs.business_id
          AND print_job_attempts.job_id = print_jobs.id
          AND print_job_attempts.submission_started_at IS NOT NULL
      )`
  const candidateBindings = [businessId]
  const update = db.prepare(`UPDATE print_jobs SET
      status = 'discarded', discarded_at = ?, action_actor_label = ?, action_at = ?
    WHERE id IN (${candidateSql})
    RETURNING *`).bind(at, actor, at, ...candidateBindings)
  const audit=prepareAuditSelection(db,businessId,{action:'printing.discarded',resourceType:'print-job',now},candidateSql,candidateBindings)
  const [,result]=await db.batch([audit,update])
  return rows(result).map(mapJobRow)
}

export const claimNextRecoveryPrintJob = async (db, businessId, stationId, now = new Date(), granted) => {
  const station = await requirePrimaryQzPrintStation(db, businessId, stationId, now)
  if (!station.health.ready || station.recoveryState !== 'active') return null
  await routeIneligibleAutomaticJobsToAttention(db, businessId, now)
  if (station.recoveryJobId) {
    const recoveryJob = await loadPrintJob(db, businessId, station.recoveryJobId)
    if (recoveryJob && granted instanceof Set && !await canReadPrintJob(db, { businessId, granted }, recoveryJob)) return null
    if (recoveryJob && !isPrintQueueTerminal(recoveryJob.status)) {
      if (recoveryJob.status !== 'pending') return null
      const at = timestamp(now)
      const lock = db.prepare(`UPDATE print_stations SET recovery_state = 'deferred', updated_at = ?
        WHERE id = ? AND business_id = ? AND recovery_state = 'active' AND recovery_job_id = ?
          AND EXISTS (SELECT 1 FROM print_jobs WHERE print_jobs.id = print_stations.recovery_job_id AND print_jobs.business_id = print_stations.business_id
            AND status = 'pending' AND (available_at IS NULL OR available_at <= ?) AND ${printDocumentEligibilitySql(granted)}) RETURNING id`)
        .bind(at, stationId, businessId, recoveryJob.id, at)
      const claim = db.prepare(`UPDATE print_jobs SET
          status = 'processing', station_id = ?, processing_started_at = ?, last_error_code = NULL, last_error_message = NULL
        WHERE changes() = 1 AND id = ? AND business_id = ? AND status = 'pending' AND (available_at IS NULL OR available_at <= ?)
          AND ${printDocumentEligibilitySql(granted)}
        RETURNING *`).bind(stationId, at, recoveryJob.id, businessId, at)
      // Keep CAS and claim adjacent: changes() refers to that station UPDATE.
      // D1 batch prevents other requests from changing eligibility between them.
      const result = await db.batch([lock, claim,businessEvent(db,businessId,{action:'printing.recovery.claimed',resourceType:'print-job',resourceId:recoveryJob.id,now,onlyIfChanged:true})])
      return mapJobRow(rows(result[1])[0])
    }
    await db.prepare(`UPDATE print_stations SET recovery_job_id = NULL, updated_at = ?
      WHERE id = ? AND business_id = ? AND recovery_job_id = ?`)
      .bind(timestamp(now), stationId, businessId, station.recoveryJobId).run()
  }
  const at = timestamp(now)
  const eligibleCandidateSql = `print_jobs.type IN ('order', 'table-tab') AND print_jobs.status = 'pending' AND print_jobs.copies_printed = 0 AND print_jobs.available_at <= ?
      AND ${printDocumentEligibilitySql(granted)}
      AND NOT EXISTS (
        SELECT 1 FROM print_job_attempts
        WHERE print_job_attempts.business_id = print_jobs.business_id
          AND print_job_attempts.job_id = print_jobs.id
          AND print_job_attempts.submission_started_at IS NOT NULL
      )
      AND ((type = 'table-tab' AND trigger = 'manual')
        OR (type = 'order' AND (trigger = 'manual' OR last_error_code = 'FORCE_PRINT_AUTHORIZED' OR ${AUTOMATIC_ORDER_ELIGIBLE_SQL})))`
  const candidate = await db.prepare(`SELECT id FROM print_jobs
    WHERE business_id = ? AND ${eligibleCandidateSql}
    ORDER BY priority DESC, COALESCE(available_at, created_at) ASC, created_at ASC, id ASC LIMIT 1`)
    .bind(businessId, at).first()
  if (!candidate?.id) return null

  const lock = db.prepare(`UPDATE print_stations SET recovery_state = 'deferred', recovery_job_id = ?, updated_at = ?
    WHERE id = ? AND business_id = ? AND recovery_state = 'active' AND recovery_job_id IS NULL
      AND EXISTS (SELECT 1 FROM print_jobs WHERE print_jobs.id = ? AND print_jobs.business_id = print_stations.business_id AND ${eligibleCandidateSql}) RETURNING id`)
    .bind(candidate.id, at, stationId, businessId, candidate.id, at)

  const claim = db.prepare(`UPDATE print_jobs SET
      status = 'processing', station_id = ?, processing_started_at = ?, processed_at = NULL,
      last_error_code = NULL, last_error_message = NULL
    WHERE changes() = 1 AND id = ? AND business_id = ? AND ${eligibleCandidateSql}
    RETURNING *`).bind(stationId, at, candidate.id, businessId, at)
  // Keep CAS and claim adjacent; no audit writer may precede the claim in this batch.
  const result = await db.batch([lock, claim,businessEvent(db,businessId,{action:'printing.recovery.claimed',resourceType:'print-job',resourceId:candidate.id,now,onlyIfChanged:true})])
  return mapJobRow(rows(result[1])[0])
}

export const prioritizePrintJob = async (db, businessId, jobId, now = new Date(), actorLabel = 'Sistema') => {
  const at = timestamp(now)
  const actor = String(actorLabel || '').trim().slice(0, 100) || 'Sistema'
  const row = await auditedMutation(db,businessId,db.prepare(`UPDATE print_jobs SET priority = 1, action_actor_label = ?, action_at = ?
    WHERE id = ? AND business_id = ? AND status = 'pending'
    RETURNING *`).bind(actor, at, jobId, businessId),{action:'printing.prioritized',resourceType:'print-job',resourceId:jobId,now}).first()
  if (row) return mapJobRow(row)

  const existing = await loadPrintJob(db, businessId, jobId)
  if (!existing) throw repositoryError(404, 'PRINT_JOB_NOT_FOUND', 'Trabalho de impressão não encontrado.')
  throw repositoryError(409, 'PRINT_JOB_PRIORITIZE_NOT_ALLOWED', 'Este trabalho de impressão não pode ser priorizado neste estado.')
}

export const reprintPrintJob = async (db, businessId, jobId, copies, document, now = new Date(), actorLabel = null) => {
  const requestedCopies = assertCopies(copies)
  const at = timestamp(now)
  const id = crypto.randomUUID()
  const row = await auditedMutation(db,businessId,db.prepare(`INSERT INTO print_jobs (
      id, business_id, order_id, type, trigger, status, priority, parent_job_id,
      copies_requested, copies_printed, station_id, snapshot_json, created_at, available_at,
      processing_started_at, processed_at, discarded_at, attention_reason,
      action_actor_label, action_at, last_error_code, last_error_message
    )
    SELECT ?, business_id, order_id, 'order', 'manual', 'pending', 0, id,
      ?, 0, NULL, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?, NULL, NULL
    FROM print_jobs
    WHERE id = ? AND business_id = ? AND type = 'order'
      AND EXISTS (
        SELECT 1 FROM orders
        WHERE orders.id = print_jobs.order_id
          AND orders.business_id = print_jobs.business_id
          AND orders.status <> 'Cancelado'
      )
      AND (
        (status = 'printed' AND copies_printed >= copies_requested)
        OR status = 'discarded'
        OR (status = 'requires_attention' AND last_error_code IN ('PROCESSING_OUTCOME_UNKNOWN', 'SERIAL_WRITE_UNCERTAIN'))
      )
      AND NOT EXISTS (
        SELECT 1 FROM print_job_attempts
        WHERE print_job_attempts.business_id = print_jobs.business_id
          AND print_job_attempts.job_id = print_jobs.id
          AND print_job_attempts.submission_started_at IS NOT NULL
          AND print_job_attempts.resolution IS NULL
          AND print_job_attempts.status <> 'complete'
      )
    RETURNING *`).bind(id, requestedCopies, JSON.stringify(document), at, at, actorLabel, actorLabel ? at : null, jobId, businessId),{action:'printing.reprint.requested',resourceType:'print-job',resourceId:id,now}).first()
  if (row) return mapJobRow(row)

  const existing = await loadPrintJob(db, businessId, jobId)
  if (!existing) throw repositoryError(404, 'PRINT_JOB_NOT_FOUND', 'Trabalho de impressão não encontrado.')
  throw repositoryError(409, 'PRINT_JOB_REPRINT_NOT_ALLOWED', 'Este trabalho de impressão ainda não pode ser reimpresso.')
}

export const retryPrintJob = async (db, businessId, jobId, now = new Date(), actorLabel = 'Sistema') => {
  const retryExisting = await loadPrintJob(db, businessId, jobId)
  if (!retryExisting) throw repositoryError(404, 'PRINT_JOB_NOT_FOUND', 'Print job not found.')
  const orderEligible = retryExisting.trigger !== 'automatic'
    || await db.prepare(`SELECT 1 FROM orders WHERE id = ? AND business_id = ? AND status NOT IN ('Cancelado', 'Finalizado') LIMIT 1`).bind(retryExisting.orderId, businessId).first()
  if (!isRetryablePrintJob(retryExisting) || !orderEligible) {
    throw repositoryError(409, 'PRINT_JOB_RETRY_NOT_ALLOWED', 'This print job cannot be retried in its current state.')
  }
  const at = timestamp(now)
  const actor = String(actorLabel || '').trim().slice(0, 100) || 'Sistema'
  const row = await auditedMutation(db,businessId,db.prepare(`UPDATE print_jobs SET
      status = CASE
        WHEN copies_printed > 0 AND copies_printed < copies_requested THEN 'awaiting_second_copy'
        ELSE 'pending'
      END,
      station_id = NULL, processing_started_at = NULL, processed_at = NULL,
      last_error_code = NULL, last_error_message = NULL, action_actor_label = ?, action_at = ?
    WHERE id = ? AND business_id = ? AND status IN ('failed', 'requires_attention')
      AND (trigger <> 'automatic' OR ${AUTOMATIC_ORDER_ELIGIBLE_SQL})
    RETURNING *`).bind(actor, at, jobId, businessId),{action:'printing.retried',resourceType:'print-job',resourceId:jobId,now}).first()
  if (row) return mapJobRow(row)
  const existing = await loadPrintJob(db, businessId, jobId)
  if (!existing) throw repositoryError(404, 'PRINT_JOB_NOT_FOUND', 'Trabalho de impressão não encontrado.')
  throw repositoryError(409, 'PRINT_JOB_RETRY_NOT_ALLOWED', 'Este trabalho não pode ser tentado novamente neste estado.')
}

export const acknowledgeSecondCopyPrompt = async (db, businessId, jobId, stationId, now = new Date()) => {
  await requirePrimaryQzPrintStation(db, businessId, stationId, now)
  const at = timestamp(now)
  const row = await auditedMutation(db,businessId,db.prepare(`UPDATE print_jobs SET second_copy_prompted_at = ?
    WHERE id = ? AND business_id = ? AND status = 'awaiting_second_copy'
      AND copies_requested = 2 AND copies_printed = 1 AND second_copy_prompted_at IS NULL
    RETURNING *`).bind(at, jobId, businessId),{action:'printing.second-copy.prompted',resourceType:'print-job',resourceId:jobId,now}).first()
  if (row) return { job: mapJobRow(row), promptPresented: true }
  const job = await loadPrintJob(db, businessId, jobId)
  if (!job) throw repositoryError(404, 'PRINT_JOB_NOT_FOUND', 'Trabalho de impressão não encontrado.')
  return { job, promptPresented: false }
}

export const requestSecondCopy = async (db, businessId, jobId, actorLabel = 'Sistema', now = new Date()) => {
  const at = timestamp(now)
  const actor = String(actorLabel || '').trim().slice(0, 100) || 'Sistema'
  const row = await auditedMutation(db,businessId,db.prepare(`UPDATE print_jobs SET status = 'pending', station_id = NULL, processing_started_at = NULL,
    second_copy_requested_at = ?, action_at = ?, action_actor_label = ?
    WHERE id = ? AND business_id = ? AND status = 'awaiting_second_copy'
      AND copies_requested = 2 AND copies_printed = 1 AND second_copy_skipped_at IS NULL
      AND (type = 'table-tab' OR (type = 'order' AND (trigger <> 'automatic' OR ${AUTOMATIC_ORDER_ELIGIBLE_SQL}))) RETURNING *`).bind(at, at, actor, jobId, businessId),{action:'printing.second-copy.requested',resourceType:'print-job',resourceId:jobId,now}).first()
  if (row) return mapJobRow(row)
  const existing = await loadPrintJob(db, businessId, jobId)
  if (existing?.status === 'pending' && existing.secondCopyRequestedAt && existing.copiesPrinted === 1) return existing
  if (!existing) throw repositoryError(404, 'PRINT_JOB_NOT_FOUND', 'Trabalho de impressão não encontrado.')
  throw repositoryError(409, 'PRINT_SECOND_COPY_NOT_AWAITING', 'A segunda via não está disponível para este trabalho.')
}

export const skipSecondCopy = async (db, businessId, jobId, actorLabel = 'Sistema', now = new Date()) => {
  const at = timestamp(now)
  const actor = String(actorLabel || '').trim().slice(0, 100) || 'Sistema'
  const row = await auditedMutation(db,businessId,db.prepare(`UPDATE print_jobs SET status = 'discarded', second_copy_skipped_at = ?, discarded_at = ?, action_at = ?, action_actor_label = ?
    WHERE id = ? AND business_id = ? AND status = 'awaiting_second_copy' AND copies_requested = 2 AND copies_printed = 1 RETURNING *`).bind(at, at, at, actor, jobId, businessId),{action:'printing.second-copy.skipped',resourceType:'print-job',resourceId:jobId,now}).first()
  if (row) {
    await db.prepare(`UPDATE print_stations SET recovery_job_id = NULL, updated_at = ?
      WHERE business_id = ? AND recovery_job_id = ?`).bind(at, businessId, jobId).run()
    return mapJobRow(row)
  }
  const existing = await loadPrintJob(db, businessId, jobId)
  if (existing?.status === 'discarded' && existing.secondCopySkippedAt) return existing
  if (!existing) throw repositoryError(404, 'PRINT_JOB_NOT_FOUND', 'Trabalho de impressão não encontrado.')
  throw repositoryError(409, 'PRINT_SECOND_COPY_NOT_AWAITING', 'A segunda via não está disponível para este trabalho.')
}

export const forcePrintJob = async (db, businessId, jobId, actorLabel = 'Sistema', now = new Date()) => {
  const existing = await loadPrintJob(db, businessId, jobId)
  if (!existing) throw repositoryError(404, 'PRINT_JOB_NOT_FOUND', 'Print job not found.')
  const legacyReason = await legacyForcePrintReason(db, businessId, existing)
  const forceReason = isForcePrintReason(existing) ? existing.lastError.code : legacyReason
  if (existing.status !== 'requires_attention' || !forceReason) {
    throw repositoryError(409, 'PRINT_JOB_FORCE_PRINT_NOT_ALLOWED', 'This print job cannot be forced in its current state.')
  }
  const at = timestamp(now)
  const actor = String(actorLabel || '').trim().slice(0, 100) || 'Sistema'
  const row = await auditedMutation(db,businessId,db.prepare(`UPDATE print_jobs SET
      status = 'pending', station_id = NULL, processing_started_at = NULL, processed_at = NULL,
      last_error_code = 'FORCE_PRINT_AUTHORIZED', last_error_message = 'Impressao autorizada manualmente.',
      attention_reason = NULL, action_actor_label = ?, action_at = ?
    WHERE id = ? AND business_id = ? AND status = 'requires_attention'
      AND (
        last_error_code IN ('ORDER_FINALIZED_BEFORE_PRINT', 'ORDER_CANCELLED_BEFORE_PRINT')
        OR (last_error_code = 'ORDER_NOT_PRINTABLE' AND EXISTS (
          SELECT 1 FROM orders
          WHERE orders.id = print_jobs.order_id
            AND orders.business_id = print_jobs.business_id
            AND orders.status IN ('Finalizado', 'Cancelado')
        ))
      )
    RETURNING *`).bind(actor, at, jobId, businessId),{action:'printing.forced',resourceType:'print-job',resourceId:jobId,now}).first()
  if (row) return mapJobRow(row)
  const current = await loadPrintJob(db, businessId, jobId)
  if (current?.status === 'pending' && current.lastError?.code === 'FORCE_PRINT_AUTHORIZED') return current
  throw repositoryError(409, 'PRINT_JOB_FORCE_PRINT_NOT_ALLOWED', 'This print job cannot be forced in its current state.')
}
