import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { act } from 'react-test-renderer'
import { workspaceHarness, buttonNamed, nodeText } from '../../../test-support/renderWorkspace.js'
import { comandaDetail, deferred } from '../../../test-support/comandaFixtures.js'
import { getBusinessDate } from '../../../../shared/finance.js'

const selectionA = { tableId: 'table-1', tableTabId: 'tab-A' }
const selectionB = { tableId: 'table-2', tableTabId: 'tab-B' }
const intentA = { ...selectionA, selectionGeneration: 4 }
const intentB = { ...selectionB, selectionGeneration: 5 }

const documentFor = (id = 'tab-A', number = 41) => ({
  type: 'table-tab',
  business: { name: 'Restaurante' },
  tableTab: { id, number, tableName: id === 'tab-A' ? 'Mesa 1' : 'Mesa 2' },
  items: [{ name: 'X-Bacon', presentation: 'Grande', note: 'Sem cebola', quantity: 1, unitPriceCents: 2500, lineTotalCents: 2500 }],
  financial: { totalCents: 2500 },
  message: 'PRÉ-CONTA — NÃO É COMPROVANTE DE PAGAMENTO',
})

const renderSurface = async (h, Component, props = {}) => {
  let actions
  const base = {
    selection: selectionA,
    selectionGeneration: 4,
    disabled: false,
    paymentOptions: [{ value: 'Pix', label: 'Pix', code: 'pix' }],
    defaultPaymentMethod: 'Pix',
    currency: (value) => `R$ ${value.toFixed(2)}`,
    printing: {
      getTableTabPreviewDocument: async () => documentFor(),
      printTableTab: async () => ({ status: 'printed' }),
    },
    children: (value) => {
      actions = value
      return React.createElement('div', { 'data-actions': true }, value.printingFeedback?.message || '')
    },
    ...props,
  }
  const renderer = await h.render(Component, base)
  return {
    renderer,
    actions: () => actions,
    update: async (next = {}) => act(async () => renderer.update(React.createElement(Component, { ...base, ...next }))),
  }
}

test('payment intent is owned by canonical identity/generation and closes on replacement', async (t) => {
  const h = await workspaceHarness(t)
  const { default: Surface } = await h.load('/src/app/surfaces/table-service/TableServiceExternalActions.jsx')
  const payments = []
  const { renderer, actions, update } = await renderSurface(h, Surface, {
    onPay: (...args) => { payments.push(args); return Promise.resolve(false) },
  })

  await act(async () => actions().requestPayment({ ...intentA, detail: comandaDetail }))
  assert.equal(renderer.root.findAllByProps({ role: 'dialog' }).length, 1)
  await act(async () => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }))
  assert.deepEqual(payments[0], ['tab-42', [{ methodCode: 'pix', amountCents: 12345 }], { ...intentA, detail: comandaDetail }, { receivedDate: getBusinessDate() }])

  await update({ selection: selectionB, selectionGeneration: 5 })
  assert.equal(renderer.root.findAllByProps({ role: 'dialog' }).length, 0)
})

test('preview owns only the current identity and validates the canonical document', async (t) => {
  const h = await workspaceHarness(t)
  const { default: Surface } = await h.load('/src/app/surfaces/table-service/TableServiceExternalActions.jsx')
  const calls = []
  const { renderer, actions } = await renderSurface(h, Surface, {
    printing: {
      getTableTabPreviewDocument: async (id) => { calls.push(id); return documentFor(id, 41) },
      printTableTab: async () => assert.fail('preview must not print'),
    },
  })

  await act(async () => actions().requestPreview(intentA))
  assert.deepEqual(calls, ['tab-A'])
  assert.match(nodeText(renderer.root.findByProps({ role: 'dialog' })), /Restaurante.*COMANDA #41.*Mesa 1.*X-Bacon/)
  await act(async () => buttonNamed(renderer.root.findByProps({ role: 'dialog' }), 'Fechar').props.onClick())
  assert.equal(renderer.root.findAllByProps({ role: 'dialog' }).length, 0)
})

test('manual print suppresses duplicate action, exposes retry feedback and toasts only success', async (t) => {
  const h = await workspaceHarness(t)
  const { default: Surface } = await h.load('/src/app/surfaces/table-service/TableServiceExternalActions.jsx')
  const first = deferred()
  let attempts = 0
  const toasts = []
  const { actions } = await renderSurface(h, Surface, {
    printing: {
      getTableTabPreviewDocument: async () => documentFor(),
      printTableTab: () => {
        attempts += 1
        return attempts === 1 ? first.promise : Promise.resolve({ status: 'printed' })
      },
    },
    onToast: (message) => toasts.push(message),
  })

  let pending
  await act(async () => {
    pending = actions().requestPrint(intentA)
    actions().requestPrint(intentA)
    first.reject(new Error('Impressora desconectada'))
    await pending
  })
  assert.equal(attempts, 1)
  assert.match(actions().printingFeedback?.message || '', /Impressora desconectada/)

  await act(async () => actions().requestPrint(intentA))
  assert.equal(attempts, 2)
  assert.deepEqual(toasts, ['Impressão enviada para a fila'])
  assert.equal(actions().printingFeedback, null)
})

test('late old preview cannot open, error, expire session or clear a newer busy action', async (t) => {
  const h = await workspaceHarness(t)
  const { default: Surface } = await h.load('/src/app/surfaces/table-service/TableServiceExternalActions.jsx')
  const oldPreview = deferred()
  const currentPrint = deferred()
  const sessionErrors = []
  const { renderer, actions, update } = await renderSurface(h, Surface, {
    printing: {
      getTableTabPreviewDocument: () => oldPreview.promise,
      printTableTab: () => currentPrint.promise,
    },
    onApiError: (error) => sessionErrors.push(error),
  })

  let previewPromise
  await act(async () => { previewPromise = actions().requestPreview(intentA); await Promise.resolve() })
  await update({ selection: selectionB, selectionGeneration: 5 })
  let printPromise
  await act(async () => { printPromise = actions().requestPrint(intentB); await Promise.resolve() })
  const staleError = Object.assign(new Error('Sessão antiga'), { status: 401 })
  await act(async () => oldPreview.reject(staleError))
  await previewPromise

  assert.deepEqual(sessionErrors, [])
  assert.equal(renderer.root.findAllByProps({ role: 'dialog' }).length, 0)
  assert.equal(actions().printingBusy, true)
  assert.equal(actions().printingFeedback, null)

  await act(async () => currentPrint.resolve({ status: 'printed' }))
  await printPromise
  assert.equal(actions().printingBusy, false)
})

test('payment and preview overlays release only their own shared scroll locks', async (t) => {
  const h = await workspaceHarness(t)
  const { default: Surface } = await h.load('/src/app/surfaces/table-service/TableServiceExternalActions.jsx')
  h.document.body.style.overflow = 'auto'
  const { renderer, actions } = await renderSurface(h, Surface)

  await act(async () => actions().requestPreview(intentA))
  await act(async () => actions().requestPayment({ ...intentA, detail: comandaDetail }))
  assert.equal(renderer.root.findAllByProps({ role: 'dialog' }).length, 2)
  assert.equal(h.document.body.style.overflow, 'hidden')

  await act(async () => buttonNamed(renderer.root.findAllByProps({ role: 'dialog' })[0], 'Fechar').props.onClick())
  assert.equal(renderer.root.findAllByProps({ role: 'dialog' }).length, 1)
  assert.equal(h.document.body.style.overflow, 'hidden')

  await act(async () => buttonNamed(renderer.root.findByProps({ role: 'dialog' }), 'Fechar').props.onClick())
  assert.equal(h.document.body.style.overflow, 'auto')
})


test('preview failure remains actionable and retry opens only the successful document', async (t) => {
  const h = await workspaceHarness(t)
  const { default: Surface } = await h.load('/src/app/surfaces/table-service/TableServiceExternalActions.jsx')
  let attempts = 0
  const { renderer, actions } = await renderSurface(h, Surface, {
    printing: {
      getTableTabPreviewDocument: async () => {
        attempts += 1
        if (attempts === 1) throw new Error('Não foi possível atualizar o ticket')
        return documentFor()
      },
      printTableTab: async () => ({ status: 'printed' }),
    },
  })

  await act(async () => actions().requestPreview(intentA))
  assert.match(actions().printingFeedback?.message || '', /Não foi possível atualizar o ticket/)
  assert.equal(renderer.root.findAllByProps({ role: 'dialog' }).length, 0)

  await act(async () => actions().requestPreview(intentA))
  assert.equal(attempts, 2)
  assert.equal(actions().printingFeedback, null)
  assert.equal(renderer.root.findAllByProps({ role: 'dialog' }).length, 1)
})

test('open preview closes and releases its lock when visual ownership is replaced', async (t) => {
  const h = await workspaceHarness(t)
  const { default: Surface } = await h.load('/src/app/surfaces/table-service/TableServiceExternalActions.jsx')
  h.document.body.style.overflow = 'scroll'
  const { renderer, actions, update } = await renderSurface(h, Surface)

  await act(async () => actions().requestPreview(intentA))
  assert.equal(renderer.root.findAllByProps({ role: 'dialog' }).length, 1)
  assert.equal(h.document.body.style.overflow, 'hidden')

  await update({ selection: selectionB, selectionGeneration: 5 })
  assert.equal(renderer.root.findAllByProps({ role: 'dialog' }).length, 0)
  assert.equal(h.document.body.style.overflow, 'scroll')
})
