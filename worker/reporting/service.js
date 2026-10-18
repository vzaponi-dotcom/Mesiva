import { compareMetrics, previousReportingPeriod } from './comparison.js'
import { calculateOperation } from './operationAnalytics.js'
import { calculateProducts } from './productAnalytics.js'
import { calculateReceivables, groupCentsByDate } from './financialAnalytics.js'
import { getBusinessDate } from '../../shared/finance.js'
import { createExportModel, EXPORT_LIMIT } from './exportModel.js'

const sum = (rows, key) => rows.reduce((total, row) => total + Number(row[key] || 0), 0)
const hasOrderContextFilter = (query) => ['type', 'schedule', 'status', 'category', 'product', 'productName', 'customer'].some((key) => query[key])

const metricsFor = ({ orders = [], payments = [], receipts = [], refunds = [] }) => {
  const commercial = orders.filter((order) => order.status !== 'Cancelado')
  const salesCents = sum(commercial, 'total_cents')
  const receivables = calculateReceivables(commercial, payments)
  const ordersCount = commercial.length
  return {
    salesCents,
    ordersCount,
    averageTicketCents: ordersCount ? Math.round(salesCents / ordersCount) : null,
    receivedCents: sum(receipts, 'total_cents'),
    receivableCents: receivables.amountCents,
    receivableCount: receivables.count,
    cancellationRate: orders.length ? Number(((orders.filter((order) => order.status === 'Cancelado').length / orders.length) * 100).toFixed(2)) : null,
    refundsCents: sum(refunds, 'value_cents'),
  }
}

export const createReportingService = (repository) => Object.freeze({
  async overview(businessId, query) {
    const priorQuery = { ...query, ...previousReportingPeriod(query) }
    const [current, previous, currentOperationRows, previousOperationRows] = await Promise.all([
      repository.loadOverview(businessId, query), repository.loadOverview(businessId, priorQuery),
      repository.listOperationalOrders(businessId, query), repository.listOperationalOrders(businessId, priorQuery),
    ])
    const operation = calculateOperation(currentOperationRows, query)
    const previousOperation = calculateOperation(previousOperationRows, priorQuery)
    const data = { metrics: { ...metricsFor(current), withinDeadlineRate: operation.data.withinDeadlineRate } }
    const previousMetrics = metricsFor(previous)
    previousMetrics.withinDeadlineRate = previousOperation.data.withinDeadlineRate
    return {
      data,
      comparison: compareMetrics(data.metrics, previousMetrics),
      quality: { commercialOrders: data.metrics.ordersCount, receiptCount: current.receipts.length, operation: operation.quality },
      warnings: [
        ...operation.warnings,
        ...(hasOrderContextFilter(query) ? ['Recebimentos e estornos usam a data financeira e não são segmentados pelos filtros de pedido.'] : []),
      ],
    }
  },
  async operation(businessId, query) {
    const [orders, priorRows] = await Promise.all([
      repository.listOperationalOrders(businessId, query),
      repository.listOperationalOrders(businessId, { ...query, ...previousReportingPeriod(query) }),
    ])
    const current = calculateOperation(orders, query)
    const previous = calculateOperation(priorRows, query)
    const comparable = (data) => Object.fromEntries(Object.entries(data).filter(([, value]) => typeof value === 'number' || value === null))
    return { ...current, comparison: compareMetrics(comparable(current.data), comparable(previous.data)) }
  },
  async sales(businessId, query) {
    const [source, priorSource] = await Promise.all([
      repository.loadSales(businessId, query),
      repository.loadSales(businessId, { ...query, ...previousReportingPeriod(query) }),
    ])
    const commercial = source.orders.filter((order) => order.status !== 'Cancelado')
    const mix = new Map()
    for (const allocation of source.allocations) {
      const method = allocation.method_label || allocation.method_code || 'Não informado'
      mix.set(method, (mix.get(method) || 0) + Number(allocation.amount_cents || 0))
    }
    const salesCents = sum(commercial, 'total_cents')
    const ordersCount = commercial.length
    const receivables = calculateReceivables(commercial, source.payments)
    const priorCommercial = priorSource.orders.filter((order) => order.status !== 'Cancelado')
    const priorSales = sum(priorCommercial, 'total_cents')
    const priorReceivables = calculateReceivables(priorCommercial, priorSource.payments)
    const priorMetrics = {
      salesCents: priorSales, ordersCount: priorCommercial.length,
      averageTicketCents: priorCommercial.length ? Math.round(priorSales / priorCommercial.length) : null,
      receivedCents: sum(priorSource.receipts, 'total_cents'),
      merchandiseRevenueCents: priorCommercial.reduce((total, order) => total + Number(order.total_cents || 0) - Number(order.delivery_fee_cents || 0), 0),
      deliveryFeesCents: sum(priorCommercial, 'delivery_fee_cents'),
      discountCents: sum(priorCommercial.filter((order) => order.adjustment_type === 'discount'), 'adjustment_amount_cents'),
      surchargeCents: sum(priorCommercial.filter((order) => order.adjustment_type === 'surcharge'), 'adjustment_amount_cents'),
      receivableCents: priorReceivables.amountCents, receivableCount: priorReceivables.count,
      cancellationCount: priorSource.orders.length - priorCommercial.length,
      cancellationRate: priorSource.orders.length ? Number(((priorSource.orders.length - priorCommercial.length) * 100 / priorSource.orders.length).toFixed(2)) : null,
      refundsCents: sum(priorSource.refunds, 'value_cents'),
    }
    const data = {
        salesCents, ordersCount, averageTicketCents: ordersCount ? Math.round(salesCents / ordersCount) : null,
        receivedCents: sum(source.receipts, 'total_cents'),
        merchandiseRevenueCents: commercial.reduce((total, order) => total + Number(order.total_cents || 0) - Number(order.delivery_fee_cents || 0), 0),
        deliveryFeesCents: sum(commercial, 'delivery_fee_cents'),
        discountCents: sum(commercial.filter((order) => order.adjustment_type === 'discount'), 'adjustment_amount_cents'),
        surchargeCents: sum(commercial.filter((order) => order.adjustment_type === 'surcharge'), 'adjustment_amount_cents'),
        receivableCents: receivables.amountCents, receivableCount: receivables.count,
        receivables: { overdue: receivables.overdue, today: receivables.today, upcoming: receivables.upcoming },
        cancellationCount: source.orders.length - commercial.length,
        cancellationRate: source.orders.length ? Number(((source.orders.length - commercial.length) * 100 / source.orders.length).toFixed(2)) : null,
        paymentMix: [...mix].map(([method, amountCents]) => ({ method, amountCents })).sort((left, right) => left.method.localeCompare(right.method)),
        refundsCents: sum(source.refunds, 'value_cents'),
        salesSeries: groupCentsByDate(commercial, (order) => order.order_date, (order) => order.total_cents),
        ordersSeries: groupCentsByDate(commercial, (order) => order.order_date, () => 1).map(({ date, cents }) => ({ date, count: cents })),
        receivedSeries: groupCentsByDate(source.receipts, (receipt) => receipt.received_date ?? (receipt.paid_at && getBusinessDate(new Date(receipt.paid_at))), (receipt) => receipt.total_cents),
        refundSeries: groupCentsByDate(source.refunds, (refund) => refund.movement_date, (refund) => refund.value_cents),
    }
    const comparable = Object.fromEntries(Object.entries(data).filter(([key]) => Object.hasOwn(priorMetrics, key)))
    return {
      data,
      comparison: compareMetrics(comparable, priorMetrics),
      quality: { receiptCount: source.receipts.length },
      warnings: hasOrderContextFilter(query) || query.paymentMethod
        ? ['Vendas seguem filtros de pedido; recebimentos seguem data efetiva de recebimento e forma selecionada, e estornos seguem data do movimento.'] : [],
    }
  },
  async products(businessId, query) {
    const [current, previous] = await Promise.all([
      repository.loadProductLines(businessId, query),
      repository.loadProductLines(businessId, { ...query, ...previousReportingPeriod(query) }),
    ])
    const data = calculateProducts(current, query)
    const prior = calculateProducts(previous, query)
    const priorById = new Map(prior.ranking.map((item) => [item.id, item]))
    const addGrowth = (item) => {
      const previousUnits = priorById.get(item.id)?.quantity || 0
      return { ...item, previousUnits, growthPercent: previousUnits ? Number(((item.quantity - previousUnits) * 100 / previousUnits).toFixed(2)) : null }
    }
    data.ranking = data.ranking.map(addGrowth)
    data.top10 = data.ranking.slice(0, 10)
    return {
      data,
      comparison: compareMetrics({ unitsSold: data.unitsSold, mealsSold: data.mealsSold, merchandiseRevenueCents: data.merchandiseRevenueCents }, prior),
      quality: { orderCount: new Set(current.map((line) => line.order_id)).size, lineCount: current.length, invalidAllocationOrderCount: data.invalidAllocationOrderCount },
      warnings: data.invalidAllocationOrderCount ? ['Alguns pedidos não possuem base válida para alocar receita de mercadoria.'] : [],
    }
  },
  async detail(businessId, query) {
    const priorQuery = { ...query, ...previousReportingPeriod(query), page: 1 }
    const [result, summary, priorSummary] = await Promise.all([
      repository.listDetail(businessId, query),
      repository.loadDetailSummary(businessId, query),
      repository.loadDetailSummary(businessId, priorQuery),
    ])
    return {
      data: {
        ...result,
        summary,
        page: query.page,
        pageSize: query.pageSize,
        sort: query.sort || 'date-desc',
        totalPages: Math.ceil(result.total / query.pageSize),
      },
      comparison: compareMetrics(summary, priorSummary),
      quality: {},
    }
  },
  async orderDetail(businessId, id) {
    return { data: await repository.getOrderDetail(businessId, id), quality: {} }
  },
  async exportModel(businessId, query, columns, format = null) {
    const reportPromise = this[query.view](businessId, query)
    const overviewPromise = format === 'pdf'
      ? (query.view === 'overview' ? reportPromise : this.overview(businessId, query))
      : Promise.resolve(null)
    const operationPromise = format === 'pdf'
      ? (query.view === 'operation' ? reportPromise : this.operation(businessId, query))
      : Promise.resolve(null)
    const productsPromise = format === 'pdf'
      ? (query.view === 'products' ? reportPromise : this.products(businessId, query))
      : Promise.resolve(null)
    const [detail, report, operationIdentity, overview, operation, products] = await Promise.all([
      repository.listDetail(businessId, { ...query, page: 1, pageSize: EXPORT_LIMIT,
        withFinancialDates: columns == null || (Array.isArray(columns) && columns.includes('payment_received_dates')) }),
      reportPromise,
      repository.getBusinessIdentity ? repository.getBusinessIdentity(businessId) : Promise.resolve(null),
      overviewPromise,
      operationPromise,
      productsPromise,
    ])
    const executive = format === 'pdf' ? { overview, operation, products } : null
    return {
      data: createExportModel({ query, report, detail, columns, operation: operationIdentity, executive }),
      quality: report.quality,
      warnings: report.warnings,
    }
  },
  async empty(_businessId, _query) {
    return { data: {}, quality: {} }
  },
})