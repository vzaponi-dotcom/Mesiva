import assert from 'node:assert/strict'
import test from 'node:test'
import { nodeText, workspaceHarness } from '../test-support/renderWorkspace.js'

test('TV shows Editado badge and current items but no added/removed/modified history', async t => {
  const h = await workspaceHarness(t)
  const { KitchenDisplayCard } = await h.load('/src/kitchen-display/KitchenDisplayCard.jsx')
  const order = {
    id: 'o1', orderNumber: 42, client: 'Ana', type: 'Entrega', status: 'Em preparo',
    createdAt: '2026-10-10T15:40:00Z',
    items: [{ name: 'Marmita atual', quantity: 2, note: 'Sem cebola' }],
    editPending: false, operationalRevision: 3,
    editSummary: { items: [
      { kind: 'removed', before: { name: 'Salada antiga', quantity: 1 }, after: null },
      { kind: 'added', before: null, after: { name: 'Bebida nova', quantity: 1 } },
      { kind: 'modified', before: { name: 'Marmita atual', quantity: 1, note: '' }, after: { name: 'Marmita atual', quantity: 2, note: 'Sem cebola' } },
    ] },
  }
  const render = await h.render(KitchenDisplayCard, {
    entry: { order, state: 'preparing', phase: 'preparing' },
    now: new Date('2026-10-10T15:42:00Z'),
  })
  const text = nodeText(render.root)
  assert.match(text, /Editado/)
  assert.match(text, /Marmita atual/)
  assert.match(text, /Sem cebola/)
  assert.doesNotMatch(text, /Salada antiga|Bebida nova|Removido:|Adicionado:|Alterado:|Alterações:|Observação alterada:/)
  assert.doesNotMatch(text, /NOVO PEDIDO/)
  assert.equal(render.root.findByType('article').props['data-edit-pending'], false)
})

test('TV does not show edit badge on orders that were never edited', async t => {
  const h = await workspaceHarness(t)
  const { KitchenDisplayCard } = await h.load('/src/kitchen-display/KitchenDisplayCard.jsx')
  const order = {
    id: 'o2', orderNumber: 43, client: 'Luiz', type: 'Entrega',
    createdAt: '2026-10-10T15:40:00Z',
    items: [{ name: 'Prato executivo', quantity: 1 }],
    operationalRevision: 0,
  }
  const render = await h.render(KitchenDisplayCard, {
    entry: { order, state: 'preparing', phase: 'preparing' },
    now: new Date('2026-10-10T15:42:00Z'),
  })
  const text = nodeText(render.root)
  assert.match(text, /Prato executivo/)
  assert.doesNotMatch(text, /Editado|Alterações:/)
})
