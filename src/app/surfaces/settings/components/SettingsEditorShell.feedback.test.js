import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { act } from 'react-test-renderer'
import { workspaceHarness, buttonNamed, nodeText } from '../../../../test-support/renderWorkspace.js'
import { createPolicyEditingController } from '../../../policy-editing/policyEditingController.js'
import { adminFixture, draftFixture } from '../../../../test-support/settingsFixtures.js'

const props = { title: 'Operação', feedbackScopeKey: 'empresa-a:operations', state: { status: 'ready', dirty: true, draft: { name: 'Original' } }, onDiscard() {} }
const announcement = root => nodeText(buttonNamed(root, 'Salvar alterações').findByProps({ role: 'status' }))

test('official reconciliation acknowledges after the real controller publishes its ready state', async t => {
  const h = await workspaceHarness(t)
  const { default: Shell } = await h.load('/src/app/surfaces/settings/components/SettingsEditorShell.jsx')
  let notify = () => {}, reads = 0, writes = 0, receipts = 0
  const controller = createPolicyEditingController({
    context: { ownerId: 'empresa-a', generation: 1, contextId: 'feedback-test', capabilities: ['operations.settings.manage'] },
    onChange: resources => notify(resources),
    transport: {
      load: async () => ++reads === 1 ? adminFixture : { ...adminFixture, revision: 2, data: draftFixture },
      save: async () => { writes++; throw new TypeError('Resposta perdida') },
      loadReceipt: async () => { receipts++; return { status: 'confirmed', receipt: { committedRevision: 2 } } },
    },
  })
  await controller.load('operations')
  controller.edit('operations', draftFixture)
  assert.equal(await controller.save('operations'), false)
  assert.equal(controller.getResources().operations.status, 'unconfirmed')
  function Probe() {
    const [resources, setResources] = React.useState(() => controller.getResources())
    React.useEffect(() => { notify = setResources; return () => { notify = () => {} } }, [])
    return React.createElement(Shell, { ...props, state: resources.operations, onReconcile: () => controller.reconcile('operations') })
  }
  const screen = await h.render(Probe)
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let result
  await act(async () => { result = await buttonNamed(screen.root, 'Reconsultar').props.onClick() })
  assert.equal(result, true)
  assert.equal(controller.getResources().operations.status, 'ready')
  assert.equal(controller.getResources().operations.dirty, false)
  assert.deepEqual([writes, reads, receipts], [1, 2, 1])
  assert.equal(announcement(screen.root), 'Salvo')
  await act(async () => t.mock.timers.tick(1800))
  assert.equal(announcement(screen.root), '')
})

test('persistent save acknowledges only official completion, blocks double activation and expires after 1800ms', async t => {
  const h = await workspaceHarness(t)
  const { default: Shell } = await h.load('/src/app/surfaces/settings/components/SettingsEditorShell.jsx')
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let resolve, calls = 0
  const screen = await h.render(Shell, { ...props, onSave: () => { calls++; return new Promise(done => { resolve = done }) } })
  const click = buttonNamed(screen.root, 'Salvar alterações').props.onClick
  let pending
  await act(async () => { pending = click({ preventDefault() {} }); click({ preventDefault() {} }) })
  assert.equal(calls, 1)
  assert.equal(buttonNamed(screen.root, 'Salvar alterações').props['aria-busy'], true)
  await act(async () => { resolve(true); await pending })
  assert.equal(announcement(screen.root), 'Salvo')
  await act(async () => t.mock.timers.tick(1799))
  assert.equal(announcement(screen.root), 'Salvo')
  await act(async () => t.mock.timers.tick(1))
  assert.equal(announcement(screen.root), '')
})

test('new draft or resource invalidates a completed or in-flight save without hiding an uncertain result', async t => {
  const h = await workspaceHarness(t)
  const { default: Shell } = await h.load('/src/app/surfaces/settings/components/SettingsEditorShell.jsx')
  let resolve
  const onSave = () => new Promise(done => { resolve = done })
  const screen = await h.render(Shell, { ...props, onSave })
  let pending
  await act(async () => { pending = buttonNamed(screen.root, 'Salvar alterações').props.onClick({ preventDefault() {} }) })
  await act(async () => screen.update(React.createElement(Shell, { ...props, onSave, state: { ...props.state, draft: { name: 'Novo rascunho' } } })))
  await act(async () => { resolve(true); await pending })
  assert.equal(announcement(screen.root), '')
  await act(async () => screen.update(React.createElement(Shell, { ...props, feedbackScopeKey: 'empresa-b:operations', onSave, state: { ...props.state, status: 'unconfirmed', error: 'Resultado desconhecido' } })))
  assert.equal(announcement(screen.root), '')
  assert.match(nodeText(screen.root), /ainda precisa de confirmação/)
  assert.ok(buttonNamed(screen.root, 'Reconsultar'))
})

test('editing after a success removes its check immediately and false is never successful', async t => {
  const h = await workspaceHarness(t)
  const { default: Shell } = await h.load('/src/app/surfaces/settings/components/SettingsEditorShell.jsx')
  const screen = await h.render(Shell, { ...props, onSave: async () => true })
  await act(async () => buttonNamed(screen.root, 'Salvar alterações').props.onClick({ preventDefault() {} }))
  assert.equal(announcement(screen.root), 'Salvo')
  await act(async () => screen.update(React.createElement(Shell, { ...props, onSave: async () => false, state: { ...props.state, draft: { name: 'Outra edição' } } })))
  assert.equal(announcement(screen.root), '')
  await act(async () => buttonNamed(screen.root, 'Salvar alterações').props.onClick({ preventDefault() {} }))
  assert.equal(announcement(screen.root), '')
})
