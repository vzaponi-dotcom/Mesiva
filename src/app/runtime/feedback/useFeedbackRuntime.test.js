import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { act, create } from 'react-test-renderer'
import { SUCCESS_DISMISS_MS, TOAST_DISMISS_MS, useFeedbackRuntime } from './useFeedbackRuntime.js'

function createHarness() {
  let current
  const Harness = () => {
    current = useFeedbackRuntime()
    return null
  }
  return { Harness, getCurrent: () => current }
}

test('feedback runtime preserves toast/success copy and dismiss timings', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const harness = createHarness()
  let renderer
  await act(async () => { renderer = create(React.createElement(harness.Harness)) })
  t.after(() => renderer.unmount())

  assert.equal(TOAST_DISMISS_MS, 2600)
  assert.equal(SUCCESS_DISMISS_MS, 1800)

  await act(async () => { harness.getCurrent().setToastMessage('Atenção') })
  assert.equal(harness.getCurrent().toastMessage, 'Atenção')
  await act(async () => { t.mock.timers.tick(2599) })
  assert.equal(harness.getCurrent().toastMessage, 'Atenção')
  await act(async () => { t.mock.timers.tick(1) })
  assert.equal(harness.getCurrent().toastMessage, '')

  await act(async () => { harness.getCurrent().showSuccessMessage() })
  assert.equal(harness.getCurrent().successMessage, 'Ação salva com sucesso')
  await act(async () => { t.mock.timers.tick(1799) })
  assert.equal(harness.getCurrent().successMessage, 'Ação salva com sucesso')
  await act(async () => { t.mock.timers.tick(1) })
  assert.equal(harness.getCurrent().successMessage, '')
})

test('toasts wait their turn and identical events remain distinct without restarting existing deadlines', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  const h = createHarness()
  let renderer
  await act(async () => { renderer = create(React.createElement(h.Harness)) })
  t.after(() => { renderer.unmount() })
  let first, second, fourth
  await act(async () => { first = h.getCurrent().showToast({ type: 'success', message: 'Salvo' }) })
  await act(async () => t.mock.timers.tick(1000))
  await act(async () => {
    second = h.getCurrent().showToast({ type: 'success', message: 'Salvo' })
    h.getCurrent().showToast({ type: 'error', message: 'Falhou' })
    fourth = h.getCurrent().showToast({ type: 'info', message: 'Na fila' })
  })
  assert.notEqual(first, second)
  assert.equal(h.getCurrent().toasts.length, 3)
  assert.equal(h.getCurrent().toasts.some(item => item.id === fourth), false)
  await act(async () => t.mock.timers.tick(3000))
  assert.equal(h.getCurrent().toasts.find(item => item.id === first).phase, 'exiting')
  await act(async () => t.mock.timers.tick(160))
  assert.equal(h.getCurrent().toasts.some(item => item.id === fourth), true)
  await act(async () => t.mock.timers.tick(3999))
  assert.equal(h.getCurrent().toasts.find(item => item.id === fourth).phase, 'visible')
  await act(async () => t.mock.timers.tick(1))
  assert.equal(h.getCurrent().toasts.find(item => item.id === fourth).phase, 'exiting')
  await act(async () => t.mock.timers.tick(60000))
  assert.deepEqual(h.getCurrent().toasts.map(item => item.message), ['Falhou'])
  await act(async () => h.getCurrent().clearFeedback())
  assert.equal(h.getCurrent().toasts.length, 0)
})

test('hover focus and document pauses combine, warnings keep their remaining time and clear cancels promotion', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  const h = createHarness()
  let renderer, id
  await act(async () => { renderer = create(React.createElement(h.Harness)) })
  t.after(() => renderer.unmount())
  await act(async () => { id = h.getCurrent().showToast({ type: 'warning', message: 'Revisar' }) })
  await act(async () => t.mock.timers.tick(2000))
  await act(async () => {
    h.getCurrent().setToastPaused(id, 'hover', true)
    h.getCurrent().setToastPaused(id, 'focus', true)
    h.getCurrent().setToastPaused(id, 'document', true)
  })
  await act(async () => t.mock.timers.tick(10000))
  await act(async () => {
    h.getCurrent().setToastPaused(id, 'hover', false)
    h.getCurrent().setToastPaused(id, 'document', false)
  })
  await act(async () => t.mock.timers.tick(10000))
  assert.equal(h.getCurrent().toasts[0].phase, 'visible')
  await act(async () => h.getCurrent().setToastPaused(id, 'focus', false))
  await act(async () => t.mock.timers.tick(3999))
  assert.equal(h.getCurrent().toasts[0].phase, 'visible')
  await act(async () => t.mock.timers.tick(1))
  assert.equal(h.getCurrent().toasts[0].phase, 'exiting')
  await act(async () => {
    h.getCurrent().showToast({ type: 'success', message: 'Outro' })
    h.getCurrent().clearFeedback()
  })
  await act(async () => t.mock.timers.tick(60000))
  assert.deepEqual(h.getCurrent().toasts, [])
})
