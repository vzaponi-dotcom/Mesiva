import { authenticatedSession } from './test-support/appSessionFixtures.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { act } from 'react-test-renderer'
import qz from 'qz-tray'

import { buttonNamed, nodeText, workspaceHarness } from './test-support/renderWorkspace.js'
import { usePrintingManager } from './domains/printing/index.js'
import { PRINT_JOB_POLL_MS } from './domains/printing/application/usePrintingManager.js'

const flushMicrotasks = async () => {
  for (let index = 0; index < 30; index += 1) await Promise.resolve()
}

test('ready manager polling delegates safe claim filtering when the primary station has auto-print disabled', async (t) => {
  const harness = await workspaceHarness(t, { userAgent: 'Windows NT 10.0' })
  harness.localStorage.setItem('delivery-qz-printer-name:test-station', 'Fila cozinha')

  const originals = {
    isActive: qz.websocket.isActive,
    setClosedCallbacks: qz.websocket.setClosedCallbacks,
    find: qz.printers.find,
    setPrinterCallbacks: qz.printers.setPrinterCallbacks,
    startListening: qz.printers.startListening,
    stopListening: qz.printers.stopListening,
    getStatus: qz.printers.getStatus,
  }
  qz.websocket.isActive = () => true
  qz.websocket.setClosedCallbacks = () => {}
  qz.printers.find = async () => ['Fila cozinha']
  qz.printers.setPrinterCallbacks = () => {}
  qz.printers.startListening = async () => {}
  qz.printers.stopListening = async () => {}
  qz.printers.getStatus = async () => ({
    printerName: 'Fila cozinha', eventType: 'PRINTER', statusText: 'OK',
  })
  t.after(() => Object.assign(qz.websocket, {
    isActive: originals.isActive,
    setClosedCallbacks: originals.setClosedCallbacks,
  }))
  t.after(() => Object.assign(qz.printers, {
    find: originals.find,
    setPrinterCallbacks: originals.setPrinterCallbacks,
    startListening: originals.startListening,
    stopListening: originals.stopListening,
    getStatus: originals.getStatus,
  }))

  const requests = []
  globalThis.fetch = async (path) => {
    const url = String(path)
    requests.push(url)
    if (url === '/api/printing/stations') return response({ stations: [{
      id: 'test-station', name: 'Cozinha', platform: 'windows',
      isPrimary: true, autoPrintEnabled: false, recoveryState: 'normal',
    }] })
    if (url.startsWith('/api/printing/jobs?')) return response({ jobs: [] })
    if (url === '/api/printing/jobs/summary') return response({ summary: { safeBacklog: 0 } })
    if (url === '/api/printing/stations/test-station/heartbeat') return response({ station: null })
    if (url === '/api/printing/jobs/claim-next') return response({ job: null })
    throw new Error(`Unexpected request: ${url}`)
  }

  const managerRef = React.createRef()
  const ManagerProbe = React.forwardRef(function ManagerProbe(_props, ref) {
    const manager = usePrintingManager({ authenticated: true, isOnline: true })
    React.useImperativeHandle(ref, () => manager, [manager])
    return React.createElement('div')
  })
  await harness.render(ManagerProbe, { ref: managerRef })
  await act(flushMicrotasks)
  assert.equal(managerRef.current.localStation?.isPrimary, true)
  await act(async () => { await managerRef.current.connectPrinter(); await flushMicrotasks() })
  assert.equal(managerRef.current.transportReady, true)
  assert.equal(managerRef.current.printerHealth?.state, 'ready')
  await act(async () => { harness.fireInterval(PRINT_JOB_POLL_MS); await flushMicrotasks() })

  assert.equal(
    requests.filter((url) => url === '/api/printing/jobs/claim-next').length,
    1,
    'polling must keep the safe claim boundary available for manual and prioritized jobs',
  )
  assert.equal(requests.some((url) => /attempt|complete|fail/.test(url)), false,
    'a normal job rejected by claim must not reach physical execution')
})

test('the App fails closed for a new sale when effective operation settings are unavailable', async (t) => {
  const harness = await workspaceHarness(t)
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (path) => {
    if (String(path).startsWith('/api/bootstrap?')) path = '/api/bootstrap'
    const responses = {
      '/api/auth/session': authenticatedSession,
      '/api/bootstrap': { tables: [], tableTabs: [], orders: [], clients: [], products: [], movements: [], financeSettings: null },
      '/api/printing/stations': { stations: [{ id: 'test-station', platform: 'other', isPrimary: false, autoPrintEnabled: false }] },
      '/api/printing/jobs?limit=100': { jobs: [] },
      '/api/printing/jobs/summary': { summary: { safeBacklog: 0 } },
    }
    assert.ok(Object.hasOwn(responses, path), `Unexpected request: ${path}`)
    return response(responses[path])
  }
  t.after(() => { globalThis.fetch = originalFetch })

  const { default: App } = await harness.load('/src/App.jsx')
  const { renderer: screen } = await harness.renderAdminApp(App)
  await act(flushMicrotasks)
  await act(async () => buttonNamed(screen.root, 'Novo pedido').props.onClick())

  const modalityGroup = screen.root.findByProps({ 'aria-label': 'Tipo do pedido' })
  const modalityButtons = modalityGroup.findAllByType('button')
  assert.equal(modalityButtons.every((button) => button.props['aria-pressed'] !== true), true,
    'unconfirmed fallback modalities must not appear selected as effective policy')
  assert.match(screen.root.findAllByProps({ role: 'alert' }).map(nodeText).join(' '), /modalidades?.*(indisponíve(?:l|is)|revise)/i)
  assert.equal(buttonNamed(screen.root, 'Escolher produtos →').props.disabled, true)
})

function response(body) {
  return { ok: true, json: async () => structuredClone(body) }
}

test('repeated App navigation through every settings page does not accumulate timers or listeners', async (t) => {
  const harness = await workspaceHarness(t)
  globalThis.fetch = async (path) => {
    if (String(path).startsWith('/api/bootstrap?')) path = '/api/bootstrap'
    const url = String(path)
    if (url === '/api/auth/session') return response(authenticatedSession)
    if (url === '/api/bootstrap') return response({
      tables: [], tableTabs: [], orders: [], clients: [], products: [], movements: [], financeSettings: null,
      effectiveBusinessConfig: {
        version: 'settings-lifecycle', revisions: { operations: 0 },
        operations: {
          enabledModalities: ['Entrega', 'Retirada', 'Local'], defaultModality: 'Entrega',
          timing: { scheduledPrepLeadMinutes: 50, scheduledLateGraceMinutes: 15, immediateLateAfterMinutes: 30, immediateVeryLateAfterMinutes: 40 },
        },
      },
    })
    if (url === '/api/printing/stations') return response({ stations: [{ id: 'test-station', platform: 'other', isPrimary: false, autoPrintEnabled: false }] })
    if (url.startsWith('/api/printing/jobs?')) return response({ jobs: [] })
    if (url === '/api/printing/jobs/summary') return response({ summary: { safeBacklog: 0 } })
    if (url.startsWith('/api/settings/') || url === '/api/printing/settings') return response({}, 503)
    throw new Error(`Unexpected request: ${url}`)
  }
  const { default: App } = await harness.load('/src/App.jsx')
  await harness.renderAdminApp(App)
  await act(flushMicrotasks)
  const baseline = harness.activitySnapshot({ ignoreFocus: true })
  const destinations = [
    'settings-home', 'settings-operations', 'settings-modalities', 'settings-payments',
    'settings-cancellations', 'settings-finance-categories', 'settings-printing', 'settings-device', 'orders',
  ]
  for (let pass = 0; pass < 2; pass += 1) {
    for (const destination of destinations) {
      await act(async () => {
        harness.window.dispatchEvent(Object.assign(new Event('app:navigate'), { detail: destination }))
        await flushMicrotasks()
      })
    }
  }
  const after = harness.activitySnapshot({ ignoreFocus: true })
  assert.equal(after.listeners, baseline.listeners)
  assert.ok(after.timers <= baseline.timers, `timers accumulated: ${baseline.timers} -> ${after.timers}`)
})
