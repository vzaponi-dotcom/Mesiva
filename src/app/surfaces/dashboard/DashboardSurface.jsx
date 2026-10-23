import PageSkeleton from '../../../shared/ui/PageSkeleton.jsx'
import { useMemo } from 'react'
import './dashboard.css'
import DashboardBarChart from '../../../shared/ui/DashboardBarChart'
import DashboardPeriodSelector from '../../../shared/ui/DashboardPeriodSelector'
import Icon from '../../../shared/ui/Icon'
import PageHeader from '../../../shared/ui/PageHeader'
import { useNavigation } from '../../navigation/NavigationContext.jsx'
import StatCard from '../../../shared/ui/StatCard'
import {useFinanceReadModel} from '../../../domains/finance/index.js'
import { calculateReceivedToday } from '../../../domains/finance/index.js'
import {
  getPendingAmount,
  isOrderCancelled,
  isOrderPaid,
  toLocalDateValue,
} from '../../../domains/orders/index.js'
import AreaNavigation from '../../navigation/AreaNavigation.jsx'
import DashboardLineChart from './DashboardLineChart.jsx'
import DashboardPaymentMix from './DashboardPaymentMix.jsx'
import {
  buildDailySeries,
  calculatePeriodMetrics,
  getMealsSold,
  getPaymentMix,
  getTopProducts,
} from './dashboardAnalytics.js'

const MONEY_MASK = '••••••'
const PERIOD_HELPERS = {
  today: 'Somente hoje',
  '7d': 'Hoje + 6 dias anteriores',
  '30d': 'Hoje + 29 dias anteriores',
}

const compactMoneyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  notation: 'compact',
  maximumFractionDigits: 1,
})

const formatCompactAxisValue = (value) => compactMoneyFormatter.format(Number(value) || 0)

function DashboardSurface({ orders, movements, readContext, currency, queryState, onQueryChange }) {
  const { granted, requestNavigation } = useNavigation()
  const period = queryState.period
  const valuesVisible = queryState.valuesVisible
  const setPeriod = (nextPeriod) => onQueryChange({ period: nextPeriod })
  const todayValue = toLocalDateValue()

  const legacyTotals = useMemo(() => {
    const validOrders = orders.filter((order) => !isOrderCancelled(order))
    const salesToday = validOrders
      .filter((order) => order.orderDate === todayValue)
      .reduce((total, order) => total + Number(order.total || 0), 0)
    const receivedToday = calculateReceivedToday(movements, todayValue)
    const receivables = validOrders
      .filter((order) => !isOrderPaid(order))
      .reduce((total, order) => total + getPendingAmount(order), 0)
    return { salesToday, receivedToday, receivables }
  }, [movements, orders, todayValue])

  const legacyAnalytics = useMemo(() => {
    const now = new Date(`${todayValue}T12:00:00`)
    return {
      metrics: calculatePeriodMetrics(orders, period, now),
      daily: buildDailySeries(orders, period, now),
      topProducts: getTopProducts(orders, period, now),
      mealsSold: getMealsSold(orders, period, now),
      paymentMix: getPaymentMix(movements, period, now),
    }
  }, [movements, orders, period, todayValue])

  const scoped=Boolean(readContext?.enabled)
  const reads=useFinanceReadModel({...readContext,surface:'dashboard',queryState})
  if(scoped&&!reads.main.data)return reads.main.error?<div role="alert">Não foi possível carregar os indicadores.<button type="button" onClick={reads.main.reload}>Tentar novamente</button></div>:<PageSkeleton layout="dashboard" label="Carregando indicadores" />
  const totals=scoped?reads.main.data.dashboard.totals:legacyTotals
  const analytics=scoped?reads.main.data.dashboard.analytics:legacyAnalytics
  const displayMoney = (value) => valuesVisible ? currency(value) : MONEY_MASK
  const privacyLabel = valuesVisible ? 'Ocultar valores' : 'Mostrar valores'
  const { metrics, daily, topProducts, mealsSold, paymentMix } = analytics

  return (
    <>
      <AreaNavigation area="finance" />
      {scoped&&reads.main.error&&<p role="alert">Não foi possível atualizar os indicadores.<button type="button" onClick={reads.main.reload}>Tentar novamente</button></p>}
      <div className="dashboard-overview-header">
        <PageHeader
          eyebrow="Resumo do dia"
          title="Visão geral financeira"
          description="Acompanhe os resultados de hoje e a evolução recente do negócio."
          actions={(
            <>
            {granted.has('finance.movements') && <button type="button" className="button button-secondary" onClick={() => requestNavigation('day-conference')}>Conferir recebimentos</button>}
            <button
              type="button"
              className="icon-button icon-button-neutral dashboard-privacy-toggle"
              aria-label={privacyLabel}
              title={privacyLabel}
              onClick={() => onQueryChange({ valuesVisible: !valuesVisible })}
            >
              <Icon name={valuesVisible ? 'eye' : 'eye-off'} size={17} />
            </button>
            </>
          )}
        />
      </div>
      <section className="stats-grid stats-grid-three" aria-label="Indicadores principais">
        <StatCard label="Vendas hoje" value={displayMoney(totals.salesToday)} helper="Pedidos da data de hoje" icon="receipt" tone="success" className="dashboard-stat-sales" />
        <StatCard label="Recebido hoje" value={displayMoney(totals.receivedToday)} helper="Pagamentos confirmados" icon="arrow-up" tone="success" />
        <StatCard label="A receber" value={displayMoney(totals.receivables)} helper="Pagamentos pendentes" icon="wallet" tone="warning" className="dashboard-stat-receivable" />
      </section>

      <section className="dashboard-performance-section" aria-labelledby="dashboard-performance-title">
        <div className="dashboard-performance-heading">
          <div>
            <span className="section-kicker">Desempenho</span>
            <h2 id="dashboard-performance-title">Visão do período</h2>
            <p>{PERIOD_HELPERS[period]}</p>
          </div>
          <DashboardPeriodSelector value={period} onChange={setPeriod} />
        </div>

        <div className="stats-grid dashboard-period-stats">
          <StatCard label="Vendas no período" value={displayMoney(metrics.sales)} helper="Valor dos pedidos registrados" icon="receipt" tone="success" className="dashboard-stat-sales" />
          <StatCard label="Pedidos no período" value={metrics.orderCount} helper="Quantidade de pedidos" icon="orders" />
          <StatCard label="Ticket médio" value={displayMoney(metrics.averageTicket)} helper="Venda média por pedido" icon="ticket" />
          <StatCard label="Refeições vendidas" value={mealsSold} helper="Unidades da categoria Refeições" icon="meal" />
        </div>
      </section>

      <section className="dashboard-analytics-grid" aria-label="Gráficos de desempenho">
        <article className="surface-card dashboard-chart-card">
          <div className="section-heading">
            <div><span className="section-kicker">Tendência</span><h2>Vendas por dia</h2></div>
            <div className="section-meta">{PERIOD_HELPERS[period]}</div>
          </div>
          <DashboardLineChart data={daily} valueKey="sales" labelKey="label" formatValue={currency} formatAxisValue={formatCompactAxisValue} valuesVisible={valuesVisible} ariaLabel="Vendas por dia no período selecionado" />
        </article>

        <article className="surface-card dashboard-chart-card">
          <div className="section-heading">
            <div><span className="section-kicker">Volume</span><h2>Pedidos por dia</h2></div>
            <div className="section-meta">{metrics.orderCount} pedidos</div>
          </div>
          <DashboardBarChart data={daily} valueKey="orders" labelKey="label" formatValue={(value) => String(value)} ariaLabel="Pedidos por dia no período selecionado" />
        </article>

        <article className="surface-card dashboard-chart-card">
          <div className="section-heading">
            <div><span className="section-kicker">Produtos</span><h2>Top 10 produtos</h2></div>
            <div className="section-meta">Por unidades vendidas</div>
          </div>
          <DashboardBarChart data={topProducts} valueKey="quantity" labelKey="label" formatValue={(value) => `${value} un.`} orientation="horizontal" ariaLabel="Top 10 produtos por quantidade vendida" />
        </article>

        <article className="surface-card dashboard-chart-card">
          <div className="section-heading">
            <div><span className="section-kicker">Recebimentos</span><h2>Formas de pagamento</h2></div>
            <div className="section-meta">Movimentos recebidos</div>
          </div>
          <DashboardPaymentMix data={paymentMix} formatValue={currency} valuesVisible={valuesVisible} ariaLabel="Valores recebidos por forma de pagamento" />
        </article>
      </section>
    </>
  )
}

export default DashboardSurface
