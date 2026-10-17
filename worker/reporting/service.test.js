import test from 'node:test'
import assert from 'node:assert/strict'

test('overview keeps commercial, receipt, receivable and refund semantics separate', async () => {
  const { createReportingService } = await import('./service.js')
  const repository = {
    async listOperationalOrders() { return [] },
    async loadOverview(_businessId, query) {
      if (query.to === '2026-08-31') return { orders: [], payments: [], receipts: [], refunds: [] }
      return {
        orders: [
          { id: 'finished', order_date: '2026-09-10', status: 'Finalizado', total_cents: 1_000, table_tab_id: null },
          { id: 'active', order_date: '2026-09-11', status: 'Em preparo', total_cents: 500, table_tab_id: null },
          { id: 'cancelled', order_date: '2026-09-12', status: 'Cancelado', total_cents: 900, table_tab_id: null },
          { id: 'open-tab', order_date: '2026-09-12', status: 'Finalizado', total_cents: 700, customer_identity_type: 'table', table_tab_id: 'tab-1' },
        ],
        payments: [{ order_id: 'finished', amount_cents: 1_000 }],
        receipts: [{ total_cents: 1_000 }, { total_cents: 300 }],
        refunds: [{ value_cents: 200 }],
      }
    },
  }
  const result = await createReportingService(repository).overview('business-a', { from: '2026-09-01', to: '2026-09-30' })

  assert.deepEqual(result.data.metrics, {
    salesCents: 2_200,
    ordersCount: 3,
    averageTicketCents: 733,
    receivedCents: 1_300,
    receivableCents: 500,
    receivableCount: 1,
    cancellationRate: 25,
    refundsCents: 200,
    withinDeadlineRate: null,
  })
  assert.equal(result.comparison.available, false)
})

test('comparison windows follow each approved preset including month-to-date alignment', async () => {
  const { previousReportingPeriod } = await import('./comparison.js')
  assert.deepEqual(previousReportingPeriod({ from: '2026-09-25', to: '2026-09-25', period: 'today' }), { from: '2026-09-24', to: '2026-09-24' })
  assert.deepEqual(previousReportingPeriod({ from: '2026-09-19', to: '2026-09-25', period: '7-days' }), { from: '2026-09-12', to: '2026-09-18' })
  assert.deepEqual(previousReportingPeriod({ from: '2026-09-01', to: '2026-09-25', period: 'current-month' }), { from: '2026-08-01', to: '2026-08-25' })
  assert.deepEqual(previousReportingPeriod({ from: '2026-08-01', to: '2026-08-31', period: 'previous-month' }), { from: '2026-07-01', to: '2026-07-31' })
  assert.deepEqual(previousReportingPeriod({ from: '2026-09-10', to: '2026-09-12', period: 'custom' }), { from: '2026-09-07', to: '2026-09-09' })
  assert.deepEqual(previousReportingPeriod({ from: '2026-03-01', to: '2026-03-31', period: 'current-month' }), { from: '2026-02-01', to: '2026-02-28' })
})

test('overview returns a comparison for every KPI with semantic direction and unavailable denominator', async () => {
  const { createReportingService } = await import('./service.js')
  const repository = { async listOperationalOrders() { return [] }, async loadOverview(_id, query) {
    return query.from === '2026-08-01'
      ? { orders: [{ id: 'prior', status: 'Finalizado', total_cents: 500, table_tab_id: null }], payments: [], receipts: [], refunds: [] }
      : { orders: [{ id: 'now', status: 'Finalizado', total_cents: 1000, table_tab_id: null }], payments: [], receipts: [], refunds: [] }
  } }
  const result = await createReportingService(repository).overview('a', { from: '2026-09-01', to: '2026-09-25', period: 'current-month' })
  assert.equal(result.comparison.metrics.salesCents.previous, 500)
  assert.equal(result.comparison.metrics.salesCents.delta, 500)
  assert.equal(result.comparison.metrics.salesCents.percent, 100)
  assert.equal(result.comparison.metrics.salesCents.direction, 'higher_better')
  assert.equal(result.comparison.metrics.receivedCents.available, false)
  assert.equal(result.comparison.metrics.cancellationRate.direction, 'lower_better')
})

test('sales keeps future order_date separate from early receipt date and excludes active reservation from receivables', async () => {
  const { createReportingService } = await import('./service.js')
  const repository = {
    async loadSales(_businessId, query) {
      if (query.from === '2026-09-29') {
        return {
          orders: [],
          receipts: [{ id: 'early-receipt', total_cents: 4_000, paid_at: '2026-09-29T15:00:00.000Z' }],
          allocations: [{ receipt_id: 'early-receipt', method_label: 'Pix', amount_cents: 4_000 }],
          payments: [],
          refunds: [],
        }
      }
      if (query.from === '2026-10-03') {
        return {
          orders: [
            {
              id: 'future-delivery',
              order_date: '2026-10-03',
              status: 'Finalizado',
              type: 'Entrega',
              total_cents: 4_000,
              delivery_fee_cents: 0,
              adjustment_type: 'none',
              adjustment_amount_cents: 0,
              customer_identity_type: 'registered_client',
              table_tab_id: null,
              table_reservation_id: null,
              promised_payment_date: null,
            },
            {
              id: 'future-local-reservation',
              order_date: '2026-10-03',
              status: 'Finalizado',
              type: 'Local',
              total_cents: 5_000,
              delivery_fee_cents: 0,
              adjustment_type: 'none',
              adjustment_amount_cents: 0,
              customer_identity_type: 'table',
              table_tab_id: null,
              table_reservation_id: 'reservation-1',
              promised_payment_date: null,
            },
            {
              id: 'no-show-local',
              order_date: '2026-10-03',
              status: 'Cancelado',
              type: 'Local',
              total_cents: 3_000,
              delivery_fee_cents: 0,
              adjustment_type: 'none',
              adjustment_amount_cents: 0,
              customer_identity_type: 'table',
              table_tab_id: null,
              table_reservation_id: 'reservation-no-show',
              promised_payment_date: null,
            },
          ],
          receipts: [],
          allocations: [],
          payments: [{ order_id: 'future-delivery', amount_cents: 4_000 }],
          refunds: [],
        }
      }
      return { orders: [], receipts: [], allocations: [], payments: [], refunds: [] }
    },
  }
  const service = createReportingService(repository)

  const paymentDay = await service.sales('business-a', {
    from: '2026-09-29',
    to: '2026-09-29',
    period: 'custom',
  })
  assert.equal(paymentDay.data.salesCents, 0)
  assert.equal(paymentDay.data.receivedCents, 4_000)
  assert.deepEqual(paymentDay.data.salesSeries, [])
  assert.deepEqual(paymentDay.data.receivedSeries, [{ date: '2026-09-29', cents: 4_000 }])

  const serviceDay = await service.sales('business-a', {
    from: '2026-10-03',
    to: '2026-10-03',
    period: 'custom',
  })
  assert.equal(serviceDay.data.salesCents, 9_000)
  assert.equal(serviceDay.data.ordersCount, 2)
  assert.equal(serviceDay.data.receivedCents, 0)
  assert.equal(serviceDay.data.receivableCents, 0)
  assert.equal(serviceDay.data.receivableCount, 0)
  assert.deepEqual(serviceDay.data.salesSeries, [{ date: '2026-10-03', cents: 9_000 }])
  assert.deepEqual(serviceDay.data.ordersSeries, [{ date: '2026-10-03', count: 2 }])
  assert.deepEqual(serviceDay.data.receivedSeries, [])
})

test('overview receivable metrics exclude an active reservation while keeping ordinary future unpaid orders', async () => {
  const { createReportingService } = await import('./service.js')
  const repository = {
    async listOperationalOrders() { return [] },
    async loadOverview(_businessId, query) {
      if (query.from !== '2026-10-03') return { orders: [], payments: [], receipts: [], refunds: [] }
      return {
        orders: [
          {
            id: 'future-delivery-unpaid',
            order_date: '2026-10-03',
            status: 'Finalizado',
            type: 'Entrega',
            total_cents: 4_000,
            customer_identity_type: 'registered_client',
            table_tab_id: null,
            table_reservation_id: null,
            promised_payment_date: null,
          },
          {
            id: 'future-local-reservation',
            order_date: '2026-10-03',
            status: 'Finalizado',
            type: 'Local',
            total_cents: 5_000,
            customer_identity_type: 'table',
            table_tab_id: null,
            table_reservation_id: 'reservation-1',
            promised_payment_date: null,
          },
        ],
        payments: [],
        receipts: [],
        refunds: [],
      }
    },
  }

  const result = await createReportingService(repository).overview('business-a', {
    from: '2026-10-03',
    to: '2026-10-03',
    period: 'custom',
  })

  assert.equal(result.data.metrics.salesCents, 9_000)
  assert.equal(result.data.metrics.ordersCount, 2)
  assert.equal(result.data.metrics.receivableCents, 4_000)
  assert.equal(result.data.metrics.receivableCount, 1)
})


test('Task 7: sales series uses financial received_date even when paid_at was recorded two days later',async()=>{
  const {createReportingService}=await import('./service.js')
  const empty={orders:[],receipts:[],allocations:[],payments:[],refunds:[]}
  const repo={loadSales:async(_biz,query)=>query.from==='2026-10-15'?{
    ...empty,receipts:[{id:'retro',total_cents:10000,paid_at:'2026-10-17T15:00:00Z',received_date:'2026-10-15'}],
    allocations:[{receipt_id:'retro',method_label:'Pix',amount_cents:7000},{receipt_id:'retro',method_label:'Dinheiro',amount_cents:3000}],
    refunds:[{value_cents:500,movement_date:'2026-10-15'}],
  }:empty}
  const svc=createReportingService(repo)
  const retro=await svc.sales('a',{from:'2026-10-15',to:'2026-10-15',period:'custom'})
  assert.equal(retro.data.receivedCents,10000)
  assert.deepEqual(retro.data.receivedSeries,[{date:'2026-10-15',cents:10000}])
  assert.deepEqual(retro.data.paymentMix,[{method:'Dinheiro',amountCents:3000},{method:'Pix',amountCents:7000}])
  assert.deepEqual(retro.data.refundSeries,[{date:'2026-10-15',cents:500}])
  const today=await svc.sales('a',{from:'2026-10-17',to:'2026-10-17',period:'custom'})
  assert.equal(today.data.receivedCents,0)
  assert.deepEqual(today.data.receivedSeries,[])
})
