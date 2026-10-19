import test from 'node:test'
import assert from 'node:assert/strict'
import { act } from 'react-test-renderer'
import { workspaceHarness, buttonNamed, nodeText } from '../test-support/renderWorkspace.js'

test('printing policy shows sending on its existing owner and leaves an accepted message when its editor closes', async t => {
  const h = await workspaceHarness(t)
  const { default: Content } = await h.load('/src/domains/printing/ui/PrintingSettingsContent.jsx')
  let resolve, calls = 0
  const policy = { status: 'ready', dirty: true, draft: { orderCopies: 1, tableTabCopies: 1 } }
  const screen = await h.render(Content, {
    printing: { localStation: {}, jobs: [] },
    settings: { policyState: () => policy, stationState: () => null, primaryState: () => null, savePolicy: () => { calls++; return new Promise(done => { resolve = done }) } },
    granted: new Set(['printing.settings.view', 'printing.settings']),
  })
  let pending
  await act(async () => { pending = buttonNamed(screen.root, 'Salvar política').props.onClick() })
  assert.equal(calls, 1)
  assert.equal(buttonNamed(screen.root, 'Salvar política').props['aria-busy'], true)
  await act(async () => { policy.dirty = false; resolve(true); await pending })
  assert.match(nodeText(screen.root), /Política de impressão salva/)
})
