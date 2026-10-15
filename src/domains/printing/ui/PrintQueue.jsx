import { createRefreshQueue } from '../../../infrastructure/realtime/refreshQueue.js'
import { useContextApi } from '../../../infrastructure/api/ContextApi.js'
import { useCallback, useEffect, useRef, useState } from 'react'
import PageHeader from '../../../shared/ui/PageHeader'
import StatCard from '../../../shared/ui/StatCard'
import Button from '../../../shared/ui/Button'
import Modal from '../../../shared/ui/Modal'
import ConfirmationDialog from '../../../shared/ui/ConfirmationDialog'
import OrderTicketPreview from './OrderTicketPreview.jsx'
import SystemSelect from '../../../shared/ui/SystemSelect'
import PrintStatusBadge from './PrintStatusBadge.jsx'
import './print-queue.css'
import { buildPrintQueueSummary, normalizePrintQueueSummary } from './printQueueSummary.js'
import { derivePrintOperationalStatus } from '../domain/printOperationalStatus.js'
import { buildPrintOperationalView } from './printOperationalView.js'
import { getPrintQueueLabel, resolvePrintQueueState } from '../../../../shared/printQueue.js'
import { formatOrderCustomerIdentity } from '../../../../shared/orderPrintDocument.js'
import { formatOrderDisplayNumber } from '../../../../shared/orderDisplayNumber.js'
import { PRINT_QUEUE_ORIGIN_FILTERS, PRINT_QUEUE_STATUS_FILTERS } from './printQueueFilters.js'
import { getPrintJobDetails } from './printQueueDetails.js'
import { createPrintingApi } from '../infrastructure/printingApi.js'
import { sortPrintQueueJobsForDisplay, togglePrintQueueSort, updatePrintQueueQuery } from './printQueueQuery.js'

const formatJobTime = (createdAt) => {
  if (!createdAt) return null
  const date = new Date(createdAt)
  if (Number.isNaN(date.getTime())) return String(createdAt)
  return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(date)
}

const getCustomerOrTable = (document) => {
  const customer = String(document?.customer?.name || '').trim()
  const table = String(document?.tableTab?.tableName || document?.tableIdentifier || document?.order?.tableIdentifier || document?.table?.identifier || '').trim()
  return formatOrderCustomerIdentity({ tableIdentifier: table, customerName: customer })
}

const getPrintJobView = (job, stationReady, order) => {
  const state = job?.queueState
    ? resolvePrintQueueState(job.queueState)
    : resolvePrintQueueState(job?.status, { stationReady })
  return {
    orderNumber: job?.type === 'table-tab' && job?.document?.tableTab?.number
      ? `Comanda #${job.document.tableTab.number}`
      : order ? formatOrderDisplayNumber(order) : formatOrderDisplayNumber({orderNumber:job?.document?.order?.number}),
    jobId: job?.id || '—',
    customerOrTable: getCustomerOrTable(job?.document),
    origin: job?.trigger === 'automatic' ? 'Automático' : job?.trigger === 'manual' ? 'Manual/Reimpressão' : null,
    copies: `${Number(job?.copiesPrinted) || 0}/${Number(job?.copiesRequested) || 0}`,
    status: getPrintQueueLabel(state),
    state,
    time: formatJobTime(job?.createdAt),
    station: job?.stationId || null,
    attentionReason: state === 'attention' ? job?.attentionReason || null : null,
  }
}

const EXECUTE_ACTIONS = new Set(['retry', 'requestSecondCopy', 'skipSecondCopy', 'reprint', 'confirmPrinted', 'confirmNotPrinted'])
const FORCE_ACTIONS = new Set(['printNow', 'forcePrint'])
const DISCARD_ACTIONS = new Set(['discard'])
const SEARCH_DEBOUNCE_MS = 300
const OFFLINE_MUTATION_MESSAGE = 'Você está offline. Reconecte para alterar a fila de impressão.'
const cacheKeyForQuery = (query) => JSON.stringify([
  query.page, query.pageSize, query.sortBy, query.sortDir, query.status, query.trigger, query.search,
])

function PrintQueue({ orders = [], printing, reviewJobId = null, onReviewJobConsumed, onOpenPrintingSettings, onToast, queryState, onQueryChange, canExecutePrinting = true, canDiscardPrinting = true, canForcePrinting = false, isOnline = true, realtime }) {
  const { getPrintJobs, getPrintQueueSummary } = useContextApi(createPrintingApi)
  const subscribeRealtime=realtime?.subscribeInvalidations
  const station = printing?.localStation ?? null
  const query = queryState
  const [operationalPage, setOperationalPage] = useState({ jobs: [], pageInfo: { page: 1, pageSize: 10, totalItems: 0, totalPages: 1 } })
  const [summary, setSummary] = useState(() => buildPrintQueueSummary())
  const [panelLoading, setPanelLoading] = useState(true)
  const [selectedJob, setSelectedJob] = useState(null)
  const [confirmation, setConfirmation] = useState(null)
  const [actionPending, setActionPending] = useState(false)
  const [bulkDiscardConfirmation, setBulkDiscardConfirmation] = useState(false)
  const [bulkDiscardPending, setBulkDiscardPending] = useState(false)
  const [reprintCopies, setReprintCopies] = useState(null)
  const [showReprint, setShowReprint] = useState(false)
  const [showTicket, setShowTicket] = useState(false)
  const [unknownConfirmation, setUnknownConfirmation] = useState(null)
  const [recoveryPending, setRecoveryPending] = useState(false)
  const [searchInput, setSearchInput] = useState(query.search)
  const generationRef = useRef(0)
  const refreshAbortRef = useRef(null)
  const pageCacheRef = useRef(new Map())
  const updateQuery = useCallback((changes) => onQueryChange(updatePrintQueueQuery(query, changes)), [onQueryChange, query])

  const prefetchAdjacentPages = useCallback((pageInfo, signal) => {
    const current = Number(pageInfo?.page) || 1
    const total = Number(pageInfo?.totalPages) || 1
    const adjacent = [current - 1, current + 1].filter((pageNumber) => pageNumber >= 1 && pageNumber <= total)
    for (const pageNumber of adjacent) {
      const nextQuery = { ...query, page: pageNumber }
      const key = cacheKeyForQuery(nextQuery)
      if (pageCacheRef.current.has(key)) continue
      void getPrintJobs(nextQuery, { signal }).then((payload) => {
        if (signal?.aborted) return
        pageCacheRef.current.set(key, {
          jobs: Array.isArray(payload?.jobs) ? payload.jobs : [],
          pageInfo: payload?.pageInfo || { page: pageNumber, pageSize: 10, totalItems: 0, totalPages: 1 },
        })
      }).catch((error) => {
        if (error?.name !== 'AbortError') onToast?.(error?.message || 'Não foi possível pré-carregar a fila de impressão.')
      })
    }
  }, [onToast, query])

  const refreshPanel = useCallback(async () => {
    if (!isOnline) {
      setPanelLoading(false)
      return
    }
    const generation = ++generationRef.current
    const key = cacheKeyForQuery(query)
    const cached = pageCacheRef.current.get(key)
    if (cached) {
      setOperationalPage(cached)
      setPanelLoading(false)
    } else {
      setPanelLoading(true)
    }
    refreshAbortRef.current?.abort()
    const controller = new AbortController()
    refreshAbortRef.current = controller
    try {
      const [operationalPayload, summaryPayload] = await Promise.all([
        getPrintJobs(query, { signal: controller.signal }),
        getPrintQueueSummary({ signal: controller.signal }),
      ])
      if (generation !== generationRef.current || controller.signal.aborted) return
      const nextPage = {
        jobs: Array.isArray(operationalPayload?.jobs) ? operationalPayload.jobs : [],
        pageInfo: operationalPayload?.pageInfo || { page: 1, pageSize: 10, totalItems: 0, totalPages: 1 },
      }
      pageCacheRef.current.set(key, nextPage)
      setOperationalPage(nextPage)
      setSelectedJob((current) => current ? nextPage.jobs.find((job) => job?.id === current.id) ?? current : null)
      setSummary(normalizePrintQueueSummary(summaryPayload?.summary || buildPrintQueueSummary(operationalPayload?.jobs)))
      prefetchAdjacentPages(nextPage.pageInfo, controller.signal)
    } catch (error) {
      if (error?.name !== 'AbortError' && generation === generationRef.current) {
        onToast?.(error?.message || 'Não foi possível atualizar a fila de impressão.')
      }
    } finally {
      if (refreshAbortRef.current === controller) refreshAbortRef.current = null
      if (generation === generationRef.current) setPanelLoading(false)
    }
  }, [isOnline, onToast, prefetchAdjacentPages, query])

  useEffect(() => {
    setSearchInput(query.search)
  }, [query.search])

  useEffect(() => {
    if (!reviewJobId) return
    const managerJobs = Array.isArray(printing?.jobs) ? printing.jobs : []
    const pageJobs = Array.isArray(operationalPage.jobs) ? operationalPage.jobs : []
    const target = [...managerJobs, ...pageJobs].find((job) => job?.id === reviewJobId)
    if (!target) return
    setSelectedJob(target)
    onReviewJobConsumed?.(reviewJobId)
  }, [onReviewJobConsumed, operationalPage.jobs, printing?.jobs, reviewJobId])

  useEffect(() => {
    if (searchInput === query.search) return undefined
    const timer = globalThis.setTimeout?.(() => {
      onQueryChange(updatePrintQueueQuery(query, { search: searchInput }))
    }, SEARCH_DEBOUNCE_MS)
    return () => { if (timer) globalThis.clearTimeout?.(timer) }
  }, [onQueryChange, query, searchInput])

  useEffect(() => {
    if (!isOnline) {
      refreshAbortRef.current?.abort()
      setPanelLoading(false)
      return undefined
    }
    const queue=createRefreshQueue({run:refreshPanel})
    void queue.refresh()
    const unsubscribe=subscribeRealtime?.(event=>{if(event.topics.includes('printing'))return queue.refresh()})
    const timer = subscribeRealtime?null:globalThis.setInterval?.(() => { void queue.refresh() }, 10000)
    return () => {
      queue.stop();unsubscribe?.()
      generationRef.current += 1
      refreshAbortRef.current?.abort()
      if (timer) globalThis.clearInterval?.(timer)
    }
  }, [isOnline, refreshPanel,subscribeRealtime])
  const operationalStatus = derivePrintOperationalStatus({
    stations: printing?.stations,
    localStation: station,
    transportKind: printing?.transportKind,
    printerState: printing?.printerState,
    qzConnected: printing?.qzConnected,
    configuredPrinterName: printing?.configuredPrinterName,
    printerQueueFound: printing?.printerQueueFound,
    printerHealth: printing?.printerHealth,
  })
  const operationalView = buildPrintOperationalView(operationalStatus, {
    pendingCount: summary.pending,
    localPrinterName: printing?.configuredPrinterName,
  })
  const stationReady = operationalStatus.code === 'ready'
  const ordersById = new Map(orders.map((order) => [String(order.id), order]))
  const operationalJobs = sortPrintQueueJobsForDisplay(
    Array.isArray(operationalPage.jobs) ? operationalPage.jobs : [],
    { sortBy: query.sortBy, sortDir: query.sortDir, orders },
  )
  const jobRows = operationalJobs.map((job) => getPrintJobView(job, stationReady, ordersById.get(String(job.orderId))))
  const pageInfo = operationalPage.pageInfo || { page: 1, pageSize: 10, totalItems: 0, totalPages: 1 }
  const hasActiveFilters = Boolean(searchInput.trim()) || Boolean(query.status) || Boolean(query.trigger)
  const bulkDiscardCandidateCount = Math.max(0, Number(summary.discardable || 0))
  const recoveryState = printing?.recoveryState || station?.recoveryState || 'normal'
  const selectedDetails = selectedJob ? getPrintJobDetails(selectedJob, {
    order: ordersById.get(String(selectedJob.orderId)),
    stations: printing?.stations,
    stationReady,
  }) : null

  const closeDetails = () => {
    setSelectedJob(null)
    setShowReprint(false)
    setShowTicket(false)
    setReprintCopies(null)
  }
  const getUnknownAttempt = (job) => job?.attempt || job?.attempts?.find((attempt) => attempt?.status === 'unknown' && !attempt?.resolution) || null
  const runAction = async (action) => {
    if (!isOnline) {
      onToast?.(OFFLINE_MUTATION_MESSAGE)
      return false
    }
    if ((FORCE_ACTIONS.has(action) && !canForcePrinting) || (EXECUTE_ACTIONS.has(action) && !canExecutePrinting) || (DISCARD_ACTIONS.has(action) && !canDiscardPrinting) || !selectedJob || actionPending) return false
    setActionPending(true)
    try {
      if (action === 'printNow') await printing?.requestPrintNow?.(selectedJob, { refreshManager: false })
      if (action === 'retry') await printing?.requestRetry?.(selectedJob, { refreshManager: false })
      if (action === 'discard') await printing?.requestDiscard?.(selectedJob, { refreshManager: false })
      if (action === 'forcePrint') await printing?.requestForcePrint?.(selectedJob, { refreshManager: false })
      if (action === 'requestSecondCopy') await printing?.requestSecondCopy?.(selectedJob, { refreshManager: false })
      if (action === 'skipSecondCopy') await printing?.skipSecondCopy?.(selectedJob, { refreshManager: false })
      if (action === 'confirmPrinted') await printing?.confirmUnknownPrinted?.(selectedJob, getUnknownAttempt(selectedJob))
      if (action === 'confirmNotPrinted') await printing?.confirmUnknownNotPrinted?.(selectedJob, getUnknownAttempt(selectedJob))
      onToast?.({ printNow: 'Pedido priorizado na fila', retry: 'Nova tentativa enviada para a fila', discard: 'Trabalho de impressão descartado', forcePrint: 'Impressão autorizada e enviada para a fila', requestSecondCopy: '2ª via enviada para a fila', skipSecondCopy: '2ª via dispensada', confirmPrinted: 'Via confirmada como impressa', confirmNotPrinted: 'Via reenviada para a fila' }[action])
      closeDetails()
      pageCacheRef.current.clear()
      await refreshPanel()
    } catch (error) {
      onToast?.(error?.message || 'Não foi possível concluir a operação.')
    } finally {
      setActionPending(false)
      setConfirmation(null)
    }
  }
  const requestAction = (action) => {
    if (!isOnline) {
      onToast?.(OFFLINE_MUTATION_MESSAGE)
      return false
    }
    if ((FORCE_ACTIONS.has(action) && !canForcePrinting) || (EXECUTE_ACTIONS.has(action) && !canExecutePrinting) || (DISCARD_ACTIONS.has(action) && !canDiscardPrinting)) return false
    if (action === 'discard' || action === 'forcePrint' || action === 'requestSecondCopy' || action === 'skipSecondCopy') setConfirmation(action)
    else if (action === 'confirmNotPrinted') setUnknownConfirmation(action)
    else if (action === 'reprint') {
      setReprintCopies(null)
      setShowReprint(true)
    }
    else void runAction(action)
  }
  const confirmReprint = async () => {
    if (!isOnline) {
      onToast?.(OFFLINE_MUTATION_MESSAGE)
      return false
    }
    if (!canExecutePrinting || !selectedJob || !reprintCopies || actionPending) return false
    setActionPending(true)
    try {
      await printing?.requestReprint?.(selectedJob, reprintCopies, { refreshManager: false })
      onToast?.('Reimpressão adicionada à fila')
      closeDetails()
      pageCacheRef.current.clear()
      await refreshPanel()
    } catch (error) {
      onToast?.(error?.message || 'Não foi possível concluir a reimpressão.')
    } finally {
      setActionPending(false)
    }
  }
  const runRecoveryAction = async (action) => {
    if (!isOnline) {
      onToast?.(OFFLINE_MUTATION_MESSAGE)
      return
    }
    if (recoveryPending) return
    setRecoveryPending(true)
    try {
      if (action === 'resume') await printing?.resumeRecovery?.()
      if (action === 'next') await printing?.printNextRecovery?.()
      pageCacheRef.current.clear()
      await refreshPanel()
    } catch (error) {
      onToast?.(error?.message || 'Não foi possível continuar a recuperação da impressão.')
    } finally {
      setRecoveryPending(false)
    }
  }
  const requestBulkDiscard = () => {
    if (!isOnline) {
      onToast?.(OFFLINE_MUTATION_MESSAGE)
      return false
    }
    if (!canDiscardPrinting || bulkDiscardPending || bulkDiscardCandidateCount === 0) return false
    setBulkDiscardConfirmation(true)
    return true
  }

  const confirmBulkDiscard = async () => {
    if (!isOnline) {
      onToast?.(OFFLINE_MUTATION_MESSAGE)
      return false
    }
    if (!canDiscardPrinting || bulkDiscardPending || !printing?.requestDiscardPendingJobs) return false
    setBulkDiscardPending(true)
    try {
      const response = await printing.requestDiscardPendingJobs()
      const discardedCount = Math.max(0, Number(response?.discardedCount || 0))
      const retainedCount = Math.max(0, Number(response?.retainedCount || 0))
      setBulkDiscardConfirmation(false)
      pageCacheRef.current.clear()
      await refreshPanel()
      const discardedLabel = discardedCount === 1 ? '1 trabalho descartado' : `${discardedCount} trabalhos descartados`
      if (retainedCount > 0) {
        const retainedLabel = retainedCount === 1 ? '1 mantido' : `${retainedCount} mantidos`
        onToast?.(`${discardedLabel}. ${retainedLabel} porque precisam de confirmação ou estão em processamento.`)
      } else {
        onToast?.(`${discardedLabel}.`)
      }
      return true
    } catch (error) {
      onToast?.(error?.message || 'Não foi possível descartar as pendências da fila.')
      return false
    } finally {
      setBulkDiscardPending(false)
    }
  }

  const orderNumber = selectedDetails?.title || 'este pedido'

  return (
    <div className="print-queue-page">
      <PageHeader
        eyebrow="Operação"
        title="Fila de impressão"
        description="Acompanhe e gerencie as impressões da cozinha"
        actions={onOpenPrintingSettings ? (
          <Button
            type="button"
            variant="secondary"
            icon="settings"
            className="print-queue-settings-button"
            aria-label="Configurações, Impressão"
            title="Abrir Configurações > Impressão"
            onClick={onOpenPrintingSettings}
          >
            Configurações &gt; Impressão
          </Button>
        ) : null}
      />
      <section
        className={`print-queue-operational-card is-${operationalView.tone}`}
        aria-label="Status operacional da impressão"
        data-status={operationalView.code}
      >
        <div className="print-queue-operational-copy">
          <strong>{operationalView.title}</strong>
          {operationalView.description && <span>{operationalView.description}</span>}
          {operationalView.helper && <small>{operationalView.helper}</small>}
        </div>
      </section>

      {['active', 'deferred'].includes(recoveryState) && (
        <section className="print-queue-recovery-banner" aria-live="polite">
          <div><strong>Recuperação de impressão em andamento</strong><span>O consumidor normal permanece pausado até a conclusão segura.</span></div>
          <div className="print-queue-recovery-actions">
            {recoveryState === 'deferred' && <Button type="button" variant="secondary" onClick={() => void runRecoveryAction('resume')} disabled={recoveryPending || !isOnline}>Retomar recuperação</Button>}
            <Button type="button" onClick={() => void runRecoveryAction('next')} disabled={recoveryPending || !isOnline || recoveryState !== 'active'}>Imprimir próxima via</Button>
          </div>
        </section>
      )}

      <section className="stats-grid print-queue-summary" aria-label="Resumo da fila de impressão">
        <StatCard label="Aguardando impressão" value={summary.pending} icon="printer" className={`print-queue-summary-card ${summary.pending === 0 ? 'is-zero' : 'has-value'}`} />
        <StatCard label="Aguardando confirmação" value={summary.awaitingConfirmation} icon="clock" className={`print-queue-summary-card ${summary.awaitingConfirmation === 0 ? 'is-zero' : 'has-value'}`} />
        <StatCard label="Aguardando 2ª via" value={summary.waitingSecondCopy} icon="receipt" className={`print-queue-summary-card ${summary.waitingSecondCopy === 0 ? 'is-zero' : 'has-value'}`} />
        <StatCard label="Requer atenção" value={summary.attention} icon="alert" tone={summary.attention ? 'danger' : 'neutral'} className={`print-queue-summary-card ${summary.attention === 0 ? 'is-zero' : 'has-value has-attention'}`} />
      </section>

      <section className="print-queue-jobs-section" aria-label="Trabalhos da fila de impressão">
        <div className="print-queue-jobs-heading">
          <div>
            <p className="section-kicker">Execução</p>
            <h2>Trabalhos de impressão</h2>
          </div>
          <Button
            type="button"
            variant="secondary"
            className="button-danger-outline print-queue-bulk-discard-button"
            onClick={requestBulkDiscard}
            disabled={!canDiscardPrinting || !isOnline || bulkDiscardPending || bulkDiscardCandidateCount === 0}
          >
            Descartar pendências
          </Button>
        </div>
        <div className="print-queue-filters" aria-label="Filtros da fila de impressão">
          <label className="print-queue-search">
            <input
              type="search"
              aria-label="Buscar pedido, cliente ou mesa"
              placeholder="Buscar pedido, cliente ou mesa"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
            />
          </label>
          <label className="print-queue-filter-control">
            <span>Status</span>
            <SystemSelect value={query.status} options={PRINT_QUEUE_STATUS_FILTERS.map((option) => ({ ...option, value: option.value === 'all' ? '' : option.value }))} onChange={(status) => updateQuery({ status })} label="Filtrar por status" />
          </label>
          <label className="print-queue-filter-control">
            <span>Origem</span>
            <SystemSelect value={query.trigger} options={PRINT_QUEUE_ORIGIN_FILTERS.map((option) => ({ ...option, value: option.value === 'all' ? '' : option.value }))} onChange={(trigger) => updateQuery({ trigger })} label="Filtrar por origem" />
          </label>
        </div>
        {panelLoading && operationalJobs.length === 0 ? (
          <p className="print-queue-empty">Atualizando trabalhos de impressão…</p>
        ) : operationalJobs.length === 0 && hasActiveFilters ? (
          <p className="print-queue-empty print-queue-filtered-empty">Nenhum trabalho encontrado com os filtros atuais.</p>
        ) : operationalJobs.length === 0 ? (
          <p className="print-queue-empty">Os trabalhos de impressão aparecerão aqui.</p>
        ) : (
          <>
            <div className="print-queue-jobs-table-wrap">
              <table className="print-queue-jobs-table">
                <thead><tr>
                  {[
                    ['Pedido', 'orderNumber'], ['Job', 'jobId'], ['Status', 'status'], ['Origem', 'trigger'], ['Data/Hora', 'createdAt'],
                  ].map(([label, sortBy]) => {
                    const active = query.sortBy === sortBy
                    return <th key={sortBy} aria-sort={active ? (query.sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}><button type="button" className="print-queue-sort" onClick={() => onQueryChange(togglePrintQueueSort(query, sortBy))}>{label} <span aria-hidden="true">{active ? (query.sortDir === 'asc' ? '↑' : '↓') : '↕'}</span></button></th>
                  })}
                  <th>Vias</th>
                </tr></thead>
                <tbody>
                  {jobRows.map((job, index) => (
                    <tr key={operationalJobs[index]?.id || `${job.orderNumber || 'job'}-${index}`} onClick={() => setSelectedJob(operationalJobs[index])} className="print-queue-job-row">
                      <td>{job.orderNumber}<small>{job.customerOrTable || '—'}</small></td>
                      <td>{job.jobId}</td>
                      <td><PrintStatusBadge job={operationalJobs[index]} />{job.attentionReason && <small className="print-queue-attention-reason">{job.attentionReason}</small>}</td>
                      <td>{job.origin || '—'}</td>
                      <td>{job.time || '—'}</td>
                      <td>{job.copies} vias</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="print-queue-job-cards" aria-label="Trabalhos de impressão em cards">
              {jobRows.map((job, index) => (
                <article className="print-queue-job-card" key={operationalJobs[index]?.id || `${job.orderNumber || 'job'}-card-${index}`} onClick={() => setSelectedJob(operationalJobs[index])}>
                  <div className="print-queue-job-card-header"><strong>{job.orderNumber}</strong><PrintStatusBadge job={operationalJobs[index]} /></div>
                  <strong className="print-queue-job-customer">{job.customerOrTable || '—'}</strong>
                  <div className="print-queue-job-meta"><span>{job.jobId}</span><span>{job.origin || '—'}</span><span>Vias {job.copies}</span><span>{job.time || '—'}</span></div>
                  {job.attentionReason && <p className="print-queue-attention-reason">{job.attentionReason}</p>}
                </article>
              ))}
            </div>
            {pageInfo.totalPages > 1 && <nav className="print-queue-pagination" aria-label="Paginação da fila de impressão">
              <Button type="button" variant="secondary" onClick={() => updateQuery({ page: pageInfo.page - 1 })} disabled={pageInfo.page <= 1}>Anterior</Button>
              <span>Página {pageInfo.page} de {pageInfo.totalPages}</span>
              <Button type="button" variant="secondary" onClick={() => updateQuery({ page: pageInfo.page + 1 })} disabled={pageInfo.page >= pageInfo.totalPages}>Próxima</Button>
            </nav>}
          </>
        )}
      </section>
      {selectedDetails && (
          <Modal title={selectedDetails.title} onClose={closeDetails} footer={<div className="print-queue-detail-actions">
            <Button type="button" variant="secondary" className="print-queue-detail-close" onClick={closeDetails} disabled={actionPending}>Fechar</Button>
            {selectedJob?.type === 'order' && selectedJob?.document?.type === 'order' && <Button type="button" variant="secondary" className="print-queue-detail-ticket" onClick={() => setShowTicket(true)} disabled={actionPending}>Ver ticket</Button>}
            {selectedDetails.actions.filter((action) => DISCARD_ACTIONS.has(action.key)).map((action) => <Button key={action.key} type="button" variant="secondary" className="print-queue-detail-destructive" onClick={() => requestAction(action.key)} disabled={actionPending || !isOnline || !canDiscardPrinting}>{action.label}</Button>)}
            {selectedDetails.actions.filter((action) => !DISCARD_ACTIONS.has(action.key)).map((action) => <Button key={action.key} type="button" className="print-queue-detail-primary" onClick={() => requestAction(action.key)} disabled={actionPending || !isOnline || (FORCE_ACTIONS.has(action.key) && !canForcePrinting) || (EXECUTE_ACTIONS.has(action.key) && !canExecutePrinting)}>{action.label}</Button>)}
          </div>}>
          {selectedDetails.identity && <p className="print-queue-detail-identity">{selectedDetails.identity}</p>}
          <div className="print-queue-detail-sections">
            <section aria-labelledby="print-detail-status"><h3 id="print-detail-status">Status</h3><p>{selectedDetails.status}</p></section>
            <section aria-labelledby="print-detail-print"><h3 id="print-detail-print">Impressão</h3>
              {selectedDetails.origin && <p><span>Origem</span>{selectedDetails.origin}</p>}
              {selectedDetails.copies && <p><span>Vias</span>{selectedDetails.copies}</p>}
              {selectedDetails.priority && <p><span>Prioridade</span>{selectedDetails.priority}</p>}
              {selectedDetails.station && <p><span>Estação responsável</span>{selectedDetails.station}</p>}
              <p><span>Estado atual</span>{selectedDetails.status}</p>
            </section>
            {Object.keys(selectedDetails.times).length > 0 && <section aria-labelledby="print-detail-times"><h3 id="print-detail-times">Horários</h3>{Object.values(selectedDetails.times).map((time) => <p key={time.label}><span>{time.label}</span>{time.value}</p>)}</section>}
            {(selectedDetails.attentionReason || selectedDetails.error) && <section aria-labelledby="print-detail-attention"><h3 id="print-detail-attention">Erro / atenção</h3>{selectedDetails.attentionReason && <p><span>Motivo</span>{selectedDetails.attentionReason}</p>}{selectedDetails.error?.code && <p><span>Código</span>{selectedDetails.error.code}</p>}{selectedDetails.error?.message && <p><span>Mensagem</span>{selectedDetails.error.message}</p>}</section>}
            {selectedDetails.unknownOutcome && <section className="print-queue-unknown-outcome" aria-labelledby="print-detail-unknown"><h3 id="print-detail-unknown">{selectedDetails.unknownOutcome.title}</h3><p>{selectedDetails.unknownOutcome.message}</p></section>}
            {selectedDetails.reprintOf && <section aria-labelledby="print-detail-link"><h3 id="print-detail-link">Vínculo</h3><p>{selectedDetails.reprintOf}</p></section>}
            {selectedDetails.audit && <section aria-labelledby="print-detail-audit"><h3 id="print-detail-audit">Auditoria</h3><p><span>Solicitado por</span>{selectedDetails.requestedBy}</p><p><span>Ação</span>{selectedDetails.audit.action}</p>{selectedDetails.audit.at && <p><span>Horário</span>{selectedDetails.audit.at}</p>}{selectedDetails.audit.actor && <p><span>Ator/solicitante</span>{selectedDetails.audit.actor}</p>}</section>}
            {selectedDetails.secondCopySkipped && <section aria-labelledby="print-detail-second-copy"><h3 id="print-detail-second-copy">{selectedDetails.secondCopySkipped.label}</h3><p>{selectedDetails.secondCopySkipped.message}</p>{selectedDetails.secondCopySkipped.at && <p>{selectedDetails.secondCopySkipped.at}</p>}</section>}
          </div>
        </Modal>
      )}
      {canExecutePrinting && showReprint && selectedDetails && <Modal title={`Reimprimir ${selectedDetails.title}`} onClose={() => setShowReprint(false)} footer={<div className="print-queue-reprint-actions">
        <Button type="button" variant="secondary" onClick={() => setShowReprint(false)} disabled={actionPending}>Cancelar</Button>
        <Button type="button" onClick={() => void confirmReprint()} disabled={!reprintCopies || actionPending || !isOnline}>Confirmar reimpressão</Button>
      </div>}>
        <p className="print-queue-reprint-copy">Escolha a quantidade de vias para o novo trabalho.</p>
        <div className="print-queue-reprint-options" role="group" aria-label="Quantidade de vias">
          {[1, 2].map((copies) => <Button key={copies} type="button" variant={reprintCopies === copies ? 'primary' : 'secondary'} className="print-queue-reprint-option" aria-pressed={reprintCopies === copies} onClick={() => setReprintCopies(copies)} disabled={actionPending}>{copies} {copies === 1 ? 'via' : 'vias'}</Button>)}
        </div>
      </Modal>}
      {showTicket && selectedJob?.document?.type === 'order' && selectedDetails && <Modal title={`Ticket do ${selectedDetails.title}`} onClose={() => setShowTicket(false)} footer={<div className="print-queue-ticket-actions"><Button type="button" variant="secondary" onClick={() => setShowTicket(false)}>Fechar</Button></div>}>
        <OrderTicketPreview document={selectedJob.document} />
      </Modal>}
      {bulkDiscardConfirmation && <ConfirmationDialog
        title="Descartar pendências da fila?"
        message="Todos os trabalhos que podem ser encerrados com segurança serão descartados. Trabalhos em processamento ou com resultado físico incerto serão mantidos para evitar perda de confirmação."
        confirmLabel="Descartar pendências"
        cancelLabel="Cancelar"
        confirmVariant="danger"
        onClose={() => setBulkDiscardConfirmation(false)}
        onConfirm={() => void confirmBulkDiscard()}
        disabled={bulkDiscardPending || !isOnline || !canDiscardPrinting}
      />}
      {confirmation && <ConfirmationDialog
        title={confirmation === 'requestSecondCopy' ? 'Imprimir 2ª via?' : confirmation === 'skipSecondCopy' ? 'Não imprimir a 2ª via?' : confirmation === 'discard' ? 'Descartar trabalho de impressão?' : 'Imprimir mesmo assim?'}
        message={confirmation === 'requestSecondCopy' ? `A 2ª via do ${orderNumber} será enviada para a fila da cozinha.` : confirmation === 'skipSecondCopy' ? `A pendência da 2ª via do ${orderNumber} será encerrada.` : confirmation === 'discard' ? `O trabalho de impressão de ${orderNumber} será descartado.` : `${orderNumber} já foi finalizado ou cancelado. Autorizar a impressão original?`}
        confirmLabel={confirmation === 'requestSecondCopy' ? 'Imprimir 2ª via' : confirmation === 'skipSecondCopy' ? 'Não imprimir 2ª via' : confirmation === 'discard' ? 'Descartar' : 'Imprimir mesmo assim'}
        cancelLabel="Cancelar"
        confirmVariant={confirmation === 'requestSecondCopy' ? 'primary' : confirmation === 'skipSecondCopy' ? 'danger' : confirmation === 'discard' ? 'secondary' : undefined}
        onClose={() => setConfirmation(null)}
        onConfirm={() => void runAction(confirmation)}
        disabled={actionPending || !isOnline || (FORCE_ACTIONS.has(confirmation) && !canForcePrinting) || (EXECUTE_ACTIONS.has(confirmation) && !canExecutePrinting) || (DISCARD_ACTIONS.has(confirmation) && !canDiscardPrinting)}
      />}
      {unknownConfirmation === 'confirmNotPrinted' && selectedDetails?.unknownOutcome && <ConfirmationDialog
        title="Reenviar esta via?"
        message={selectedDetails.unknownOutcome.duplicateRisk}
        confirmLabel="Não foi impressa — reenviar"
        cancelLabel="Cancelar"
        confirmVariant="danger"
        onClose={() => setUnknownConfirmation(null)}
        onConfirm={() => { setUnknownConfirmation(null); void runAction('confirmNotPrinted') }}
        disabled={actionPending}
      />}
    </div>
  )
}

export default PrintQueue
