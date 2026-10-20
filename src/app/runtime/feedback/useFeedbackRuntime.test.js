import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { act, create } from 'react-test-renderer'
import { useFeedbackRuntime } from './useFeedbackRuntime.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function createHarness() {
  let current
  const Harness = () => {
    current = useFeedbackRuntime()
    return null
  }
  return { Harness, getCurrent: () => current }
}

test('public feedback adapters preserve copy and assign explicit semantics', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const harness = createHarness()
  let renderer
  await act(async () => { renderer = create(React.createElement(harness.Harness)) })
  t.after(() => renderer.unmount())

  await act(async () => {
    harness.getCurrent().showSuccessMessage('Salvo')
    harness.getCurrent().showWarningMessage('Revisar')
    harness.getCurrent().showErrorMessage('Falha')
  })
  assert.deepEqual(harness.getCurrent().toasts.map(({type,message}) => [type,message]), [['success','Salvo'],['warning','Revisar'],['error','Falha']])
  await act(async () => harness.getCurrent().clearFeedback())
  await act(async () => harness.getCurrent().showContextMessage('Enviado à fila', { type: 'info' }))
  assert.equal(harness.getCurrent().toasts[0].type, 'info')
  await act(async () => harness.getCurrent().clearFeedback())
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
