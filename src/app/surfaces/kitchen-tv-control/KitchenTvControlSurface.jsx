import { useContextApi } from '../../../infrastructure/api/ContextApi.js'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import AreaNavigation from '../../navigation/AreaNavigation.jsx'
import { buildKitchenQueueModel } from '../../../domains/orders/index.js'
import Button from '../../../shared/ui/Button.jsx'
import BottomSheet from '../../../shared/ui/BottomSheet.jsx'
import Icon from '../../../shared/ui/Icon.jsx'
import OrderEditedBadge from '../../../shared/ui/OrderEditedBadge.jsx'
import OrderEditChanges from '../../../domains/orders/ui/components/OrderEditChanges.jsx'
import { formatOrderDisplayNumber } from '../../../../shared/orderDisplayNumber.js'
import {
  countKitchenTvModalities,
  matchesKitchenTvModality,
  normalizeKitchenTvModality,
} from '../../../../shared/kitchenTvModality.js'
import * as defaultApi from './kitchenTvControlApi.js'
import {
  countKitchenTvOffscreen,
  isKitchenTvTelemetryFresh,
  kitchenTvClientName,
  kitchenTvOperationalStatus,
  kitchenTvVisibility,
} from './kitchenTvControlPresentation.js'
import './kitchenTvControl.css'

const CONTROL_POLL_MS = 2000

const loadDefaultPrintDocument = (orderId) => defaultApi.getKitchenTvOrderPrintDocument(orderId)

const telemetryTime = (telemetry, now = new Date()) => {
  if (!telemetry?.reportedAt) return 'Sem telemetria recente'
  const date = new Date(telemetry.reportedAt)
  const reference = now instanceof Date ? now : new Date(now)
  if (Number.isNaN(date.getTime()) || Number.isNaN(reference.getTime())) return 'Sem telemetria recente'
  const ageSeconds = Math.max(0, Math.floor((reference.getTime() - date.getTime()) / 1000))
  if (ageSeconds < 2) return 'Último sinal agora'
  if (ageSeconds < 60) return `Último sinal há ${ageSeconds}s`
  return `Último sinal ${new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(date)}`
}

const withHiddenOrder = (state, orderId, hidden) => {
  if (!state) return state
  const ids = new Set((state.hiddenOrderIds || []).map(String))
  if (hidden) ids.add(String(orderId))
  else ids.delete(String(orderId))
  return { ...state, hiddenOrderIds: [...ids] }
}

function SummaryTile({ label, value, icon, tone = 'neutral' }) {
  return <article className={`kitchen-tv-control-summary-tile tone-${tone}`}>
    <Icon name={icon} size={16} />
    <span>{label}</span>
    <strong>{value}</strong>
  </article>
}

const statusIcon = (key) => key === 'late' ? 'alert' : key === 'near-limit' ? 'clock' : key === 'scheduled' ? 'calendar' : 'preparation'
const visibilityIcon = (key) => key === 'visible' ? 'eye' : 'eye-off'
const MODALITY_FILTERS = Object.freeze([
  { id: 'all', label: 'Todos', icon: 'dashboard' },
  { id: 'delivery', label: 'Entrega', icon: 'delivery-bike' },
  { id: 'pickup', label: 'Retira', icon: 'pickup' },
  { id: 'table', label: 'Mesa', icon: 'meal' },
])
const printItemLabel = (item = {}) => {
  const quantity = Math.max(1, Number(item.quantity) || 1)
  const name = String(item.name ?? '').trim() || 'Item'
  const presentation = String(item.presentation ?? '').trim()
  return `${quantity}x ${name}${presentation ? ` ${presentation}` : ''}`
}

function KitchenTvControlSurface({
  orders = [],
  now = new Date(),
  currentTiming,
  granted = new Set(),
  isOnline = true,
  api: suppliedApi = defaultApi,
  loadPrintDocument: suppliedPrintDocument = loadDefaultPrintDocument,
  onSelectOrder,
  onFeedback,
}) {
  const api = useContextApi(defaultApi.createKitchenTvControlApi, suppliedApi, defaultApi)
  const loadPrintDocument = suppliedPrintDocument === loadDefaultPrintDocument ? api.getKitchenTvOrderPrintDocument : suppliedPrintDocument
  const [controlState, setControlState] = useState(null)
  const [loading, setLoading] = useState(isOnline)
  const [error, setError] = useState('')
  const [pendingRevision, setPendingRevision] = useState(null)
  const [selectedOrderId, setSelectedOrderId] = useState(null)
  const [pendingOrderId, setPendingOrderId] = useState(null)
  const [actionError, setActionError] = useState('')
  const [hiddenSheetOpen, setHiddenSheetOpen] = useState(false)
  const [printSnapshot, setPrintSnapshot] = useState(null)
  const [printSnapshotLoading, setPrintSnapshotLoading] = useState(false)
  const [printSnapshotError, setPrintSnapshotError] = useState('')
  const pendingOrderRef = useRef(null)

  const canControl = granted instanceof Set && granted.has('orders.kitchen.control')
  const queueModel = useMemo(
    () => buildKitchenQueueModel(orders, now, '', currentTiming),
    [currentTiming, now, orders],
  )
  const entryById = useMemo(
    () => new Map(queueModel.allActive.map((entry) => [String(entry.order.id), entry])),
    [queueModel.allActive],
  )
  const hiddenIds = useMemo(
    () => new Set((controlState?.hiddenOrderIds || []).map(String)),
    [controlState?.hiddenOrderIds],
  )
  const activeModality = normalizeKitchenTvModality(controlState?.control?.requestedModality)
  const pageEntries = useMemo(
    () => (controlState?.telemetry?.visibleOrderIds || [])
      .map((id) => entryById.get(String(id)))
      .filter((entry) => entry
        && !hiddenIds.has(String(entry.order.id))
        && matchesKitchenTvModality(entry.order, activeModality)),
    [activeModality, controlState?.telemetry?.visibleOrderIds, entryById, hiddenIds],
  )
  const hiddenEntries = useMemo(
    () => (controlState?.hiddenOrderIds || [])
      .map((id) => entryById.get(String(id)))
      .filter(Boolean),
    [controlState?.hiddenOrderIds, entryById],
  )
  const tvEligibleEntries = useMemo(
    () => queueModel.allActive.filter(({ order }) => !hiddenIds.has(String(order.id))),
    [hiddenIds, queueModel.allActive],
  )
  const modalityCounts = useMemo(
    () => countKitchenTvModalities(tvEligibleEntries.map(({ order }) => order)),
    [tvEligibleEntries],
  )
  const filteredEntries = useMemo(
    () => tvEligibleEntries.filter(({ order }) => matchesKitchenTvModality(order, activeModality)),
    [activeModality, tvEligibleEntries],
  )
  const selectedEntry = useMemo(
    () => selectedOrderId ? entryById.get(String(selectedOrderId)) ?? null : null,
    [entryById, selectedOrderId],
  )

  const loadControl = useCallback(async (silent = false) => {
    if (!isOnline) {
      setLoading(false)
      return null
    }
    if (!silent) setLoading(true)
    try {
      const next = await api.getKitchenTvControl()
      if (!(silent && pendingOrderRef.current)) {
        setControlState(next)
        setError('')
      }
      return next
    } catch (cause) {
      if (!silent) setError(cause?.message || 'Não foi possível carregar o controle da TV.')
      return null
    } finally {
      if (!silent) setLoading(false)
    }
  }, [api, isOnline])

  useEffect(() => {
    if (!isOnline) {
      setLoading(false)
      setError('')
      return undefined
    }
    void loadControl()
    const interval = globalThis.setInterval(() => { void loadControl(true) }, CONTROL_POLL_MS)
    return () => globalThis.clearInterval(interval)
  }, [isOnline, loadControl])

  useEffect(() => {
    if (selectedOrderId && !selectedEntry) {
      setSelectedOrderId(null)
      setActionError('')
    }
  }, [selectedEntry, selectedOrderId])

  useEffect(() => {
    if (!selectedOrderId) {
      setPrintSnapshot(null)
      setPrintSnapshotLoading(false)
      setPrintSnapshotError('')
      return undefined
    }

    let active = true
    setPrintSnapshot(null)
    setPrintSnapshotLoading(true)
    setPrintSnapshotError('')

    void Promise.resolve(loadPrintDocument(selectedOrderId))
      .then((result) => {
        if (!active) return
        if (!result?.document) {
          setPrintSnapshotError('Não foi possível carregar os itens do pedido.')
          return
        }
        setPrintSnapshot(result.document)
      })
      .catch(() => {
        if (active) setPrintSnapshotError('Não foi possível carregar os itens do pedido.')
      })
      .finally(() => {
        if (active) setPrintSnapshotLoading(false)
      })

    return () => { active = false }
  }, [loadPrintDocument, selectedOrderId])

  const telemetryFresh = Boolean(
    isOnline
      && controlState?.paired
      && isKitchenTvTelemetryFresh(controlState?.telemetry, now),
  )
  const currentPage = telemetryFresh ? Number(controlState?.telemetry?.currentPage) || 1 : 1
  const pageCount = telemetryFresh ? Math.max(1, Number(controlState?.telemetry?.pageCount) || 1) : 1
  const operationalControlsEnabled = Boolean(
    canControl
      && isOnline
      && controlState?.paired
      && telemetryFresh
      && pendingRevision === null
      && pendingOrderId === null,
  )

  useEffect(() => {
    if (pendingRevision === null) return
    const applied = Number(controlState?.telemetry?.appliedRevision)
    if (Number.isSafeInteger(applied) && applied >= pendingRevision) setPendingRevision(null)
  }, [controlState?.telemetry?.appliedRevision, pendingRevision])

  const requestPage = async (page) => {
    if (!operationalControlsEnabled || !Number.isSafeInteger(page) || page < 1 || page > pageCount) return false
    const expectedRevision = Math.max(0, Number(controlState?.control?.revision) || 0) + 1
    setPendingRevision(expectedRevision)
    setError('')
    try {
      const next = await api.setKitchenTvPage(page)
      setControlState(next)
      const actualRevision = Number(next?.control?.revision)
      setPendingRevision(Number.isSafeInteger(actualRevision) ? actualRevision : expectedRevision)
      return true
    } catch (cause) {
      setPendingRevision(null)
      const message = cause?.message || 'Não foi possível atualizar a TV.'
      setError(message)
      onFeedback?.(message)
      return false
    }
  }

  const requestModality = async (modality) => {
    if (!operationalControlsEnabled || normalizeKitchenTvModality(modality) === activeModality) return false
    const expectedRevision = Math.max(0, Number(controlState?.control?.revision) || 0) + 1
    setPendingRevision(expectedRevision)
    setError('')
    try {
      const next = await api.setKitchenTvModality(modality)
      setControlState(next)
      const actualRevision = Number(next?.control?.revision)
      setPendingRevision(Number.isSafeInteger(actualRevision) ? actualRevision : expectedRevision)
      return true
    } catch (cause) {
      setPendingRevision(null)
      const message = cause?.message || 'Não foi possível filtrar a TV.'
      setError(message)
      onFeedback?.(message)
      return false
    }
  }

  const reconcileOrderVisibility = async () => {
    try {
      const next = await api.getKitchenTvControl()
      setControlState(next)
      return next
    } catch {
      return null
    }
  }

  const changeOrderVisibility = async (orderId, hidden) => {
    if (!operationalControlsEnabled || !orderId) return false
    const normalizedId = String(orderId)
    const previousState = controlState
    pendingOrderRef.current = normalizedId
    setPendingOrderId(normalizedId)
    setActionError('')
    setControlState((current) => withHiddenOrder(current, normalizedId, hidden))

    try {
      if (hidden) await api.hideKitchenTvOrder(normalizedId)
      else await api.restoreKitchenTvOrder(normalizedId)

      const reconciled = await reconcileOrderVisibility()
      if (!reconciled) setControlState((current) => withHiddenOrder(current, normalizedId, hidden))

      const message = hidden ? 'Pedido retirado da TV.' : 'Pedido voltou para a TV.'
      if (hidden) setSelectedOrderId(null)
      onFeedback?.(message)
      return true
    } catch (cause) {
      const reconciled = await reconcileOrderVisibility()
      if (!reconciled) setControlState(previousState)
      const message = cause?.message || (hidden ? 'Não foi possível retirar o pedido da TV.' : 'Não foi possível devolver o pedido para a TV.')
      setActionError(message)
      onFeedback?.(message)
      return false
    } finally {
      pendingOrderRef.current = null
      setPendingOrderId(null)
    }
  }

  const openOrderActions = (entry) => {
    setSelectedOrderId(String(entry.order.id))
    setActionError('')
    onSelectOrder?.(entry.order)
  }

  const closeOrderActions = () => {
    if (pendingOrderId !== null) return
    setSelectedOrderId(null)
    setActionError('')
  }

  const offscreenCount = countKitchenTvOffscreen(filteredEntries, controlState, telemetryFresh)
  const preparingCount = filteredEntries.filter(({ phase }) => phase === 'preparing').length
  const scheduledCount = filteredEntries.filter(({ phase }) => phase === 'scheduled').length
  const lateCount = filteredEntries.filter(({ isLate }) => isLate).length

  const connectionLabel = !isOnline
    ? 'Sem conexão'
    : !controlState?.paired
      ? 'TV não pareada'
      : telemetryFresh
        ? 'TV conectada'
        : 'TV sem sinal'
  const connectionClass = telemetryFresh
    ? 'kitchen-tv-control-connection is-live'
    : 'kitchen-tv-control-connection is-offline'

  const selectedHidden = Boolean(
    selectedEntry
      && (controlState?.hiddenOrderIds || []).some((id) => String(id) === String(selectedEntry.order.id)),
  )
  const selectedEdit=Number(selectedEntry?.order?.operationalRevision) > 0 ? selectedEntry.order : null
  const selectedScheduled = selectedEntry?.phase === 'scheduled'
  const selectedActionDisabled = !operationalControlsEnabled || pendingOrderId !== null || selectedScheduled

  return <div className="kitchen-tv-control-page">
    <AreaNavigation area="orders" />

    <header className="kitchen-tv-control-header">
      <div className="kitchen-tv-control-heading">
        <p>Operação</p>
        <h1>Controle da TV</h1>
        <small>{controlState?.paired ? `Pareada · ${telemetryTime(controlState?.telemetry, now)}` : telemetryTime(controlState?.telemetry, now)}</small>
      </div>
      <span className={connectionClass}>{connectionLabel}</span>
    </header>

    {!canControl && <p className="kitchen-tv-control-readonly">Somente leitura</p>}
    {!isOnline && <p className="kitchen-tv-control-state">Sem conexão. Os controles da TV ficam indisponíveis até o celular voltar a ficar online.</p>}
    {loading && <p className="kitchen-tv-control-state" aria-live="polite">Carregando controle da TV…</p>}
    {error && <p className="kitchen-tv-control-state is-error" role="alert">{error}</p>}
    {!loading && isOnline && controlState && !controlState.paired && <p className="kitchen-tv-control-state">A TV não está pareada. Conecte-a em Configurações → TV da Cozinha para liberar os controles.</p>}

    <section className="kitchen-tv-control-paging" aria-label="Navegação da TV">
      <div className="kitchen-tv-control-page-state">
        <strong className="kitchen-tv-control-page-copy">
          {telemetryFresh
            ? <><span>Tela </span><b className="kitchen-tv-control-current-page">{currentPage}</b><span> de {pageCount}</span></>
            : 'Tela — de —'}
        </strong>
        {pendingRevision !== null && <span aria-live="polite">Atualizando TV…</span>}
      </div>
      <button
        type="button"
        className="kitchen-tv-control-page-button"
        aria-label="Anterior"
        disabled={!operationalControlsEnabled || currentPage <= 1}
        onClick={() => { void requestPage(currentPage - 1) }}
      ><span aria-hidden="true">‹</span><span>Anterior</span></button>
      <button
        type="button"
        className="kitchen-tv-control-page-button is-home"
        aria-label="Início"
        disabled={!operationalControlsEnabled || currentPage <= 1}
        onClick={() => { void requestPage(1) }}
      ><Icon name="home" size={15} /><span>Início</span></button>
      <button
        type="button"
        className="kitchen-tv-control-page-button"
        aria-label="Próxima"
        disabled={!operationalControlsEnabled || currentPage >= pageCount}
        onClick={() => { void requestPage(currentPage + 1) }}
      ><span>Próxima</span><span aria-hidden="true">›</span></button>
    </section>

    <section className="kitchen-tv-control-modality-filters" aria-label="Filtrar pedidos por modalidade">
      {MODALITY_FILTERS.map((filter) => {
        const selected = activeModality === filter.id
        const count = modalityCounts[filter.id] || 0
        return <button
          key={filter.id}
          type="button"
          className={`kitchen-tv-control-modality-filter${selected ? ' is-active' : ''}`}
          aria-label={`${filter.label} ${count}`}
          aria-pressed={selected}
          disabled={!operationalControlsEnabled}
          onClick={() => { void requestModality(filter.id) }}
        >
          <Icon name={filter.icon} size={18} />
          <span>{filter.label}</span>
          <strong className="kitchen-tv-control-modality-count">{count}</strong>
        </button>
      })}
    </section>

    <section className="kitchen-tv-control-summary" aria-label="Resumo do controle da TV">
      <SummaryTile label="Em preparo" value={preparingCount} icon="preparation" tone="primary" />
      <SummaryTile label="Atrasados" value={lateCount} icon="alert" tone={lateCount ? 'danger' : 'neutral'} />
      <SummaryTile label="Agendados" value={scheduledCount} icon="calendar" tone={scheduledCount ? 'info' : 'neutral'} />
      <SummaryTile label="Fora da tela" value={offscreenCount === null ? '—' : offscreenCount} icon="eye-off" />
    </section>

    <div className="kitchen-tv-control-list-heading">
      <div><Icon name="chef-hat" size={18} /><h2>Pedidos</h2></div>
      <div className="kitchen-tv-control-list-meta">
        <span>{pageEntries.length} {telemetryFresh ? 'na tela' : 'na última tela'}</span>
        {hiddenEntries.length > 0 && <button type="button" onClick={() => setHiddenSheetOpen(true)}>Retirados {hiddenEntries.length}</button>}
      </div>
    </div>

    <section className="kitchen-tv-control-grid" aria-label="Pedidos exibidos na TV">
      {pageEntries.map((entry) => {
        const status = kitchenTvOperationalStatus(entry, now)
        const visibility = kitchenTvVisibility({
          orderId: entry.order.id,
          hiddenOrderIds: controlState?.hiddenOrderIds,
          telemetry: controlState?.telemetry,
          telemetryFresh,
        })
        const isPending = String(pendingOrderId || '') === String(entry.order.id)
        const displayNumber = formatOrderDisplayNumber(entry.order)
        const compactDisplayNumber = displayNumber.replace(/^Pedido\s*/i, '')
        const clientName = kitchenTvClientName(entry.order.client)
        const edited=Number(entry.order.operationalRevision) > 0
        return <button
          key={entry.order.id}
          type="button"
          className={`kitchen-tv-control-order-card status-${status.key}${isPending ? ' is-pending' : ''}`}
          aria-label={`${formatOrderDisplayNumber(entry.order)}, ${clientName}, ${status.label}, ${visibility.label}${edited ? ", pedido editado" : ""}`}
          aria-haspopup="dialog"
          aria-busy={isPending || undefined}
          onClick={() => openOrderActions(entry)}
        >
          <span className="kitchen-tv-control-order-card-heading">
            <strong className="kitchen-tv-control-order-client">{clientName}</strong>
            <span className="kitchen-tv-control-order-number-full">{displayNumber}</span>
            <span className="kitchen-tv-control-order-number-compact">{compactDisplayNumber}</span>
          </span>
          <span className="kitchen-tv-control-badges">
            {edited && <OrderEditedBadge />}
            <span className={`kitchen-tv-control-badge status-${status.key}`}><Icon name={statusIcon(status.key)} size={11} />{status.label}</span>
            <span className={`kitchen-tv-control-badge visibility-${visibility.key}`}><Icon name={visibilityIcon(visibility.key)} size={11} />{visibility.label}</span>
          </span>
        </button>
      })}
      {!pageEntries.length && <p className="kitchen-tv-control-empty">{controlState?.telemetry ? 'Nenhum pedido nesta tela da TV.' : 'Aguardando a TV informar os pedidos desta tela.'}</p>}
    </section>

    <div className="kitchen-tv-control-hint">
      <Icon name="details" size={16} />
      <span>Toque no pedido para abrir ações</span>
      <span aria-hidden="true">›</span>
    </div>

    <BottomSheet
      open={Boolean(selectedEntry)}
      title={selectedEntry ? formatOrderDisplayNumber(selectedEntry.order) : 'Pedido'}
      onClose={closeOrderActions}
    >
      {selectedEntry && <div className="kitchen-tv-control-action-sheet">
        <div className="kitchen-tv-control-action-order">
          <strong>{selectedEntry.order.client || 'Cliente'}</strong>
          <span>{selectedHidden ? 'Retirado da TV' : 'Pedido ativo no painel'}</span>
        </div>
        <section className="kitchen-tv-control-print-snapshot" aria-label="Itens do pedido">
          <header>
            <div>
              <strong>Itens do pedido</strong>
              <span>Snapshot da impressão</span>
            </div>
            <Icon name="print" size={18} />
          </header>
          {printSnapshotLoading && <p className="kitchen-tv-control-print-state">Carregando itens…</p>}
          {printSnapshotError && <p className="kitchen-tv-control-print-state is-error" role="alert">{printSnapshotError}</p>}
          {!printSnapshotLoading && !printSnapshotError && printSnapshot && <div className="kitchen-tv-control-print-items">
            {(printSnapshot.items || []).map((item, index) => <div className="kitchen-tv-control-print-item" key={`${item.name || 'item'}-${index}`}>
              <strong>{printItemLabel(item)}</strong>
              {item.note && <span>Obs: {item.note}</span>}
            </div>)}
            {!(printSnapshot.items || []).length && <p className="kitchen-tv-control-print-state">Nenhum item no snapshot de impressão.</p>}
          </div>}
        </section>

        {selectedEdit?.editSummary?.items?.length > 0 && (
          <OrderEditChanges changes={selectedEdit.editSummary.items} defaultOpen className="kitchen-tv-control-edit-review" />
        )}
        <p className="kitchen-tv-control-action-explainer">Remove apenas do painel da TV. O pedido continua em preparo no sistema.</p>
        {!canControl && <p className="kitchen-tv-control-action-note">Somente leitura. Você não tem permissão para alterar a TV.</p>}
        {canControl && (!isOnline || !controlState?.paired || !telemetryFresh) && <p className="kitchen-tv-control-action-note">A TV precisa estar conectada e com sinal recente para alterar a visibilidade.</p>}
        {selectedScheduled && <p className="kitchen-tv-control-action-note">Pedidos agendados aguardando a janela de preparo aparecem na TV, mas não podem ser retirados manualmente.</p>}
        {actionError && <p className="kitchen-tv-control-action-error" role="alert">{actionError}</p>}
        <div className="kitchen-tv-control-action-buttons">
          {!selectedScheduled && <Button
            type="button"
            variant={selectedHidden ? 'secondary' : 'primary'}
            disabled={selectedActionDisabled}
            onClick={() => { void changeOrderVisibility(selectedEntry.order.id, !selectedHidden) }}
          >
            {pendingOrderId === String(selectedEntry.order.id)
              ? 'Atualizando…'
              : selectedHidden
                ? 'Voltar para a TV'
                : 'Retirar da TV'}
          </Button>}

        </div>
      </div>}
    </BottomSheet>

    <BottomSheet
      open={hiddenSheetOpen}
      title="Retirados da TV"
      onClose={() => { if (pendingOrderId === null) setHiddenSheetOpen(false) }}
    >
      <div className="kitchen-tv-control-hidden-list">
        {hiddenEntries.map((entry) => <div className="kitchen-tv-control-hidden-row" key={entry.order.id}>
          <div>
            <strong>{kitchenTvClientName(entry.order.client)}</strong>
            <span>{formatOrderDisplayNumber(entry.order)}</span>
          </div>
          <Button
            type="button"
            variant="secondary"
            disabled={!operationalControlsEnabled || pendingOrderId !== null}
            onClick={() => { void changeOrderVisibility(entry.order.id, false) }}
          >Voltar para a TV</Button>
        </div>)}
        {!hiddenEntries.length && <p className="kitchen-tv-control-action-note">Nenhum pedido retirado da TV.</p>}
      </div>
    </BottomSheet>
  </div>
}

export default KitchenTvControlSurface
