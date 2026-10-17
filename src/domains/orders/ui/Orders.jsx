import { useEffect, useMemo, useState } from 'react'
import '../../../order-operations.css'
import '../../../order-operations-compact.css'
import '../../../kitchen-refined.css'
import './order-edit-banner.css'
import Button from '../../../shared/ui/Button'
import CancelOrderDialog from './components/CancelOrderDialog'
import ConfirmationDialog from '../../../shared/ui/ConfirmationDialog'
import Icon from '../../../shared/ui/Icon'
import OrderEditedBadge from '../../../shared/ui/OrderEditedBadge.jsx'
import KitchenTicket from './components/KitchenTicket'
import OrderDetail from './components/OrderDetail'
import PageHeader from '../../../shared/ui/PageHeader'
import StatCard from '../../../shared/ui/StatCard'
import StatusBadge from '../../../shared/ui/StatusBadge'
import AreaNavigation from '../../../app/navigation/AreaNavigation.jsx'
import { buildFutureScheduledOrdersModel, buildKitchenQueueModel } from '../domain/kitchenQueue.js'
import { buildKitchenItemSummary } from '../domain/kitchenTicket.js'
import { canReceiveStandaloneOrder } from '../domain/orderPaymentEligibility.js'
import { formatOrderDisplayNumber } from '../../../../shared/orderDisplayNumber.js'
import { FINANCE_TIME_ZONE } from '../../../../shared/finance.js'


const futureDateFormatter = new Intl.DateTimeFormat('pt-BR', {
  timeZone: FINANCE_TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

const futureTimeFormatter = new Intl.DateTimeFormat('pt-BR', {
  timeZone: FINANCE_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

const futureAttendanceIcons = { Entrega: 'delivery', Retirada: 'pickup', Local: 'local' }
const MODALITY_FILTERS = [
  { value: 'all', label: 'Todas' },
  { value: 'Entrega', label: 'Entrega' },
  { value: 'Retirada', label: 'Retirada' },
  { value: 'Local', label: 'Mesa' },
]

const formatFutureSchedule = (value) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return { date: 'Data indisponível', time: '—' }
  return {
    date: futureDateFormatter.format(date),
    time: futureTimeFormatter.format(date),
  }
}

function FutureScheduledOrderCard({
  entry,
  now,
  disabled,
  canCreateOrders,
  canCancelOrders,
  onDetails,
  onEditReservation,
  onCancel,
}) {
  const order = entry.order
  const schedule = formatFutureSchedule(order.scheduledFor)
  const activeReservation = order.type === 'Local'
    && Boolean(order.tableReservationId)
    && order.tableReservationStatus === 'reserved'
  const reference = now instanceof Date ? now : new Date(now)
  const editableReservation = activeReservation
    && canCreateOrders
    && entry.operationalStartAt instanceof Date
    && !Number.isNaN(reference.getTime())
    && reference < entry.operationalStartAt

  return (
    <article className="kitchen-ticket future-scheduled-ticket" aria-label={formatOrderDisplayNumber(order)}>
      <header className="kitchen-ticket-header">
        <strong className="kitchen-ticket-customer-name">{order.client || 'Cliente não identificado'}</strong>
        <StatusBadge status="Agendado" label={activeReservation ? 'Reservada' : 'Agendado'} />
      </header>
      <div className="kitchen-ticket-customer">
        <span><Icon name={futureAttendanceIcons[order.type] || 'local'} size={16} />{order.type}</span>
        <span className="kitchen-ticket-id">{formatOrderDisplayNumber(order)}</span>{Number(order.operationalRevision) > 0 && <OrderEditedBadge />}
      </div>
      <p className="kitchen-ticket-items">{buildKitchenItemSummary(order)}</p>
      <div className="kitchen-ticket-timing">
        <strong>{schedule.date}</strong>
        <span>{schedule.time}</span>
      </div>
      <footer className="kitchen-ticket-actions">
        <Button type="button" variant="secondary" icon="note" onClick={() => onDetails?.(order)} disabled={disabled}>Exibir detalhes</Button>
        {editableReservation && (
          <Button type="button" variant="secondary" icon="edit" onClick={() => onEditReservation?.(order)} disabled={disabled}>Editar reserva</Button>
        )}
        {canCancelOrders && <button type="button" className="kitchen-ticket-cancel-action" onClick={() => onCancel?.(order)} disabled={disabled}>{activeReservation ? 'Cancelar reserva' : 'Cancelar pedido'}</button>}
      </footer>
    </article>
  )
}


function Orders({ finishedTodayCount,orders, officialOrders = orders, now, currentTiming, search, onSearchChange, currency, onNewOrder, onFinalizeOrder, onCancelOrder, onEditReservation, onEditOrder, onRegisterPayment, paymentDisabled = false, paymentOptions, cancellationOptions = [], cancellationRevision = null, onNavigatePrintQueue, printQueueActiveCount = 0, granted, newOrderIds = new Set(), soundEnabled = true, onSoundEnabledChange, printing, onToast, canCreateOrders = true, canEditOrders = false, canFinalizeOrders = true, canCancelOrders = true, canRefundPayments = true, canUseLocalPreferences = true, canViewPrintQueue = true, canForcePrinting = false, canExecutePrinting = true }) {
  const [queueFilter, setQueueFilter] = useState('all')
  const [modalityFilter, setModalityFilter] = useState('all')
  const [pendingAction, setPendingAction] = useState(null)
  const [detailOrderId, setDetailOrderId] = useState(null)
  const [cancelOrder, setCancelOrder] = useState(null)
  const [finalizeCandidate, setFinalizeCandidate] = useState(null)
  const writeDisabled = typeof navigator !== 'undefined' && !navigator.onLine
  const actionsDisabled = writeDisabled || pendingAction !== null
  const activePrintJobs = Math.max(0, Math.floor(Number(printQueueActiveCount) || 0))
  const queueModel = useMemo(() => buildKitchenQueueModel(orders, now, search, currentTiming), [currentTiming, orders, now, search])
  const futureScheduleModel = useMemo(() => buildFutureScheduledOrdersModel(orders, now, search, currentTiming), [currentTiming, orders, now, search])
  const matchesModality = (entry) => modalityFilter === 'all' || entry.order.type === modalityFilter
  const preparingByModality = queueModel.preparing.filter(matchesModality)
  const preparing = preparingByModality.filter((entry) => queueFilter === 'all' || entry.isLate)
  const scheduled = queueModel.scheduled.filter(matchesModality)
  const futureScheduled = futureScheduleModel.visible.filter(matchesModality)
  const modalityLateCount = preparingByModality.filter((entry) => entry.isLate).length
  const detailOrder = detailOrderId ? officialOrders.find((order) => order.id === detailOrderId) ?? null : null
  const detailPrintJob = detailOrder ? printing?.latestJobByOrderId?.get?.(String(detailOrder.id)) || null : null

  useEffect(() => {
    if (detailOrderId && !detailOrder) setDetailOrderId(null)
  }, [detailOrder, detailOrderId])

  const runAction = async (key, action) => {
    if (actionsDisabled) return
    setPendingAction(key)
    try { await action() } finally { setPendingAction(null) }
  }

  const confirmFinalize = async () => {
    if (!canFinalizeOrders || !finalizeCandidate || actionsDisabled) return false
    const order = finalizeCandidate
    await runAction(`finish:${order.id}`, async () => {
      await onFinalizeOrder(order.id)
      setFinalizeCandidate(null)
    })
  }

  const confirmCancellation = async (payload) => {
    if (!canCancelOrders || (payload?.refundNow && !canRefundPayments) || !cancelOrder || actionsDisabled || !onCancelOrder) return false
    const id = cancelOrder.id
    setPendingAction(`cancel:${id}`)
    try {
      const saved = await onCancelOrder(id, payload)
      if (saved !== false) setCancelOrder(null)
    } finally {
      setPendingAction(null)
    }
  }

  const registerPaymentFromDetail = () => {
    if (!canReceiveStandaloneOrder(detailOrder, granted, 'orders')) return
    if (onRegisterPayment?.(detailOrder.id, 'orders')) setDetailOrderId(null)
  }

  return (
    <div className="kitchen-page">
      <PageHeader
        eyebrow="Operação"
        title="Cozinha"
        description="Acompanhe os pedidos em preparo e agendados"
        actions={(
          <div className="kitchen-header-actions">
            {canCreateOrders && <div className="kitchen-header-primary-action">
              <Button icon="plus" onClick={() => { if (canCreateOrders) onNewOrder?.() }} disabled={actionsDisabled}>Novo pedido</Button>
            </div>}
            {(canUseLocalPreferences || canViewPrintQueue) && <div className="kitchen-header-secondary-actions">
              {canUseLocalPreferences && <button type="button" className="button button-secondary kitchen-sound-toggle" aria-pressed={soundEnabled} title={soundEnabled ? 'Desativar som de novos pedidos' : 'Ativar som de novos pedidos'} onClick={() => { if (canUseLocalPreferences) onSoundEnabledChange?.(!soundEnabled) }}>
                <Icon name={soundEnabled ? 'volume-on' : 'volume-off'} size={17} />
                <span>{soundEnabled ? 'Som ativado' : 'Som desligado'}</span>
              </button>}
              {canViewPrintQueue && <Button
                type="button"
                variant="secondary"
                className="kitchen-print-queue-button"
                aria-label={activePrintJobs > 0 ? `Fila de impressão, ${activePrintJobs} ${activePrintJobs === 1 ? 'job ativo' : 'jobs ativos'}` : 'Fila de impressão'}
                onClick={onNavigatePrintQueue}
              >Fila de impressão{activePrintJobs > 0 && <span className="kitchen-print-queue-badge" aria-hidden="true">{activePrintJobs > 99 ? '99+' : activePrintJobs}</span>}</Button>}
            </div>}
          </div>
        )}
      />

      <AreaNavigation area="orders" />

      <section className="stats-grid stats-grid-four order-ops-stats kitchen-stats" aria-label="Resumo dos pedidos">
        <StatCard className="kitchen-stat-card kitchen-stat-preparing" label="Em preparo" value={queueModel.counts.preparing} helper="Pedidos ativos agora" icon="preparation" />
        <StatCard className="kitchen-stat-card kitchen-stat-scheduled" label="Agendados" value={queueModel.counts.scheduled} helper="Próximos pedidos" icon="clock" />
        <StatCard className="kitchen-stat-card kitchen-stat-late" label="Fora do prazo" value={queueModel.counts.late} helper="Precisam de atenção" icon="alert" tone={queueModel.counts.late ? 'danger' : 'neutral'} />
        <StatCard className="kitchen-stat-card kitchen-stat-finished" label="Finalizados hoje" value={finishedTodayCount ?? queueModel.counts.finishedToday} helper="Já saíram da operação" icon="kitchen" tone="success" />
      </section>

      <section className="kitchen-board" aria-label="Filas da cozinha">
        <section className="kitchen-queue-section" aria-labelledby="kitchen-preparing-heading">
          <div className="kitchen-queue-heading">
            <div><Icon name="preparation" size={18} /><h2 id="kitchen-preparing-heading">Em preparo <span>({preparing.length})</span></h2></div>
            <span className="kitchen-queue-help">Prioridade por prazo</span>
          </div>
          <div className="kitchen-toolbar">
            <label className="search-control kitchen-search"><Icon name="search" size={18} /><input type="search" aria-label="Buscar pedido" placeholder="Buscar cliente, pedido, produto ou tipo" value={search} onChange={(event) => onSearchChange(event.target.value)} /></label>
            <div className="kitchen-queue-filters" role="group" aria-label="Filtrar pedidos em preparo">
              <button type="button" aria-pressed={queueFilter === 'all'} onClick={() => setQueueFilter('all')}>Todos</button>
              <button type="button" aria-label="Mostrar apenas pedidos em atraso" aria-pressed={queueFilter === 'late'} onClick={() => setQueueFilter('late')}>Atrasados <span>{modalityLateCount}</span></button>
            </div>
          </div>
          <div className="kitchen-modality-toolbar">
            <span className="kitchen-modality-label">Modalidade</span>
            <div className="kitchen-queue-filters kitchen-modality-filters" role="group" aria-label="Filtrar por modalidade">
              {MODALITY_FILTERS.map(({ value, label }) => (
                <button key={value} type="button" aria-pressed={modalityFilter === value} onClick={() => setModalityFilter(value)}>{label}</button>
              ))}
            </div>
          </div>
          <div className="kitchen-ticket-list">
            {preparing.map((entry) => (
              <div className={`kitchen-ticket-shell${entry.isLate ? ' kitchen-ticket-late' : ''}`} key={entry.order.id}>
                <KitchenTicket
                  entry={entry}
                  now={now}
                  currentTiming={currentTiming}
                  disabled={actionsDisabled}
                  highlighted={newOrderIds.has(String(entry.order.id))}
                  onDetails={(order) => setDetailOrderId(order.id)}
                  onFinalize={canFinalizeOrders ? (order) => { setFinalizeCandidate(order); return true } : undefined}
                  onCancel={canCancelOrders ? (order) => { setCancelOrder(order); return true } : undefined}
                />
                
              </div>
            ))}
            {!preparing.length && <div className="kitchen-queue-empty"><Icon name="preparation" size={24} /><strong>{queueFilter === 'late' && modalityFilter === 'all' ? 'Nenhum pedido em atraso nesta busca.' : modalityFilter !== 'all' || search ? 'Nenhum pedido corresponde aos filtros selecionados.' : 'Nenhum pedido em preparo agora.'}</strong><span>{queueFilter !== 'all' || modalityFilter !== 'all' || search ? 'Altere os filtros ou a busca para ver outros pedidos.' : 'Novos pedidos aparecem aqui automaticamente.'}</span></div>}
          </div>
        </section>

        <aside className="kitchen-schedule-rail" aria-label="Agendamentos">
          <section className="kitchen-queue-section" aria-labelledby="kitchen-scheduled-heading">
            <div className="kitchen-queue-heading">
              <div><Icon name="clock" size={18} /><h2 id="kitchen-scheduled-heading">Agendados para preparo <span>({scheduled.length})</span></h2></div>
              <span className="kitchen-queue-help">Mais próximos primeiro</span>
            </div>
            <div className="kitchen-ticket-list">
              {scheduled.map((entry) => (
                <div className={`kitchen-ticket-shell${entry.isLate ? ' kitchen-ticket-late' : ''}`} key={entry.order.id}>
                  <KitchenTicket
                    entry={entry}
                    now={now}
                    currentTiming={currentTiming}
                    disabled={actionsDisabled}
                    highlighted={newOrderIds.has(String(entry.order.id))}
                    onDetails={(order) => setDetailOrderId(order.id)}
                    onCancel={canCancelOrders ? (order) => { setCancelOrder(order); return true } : undefined}
                  />
                  
                </div>
              ))}
              {!scheduled.length && <div className="kitchen-queue-empty"><Icon name="clock" size={24} /><strong>Nenhum pedido agendado aguardando preparo.</strong><span>{modalityFilter !== 'all' || search ? 'Altere a modalidade ou a busca para ver outros agendamentos.' : 'Os próximos pedidos agendados aparecem aqui.'}</span></div>}
            </div>
          </section>

          <section className="future-scheduled-orders" aria-labelledby="future-scheduled-heading">
            <div className="kitchen-queue-heading">
              <div><Icon name="clock" size={18} /><h2 id="future-scheduled-heading">Próximos dias <span>({futureScheduled.length})</span></h2></div>
              <span className="kitchen-queue-help">Fora dos contadores de hoje</span>
            </div>
            <div className="kitchen-ticket-list">
              {futureScheduled.map((entry) => (
                <FutureScheduledOrderCard
                  key={entry.order.id}
                  entry={entry}
                  now={now}
                  disabled={actionsDisabled}
                  canCreateOrders={canCreateOrders}
                  canCancelOrders={canCancelOrders}
                  onDetails={(order) => setDetailOrderId(order.id)}
                  onEditReservation={(order) => runAction(`edit-reservation:${order.id}`, () => onEditReservation?.(order))}
                  onCancel={(order) => { if (!canCancelOrders) return false; setCancelOrder(order); return true }}
                />
              ))}
              {!futureScheduled.length && (
                <div className="kitchen-queue-empty">
                  <Icon name="clock" size={24} />
                  <strong>{(futureScheduleModel.totalCount && (search || modalityFilter !== 'all')) ? 'Nenhum próximo pedido corresponde aos filtros.' : 'Nenhum pedido agendado para os próximos dias.'}</strong>
                  <span>{futureScheduleModel.totalCount ? 'Altere a modalidade ou a busca para ver os próximos agendamentos.' : 'Agendamentos de outras datas aparecem aqui sem afetar a operação de hoje.'}</span>
                </div>
              )}
            </div>
          </section>

        </aside>
      </section>

      {detailOrder && <OrderDetail order={detailOrder} currency={currency} printing={printing} printJob={detailPrintJob} onClose={() => setDetailOrderId(null)} onEditOrder={canEditOrders ? (order) => { setDetailOrderId(null); return onEditOrder?.(order) } : undefined} canEditOrders={canEditOrders} onRequestCancel={canCancelOrders ? () => { if (!canCancelOrders) return; setDetailOrderId(null); setCancelOrder(detailOrder) } : undefined} canCancelOrders={canCancelOrders} canForcePrinting={canForcePrinting} canExecutePrinting={canExecutePrinting} canRegisterPayment={canReceiveStandaloneOrder(detailOrder, granted, 'orders')} registerPaymentDisabled={paymentDisabled || actionsDisabled} onRegisterPayment={registerPaymentFromDetail} onToast={onToast} />}
      {canFinalizeOrders && finalizeCandidate && (
        <ConfirmationDialog
          title="Confirmar finalização"
          message={`${formatOrderDisplayNumber(finalizeCandidate)} de ${finalizeCandidate.client} sairá da fila de preparo. Confirme antes de continuar.`}
          confirmLabel="Confirmar finalização"
          confirmVariant="primary"
          onClose={() => setFinalizeCandidate(null)}
          onConfirm={confirmFinalize}
          disabled={actionsDisabled}
        />
      )}
      <CancelOrderDialog open={canCancelOrders && Boolean(cancelOrder)} order={cancelOrder} paymentOptions={paymentOptions} reasonOptions={cancellationOptions} reasonRevision={cancellationRevision} onClose={() => setCancelOrder(null)} onConfirm={confirmCancellation} submitting={Boolean(cancelOrder && pendingAction === `cancel:${cancelOrder.id}`)} canRefundPayments={canRefundPayments} />
    </div>
  )
}

export default Orders
