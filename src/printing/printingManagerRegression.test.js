import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  canConsumeAutomaticPrintJob,
  getPrintingTransportKind,
  isPrintingTransportSupported,
} from '../domains/printing/domain/printingEligibility.js'

const manager = await readFile(new URL('../domains/printing/application/usePrintingManager.js', import.meta.url), 'utf8')
const app = await readFile(new URL('../App.jsx', import.meta.url), 'utf8')
const overlays = await readFile(new URL('../domains/printing/application/usePrintingOverlays.js', import.meta.url), 'utf8')
const operationalRuntime = await readFile(new URL('../app/runtime/data/useOperationalDataRuntime.js', import.meta.url), 'utf8')
const orderArrivals = await readFile(new URL('../domains/orders/application/useOrderArrivals.js', import.meta.url), 'utf8')

test('printing manager is driven by official job APIs and never by new-order detection', () => {
  for (const apiName of [
    'getPrintStations',
    'upsertPrintStation',
    'getPrintState',
    'createManualPrintJob',
    'createTestPrintJob',
    'claimNextPrintJob',
    'claimPrintJob',
    'completePrintJob',
    'failPrintJob',
    'retryPrintJob',
    'getOrderPrintDocument',
    'getTableTabPrintDocument',
  ]) assert.match(manager, new RegExp(`\\b${apiName}\\b`))

  assert.doesNotMatch(manager, /makePrimaryPrintStation|saveStationSettings/)

  assert.match(manager, /runClaimedPrintJob/)
  assert.doesNotMatch(manager, /findAuthorizedPrinterPort|requestPrinterPort/)
  assert.doesNotMatch(manager, /dispatchRawBtBytes/)
  assert.doesNotMatch(manager, /getNewActiveOrderIds/)
  assert.doesNotMatch(manager, /detectedIds/)

  const arrivalIndex = orderArrivals.indexOf('const { currentIds, newIds }')
  assert.notEqual(arrivalIndex, -1)
  const detectionEffectStart = orderArrivals.lastIndexOf('useEffect(() => {', arrivalIndex)
  assert.notEqual(detectionEffectStart, -1)
  const nextEffectStart = orderArrivals.indexOf('useEffect(() => {', arrivalIndex + 1)
  assert.notEqual(nextEffectStart, -1)
  const detectionEffect = orderArrivals.slice(detectionEffectStart, nextEffectStart)
  assert.match(detectionEffect, /detectOperationalArrivals/)
  assert.match(detectionEffect, /\bnewIds\b/)
  assert.doesNotMatch(detectionEffect, /\bprinting\./)
})

test('Android and other platforms are queue-only while Windows uses QZ', () => {
  assert.equal(getPrintingTransportKind('android'), 'queue-only')
  assert.equal(getPrintingTransportKind('windows'), 'qz')
  assert.equal(getPrintingTransportKind('other'), 'queue-only')

  assert.equal(isPrintingTransportSupported('android', undefined), false)
  assert.equal(isPrintingTransportSupported('windows', undefined), true)
  assert.equal(isPrintingTransportSupported('other', undefined), false)
  assert.equal(isPrintingTransportSupported('other', { requestPort() {}, getPorts() {} }), false)

  assert.doesNotMatch(manager, /transportKind === 'rawbt'|dispatchRawBtBytes\(bytes\)/)
})

test('QZ uses MPT-II bitmap rendering and queue-only platforms do not render physically', () => {
  const start = manager.indexOf('const executeClaimedJob = useCallback')
  assert.notEqual(start, -1)
  const end = manager.indexOf('const testPrint', start)
  assert.notEqual(end, -1)
  const block = manager.slice(start, end)

  assert.match(block, /compatibilityMode:\s*getRendererCompatibilityMode\(transportKind\)/)
  assert.match(block, /qzTransport\.print\(configuredPrinterNameRef\.current, bytes\)/)
  assert.doesNotMatch(block, /writeSerialBytes|MTP5_PROFILE\.serial/)
})

test('Windows QZ lifecycle configures signed security and exposes explicit local queue setup', () => {
  assert.doesNotMatch(manager, /from 'qz-tray'/)
  assert.match(manager, /createQzTransport/)
  assert.match(manager, /getQzCertificate/)
  assert.match(manager, /signQzPayload/)
  for (const qzName of ['configureSecurity', 'connect', 'listPrinters', 'resolvePrinter', 'print']) {
    assert.match(manager, new RegExp(`qzTransport\\.${qzName}`))
  }
  assert.match(manager, /qzTransport\.readPrinterName/)
  assert.match(manager, /qzTransport\.savePrinterName/)

  assert.match(manager, /const \[availablePrinters, setAvailablePrinters\] = useState\(\[\]\)/)
  assert.match(manager, /const \[configuredPrinterName, setConfiguredPrinterName\] = useState\(null\)/)
  assert.match(manager, /const \[transportReady, setTransportReady\] = useState\(/)
  assert.match(manager, /const refreshPrinters = useCallback\(async \(\) =>/)
  assert.match(manager, /const selectPrinter = useCallback\(async \(printerName\) =>/)
  assert.match(manager, /createQzTransport\(\{[\s\S]*getCertificate:\s*api\.getQzCertificate,[\s\S]*signPayload:\s*api\.signQzPayload/)
  assert.match(manager, /qzTransport\.connect\(\)/)
  assert.match(manager, /qzTransport\.resolvePrinter\(savedPrinterName\)/)
  assert.match(manager, /qzTransport\.savePrinterName\(stationId, selectedPrinter\)/)

  const explicitPortStart = manager.indexOf('const getExplicitPort = useCallback')
  assert.notEqual(explicitPortStart, -1)
  const explicitPortEnd = manager.indexOf('const executeClaimedJob = useCallback', explicitPortStart)
  assert.notEqual(explicitPortEnd, -1)
  const explicitPort = manager.slice(explicitPortStart, explicitPortEnd)
  assert.match(explicitPort, /transportKind === 'qz'/)
  assert.match(explicitPort, /transportReadyRef\.current/)
})

test('automatic claim guard blocks duplicate, unready, or unsafe consumption states', () => {
  const base = {
    authenticated: true,
    isOnline: true,
    supported: true,
    visible: true,
    browserOnline: true,
    busyJobId: null,
    printerBlocked: false,
    transportReady: true,
    station: { isPrimary: true, autoPrintEnabled: true },
  }
  assert.equal(canConsumeAutomaticPrintJob(base), true)
  for (const override of [
    { authenticated: false },
    { isOnline: false },
    { supported: false },
    { browserOnline: false },
    { busyJobId: 'job-running' },
    { printerBlocked: true },
    { transportReady: false },
    { station: null },
    { station: { isPrimary: false, autoPrintEnabled: true } },
    { station: { isPrimary: true, autoPrintEnabled: false } },
  ]) assert.equal(canConsumeAutomaticPrintJob({ ...base, ...override }), false)

  assert.equal(canConsumeAutomaticPrintJob({ ...base, visible: false }), true)
  assert.match(manager, /canConsumeAutomaticPrintJob\(\{[\s\S]*transportReady:\s*transportReadyRef\.current/)
  const consumerStart = manager.indexOf('const consumeNext = async () =>')
  const consumerEnd = manager.indexOf('const tick = async () =>', consumerStart)
  assert.ok(consumerStart >= 0 && consumerEnd > consumerStart)
  const consumer = manager.slice(consumerStart, consumerEnd)
  assert.doesNotMatch(consumer, /visible:\s*visiblePage\(\)/)
  assert.doesNotMatch(consumer, /setInterval/)
  assert.match(manager, /printExecutionTicker\.start/)
  assert.match(manager, /updateBlocked\(false\)/)
})

test('second copy resumes the existing partial job explicitly without creating a replacement job', () => {
  const start = manager.indexOf('const printSecondCopy = useCallback')
  assert.notEqual(start, -1)
  const end = manager.indexOf('const retryJob = useCallback', start)
  assert.notEqual(end, -1)
  const block = manager.slice(start, end)

  assert.match(block, /claimAndExecuteSecondCopy\(\{/)
  assert.match(block, /claimJob: api\.claimPrintJob/)
  assert.match(block, /executeClaimedJob\(claimedJob, null/)
  assert.match(block, /preparePort: getExplicitPort/)
  assert.doesNotMatch(block, /createManualPrintJob/)
  assert.match(manager, /\bprintSecondCopy,\s*\n/)
})

test('consolidated table-tab printing creates a centralized manual queue job', () => {
  const start = manager.indexOf('const printTableTab = useCallback')
  assert.notEqual(start, -1)
  const end = manager.indexOf('useEffect(() => {', start)
  assert.notEqual(end, -1)
  const block = manager.slice(start, end)

  assert.match(block, /createManualTableTabPrintJob\(tableTabId, copies\)/)
  assert.doesNotMatch(block, /getTableTabPreviewDocument|runManualPrintDocument/)
})

test('printing manager centralizes approved poll and heartbeat cadences', () => {
  assert.match(manager, /export const PRINT_JOB_POLL_MS = 2_000/)
  assert.match(manager, /export const PRINT_STATE_POLL_MS = 5_000/)
  assert.match(manager, /export const STATION_HEARTBEAT_MS = 15_000/)
  assert.match(manager, /printerBlocked/)
  assert.match(manager, /busyJobId/)
})

test('App mounts one printing manager and passes it to Orders without changing order sync detection', () => {
  assert.equal(app.includes("from './domains/printing/index.js'"), true)
  assert.equal(app.includes('usePrintingManager'), true)
  assert.equal(app.includes('canKeepSecondCopyPromptOpen'), false)
  assert.equal(app.includes('canPresentSecondCopyPrompt'), false)
  assert.equal(overlays.includes('canKeepSecondCopyPromptOpen'), true)
  assert.equal(overlays.includes('canPresentSecondCopyPrompt'), true)
  const hookCalls = app.match(/usePrintingManager\(/g) || []
  assert.equal(hookCalls.length, 1)
  assert.match(app, /const printing = usePrintingManager\(/)
  assert.match(app, /<Orders[\s\S]*printing=\{printing\}/)
  assert.match(app, /<Comandas[\s\S]*printing=\{printing\}/)

  assert.match(app, /useOrderArrivals\(/)
  assert.doesNotMatch(app, /getNew(?:Active|Operational)OrderIds|newIds:\s*detectedIds/)
  assert.match(orderArrivals, /detectOperationalArrivals/)
  assert.match(orderArrivals, /const \{ currentIds, newIds \}/)
  assert.match(operationalRuntime, /const DATA_COLLECTIONS = \['clients', 'products', 'orders', 'tables', 'tableTabs', 'movements', 'financeSettings'\]/)
  assert.doesNotMatch(operationalRuntime, /DATA_COLLECTIONS = \[[^\]]*print/i)
})
