import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { act } from 'react-test-renderer'
import { mountHook } from '../test-support/harness.js'
import { useProductEditor } from './useProductEditor.js'

test('product submission latches before a render and an old completion cannot close a new editor', async t => {
  let resolve, calls = 0
  const hook = await mountHook(t, useProductEditor, { canManageProducts: true, createProduct: () => { calls++; return new Promise(done => { resolve = done }) } })
  await act(async () => { hook.current().openNewProduct(); hook.current().replaceDraft({ name: 'Primeiro', price: 'R$ 10,00' }) })
  let first, duplicate
  await act(async () => { first = hook.current().submit(); duplicate = hook.current().submit() })
  assert.equal(calls, 1)
  assert.equal(await duplicate, false)
  assert.equal(hook.current().submitting, true)
  await act(async () => { hook.current().cancel(); hook.current().openNewProduct(); hook.current().replaceDraft({ name: 'Segundo', price: 'R$ 20,00' }) })
  await act(async () => { resolve({ id: 'one' }); await first })
  assert.equal(hook.current().isOpen, true)
  assert.equal(hook.current().draft.name, 'Segundo')
  assert.equal(hook.current().submitting, false)
})

test('product editor owns new, edit, cancel, submit and close-if-editing lifecycle', async (t) => {
  const creates = []
  const updates = []
  const created = { id: 'created', name: 'Suco' }
  const updated = { id: 'legacy', name: 'Família editada' }
  const hook = await mountHook(t, useProductEditor, {
    createProduct: async (payload) => { creates.push(payload); return created },
    updateProduct: async (id, payload) => { updates.push([id, payload]); return updated },
    writesBlocked: false,
    canManageProducts: true,
  })

  let opened
  await act(async () => { opened = hook.current().openNewProduct() })
  assert.equal(opened, true)
  assert.equal(hook.current().isOpen, true)
  assert.equal(hook.current().editing, false)
  assert.equal(hook.current().draft.price, 'R$ 32,00')

  await act(async () => {
    hook.current().replaceDraft({
      category: 'Bebidas', presentationType: 'volume', presentationValue: '1,5',
      presentationUnit: 'L', name: '  Suco  ', price: 'R$ 12,50',
    })
  })
  let submitted
  await act(async () => { submitted = await hook.current().submit() })
  assert.equal(submitted, true)
  assert.deepEqual(creates, [{
    category: 'Bebidas', presentationType: 'volume', presentationValue: '1,5',
    presentationUnit: 'L', name: 'Suco', price: 12.5,
  }])
  assert.equal(hook.current().isOpen, false)

  const legacy = { id: 'legacy', category: 'Categoria antiga', name: 'Família', price: 30, size: 'Família' }
  await act(async () => { hook.current().editProduct(legacy) })
  assert.equal(hook.current().editing, true)
  assert.equal(hook.current().draft.category, 'Outros')
  assert.equal(hook.current().draft.presentationType, 'size')
  assert.equal(hook.current().draft.presentationValue, 'Família')

  await act(async () => { hook.current().closeIfEditing('other') })
  assert.equal(hook.current().isOpen, true)
  await act(async () => { hook.current().closeIfEditing('legacy') })
  assert.equal(hook.current().isOpen, false)

  await act(async () => { hook.current().editProduct(legacy) })
  await act(async () => {
    hook.current().replaceDraft({ ...hook.current().draft, name: 'Família editada', price: 'R$ 31,00' })
  })
  await act(async () => { submitted = await hook.current().submit() })
  assert.equal(submitted, true)
  assert.deepEqual(updates, [['legacy', {
    category: 'Outros', presentationType: 'size', presentationValue: 'Família',
    presentationUnit: '', name: 'Família editada', price: 31,
  }]])
  assert.equal(hook.current().isOpen, false)
})

test('product editor keeps the draft open after controlled create or update failure', async (t) => {
  const hook = await mountHook(t, useProductEditor, {
    createProduct: async () => null,
    updateProduct: async () => null,
    writesBlocked: false,
    canManageProducts: true,
  })

  await act(async () => { hook.current().openNewProduct() })
  await act(async () => {
    hook.current().replaceDraft({ ...hook.current().draft, name: 'Falha' })
  })
  let result
  await act(async () => { result = await hook.current().submit() })
  assert.equal(result, false)
  assert.equal(hook.current().isOpen, true)
  assert.equal(hook.current().draft.name, 'Falha')

  await act(async () => { hook.current().editProduct({ id: 'p1', category: 'Bebidas', name: 'Água', price: 3, size: 'Un' }) })
  await act(async () => { result = await hook.current().submit() })
  assert.equal(result, false)
  assert.equal(hook.current().isOpen, true)
  assert.equal(hook.current().editing, true)

  await act(async () => { hook.current().cancel() })
  assert.equal(hook.current().isOpen, false)
  assert.equal(hook.current().editing, false)
})

test('product editor blocks opening and submitting without capability or while writes are blocked', async (t) => {
  for (const props of [
    { writesBlocked: true, canManageProducts: true },
    { writesBlocked: false, canManageProducts: false },
  ]) {
    let creates = 0
    let updates = 0
    const hook = await mountHook(t, useProductEditor, {
      ...props,
      createProduct: async () => { creates += 1; return {} },
      updateProduct: async () => { updates += 1; return {} },
    })
    assert.equal(hook.current().openNewProduct(), false)
    assert.equal(hook.current().editProduct({ id: 'p1', name: 'X', price: 1 }), false)
    assert.equal(await hook.current().submit(), false)
    assert.equal(hook.current().isOpen, false)
    assert.equal(creates, 0)
    assert.equal(updates, 0)
  }
})

test('Task 5 keeps product editor internals in Catalog and removes them from App', () => {
  const app = readFileSync(new URL('../../../App.jsx', import.meta.url), 'utf8')
  const workspace = readFileSync(new URL('../ui/CatalogWorkspace.jsx', import.meta.url), 'utf8')
  assert.doesNotMatch(app, /useProductEditor|ProductEditorDialog/)
  assert.match(workspace, /useProductEditor/)
  assert.match(workspace, /ProductEditorDialog/)
  for (const token of [
    'editingProductId', 'showProductForm', 'newProduct', 'emptyProduct',
    'productPayload', 'handleAddProduct', 'handleEditProduct', 'handleCancelProductEdit',
  ]) {
    assert.doesNotMatch(app, new RegExp(`\\b${token}\\b`))
  }
})
