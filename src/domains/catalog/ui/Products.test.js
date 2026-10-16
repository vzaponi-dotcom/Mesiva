import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { act, create } from 'react-test-renderer'
import { createUiHarness } from '../test-support/harness.js'

const products = [
  { id: 'a', name: 'Água', category: 'Bebidas', price: 3, presentationType: 'unit' },
  { id: 'b', name: 'Suco', category: 'Bebidas', price: 7.5, presentationType: 'volume', presentationValue: '350', presentationUnit: 'ml' },
  { id: 'c', name: 'Refrigerante', category: 'Bebidas', price: 8, size: 'Lata' },
]

async function renderProducts(t, overrides = {}) {
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis.navigator ?? {}, 'onLine')
  if (globalThis.navigator) Object.defineProperty(globalThis.navigator, 'onLine', { value: true, configurable: true })
  t.after(() => {
    if (!globalThis.navigator) return
    if (navigatorDescriptor) Object.defineProperty(globalThis.navigator, 'onLine', navigatorDescriptor)
    else delete globalThis.navigator.onLine
  })
  const h = await createUiHarness(t)
  const [{ default: Products }, { default: ConfirmationDialog }] = await Promise.all([
    h.load('/src/domains/catalog/ui/Products.jsx'),
    h.load('/src/shared/ui/ConfirmationDialog.jsx'),
  ])
  const props = {
    products,
    search: '',
    queryState: { categoryFilter: 'Todos' },
    currency: (value) => `R$ ${value}`,
    onSearchChange() {},
    onQueryChange() {},
    onAdd() {},
    onEdit() {},
    onDelete: async () => true,
    canManageProducts: true,
    ...overrides,
  }
  let renderer
  await act(async () => {
    renderer = create(React.createElement(Products, props))
  })
  t.after(async () => {
    await act(async () => renderer.unmount())
  })
  return { renderer, Products, ConfirmationDialog }
}

async function expandOnlyCategory(renderer) {
  await act(async () => {
    renderer.root.findByProps({ className: 'product-category-accordion-header' }).props.onClick()
  })
}

test('single delete closes confirmation after a controlled false result', async (t) => {
  const deleted = []
  const { renderer, ConfirmationDialog } = await renderProducts(t, {
    products: [products[0]],
    onDelete: async (id) => { deleted.push(id); return false },
  })
  await expandOnlyCategory(renderer)

  await act(async () => {
    renderer.root.findByProps({ 'aria-label': 'Ações de Água' }).props.onClick({ stopPropagation() {} })
  })
  const removeButton = renderer.root.findAllByType('button').find((node) => node.props.className === 'danger')
  assert.ok(removeButton)
  await act(async () => removeButton.props.onClick())

  assert.equal(renderer.root.findAllByType(ConfirmationDialog).length, 1)
  await act(async () => renderer.root.findByType(ConfirmationDialog).props.onConfirm())

  assert.deepEqual(deleted, ['a'])
  assert.equal(renderer.root.findAllByType(ConfirmationDialog).length, 0)
})

test('bulk delete remains sequential, continues after controlled false and clears selection', async (t) => {
  const calls = []
  let active = 0
  let maxActive = 0
  const gates = new Map()
  const onDelete = (id) => new Promise((resolve) => {
    calls.push(id)
    active += 1
    maxActive = Math.max(maxActive, active)
    gates.set(id, (value) => {
      active -= 1
      resolve(value)
    })
  })

  const { renderer, ConfirmationDialog } = await renderProducts(t, { onDelete })
  await expandOnlyCategory(renderer)

  await act(async () => {
    renderer.root.findByProps({ className: 'product-select-mode-button' }).props.onClick()
  })
  for (const name of ['Água', 'Suco', 'Refrigerante']) {
    await act(async () => {
      renderer.root.findByProps({ 'aria-label': `Selecionar ${name}` }).props.onClick({ stopPropagation() {} })
    })
  }

  await act(async () => {
    renderer.root.findByProps({ className: 'product-bulk-delete' }).props.onClick()
  })
  const dialog = renderer.root.findByType(ConfirmationDialog)
  let pending
  await act(async () => {
    pending = dialog.props.onConfirm()
    await Promise.resolve()
  })
  assert.deepEqual(calls, ['a'])
  assert.equal(renderer.root.findByProps({ className: 'product-selection-cancel' }).props.disabled, true)

  await act(async () => {
    gates.get('a')(true)
    await Promise.resolve()
  })
  assert.deepEqual(calls, ['a', 'b'])

  await act(async () => {
    gates.get('b')(false)
    await Promise.resolve()
  })
  assert.deepEqual(calls, ['a', 'b', 'c'])

  await act(async () => {
    gates.get('c')(true)
    await pending
  })

  assert.equal(maxActive, 1)
  assert.equal(renderer.root.findAllByProps({ className: 'product-selection-toolbar' }).length, 0)
  assert.equal(renderer.root.findAllByType(ConfirmationDialog).length, 0)
})

test('unexpected single-delete rejection releases pending without inventing success', async (t) => {
  const expected = new Error('boom')
  const { renderer, ConfirmationDialog } = await renderProducts(t, {
    products: [products[0]],
    onDelete: async () => { throw expected },
  })
  await expandOnlyCategory(renderer)
  await act(async () => {
    renderer.root.findByProps({ 'aria-label': 'Ações de Água' }).props.onClick({ stopPropagation() {} })
  })
  await act(async () => {
    renderer.root.findAllByType('button').find((node) => node.props.className === 'danger').props.onClick()
  })

  const dialog = renderer.root.findByType(ConfirmationDialog)
  await assert.rejects(async () => {
    await act(async () => dialog.props.onConfirm())
  }, (error) => error === expected)

  const stillOpen = renderer.root.findByType(ConfirmationDialog)
  assert.equal(stillOpen.props.disabled, false)
})

test('touch long press enters selection at 550ms, cancel events stop it and mouse never schedules it', async (t) => {
  const originalSetTimeout = globalThis.setTimeout
  const originalClearTimeout = globalThis.clearTimeout
  let sequence = 0
  const timers = new Map()
  t.after(() => {
    globalThis.setTimeout = originalSetTimeout
    globalThis.clearTimeout = originalClearTimeout
  })
  // Initialize Vite with real timers; fake only the gesture delay. Capturing
  // Vite/React timers can deadlock the harness or remove Timeout.unref().
  const { renderer } = await renderProducts(t, { products: [products[0]] })
  globalThis.setTimeout = (callback, delay, ...args) => {
    if (delay !== 550) return originalSetTimeout(callback, delay, ...args)
    const id = ++sequence
    timers.set(id, { callback, delay })
    return id
  }
  globalThis.clearTimeout = (id) => {
    if (Number.isInteger(id) && id > 0 && id <= sequence) timers.delete(id)
    else originalClearTimeout(id)
  }
  await expandOnlyCategory(renderer)

  const row = () => renderer.root.findAllByType('article').find((node) => String(node.props.className || '').startsWith('product-compact-row'))
  await act(async () => row().props.onPointerDown({ pointerType: 'touch' }))
  assert.equal([...timers.values()].filter((timer) => timer.delay === 550).length, 1)
  const first = [...timers.entries()].find(([, timer]) => timer.delay === 550)
  assert.ok(first, 'long-press timer should be scheduled for 550ms')
  assert.equal(renderer.root.findAllByProps({ className: 'product-selection-toolbar' }).length, 0)

  timers.delete(first[0])
  await act(async () => first[1].callback())
  assert.equal(renderer.root.findAllByProps({ className: 'product-selection-toolbar' }).length, 1)
  assert.ok(renderer.root.findByProps({ 'aria-label': 'Desmarcar Água' }))

  await act(async () => row().props.onClick())
  assert.ok(renderer.root.findByProps({ 'aria-label': 'Desmarcar Água' }))

  await act(async () => renderer.root.findByProps({ className: 'product-selection-cancel' }).props.onClick())
  for (const eventName of ['onPointerCancel', 'onPointerUp', 'onPointerLeave']) {
    await act(async () => row().props.onPointerDown({ pointerType: 'touch' }))
    const scheduled = [...timers.entries()].find(([, timer]) => timer.delay === 550)?.[0]
    assert.ok(scheduled)
    await act(async () => row().props[eventName]())
    assert.equal(timers.has(scheduled), false)
    assert.equal(renderer.root.findAllByProps({ className: 'product-selection-toolbar' }).length, 0)
  }

  const beforeMouse = [...timers.entries()].filter(([, timer]) => timer.delay === 550).length
  await act(async () => row().props.onPointerDown({ pointerType: 'mouse' }))
  const afterMouse = [...timers.entries()].filter(([, timer]) => timer.delay === 550).length
  assert.equal(afterMouse, beforeMouse)
})
