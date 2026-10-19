import PageSkeleton from '../../../shared/ui/PageSkeleton.jsx'
import { useEffect, useMemo, useRef, useState } from 'react'
import '../../../../shared/finance.js'
import '../../../receivables.css'
import '../../../receivables-forecast.css'
import BottomSheet from '../../../shared/ui/BottomSheet'
import Button from '../../../shared/ui/Button'
import Icon from '../../../shared/ui/Icon'
import PageHeader from '../../../shared/ui/PageHeader'
import AreaNavigation from '../../../app/navigation/AreaNavigation.jsx'
import PaymentPromiseDialog from './PaymentPromiseDialog'
import ReceivableDetail from './ReceivableDetail'
import ReceivablesForecastDialog from './ReceivablesForecastDialog'
import ReceivablesQuickPaymentDialog from './ReceivablesQuickPaymentDialog'
import ReceivableClientGroup from './ReceivableClientGroup.jsx'
import ReceivableClientPanel from './ReceivableClientPanel.jsx'
import SystemSelect from '../../../shared/ui/SystemSelect'
import { getBusinessDate } from '../../../../shared/finance.js'
import { calculateReceivedToday } from '../domain/cashFlow.js'
import {
  buildPendingReceivableEntries,
  buildReceivablesForecast,
  calculateReceivableSummary,
  getPaidReceivableOrders,
  groupReceivableEntriesByClient,
  sortReceivableEntries,
  sortReceivableGroups,
} from '../domain/receivables.js'
import { formatOrderDisplayNumber } from '../../../../shared/orderDisplayNumber.js'
import { formatPaymentSummary, paymentSearchText } from '../domain/paymentPresentation.js'
import { useFinanceReadModel } from '../application/useFinanceReadModel.js'
import { useScopedOrderSelection } from '../../../infrastructure/realtime/useScopedOrderSelection.js'
import { useReceivableClientSelection } from '../application/useReceivableClientSelection.js'

const PRIMARY_VIEWS = ['pending', 'paid']
const TIMING_FILTERS = ['all', 'today', 'upcoming', 'overdue']
const TIMING_FILTER_LABELS = { all: 'Todos', today: 'Hoje', upcoming: 'Próximos', overdue: 'Em atraso' }
const SORT_OPTIONS = [
  { value: 'urgency', label: 'Mais urgente' },
  { value: 'recent', label: 'Mais recente' },
  { value: 'value-desc', label: 'Maior valor' },
]
const entrySearchText = (entry, getOrderItemsSearchText) => entry.orders.map((order) => [order.client, order.clientPhone, String(order.id), order.type, order.orderDate, getOrderItemsSearchText(order)].join(' ')).join(' ').toLowerCase()
const orderSearchText = (order, getOrderItemsSearchText) => [
  order.client,
  String(order.id),
  order.type,
  order.orderDate,
  getOrderItemsSearchText(order),
  paymentSearchText(order.paymentAllocations, order.paymentMethod),
].join(' ').toLowerCase()

const timingLabel = (entry, formatOrderDate) => {
  if (entry.timing.status === 'overdue') {
    const days = entry.timing.daysOverdue
    return `Atrasado há ${days} ${days === 1 ? 'dia' : 'dias'}`
  }
  if (entry.timing.status === 'today') return entry.kind === 'order' && entry.order?.promisedPaymentDate ? 'Prometido para hoje' : 'Pagamento esperado hoje'
  if (entry.timing.status === 'upcoming') {
    const prefix = entry.kind === 'order' && entry.order?.promisedPaymentDate ? 'Prometido para' : 'Previsto para'
    return `${prefix} ${formatOrderDate(entry.expectedDate)}`
  }
  return 'Pendente'
}

const paidMeta = (order) => {
  const recorded = order.paidAt ? new Date(order.paidAt) : null
  const paidAt = recorded&&!Number.isNaN(recorded.getTime())
    ? new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'}).format(recorded)
    : 'Data não informada'
  const recordedDay=recorded&&!Number.isNaN(recorded.getTime())?getBusinessDate(recorded):null
  const financialDay=order.receivedDate||recordedDay
  const financialDate=financialDay?new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo'}).format(new Date(financialDay+'T12:00:00Z')):'Data não informada'
  return `Quitado · ${formatPaymentSummary(order.paymentAllocations, order.paymentMethod || 'Forma não informada')} · Recebido em ${financialDate}${recordedDay&&financialDay!==recordedDay?` · Registrado em ${paidAt}`:''}`
}

const paidEntry = (order) => ({
  key: `paid:${order.id}`,
  kind: 'order',
  label: order.client || 'Pedido sem identificação',
  order,
  orders: [order],
  total: Number(order.total || 0),
  expectedDate: order.promisedPaymentDate || order.orderDate,
  timing: { status: 'paid', daysOverdue: 0 },
})

function Receivables({
  orders = [],
  readContext,
  movements = [],
  currency,
  disabled = false,
  canReceivePayments = true,
  canManagePaymentPromises = true,
  canExecutePrinting = true,
  onRegisterPayment,
  onRegisterClientOrdersPayment,
  onOpenClient,
  onUpdatePaymentPromise,
  queryState,
  onQueryChange,
  orderPresentation,
  orderRules,
  renderOrderDetail,
}) {
  const { formatOrderDate, getOrderItemsSearchText, getOrderItemsSummary } = orderPresentation
  const { search, displayMode = 'client', activeView, timingFilter, sortMode, exactDateFilter, selectedEntryKey } = queryState
  const patchQuery = (patch) => onQueryChange(patch)
  const [searchInput, setSearchInput] = useState(search || '')
  const lastDispatchedSearch = useRef(search)
  const [today, setToday] = useState(() => getBusinessDate())
  const [detailOrder, setDetailOrder] = useState(null)
  const [promiseOrder, setPromiseOrder] = useState(null)
  const [quickPaymentOpen, setQuickPaymentOpen] = useState(false)
  const [forecastOpen, setForecastOpen] = useState(false)
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false)
  const [isMobileDetail, setIsMobileDetail] = useState(() => typeof window !== 'undefined' && window.matchMedia?.('(max-width: 820px)').matches)
  const legacySelection = useReceivableClientSelection()
  const [quickSearch,setQuickSearch]=useState('')
  const scoped=Boolean(readContext?.enabled)
  const reads=useFinanceReadModel({...readContext,surface:'receivables',queryState,quickOpen:quickPaymentOpen,quickSearch})
  const groupPage=reads.group.data
  const scopedSelection=useScopedOrderSelection({scopeKey:JSON.stringify([readContext?.accessContextId,scoped?selectedEntryKey:null]),refreshKey:scoped?groupPage:null,
    loadOrdersByIds:scoped?readContext.loadOrdersByIds:undefined,onError:error=>{if(error?.status===401||error?.status===403||error?.code==='SESSION_CONTEXT_CHANGED')readContext?.onUnauthorized?.(error);else readContext?.onReadError?.(error)},
    isEligible:order=>buildPendingReceivableEntries([order],today,orderRules).some(entry=>entry.kind==='order')&&(!groupPage?.group?.clientId||order.clientId===groupPage.group.clientId)})
  const clientSelection=scoped?{selectedOrderIds:scopedSelection.ids,selectedCount:scopedSelection.ids.length,activeGroupKey:selectedEntryKey,selectionLimit:100,selectionLimitReached:scopedSelection.ids.length>=100,
    clear:scopedSelection.clear,deselectAll:scopedSelection.clear,toggleOrder:id=>scopedSelection.toggle(groupPage?.orders?.find(order=>order.id===id)),
    activateGroup:()=>true,selectAllVisible:()=>scopedSelection.selectVisible(groupPage?.orders || []),reconcile:()=>{}}:legacySelection
  const normalizedSearch = (search || '').trim().toLowerCase()
  const mainPending = scoped && !reads.main.data
  const writeDisabled = disabled || (typeof navigator !== 'undefined' && !navigator.onLine)

  useEffect(() => {
    if (search !== lastDispatchedSearch.current) setSearchInput(search || '')
  }, [search])
  useEffect(() => {
    if (searchInput === search) return undefined
    const timer = setTimeout(() => {
      lastDispatchedSearch.current = searchInput
      onQueryChange({ search: searchInput })
    }, 300)
    return () => clearTimeout(timer)
  }, [searchInput, search, onQueryChange])

  useEffect(() => {
    const timer = window.setInterval(() => {
      const next = getBusinessDate()
      setToday((current) => current === next ? current : next)
    }, 60_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined
    const media = window.matchMedia('(max-width: 820px)')
    const sync = () => setIsMobileDetail(media.matches)
    sync()
    media.addEventListener?.('change', sync)
    return () => media.removeEventListener?.('change', sync)
  }, [])

  useEffect(() => {
    if (activeView !== 'pending' || displayMode !== 'client') clientSelection.clear()
  }, [activeView, displayMode, clientSelection.clear])

  const legacySummary = useMemo(() => calculateReceivableSummary(orders, today, orderRules), [orders, today])
  const legacyForecast = useMemo(() => buildReceivablesForecast(orders, today, 7, orderRules), [orders, today])
  const legacyReceivedToday = useMemo(() => calculateReceivedToday(movements, today), [movements, today])
  const legacyPendingEntries = useMemo(() => buildPendingReceivableEntries(orders, today, orderRules), [orders, today])
  const pendingEntries=scoped?(reads.main.data?.entries || []):legacyPendingEntries
  const summary=scoped?reads.main.data?.summary:legacySummary
  const forecast=scoped?reads.main.data?.forecast:legacyForecast
  const receivedToday=scoped?reads.main.data?.receivedToday:legacyReceivedToday
  const quickPaymentEntries = useMemo(() => (scoped?(reads.quick.data?.entries || []):pendingEntries).filter((entry) => entry.kind === 'order'), [pendingEntries,scoped,reads.quick.data])
  const allPaidOrders = useMemo(() => scoped?(reads.main.data?.orders || []):getPaidReceivableOrders(orders, orderRules), [orders,scoped,reads.main.data])

  const visiblePendingEntries = useMemo(() => {
    if(scoped)return pendingEntries
    const filtered = pendingEntries.filter((entry) => {
      if (normalizedSearch && !entrySearchText(entry, getOrderItemsSearchText).includes(normalizedSearch)) return false
      if (timingFilter !== 'all' && entry.timing.status !== timingFilter) return false
      if (exactDateFilter && entry.expectedDate !== exactDateFilter) return false
      return true
    })
    return sortReceivableEntries(filtered, sortMode)
  }, [pendingEntries, normalizedSearch, timingFilter, exactDateFilter, sortMode,scoped])

  const visibleClientGroups = useMemo(
    () => scoped?(reads.main.data?.groups || []).map(group=>({...group,orders:[],entries:[],...(group.key===selectedEntryKey&&groupPage?.group?{...groupPage.group,orders:groupPage.orders,entries:groupPage.entries}:{})})):sortReceivableGroups(groupReceivableEntriesByClient(visiblePendingEntries), sortMode),
    [visiblePendingEntries, sortMode,scoped,reads.main.data,selectedEntryKey,groupPage],
  )

  const visiblePaidOrders = useMemo(() => scoped?allPaidOrders:allPaidOrders
    .filter((order) => !normalizedSearch || orderSearchText(order, getOrderItemsSearchText).includes(normalizedSearch))
    .sort((left, right) => String(right.paidAt || '').localeCompare(String(left.paidAt || ''))), [allPaidOrders, normalizedSearch,scoped])

  const selectedEntry = useMemo(() => {
    if (!selectedEntryKey || (activeView === 'pending' && displayMode === 'client')) return null
    if (selectedEntryKey.startsWith('paid:')) {
      const order = allPaidOrders.find((item) => `paid:${item.id}` === selectedEntryKey)
      return order ? paidEntry(order) : null
    }
    return pendingEntries.find((entry) => entry.key === selectedEntryKey) || null
  }, [activeView, allPaidOrders, displayMode, pendingEntries, selectedEntryKey])

  const selectedClientGroup = useMemo(
    () => activeView === 'pending' && displayMode === 'client'
      ? (scoped&&groupPage?.group?{...groupPage.group,orders:groupPage.orders || [],entries:groupPage.entries || []}:visibleClientGroups.find((group) => group.key === selectedEntryKey)) || null
      : null,
    [activeView, displayMode, selectedEntryKey, visibleClientGroups,scoped,groupPage],
  )

  const selectedClientTotal = useMemo(() => {
    if(scoped)return scopedSelection.total
    if (!selectedClientGroup) return 0
    const selected = new Set(clientSelection.selectedOrderIds)
    return selectedClientGroup.entries
      .filter((entry) => selected.has(entry.order.id))
      .reduce((sum, entry) => sum + (Number(entry.total) || 0), 0)
  }, [clientSelection.selectedOrderIds, selectedClientGroup,scoped,scopedSelection.total])

  const overlayOpen = Boolean((selectedEntry && mobileDetailOpen && isMobileDetail) || detailOrder || promiseOrder || quickPaymentOpen || forecastOpen)

  useEffect(() => {
    const resolvedSelection = activeView === 'pending' && displayMode === 'client'
      ? selectedClientGroup
      : selectedEntry
    if (!scoped && selectedEntryKey && !resolvedSelection) onQueryChange({ selectedEntryKey: null })
  }, [activeView, displayMode, onQueryChange, selectedClientGroup, selectedEntry, selectedEntryKey,scoped])

  useEffect(() => {
    if (scoped || !selectedClientGroup || clientSelection.activeGroupKey !== selectedClientGroup.key) return
    clientSelection.reconcile(selectedClientGroup.key, selectedClientGroup.orders.map((order) => order.id))
  }, [clientSelection.activeGroupKey, clientSelection.reconcile, selectedClientGroup,scoped])

  const selectPrimaryView = (view) => {
    if (!PRIMARY_VIEWS.includes(view)) return
    clientSelection.clear()
    patchQuery({ activeView: view, timingFilter: 'all', exactDateFilter: null, selectedEntryKey: null })
  }

  const selectDisplayMode = (mode) => {
    if (!['client', 'orders'].includes(mode) || mode === displayMode) return
    clientSelection.clear()
    setMobileDetailOpen(false)
    patchQuery({ displayMode: mode, selectedEntryKey: null })
  }

  const applyTimingFilter = (filter) => {
    if (!TIMING_FILTERS.includes(filter)) return
    patchQuery({ activeView: 'pending', timingFilter: filter, exactDateFilter: null, selectedEntryKey: null })
  }

  const applyForecastDate = (date) => {
    patchQuery({ activeView: 'pending', timingFilter: 'all', exactDateFilter: date, selectedEntryKey: null })
    setForecastOpen(false)
  }

  const openOrderDetail = (entry) => {
    patchQuery({ selectedEntryKey: entry.key })
    setMobileDetailOpen(isMobileDetail)
  }
  const openPaidOrderDetail = (order) => {
    patchQuery({ selectedEntryKey: `paid:${order.id}` })
    setMobileDetailOpen(isMobileDetail)
  }

  const toggleClientGroup = (group) => {
    if (!group) return false
    if (selectedEntryKey === group.key && clientSelection.activeGroupKey === group.key) {
      clientSelection.clear()
      patchQuery({ selectedEntryKey: null })
      return true
    }
    clientSelection.activateGroup(group.key, group.orders.map((order) => order.id))
    patchQuery({ selectedEntryKey: group.key })
    return true
  }

  const selectAllClientOrders = (group) => {
    if (!group) return false
    if (clientSelection.activeGroupKey !== group.key) {
      clientSelection.activateGroup(group.key, group.orders.map((order) => order.id))
    }
    return clientSelection.selectAllVisible()
  }

  const receiveSelectedClientOrders = (group = selectedClientGroup) => (
    requestSelectedPayment({
      clientId: group?.clientId ?? null,
      orderIds: clientSelection.selectedOrderIds,
    })
  )

  const closeMobileDetail = () => {
    setMobileDetailOpen(false)
    patchQuery({ selectedEntryKey: null })
  }

  const requestSelectedPayment = ({ clientId, orderIds = clientSelection.selectedOrderIds } = {}) => {
    if (!canReceivePayments) return false
    const selectedOrderIds = [...new Set(
      (Array.isArray(orderIds) ? orderIds : [])
        .filter((value) => typeof value === 'string' && value.trim())
        .map((value) => value.trim()),
    )]
    if (selectedOrderIds.length === 1) {
      if (!onRegisterPayment) return false
      return onRegisterPayment(selectedOrderIds[0]) !== false
    }
    if (selectedOrderIds.length >= 2 && clientId) {
      const opened = onRegisterClientOrdersPayment?.({ clientId, orderIds: selectedOrderIds })
      return Boolean(onRegisterClientOrdersPayment) && opened !== false
    }
    return false
  }

  const registerPaymentFromDetail = (orderId) => {
    if (!canReceivePayments) return false
    const targetOrder = orders.find((order) => order.id === orderId) ?? null
    setMobileDetailOpen(false)
    patchQuery({ selectedEntryKey: null })
    return requestSelectedPayment({ clientId: targetOrder?.clientId ?? null, orderIds: [orderId] })
  }

  const editPaymentPromiseFromDetail = (order) => {
    if (!canManagePaymentPromises) return false
    setMobileDetailOpen(false)
    patchQuery({ selectedEntryKey: null })
    setPromiseOrder(order)
    return true
  }

  const editPaymentPromiseFromGrouped = (order) => {
    if (!canManagePaymentPromises || !order) return false
    setPromiseOrder(order)
    return true
  }

  const registerQuickPayment = (orderId) => {
    if (!canReceivePayments) return false
    onRegisterPayment?.(orderId)
    return true
  }

  const viewOrderFromDetail = (order) => {
    setMobileDetailOpen(false)
    patchQuery({ selectedEntryKey: null })
    setDetailOrder(order)
  }

  const pendingIsGloballyEmpty = scoped?Boolean(summary&&['today','upcoming','overdue'].every(key=>summary[key].count===0)):pendingEntries.length === 0
  const pendingHasActiveFilter = Boolean(normalizedSearch || timingFilter !== 'all' || exactDateFilter)
  const pendingVisibleCount = scoped?(displayMode==='client'?reads.main.data?.matchingGroupCount:reads.main.data?.matchingCount):(displayMode === 'client' ? visibleClientGroups.length : visiblePendingEntries.length)


  const detail = selectedEntry ? (
    <ReceivableDetail
      orderPresentation={orderPresentation}
      entry={selectedEntry}
      currency={currency}
      disabled={writeDisabled}
      canReceivePayments={canReceivePayments}
      canManagePaymentPromises={canManagePaymentPromises}
      onRegisterPayment={registerPaymentFromDetail}
      onEditPaymentPromise={editPaymentPromiseFromDetail}
      onViewOrder={viewOrderFromDetail}
    />
  ) : null

  return (
    <>
      <AreaNavigation area="finance" />
      <div className="receivables-page-header">
        <PageHeader eyebrow="Financeiro" title="A receber" description="Acompanhe o que entra hoje, os próximos recebimentos e os atrasos." />
        <button
          type="button"
          className="receivables-forecast-button"
          onClick={() => setForecastOpen(true)}
          aria-label="Previsão de recebimentos"
          disabled={mainPending}
        >
          <Icon name="chart" size={18} />
          <span>Previsão</span>
        </button>
      </div>
      {mainPending ? <PageSkeleton label="Carregando resumo de recebimentos" heading={false} /> : (
      <section className="receivables-summary-grid" aria-label="Resumo de recebimentos">
        <button type="button" className="receivables-summary-card" onClick={() => applyTimingFilter('today')}>
          <span className="receivables-summary-icon"><Icon name="clock" size={18} /></span><span>Receber hoje</span><strong>{currency(summary.today.amount)}</strong><small>{summary.today.count} pedido(s)</small>
        </button>
        <button type="button" className="receivables-summary-card" onClick={() => applyTimingFilter('upcoming')}>
          <span className="receivables-summary-icon"><Icon name="receipt" size={18} /></span><span>Próximos</span><strong>{currency(summary.upcoming.amount)}</strong><small>{summary.upcoming.count} recebimento(s)</small>
        </button>
        <button type="button" className="receivables-summary-card receivables-summary-card-danger" onClick={() => applyTimingFilter('overdue')}>
          <span className="receivables-summary-icon"><Icon name="alert" size={18} /></span><span>Em atraso</span><strong>{currency(summary.overdue.amount)}</strong><small>{summary.overdue.count} pendência(s)</small>
        </button>
      </section>
      )}

      <div className="receivables-workspace">
        <section className="surface-card receivables-surface">
          <div className="receivables-primary-tabs" role="group" aria-label="Situação dos recebimentos">
            <button type="button" aria-pressed={activeView === 'pending'} onClick={() => selectPrimaryView('pending')}>Pendentes</button>
            <button type="button" aria-pressed={activeView === 'paid'} onClick={() => selectPrimaryView('paid')}>Quitados</button>
          </div>

          {activeView === 'pending' && (
            <div className="receivables-filter-strip" aria-label="Filtrar pendências por prazo">
              {TIMING_FILTERS.map((filter) => <button key={filter} type="button" aria-pressed={timingFilter === filter && !exactDateFilter} onClick={() => applyTimingFilter(filter)}>{TIMING_FILTER_LABELS[filter]}</button>)}
              {exactDateFilter && <button type="button" aria-pressed="true" onClick={() => patchQuery({ exactDateFilter: null })}>Data {formatOrderDate(exactDateFilter)} ×</button>}
            </div>
          )}

          {activeView === 'pending' && (
            <div className="receivables-display-mode" role="group" aria-label="Organização dos recebimentos">
              <button type="button" aria-pressed={displayMode === 'client'} onClick={() => selectDisplayMode('client')}>Por cliente</button>
              <button type="button" aria-pressed={displayMode === 'orders'} onClick={() => selectDisplayMode('orders')}>Lista de pedidos</button>
            </div>
          )}

          {canReceivePayments && activeView === 'pending' && displayMode === 'orders' && (
            <div className="receivables-header-actions">
              <Button
                type="button"
                icon="plus"
                className="receivables-payment-desktop-action"
                onClick={() => setQuickPaymentOpen(true)}
                disabled={writeDisabled || mainPending || (scoped?pendingIsGloballyEmpty:quickPaymentEntries.length === 0) || !onRegisterPayment}
              >
                Registrar recebimento
              </Button>
            </div>
          )}

          <div className="receivables-controls">
            <label className="search-control"><Icon name="search" size={18} /><input type="search" placeholder={activeView === 'pending' && displayMode === 'client' ? 'Buscar cliente, telefone ou pedido' : 'Buscar identificação, pedido ou produto'} value={searchInput} onChange={(event) => setSearchInput(event.target.value)} /></label>
            {activeView === 'pending' && <div className="receivables-sort-control"><span>Ordenar</span><SystemSelect label="Ordenar recebimentos" value={sortMode} options={SORT_OPTIONS} onChange={(value) => patchQuery({ sortMode: value })} /></div>}
            <span className="toolbar-count">{mainPending ? 'Atualizando resultados…' : `${activeView === 'pending' ? pendingVisibleCount : (scoped?reads.main.data.matchingCount:visiblePaidOrders.length)} item(ns)`}</span>
          </div>

          {mainPending ? (reads.main.error
            ? <div role="alert">Não foi possível carregar os recebimentos. <button type="button" onClick={reads.main.reload}>Tentar novamente</button></div>
            : <PageSkeleton label="Carregando recebimentos" heading={false} />) : activeView === 'pending' ? (
            displayMode === 'client' ? (
              <div className={`receivables-client-list${clientSelection.selectedCount > 0 ? ' has-selection' : ''}`} aria-label="Recebimentos pendentes por cliente">
                {visibleClientGroups.map((group) => (
                  <ReceivableClientGroup
                    key={group.key}
                    group={group}
                    readModel={scoped&&selectedEntryKey===group.key?reads.group:undefined}
                    expanded={selectedEntryKey === group.key}
                    selectedOrderIds={clientSelection.activeGroupKey === group.key ? clientSelection.selectedOrderIds : []}
                    currency={currency}
                    formatOrderDate={formatOrderDate}
                    getOrderItemsSummary={getOrderItemsSummary}
                    onToggle={toggleClientGroup}
                    onToggleOrder={clientSelection.toggleOrder}
                    onSelectAll={selectAllClientOrders}
                    onEditPaymentPromise={canManagePaymentPromises ? editPaymentPromiseFromGrouped : null}
                    promiseDisabled={writeDisabled || !canManagePaymentPromises}
                    selectionLimit={clientSelection.selectionLimit}
                    selectionLimitReached={clientSelection.selectionLimitReached}
                    disabled={writeDisabled || !canReceivePayments || (scoped&&scopedSelection.validating)}
                  />
                ))}
                {!visibleClientGroups.length && <div className="empty-state receivables-empty-state"><Icon name="wallet" size={28} /><strong>{pendingIsGloballyEmpty && !pendingHasActiveFilter ? 'Tudo recebido por aqui' : 'Nenhum recebimento neste filtro'}</strong><span>{pendingIsGloballyEmpty && !pendingHasActiveFilter ? 'Quando houver um pedido pendente, ele aparecerá automaticamente nesta tela.' : 'Tente outro período ou ajuste a busca.'}</span></div>}
              </div>
            ) : (
              <div className="receivables-ledger" aria-label="Recebimentos pendentes">
                {visiblePendingEntries.map((entry) => (
                  <div className="receivable-ledger-item" key={entry.key}>
                    <button type="button" className="receivable-ledger-row" aria-pressed={selectedEntryKey === entry.key} onClick={() => openOrderDetail(entry)}>
                      <span className="receivable-ledger-avatar">{entry.label.charAt(0).toUpperCase()}</span>
                      <span className="receivable-ledger-main"><strong>{entry.label}</strong><span>{`${formatOrderDisplayNumber(entry.order)} · ${getOrderItemsSummary(entry.order)}`}</span><span className={`receivable-timing receivable-timing-${entry.timing.status}`}>{timingLabel(entry, formatOrderDate)}</span></span>
                      <strong className="receivable-ledger-amount">{currency(entry.total)}</strong><Icon name="details" size={18} />
                    </button>
                  </div>
                ))}
                {!visiblePendingEntries.length && <div className="empty-state receivables-empty-state"><Icon name="wallet" size={28} /><strong>{pendingIsGloballyEmpty && !pendingHasActiveFilter ? 'Tudo recebido por aqui' : 'Nenhum recebimento neste filtro'}</strong><span>{pendingIsGloballyEmpty && !pendingHasActiveFilter ? 'Quando houver um pedido pendente, ele aparecerá automaticamente nesta tela.' : 'Tente outro período ou ajuste a busca.'}</span></div>}
              </div>
            )
          ) : (
            <div className="receivables-ledger receivables-ledger-paid" aria-label="Recebimentos quitados">
              {visiblePaidOrders.map((order) => (
                <button type="button" className="receivable-ledger-row" aria-pressed={selectedEntryKey === `paid:${order.id}`} key={order.id} onClick={() => openPaidOrderDetail(order)}>
                  <span className="receivable-ledger-avatar receivable-ledger-avatar-paid"><Icon name="check" size={17} /></span>
                  <span className="receivable-ledger-main"><strong>{order.client || 'Pedido sem identificação'}</strong><span>{formatOrderDisplayNumber(order)} · {getOrderItemsSummary(order)}</span><span className="receivable-paid-meta">{paidMeta(order)}</span></span>
                  <strong className="receivable-ledger-amount">{currency(order.total || 0)}</strong><Icon name="details" size={18} />
                </button>
              ))}
              {!visiblePaidOrders.length && <div className="empty-state receivables-empty-state"><Icon name="check" size={28} /><strong>{allPaidOrders.length ? 'Nenhum recebimento neste filtro' : 'Nenhum recebimento registrado ainda'}</strong><span>{allPaidOrders.length ? 'Tente outro período ou ajuste a busca.' : 'Os pedidos pagos aparecerão aqui.'}</span></div>}
            </div>
          )}
          {scoped&&reads.main.data&&reads.main.error&&<p role="alert">Não foi possível atualizar os recebimentos.<button type="button" onClick={reads.main.reload}>Tentar novamente</button></p>}
          {scoped&&reads.main.hasMore&&<button type="button" disabled={reads.main.status==='loading-next'} onClick={reads.main.loadNext}>Carregar mais recebimentos</button>}
        </section>

        <aside className="receivables-detail-panel" aria-label="Detalhes do recebimento">
          {mainPending ? <p role="status">Atualizando detalhes…</p> : activeView === 'pending' && displayMode === 'client' ? (
            <ReceivableClientPanel
              group={selectedClientGroup}
              readModel={scoped?{...reads.group,selectedCount:scopedSelection.ids.length,selectedTotal:scopedSelection.total}:undefined}
              selectedOrderIds={clientSelection.selectedOrderIds}
              currency={currency}
              formatOrderDate={formatOrderDate}
              getOrderItemsSummary={getOrderItemsSummary}
              onToggleOrder={clientSelection.toggleOrder}
              onSelectAll={selectAllClientOrders}
              onDeselectAll={clientSelection.deselectAll}
              onReceive={receiveSelectedClientOrders}
              onOpenClient={onOpenClient}
              onEditPaymentPromise={canManagePaymentPromises ? editPaymentPromiseFromGrouped : null}
              promiseDisabled={writeDisabled || !canManagePaymentPromises}
              selectionLimit={clientSelection.selectionLimit}
              selectionLimitReached={clientSelection.selectionLimitReached}
              disabled={writeDisabled || !canReceivePayments || (scoped&&scopedSelection.validating)}
            />
          ) : (detail || <div className="receivable-detail-empty">Selecione um recebimento para ver os detalhes.</div>)}
        </aside>
      </div>

      {canReceivePayments && activeView === 'pending' && displayMode === 'orders' && !overlayOpen && (
        <button
          type="button"
          className="receivables-payment-fab"
          aria-label="Registrar recebimento"
          onClick={() => setQuickPaymentOpen(true)}
          disabled={writeDisabled || mainPending || (scoped?pendingIsGloballyEmpty:quickPaymentEntries.length === 0) || !onRegisterPayment}
        >
          <Icon name="plus" size={20} />
          <span>Registrar recebimento</span>
        </button>
      )}

      {canReceivePayments && activeView === 'pending' && displayMode === 'client' && clientSelection.selectedCount > 0 && selectedClientGroup && !overlayOpen && (
        <div className="receivables-client-selection-bar" role="region" aria-label="Resumo da seleção">
          <div>
            <span>{clientSelection.selectedCount} {clientSelection.selectedCount === 1 ? 'pedido selecionado' : 'pedidos selecionados'}</span>
            <strong>{currency(selectedClientTotal)}</strong>
          </div>
          <Button type="button" className="receivables-client-receive-button" onClick={() => receiveSelectedClientOrders(selectedClientGroup)} disabled={writeDisabled || (scoped&&scopedSelection.validating)}>
            Receber
          </Button>
        </div>
      )}

      <BottomSheet open={Boolean(selectedEntry) && mobileDetailOpen && isMobileDetail} title="Detalhes do recebimento" onClose={closeMobileDetail}>
        <ReceivableDetail
      orderPresentation={orderPresentation}
          entry={selectedEntry}
          currency={currency}
          disabled={writeDisabled}
          canReceivePayments={canReceivePayments}
          canManagePaymentPromises={canManagePaymentPromises}
          onRegisterPayment={registerPaymentFromDetail}
          onEditPaymentPromise={editPaymentPromiseFromDetail}
          onViewOrder={viewOrderFromDetail}
        />
      </BottomSheet>

      {forecastOpen && (
        <ReceivablesForecastDialog
          orderPresentation={orderPresentation}
          forecast={forecast}
          receivedToday={receivedToday}
          currency={currency}
          onClose={() => setForecastOpen(false)}
          onSelectDate={applyForecastDate}
        />
      )}

      {canReceivePayments && quickPaymentOpen && (
        <ReceivablesQuickPaymentDialog
          orderPresentation={orderPresentation}
          open={quickPaymentOpen}
          entries={quickPaymentEntries}
          readModel={scoped?{...reads.quick,search:quickSearch,onSearchChange:setQuickSearch}:undefined}
          currency={currency}
          disabled={writeDisabled}
          onClose={() => setQuickPaymentOpen(false)}
          onSelect={registerQuickPayment}
        />
      )}

      {canManagePaymentPromises && promiseOrder && <PaymentPromiseDialog order={promiseOrder} today={today} disabled={writeDisabled} onSave={(...args) => canManagePaymentPromises ? onUpdatePaymentPromise?.(...args) : false} onClose={() => setPromiseOrder(null)} />}
      {detailOrder && renderOrderDetail?.(detailOrder, () => setDetailOrder(null))}

    </>
  )
}

export default Receivables
