import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import React from 'react'
import { act } from 'react-test-renderer'
import qz from 'qz-tray'
import { workspaceHarness } from '../../../test-support/renderWorkspace.js'
import {
  canExecuteSecondCopy,
  canInitializeBackgroundPhysicalTransport,
  canKeepSecondCopyPromptOpen,
  canPresentSecondCopyPrompt,
  canConsumeAutomaticPrintJob,
  getPrintingTransportKind,
  getRendererCompatibilityMode,
  isPrintingTransportSupported,
} from '../domain/printingEligibility.js'
import {
  claimAndExecuteSecondCopy,
  initializeBackgroundPhysicalTransport,
  usePrintingManager,
} from './usePrintingManager.js'
import { createPhysicalJobFailureNotifier, runExclusivePrintOperation } from './physicalOperation.js'
import { runClaimedPrintJob } from './printJobRunner.js'

const managerSource = await readFile(new URL('./usePrintingManager.js', import.meta.url), 'utf8')
const managerModule = await import('./usePrintingManager.js')

test('table-tab printing uses the API captured by the current context after login or company selection', async t => {
  const h = await workspaceHarness(t, { userAgent: 'Android' }), calls = []
  const apiA = { createManualTableTabPrintJob: async (...args) => { calls.push(['A', ...args]); return { job: { id: 'A' } } } }
  const apiB = { createManualTableTabPrintJob: async (...args) => { calls.push(['B', ...args]); return { job: { id: 'B' } } } }
  function Probe({ api }) { return React.createElement('printing-probe', { value: usePrintingManager({ authenticated: false, api }) }) }
  const renderer = await h.render(Probe, { api: apiA })
  await act(async () => renderer.update(React.createElement(Probe, { api: apiB })))
  assert.deepEqual(await renderer.root.findByType('printing-probe').props.value.printTableTab('tab-B', 2), { job: { id: 'B' } })
  assert.deepEqual(calls, [['B', 'tab-B', 2]])
})

const awaitingSecondCopyJob = {
  id: 'job-second-copy',
  status: 'awaiting_second_copy',
  copiesRequested: 2,
  copiesPrinted: 1,
}

const flushMicrotasks = async () => {
  for (let index = 0; index < 20; index += 1) await Promise.resolve()
}

const tableTabDocument = () => ({
  type: 'table-tab',
  business: { name: 'Restaurante' },
  tableTab: { id: 'tab-42', number: 42, tableName: 'Mesa 7' },
  items: [{ name: 'X-Bacon', presentation: '', note: '', quantity: 1, lineTotalCents: 2500 }],
  financial: { totalCents: 2500 },
  message: 'PR\u00c9-CONTA \u2014 N\u00c3O \u00c9 COMPROVANTE DE PAGAMENTO',
})

const readyAutomaticConsumer = (overrides = {}) => ({
  authenticated: true,
  isOnline: true,
  supported: true,
  visible: true,
  browserOnline: true,
  busyJobId: null,
  printerBlocked: false,
  transportReady: true,
  station: { isPrimary: true, autoPrintEnabled: true },
  ...overrides,
})

test('only Windows uses a physical QZ transport; Android and other platforms are queue-only', () => {
  assert.equal(getPrintingTransportKind('windows'), 'qz')
  assert.equal(getPrintingTransportKind('android'), 'queue-only')
  assert.equal(getPrintingTransportKind('other'), 'queue-only')
  assert.equal(getRendererCompatibilityMode('qz'), 'mpt2-bitmap')
  assert.equal(getRendererCompatibilityMode('queue-only'), null)
  assert.equal(getRendererCompatibilityMode('queue-only'), null)

  assert.equal(isPrintingTransportSupported('windows', undefined), true)
  assert.equal(isPrintingTransportSupported('android', undefined), false)
  assert.equal(isPrintingTransportSupported('other', undefined), false)
  assert.equal(isPrintingTransportSupported('other', { requestPort() {}, getPorts() {} }), false)
})

test('automatic consumer does not claim while QZ or another local transport is not ready', () => {
  assert.equal(canConsumeAutomaticPrintJob(readyAutomaticConsumer({ transportReady: false })), false)
  assert.equal(canConsumeAutomaticPrintJob(readyAutomaticConsumer({ qzConnected: false })), false)
  assert.equal(canConsumeAutomaticPrintJob(readyAutomaticConsumer()), true)
})

test('background primary keeps critical print work on the dedicated execution ticker', () => {
  assert.equal(canConsumeAutomaticPrintJob(readyAutomaticConsumer({ visible: false })), true)
  assert.match(managerSource, /createPrintExecutionTicker/)
  assert.match(managerSource, /printExecutionTicker\.start/)

  const effectStart = managerSource.indexOf('let lastPhysicalProbeAt = 0')
  const effectEnd = managerSource.indexOf('const latestJobByOrderId', effectStart)
  assert.ok(effectStart >= 0 && effectEnd > effectStart)
  const executionBlock = managerSource.slice(effectStart, effectEnd)
  assert.match(executionBlock, /initializeBackgroundPhysicalTransport/)
  assert.match(executionBlock, /heartbeatPrintStation/)
  assert.match(executionBlock, /claimNextPrintJob/)
  assert.match(executionBlock, /STATION_HEARTBEAT_MS/)
  assert.match(executionBlock, /PRINT_STATE_POLL_MS/)
  assert.doesNotMatch(executionBlock, /setInterval/)
  assert.doesNotMatch(executionBlock, /visiblePage\(\)/)
})

test('an existing QZ status monitor is actively refreshed before it is reused', () => {
  const start = managerSource.indexOf('const ensureQzStatusMonitor = useCallback')
  const end = managerSource.indexOf('const configureQz = useCallback', start)
  assert.ok(start >= 0 && end > start)
  const block = managerSource.slice(start, end)
  assert.match(block, /qzStatusMonitorRef\.current\.refreshStatus\?\.\(\)/)
  assert.ok(
    block.indexOf('refreshStatus?.()') < block.indexOf('return qzStatusMonitorRef.current'),
    'the current physical state must be rechecked before reusing the monitor',
  )
})

test('a non-normal recovery state pauses the normal consumer while the manager uses the dedicated one-copy recovery APIs', () => {
  assert.equal(canConsumeAutomaticPrintJob(readyAutomaticConsumer({ station: { isPrimary: true, autoPrintEnabled: true, recoveryState: 'pending' } })), false)
  assert.equal(canConsumeAutomaticPrintJob(readyAutomaticConsumer({ station: { isPrimary: true, autoPrintEnabled: true, recoveryState: 'active' } })), false)
  assert.equal(canConsumeAutomaticPrintJob(readyAutomaticConsumer({ station: { isPrimary: true, autoPrintEnabled: true, recoveryState: 'deferred' } })), false)
  assert.match(managerSource, /claimNextRecoveryPrintJob/)
  assert.match(managerSource, /setPrintStationRecovery/)
  assert.match(managerSource, /discardPendingPrintJobs/)
  assert.match(managerSource, /resolvePrintOutcome/)
  assert.match(managerSource, /startRecovery/)
  assert.match(managerSource, /printNextRecovery/)
  assert.match(managerSource, /\['printed', 'discarded'\]\.includes\(recoveredJob\?\.status\)/)
  assert.match(managerSource, /!current\?\.recoveryJobId/)
})

test('manager installs spooler monitoring before QZ jobs and routes QZ execution through persisted attempts', () => {
  assert.match(managerSource, /qzTransport\.createStatusMonitor/)
  assert.match(managerSource, /executeQzPrintAttempt|qzAttempt/)
  assert.match(managerSource, /createPrintAttempt/)
  assert.match(managerSource, /markPrintAttemptSubmitting/)
  assert.match(managerSource, /recordPrintAttemptEvent/)
  assert.match(managerSource, /onJobStatus/)
  assert.match(managerSource, /qzAttemptByNameRef/)
  assert.match(managerSource, /physicalReady: printerHealthRef\.current\.state === 'ready'/)
  assert.match(managerSource, /station\?\.recoveryState/)
})

test('unknown-outcome confirmation tolerates a stale UI attempt and continues a remaining copy automatically', () => {
  const start = managerSource.indexOf('const confirmUnknownPrinted = useCallback')
  const end = managerSource.indexOf('const confirmUnknownNotPrinted = useCallback', start)
  assert.ok(start >= 0 && end > start)
  const block = managerSource.slice(start, end)
  assert.doesNotMatch(block, /!attempt\?\.id/)
  assert.match(block, /resolvePrintOutcome\(job\.id, attempt\?\.id \?\? null, 'manual_printed'\)/)
  assert.match(block, /resolvedJob\?\.status === 'pending'/)
  assert.match(block, /claimPrintJob\(resolvedJob\.id, station\.id\)/)
  assert.match(block, /executeClaimedJob\(claimed\.job/)
})

test('manual not-printed recovery never strands the station active when physical readiness is not restored yet', () => {
  const start = managerSource.indexOf('const confirmUnknownNotPrinted = useCallback')
  const end = managerSource.indexOf('const acknowledgeSecondCopyPrompt = useCallback', start)
  assert.ok(start >= 0 && end > start)
  const block = managerSource.slice(start, end)
  assert.match(block, /getExplicitPort/)
  assert.match(block, /printerHealthRef\.current\.state !== 'ready'/)
  assert.match(block, /transitionRecovery\('resume'\)/)
  assert.match(block, /printNextRecovery\(\)/)
  assert.match(block, /if \(!continued[\s\S]*transitionRecovery\('defer'\)/)
  assert.ok(
    block.indexOf('getExplicitPort') < block.indexOf("transitionRecovery('resume')"),
    'physical transport must be revalidated before recovery becomes active',
  )
})

test('one shared operation gate rejects overlapping physical workflows and releases after completion', async () => {
  assert.equal(typeof runExclusivePrintOperation, 'function')
  let activeOwner = null
  let releaseFirst
  const firstPending = new Promise((resolve) => { releaseFirst = resolve })
  const acquire = () => {
    if (activeOwner) return null
    activeOwner = { id: 1 }
    return activeOwner
  }
  const release = (owner) => {
    if (activeOwner === owner) activeOwner = null
  }

  const first = runExclusivePrintOperation({ acquire, release, operation: () => firstPending })
  await assert.rejects(
    () => runExclusivePrintOperation({ acquire, release, operation: async () => 'overlap' }),
    (error) => error.code === 'PRINT_OPERATION_BUSY',
  )
  releaseFirst('first')
  assert.equal(await first, 'first')
  assert.equal(await runExclusivePrintOperation({ acquire, release, operation: async () => 'next' }), 'next')
})

test('every manual physical workflow acquires the shared operation gate before claiming', () => {
  for (const [startMarker, endMarker] of [
    ['const testPrint = useCallback', 'const printOrder = useCallback'],
    ['const printSecondCopy = useCallback', 'const transitionRecovery = useCallback'],
    ['const printNextRecovery = useCallback', 'const startRecovery = useCallback'],
    ['const retryJob = useCallback', 'const requestPrintNow = useCallback'],
  ]) {
    const start = managerSource.indexOf(startMarker)
    const end = managerSource.indexOf(endMarker, start)
    assert.notEqual(start, -1)
    assert.notEqual(end, -1)
    assert.match(managerSource.slice(start, end), /runExclusivePrintOperation/)
  }
})

test('transport support alone cannot bypass station and local-readiness guards', () => {
  assert.equal(canConsumeAutomaticPrintJob(readyAutomaticConsumer({
    supported: true,
    transportReady: false,
    station: { isPrimary: true, autoPrintEnabled: true },
  })), false)
  assert.equal(canConsumeAutomaticPrintJob(readyAutomaticConsumer({
    transportReady: true,
    station: { isPrimary: false, autoPrintEnabled: true },
  })), false)
  assert.equal(canConsumeAutomaticPrintJob(readyAutomaticConsumer({
    transportReady: true,
    station: { isPrimary: true, autoPrintEnabled: false },
  })), false)
})

test('QZ close invalidates readiness and heartbeat responses cannot overwrite newer state', () => {
  assert.match(managerSource, /qzTransport\.onClosed/)
  assert.match(managerSource, /qzReadinessRef\.current\?\.invalidate\?\.\(\)/)
  assert.match(managerSource, /const heartbeatSequenceRef = useRef\(0\)/)
  assert.match(managerSource, /heartbeatInFlightRef\.current/)
  assert.match(managerSource, /sequence === heartbeatSequenceRef\.current/)
})

test('the primary QZ station can execute an awaiting second copy', () => {
  assert.equal(canExecuteSecondCopy({
    isQz: true,
    station: { isPrimary: true, platform: 'windows' },
    job: awaitingSecondCopyJob,
  }), true)
})

test('non-QZ and secondary stations cannot execute an awaiting second copy', () => {
  assert.equal(canExecuteSecondCopy({
    isQz: false,
    station: { isPrimary: true, platform: 'android' },
    job: awaitingSecondCopyJob,
  }), false)
  assert.equal(canExecuteSecondCopy({
    isQz: true,
    station: { isPrimary: false, platform: 'windows' },
    job: awaitingSecondCopyJob,
  }), false)
})

test('only an unacknowledged awaiting copy can present the second-copy prompt on primary QZ', () => {
  const primaryQz = { isQz: true, transportReady: true, printerBlocked: false, station: { isPrimary: true, platform: 'windows' } }

  assert.equal(canPresentSecondCopyPrompt({ ...primaryQz, job: awaitingSecondCopyJob }), true)
  assert.equal(canPresentSecondCopyPrompt({
    ...primaryQz,
    job: { ...awaitingSecondCopyJob, secondCopyPromptedAt: '2026-09-08T12:00:00.000Z' },
  }), false)
  assert.equal(canPresentSecondCopyPrompt({
    isQz: true,
    transportReady: true,
    printerBlocked: false,
    station: { isPrimary: false, platform: 'windows' },
    job: awaitingSecondCopyJob,
  }), false)
})

test('deferred recovery presents only its durable affinity job again after reload', () => {
  const job = { ...awaitingSecondCopyJob, secondCopyPromptedAt: '2026-09-10T12:00:00.000Z' }
  const station = {
    id: 'kitchen-primary', isPrimary: true, platform: 'windows',
    recoveryState: 'deferred', recoveryJobId: job.id,
  }
  const input = { isQz: true, transportReady: true, printerBlocked: false, station }

  assert.equal(canPresentSecondCopyPrompt({ ...input, job }), true)
  assert.equal(canKeepSecondCopyPromptOpen({ ...input, job }), true)
  assert.equal(canPresentSecondCopyPrompt({ ...input, job: { ...job, id: 'other-job' } }), false)
})

test('deferred recovery executes copy two by explicitly reclaiming the same affinity job', async () => {
  const sequence = []
  const job = { ...awaitingSecondCopyJob }
  const station = {
    id: 'kitchen-primary', isPrimary: true, platform: 'windows',
    recoveryState: 'deferred', recoveryJobId: job.id,
  }

  const result = await claimAndExecuteSecondCopy({
    isQz: true,
    transportReady: true,
    printerBlocked: false,
    station,
    job,
    claimJob: async (jobId, stationId) => {
      sequence.push(`claim:${jobId}:${stationId}`)
      return { job: { ...job, status: 'processing' } }
    },
    executeJob: async (claimedJob) => {
      sequence.push(`execute:${claimedJob.id}:${claimedJob.copiesPrinted + 1}`)
      return { status: 'printed' }
    },
  })

  assert.equal(result.status, 'printed')
  assert.deepEqual(sequence, [
    'claim:job-second-copy:kitchen-primary',
    'execute:job-second-copy:2',
  ])
})

test('an unready or blocked primary QZ station cannot present the physical second-copy prompt', () => {
  const station = { isPrimary: true, platform: 'windows' }

  assert.equal(canPresentSecondCopyPrompt({
    isQz: true,
    transportReady: false,
    printerBlocked: false,
    station,
    job: awaitingSecondCopyJob,
  }), false)
  assert.equal(canPresentSecondCopyPrompt({
    isQz: true,
    transportReady: true,
    printerBlocked: true,
    station,
    job: awaitingSecondCopyJob,
  }), false)
})

test('offline kitchens and requester stations never initialize a background transport or become automatic consumers', async () => {
  const calls = []
  const initializeQz = async () => { calls.push('qz') }
  const primary = { id: 'kitchen-primary', isPrimary: true, platform: 'windows', autoPrintEnabled: true }
  const secondary = { id: 'requester-secondary', isPrimary: false, platform: 'windows', autoPrintEnabled: true }

  assert.equal(canInitializeBackgroundPhysicalTransport({ authenticated: true, isOnline: false, isQz: true, station: primary }), false)
  assert.equal(await initializeBackgroundPhysicalTransport({ authenticated: true, isOnline: false, isQz: true, station: primary, initializeQz }), false)
  assert.equal(await initializeBackgroundPhysicalTransport({ authenticated: true, isOnline: true, isQz: true, station: secondary, initializeQz }), false)
  assert.equal(await initializeBackgroundPhysicalTransport({ authenticated: true, isOnline: true, isQz: false, station: primary, initializeQz }), false)
  assert.deepEqual(calls, [])
  assert.equal(canConsumeAutomaticPrintJob(readyAutomaticConsumer({ isOnline: false, station: primary })), false)
  assert.equal(canConsumeAutomaticPrintJob(readyAutomaticConsumer({ station: secondary })), false)
})

test('only the online primary Windows QZ station initializes its background transport', async () => {
  const calls = []
  const station = { id: 'kitchen-primary', isPrimary: true, platform: 'windows' }

  assert.equal(await initializeBackgroundPhysicalTransport({
    authenticated: true,
    isOnline: true,
    isQz: true,
    station,
    initializeQz: async (stationId) => { calls.push(stationId) },
  }), true)
  assert.deepEqual(calls, ['kitchen-primary'])
})

test('printer selection returns stale without persisting when manager generation changes before the write', async (t) => {
  const h = await workspaceHarness(t, { userAgent: 'Windows NT 10.0' })
  let releaseConnection
  const connection = new Promise((resolve) => { releaseConnection = resolve })
  const originalIsActive = qz.websocket.isActive
  const originalConnect = qz.websocket.connect
  qz.websocket.isActive = () => false
  qz.websocket.connect = () => connection
  t.after(() => {
    qz.websocket.isActive = originalIsActive
    qz.websocket.connect = originalConnect
  })
  const station = { id: 'test-station', name: 'Cozinha', platform: 'windows', isPrimary: false, autoPrintEnabled: false }
  globalThis.fetch = async (path) => {
    const url = String(path)
    if (url === '/api/printing/stations') return { ok: true, json: async () => ({ stations: [station] }) }
    if (url.startsWith('/api/printing/jobs?')) return { ok: true, json: async () => ({ jobs: [] }) }
    if (url === '/api/printing/jobs/summary') return { ok: true, json: async () => ({ summary: { safeBacklog: 0 } }) }
    throw new Error(`Unexpected request: ${url}`)
  }

  const Probe = React.forwardRef(function Probe({ authenticated }, ref) {
    const printing = usePrintingManager({ authenticated, isOnline: true })
    React.useImperativeHandle(ref, () => printing, [printing])
    return React.createElement('output', null, printing.configuredPrinterName || '')
  })
  const api = React.createRef()
  const renderer = await h.render(Probe, { ref: api, authenticated: true })
  await act(flushMicrotasks)

  let pending
  await act(async () => { pending = api.current.selectPrinter('Fila B'); await Promise.resolve() })
  await act(async () => renderer.update(React.createElement(Probe, { ref: api, authenticated: false })))
  releaseConnection()
  let result
  await act(async () => { result = await pending; await flushMicrotasks() })

  assert.equal(result, null)
  assert.equal(h.window.localStorage.getItem('delivery-qz-printer:test-station'), null)
  assert.equal(api.current.configuredPrinterName, null)
})

test('an open physical second-copy prompt loses eligibility with readiness, block, or primary changes', () => {
  const eligible = {
    isQz: true,
    transportReady: true,
    printerBlocked: false,
    station: { isPrimary: true, platform: 'windows' },
    job: awaitingSecondCopyJob,
  }

  assert.equal(canKeepSecondCopyPromptOpen(eligible), true)
  assert.equal(canKeepSecondCopyPromptOpen({ ...eligible, transportReady: false }), false)
  assert.equal(canKeepSecondCopyPromptOpen({ ...eligible, printerBlocked: true }), false)
  assert.equal(canKeepSecondCopyPromptOpen({ ...eligible, station: { ...eligible.station, isPrimary: false } }), false)
})

test('second-copy preflight failure happens after claim and persists through the claimed-job failure contract', async () => {
  const sequence = []
  let failedPayload = null
  const station = { id: 'kitchen-primary', isPrimary: true, platform: 'windows' }
  const job = { ...awaitingSecondCopyJob, id: 'job-second-copy', document: { version: 1, type: 'order' } }

  const result = await claimAndExecuteSecondCopy({
    isQz: true,
    transportReady: true,
    printerBlocked: false,
    station,
    job,
    claimJob: async (jobId, stationId) => {
      sequence.push(`claim:${jobId}:${stationId}`)
      return { job }
    },
    executeJob: (claimedJob) => {
      sequence.push(`execute:${claimedJob.id}`)
      return runClaimedPrintJob({
        job: claimedJob,
        stationId: station.id,
        port: null,
        completeJob: async () => assert.fail('preflight failure must not complete the job'),
        failJob: async (_jobId, _stationId, payload) => {
          sequence.push('fail')
          failedPayload = payload
        },
        renderer: () => new Uint8Array([1]),
        transport: async () => {
          sequence.push('preflight')
          throw Object.assign(new Error('QZ indisponível.'), { code: 'QZ_CONNECTION_FAILED' })
        },
      })
    },
  })

  assert.equal(result.status, 'requires_attention')
  assert.deepEqual(sequence, ['claim:job-second-copy:kitchen-primary', 'execute:job-second-copy', 'preflight', 'fail'])
  assert.deepEqual(failedPayload, { code: 'QZ_CONNECTION_FAILED', message: 'QZ indisponível.', uncertain: false })
})

test('physical job failure notifications are deduplicated by job and persisted state', () => {
  const notifier = createPhysicalJobFailureNotifier()
  const toasts = []
  const onNotify = (_error, context) => { toasts.push(context) }
  const known = { job: { id: 'known-job' }, status: 'failed', error: new Error('known') }
  const uncertain = { job: { id: 'uncertain-job' }, status: 'requires_attention', error: new Error('uncertain') }

  assert.equal(notifier.notify({ ...known, onNotify }), true)
  assert.equal(notifier.notify({ ...known, onNotify }), false)
  assert.equal(notifier.notify({ ...uncertain, onNotify }), true)
  assert.equal(notifier.notify({ job: { id: 'background' }, status: 'disconnected', error: new Error('poll'), onNotify }), false)
  assert.deepEqual(toasts, [
    { jobId: 'known-job', status: 'failed' },
    { jobId: 'uncertain-job', status: 'requires_attention' },
  ])

  notifier.synchronize([{ id: 'known-job', status: 'pending' }, { id: 'uncertain-job', status: 'requires_attention' }])
  assert.equal(notifier.notify({ ...known, onNotify }), true)
  assert.equal(notifier.notify({ ...uncertain, onNotify }), false)
})

test('the physical-failure notifier has one stable hook-owned instance without reading a ref during render', () => {
  assert.match(managerSource, /useState\(createPhysicalJobFailureNotifier\)/)
  assert.doesNotMatch(managerSource, /physicalJobFailureNotifierRef\.current/)
})

test('second-copy prompt acknowledgement revalidates readiness and block at the manager boundary', () => {
  const start = managerSource.indexOf('const acknowledgeSecondCopyPrompt = useCallback')
  const end = managerSource.indexOf('const retryJob = useCallback', start)
  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  const acknowledgement = managerSource.slice(start, end)

  assert.match(acknowledgement, /canPresentSecondCopyPrompt\(\{[\s\S]*transportReady: transportReadyRef\.current[\s\S]*printerBlocked: printerBlockedRef\.current/)
})

test('table-tab preview remains a read while printing queues one job without local QZ or transport', async (t) => {
  const h = await workspaceHarness(t, { userAgent: 'Android' })
  const requests = []
  const document = tableTabDocument()
  const queued = { id: 'queued-tab-42', type: 'table-tab', tableTabId: 'tab-42', status: 'pending', copiesRequested: 1, document }
  globalThis.fetch = async (path, options = {}) => {
    const url = String(path)
    requests.push([url, options.method || 'GET'])
    if (url === '/api/printing/stations') return { ok: true, json: async () => ({ stations: [] }) }
    if (url.startsWith('/api/printing/jobs?')) return { ok: true, json: async () => ({ jobs: [] }) }
    if (url === '/api/printing/jobs/summary') return { ok: true, json: async () => ({ summary: { safeBacklog: 0 } }) }
    if (url === '/api/table-tabs/tab-42/print-document') return { ok: true, json: async () => ({ document }) }
    if (url === '/api/table-tabs/tab-42/print-jobs') return { ok: true, json: async () => ({ job: queued }) }
    throw new Error(`Unexpected request: ${url}`)
  }

  function Probe() { return React.createElement('printing-probe', { value: usePrintingManager({ authenticated: true, isOnline: true }) }) }
  const renderer = await h.render(Probe)
  const printing = () => renderer.root.findByType('printing-probe').props.value
  await act(flushMicrotasks)

  assert.equal(await printing().getTableTabPreviewDocument('tab-42'), document)
  assert.deepEqual(await printing().printTableTab('tab-42'), { job: queued })
  assert.deepEqual(requests.filter(([url]) => url.includes('/api/table-tabs/tab-42/')), [
    ['/api/table-tabs/tab-42/print-document', 'GET'],
    ['/api/table-tabs/tab-42/print-jobs', 'POST'],
  ])
  assert.equal(printing().busyJobId, null)
  await act(async () => renderer.unmount())
})


test('QA regression: background QZ retries keep a configured disconnected station visually stable', () => {
  const start = managerSource.indexOf('const resolveConfiguredQzPrinter = useCallback')
  const end = managerSource.indexOf('const refreshPrinters = useCallback', start)
  const block = managerSource.slice(start, end)

  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  assert.match(block, /const savedPrinterName = qzTransport\.readPrinterName\(stationId\)/)
  assert.ok(
    block.indexOf('const savedPrinterName = qzTransport.readPrinterName(stationId)')
      < block.indexOf('await qzTransport.connect()'),
    'saved printer identity must be restored before attempting QZ reconnect',
  )
  assert.match(block, /if \(!transportReadyRef\.current && !savedPrinterName\) setPrinterState\('connecting'\)/)
})


test('QA round 2: configured background reconnect publishes QZ connected only after printer resolution and monitor startup', () => {
  const start = managerSource.indexOf('const resolveConfiguredQzPrinter = useCallback')
  const end = managerSource.indexOf('const refreshPrinters = useCallback', start)
  const block = managerSource.slice(start, end)

  const connectIndex = block.indexOf('await qzTransport.connect()')
  const resolveIndex = block.indexOf('qzReadinessRef.current.probe')
  const monitorIndex = block.indexOf('await ensureQzStatusMonitor(resolvedPrinter)')
  const publishConnectedIndex = block.indexOf('updateQzConnected(Boolean(qzTransport?.isConnected()))')

  assert.ok(connectIndex >= 0)
  assert.ok(resolveIndex > connectIndex)
  assert.ok(monitorIndex > resolveIndex)
  assert.ok(publishConnectedIndex > monitorIndex, 'configured reconnect must not publish transient QZ connected before the monitor is established')
})


test('bulk operational discard is exposed by the manager without reusing the recovery-only action', () => {
  assert.match(managerSource, /discardOperationalPrintJobs/)
  assert.match(managerSource, /const requestDiscardPendingJobs = useCallback/)
  assert.match(managerSource, /requestDiscardPendingJobs,/)
  const start = managerSource.indexOf('const requestDiscardPendingJobs = useCallback')
  const end = managerSource.indexOf('const confirmUnknownPrinted = useCallback', start)
  assert.ok(start >= 0 && end > start)
  const block = managerSource.slice(start, end)
  assert.match(block, /discardOperationalPrintJobs/)
  assert.match(block, /await refresh\(\)/)
  assert.doesNotMatch(block, /setPrintStationRecovery/)
})

test('printing hints only refresh presentation and leave unknown outcomes without retry or claim',async t=>{
  const h=await workspaceHarness(t,{userAgent:'Android'}),listeners=new Set(),mutations=[]
  const realtime={state:'live',subscribeInvalidations(fn){listeners.add(fn);return()=>listeners.delete(fn)}}
  let reads=0,station=null
  const api={getPrintStations:async()=>({stations:station?[station]:[]}),upsertPrintStation:async id=>({station:station={id,platform:'android',isPrimary:false,autoPrintEnabled:false}}),getPrintState:async()=>{reads++;return {stations:station?[station]:[],jobs:[{id:'unknown',status:'requires_attention',lastErrorCode:'PRINT_OUTCOME_UNKNOWN'}],summary:{active:1}}},claimNextPrintJob:async()=>{mutations.push('claim');return {job:null}},retryPrintJob:async()=>mutations.push('retry')}
  function Probe(){return React.createElement('printing-probe',{value:usePrintingManager({api,authenticated:true,accessContextId:'A',realtime})})}
  const renderer=await h.render(Probe)
  await act(async()=>flushMicrotasks());const initial=reads
  await act(async()=>h.fireInterval(5000));assert.equal(reads,initial)
  await act(async()=>Promise.all([...listeners].map(fn=>fn({topics:['printing'],orderIds:[],requiresFullRefresh:false}))))
  assert.equal(reads,initial+1);assert.deepEqual(mutations,[])
  assert.equal(renderer.root.findByType('printing-probe').props.value.jobs[0].status,'requires_attention')
  await act(async()=>h.fireInterval(30_000));assert.equal(reads,initial+2)
})


test('manager refresh reads one coherent printing state and preserves unknown outcomes',async t=>{
 const h=await workspaceHarness(t,{userAgent:'Android'}),calls=[]
 let current
 const station={id:'test-station',platform:'android',isPrimary:false,autoPrintEnabled:false}
 const payload={stations:[station],jobs:[{id:'unknown',status:'requires_attention',lastErrorCode:'PRINT_OUTCOME_UNKNOWN'}],summary:{active:1,safeBacklog:0}}
 const api={getPrintState:async()=>{calls.push('state');return payload},getPrintStations:async()=>{calls.push('stations');return{stations:[station]}},getPrintJobs:async()=>{calls.push('jobs');return{jobs:payload.jobs}},getPrintQueueSummary:async()=>{calls.push('summary');return{summary:payload.summary}},upsertPrintStation:async()=>({station})}
 function Probe(){current=usePrintingManager({api,authenticated:true,accessContextId:'A'});return null}
 await h.render(Probe)
 calls.length=0
 await act(async()=>current.refresh())
 assert.deepEqual(calls,['state'])
 assert.equal(current.jobs[0].lastErrorCode,'PRINT_OUTCOME_UNKNOWN')
 assert.equal(current.activeJobCount,1)
})
