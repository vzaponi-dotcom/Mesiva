import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import qz from 'qz-tray'
import { act } from 'react-test-renderer'
import { workspaceHarness } from '../../../test-support/renderWorkspace.js'
import { usePrintingManager, PRINT_STATE_POLL_MS } from './usePrintingManager.js'

const readyQz = (t) => {
  let receive
  const replacements = [
    [qz.websocket, 'isActive', () => true],
    [qz.printers, 'find', async () => ['Fila']],
    [qz.printers, 'setPrinterCallbacks', (callback) => { receive = callback }],
    [qz.printers, 'startListening', async () => {}],
    [qz.printers, 'stopListening', async () => {}],
    [qz.printers, 'getStatus', async () => [{ printerName: 'Fila', eventType: 'PRINTER', statusText: 'OK' }]],
  ]
  for (const [target, key, value] of replacements) {
    const original = target[key]; target[key] = value
    t.after(() => { target[key] = original })
  }
  return (event) => receive?.(event)
}

test('rejected printer discovery after expiry cannot block or disconnect the next owner', async (t) => {
  const h = await workspaceHarness(t, { userAgent: 'Windows NT 10.0' })
  readyQz(t)
  let rejectDiscovery, current, pending
  qz.printers.find = () => new Promise((_resolve, reject) => { rejectDiscovery = reject })
  const json = (body) => ({ ok: true, json: async () => body })
  globalThis.fetch = async (path) => json(path === '/api/printing/stations' ? { stations: [{ id: 'test-station', platform: 'windows', isPrimary: false }] } : { jobs: [], summary: {} })
  function Probe(props) { current = usePrintingManager(props); return null }
  const renderer = await h.render(Probe, { authenticated: true, accessContextId: 'a' })
  await act(async () => { pending = current.refreshPrinters(); await Promise.resolve() })
  assert.equal(typeof rejectDiscovery, 'function')
  await act(async () => renderer.update(React.createElement(Probe, { authenticated: false, accessContextId: 'b' })))
  await act(async () => { rejectDiscovery(Object.assign(new Error('old printer unavailable'), { code: 'QZ_UNAVAILABLE' })); await pending.catch(() => {}) })
  assert.equal(current.lastError, null)
  assert.equal(current.printerBlocked, false)
  assert.equal(current.printerState, 'unconfigured')
  assert.equal(current.transportReady, false)
})

test('new owner replaces the old QZ monitor and receives current printer status without sending bytes', async (t) => {
  const h = await workspaceHarness(t, { userAgent: 'Windows NT 10.0' })
  const receive = readyQz(t)
  let current, stopped = 0, bytes = 0
  const originalPrint = qz.print
  qz.print = async () => { bytes++ }
  qz.printers.stopListening = async () => { stopped++ }
  t.after(() => { qz.print = originalPrint })
  h.window.localStorage.setItem('delivery-qz-printer-name:test-station', 'Fila')
  const json = (body) => ({ ok: true, json: async () => body })
  globalThis.fetch = async (path) => json(path === '/api/printing/stations' ? { stations: [{ id: 'test-station', platform: 'windows', isPrimary: false }] } : { jobs: [], summary: {} })
  function Probe(props) { current = usePrintingManager(props); return null }
  const renderer = await h.render(Probe, { authenticated: true, accessContextId: 'a' })
  await act(async () => { await current.connectPrinter() })
  assert.equal(current.transportReady, true)
  await act(async () => renderer.update(React.createElement(Probe, { authenticated: true, accessContextId: 'b' })))
  await act(async () => { await current.connectPrinter() })
  await act(async () => receive({ printerName: 'Fila', eventType: 'PRINTER', statusText: 'OFFLINE' }))
  assert.equal(current.printerHealth.state, 'printer_offline')
  assert.equal(current.transportReady, false)
  assert.equal(stopped, 1)
  assert.equal(bytes, 0)
})

test('execution finally rejection after expiry preserves server failure reporting and no new owner error', async (t) => {
  const h = await workspaceHarness(t, { userAgent: 'Windows NT 10.0' })
  const receive = readyQz(t)
  h.window.localStorage.setItem('delivery-qz-printer-name:test-station', 'Fila')
  let hold = false, rejectRead, current, pending, failures = 0, created = 0
  const json = (body) => ({ ok: true, json: async () => body })
  globalThis.fetch = async (path) => {
    if (path === '/api/printing/test-jobs') { created++; return json({ job: { id: 'test-job' } }) }
    if (String(path).endsWith('/claim')) return json({ job: { id: 'test-job', copiesRequested: 3 } })
    if (String(path).endsWith('/fail')) { failures++; hold = true; return json({}) }
    if (path === '/api/printing/state') return hold ? new Promise((_resolve, reject) => { rejectRead = reject }) : json({ stations: [{ id: 'test-station', platform: 'windows', isPrimary: false }], jobs: [], summary: {} })
    if (path === '/api/printing/stations') return json({ stations: [{ id: 'test-station', platform: 'windows', isPrimary: false }] })
    if (path === '/api/printing/jobs/summary') return json({ summary: {} })
    throw new Error(`Unexpected ${path}`)
  }
  function Probe(props) { current = usePrintingManager(props); return null }
  const renderer = await h.render(Probe, { authenticated: true, accessContextId: 'a' })
  await act(async () => { await current.connectPrinter() })
  assert.equal(current.transportReady, true)
  await act(async () => { pending = current.testPrint(); for (let i = 0; i < 20; i++) await Promise.resolve() })
  assert.equal(failures, 1)
  assert.equal(typeof rejectRead, 'function')
  await act(async () => renderer.update(React.createElement(Probe, { authenticated: false, accessContextId: 'b' })))
  await act(async () => { rejectRead(new Error('old execution refresh failure')); await pending })
  await act(async () => receive({ printerName: 'Fila', eventType: 'PRINTER', statusText: 'OK' }))
  assert.equal(current.lastError, null)
  assert.equal(current.printerBlocked, false)
  assert.equal(current.transportReady, false)
  assert.equal(created, 1)
  assert.equal(failures, 1)
})

test('rejected old polling request cannot publish an error into the next printing owner', async (t) => {
  const h = await workspaceHarness(t)
  let hold = false, rejectRead, current
  const json = (body) => ({ ok: true, json: async () => body })
  globalThis.fetch = async (path) => {
    if (path === '/api/printing/state') return hold ? new Promise((_resolve, reject) => { rejectRead = reject }) : json({ stations: [{ id: 'test-station', platform: 'other', isPrimary: false }], jobs: [], summary: {} })
    if (path === '/api/printing/stations') return json({ stations: [{ id: 'test-station', platform: 'other', autoPrintEnabled: false }] })
    if (path === '/api/printing/jobs/summary') return json({ summary: {} })
    throw new Error(`Unexpected ${path}`)
  }
  function Probe(props) { current = usePrintingManager(props); return null }
  const renderer = await h.render(Probe, { authenticated: true, accessContextId: 'a' })
  hold = true
  await act(async () => { h.fireInterval(PRINT_STATE_POLL_MS); await Promise.resolve() })
  assert.equal(typeof rejectRead, 'function')
  await act(async () => renderer.update(React.createElement(Probe, { authenticated: false, accessContextId: 'b' })))
  await act(async () => { rejectRead(new Error('old owner queue failure')); await new Promise((resolve) => setImmediate(resolve)) })
  assert.equal(current.lastError, null)
  assert.deepEqual(current.jobs, [])
  assert.equal(current.printerBlocked, false)
  assert.equal(current.transportReady, false)
})

test('late queue read and mutation from the expired user cannot repopulate the next session', async (t) => {
  const h = await workspaceHarness(t)
  const previous = globalThis.fetch
  const json = (body) => ({ ok: true, json: async () => body })
  let hold = false, releaseRead, releaseMutation, current
  globalThis.fetch = async (path) => {
    if (String(path).includes('/prioritize')) return new Promise((resolve) => { releaseMutation = () => resolve(json({ job: { id: 'old-mutation' } })) })
    if (path === '/api/printing/state') return hold ? new Promise((resolve) => { releaseRead = () => resolve(json({ stations: [], jobs: [{ id: 'old-read' }], summary: { active: 1 } })) }) : json({ stations: [{ id: 'test-station', platform: 'other', isPrimary: false, autoPrintEnabled: false }], jobs: [{ id: 'private-a' }], summary: { active: 1 } })
    if (path === '/api/printing/stations') return json({ stations: [{ id: 'test-station', platform: 'other', isPrimary: false, autoPrintEnabled: false }] })
    if (path === '/api/printing/jobs/summary') return json({ summary: { active: 1 } })
    throw new Error(`Unexpected ${path}`)
  }
  t.after(() => { globalThis.fetch = previous })
  function Probe(props) { current = usePrintingManager(props); return null }
  const renderer = await h.render(Probe, { authenticated: true, accessContextId: 'a' })
  assert.equal(current.jobs[0].id, 'private-a')
  assert.equal(current.activeJobCount, 1)
  hold = true
  let read, mutation
  await act(async () => { read = current.refresh(); mutation = current.requestPrintNow('j', { refreshManager: false }); await Promise.resolve() })
  await act(async () => renderer.update(React.createElement(Probe, { authenticated: false, accessContextId: null })))
  await act(async () => { releaseRead(); releaseMutation(); await read; await mutation })
  assert.deepEqual(current.jobs, [])
  assert.equal(current.activeJobCount, 0)
})

test('expired recovery transition cannot restore the former station or continue recovery', async (t) => {
  const h = await workspaceHarness(t)
  const previous = globalThis.fetch
  const json = (body) => ({ ok: true, json: async () => body })
  let finish, current, mutations = 0
  const station = { id: 'test-station', platform: 'other', isPrimary: false, autoPrintEnabled: false, recoveryState: 'pending' }
  globalThis.fetch = async (path) => {
    if (String(path).endsWith('/recovery')) { mutations++; return new Promise((resolve) => { finish = () => resolve(json({ station: { ...station, recoveryState: 'active' } })) }) }
    if (path === '/api/printing/stations') return json({ stations: [station] })
    if (String(path).startsWith('/api/printing/jobs?')) return json({ jobs: [] })
    if (path === '/api/printing/jobs/summary') return json({ summary: {} })
    throw new Error(`Unexpected ${path}`)
  }
  t.after(() => { globalThis.fetch = previous })
  function Probe(props) { current = usePrintingManager(props); return null }
  const renderer = await h.render(Probe, { authenticated: true, accessContextId: 'a' })
  let recovery
  await act(async () => { recovery = current.startRecovery(); await Promise.resolve() })
  await act(async () => renderer.update(React.createElement(Probe, { authenticated: false, accessContextId: null })))
  await act(async () => { finish(); await recovery })
  assert.equal(current.localStation, null)
  assert.equal(mutations, 1)
})

for (const action of ['testPrint', 'retryJob']) for (const boundary of ['preparation', 'mutation']) {
  test(`${action} stops before a new write when owner changes during ${boundary}`, async t => {
    const h = await workspaceHarness(t, { userAgent: 'Windows NT 10.0' })
    const receive = readyQz(t)
    h.window.localStorage.setItem('delivery-qz-printer-name:test-station', 'Fila')
    let release, current, pending, writes = [], holdPreparation = false
    const originalFind = qz.printers.find
    qz.printers.find = async () => holdPreparation ? new Promise(resolve => { release = () => resolve(['Fila']) }) : originalFind()
    const json = body => ({ ok: true, json: async () => body })
    globalThis.fetch = async (path, options) => {
      if (options.method === 'POST') {
        writes.push(path)
        if (boundary === 'mutation' && writes.length === 1) return new Promise(resolve => { release = () => resolve(json({ job: { id: 'test-job' } })) })
        return json({ job: { id: 'test-job' } })
      }
      if (path === '/api/printing/stations') return json({ stations: [{ id: 'test-station', platform: 'windows', isPrimary: false }] })
      return json({ jobs: [], summary: {} })
    }
    function Probe(props) { current = usePrintingManager(props); return null }
    const renderer = await h.render(Probe, { authenticated: true, accessContextId: 'a' })
    await act(async () => { await current.connectPrinter() })
    holdPreparation = boundary === 'preparation'
    if (holdPreparation) await act(async () => receive({ printerName: 'Fila', eventType: 'PRINTER', statusText: 'OFFLINE' }))
    await act(async () => { pending = current[action]('test-job'); await new Promise(resolve => setImmediate(resolve)) })
    assert.equal(typeof release, 'function')
    await act(async () => renderer.update(React.createElement(Probe, { authenticated: true, accessContextId: 'b' })))
    holdPreparation = false
    await act(async () => { release(); await pending.catch(() => {}) })
    assert.equal(writes.length, boundary === 'preparation' ? 0 : 1)
    assert.equal(writes.some(path => path.endsWith('/claim')), false)
  })
}

test('owner change while preparing an attempt stops submission intent but preserves failure reconciliation', async t => {
  const h = await workspaceHarness(t, { userAgent: 'Windows NT 10.0' })
  readyQz(t)
  h.window.localStorage.setItem('delivery-qz-printer-name:test-station', 'Fila')
  let release, current, pending, writes = []
  const json = body => ({ ok: true, json: async () => body })
  globalThis.fetch = async (path, options) => {
    if (options.method === 'POST') {
      writes.push(path)
      if (path.endsWith('/attempts')) return new Promise(resolve => { release = () => resolve(json({ attempt: { id: 'attempt', spoolJobName: 'job-name' } })) })
      if (path.endsWith('/submitting')) return json({ attempt: { id: 'attempt', spoolJobName: 'job-name' } })
      return json({ job: { id: 'job', copiesRequested: 1, document: { type: 'test' } } })
    }
    if (path === '/api/printing/stations') return json({ stations: [{ id: 'test-station', platform: 'windows', isPrimary: false }] })
    return json({ jobs: [], summary: {} })
  }
  function Probe(props) { current = usePrintingManager(props); return null }
  const renderer = await h.render(Probe, { authenticated: true, accessContextId: 'a' })
  await act(async () => { await current.connectPrinter() })
  await act(async () => { pending = current.testPrint(); await new Promise(resolve => setImmediate(resolve)) })
  assert.equal(typeof release, 'function')
  await act(async () => renderer.update(React.createElement(Probe, { authenticated: true, accessContextId: 'b' })))
  await act(async () => { release(); await pending })
  assert.equal(writes.some(path => path.endsWith('/submitting')), false)
  assert.equal(writes.filter(path => path.endsWith('/fail')).length, 1)
})

for (const action of ['printSecondCopy', 'printNextRecovery', 'discardRecoveryBacklog', 'startRecovery']) test(`${action} cannot continue a settled request from an expired generation`, async t => {
  const h = await workspaceHarness(t, { userAgent: 'Windows NT 10.0' })
  readyQz(t)
  h.window.localStorage.setItem('delivery-qz-printer-name:test-station', 'Fila')
  const station = { id: 'test-station', platform: 'windows', isPrimary: true, recoveryState: action === 'printSecondCopy' ? 'normal' : action === 'startRecovery' ? 'pending' : 'active' }
  const job = { id: 'job', status: 'awaiting_second_copy', copiesRequested: 2, copiesPrinted: 1, document: { type: 'test' } }
  let release, current, pending, writes = []
  const json = body => ({ ok: true, json: async () => body })
  globalThis.fetch = async (path, options) => {
    if (path.endsWith('/heartbeat')) return json({ station })
    if (options.method === 'POST') {
      writes.push(path)
      if (writes.length === 1) return new Promise(resolve => { release = () => resolve(json({ job, station: { ...station, recoveryState: 'active' } })) })
      return json({ attempt: { id: 'attempt', spoolJobName: 'job-name' } })
    }
    if (path === '/api/printing/stations') return json({ stations: [station] })
    return json({ jobs: [], summary: {} })
  }
  function Probe(props) { current = usePrintingManager(props); return null }
  const renderer = await h.render(Probe, { authenticated: true, accessContextId: 'a' })
  await act(async () => { await current.connectPrinter() })
  await act(async () => { pending = current[action](job); await new Promise(resolve => setImmediate(resolve)) })
  assert.equal(typeof release, 'function')
  await act(async () => renderer.update(React.createElement(Probe, { authenticated: false, accessContextId: 'a' })))
  await act(async () => { release(); await pending })
  assert.equal(writes.length, 1)
  assert.equal(current.localStation, null)
})
