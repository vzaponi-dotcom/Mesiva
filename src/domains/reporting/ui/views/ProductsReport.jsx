import { useState } from 'react'
import Button from '../../../../shared/ui/Button.jsx'
import Icon from '../../../../shared/ui/Icon.jsx'
import SystemSelect from '../../../../shared/ui/SystemSelect.jsx'
import { ReportingMetricCard } from '../ReportingMetricCard.jsx'
import { ReportingState } from '../ReportingState.jsx'
import { ReportingInfoTip } from '../ReportingInfoTip.jsx'

const money = (cents) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(cents || 0) / 100)
const number = (value) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(Number(value || 0))
const percentage = (value) => `${number(value)}%`
const mixPalette = [
  'var(--primary)',
  'var(--info)',
  'var(--success)',
  'var(--warning)',
  'var(--danger)',
  'color-mix(in srgb, var(--primary) 58%, var(--info))',
  'color-mix(in srgb, var(--warning) 62%, var(--danger))',
  'color-mix(in srgb, var(--success) 56%, var(--primary))',
  'color-mix(in srgb, var(--text-soft) 58%, var(--primary))',
]

const finiteNumber = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null

function ProductsMetricTextCard({ label, value, detail, icon = 'products' }) {
  return <article className="surface-card reporting-metric-card reporting-products-text-metric">
    <div className="reporting-metric-heading">
      <span className="reporting-metric-icon"><Icon name={icon} size={18} /></span>
      <span className="reporting-metric-label-wrap"><span className="reporting-metric-label">{label}</span><ReportingInfoTip helpKey={label} /></span>
    </div>
    <strong>{value}</strong>
    <small className="reporting-comparison"><span>{detail}</span></small>
  </article>
}

function PanelHeading({ icon, title, badge }) {
  return <div className="reporting-panel-heading reporting-products-panel-heading">
    <div className="reporting-products-heading-title">
      <span className="reporting-products-heading-icon"><Icon name={icon} size={17} /></span>
      <div className="reporting-heading-with-info"><h2>{title}</h2><ReportingInfoTip helpKey={title} /></div>
    </div>
    {badge ? <span className="reporting-panel-badge">{badge}</span> : null}
  </div>
}

function ProductPresentations({ presentations }) {
  return <section className="surface-card reporting-panel reporting-products-presentations-panel">
    <PanelHeading icon="package" title="Apresentações / tamanhos" badge={presentations.length ? `${presentations.length} itens` : null} />
    {presentations.length ? <div className="reporting-products-presentation-scroll">
      <table className="reporting-products-presentation-table">
        <thead><tr><th>Produto</th><th>Apresentação</th><th>Qtd.</th><th>Receita</th></tr></thead>
        <tbody>{presentations.map((item) => <tr key={`${item.productId}|${item.size}`}>
          <td>{item.name}</td>
          <td>{item.size || 'Padrão'}</td>
          <td>{number(item.quantity)}</td>
          <td><strong>{money(item.revenueCents)}</strong></td>
        </tr>)}</tbody>
      </table>
    </div> : <div className="reporting-products-empty">Nenhuma apresentação vendida no período.</div>}
  </section>
}

function ProductsOverview({ state, onDrilldown }) {
  const data = state.data
  const ranking = data.ranking || []
  const top10 = data.top10 || []
  const categories = data.categories || []
  const presentations = data.presentations || []
  const revenueCents = Number(data.merchandiseRevenueCents || 0)
  const unitsSold = Number(data.unitsSold || 0)
  const ticketPerItemCents = unitsSold > 0 ? Math.round(revenueCents / unitsSold) : null
  const topByUnits = [...ranking].sort((a, b) => Number(b.quantity || 0) - Number(a.quantity || 0))[0] || null
  const top10SharePercent = Math.min(100, top10.reduce((sum, item) => sum + (finiteNumber(item.sharePercent) || 0), 0))
  const categoryRevenueTotal = categories.reduce((sum, item) => sum + Number(item.revenueCents || 0), 0)
  const maxCategoryRevenue = Math.max(1, ...categories.map((item) => Number(item.revenueCents || 0)))
  const growthRanking = ranking
    .map((item) => ({ ...item, growthValue: finiteNumber(item.growthPercent) }))
    .filter((item) => item.growthValue !== null)
    .sort((a, b) => b.growthValue - a.growthValue)
    .slice(0, 5)
  const topGrowth = growthRanking[0] || null

  let mixCursor = 0
  const categoryMix = categories.map((item, index) => {
    const share = categoryRevenueTotal > 0 ? (Number(item.revenueCents || 0) / categoryRevenueTotal) * 100 : 0
    const start = mixCursor
    mixCursor += share
    return { ...item, share, start, end: mixCursor, color: mixPalette[index % mixPalette.length] }
  })
  const mixBackground = categoryMix.length
    ? `conic-gradient(${categoryMix.map((item) => `${item.color} ${item.start}% ${item.end}%`).join(', ')})`
    : 'var(--surface-strong)'

  return <>
    <section className="reporting-metric-grid reporting-products-metrics" aria-label="Indicadores de produtos">
      <ReportingMetricCard label="Unidades vendidas" value={data.unitsSold} kind="number" comparison={state.comparison?.metrics?.unitsSold} />
      <ReportingMetricCard label="Receita de mercadoria" value={data.merchandiseRevenueCents} comparison={state.comparison?.metrics?.merchandiseRevenueCents} />
      <ReportingMetricCard label="Produtos no período" value={ranking.length} kind="number" />
      <ReportingMetricCard label="Categorias" value={categories.length} kind="number" />
      <ReportingMetricCard label="Refeições vendidas" value={data.mealsSold} kind="number" comparison={state.comparison?.metrics?.mealsSold} />
      <ReportingMetricCard label="Ticket por item" value={ticketPerItemCents} />
      <ProductsMetricTextCard
        label="Top produto"
        value={topByUnits?.name || 'Sem vendas'}
        detail={topByUnits ? `${number(topByUnits.quantity)} un. vendidas` : 'Período selecionado'}
        icon="products"
      />
      <ReportingMetricCard label="Participação do Top 10" value={top10SharePercent} kind="percent" />
    </section>

    <div className="reporting-products-primary-grid">
      <section className="surface-card reporting-panel reporting-products-top-panel">
        <PanelHeading icon="chart" title="Top 10 produtos" badge={top10.length ? `${top10.length} posições` : null} />
        {top10.length ? <div className="reporting-products-table reporting-products-top-table">
          <table>
            <thead><tr><th>#</th><th>Produto</th><th>Qtd.</th><th>Receita</th><th>Part.</th></tr></thead>
            <tbody>{top10.map((item, index) => <tr key={item.id}>
              <td><span className="reporting-products-rank">{index + 1}</span></td>
              <td>
                <button className="reporting-products-product-button reporting-products-top-product" type="button" onClick={() => onDrilldown(item.id)}>
                  <span>{item.name}</span>
                </button>
              </td>
              <td>{number(item.quantity)}</td>
              <td><strong>{money(item.revenueCents)}</strong></td>
              <td>{percentage(item.sharePercent)}</td>
            </tr>)}</tbody>
          </table>
        </div> : <div className="reporting-products-empty">Nenhum produto vendido no período.</div>}
      </section>

      <section className="surface-card reporting-panel reporting-products-category-panel">
        <PanelHeading icon="finance" title="Receita por categoria" badge="Receita" />
        {categories.length ? <div className="reporting-products-category-list">
          {categories.map((item) => {
            const width = Math.max(2, (Number(item.revenueCents || 0) / maxCategoryRevenue) * 100)
            return <div className="reporting-products-category-row" key={item.category || 'Sem categoria'}>
              <span>{item.category || 'Sem categoria'}</span>
              <div className="reporting-products-category-track" aria-hidden="true"><i style={{ width: `${width}%` }} /></div>
              <strong>{money(item.revenueCents)}</strong>
            </div>
          })}
        </div> : <div className="reporting-products-empty">Sem receita de categorias no período.</div>}
      </section>

      <section className="surface-card reporting-panel reporting-products-mix-panel">
        <PanelHeading icon="products" title="Mix por categoria" badge="Por receita" />
        {categoryMix.length ? <div className="reporting-products-mix">
          <div className="reporting-products-donut" style={{ background: mixBackground }} aria-label="Distribuição da receita por categoria">
            <div className="reporting-products-donut-center">
              <strong>{money(categoryRevenueTotal)}</strong>
              <span>Receita total</span>
            </div>
          </div>
          <div className="reporting-products-mix-legend">
            {categoryMix.map((item) => <div key={item.category || 'Sem categoria'}>
              <i style={{ background: item.color }} aria-hidden="true" />
              <span>{item.category || 'Sem categoria'}</span>
              <strong>{percentage(item.share)}</strong>
            </div>)}
          </div>
        </div> : <div className="reporting-products-empty">Sem categorias para compor o mix.</div>}
      </section>
    </div>

    <div className="reporting-products-secondary-grid">
      <section className="surface-card reporting-panel reporting-products-growth-panel">
        <PanelHeading icon="arrow-up" title="Produtos que mais cresceram" badge="Variação" />
        {growthRanking.length ? <div className="reporting-products-growth-list">
          {growthRanking.map((item) => <div className="reporting-products-growth-row" key={item.id}>
            <button className="reporting-products-product-button" type="button" onClick={() => onDrilldown(item.id)}>{item.name}</button>
            <span>{number(item.quantity)} un.</span>
            <strong className={item.growthValue >= 0 ? 'is-positive' : 'is-negative'}>{item.growthValue > 0 ? '+' : ''}{percentage(item.growthValue)}</strong>
          </div>)}
        </div> : <div className="reporting-products-empty reporting-products-growth-empty">Comparação de crescimento indisponível para este período.</div>}
      </section>

      <ProductPresentations presentations={presentations} />

      <section className="surface-card reporting-panel reporting-products-insight-panel">
        <PanelHeading icon="details" title="Destaques do período" />
        <div className="reporting-products-insights">
          <article className="reporting-products-insight reporting-products-insight-primary">
            <span className="reporting-products-insight-icon"><Icon name="chart" size={18} /></span>
            <div>
              <span className="reporting-insight-label-with-info">Concentração do Top 10<ReportingInfoTip helpKey="Concentração do Top 10" /></span>
              <strong>{percentage(top10SharePercent)}</strong>
              <p>da receita de mercadoria está concentrada nos 10 produtos líderes do período.</p>
            </div>
          </article>
          <article className="reporting-products-insight">
            <span className="reporting-products-insight-icon"><Icon name="package" size={18} /></span>
            <div>
              <span className="reporting-insight-label-with-info">Maior volume<ReportingInfoTip helpKey="Maior volume" /></span>
              <strong>{topByUnits?.name || 'Sem vendas'}</strong>
              <p>{topByUnits ? `${number(topByUnits.quantity)} unidades vendidas no período.` : 'Não há produto com vendas no período selecionado.'}</p>
            </div>
          </article>
          <article className="reporting-products-insight">
            <span className="reporting-products-insight-icon"><Icon name="arrow-up" size={18} /></span>
            <div>
              <span className="reporting-insight-label-with-info">Destaque de crescimento<ReportingInfoTip helpKey="Destaque de crescimento" /></span>
              <strong>{topGrowth?.name || 'Comparação indisponível'}</strong>
              <p>{topGrowth ? `${topGrowth.growthValue > 0 ? '+' : ''}${percentage(topGrowth.growthValue)} em relação ao período comparável.` : 'O período não possui base comparável suficiente.'}</p>
            </div>
          </article>
        </div>
      </section>
    </div>

    <section className="surface-card reporting-panel reporting-products-ranking-panel">
      <PanelHeading icon="products" title="Ranking completo" badge={`${ranking.length} produtos`} />
      {ranking.length ? <div className="reporting-products-ranking-scroll">
        <table className="reporting-products-ranking-table">
          <thead><tr><th>Produto</th><th>Categoria</th><th>Unidades</th><th>Receita</th><th>Participação</th><th>Variação</th></tr></thead>
          <tbody>{ranking.map((item) => {
            const growth = finiteNumber(item.growthPercent)
            return <tr key={item.id}>
              <td>
                <button className="reporting-products-product-button" type="button" onClick={() => onDrilldown(item.id)}>
                  <span>{item.name}</span>
                  {item.size ? <small>{item.size}</small> : null}
                </button>
              </td>
              <td>{item.category || 'Sem categoria'}</td>
              <td>{number(item.quantity)}</td>
              <td><strong>{money(item.revenueCents)}</strong></td>
              <td>{percentage(item.sharePercent)}</td>
              <td>
                <span className={`reporting-products-variation ${growth == null ? 'is-neutral' : growth >= 0 ? 'is-positive' : 'is-negative'}`}>
                  {growth == null ? 'Indisponível' : `${growth > 0 ? '+' : ''}${percentage(growth)}`}
                </span>
              </td>
            </tr>
          })}</tbody>
        </table>
      </div> : <div className="reporting-products-empty">Nenhum produto vendido no período.</div>}
    </section>

  </>
}

export function ProductsReport({ state, onDrilldown = () => {} }) {
  const [selection, setSelection] = useState(null)
  const data = state.data
  if (!data) return <ReportingState state={state}>{null}</ReportingState>

  const ranking = data.ranking || []
  const selected = ranking.find((item) => item.id === selection?.value)
  const productOptions = ranking.map((item) => ({
    value: item.id,
    label: [item.name, item.category, item.productId ? null : item.size].filter(Boolean).join(' · '),
  }))
  if (selection && !selected) productOptions.push(selection)
  productOptions.sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'))

  return <ReportingState state={state}><div className="reporting-view-stack reporting-products-view">
    <div className="reporting-products-picker">
      <div className="reporting-filter-control">
        <span>Produto</span>
        <SystemSelect label="Produto" value={selection?.value || ''}
          options={[{ value: '', label: 'Todos os produtos' }, ...productOptions]}
          onChange={(value) => setSelection(productOptions.find((option) => option.value === value) || null)}
          disabled={!productOptions.length}
        />
      </div>
      {selected ? <Button type="button" variant="secondary" onClick={() => onDrilldown(selected.id)}>Ver pedidos</Button> : null}
    </div>
    {selection ? <>
      <section className="reporting-metric-grid reporting-products-metrics reporting-selected-product-metrics" aria-label="Indicadores do produto" aria-live="polite">
        <ReportingMetricCard label="Unidades vendidas" value={selected?.quantity ?? 0} kind="number" />
        <ReportingMetricCard label="Receita de mercadoria" value={selected?.revenueCents ?? 0} />
      </section>
      <ProductPresentations presentations={(data.presentations || []).filter((item) => item.productId === selection.value)} />
    </> : <ProductsOverview state={state} onDrilldown={onDrilldown} />}
    {state.warnings?.map((warning) => <p className="reporting-warning" role="status" key={warning}>{warning}</p>)}
  </div></ReportingState>
}
