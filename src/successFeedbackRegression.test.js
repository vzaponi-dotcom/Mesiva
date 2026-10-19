import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { act, create } from 'react-test-renderer'
import { useFeedbackRuntime } from './app/runtime/feedback/useFeedbackRuntime.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

test('success expires independently while an API error remains available until dismissed', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  let feedback
  const Harness = () => { feedback = useFeedbackRuntime(); return null }
  let renderer
  await act(async () => { renderer = create(React.createElement(Harness)) })
  t.after(async () => { await act(async () => renderer.unmount()) })
  await act(async () => { feedback.showSuccessMessage('Pedido salvo'); feedback.showErrorMessage('Confira a conexão') })
  await act(async () => t.mock.timers.tick(4000))
  await act(async () => t.mock.timers.tick(160))
  assert.deepEqual(feedback.toasts.map(item => item.message), ['Confira a conexão'])
  await act(async () => feedback.clearFeedback())
  assert.deepEqual(feedback.toasts, [])
})
