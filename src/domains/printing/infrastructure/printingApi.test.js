import assert from 'node:assert/strict'
import test from 'node:test'
import * as client from './printingApi.js'

const withFetch = async (implementation, callback) => {
  const original = globalThis.fetch
  globalThis.fetch = implementation
  try { await callback() } finally { globalThis.fetch = original }
}

const captureCalls = async (callback, payload = {}) => {
  const calls = []
  await withFetch(async (...args) => {
    calls.push(args)
    return Response.json(payload)
  }, async () => callback(calls))
  return calls
}

test('printing API preserves settings and heartbeat routes and payloads', async () => {
  const calls = await captureCalls(async () => {
    await client.getPrintSettings()
    await client.savePrintSettings({ orderDefaultCopies: 2, tableTabDefaultCopies: 1 })
    await client.heartbeatPrintStation('station 1', { qzReady: true, printerReady: true })
  })

  assert.deepEqual(calls.map(([path, options]) => [path, options?.method || 'GET', options?.credentials]), [
    ['/api/printing/settings', 'GET', 'same-origin'],
    ['/api/printing/settings', 'PUT', 'same-origin'],
    ['/api/printing/stations/station%201/heartbeat', 'POST', 'same-origin'],
  ])
  assert.deepEqual(JSON.parse(calls[1][1].body), { orderDefaultCopies: 2, tableTabDefaultCopies: 1 })
  assert.deepEqual(JSON.parse(calls[2][1].body), { qzReady: true, printerReady: true })
})

test('printing API preserves station, queue, attempt and recovery contracts', async () => {
  const calls = await captureCalls(async () => {
    await client.getPrintStations()
    await client.upsertPrintStation('station 1', { name: 'Cozinha', platform: 'windows', autoPrintEnabled: true })
    await client.makePrimaryPrintStation('station 1')
    await client.getPrintJobs({ scope: 'operational', page: 2, pageSize: 25, sortBy: 'createdAt', sortDir: 'desc', search: 'mesa 7' })
    await client.getPrintQueueSummary()
    await client.createPrintAttempt('job 1', 'station 1', 1)
    await client.markPrintAttemptSubmitting('attempt 1', 'station 1')
    await client.recordPrintAttemptEvent('attempt 1', 'station 1', { type: 'SPOOLING', jobName: 'GESTAO 1', spoolJobId: 7 })
    await client.resolvePrintOutcome('job 1', 'attempt 1', 'manual_not_printed', 'Caixa 1')
    await client.setPrintStationRecovery('station 1', 'active')
    await client.claimNextRecoveryPrintJob('station 1')
    await client.discardPendingPrintJobs('Caixa 1')
  })

  assert.deepEqual(calls.map(([path, options]) => [path, options?.method || 'GET']), [
    ['/api/printing/stations', 'GET'],
    ['/api/printing/stations/station%201', 'PUT'],
    ['/api/printing/stations/station%201/make-primary', 'POST'],
    ['/api/printing/jobs?scope=operational&page=2&pageSize=25&sortBy=createdAt&sortDir=desc&search=mesa+7', 'GET'],
    ['/api/printing/jobs/summary', 'GET'],
    ['/api/printing/jobs/job%201/attempts', 'POST'],
    ['/api/printing/attempts/attempt%201/submitting', 'POST'],
    ['/api/printing/attempts/attempt%201/events', 'POST'],
    ['/api/printing/jobs/job%201/resolve-outcome', 'POST'],
    ['/api/printing/stations/station%201/recovery', 'POST'],
    ['/api/printing/jobs/claim-recovery-next', 'POST'],
    ['/api/printing/jobs/discard-pending', 'POST'],
  ])
  assert.deepEqual(JSON.parse(calls[5][1].body), { stationId: 'station 1', copyNumber: 1 })
  assert.deepEqual(JSON.parse(calls[8][1].body), { attemptId: 'attempt 1', resolution: 'manual_not_printed', actorLabel: 'Caixa 1' })
})

test('printing API preserves job commands, table-tab routes and reprint copy payload', async () => {
  const calls = await captureCalls(async () => {
    await client.createManualPrintJob('order 1', 2)
    await client.createManualTableTabPrintJob('tab / one', 2)
    await client.createTestPrintJob('station 1')
    await client.claimNextPrintJob('station 1')
    await client.claimPrintJob('job 1', 'station 1')
    await client.acknowledgeSecondCopyPrompt('job 1', 'station 1')
    await client.requestSecondCopy('job 1', 'Caixa 1')
    await client.skipSecondCopy('job 1', 'Caixa 1')
    await client.completePrintJob('job 1', 'station 1', 2)
    await client.failPrintJob('job 1', 'station 1', { code: 'SERIAL_OPEN_FAILED', message: 'offline', uncertain: false })
    await client.retryPrintJob('job 1', 'station 1')
    await client.discardPrintJob('job 1', 'Caixa 1')
    await client.prioritizePrintJob('job 1')
    await client.forcePrintJob('job 1', 'Caixa 1')
    await client.reprintPrintJob('job 1', 2)
    await client.getOrderPrintDocument('order 1')
    await client.getTableTabPrintDocument('tab / one')
  })

  assert.deepEqual(calls.map(([path, options]) => [path, options?.method || 'GET']), [
    ['/api/orders/order%201/print-jobs', 'POST'],
    ['/api/table-tabs/tab%20%2F%20one/print-jobs', 'POST'],
    ['/api/printing/test-jobs', 'POST'],
    ['/api/printing/jobs/claim-next', 'POST'],
    ['/api/printing/jobs/job%201/claim', 'POST'],
    ['/api/printing/jobs/job%201/second-copy-prompt', 'POST'],
    ['/api/printing/jobs/job%201/request-second-copy', 'POST'],
    ['/api/printing/jobs/job%201/skip-second-copy', 'POST'],
    ['/api/printing/jobs/job%201/complete', 'POST'],
    ['/api/printing/jobs/job%201/fail', 'POST'],
    ['/api/printing/jobs/job%201/retry', 'POST'],
    ['/api/printing/jobs/job%201/discard', 'POST'],
    ['/api/printing/jobs/job%201/prioritize', 'POST'],
    ['/api/printing/jobs/job%201/force-print', 'POST'],
    ['/api/printing/jobs/job%201/reprint', 'POST'],
    ['/api/orders/order%201/print-document', 'GET'],
    ['/api/table-tabs/tab%20%2F%20one/print-document', 'GET'],
  ])
  assert.deepEqual(JSON.parse(calls[14][1].body), { copies: 2 })
  assert.equal(Object.hasOwn(JSON.parse(calls[14][1].body), 'stationId'), false)
})

test('QZ certificate and signing helpers preserve plain-text transport and structured errors', async () => {
  const calls = []
  await withFetch(async (...args) => {
    calls.push(args)
    return new Response(args[0].endsWith('/certificate') ? 'CERTIFICATE TEXT' : 'BASE64SIGNATURE==', {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    })
  }, async () => {
    assert.equal(await client.getQzCertificate(), 'CERTIFICATE TEXT')
    assert.equal(await client.signQzPayload('call=print&timestamp=123'), 'BASE64SIGNATURE==')
  })
  assert.equal(calls[0][0], '/api/printing/qz/certificate')
  assert.equal(calls[1][0], '/api/printing/qz/sign')
  assert.deepEqual(JSON.parse(calls[1][1].body), { toSign: 'call=print&timestamp=123' })

  await withFetch(async () => new Response(JSON.stringify({
    error: { code: 'QZ_SIGNING_UNAVAILABLE', message: 'Assinatura QZ indisponível' },
  }), { status: 503, headers: { 'content-type': 'application/json' } }), async () => {
    await assert.rejects(() => client.getQzCertificate(), {
      status: 503,
      code: 'QZ_SIGNING_UNAVAILABLE',
    })
  })
})


test('paginated queue reads forward an AbortSignal to fetch', async () => {
  const controller = new AbortController()
  const calls = await captureCalls(async () => {
    await client.getPrintJobs({ page: 2 }, { signal: controller.signal })
    await client.getPrintQueueSummary({ signal: controller.signal })
  })
  assert.equal(calls[0][1].signal, controller.signal)
  assert.equal(calls[1][1].signal, controller.signal)
})


test('printing API exposes the safe operational bulk discard adapter', async () => {
  const calls = await captureCalls(async () => {
    const client = await import('./printingApi.js')
    await client.discardOperationalPrintJobs('Operador')
  })

  assert.deepEqual(calls.map(([path, options]) => [path, options?.method || 'GET']), [
    ['/api/printing/jobs/discard-operational', 'POST'],
  ])
  assert.deepEqual(JSON.parse(calls[0][1].body), { actorLabel: 'Operador' })
})


test('printing state uses one contextual HTTP request', async () => {
 const calls=await captureCalls(async()=>{await client.getPrintState()})
 assert.deepEqual(calls.map(([path,options])=>[path,options?.method||'GET',options?.credentials]),[['/api/printing/state','GET','same-origin']])
})
