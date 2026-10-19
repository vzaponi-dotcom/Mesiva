import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { act } from 'react-test-renderer'
import { workspaceHarness, nodeText } from '../../test-support/renderWorkspace.js'

test('global typed feedback survives a child closing without covering the page with a success modal', async t => {
  const h = await workspaceHarness(t)
  const { default: AppRoot } = await h.load('/src/app/shell/AppRoot.jsx')
  const props = { authState: 'authenticated', bootstrapState: 'ready', isOnline: true, toasts: [{ id: 'one', type: 'success', message: 'Pedido salvo', phase: 'visible' }], onDismissToast() {}, onPauseToast() {} }
  const screen = await h.render(AppRoot, { ...props, children: React.createElement('div', null, 'Formulário') })
  assert.equal(screen.root.findAllByType('li').length, 1)
  await act(async () => screen.update(React.createElement(AppRoot, { ...props, children: React.createElement('div', null, 'Cozinha') })))
  assert.match(nodeText(screen.root), /Pedido salvo/)
  assert.equal(screen.root.findAllByProps({ className: 'success-confirmation-overlay' }).length, 0)
  await act(async () => screen.update(React.createElement(AppRoot, { ...props, toasts: [] })))
  assert.equal(screen.root.findAllByType('li').length, 0)
  assert.equal(nodeText(screen.root.findByProps({ role: 'status' })), '')
})
