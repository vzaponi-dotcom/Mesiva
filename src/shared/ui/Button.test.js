import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { act } from 'react-test-renderer'
import { workspaceHarness, nodeText } from '../../test-support/renderWorkspace.js'

test('a loading button blocks repeated activation while announcing the pending action', async t => {
  const h = await workspaceHarness(t)
  const { default: Button } = await h.load('/src/shared/ui/Button.jsx')
  let calls = 0
  const screen = await h.render(Button, { state: 'loading', loadingLabel: 'Salvando…', onClick: () => calls++, children: 'Salvar pedido' })
  const button = screen.root.findByType('button')
  assert.equal(button.props.disabled, true)
  assert.equal(button.props['aria-busy'], true)
  await act(async () => button.props.onClick?.({ preventDefault() {} }))
  assert.equal(calls, 0)
  assert.equal(nodeText(screen.root.findByProps({ role: 'status' })), 'Salvando…')
})

test('controlled feedback preserves submit semantics and never interprets a resolved false result as success', async t => {
  const h = await workspaceHarness(t)
  const { default: Button } = await h.load('/src/shared/ui/Button.jsx')
  let calls = 0
  const props = { type: 'submit', state: 'idle', icon: 'check', className: 'checkout-action', children: 'Salvar', onClick: event => { event.preventDefault(); calls++; return Promise.resolve(false) } }
  const screen = await h.render(Button, props)
  let prevented = false
  await act(async () => screen.root.findByType('button').props.onClick({ preventDefault() { prevented = true } }))
  assert.equal(calls, 1)
  assert.equal(prevented, true)
  assert.equal(screen.root.findByType('button').props.type, 'submit')
  assert.match(screen.root.findByType('button').props.className, /checkout-action/)
  assert.equal(screen.root.findAllByProps({ role: 'status' }).map(nodeText).join(''), '')
  await act(async () => screen.update(React.createElement(Button, { ...props, state: 'success', successLabel: 'Salvo' })))
  assert.equal(nodeText(screen.root.findByProps({ role: 'status' })), 'Salvo')
  await act(async () => screen.update(React.createElement(Button, { ...props, state: 'error', errorLabel: 'Falhou' })))
  assert.equal(nodeText(screen.root.findByProps({ role: 'status' })), 'Falhou')
  await act(async () => screen.update(React.createElement(Button, { ...props, disabled: true })))
  assert.equal(screen.root.findByType('button').props.disabled, true)
})

test('confirmation loading is distinct from a permission-disabled decision', async t => {
  const h = await workspaceHarness(t)
  const { default: ConfirmationDialog } = await h.load('/src/shared/ui/ConfirmationDialog.jsx')
  const props = { title: 'Excluir?', confirmLabel: 'Excluir', submitting: true, loadingLabel: 'Excluindo…', onClose() {}, onConfirm() {} }
  const screen = await h.render(ConfirmationDialog, props)
  const confirm = screen.root.findAllByType('button').find(button => button.props['aria-busy'])
  assert.ok(confirm)
  assert.equal(confirm.props.disabled, true)
  assert.equal(nodeText(screen.root.findByProps({ role: 'status' })), 'Excluindo…')
  await act(async () => screen.update(React.createElement(ConfirmationDialog, { ...props, submitting: false, disabled: true })))
  assert.equal(screen.root.findAllByType('button').some(button => button.props['aria-busy']), false)
})
