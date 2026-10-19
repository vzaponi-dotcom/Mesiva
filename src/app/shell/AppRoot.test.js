import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { act } from 'react-test-renderer'
import { workspaceHarness, buttonNamed, nodeText } from '../../test-support/renderWorkspace.js'

const baseProps = {
  isOnline: true,
  authState: 'authenticated',
  loginLoading: false,
  loginError: '',
  onLogin() {},
  bootstrapState: 'ready',
  onRetryBootstrap() {},
  retryDisabled: false,
  toasts: [],
  children: React.createElement('div', { id: 'ready-content' }, 'ready'),
}

test('AppRoot preserva checking, anonymous, bootstrap error e ready', async (t) => {
  const h = await workspaceHarness(t)
  const { default: AppRoot } = await h.load('/src/app/shell/AppRoot.jsx')
  const renderer = await h.render(AppRoot, { ...baseProps, authState: 'checking' })
  assert.match(nodeText(renderer.root.findByProps({ role: 'status' })), /Verificando sua sessão/)
  assert.equal(renderer.root.findAllByProps({ className: 'app-topbar' }).length, 0)
  await act(async () => renderer.update(React.createElement(AppRoot, { ...baseProps, authState: 'anonymous', authMode: 'legacy', isOnline: false })))
  assert.equal(renderer.root.findAllByProps({ placeholder: 'Digite o PIN' }).length, 1)
  assert.equal(renderer.root.findAllByProps({ className: 'app-topbar' }).length, 0)
  await act(async () => renderer.update(React.createElement(AppRoot, { ...baseProps, bootstrapState: 'loading' })))
  assert.equal(renderer.root.findAllByProps({ className: 'app-topbar' }).length, 0)
  assert.match(nodeText(renderer.root.findByProps({ role: 'status' })), /Preparando sua operação/)
  assert.notEqual(renderer.root.findByProps({ role: 'status' }).props['aria-busy'], true, 'the live status must not suppress announcements until an unmount')
  assert.equal(renderer.root.findAllByProps({ id: 'ready-content' }).length, 0)
  let retries = 0
  await act(async () => renderer.update(React.createElement(AppRoot, { ...baseProps, bootstrapState: 'error', onRetryBootstrap: () => { retries += 1 } })))
  assert.equal(renderer.root.findAllByProps({ className: 'app-topbar' }).length, 0)
  assert.equal(renderer.root.findAllByProps({ 'aria-label': 'Carregando Mesiva' }).length, 0)
  await act(async () => buttonNamed(renderer.root, 'Tentar novamente').props.onClick())
  assert.equal(retries, 1)
  await act(async () => renderer.update(React.createElement(AppRoot, { ...baseProps, bootstrapState: 'loading' })))
  assert.equal(renderer.root.findAllByProps({ 'aria-label': 'Carregando Mesiva' }).length, 1)
  await act(async () => renderer.update(React.createElement(AppRoot, { ...baseProps, toasts: [{id:'one',type:'warning',message:'Aviso',phase:'visible'},{id:'two',type:'success',message:'Sucesso',phase:'visible'}] })))
  assert.equal(renderer.root.findAllByProps({ 'aria-label': 'Carregando Mesiva' }).length, 0)
  assert.match(nodeText(renderer.root), /ready/)
  assert.match(nodeText(renderer.root), /Aviso/)
  assert.match(nodeText(renderer.root), /Sucesso/)
})
