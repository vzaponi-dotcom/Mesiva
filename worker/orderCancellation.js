import { businessEvent } from './access/audit.js'
import { getBusinessDate } from '../shared/finance.js'
import { mapMovementRow } from './financeRepository.js'
import { closeTableTabIfSettled } from './repositories.js'
import { centsToMoney, validatePaymentMethod } from './validation.js'
import { formatOrderDisplayNumber } from '../shared/orderDisplayNumber.js'
import { prepareCancellationUse } from './cancellationSettingsRepository.js'
import { clearSettingsAssertions, prepareSettingsAssertion } from './settingsTransactions.js'
import { preparePolicyGuards, readPaymentMethodExpectation, rethrowPolicyChange } from './operationalPolicyGuards.js'
import { loadOperations } from './operationSettingsRepository.js'
import { parseOrderTimingPolicySnapshot, serializeOrderTimingPolicySnapshot } from '../shared/orderTiming.js'
import { nativeCancellationReasons } from '../shared/settingsCatalogs.js'
import { mapOrderPaymentFields, PAYMENT_ALLOCATIONS_JSON_SELECT, PAYMENT_SETTLEMENT_SQL_SELECT } from './orderPaymentReadModel.js'
import { loadTableReservationByOrderId } from './tableReservationRepository.js'

const DEFAULT_CANCELLATION_REASONS = new Map(nativeCancellationReasons().items.map((item) => [item.id, item]))
export const CANCEL_REASONS = [...DEFAULT_CANCELLATION_REASONS.keys()]

const domainError = (status, code, message) => Object.assign(new Error(message), { status, code })

const normalizeReason = (value) => {
  const reason = typeof value === 'string' ? value.trim() : ''
  if (!reason || reason.length > 120) {
    throw domainError(400, 'ORDER_CANCEL_REASON_REQUIRED', 'Selecione um motivo válido para cancelar o pedido.')
  }
  return reason
}

const normalizeNote = (requiresNote, value) => {
  const note = typeof value === 'string' ? value.trim() : ''
  if (requiresNote && !note) {
    throw domainError(400, 'ORDER_CANCEL_REASON_NOTE_REQUIRED', 'Descreva o motivo do cancelamento.')
  }
  if (note.length > 240) {
    throw domainError(400, 'ORDER_CANCEL_REASON_NOTE_TOO_LONG', 'A descrição do motivo deve ter no máximo 240 caracteres.')
  }
  return note
}

const readCancellationPolicy = (db, businessId, reason) => db.prepare(`SELECT h.revision, r.active, r.requires_note
  FROM business_cancellation_settings h
  LEFT JOIN business_cancel_reasons r ON r.business_id = h.business_id AND r.id = ?
  WHERE h.business_id = ? LIMIT 1`).bind(reason, businessId).first()

const normalizeRefundMethod = (value) => {
  const method = typeof value === 'string' ? value.trim() : ''
  if (!method) throw domainError(400, 'ORDER_REFUND_METHOD_REQUIRED', 'Informe a forma do estorno.')
  return validatePaymentMethod(method)
}

const orderContextSql = `SELECT o.id, o.order_number, o.status, o.table_tab_id, o.client_name_snapshot,
  o.cancelled_at, o.cancel_reason, o.cancel_reason_note, o.timing_policy_snapshot_json, o.total_cents, o.content_revision,
  cr.label AS cancel_reason_label,
  p.id AS payment_id, p.method AS payment_method, p.amount_cents AS paid_amount_cents, p.paid_at, ${PAYMENT_ALLOCATIONS_JSON_SELECT},
  r.id AS refund_movement_id, r.created_at AS refund_created_at
  FROM orders o
  LEFT JOIN payments p ON p.order_id = o.id AND p.business_id = o.business_id
  LEFT JOIN movements r ON r.order_id = o.id AND r.business_id = o.business_id AND r.source = 'order-refund'
  LEFT JOIN business_cancel_reasons cr ON cr.business_id = o.business_id AND cr.id = o.cancel_reason
  WHERE o.id = ? AND o.business_id = ? LIMIT 1`

const readContext = (db, businessId, orderId) => db.prepare(orderContextSql).bind(orderId, businessId).first()

const mapContext = (row) => {
  if (!row) return null
  const payment = mapOrderPaymentFields(row)
  const order = {
    id: row.id,
    orderNumber: row.order_number,
    client: row.client_name_snapshot,
    tableTabId: row.table_tab_id ?? null,
    status: row.status,
    cancelledAt: row.cancelled_at ?? null,
    cancelReason: row.cancel_reason ?? null,
    cancelReasonLabel: row.cancel_reason_label ?? row.cancel_reason ?? null,
    cancelReasonNote: row.cancel_reason_note ?? '',
    timingPolicySnapshot: parseOrderTimingPolicySnapshot(row.timing_policy_snapshot_json),
    ...payment,
    paidAmount: row.payment_id ? centsToMoney(row.paid_amount_cents) : 0,
    refundMovementId: row.refund_movement_id ?? null,
    refundedAt: row.refund_created_at ?? null,
  }
  return { ...order, refundState: getOrderRefundState(order) }
}

export const getOrderRefundState = (order) => {
  if (order?.status !== 'Cancelado' || !order?.paymentId) return 'none'
  if (Number.isSafeInteger(order.netReceivedCents)) return order.netReceivedCents === 0 ? 'refunded' : 'pending'
  return order?.refundMovementId ? 'refunded' : 'pending'
}

const receivedNet = row => {
  const balance = mapOrderPaymentFields(row)
  return Number.isSafeInteger(balance.netReceivedCents)
    ? balance.netReceivedCents : Number(row.paid_amount_cents || 0)
}

// Assert the monetary snapshot under D1's transaction lock. This prevents a
// concurrent settlement (supplement/refund) from changing the refund amount.
const refundAmountGuard = (db, txId, businessId, orderId, originalPaymentId, expectedNet, statuses) =>
  prepareSettingsAssertion(db, txId, 'refund-net',
    `EXISTS(SELECT 1 FROM (
      SELECT o.id,o.business_id,o.status,p.id AS payment_id,
        ${PAYMENT_SETTLEMENT_SQL_SELECT}
      FROM orders o LEFT JOIN payments p ON p.business_id=o.business_id AND p.order_id=o.id
      WHERE o.business_id=? AND o.id=?
    ) snapshot
    WHERE snapshot.payment_id=?
      AND snapshot.status IN (${statuses === 'cancelled' ? "'Cancelado'" : "'Em preparo','Finalizado'"})
      AND snapshot.gross_received_cents>=snapshot.refunded_cents
      AND snapshot.gross_received_cents-snapshot.refunded_cents=?
      AND NOT EXISTS (SELECT 1 FROM movements m WHERE m.business_id=snapshot.business_id
        AND m.order_id=snapshot.id AND m.source='order-refund' AND m.deleted_at IS NULL)
    )`,[businessId,orderId,originalPaymentId,expectedNet])

const createRefundStatement = (db, businessId, row, refundMethod, now, amountCents = Number(row.paid_amount_cents)) => {
  const id = crypto.randomUUID()
  const createdAt = now.toISOString()
  const movementDate = getBusinessDate(now)
  const description = `${formatOrderDisplayNumber(row).replace('Pedido', 'Estorno pedido')} · ${row.client_name_snapshot}`
  const statement = db.prepare(`INSERT INTO movements (id, business_id, type, category, description, value_cents, source, order_id, payment_id, movement_date, created_at, payment_method, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
    id,
    businessId,
    'saida',
    'Estornos',
    `${description} · ${refundMethod}`,
    amountCents,
    'order-refund',
    row.id,
    row.payment_id,
    movementDate,
    createdAt,
    refundMethod,
    createdAt,
  )
  return {
    statement,
    movement: mapMovementRow({
      id,
      type: 'saida',
      category: 'Estornos',
      description: `${description} · ${refundMethod}`,
      value_cents: amountCents,
      source: 'order-refund',
      order_id: row.id,
      payment_id: row.payment_id,
      payment_method: refundMethod,
      movement_date: movementDate,
      created_at: createdAt,
      updated_at: createdAt,
    }),
  }
}

export const cancelOrder = async (db, businessId, orderId, input = {}, now = new Date(), options = {}) => {
  const reason = normalizeReason(input.reason)
  const storedPolicy = await readCancellationPolicy(db, businessId, reason)
  const defaultReason = input.expectedRevision === 0 ? DEFAULT_CANCELLATION_REASONS.get(reason) : null
  const policy = storedPolicy || (defaultReason
    ? { revision: 0, active: 1, requires_note: Number(defaultReason.requiresNote) }
    : null)
  if (!policy || policy.active !== 1) {
    if (policy?.active === 0) throw domainError(409, 'POLICY_CHANGED', 'O motivo de cancelamento não está mais ativo.')
    throw domainError(400, 'ORDER_CANCEL_REASON_REQUIRED', 'Selecione um motivo válido para cancelar o pedido.')
  }
  const expectedRevision = input.expectedRevision ?? policy.revision
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw domainError(400, 'ORDER_CANCEL_REASON_REVISION_REQUIRED', 'Atualize os motivos de cancelamento e tente novamente.')
  }
  const note = normalizeNote(policy.requires_note === 1, input.note)
  const existing = await readContext(db, businessId, orderId)
  if (!existing) throw domainError(404, 'ORDER_NOT_FOUND', 'Pedido não encontrado.')
  const remainingReceived = receivedNet(existing)
  const reservation = await loadTableReservationByOrderId(db, businessId, orderId)
  const requireActiveReservation = Boolean(options.requireActiveReservation)
  const expectedReservationRevision = options.expectedReservationRevision
  const reservationDisposition = options.reservationDisposition === 'no_show' ? 'no_show' : 'cancelled'
  if (requireActiveReservation) {
    if (!reservation) throw domainError(404, 'TABLE_RESERVATION_NOT_FOUND', 'Reserva não encontrada.')
    if (reservation.status !== 'reserved') {
      throw domainError(409, 'TABLE_RESERVATION_ALREADY_CLOSED', 'Esta reserva já foi encerrada.')
    }
    if (!Number.isInteger(expectedReservationRevision) || expectedReservationRevision < 1) {
      throw domainError(400, 'TABLE_RESERVATION_REVISION_REQUIRED', 'Atualize a reserva e tente novamente.')
    }
    if (reservation.revision !== expectedReservationRevision) {
      throw domainError(409, 'TABLE_RESERVATION_CHANGED', 'A reserva foi alterada. Atualize os dados e tente novamente.')
    }
  }
  if (existing.status === 'Cancelado') throw domainError(409, 'ORDER_ALREADY_CANCELLED', 'Este pedido já foi cancelado.')
  if (!['Em preparo', 'Finalizado'].includes(existing.status)) {
    throw domainError(409, 'ORDER_CANCEL_NOT_ALLOWED', 'Este pedido não pode ser cancelado.')
  }

  parseOrderTimingPolicySnapshot(existing.timing_policy_snapshot_json)

  const operations = existing.status === 'Em preparo' ? await loadOperations(db, businessId) : null
  const timingSnapshot = operations ? serializeOrderTimingPolicySnapshot(operations.data.timing) : null

  const cancelledAt = now.toISOString()
  const update = db.prepare(`UPDATE orders SET status = 'Cancelado', cancelled_at = ?, cancel_reason = ?, cancel_reason_note = ?,
    timing_policy_snapshot_json = CASE WHEN status = 'Em preparo'
      THEN COALESCE(timing_policy_snapshot_json, ?) ELSE timing_policy_snapshot_json END
    WHERE id = ? AND business_id = ? AND status <> 'Cancelado'`).bind(
    cancelledAt,
    reason,
    note || null,
    timingSnapshot,
    orderId,
    businessId,
  )
  const deletePendingAutomaticPrint = db.prepare(`DELETE FROM print_jobs
    WHERE business_id = ? AND order_id = ? AND trigger = 'automatic' AND status = 'pending'`).bind(businessId, orderId)
  const txId = crypto.randomUUID()
  const cancellationPolicyStatements = prepareCancellationUse(db, businessId, reason, expectedRevision, txId, now)
  // An edit or settlement concurrent with cancellation must not silently
  // change the order version or refund obligation while we are deciding.
  const orderGuard = prepareSettingsAssertion(db, txId, 'state',
    `EXISTS(SELECT 1 FROM (
      SELECT o.status,o.content_revision,o.total_cents,
        ${PAYMENT_SETTLEMENT_SQL_SELECT}
      FROM orders o LEFT JOIN payments p
        ON p.business_id=o.business_id AND p.order_id=o.id
      WHERE o.id=? AND o.business_id=?
    ) snapshot WHERE snapshot.status=?
      AND snapshot.content_revision=? AND snapshot.total_cents=?
      AND snapshot.gross_received_cents=? AND snapshot.refunded_cents=?)`,
    [orderId,businessId,existing.status,Number(existing.content_revision||0),Number(existing.total_cents||0),
      Number(existing.gross_received_cents??existing.paid_amount_cents??0),
      Number(existing.refunded_cents||0)])
  const reservationMutation = reservation?.status === 'reserved'
    ? {
        id: reservation.id,
        expectedRevision: requireActiveReservation ? expectedReservationRevision : reservation.revision,
        disposition: reservationDisposition,
      }
    : null
  const reservationTxId = reservationMutation ? crypto.randomUUID() : null
  const reservationGuard = reservationMutation
    ? prepareSettingsAssertion(db, reservationTxId, 'state',
      "EXISTS (SELECT 1 FROM table_reservations WHERE id = ? AND business_id = ? AND status = 'reserved' AND revision = ?)",
      [reservationMutation.id, businessId, reservationMutation.expectedRevision])
    : null
  const reservationUpdate = reservationMutation
    ? db.prepare(reservationMutation.disposition === 'no_show'
      ? `UPDATE table_reservations
          SET status = 'no_show', no_show_at = ?, updated_at = ?, revision = revision + 1
          WHERE id = ? AND business_id = ? AND status = 'reserved' AND revision = ?`
      : `UPDATE table_reservations
          SET status = 'cancelled', cancelled_at = ?, updated_at = ?, revision = revision + 1
          WHERE id = ? AND business_id = ? AND status = 'reserved' AND revision = ?`)
      .bind(cancelledAt, cancelledAt, reservationMutation.id, businessId, reservationMutation.expectedRevision)
    : null
  const reservationCleanup = reservationMutation ? clearSettingsAssertions(db, reservationTxId) : null
  const timingTxId = operations ? crypto.randomUUID() : null
  const timingGuards = operations ? [prepareSettingsAssertion(db, timingTxId, 'policy',
    'coalesce((SELECT revision FROM business_operation_settings WHERE business_id = ?), 0) = ?',
    [businessId, operations.revision])] : []
  const timingCleanup = operations ? [clearSettingsAssertions(db, timingTxId)] : []
  const classifyCommitFailure = async (error) => {
    if (String(error?.message).includes('POLICY_CHANGED')) {
      throw domainError(409, 'POLICY_CHANGED', 'As configurações operacionais foram alteradas. Atualize e tente novamente.')
    }
    if (String(error?.message).includes('SETTINGS_INVALID')) {
      if (reservationMutation) {
        const refreshedReservation = await loadTableReservationByOrderId(db, businessId, orderId)
        if (!refreshedReservation) throw domainError(404, 'TABLE_RESERVATION_NOT_FOUND', 'Reserva não encontrada.')
        if (refreshedReservation.status !== 'reserved') {
          throw domainError(409, 'TABLE_RESERVATION_ALREADY_CLOSED', 'Esta reserva já foi encerrada.')
        }
        if (refreshedReservation.revision !== reservationMutation.expectedRevision) {
          throw domainError(409, 'TABLE_RESERVATION_CHANGED', 'A reserva foi alterada. Atualize os dados e tente novamente.')
        }
      }
      const refreshed = await readContext(db, businessId, orderId)
      if (refreshed?.status === 'Cancelado') throw domainError(409, 'ORDER_ALREADY_CANCELLED', 'Este pedido já foi cancelado.')
      if (refreshed && !['Em preparo', 'Finalizado'].includes(refreshed.status)) {
        throw domainError(409, 'ORDER_CANCEL_NOT_ALLOWED', 'Este pedido não pode ser cancelado.')
      }
      throw domainError(409,'ORDER_CANCEL_CONFLICT','O pedido ou o saldo mudou. Atualize antes de cancelar.')
    }
    throw error
  }

  let refund = null
  if (existing.payment_id && input.refundNow && remainingReceived > 0) {
    const refundMethod = normalizeRefundMethod(input.refundMethod)
    const paymentExpectation = await readPaymentMethodExpectation(db, businessId, refundMethod)
    const paymentTxId = crypto.randomUUID()
    if (existing.refund_movement_id) throw domainError(409, 'ORDER_ALREADY_REFUNDED', 'Este pedido já foi estornado.')
    refund = createRefundStatement(db, businessId, existing, refundMethod, now, remainingReceived)
    try {
      await db.batch([...preparePolicyGuards(db, businessId, { paymentMethods: paymentExpectation }, paymentTxId),
        refundAmountGuard(db,paymentTxId,businessId,orderId,existing.payment_id,remainingReceived,'active'),
        ...timingGuards, ...cancellationPolicyStatements, orderGuard,
        ...(reservationGuard ? [reservationGuard] : []),
        update,
        ...(reservationUpdate ? [reservationUpdate] : []),
        deletePendingAutomaticPrint, refund.statement,
        clearSettingsAssertions(db, txId),
        ...(reservationCleanup ? [reservationCleanup] : []),
        ...timingCleanup, clearSettingsAssertions(db, paymentTxId),businessEvent(db,businessId,{action:'order.cancelled',resourceType:'order',resourceId:orderId,now}),businessEvent(db,businessId,{action:'payment.refunded',resourceType:'order',resourceId:orderId,now})])
    } catch (error) {
      await classifyCommitFailure(error)
    }
  } else {
    try {
      await db.batch([...timingGuards, ...cancellationPolicyStatements, orderGuard,
        ...(reservationGuard ? [reservationGuard] : []),
        update,
        ...(reservationUpdate ? [reservationUpdate] : []),
        deletePendingAutomaticPrint,
        clearSettingsAssertions(db, txId),
        ...(reservationCleanup ? [reservationCleanup] : []),
        ...timingCleanup,businessEvent(db,businessId,{action:'order.cancelled',resourceType:'order',resourceId:orderId,now})])
    } catch (error) {
      await classifyCommitFailure(error)
    }
  }

  const tableTab = await closeTableTabIfSettled(db, businessId, existing.table_tab_id, now)
  return {
    order: mapContext(await readContext(db, businessId, orderId)),
    movement: refund?.movement ?? null,
    tableTab,
  }
}

export const registerOrderRefund = async (db, businessId, orderId, input = {}, now = new Date()) => {
  const refundMethod = normalizeRefundMethod(input.refundMethod)
  const existing = await readContext(db, businessId, orderId)
  if (!existing) throw domainError(404, 'ORDER_NOT_FOUND', 'Pedido não encontrado.')
  if (existing.status !== 'Cancelado' || !existing.payment_id) {
    throw domainError(409, 'ORDER_REFUND_NOT_ALLOWED', 'O estorno só pode ser registrado para um pedido cancelado e pago.')
  }
  const remainingReceived = receivedNet(existing)
  if (existing.refund_movement_id || remainingReceived <= 0) throw domainError(409, 'ORDER_ALREADY_REFUNDED', 'Este pedido já foi estornado.')
  parseOrderTimingPolicySnapshot(existing.timing_policy_snapshot_json)

  const paymentExpectation = await readPaymentMethodExpectation(db, businessId, refundMethod)
  const paymentTxId = crypto.randomUUID()
  const refund = createRefundStatement(db, businessId, existing, refundMethod, now, remainingReceived)
  try {
    await db.batch([...preparePolicyGuards(db, businessId, { paymentMethods: paymentExpectation }, paymentTxId),
      refundAmountGuard(db,paymentTxId,businessId,orderId,existing.payment_id,remainingReceived,'cancelled'),
      refund.statement, clearSettingsAssertions(db, paymentTxId),businessEvent(db,businessId,{action:'payment.refunded',resourceType:'order',resourceId:orderId,now})])
  } catch (error) {
    const refreshed = await readContext(db, businessId, orderId)
    if (refreshed?.refund_movement_id) throw domainError(409, 'ORDER_ALREADY_REFUNDED', 'Este pedido já foi estornado.')
    if (String(error?.message || '').includes('POLICY_CHANGED')) rethrowPolicyChange(error)
    throw error
  }

  return {
    order: mapContext(await readContext(db, businessId, orderId)),
    movement: refund.movement,
  }
}
