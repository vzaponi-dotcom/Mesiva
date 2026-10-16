import { createRefreshQueue } from '../../../infrastructure/realtime/refreshQueue.js'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPrintingApi } from '../infrastructure/printingApi.js'
import { createPrintExecutionTicker } from '../infrastructure/printExecutionTicker.js'
const legacyPrintingApi = createPrintingApi()
import { getOrCreateLocalPrintStationId, rememberOriginOrderId } from '../infrastructure/printingLocalPreferences.js'
import { detectPrintStationPlatform } from './printingPlatform.js'
import {
  canConsumeAutomaticPrintJob,
  canInitializeBackgroundPhysicalTransport,
  canKeepSecondCopyPromptOpen,
  canPresentSecondCopyPrompt,
  canSendPrintStationHeartbeat,
} from '../domain/printingEligibility.js'
import {
  canRunSingleRecoveryCopy,
  deriveRecoveryView,
  nextRecoveryState,
  runSingleRecoveryCopy,
} from '../domain/printRecovery.js'
import { getDefaultPrintStationName } from '../domain/stationPolicy.js'
import { getPrintingTransportKind, getRendererCompatibilityMode, isPrintingTransportSupported } from '../domain/printingEligibility.js'
import { renderEscPos58mm } from '../domain/rendering/escpos58mm.js'
import { getOrderPdfFilename, renderOrderPdf } from '../domain/rendering/pdfOrderRenderer.js'
import { createQzTransport, deriveQzOperationalState } from '../../../infrastructure/qz/qzTransport.js'
import { createPhysicalJobFailureNotifier, runExclusivePrintOperation } from './physicalOperation.js'
import { runClaimedPrintJob } from './printJobRunner.js'

export const PRINT_JOB_POLL_MS = 2_000
export const PRINT_STATE_POLL_MS = 5_000
export const STATION_HEARTBEAT_MS = 15_000

const printerError = (code, message) => Object.assign(new Error(message), { code })
const visiblePage = () => typeof document === 'undefined' || document.visibilityState === 'visible'
const browserOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false
const QZ_BLOCKING_ERROR_CODES = new Set([
  'QZ_CONNECTION_FAILED',
  'QZ_PRINTER_NOT_CONFIGURED',
  'QZ_PRINTER_NOT_FOUND',
  'QZ_PRINT_FAILED',
])

export const mergePrintJobMutation = (jobs = [], job, { prepend = false } = {}) => {
  if (!job?.id) return jobs
  const index = jobs.findIndex((candidate) => candidate?.id === job.id)
  if (index < 0) return prepend ? [job, ...jobs] : jobs
  const next = [...jobs]
  next[index] = { ...jobs[index], ...job }
  return next
}

const createBrowserCanvas = () => {
  const canvas = globalThis.document?.createElement?.('canvas')
  if (!canvas) throw new Error('Canvas is unavailable for MPT-II bitmap rendering')
  return canvas
}

const downloadOrderPdfDocument = (document, {
  render = renderOrderPdf,
  urlApi = globalThis.URL,
  documentApi = globalThis.document,
  BlobApi = globalThis.Blob,
} = {}) => {
  if (!documentApi?.createElement || !urlApi?.createObjectURL || typeof BlobApi !== 'function') {
    throw new Error('Download de PDF indisponível neste ambiente.')
  }
  const bytes = render(document)
  const blob = new BlobApi([bytes], { type: 'application/pdf' })
  const url = urlApi.createObjectURL(blob)
  const anchor = documentApi.createElement('a')
  anchor.href = url
  anchor.download = getOrderPdfFilename(document)
  anchor.style.display = 'none'
  documentApi.body?.appendChild?.(anchor)
  try {
    anchor.click()
  } finally {
    anchor.remove?.()
    urlApi.revokeObjectURL(url)
  }
  return { filename: anchor.download, bytes }
}

export const initializeBackgroundPhysicalTransport = async ({
  authenticated,
  isOnline,
  isQz,
  station,
  initializeQz,
}) => {
  if (!canInitializeBackgroundPhysicalTransport({ authenticated, isOnline, isQz, station })) return false
  await initializeQz(station.id)
  return true
}

export const claimAndExecuteSecondCopy = async ({
  isQz,
  transportReady,
  printerBlocked,
  station,
  job,
  claimJob,
  executeJob,
}) => {
  if (!canKeepSecondCopyPromptOpen({ isQz, transportReady, printerBlocked, station, job })) {
    throw printerError('PRINT_SECOND_COPY_NOT_READY', 'A segunda via não está disponível para este trabalho.')
  }
  const claimed = await claimJob(job.id, station.id)
  return executeJob(claimed.job)
}

export const buildPrintStationHeartbeatHealth = ({
  qzActive,
  transportReady,
  configuredPrinterName,
  printerHealth = {},
}) => {
  const physicalState = printerHealth.state === 'ready' ? 'ready' : (printerHealth.state || 'verifying')
  const physicalStatusText = printerHealth.statusText ?? null
  const physicalStatusCode = Number.isInteger(printerHealth.statusCode) ? printerHealth.statusCode : null
  const state = deriveQzOperationalState({
    qzConnected: qzActive,
    printerQueueConfigured: Boolean(String(configuredPrinterName || '').trim()),
    printerQueueFound: transportReady,
    physicalState,
  })
  return {
    qzReady: state.qzConnected,
    printerReady: state.operationalReady,
    physicalState,
    physicalStatusText,
    physicalStatusCode,
  }
}

export const usePrintingManager = ({ api = legacyPrintingApi, businessId, authenticated = false, accessContextId = null, isOnline = true, onPhysicalJobFailure, realtime } = {}) => {

  const platform = detectPrintStationPlatform()
  const transportKind = getPrintingTransportKind(platform)
  const supported = isPrintingTransportSupported(platform)
  const isQz = transportKind === 'qz'
  const qzTransport = useMemo(() => (isQz ? createQzTransport({
    businessId,
    getCertificate: api.getQzCertificate,
    signPayload: api.signQzPayload,
  }) : null), [businessId, api, isQz])
  const printExecutionTicker = useMemo(() => createPrintExecutionTicker({
    intervalMs: PRINT_JOB_POLL_MS,
  }), [])
  const [localStation, setLocalStation] = useState(null)
  const [stations, setStations] = useState([])
  const [jobs, setJobs] = useState([])
  const [activeJobCount, setActiveJobCount] = useState(0)
  const [printerState, setPrinterState] = useState(supported ? 'unconfigured' : 'unsupported')
  const [printerBlocked, setPrinterBlocked] = useState(false)
  const [busyJobId, setBusyJobId] = useState(null)
  const [lastError, setLastError] = useState(null)
  const [availablePrinters, setAvailablePrinters] = useState([])
  const [configuredPrinterName, setConfiguredPrinterName] = useState(null)
  const [qzConnected, setQzConnected] = useState(false)
  const [printerQueueFound, setPrinterQueueFound] = useState(false)
  const [transportReady, setTransportReady] = useState(false)
  const [printerHealth, setPrinterHealth] = useState({ state: 'verifying', ready: false, statusText: null, statusCode: null })
  const [recoveryPendingCount, setRecoveryPendingCount] = useState(0)

  const portRef = useRef(null)
  const localStationRef = useRef(null)
  const busyJobIdRef = useRef(null)
  const printerBlockedRef = useRef(false)
  const configuredPrinterNameRef = useRef(null)
  const qzConnectedRef = useRef(false)
  const printerQueueFoundRef = useRef(false)
  const transportReadyRef = useRef(false)
  const printerHealthRef = useRef({ state: 'verifying', ready: false, statusText: null, statusCode: null })
  const qzStatusMonitorRef = useRef(null)
  const qzStatusMonitorPrinterRef = useRef(null)
  const qzStatusMonitorOwnerRef = useRef(null)
  const qzAttemptByNameRef = useRef(new Map())
  const qzSecurityConfiguredRef = useRef(false)
  const qzReadinessRef = useRef(qzTransport?.readiness ?? null)
  const initializationRef = useRef(0)
  const accessContextRef = useRef(accessContextId)
  const stateContextRef = useRef(accessContextId)
  const ownsAccess = useCallback(() => accessContextRef.current === accessContextId, [accessContextId])
  const captureAccess = useCallback(() => {
    const generation = initializationRef.current
    return () => ownsAccess() && generation === initializationRef.current
  }, [ownsAccess, api, qzTransport])
  if (accessContextRef.current !== accessContextId) initializationRef.current++
  accessContextRef.current = accessContextId
  useLayoutEffect(() => {
    if (stateContextRef.current === accessContextId) return
    stateContextRef.current = accessContextId
    qzSecurityConfiguredRef.current = false
    qzReadinessRef.current?.invalidate?.()
    qzReadinessRef.current = qzTransport?.readiness ?? null
    setJobs([]); setStations([]); setActiveJobCount(0); setLastError(null)
  }, [accessContextId, api, qzTransport])
  const heartbeatInFlightRef = useRef(false)
  const heartbeatSequenceRef = useRef(0)
  const [physicalJobFailureNotifier] = useState(createPhysicalJobFailureNotifier)
  const recoveryView = deriveRecoveryView({
    recoveryState: localStation?.recoveryState,
    physicalReady: printerHealth.state === 'ready',
    safeBacklog: recoveryPendingCount,
  })
  const printOperationRef = useRef(null)
  const printOperationSequenceRef = useRef(0)

  const updateLocalStation = useCallback((station) => {
    localStationRef.current = station || null
    setLocalStation(station || null)
  }, [api, qzTransport])

  const updateBlocked = useCallback((blocked) => {
    const value = Boolean(blocked)
    printerBlockedRef.current = value
    setPrinterBlocked(value)
  }, [api, qzTransport])

  const updateBusyJob = useCallback((jobId) => {
    const value = jobId || null
    busyJobIdRef.current = value
    setBusyJobId(value)
  }, [api, qzTransport])

  const acquirePrintOperation = useCallback(({ busyKey = null } = {}) => {
    if (printOperationRef.current) return null
    const owner = {
      token: ++printOperationSequenceRef.current,
      generation: initializationRef.current,
      busyKey,
    }
    printOperationRef.current = owner
    if (busyKey) updateBusyJob(busyKey)
    return owner
  }, [updateBusyJob, api, qzTransport])

  const ownsPrintOperation = useCallback((owner) => (
    printOperationRef.current?.token === owner?.token
    && initializationRef.current === owner?.generation
  ), [])

  const releasePrintOperation = useCallback((owner) => {
    if (!ownsPrintOperation(owner)) return
    printOperationRef.current = null
    if (owner.busyKey) updateBusyJob(null)
  }, [ownsPrintOperation, updateBusyJob, api, qzTransport])

  const updateConfiguredPrinterName = useCallback((printerName) => {
    const value = String(printerName || '').trim() || null
    configuredPrinterNameRef.current = value
    setConfiguredPrinterName(value)
  }, [api, qzTransport])

  const updateQzConnected = useCallback((connected) => {
    const value = Boolean(connected)
    qzConnectedRef.current = value
    setQzConnected(value)
  }, [api, qzTransport])

  const updatePrinterQueueFound = useCallback((found) => {
    const value = Boolean(found)
    printerQueueFoundRef.current = value
    setPrinterQueueFound(value)
  }, [api, qzTransport])

  const updateTransportReady = useCallback((ready) => {
    const value = Boolean(ready)
    transportReadyRef.current = value
    setTransportReady(value)
  }, [api, qzTransport])

  const updatePrinterHealth = useCallback((health = {}) => {
    const next = {
      state: health.state || 'verifying',
      ready: health.state === 'ready',
      statusText: health.statusText ?? null,
      statusCode: Number.isInteger(health.statusCode) ? health.statusCode : null,
    }
    printerHealthRef.current = next
    setPrinterHealth(next)
    return next
  }, [api, qzTransport])

  const reportError = useCallback((error) => {
    if (!ownsAccess()) return
    setLastError(error || null)
  }, [ownsAccess, api, qzTransport])

  const notifyPhysicalJobFailure = useCallback((job, status, error) => (
    physicalJobFailureNotifier.notify({ job, status, error, onNotify: onPhysicalJobFailure })
  ), [onPhysicalJobFailure, physicalJobFailureNotifier])

  const ensureQzStatusMonitor = useCallback(async (printerName) => {
    const ownsMonitor = captureAccess()
    if (!ownsMonitor()) return null
    if (qzStatusMonitorRef.current && qzStatusMonitorPrinterRef.current === printerName && qzStatusMonitorOwnerRef.current?.()) {
      await qzStatusMonitorRef.current.refreshStatus?.()
      if (!ownsMonitor()) return null
      return qzStatusMonitorRef.current
    }
    await qzStatusMonitorRef.current?.stop?.()
    if (!ownsMonitor()) return null
    updatePrinterHealth({ state: 'verifying' })
    updateTransportReady(false)
    const monitor = qzTransport.createStatusMonitor({
      printerName,
      onPrinterStatus: (health) => {
        if (!ownsMonitor()) return
        updatePrinterHealth(health)
        updateTransportReady(health.state === 'ready')
        setPrinterState(health.state === 'ready' ? 'connected' : health.state)
      },
      onJobStatus: (event) => {
        const tracked = qzAttemptByNameRef.current.get(event.jobName)
        if (!tracked || event.statusText === 'COMPLETE') return
        void api.recordPrintAttemptEvent(tracked.id, tracked.stationId, {
          type: event.statusText,
          jobName: event.jobName,
          ...(event.jobId != null ? { spoolJobId: event.jobId } : {}),
        }).catch((error) => { if (ownsMonitor()) reportError(error) })
      },
    })
    qzStatusMonitorRef.current = monitor
    qzStatusMonitorPrinterRef.current = printerName
    qzStatusMonitorOwnerRef.current = ownsMonitor
    await monitor.start()
    return monitor
  }, [captureAccess, reportError, updatePrinterHealth, updateTransportReady, api, qzTransport])

  const configureQz = useCallback(() => {
    if (qzSecurityConfiguredRef.current || !qzTransport) return
    qzTransport.configureSecurity()
    qzTransport.onClosed(() => {
      void qzStatusMonitorRef.current?.stop?.()
      qzStatusMonitorRef.current = null
      qzStatusMonitorPrinterRef.current = null
      qzReadinessRef.current?.invalidate?.()
      updateQzConnected(false)
      updatePrinterQueueFound(false)
      updateTransportReady(false)
      updatePrinterHealth({ state: 'verifying' })
      setPrinterState('disconnected')
    })
    qzSecurityConfiguredRef.current = true
  }, [qzTransport, updatePrinterHealth, updatePrinterQueueFound, updateQzConnected, updateTransportReady, api])

  const refresh = useCallback(async ({ generation: expectedGeneration } = {}) => {
    if (!authenticated || !ownsAccess()) return { stations: [], jobs: [], stale: true }
    const readGeneration = initializationRef.current
    let state
    try {
      state = await api.getPrintState()
    } catch (error) {
      if (readGeneration !== initializationRef.current || !ownsAccess()) return { stations: [], jobs: [], summary: {}, stale: true }
      throw error
    }
    const nextStations = Array.isArray(state?.stations) ? state.stations : []
    const nextJobs = Array.isArray(state?.jobs) ? state.jobs : []
    if (readGeneration !== initializationRef.current || accessContextRef.current !== accessContextId || (expectedGeneration !== undefined && expectedGeneration !== initializationRef.current)) {
      return { stations: [], jobs: [], summary: {}, stale: true }
    }
    setStations(nextStations)
    setJobs(nextJobs)
    setActiveJobCount(Math.max(0, Number(state?.summary?.active) || 0))
    setRecoveryPendingCount(Math.max(0, Number(state?.summary?.safeBacklog) || 0))
    physicalJobFailureNotifier.synchronize(nextJobs)
    const stationId = localStationRef.current?.id
    if (stationId) {
      const serverStation = nextStations.find((station) => station.id === stationId)
      if (serverStation) updateLocalStation(serverStation)
    }
    return { stations: nextStations, jobs: nextJobs, summary: state?.summary ?? {} }
  }, [accessContextId, authenticated, ownsAccess, physicalJobFailureNotifier, updateLocalStation, api, qzTransport])

  const resolveConfiguredQzPrinter = useCallback(async (stationId) => {
    if (!isQz || !stationId) return null
    const ownsResolution = captureAccess()
    if (!ownsResolution()) return null
    configureQz()
    const savedPrinterName = qzTransport.readPrinterName(stationId)
    updateConfiguredPrinterName(savedPrinterName)
    if (!transportReadyRef.current && !savedPrinterName) setPrinterState('connecting')
    try {
      await qzTransport.connect()
      if (!ownsResolution()) return null
      const qzActive = Boolean(qzTransport?.isConnected())
      if (!savedPrinterName) {
        updateQzConnected(qzActive)
        updatePrinterQueueFound(false)
        updateTransportReady(false)
        setPrinterState('unconfigured')
        return null
      }
      const resolvedPrinter = await qzReadinessRef.current.probe(
        () => qzTransport.resolvePrinter(savedPrinterName),
      )
      if (!ownsResolution()) return null
      updateConfiguredPrinterName(resolvedPrinter)
      updatePrinterQueueFound(true)
      await ensureQzStatusMonitor(resolvedPrinter)
      if (!ownsResolution()) return null

      // For a configured station, publish the QZ connection only after printer
      // resolution and monitor startup complete. A websocket that opens briefly
      // and then fails a QZ command must not make the UI oscillate every poll.
      updateQzConnected(Boolean(qzTransport?.isConnected()))
      updateBlocked(false)
      setPrinterState(printerHealthRef.current.state === 'ready' ? 'connected' : 'verifying')
      setLastError(null)
      return resolvedPrinter
    } catch (error) {
      if (!ownsResolution()) return null
      if (error?.code === 'QZ_STALE_PROBE') return null
      updateQzConnected(Boolean(qzTransport?.isConnected()))
      updatePrinterQueueFound(false)
      updateTransportReady(false)
      setPrinterState(error?.code === 'QZ_PRINTER_NOT_FOUND' ? 'unconfigured' : 'disconnected')
      if (QZ_BLOCKING_ERROR_CODES.has(error?.code)) updateBlocked(true)
      reportError(error)
      return null
    }
  }, [captureAccess, configureQz, ensureQzStatusMonitor, isQz, reportError, updateBlocked, updateConfiguredPrinterName, updatePrinterQueueFound, updateQzConnected, updateTransportReady, api, qzTransport])

  const refreshPrinters = useCallback(async () => {
    if (!isQz) return []
    const ownsRead = captureAccess()
    if (!ownsRead()) return []
    configureQz()
    setPrinterState('connecting')
    try {
      await qzTransport.connect()
      if (!ownsRead()) return []
      updateQzConnected(Boolean(qzTransport?.isConnected()))
      const printers = await qzTransport.listPrinters()
      if (!ownsRead()) return []
      setAvailablePrinters(printers)
      const savedPrinterName = configuredPrinterNameRef.current || qzTransport.readPrinterName(localStationRef.current?.id)
      const found = Boolean(savedPrinterName && printers.includes(savedPrinterName))
      updatePrinterQueueFound(found)
      updateTransportReady(false)
      setPrinterState(savedPrinterName ? 'connected' : 'unconfigured')
      setLastError(null)
      return printers
    } catch (error) {
      if (!ownsRead()) return []
      updateQzConnected(Boolean(qzTransport?.isConnected()))
      updateTransportReady(false)
      setPrinterState('disconnected')
      if (QZ_BLOCKING_ERROR_CODES.has(error?.code)) updateBlocked(true)
      reportError(error)
      throw error
    }
  }, [captureAccess, configureQz, isQz, reportError, updateBlocked, updatePrinterQueueFound, updateQzConnected, updateTransportReady, api, qzTransport])

  const readConfiguredPrinter = useCallback(() => {
    const stationId = localStationRef.current?.id
    return stationId ? qzTransport.readPrinterName(stationId) : null
  }, [api, qzTransport])

  const selectPrinter = useCallback(async (printerName) => {
    if (!isQz) throw printerError('QZ_UNAVAILABLE', 'A seleção de fila QZ está disponível apenas no Windows.')
    const stationId = localStationRef.current?.id
    if (!stationId) throw printerError('PRINT_STATION_NOT_READY', 'A estação de impressão ainda não está pronta.')
    const requestedPrinter = String(printerName || '').trim()
    if (!requestedPrinter) throw printerError('QZ_PRINTER_NOT_CONFIGURED', 'Selecione a impressora desta estação.')

    const generation = initializationRef.current
    configureQz()
    updateTransportReady(false)
    setPrinterState('connecting')
    try {
      await qzTransport.connect()
      if (generation !== initializationRef.current) return null
      updateQzConnected(Boolean(qzTransport?.isConnected()))
      const selectedPrinter = await qzTransport.resolvePrinter(requestedPrinter)
      if (generation !== initializationRef.current) return null
      qzTransport.savePrinterName(stationId, selectedPrinter)
      updateConfiguredPrinterName(selectedPrinter)
      updatePrinterQueueFound(true)
      try {
        await ensureQzStatusMonitor(selectedPrinter)
      } catch (error) {
        if (generation !== initializationRef.current) return null
        updateTransportReady(false)
        setPrinterState('disconnected')
        reportError(error)
        return selectedPrinter
      }
      if (generation !== initializationRef.current) return null
      updateBlocked(false)
      setPrinterState(printerHealthRef.current.state === 'ready' ? 'connected' : 'verifying')
      setLastError(null)
      return selectedPrinter
    } catch (error) {
      if (generation !== initializationRef.current) throw error
      updateQzConnected(Boolean(qzTransport?.isConnected()))
      updatePrinterQueueFound(false)
      updateTransportReady(false)
      setPrinterState(error?.code === 'QZ_PRINTER_NOT_FOUND' ? 'unconfigured' : 'disconnected')
      if (QZ_BLOCKING_ERROR_CODES.has(error?.code)) updateBlocked(true)
      reportError(error)
      throw error
    }
  }, [configureQz, ensureQzStatusMonitor, isQz, reportError, updateBlocked, updateConfiguredPrinterName, updatePrinterQueueFound, updateQzConnected, updateTransportReady, api, qzTransport])

  const connectPrinter = useCallback(async () => {
    const stationId = localStationRef.current?.id
    if (!stationId) throw printerError('PRINT_STATION_NOT_READY', 'A estação de impressão ainda não está pronta.')

    if (isQz) {
      const printer = await resolveConfiguredQzPrinter(stationId)
      if (!printer) throw printerError('QZ_PRINTER_NOT_CONFIGURED', 'Selecione a impressora desta estação.')
      return null
    }

    throw printerError('PRINT_QUEUE_ONLY', 'Esta plataforma apenas cria e acompanha trabalhos na fila central. A impressão física ocorre no Windows com QZ Tray.')
  }, [isQz, resolveConfiguredQzPrinter, api, qzTransport])

  const getExplicitPort = useCallback(async () => {
    const stationId = localStationRef.current?.id
    if (!stationId) throw printerError('PRINT_STATION_NOT_READY', 'A estação de impressão ainda não está pronta.')

    if (transportKind === 'qz') {
      if (!transportReadyRef.current) await resolveConfiguredQzPrinter(stationId)
      if (!transportReadyRef.current || !configuredPrinterNameRef.current) {
        throw printerError('QZ_PRINTER_NOT_CONFIGURED', 'Selecione a impressora desta estação.')
      }
      return null
    }

    throw printerError('PRINT_QUEUE_ONLY', 'Esta plataforma apenas cria e acompanha trabalhos na fila central. A impressão física ocorre no Windows com QZ Tray.')
  }, [resolveConfiguredQzPrinter, transportKind, api, qzTransport])

  const executeClaimedJob = useCallback(async (job, port, { clearBlockOnSuccess = false, preparePort } = {}) => {
    if (!job || accessContextRef.current !== accessContextId) return null
    const executionGeneration = initializationRef.current
    const ownsExecution = () => executionGeneration === initializationRef.current && accessContextRef.current === accessContextId
    const requireExecution = () => { if (!ownsExecution()) throw printerError('QZ_OBSERVATION_LOST', 'A sessão mudou. Confira o resultado na fila de impressão.') }
    updateBusyJob(job.id)
    try {
      const result = await runClaimedPrintJob({
        job,
        stationId: localStationRef.current?.id,
        port,
        completeJob: api.completePrintJob,
        failJob: api.failPrintJob,
        renderer: (document, options) => renderEscPos58mm(document, {
          ...options,
          compatibilityMode: getRendererCompatibilityMode(transportKind),
          createCanvas: options?.createCanvas ?? createBrowserCanvas,
        }),
        transport: async (_selectedPort, bytes) => {
          if (typeof preparePort === 'function') await preparePort()
          requireExecution()
          if (transportKind === 'qz') return qzTransport.print(configuredPrinterNameRef.current, bytes)
          throw printerError('PRINT_QUEUE_ONLY', 'Esta estação não executa impressão física.')
        },
        qzAttempt: transportKind === 'qz' ? {
          createAttempt: async (jobId, stationId, copyNumber) => {
            requireExecution()
            return (await api.createPrintAttempt(jobId, stationId, copyNumber)).attempt
          },
          markSubmitting: async (attemptId, stationId) => {
            requireExecution()
            return (await api.markPrintAttemptSubmitting(attemptId, stationId)).attempt
          },
          sendBytes: async (bytes, { jobName }) => {
            if (typeof preparePort === 'function') await preparePort()
            requireExecution()
            return qzTransport.print(configuredPrinterNameRef.current, bytes, { jobName })
          },
          awaitOutcome: (jobName) => qzStatusMonitorRef.current
            ? qzStatusMonitorRef.current.awaitJobOutcome(jobName)
            : Promise.reject(printerError('QZ_OBSERVATION_LOST', 'O monitor QZ não está disponível.')),
          recordEvent: async (attemptId, stationId, event) => (await api.recordPrintAttemptEvent(attemptId, stationId, event)).attempt,
          trackAttempt: (attempt, stationId) => qzAttemptByNameRef.current.set(attempt.spoolJobName, { id: attempt.id, stationId }),
          untrackAttempt: (attempt) => qzAttemptByNameRef.current.delete(attempt.spoolJobName),
          markUnknown: async (attempt, stationId, error) => api.recordPrintAttemptEvent(attempt.id, stationId, {
            type: 'OFFLINE', jobName: attempt.spoolJobName, message: error?.message,
          }),
        } : null,
      })
      if (!ownsExecution()) return result
      if (result.status === 'printed') {
        if (transportKind === 'qz') {
          updateQzConnected(Boolean(qzTransport?.isConnected()))
          updatePrinterQueueFound(true)
        }
        setPrinterState('connected')
        setLastError(null)
        if (clearBlockOnSuccess) updateBlocked(false)
      } else {
        updateTransportReady(false)
        if (transportKind === 'qz') updateQzConnected(Boolean(qzTransport?.isConnected()))
        setPrinterState('disconnected')
        if (
          ['SERIAL_OPEN_FAILED', 'PRINTER_NOT_AUTHORIZED'].includes(result.error?.code)
          || QZ_BLOCKING_ERROR_CODES.has(result.error?.code)
        ) updateBlocked(true)
        reportError(result.error)
        notifyPhysicalJobFailure(job, result.status, result.error)
      }
      return result
    } finally {
      if (ownsExecution()) {
        updateBusyJob(null)
        try { await refresh() } catch (error) { if (ownsExecution()) reportError(error) }
      }
    }
  }, [accessContextId, notifyPhysicalJobFailure, refresh, reportError, transportKind, updateBlocked, updateBusyJob, updatePrinterQueueFound, updateQzConnected, updateTransportReady, api, qzTransport])

  const testPrint = useCallback(() => runExclusivePrintOperation({
    acquire: acquirePrintOperation,
    release: releasePrintOperation,
    operation: async () => {
      const owns = captureAccess()
      const station = localStationRef.current
      if (!station?.id) throw printerError('PRINT_STATION_NOT_READY', 'A estação de impressão ainda não está pronta.')
      const port = await getExplicitPort()
      if (!owns()) return null
      const created = await api.createTestPrintJob(station.id)
      if (!owns()) return null
      const claimed = await api.claimPrintJob(created.job.id, station.id)
      if (!owns()) return null
      return executeClaimedJob(claimed.job, port, { clearBlockOnSuccess: true })
    },
  }), [captureAccess, acquirePrintOperation, executeClaimedJob, getExplicitPort, releasePrintOperation])

  const printOrder = useCallback(async (orderId, copies) => {
    const created = await api.createManualPrintJob(orderId, copies)
    try { await refresh() } catch (error) { reportError(error) }
    return created
  }, [refresh, reportError, api, qzTransport])

  const printSecondCopy = useCallback((job) => runExclusivePrintOperation({
    acquire: acquirePrintOperation,
    release: releasePrintOperation,
    operation: async () => {
      const owns = captureAccess()
      const station = localStationRef.current
      if (!station?.id) throw printerError('PRINT_STATION_NOT_READY', 'A estação de impressão ainda não está pronta.')
      if (!job?.id) throw printerError('PRINT_JOB_NOT_FOUND', 'Trabalho de impressão não encontrado.')
      return claimAndExecuteSecondCopy({
        isQz,
        transportReady: transportReadyRef.current,
        printerBlocked: printerBlockedRef.current,
        station,
        job,
        claimJob: api.claimPrintJob,
        executeJob: (claimedJob) => !owns() ? null : executeClaimedJob(claimedJob, null, {
          clearBlockOnSuccess: true,
          preparePort: getExplicitPort,
        }),
      })
    },
  }), [captureAccess, acquirePrintOperation, executeClaimedJob, getExplicitPort, isQz, releasePrintOperation])

  const transitionRecovery = useCallback(async (action) => {
    const owns = captureAccess()
    const station = localStationRef.current
    if (!station?.id) throw printerError('PRINT_STATION_NOT_READY', 'A estação de impressão ainda não está pronta.')
    const nextState = nextRecoveryState({ recoveryState: station.recoveryState, action })
    if (nextState === (station.recoveryState ?? 'normal')) return station
    const response = await api.setPrintStationRecovery(station.id, nextState)
    if (!owns()) return null
    if (response?.station) updateLocalStation(response.station)
    return response?.station ?? station
  }, [captureAccess, updateLocalStation, api, qzTransport])

  const printNextRecovery = useCallback(() => runExclusivePrintOperation({
    acquire: acquirePrintOperation,
    release: releasePrintOperation,
    operation: async () => {
      const owns = captureAccess()
      const station = localStationRef.current
      const eligible = canRunSingleRecoveryCopy({
        recoveryState: station?.recoveryState,
        physicalReady: printerHealthRef.current.state === 'ready',
        busyJobId: busyJobIdRef.current,
      })
      if (!eligible || !station?.id) return null
      const result = await runSingleRecoveryCopy({
        recoveryState: station.recoveryState,
        physicalReady: printerHealthRef.current.state === 'ready',
        busyJobId: busyJobIdRef.current,
        claimNext: () => api.claimNextRecoveryPrintJob(station.id),
        executeJob: (job) => !owns() ? null : executeClaimedJob(job, null, {
          clearBlockOnSuccess: true,
          preparePort: getExplicitPort,
        }),
      })
      if (!owns()) return null
      if (result) {
        const refreshed = await refresh()
        if (!owns()) return null
        const recoveredJob = refreshed?.jobs?.find((job) => job.id === result.jobId) ?? null
        const current = localStationRef.current
        if (result.status === 'printed' && ['printed', 'discarded'].includes(recoveredJob?.status)
          && Number(refreshed?.summary?.safeBacklog || 0) === 0 && current?.id
          && current.recoveryState === 'deferred' && !current?.recoveryJobId) {
          const response = await api.setPrintStationRecovery(current.id, 'normal')
          if (!owns()) return null
          if (response?.station) updateLocalStation(response.station)
        }
        return { ...result, job: recoveredJob }
      }

      const current = localStationRef.current
      if (current?.id && current.recoveryState === 'active' && !current.recoveryJobId) {
        const response = await api.setPrintStationRecovery(current.id, 'normal')
        if (!owns()) return null
        if (response?.station) updateLocalStation(response.station)
      }
      await refresh()
      return null
    },
  }), [captureAccess, acquirePrintOperation, executeClaimedJob, getExplicitPort, refresh, releasePrintOperation, updateLocalStation])

  const startRecovery = useCallback(async () => {
    const owns = captureAccess()
    await transitionRecovery('start')
    if (!owns()) return null
    return printNextRecovery()
  }, [captureAccess, printNextRecovery, transitionRecovery, api, qzTransport])

  const deferRecovery = useCallback(() => transitionRecovery('defer'), [transitionRecovery])

  const resumeRecovery = useCallback(() => transitionRecovery('resume'), [transitionRecovery])

  const discardRecoveryBacklog = useCallback(async () => {
    const owns = captureAccess()
    const station = localStationRef.current
    const response = await api.discardPendingPrintJobs()
    if (!owns()) return null
    if (station?.id && (station.recoveryState ?? 'normal') !== 'normal') {
      const recovered = await api.setPrintStationRecovery(station.id, 'normal')
      if (!owns()) return null
      if (recovered?.station) updateLocalStation(recovered.station)
    }
    await refresh()
    return response
  }, [captureAccess, refresh, updateLocalStation, api, qzTransport])

  const requestDiscardPendingJobs = useCallback(async () => {
    const response = await api.discardOperationalPrintJobs('Operador')
    await refresh()
    return response
  }, [refresh, api, qzTransport])

  const confirmUnknownPrinted = useCallback((job, attempt, { refreshManager = true } = {}) => runExclusivePrintOperation({
    acquire: acquirePrintOperation,
    release: releasePrintOperation,
    operation: async () => {
      if (!job?.id) throw printerError('PRINT_JOB_NOT_FOUND', 'Trabalho de impressão não encontrado.')
      const owns = captureAccess()
      const station = localStationRef.current
      const wasRecoveryAffinity = Boolean(
        station?.id && (station.recoveryState ?? 'normal') !== 'normal' && station.recoveryJobId === job.id,
      )
      const response = await api.resolvePrintOutcome(job.id, attempt?.id ?? null, 'manual_printed')
      if (!owns()) return null
      const resolvedJob = response?.job ?? null
      let continuation = null

      if (
        resolvedJob?.status === 'pending'
        && Number(resolvedJob?.copiesPrinted || 0) < Number(resolvedJob?.copiesRequested || 0)
        && isQz && station?.id && station?.isPrimary && station?.platform === 'windows'
      ) {
        await getExplicitPort()
        if (!owns()) return null
        const claimed = await api.claimPrintJob(resolvedJob.id, station.id)
        if (!owns()) return null
        continuation = await executeClaimedJob(claimed.job, null, {
          clearBlockOnSuccess: true,
          preparePort: getExplicitPort,
        })
        if (!owns()) return continuation
      }

      const refreshed = refreshManager ? await refresh() : null
      if (!owns()) return null
      const current = localStationRef.current
      const finalJob = refreshed?.jobs?.find((candidate) => candidate?.id === job.id) ?? response?.job ?? null

      if (
        wasRecoveryAffinity
        && (['printed', 'discarded'].includes(finalJob?.status) || continuation?.status === 'printed')
        && Number(refreshed?.summary?.safeBacklog || 0) === 0
        && current?.id
        && current.recoveryState === 'deferred'
        && !current.recoveryJobId
      ) {
        const recovered = await api.setPrintStationRecovery(current.id, 'normal')
        if (!owns()) return null
        if (recovered?.station) updateLocalStation(recovered.station)
      }

      return continuation ? { ...response, continuation } : response
    },
  }), [
    acquirePrintOperation, api, captureAccess, executeClaimedJob, getExplicitPort, isQz,
    refresh, releasePrintOperation, updateLocalStation,
  ])

  const confirmUnknownNotPrinted = useCallback(async (job, attempt, { refreshManager = true } = {}) => {
    if (!job?.id) throw printerError('PRINT_JOB_NOT_FOUND', 'Trabalho de impressão não encontrado.')
    const station = localStationRef.current
    const wasRecoveryAffinity = Boolean(
      station?.id && (station.recoveryState ?? 'normal') !== 'normal' && station.recoveryJobId === job.id,
    )
    const response = await api.resolvePrintOutcome(job.id, attempt?.id ?? null, 'manual_not_printed')
    const refreshed = refreshManager ? await refresh() : null
    const current = localStationRef.current
    if (
      wasRecoveryAffinity
      && refreshed
      && current?.id
      && current.recoveryState === 'deferred'
      && current.recoveryJobId === job.id
    ) {
      try {
        await getExplicitPort()
      } catch {
        return response
      }
      if (printerHealthRef.current.state !== 'ready' || !transportReadyRef.current) return response

      await transitionRecovery('resume')
      const continued = await printNextRecovery()
      if (!continued && localStationRef.current?.recoveryState === 'active') {
        await transitionRecovery('defer')
      }
      return continued ?? response
    }
    return response
  }, [api, getExplicitPort, printNextRecovery, refresh, transitionRecovery])

  const acknowledgeSecondCopyPrompt = useCallback(async (job) => {
    const station = localStationRef.current
    if (!station?.id || !canPresentSecondCopyPrompt({
      isQz,
      transportReady: transportReadyRef.current,
      printerBlocked: printerBlockedRef.current,
      station,
      job,
    })) return { promptPresented: false }
    return api.acknowledgeSecondCopyPrompt(job.id, station.id)
  }, [isQz, api, qzTransport])

  const retryJob = useCallback((jobOrId) => runExclusivePrintOperation({
    acquire: acquirePrintOperation,
    release: releasePrintOperation,
    operation: async () => {
      const owns = captureAccess()
      const station = localStationRef.current
      if (!station?.id) throw printerError('PRINT_STATION_NOT_READY', 'A estação de impressão ainda não está pronta.')
      const jobId = typeof jobOrId === 'string' ? jobOrId : jobOrId?.id
      if (!jobId) throw printerError('PRINT_JOB_NOT_FOUND', 'Trabalho de impressão não encontrado.')
      const port = await getExplicitPort()
      if (!owns()) return null
      const reset = await api.retryPrintJob(jobId, station.id)
      if (!owns()) return null
      const claimed = await api.claimPrintJob(reset.job.id, station.id)
      if (!owns()) return null
      return executeClaimedJob(claimed.job, port, { clearBlockOnSuccess: true })
    },
  }), [captureAccess, acquirePrintOperation, executeClaimedJob, getExplicitPort, releasePrintOperation])

  const applyJobMutation = useCallback((response, options) => {
    if (accessContextRef.current !== accessContextId) return null
    if (response?.job) setJobs((current) => mergePrintJobMutation(current, response.job, options))
    return response
  }, [accessContextId, api, qzTransport])

  const requestPrintNow = useCallback(async (jobOrId, { refreshManager = true } = {}) => {
    const jobId = typeof jobOrId === 'string' ? jobOrId : jobOrId?.id
    if (!jobId) throw printerError('PRINT_JOB_NOT_FOUND', 'Trabalho de impressão não encontrado.')
    const response = applyJobMutation(await api.prioritizePrintJob(jobId))
    if (refreshManager) await refresh()
    return response
  }, [applyJobMutation, refresh, api, qzTransport])

  const requestRetry = useCallback(async (jobOrId, { refreshManager = true } = {}) => {
    const jobId = typeof jobOrId === 'string' ? jobOrId : jobOrId?.id
    if (!jobId) throw printerError('PRINT_JOB_NOT_FOUND', 'Trabalho de impressão não encontrado.')
    const response = applyJobMutation(await api.retryPrintJob(jobId))
    if (refreshManager) await refresh()
    return response
  }, [applyJobMutation, refresh, api, qzTransport])

  const requestDiscard = useCallback(async (jobOrId, { refreshManager = true } = {}) => {
    const jobId = typeof jobOrId === 'string' ? jobOrId : jobOrId?.id
    if (!jobId) throw printerError('PRINT_JOB_NOT_FOUND', 'Trabalho de impressão não encontrado.')
    const response = applyJobMutation(await api.discardPrintJob(jobId))
    if (refreshManager) await refresh()
    return response
  }, [applyJobMutation, refresh, api, qzTransport])

  const requestSecondCopy = useCallback(async (jobOrId, { refreshManager = true } = {}) => {
    const jobId = typeof jobOrId === 'string' ? jobOrId : jobOrId?.id
    if (!jobId) throw printerError('PRINT_JOB_NOT_FOUND', 'Trabalho de impressão não encontrado.')
    const response = applyJobMutation(await api.requestSecondCopy(jobId))
    if (refreshManager) await refresh()
    return response
  }, [applyJobMutation, refresh, api, qzTransport])

  const skipSecondCopy = useCallback(async (jobOrId, { refreshManager = true } = {}) => {
    const jobId = typeof jobOrId === 'string' ? jobOrId : jobOrId?.id
    if (!jobId) throw printerError('PRINT_JOB_NOT_FOUND', 'Trabalho de impressão não encontrado.')
    const response = applyJobMutation(await api.skipSecondCopy(jobId))
    if (refreshManager) await refresh()
    return response
  }, [applyJobMutation, refresh, api, qzTransport])

  const requestForcePrint = useCallback(async (jobOrId, { refreshManager = true } = {}) => {
    const jobId = typeof jobOrId === 'string' ? jobOrId : jobOrId?.id
    if (!jobId) throw printerError('PRINT_JOB_NOT_FOUND', 'Trabalho de impressão não encontrado.')
    const response = applyJobMutation(await api.forcePrintJob(jobId))
    if (refreshManager) await refresh()
    return response
  }, [applyJobMutation, refresh, api, qzTransport])

  const requestReprint = useCallback(async (jobOrId, copies, { refreshManager = true } = {}) => {
    const jobId = typeof jobOrId === 'string' ? jobOrId : jobOrId?.id
    if (!jobId) throw printerError('PRINT_JOB_NOT_FOUND', 'Trabalho de impressão não encontrado.')
    try {
      const response = await api.reprintPrintJob(jobId, copies)
      return applyJobMutation(response, { prepend: true })
    } finally {
      if (refreshManager) await refresh()
    }
  }, [applyJobMutation, refresh, api, qzTransport])

  const getPreviewDocument = useCallback(async (orderId) => {
    const response = await api.getOrderPrintDocument(orderId)
    return response.document
  }, [api, qzTransport])

  const downloadOrderPdf = useCallback((document) => downloadOrderPdfDocument(document), [])

  const getTableTabPreviewDocument = useCallback(async (tableTabId) => {
    const response = await api.getTableTabPrintDocument(tableTabId)
    return response.document
  }, [api, qzTransport])

  const printTableTab = useCallback((tableTabId, copies) => api.createManualTableTabPrintJob(tableTabId, copies), [api])

  useEffect(() => {
    if (!authenticated) {
      initializationRef.current += 1
      printOperationRef.current = null
      void qzStatusMonitorRef.current?.stop?.()
      qzStatusMonitorRef.current = null
      qzStatusMonitorPrinterRef.current = null
      qzAttemptByNameRef.current.clear()
      updateLocalStation(null)
      setStations([])
      setJobs([])
      setActiveJobCount(0)
      setAvailablePrinters([])
      portRef.current = null
      updateConfiguredPrinterName(null)
      updateQzConnected(false)
      updatePrinterQueueFound(false)
      updateTransportReady(false)
      updatePrinterHealth({ state: 'verifying' })
      setRecoveryPendingCount(0)
      updateBusyJob(null)
      updateBlocked(false)
      setPrinterState(supported ? 'unconfigured' : 'unsupported')
      return undefined
    }

    let cancelled = false
    const generation = ++initializationRef.current
    const initialize = async () => {
      try {
        const stationId = getOrCreateLocalPrintStationId(undefined, undefined, businessId)
        const stationPayload = await api.getPrintStations()
        if (cancelled || generation !== initializationRef.current) return
        const existingStations = Array.isArray(stationPayload?.stations) ? stationPayload.stations : []
        let station = existingStations.find((candidate) => candidate.id === stationId)
        if (!station) {
          const response = await api.upsertPrintStation(stationId, {
            name: getDefaultPrintStationName(platform),
            platform,
            autoPrintEnabled: false,
            defaultCopies: 2,
          })
          station = response.station
        }
        if (cancelled || generation !== initializationRef.current) return
        updateLocalStation(station)
        await refresh()
        if (cancelled || generation !== initializationRef.current) return
        await initializeBackgroundPhysicalTransport({
          authenticated,
          isOnline,
          isQz,
          station: localStationRef.current || station,
          initializeQz: resolveConfiguredQzPrinter,
        })
      } catch (error) {
        if (!cancelled && generation === initializationRef.current) reportError(error)
      }
    }
    void initialize()
    return () => { cancelled = true }
  }, [authenticated, isOnline, isQz, platform, refresh, reportError, resolveConfiguredQzPrinter, supported, updateBlocked, updateBusyJob, updateConfiguredPrinterName, updateLocalStation, updatePrinterHealth, updatePrinterQueueFound, updateQzConnected, updateTransportReady, api, qzTransport])

  const subscribeRealtime=realtime?.subscribeInvalidations
  const primaryQzExecutor=isQz && Boolean(localStation?.isPrimary)
  useEffect(() => {
    if (!authenticated || !isOnline) return undefined
    const ownsPoll=captureAccess()
    const queue=createRefreshQueue({run:()=>refresh(),isCurrent:ownsPoll,onError:reportError})
    const sync=()=>{if(ownsPoll() && (visiblePage() || primaryQzExecutor))return queue.refresh()}
    const unsubscribe=subscribeRealtime?.(event=>{if(event.topics.includes('printing'))return sync()})
    // The state read ages jobs for timeout/recovery. Keep a timed owner even
    // with a healthy channel; the primary QZ station also checks while hidden.
    const intervalMs=subscribeRealtime && !primaryQzExecutor?30_000:PRINT_STATE_POLL_MS
    const timer=globalThis.setInterval?.(sync,intervalMs)
    const handleVisibility=()=>{if(visiblePage())void sync()}
    const handleFocus=()=>{void sync()}
    document?.addEventListener?.('visibilitychange',handleVisibility)
    globalThis.addEventListener?.('focus',handleFocus)
    return()=>{queue.stop();unsubscribe?.();if(timer)globalThis.clearInterval?.(timer)
      document?.removeEventListener?.('visibilitychange',handleVisibility)
      globalThis.removeEventListener?.('focus',handleFocus)}
  },[authenticated,captureAccess,isOnline,primaryQzExecutor,refresh,reportError,subscribeRealtime])

  useEffect(() => {
    if (!authenticated || !isOnline || !supported || !isQz) return undefined
    let cancelled = false
    let tickInFlight = false
    let lastPhysicalProbeAt = 0
    let lastHeartbeatAt = 0

    const ownsTick = captureAccess()

    const revalidatePhysicalTransport = async () => {
      if (!ownsTick() || busyJobIdRef.current) return false
      const station = localStationRef.current
      if (!station?.id || !qzTransport.readPrinterName(station.id)) return false
      try {
        await initializeBackgroundPhysicalTransport({
          authenticated,
          isOnline,
          isQz,
          station,
          initializeQz: resolveConfiguredQzPrinter,
        })
      } catch (error) {
        if (ownsTick()) reportError(error)
      }
      return true
    }

    const heartbeat = async () => {
      const station = localStationRef.current
      const eligible = canSendPrintStationHeartbeat({
        authenticated,
        isOnline,
        browserOnline: browserOnline(),
        isQz,
        station,
      })
      if (!station || !eligible || heartbeatInFlightRef.current || !ownsTick()) return false

      heartbeatInFlightRef.current = true
      const sequence = ++heartbeatSequenceRef.current
      const health = buildPrintStationHeartbeatHealth({
        qzActive: qzConnectedRef.current,
        transportReady: transportReadyRef.current,
        configuredPrinterName: configuredPrinterNameRef.current,
        printerHealth: printerHealthRef.current,
      })
      try {
        const response = await api.heartbeatPrintStation(station.id, health)
        if (!cancelled && ownsTick() && sequence === heartbeatSequenceRef.current && response?.station) {
          updateLocalStation(response.station)
        }
      } catch (error) {
        if (!cancelled && ownsTick() && sequence === heartbeatSequenceRef.current) reportError(error)
      } finally {
        if (sequence === heartbeatSequenceRef.current) heartbeatInFlightRef.current = false
      }
      return true
    }

    const consumeNext = async () => {
      const station = localStationRef.current
      if (!canConsumeAutomaticPrintJob({
        authenticated,
        isOnline,
        supported,
        browserOnline: browserOnline(),
        busyJobId: busyJobIdRef.current,
        printerBlocked: printerBlockedRef.current,
        transportReady: transportReadyRef.current,
        qzConnected: qzConnectedRef.current,
        physicalReady: printerHealthRef.current.state === 'ready',
        isQz,
        allowManual: true,
        station,
      })) return

      const owner = acquirePrintOperation()
      if (!owner) return
      try {
        const response = await api.claimNextPrintJob(station.id)
        if (!ownsPrintOperation(owner)) return
        if (!response?.job) return
        await executeClaimedJob(response.job, null)
      } catch (error) {
        if (!ownsPrintOperation(owner)) return
        if (QZ_BLOCKING_ERROR_CODES.has(error?.code)) updateBlocked(true)
        updateTransportReady(false)
        reportError(error)
        try { await refresh() } catch { /* next execution tick will recover */ }
      } finally {
        releasePrintOperation(owner)
      }
    }

    const tick = async () => {
      if (cancelled || tickInFlight || !ownsTick()) return
      tickInFlight = true
      try {
        const now = Date.now()
        if (now - lastPhysicalProbeAt >= PRINT_STATE_POLL_MS) {
          if (await revalidatePhysicalTransport()) lastPhysicalProbeAt = Date.now()
        }
        if (now - lastHeartbeatAt >= STATION_HEARTBEAT_MS) {
          if (await heartbeat()) lastHeartbeatAt = Date.now()
        }
        await consumeNext()
      } finally {
        tickInFlight = false
      }
    }

    void tick()
    const stopTicker = printExecutionTicker.start(() => { void tick() })
    return () => {
      cancelled = true
      heartbeatSequenceRef.current += 1
      heartbeatInFlightRef.current = false
      stopTicker()
    }
  }, [
    acquirePrintOperation, api, authenticated, captureAccess, executeClaimedJob, isOnline, isQz,
    ownsPrintOperation, printExecutionTicker, qzTransport, refresh, releasePrintOperation, reportError,
    resolveConfiguredQzPrinter, supported, updateBlocked, updateLocalStation, updateTransportReady,
  ])

  const latestJobByOrderId = useMemo(() => {
    const latest = new Map()
    for (const job of jobs) {
      if (job?.orderId && !latest.has(job.orderId)) latest.set(job.orderId, job)
    }
    return latest
  }, [jobs, api, qzTransport])

  const rememberOriginOrder = useCallback((orderId) => rememberOriginOrderId(orderId, undefined, businessId), [businessId])

  return {
    supported,
    transportKind,
    localStation,
    stations,
    jobs: stateContextRef.current === accessContextId ? jobs : [],
    activeJobCount: stateContextRef.current === accessContextId ? activeJobCount : 0,
    latestJobByOrderId: stateContextRef.current === accessContextId ? latestJobByOrderId : new Map(),
    printerState,
    printerBlocked,
    busyJobId,
    lastError,
    availablePrinters,
    configuredPrinterName,
    qzConnected,
    printerQueueFound,
    transportReady,
    printerHealth,
    recoveryState: recoveryView.recoveryState,
    recoveryPendingCount: recoveryView.recoveryPendingCount,
    recoveryPromptEligible: recoveryView.recoveryPromptEligible,
    refresh,
    refreshPrinters,
    readConfiguredPrinter,
    selectPrinter,
    connectPrinter,
    testPrint,
    printOrder,
    printSecondCopy,
    startRecovery,
    deferRecovery,
    resumeRecovery,
    printNextRecovery,
    discardRecoveryBacklog,
    requestDiscardPendingJobs,
    confirmUnknownPrinted,
    confirmUnknownNotPrinted,
    acknowledgeSecondCopyPrompt,
    retryJob,
    requestPrintNow,
    requestRetry,
    requestDiscard,
    requestSecondCopy,
    skipSecondCopy,
    requestForcePrint,
    requestReprint,
    getPreviewDocument,
    downloadOrderPdf,
    getTableTabPreviewDocument,
    printTableTab,
    rememberOriginOrder,
  }
}
