import { useContextApi } from '../../../../infrastructure/api/ContextApi.js'
import { useEffect, useMemo, useState } from 'react'
import Icon from '../../../../shared/ui/Icon.jsx'
import { reportingApi, createReportingApi } from '../../infrastructure/reportingApi.js'
import { ReportingReceivableLink } from '../ReportingReceivableLink.jsx'
import { getReportingOrderReference } from './reportingOrderReference.js'
import { getBusinessDate } from '../../../../../shared/finance.js'

const money = (cents) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(cents || 0) / 100)
const number = (value) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(Number(value || 0))
const phone = (value) => {
  const raw = String(value || '').trim()
  if (!raw) return 'Telefone não informado'
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
  if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`
  return raw
}
const date = (value) => value ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' }).format(new Date(`${String(value).slice(0, 10)}T12:00:00Z`)) : '—'
const dateTime = (value) => {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '—'
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(parsed).replace(',', ' ·')
}
const time = (value) => {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '—'
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }).format(parsed)
}
const LEGACY_FINISHED = new Set(['Entregue', 'Despachado'])
const displayStatus = (status = '') => LEGACY_FINISHED.has(status) ? 'Finalizado' : status
const statusClass = (status = '') => displayStatus(status) === 'Cancelado'
  ? 'is-danger'
  : displayStatus(status) === 'Em preparo'
    ? 'is-info'
    : displayStatus(status) === 'Finalizado'
      ? 'is-success'
      : 'is-neutral'
const typeIcon = (type) => type === 'Retirada' ? 'pickup' : type === 'Local' ? 'table' : 'delivery'
const deadlineClass = (onTime) => onTime == null ? 'is-neutral' : onTime ? 'is-success' : 'is-danger'
const categoryIcon = (category = '') => {
  const normalized = String(category).toLocaleLowerCase('pt-BR')
  if (normalized.includes('bebida') || normalized.includes('refrigerante') || normalized.includes('suco')) return 'drink'
  if (normalized.includes('sobremesa') || normalized.includes('doce')) return 'dessert'
  if (normalized.includes('lanche') || normalized.includes('sandu')) return 'snack'
  if (normalized.includes('combo')) return 'combo'
  if (normalized.includes('porç')) return 'portion'
  if (normalized.includes('molho')) return 'sauce'
  if (normalized.includes('refei') || normalized.includes('marmita') || normalized.includes('prato')) return 'meal'
  return 'package'
}
const paymentIcon = (label = '') => String(label).toLocaleLowerCase('pt-BR').includes('pix') ? 'pix' : 'card'
const TERMINAL = new Set(['Finalizado', ...LEGACY_FINISHED])

const elapsedMinutes = (order) => {
  if (!order?.created_at) return null
  const start = new Date(order.created_at).getTime()
  const end = new Date(order.cancelled_at || order.finished_at || Date.now()).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null
  return Math.max(0, Math.round((end - start) / 60000))
}

const paymentGroups = (allocations = []) => {
  const groups = new Map()
  for (const allocation of allocations) {
    const key = allocation.receipt_id || `${allocation.paid_at || ''}-${allocation.method_code || allocation.method_label || ''}`
    const group = groups.get(key) || { receiptId: key, at: allocation.paid_at || null, receivedDate: allocation.received_date || null, amountCents: 0, methods: [] }
    group.amountCents += Number(allocation.amount_cents || 0)
    const method = allocation.method_label || allocation.method_code || 'Não informado'
    if (!group.methods.includes(method)) group.methods.push(method)
    groups.set(key, group)
  }
  return [...groups.values()]
}

const historyEvents = (order) => {
  if (!order) return []
  const events = []
  const push = (event) => events.push({ ...event, sortAt: event.at ? new Date(event.at).getTime() : Number.MAX_SAFE_INTEGER })
  push({ at: order.created_at, label: time(order.created_at), icon: 'orders', title: 'Pedido criado', text: `${order.type || 'Pedido'} registrado${order.order_date ? ` para ${date(order.order_date)}` : ''}.`, priority: 1 })
  if (order.client_name_snapshot) push({ at: order.created_at, label: time(order.created_at), icon: 'client', title: 'Cliente vinculado', text: `${order.client_name_snapshot}${order.client_phone_snapshot ? ` · ${phone(order.client_phone_snapshot)}` : ''}`, priority: 2 })
  if (order.items?.length) push({ at: order.created_at, label: time(order.created_at), icon: 'note', title: 'Itens confirmados', text: `${order.items.length} ${order.items.length === 1 ? 'item' : 'itens'} · Total do pedido ${money(order.total_cents)}`, priority: 3 })
  if (order.scheduled_for) push({ at: order.scheduled_for, label: dateTime(order.scheduled_for), icon: 'calendar', title: 'Agendamento', text: 'Horário programado para atendimento do pedido.', priority: 4 })
  for (const payment of paymentGroups(order.paymentAllocations)) {
    const registeredDay=payment.at&&!Number.isNaN(new Date(payment.at).getTime())?getBusinessDate(new Date(payment.at)):null
    const financialDay=payment.receivedDate||registeredDay
    push({
      at: payment.at,
      label: dateTime(payment.at),
      icon: paymentIcon(payment.methods.join(' + ')),
      title: 'Pagamento registrado',
      text: `${money(payment.amountCents)} · ${payment.methods.join(' + ')}${financialDay?` · Recebido em ${date(financialDay)}`:''}${financialDay&&registeredDay&&financialDay!==registeredDay?` · Registrado em ${dateTime(payment.at)}`:''}`,
      priority: 5,
    })
  }
  if (order.cancelled_at) push({
    at: order.cancelled_at,
    label: dateTime(order.cancelled_at),
    icon: 'cancel',
    tone: 'danger',
    title: 'Pedido cancelado',
    text: order.cancel_reason_label || order.cancel_reason_note || order.cancel_reason || 'Cancelamento registrado.',
    priority: 7,
  })
  if (order.finished_at) push({
    at: order.finished_at,
    label: dateTime(order.finished_at),
    icon: 'check',
    tone: order.onTime === false ? 'danger' : 'success',
    title: 'Pedido finalizado',
    text: order.onTime == null ? 'Finalização registrada.' : order.onTime ? 'Finalizado dentro do prazo operacional.' : 'Finalizado após o prazo operacional.',
    priority: 6,
  })
  if (!TERMINAL.has(order.status) && order.status !== 'Cancelado') events.push({
    at: null,
    sortAt: Number.MAX_SAFE_INTEGER,
    priority: 9,
    label: 'Agora',
    icon: order.status === 'Em preparo' ? 'chef-hat' : 'clock',
    title: order.status || 'Em andamento',
    text: 'Status atual do pedido.',
  })
  return events.sort((left, right) => left.sortAt - right.sortAt || left.priority - right.priority)
}

function DrawerTabs({ active, onChange, onClientReturn }) {
  return <div className="reporting-drawer-tabs" role="tablist" aria-label="Seções do pedido">
    {[
      ['details', 'Detalhes'], ['history', 'Histórico'], ['client', 'Cliente'],
    ].map(([id, label]) => <button
      key={id}
      type="button"
      role="tab"
      aria-selected={active === id}
      className={active === id ? 'is-active' : ''}
      onClick={() => {
        if (id === 'client' && active === 'client') onClientReturn?.()
        onChange(id)
      }}
    >{label}</button>)}
  </div>
}

function DetailsTab({ order }) {
  const paymentLabel = order?.paymentAllocations?.length
    ? [...new Set(order.paymentAllocations.map((item) => item.method_label || item.method_code || 'Não informado'))].join(' + ')
    : 'Não informado'
  const adjustmentAmount = Number(order?.adjustment_amount_cents || 0)
  const hasSubtotal = order?.subtotal_cents !== null && order?.subtotal_cents !== undefined
  return <div className="reporting-drawer-content">
    <section className="reporting-drawer-section">
      <h3>Informações do pedido</h3>
      <div className="reporting-drawer-info-stack">
        <div className="reporting-drawer-info-row">
          <span className="reporting-drawer-info-icon"><Icon name="client" size={18} /></span>
          <div><small>Cliente</small><strong>{order.client_name_snapshot || 'Sem cliente'}</strong><span>{order.client_phone_snapshot || 'Telefone não informado'}</span></div>
        </div>
        <div className="reporting-drawer-info-row">
          <span className="reporting-drawer-info-icon"><Icon name="local" size={18} /></span>
          <div><small>Endereço</small><strong>{order.client_address_snapshot || 'Sem endereço'}</strong></div>
        </div>
      </div>
      <div className="reporting-drawer-meta-grid">
        <div><span className="reporting-drawer-meta-icon"><Icon name={typeIcon(order.type)} size={17} /></span><small>Modalidade</small><strong>{order.type || '—'}</strong></div>
        <div><span className="reporting-drawer-meta-icon"><Icon name="clock" size={17} /></span><small>Duração</small><strong>{order.durationMinutes == null ? '—' : `${order.durationMinutes} min`}</strong></div>
        <div><span className={`reporting-drawer-meta-icon ${deadlineClass(order.onTime)}`}><Icon name={order.onTime === false ? 'alert' : 'check'} size={17} /></span><small>Prazo</small><strong>{order.onTime == null ? '—' : order.onTime ? 'No prazo' : 'Atrasado'}</strong></div>
      </div>
    </section>

    <section className="reporting-drawer-section">
      <h3>Resumo financeiro</h3>
      <div className="reporting-drawer-financial-lines">
        {hasSubtotal ? <div><span>Subtotal</span><strong>{money(order.subtotal_cents)}</strong></div> : null}
        {Number(order.delivery_fee_cents || 0) > 0 ? <div><span>Taxa de entrega</span><strong>{money(order.delivery_fee_cents)}</strong></div> : null}
        {order.adjustment_type === 'discount' && adjustmentAmount > 0 ? <div><span>Desconto</span><strong className="is-discount">− {money(adjustmentAmount)}</strong></div> : null}
        {order.adjustment_type === 'surcharge' && adjustmentAmount > 0 ? <div><span>Acréscimo</span><strong>{money(adjustmentAmount)}</strong></div> : null}
        <div className="is-total"><span>Total do pedido</span><strong>{money(order.total_cents)}</strong></div>
      </div>
      <div className="reporting-drawer-financial-cards">
        <div className="is-received"><small>Valor recebido</small><strong>{money(order.paidCents)}</strong></div>
        <div><small>Pendente</small><strong>{money(order.pendingCents)}</strong></div>
      </div>
      <div className="reporting-drawer-payment-method"><span>Forma de pagamento</span><strong><Icon name={paymentIcon(paymentLabel)} size={17} />{paymentLabel}</strong></div>
      {paymentGroups(order.paymentAllocations).map((payment)=>{
        const registeredDay=payment.at&&!Number.isNaN(new Date(payment.at).getTime())?getBusinessDate(new Date(payment.at)):null
        const financialDay=payment.receivedDate||registeredDay
        return financialDay?<div className="reporting-drawer-payment-method" key={payment.receiptId}>
          <span>Data do recebimento · {payment.methods.join(' + ')}</span>
          <strong>{date(financialDay)}</strong>
          {financialDay!==registeredDay&&payment.at?<small>Registrado em {dateTime(payment.at)}</small>:null}
        </div>:null
      })}
    </section>

    <section className="reporting-drawer-section reporting-drawer-items-section">
      <h3>Itens do pedido ({order.items?.length || 0})</h3>
      <div className="reporting-drawer-items">{order.items?.map((item) => <div className="reporting-drawer-item" key={item.id}>
        <span className="reporting-drawer-item-icon"><Icon name={categoryIcon(item.category_snapshot)} size={18} /></span>
        <div><strong>{item.quantity} × {item.name_snapshot}</strong>{item.size_snapshot ? <small>{item.size_snapshot}</small> : null}</div>
        <strong>{money(item.quantity * item.unit_price_cents)}</strong>
      </div>)}</div>
    </section>
  </div>
}

function HistoryTab({ order }) {
  const elapsed = elapsedMinutes(order)
  const events = useMemo(() => historyEvents(order), [order])
  return <div className="reporting-drawer-content reporting-drawer-history-content">
    <section className="reporting-history-summary" aria-label="Resumo do histórico">
      <div><span className="reporting-history-summary-icon"><Icon name="calendar" size={18} /></span><span><small>Criado em</small><strong>{time(order.created_at)}</strong></span></div>
      <div><span className="reporting-history-summary-icon"><Icon name="clock" size={18} /></span><span><small>{TERMINAL.has(order.status) || order.status === 'Cancelado' ? 'Tempo total' : 'Tempo decorrido'}</small><strong>{elapsed == null ? '—' : `${number(elapsed)} min`}</strong></span></div>
      <div><span className="reporting-history-summary-icon"><Icon name="wallet" size={18} /></span><span><small>Saldo pendente</small><strong>{money(order.pendingCents)}</strong></span></div>
    </section>

    <section className="reporting-drawer-section reporting-history-section">
      <h3>Linha do tempo do pedido</h3>
      <div className="reporting-history-timeline">{events.map((event, index) => <article className={`reporting-history-event ${event.tone ? `is-${event.tone}` : ''}`} key={`${event.title}-${event.at || 'current'}-${index}`}>
        <span className="reporting-history-event-icon"><Icon name={event.icon} size={18} /></span>
        <div><time>{event.label}</time><strong>{event.title}</strong><p>{event.text}</p></div>
      </article>)}</div>
    </section>
  </div>
}

const clientOrderFilter = (item, filter) => {
  if (filter === 'cancelled') return item.status === 'Cancelado'
  if (filter === 'finished') return TERMINAL.has(item.status)
  if (filter === 'in-progress') return item.status !== 'Cancelado' && !TERMINAL.has(item.status)
  if (filter === 'receivable') return item.status !== 'Cancelado' && Number(item.pendingCents || 0) > 0
  return true
}

function ClientOrders({ order, context, filter, onFilter, onSelectOrder }) {
  const orders = (context?.orders || []).filter((item) => clientOrderFilter(item, filter))
  const profile = context?.profile
  const total = context?.summary?.ordersCount ?? context?.orders?.length ?? 0
  return <div className="reporting-drawer-content reporting-client-orders-content">
    <section className="reporting-client-orders-heading">
      <h3>Pedidos do cliente</h3>
      <p>Toque em um pedido para abrir os detalhes sem sair do relatório.</p>
    </section>
    <section className="reporting-client-orders-card">
      <span className="reporting-client-profile-avatar"><Icon name="client" size={25} /></span>
      <div><small>Cliente</small><strong>{profile?.name || order.client_name_snapshot || 'Cliente'}</strong><span>{phone(profile?.phone || order.client_phone_snapshot)}</span></div>
      <span className="reporting-client-orders-count"><Icon name="note" size={16} />{total} {total === 1 ? 'pedido' : 'pedidos'}</span>
    </section>
    <div className="reporting-client-order-filters" role="group" aria-label="Filtrar pedidos do cliente">
      {[['all', 'Todos'], ['in-progress', 'Em andamento'], ['finished', 'Finalizados'], ['receivable', 'A receber'], ['cancelled', 'Cancelados']].map(([id, label]) => <button type="button" key={id} className={filter === id ? 'is-active' : ''} onClick={() => onFilter(id)}>{label}</button>)}
    </div>
    <div className="reporting-client-order-list">{orders.length ? orders.map((item) => {
      const current = item.id === order.id
      return <button type="button" className={`reporting-client-order-row ${current ? 'is-current' : ''}`} key={item.id} onClick={() => onSelectOrder?.(item.id)}>
        <span className="reporting-client-order-icon"><Icon name="orders" size={18} /></span>
        <span className="reporting-client-order-main">
          <span className="reporting-client-order-title"><strong>{getReportingOrderReference(item).title}</strong>{current ? <em>Pedido atual</em> : null}</span>
          <span><Icon name="calendar" size={14} />{date(item.order_date)} · <Icon name={typeIcon(item.type)} size={14} />{item.type || '—'}</span>
        </span>
        <span className="reporting-client-order-side"><strong>{money(item.total_cents)}</strong>{filter === 'receivable'
          ? <span className={`reporting-detail-status ${Number(item.paidCents || 0) > 0 ? 'is-warning' : 'is-danger'}`}>{Number(item.paidCents || 0) > 0 ? 'Parcial' : 'Não pago'}</span>
          : <span className={`reporting-detail-status ${statusClass(item.status)}`}>{displayStatus(item.status) || '—'}</span>}</span>
        <span className="reporting-client-order-chevron" aria-hidden="true">›</span>
      </button>
    }) : <div className="reporting-client-order-empty">Nenhum pedido neste filtro.</div>}</div>
  </div>
}

function ClientTab({ order, onOpenClient, onSelectOrder, view, onViewChange, filter, onFilter }) {
  const context = order.clientContext
  if (view === 'orders' && context) return <ClientOrders order={order} context={context} filter={filter} onFilter={onFilter} onSelectOrder={onSelectOrder} />
  const profile = context?.profile
  const summary = context?.summary
  return <div className="reporting-drawer-content reporting-client-content">
    <section className="reporting-drawer-section reporting-client-profile-section">
      <h3>Perfil do cliente</h3>
      <div className="reporting-client-profile-card">
        <span className="reporting-client-profile-avatar"><Icon name="client" size={27} /></span>
        <div><strong>{profile?.name || order.client_name_snapshot || 'Sem cliente'}</strong><span><Icon name="phone" size={15} />{phone(profile?.phone || order.client_phone_snapshot)}</span><span><Icon name="local" size={15} />{profile?.address || order.client_address_snapshot || 'Sem endereço'}</span></div>
        <span className="reporting-client-profile-badge"><Icon name="client" size={14} />{profile ? 'Cliente do pedido' : 'Snapshot do pedido'}</span>
      </div>
    </section>

    {summary ? <section className="reporting-drawer-section reporting-client-relationship">
      <h3>Relacionamento com a loja</h3>
      <div className="reporting-client-stat-grid">
        <div><span className="reporting-client-stat-icon"><Icon name="calendar" size={18} /></span><span><small>Pedidos</small><strong>{summary.ordersCount}</strong></span></div>
        <div><span className="reporting-client-stat-icon"><Icon name="chart" size={18} /></span><span><small>Ticket médio</small><strong>{summary.averageTicketCents == null ? '—' : money(summary.averageTicketCents)}</strong></span></div>
        <div><span className="reporting-client-stat-icon"><Icon name="finance" size={18} /></span><span><small>Total gasto</small><strong>{money(summary.totalSpentCents)}</strong></span></div>
        <div><span className="reporting-client-stat-icon"><Icon name="wallet" size={18} /></span><span><small>Saldo pendente</small><strong>{money(summary.pendingCents)}</strong></span></div>
      </div>
      <div className="reporting-client-stat-lines"><div><span><Icon name="calendar" size={15} />Última compra</span><strong>{date(summary.lastPurchaseDate)}</strong></div><div><span><Icon name="cancel" size={15} />Cancelamentos</span><strong>{summary.cancellationCount} de {summary.ordersCount} pedidos</strong></div></div>
    </section> : null}

    <section className="reporting-drawer-section reporting-client-snapshot">
      <h3>Dados deste pedido</h3>
      <div><span><Icon name="client" size={17} />Cliente</span><strong>{order.client_name_snapshot || 'Sem cliente'}</strong></div>
      <div><span><Icon name="phone" size={17} />Telefone</span><strong>{phone(order.client_phone_snapshot)}</strong></div>
      <div><span><Icon name="local" size={17} />Endereço usado</span><strong>{order.client_address_snapshot || 'Sem endereço'}</strong></div>
      <p><Icon name="details" size={15} />Os dados acima correspondem ao snapshot salvo no momento do pedido.</p>
    </section>

    <section className="reporting-drawer-section reporting-client-actions">
      <h3>Ações</h3>
      {profile && onOpenClient ? <button type="button" className="is-primary" onClick={() => onOpenClient(profile)}><Icon name="client" size={19} /><span>Abrir cadastro do cliente</span><b aria-hidden="true">›</b></button> : null}
      {context ? <button type="button" onClick={() => onViewChange('orders')}><Icon name="note" size={19} /><span>Ver pedidos do cliente</span><b aria-hidden="true">›</b></button> : null}
    </section>
  </div>
}

export function ReportingOrderDrawer({ id, onClose, api: suppliedApi = reportingApi, onOpenClient, onSelectOrder }) {
  const api = useContextApi(createReportingApi, suppliedApi, reportingApi)
  const [state, setState] = useState({ loading: true, data: null, error: null })
  const [tab, setTab] = useState('details')
  const [clientView, setClientView] = useState('profile')
  const [clientFilter, setClientFilter] = useState('all')

  useEffect(() => {
    setTab('details')
    setClientView('profile')
    setClientFilter('all')
    setState({ loading: true, data: null, error: null })
    const controller = new AbortController()
    void api.loadOrder(id, { signal: controller.signal }).then((response) => {
      if (!controller.signal.aborted) setState({ loading: false, data: response.data, error: null })
    }).catch((error) => {
      if (!controller.signal.aborted) setState({ loading: false, data: null, error })
    })
    return () => controller.abort()
  }, [api, id])

  const order = state.data
  const orderReference = order ? getReportingOrderReference(order) : { title: `Pedido ${id}`, aria: `pedido ${id}`, meta: null }

  return <aside className="reporting-order-drawer" role="dialog" aria-modal="true" aria-label={`Detalhes do ${orderReference.aria}`}>
    <div className="reporting-drawer-header">
      <div className="reporting-drawer-title">
        <span className="reporting-drawer-title-icon"><Icon name="orders" size={19} /></span>
        <div>
          <div className="reporting-drawer-title-line">
            <h2>{orderReference.title}</h2>
            {order ? <span className={`reporting-detail-status ${statusClass(order.status)}`}>{order.status}</span> : null}
          </div>
          {order ? <p>{orderReference.meta ? `${orderReference.meta} · ` : ''}{order.order_date} · {order.type}</p> : null}
        </div>
      </div>
      <button className="reporting-drawer-close" type="button" onClick={onClose} aria-label="Fechar detalhes">×</button>
    </div>

    <DrawerTabs active={tab} onChange={setTab} onClientReturn={() => setClientView('profile')} />

    {state.loading ? <div className="reporting-drawer-state">Carregando pedido…</div> : state.error ? <div className="reporting-drawer-state is-error" role="alert">Não foi possível carregar o pedido.</div> : order ? <>
      {tab === 'details' ? <DetailsTab order={order} /> : null}
      {tab === 'history' ? <HistoryTab order={order} /> : null}
      {tab === 'client' ? <ClientTab order={order} onOpenClient={onOpenClient} onSelectOrder={onSelectOrder} view={clientView} onViewChange={setClientView} filter={clientFilter} onFilter={setClientFilter} /> : null}
    </> : <div className="reporting-drawer-state">Pedido indisponível.</div>}

    {order?.pendingCents > 0 ? <div className="reporting-drawer-footer">
      <ReportingReceivableLink className="reporting-drawer-receivable" />
    </div> : null}
  </aside>
}