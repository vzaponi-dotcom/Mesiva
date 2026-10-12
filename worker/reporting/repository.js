import { businessDateRangeUtc } from './businessDate.js'
import {orderGrossReceivedSql,orderRefundedSql,orderDueSql,orderRefundDueSql} from './settlementSql.js'
import { buildOrderFilters } from './orderFilters.js'
import { getBusinessDate } from '../../shared/finance.js'
import { getOperationalDurationMinutes, getOrderLateAt } from '../../shared/orderTiming.js'

const hourInBusiness = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hourCycle: 'h23' })
const terminal = new Set(['Finalizado', 'Entregue', 'Despachado'])
const enrichDetail = (row) => {
  const order = {
    status: row.status, createdAt: row.created_at, finishedAt: row.finished_at,
    scheduledFor: row.scheduled_for, timingPolicySnapshot: row.timing_policy_snapshot_json,
  }
  const durationMinutes = terminal.has(row.status) && !row.is_backdated ? getOperationalDurationMinutes(order) : null
  const lateAt = durationMinutes === null ? null : getOrderLateAt(order)
  const onTime = lateAt ? new Date(row.finished_at) <= lateAt : null
  const grossReceivedCents = Number(row.gross_received_cents ?? row.paid_cents ?? 0)
  const refundedCents = Number(row.refunded_cents || 0)
  const netReceivedCents = grossReceivedCents - refundedCents
  const dueCents = Math.max(0,Number(row.total_cents || 0) - netReceivedCents)
  const refundDueCents = Math.max(0,netReceivedCents - Number(row.total_cents || 0))
  const pendingCents = row.status !== 'Cancelado'
    && !row.table_reservation_id
    && !(row.customer_identity_type === 'table' && row.table_tab_id) ? dueCents : 0
  const paymentStatus = refundDueCents > 0 ? 'Devolução pendente'
    : dueCents > 0 ? (grossReceivedCents ? 'Parcialmente pago' : 'Pendente')
    : grossReceivedCents ? 'Pago' : 'Pendente'
  const created = new Date(row.created_at)
  return { ...row, durationMinutes, onTime, paymentStatus,
    paidCents:grossReceivedCents,grossReceivedCents,refundedCents,netReceivedCents,
    dueCents,refundDueCents,pendingCents,
    businessDate:Number.isNaN(created.getTime()) ? null : getBusinessDate(created) }
}

const compareDetail = (sort) => (left, right) => {
  const direction = sort?.endsWith('-asc') ? 1 : -1
  const field = sort?.startsWith('total') ? 'total_cents' : sort?.startsWith('duration') ? 'durationMinutes' : 'order_date'
  if (field === 'durationMinutes') {
    const leftMissing = left.durationMinutes === null || left.durationMinutes === undefined
    const rightMissing = right.durationMinutes === null || right.durationMinutes === undefined
    if (leftMissing !== rightMissing) return leftMissing ? 1 : -1
  }
  const a = left[field] ?? -Infinity
  const b = right[field] ?? -Infinity
  const result = typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b))
  return direction * result || (right.order_number || 0) - (left.order_number || 0) || String(right.id).localeCompare(String(left.id))
}

export function createReportingRepository(db) {
  return Object.freeze({
    async getBusinessIdentity(businessId) {
      const row = await db.prepare('SELECT id, name, slug FROM businesses WHERE id = ?').bind(businessId).first()
      return row ? { id: row.id, name: row.name, slug: row.slug } : null
    },
    async listOrders(businessId, { from, to }) {
      const { results } = await db.prepare(`
        SELECT id, order_number, order_date, type, status, total_cents
        FROM orders
        WHERE business_id = ? AND order_date >= ? AND order_date <= ?
        ORDER BY order_date ASC, order_number ASC, id ASC
      `).bind(businessId, from, to).all()
      return results
    },
    async loadOverview(businessId, query) {
      const [paidFrom, paidTo] = businessDateRangeUtc(query.from, query.to)
      const { sql, values } = buildOrderFilters(businessId, query)
      const { results: orders } = await db.prepare(`
        SELECT o.id, o.order_date, o.type, o.status, o.total_cents, o.table_tab_id,
          o.customer_identity_type, o.promised_payment_date, o.adjustment_type, o.adjustment_amount_cents,
          tr.id AS table_reservation_id
        FROM orders o
        LEFT JOIN table_reservations tr
          ON tr.business_id = o.business_id AND tr.order_id = o.id
        WHERE ${sql}
      `).bind(...values).all()
      const { results: payments } = await db.prepare(`
        SELECT order_id, amount_cents FROM payments
        WHERE business_id = ? AND order_id IN (
          SELECT o.id FROM orders o WHERE ${sql}
        )
      `).bind(businessId, ...values).all()
      const { results: receipts } = await db.prepare(`
        SELECT total_cents FROM payment_receipts
        WHERE business_id = ? AND paid_at >= ? AND paid_at < ? ORDER BY paid_at, id
      `).bind(businessId, paidFrom, paidTo).all()
      const { results: refunds } = await db.prepare(`
        SELECT value_cents FROM movements
        WHERE business_id = ? AND source = 'order-refund' AND deleted_at IS NULL
          AND movement_date >= ? AND movement_date <= ?
      `).bind(businessId, query.from, query.to).all()
      return { orders, payments, receipts, refunds }
    },
    async listOperationalOrders(businessId, query) {
      const { sql, values } = buildOrderFilters(businessId, { ...query, paymentMethod: null, search: null })
      const { results } = await db.prepare(`
        SELECT o.id, o.order_date, o.type, o.status, o.scheduled_for, o.is_backdated,
          o.created_at, o.finished_at, o.timing_policy_snapshot_json
        FROM orders o WHERE ${sql}
      `).bind(...values).all()
      return results
    },
    async loadSales(businessId, query) {
      const [paidFrom, paidTo] = businessDateRangeUtc(query.from, query.to)
      const { sql, values } = buildOrderFilters(businessId, query)
      const { results: orders } = await db.prepare(`SELECT o.id, o.order_date, o.status, o.total_cents, o.delivery_fee_cents,
        o.table_tab_id, o.customer_identity_type, o.promised_payment_date, o.adjustment_type, o.adjustment_amount_cents,
        tr.id AS table_reservation_id
        FROM orders o
        LEFT JOIN table_reservations tr
          ON tr.business_id = o.business_id AND tr.order_id = o.id
        WHERE ${sql}`).bind(...values).all()
      const methodWhere = query.paymentMethod ? 'AND (pa.method_code = ? OR pa.method_label = ? COLLATE NOCASE)' : ''
      const methodValues = query.paymentMethod ? [query.paymentMethod, query.paymentMethod] : []
      const { results: receipts } = query.paymentMethod
        ? await db.prepare(`SELECT r.id, r.paid_at,
          (SELECT SUM(pa.amount_cents) FROM payment_allocations pa
            WHERE pa.business_id = r.business_id AND pa.receipt_id = r.id ${methodWhere}) AS total_cents
          FROM payment_receipts r WHERE r.business_id = ? AND r.paid_at >= ? AND r.paid_at < ?
          AND EXISTS (SELECT 1 FROM payment_allocations pa WHERE pa.business_id = r.business_id
            AND pa.receipt_id = r.id ${methodWhere})`)
          .bind(...methodValues, businessId, paidFrom, paidTo, ...methodValues).all()
        : await db.prepare('SELECT id, total_cents, paid_at FROM payment_receipts WHERE business_id = ? AND paid_at >= ? AND paid_at < ?').bind(businessId, paidFrom, paidTo).all()
      const { results: allocations } = await db.prepare(`SELECT pa.receipt_id, pa.method_code, pa.method_label, pa.amount_cents
        FROM payment_allocations pa JOIN payment_receipts r ON r.business_id = pa.business_id AND r.id = pa.receipt_id
        WHERE pa.business_id = ? AND r.paid_at >= ? AND r.paid_at < ? ${methodWhere}`)
        .bind(businessId, paidFrom, paidTo, ...methodValues).all()
      const { results: payments } = await db.prepare(`SELECT order_id, amount_cents FROM payments WHERE business_id = ? AND order_id IN (SELECT o.id FROM orders o WHERE ${sql})`).bind(businessId, ...values).all()
      const { results: refunds } = await db.prepare("SELECT value_cents, movement_date FROM movements WHERE business_id = ? AND source = 'order-refund' AND deleted_at IS NULL AND movement_date BETWEEN ? AND ?").bind(businessId, query.from, query.to).all()
      return { orders, receipts, allocations, payments, refunds }
    },
    async loadProductLines(businessId, query) {
      const { sql, values } = buildOrderFilters(businessId, { ...query, paymentMethod: null, search: null })
      const { results } = await db.prepare(`
        SELECT o.id AS order_id, o.order_date, o.status, o.total_cents, o.delivery_fee_cents,
          oi.id AS item_id, oi.product_id, oi.name_snapshot, oi.category_snapshot,
          oi.size_snapshot, oi.quantity, oi.unit_price_cents
        FROM orders o JOIN order_items oi ON oi.business_id = o.business_id AND oi.order_id = o.id
        WHERE ${sql} AND o.status <> 'Cancelado'
        ORDER BY o.order_date, o.id, oi.id
      `).bind(...values).all()
      return results
    },
    async listDetail(businessId, query) {
      const { sql, values } = buildOrderFilters(businessId, query)
      const select = `SELECT o.id, o.order_number, o.order_date, o.client_id,
        o.client_name_snapshot, o.client_phone_snapshot, o.type, o.status, o.subtotal_cents, o.total_cents,
        o.delivery_fee_cents, o.adjustment_type, o.adjustment_amount_cents,
        o.customer_identity_type, o.table_tab_id, o.promised_payment_date,
        o.scheduled_for, o.is_backdated, o.created_at, o.finished_at, o.timing_policy_snapshot_json,
        tr.id AS table_reservation_id,
        (SELECT SUM(pay.amount_cents) FROM payments pay
          WHERE pay.business_id = o.business_id AND pay.order_id = o.id) AS paid_cents,
        (SELECT GROUP_CONCAT(DISTINCT COALESCE(pa.method_label, pa.method_code))
          FROM payments pay2 JOIN payment_allocations pa
            ON pa.business_id = pay2.business_id AND pa.receipt_id = pay2.receipt_id
          WHERE pay2.business_id = o.business_id AND pay2.order_id = o.id) AS payment_label
        FROM orders o
        LEFT JOIN table_reservations tr
          ON tr.business_id = o.business_id AND tr.order_id = o.id
        WHERE ${sql}`
      const size = query.pageSize || 25
      const page = query.page || 1
      const complex = query.operationalDeadline || query.orderHourFrom != null || query.orderHourTo != null || query.sort?.startsWith('duration')
      if (!complex) {
        const total = Number(await db.prepare(`SELECT count(*) AS total FROM orders o WHERE ${sql}`).bind(...values).first('total') || 0)
        const orderBy = query.sort?.startsWith('total')
          ? `o.total_cents ${query.sort === 'total-asc' ? 'ASC' : 'DESC'}, o.order_date DESC, o.order_number DESC, o.id DESC`
          : `o.order_date ${query.sort === 'date-asc' ? 'ASC' : 'DESC'}, o.order_number DESC, o.id DESC`
        const { results } = await db.prepare(`${select} ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
          .bind(...values, size, (page - 1) * size).all()
        return { total, items: results.map(enrichDetail) }
      }
      const { results } = await db.prepare(select).bind(...values).all()
      const filtered = results.map(enrichDetail).filter((row) => {
        if (query.operationalDeadline && (row.onTime === null || row.onTime !== (query.operationalDeadline === 'on-time'))) return false
        if (query.orderHourFrom == null && query.orderHourTo == null) return true
        if (!row.businessDate) return false
        const hour = Number(hourInBusiness.format(new Date(row.created_at)))
        return (query.orderHourFrom == null || hour >= query.orderHourFrom)
          && (query.orderHourTo == null || hour <= query.orderHourTo)
      }).sort(compareDetail(query.sort))
      return { total: filtered.length, items: filtered.slice((page - 1) * size, page * size) }
    },
    async loadDetailSummary(businessId, query) {
      const { sql, values } = buildOrderFilters(businessId, query)
      const complex = query.operationalDeadline || query.orderHourFrom != null || query.orderHourTo != null

      if (!complex) {
        const row = await db.prepare(`
          SELECT
            COUNT(*) AS orders_count,
            SUM(CASE WHEN o.status <> 'Cancelado' THEN o.total_cents ELSE 0 END) AS sales_cents,
            SUM(CASE WHEN o.status <> 'Cancelado' THEN 1 ELSE 0 END) AS commercial_count,
            SUM(CASE WHEN o.status = 'Cancelado' THEN 1 ELSE 0 END) AS cancellation_count
          FROM orders o
          WHERE ${sql}
        `).bind(...values).first()
        const ordersCount = Number(row?.orders_count || 0)
        const salesCents = Number(row?.sales_cents || 0)
        const commercialCount = Number(row?.commercial_count || 0)
        const cancellationCount = Number(row?.cancellation_count || 0)
        return {
          ordersCount,
          salesCents,
          averageTicketCents: commercialCount ? Math.round(salesCents / commercialCount) : null,
          cancellationRate: ordersCount ? Number(((cancellationCount / ordersCount) * 100).toFixed(2)) : null,
        }
      }

      const { results } = await db.prepare(`
        SELECT o.status, o.total_cents, o.scheduled_for, o.is_backdated,
          o.created_at, o.finished_at, o.timing_policy_snapshot_json
        FROM orders o
        WHERE ${sql}
      `).bind(...values).all()
      const filtered = results.map(enrichDetail).filter((row) => {
        if (query.operationalDeadline && (row.onTime === null || row.onTime !== (query.operationalDeadline === 'on-time'))) return false
        if (query.orderHourFrom == null && query.orderHourTo == null) return true
        if (!row.businessDate) return false
        const hour = Number(hourInBusiness.format(new Date(row.created_at)))
        return (query.orderHourFrom == null || hour >= query.orderHourFrom)
          && (query.orderHourTo == null || hour <= query.orderHourTo)
      })
      const commercial = filtered.filter((row) => row.status !== 'Cancelado')
      const salesCents = commercial.reduce((total, row) => total + Number(row.total_cents || 0), 0)
      const cancellationCount = filtered.length - commercial.length
      return {
        ordersCount: filtered.length,
        salesCents,
        averageTicketCents: commercial.length ? Math.round(salesCents / commercial.length) : null,
        cancellationRate: filtered.length ? Number(((cancellationCount / filtered.length) * 100).toFixed(2)) : null,
      }
    },
    async getOrderDetail(businessId, id) {
      const row = await db.prepare(`SELECT o.id, o.order_number, o.order_date, o.client_id, o.client_name_snapshot,
        o.client_phone_snapshot, o.client_address_snapshot, o.type, o.status, o.subtotal_cents, o.total_cents,
        o.delivery_fee_cents, o.adjustment_type, o.adjustment_amount_cents,
        o.customer_identity_type, o.table_tab_id, o.promised_payment_date,
        o.scheduled_for, o.is_backdated, o.created_at, o.finished_at,
        o.cancelled_at, o.cancel_reason, o.cancel_reason_note, cr.label AS cancel_reason_label,
        o.timing_policy_snapshot_json, tr.id AS table_reservation_id,
        (SELECT SUM(pay.amount_cents) FROM payments pay
          WHERE pay.business_id = o.business_id AND pay.order_id = o.id) AS paid_cents
        FROM orders o
        LEFT JOIN business_cancel_reasons cr
          ON cr.business_id = o.business_id AND cr.id = o.cancel_reason
        LEFT JOIN table_reservations tr
          ON tr.business_id = o.business_id AND tr.order_id = o.id
        WHERE o.business_id = ? AND o.id = ?`).bind(businessId, id).first()
      if (!row) return null

      const { results: items } = await db.prepare(`SELECT id, product_id, name_snapshot, category_snapshot,
        size_snapshot, quantity, unit_price_cents FROM order_items
        WHERE business_id = ? AND order_id = ? ORDER BY created_at, id`).bind(businessId, id).all()

      const { results: allocations } = await db.prepare(`
        SELECT pa.receipt_id, pa.method_code, pa.method_label, pa.amount_cents, r.paid_at
        FROM payment_allocations pa
        JOIN payment_receipts r
          ON r.business_id = pa.business_id AND r.id = pa.receipt_id
        JOIN (
          SELECT DISTINCT receipt_id FROM payments
          WHERE business_id = ? AND order_id = ? AND receipt_id IS NOT NULL
        ) receipts ON receipts.receipt_id = pa.receipt_id
        WHERE pa.business_id = ?
        ORDER BY r.paid_at, pa.id
      `).bind(businessId, id, businessId).all()

      let clientContext = null
      if (row.client_id) {
        const profile = await db.prepare(`
          SELECT id, name, phone, address
          FROM clients
          WHERE business_id = ? AND id = ?
        `).bind(businessId, row.client_id).first()

        if (profile) {
          const summaryRow = await db.prepare(`
            SELECT
              COUNT(*) AS orders_count,
              SUM(CASE WHEN o.status <> 'Cancelado' THEN 1 ELSE 0 END) AS commercial_count,
              SUM(CASE WHEN o.status <> 'Cancelado' THEN o.total_cents ELSE 0 END) AS total_spent_cents,
              SUM(CASE WHEN o.status = 'Cancelado' THEN 1 ELSE 0 END) AS cancellation_count,
              MAX(CASE WHEN o.status <> 'Cancelado' THEN o.order_date ELSE NULL END) AS last_purchase_date,
              SUM(CASE
                WHEN o.status <> 'Cancelado'
                  AND NOT (o.customer_identity_type = 'table' AND o.table_tab_id IS NOT NULL)
                  AND NOT EXISTS (
                    SELECT 1 FROM table_reservations pending_reservation
                    WHERE pending_reservation.business_id = o.business_id
                      AND pending_reservation.order_id = o.id
                  )
                THEN CASE
                  WHEN o.total_cents - COALESCE((
                    SELECT SUM(pay.amount_cents)
                    FROM payments pay
                    WHERE pay.business_id = o.business_id AND pay.order_id = o.id
                  ), 0) > 0
                  THEN o.total_cents - COALESCE((
                    SELECT SUM(pay.amount_cents)
                    FROM payments pay
                    WHERE pay.business_id = o.business_id AND pay.order_id = o.id
                  ), 0)
                  ELSE 0
                END
                ELSE 0
              END) AS pending_cents
            FROM orders o
            WHERE o.business_id = ? AND o.client_id = ?
          `).bind(businessId, row.client_id).first()

          const { results: clientOrderRows } = await db.prepare(`
            SELECT o.id, o.order_number, o.order_date, o.client_id,
              o.client_name_snapshot, o.client_phone_snapshot, o.type, o.status,
              o.subtotal_cents, o.total_cents, o.delivery_fee_cents,
              o.adjustment_type, o.adjustment_amount_cents,
              o.customer_identity_type, o.table_tab_id, o.promised_payment_date,
              o.scheduled_for, o.is_backdated, o.created_at, o.finished_at,
              o.timing_policy_snapshot_json, tr.id AS table_reservation_id,
              (SELECT SUM(pay.amount_cents) FROM payments pay
                WHERE pay.business_id = o.business_id AND pay.order_id = o.id) AS paid_cents
            FROM orders o
            LEFT JOIN table_reservations tr
              ON tr.business_id = o.business_id AND tr.order_id = o.id
            WHERE o.business_id = ? AND o.client_id = ?
            ORDER BY o.order_date DESC, o.created_at DESC, o.order_number DESC, o.id DESC
            LIMIT 100
          `).bind(businessId, row.client_id).all()

          const ordersCount = Number(summaryRow?.orders_count || 0)
          const commercialCount = Number(summaryRow?.commercial_count || 0)
          const totalSpentCents = Number(summaryRow?.total_spent_cents || 0)
          clientContext = {
            profile: { id: profile.id, name: profile.name, phone: profile.phone || '', address: profile.address || '' },
            summary: {
              ordersCount,
              totalSpentCents,
              averageTicketCents: commercialCount ? Math.round(totalSpentCents / commercialCount) : null,
              pendingCents: Number(summaryRow?.pending_cents || 0),
              cancellationCount: Number(summaryRow?.cancellation_count || 0),
              lastPurchaseDate: summaryRow?.last_purchase_date || null,
            },
            orders: clientOrderRows.map(enrichDetail),
          }
        }
      }

      return { ...enrichDetail(row), items, paymentAllocations: allocations, clientContext }
    }
  })
}
