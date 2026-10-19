import test from 'node:test'
import assert from 'node:assert/strict'
import { act } from 'react-test-renderer'
import { workspaceHarness, nodeText } from '../../test-support/renderWorkspace.js'

test('toast regions exist before messages, expose dismiss and preserve keyboard focus while paused', async t => {
  const h = await workspaceHarness(t)
  const { default: ToastRegion } = await h.load('/src/shared/ui/ToastRegion.jsx')
  const events = []
  const screen = await h.render(ToastRegion, { toasts: [], onDismiss() {}, onPause() {} })
  assert.equal(nodeText(screen.root.findByProps({ role: 'status' })), '')
  assert.equal(nodeText(screen.root.findByProps({ role: 'alert' })), '')
  const item = { id: 'one', type: 'error', title: 'Falha', message: 'Confira o pedido', phase: 'visible' }
  const React = await import('react')
  await act(async () => screen.update(React.createElement(ToastRegion, { toasts: [item], onDismiss: id => events.push(['dismiss', id]), onPause: (...args) => events.push(args) })))
  assert.equal(nodeText(screen.root.findByProps({ role: 'alert' })), 'Falha. Confira o pedido')
  const entry = screen.root.findByType('li')
  entry.props.onMouseEnter()
  entry.props.onFocusCapture()
  entry.props.onBlurCapture({ currentTarget: { contains: () => false }, relatedTarget: null })
  screen.root.findByType('button').props.onClick()
  assert.deepEqual(events, [['one', 'hover', true], ['one', 'focus', true], ['one', 'focus', false], ['dismiss', 'one']])
  assert.match(screen.root.findByType('button').props['aria-label'], /Fechar aviso/)
})
