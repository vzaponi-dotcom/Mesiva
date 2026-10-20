import test from 'node:test'
import assert from 'node:assert/strict'
import { act } from 'react-test-renderer'

import { buttonNamed, nodeText, workspaceHarness } from '../../../../test-support/renderWorkspace.js'

test('editor shell presents readonly values without editable save actions', async (t) => {
  const h = await workspaceHarness(t)
  const { default: SettingsEditorShell } = await h.load('/src/app/surfaces/settings/components/SettingsEditorShell.jsx')
  const screen = await h.render(SettingsEditorShell, {
    title: 'Categorias financeiras', description: 'Categorias usadas em lançamentos.', scope: 'Todo o negócio',
    effectiveNotice: 'Vale para novos lançamentos.', state: { status: 'ready' }, readOnly: true,
    onSave() {}, onDiscard() {}, children: 'Categorias confirmadas',
  })

  assert.match(nodeText(screen.root), /Somente leitura/)
  assert.match(nodeText(screen.root), /Categorias confirmadas/)
  assert.equal(buttonNamed(screen.root, 'Salvar alterações'), undefined)
  assert.equal(buttonNamed(screen.root, 'Descartar'), undefined)
})

test('editor shell announces controller errors accessibly', async (t) => {
  const h = await workspaceHarness(t)
  const { default: SettingsEditorShell } = await h.load('/src/app/surfaces/settings/components/SettingsEditorShell.jsx')
  const screen = await h.render(SettingsEditorShell, {
    title: 'Operação', description: 'Tempos da cozinha.', scope: 'Todo o negócio', effectiveNotice: '',
    state: { status: 'error', error: new Error('Conexão indisponível.') }, readOnly: false,
    onSave() {}, onDiscard() {}, children: null,
  })
  const error = screen.root.findByProps({ role: 'alert' })
  assert.match(nodeText(error), /Conexão indisponível/)
})

test('editor shell exposes a pending-draft status without saving automatically', async (t) => {
  const h = await workspaceHarness(t)
  const { default: SettingsEditorShell } = await h.load('/src/app/surfaces/settings/components/SettingsEditorShell.jsx')
  let saves = 0
  const screen = await h.render(SettingsEditorShell, {
    title: 'Operação', description: 'Tempos da cozinha.', scope: 'Todo o negócio', effectiveNotice: '',
    state: { status: 'ready', dirty: true }, readOnly: false,
    onSave: () => { saves += 1 }, onDiscard() {}, children: null,
  })

  assert.match(screen.root.findAllByProps({ role: 'status' }).map(nodeText).join(' '), /alterações pendentes/i)
  assert.equal(saves, 0)
})

test('editor shell announces loading, saving, unconfirmed and conflict states, and invokes explicit actions', async (t) => {
  const h = await workspaceHarness(t)
  const { default: SettingsEditorShell } = await h.load('/src/app/surfaces/settings/components/SettingsEditorShell.jsx')
  const messages = {
    loading: /Carregando configurações/,
    saving: /Salvando alterações/,
    unconfirmed: /ainda precisa de confirmação/,
    conflict: /alterações concorrentes/,
  }
  for (const [status, message] of Object.entries(messages)) {
    const screen = await h.render(SettingsEditorShell, {
      title: 'Operação', description: 'Tempos da cozinha.', scope: 'Todo o negócio', effectiveNotice: '',
      state: { status }, readOnly: false, onSave() {}, onDiscard() {}, children: null,
    })
    assert.match(nodeText(screen.root), message)
    if (status === 'loading') assert.equal(buttonNamed(screen.root, 'Salvar alterações'), undefined)
    if (status === 'conflict') assert.equal(screen.root.findByProps({ role: 'alert' }).props.role, 'alert')
  }

  const calls = []
  const ready = await h.render(SettingsEditorShell, {
    title: 'Operação', description: 'Tempos da cozinha.', scope: 'Todo o negócio', effectiveNotice: '',
    state: { status: 'ready' }, readOnly: false, onSave: () => calls.push('save'), onDiscard: () => calls.push('discard'), children: null,
  })
  await act(async () => buttonNamed(ready.root, 'Salvar alterações').props.onClick())
  await act(async () => buttonNamed(ready.root, 'Descartar').props.onClick())
  assert.deepEqual(calls, ['save', 'discard'])
})

test('editor shell exposes only controller-valid recovery actions for blocked and failed states', async (t) => {
  const h = await workspaceHarness(t)
  const { default: SettingsEditorShell } = await h.load('/src/app/surfaces/settings/components/SettingsEditorShell.jsx')
  const calls = []
  const props = {
    title: 'Operação', description: 'Tempos da cozinha.', scope: 'Todo o negócio', effectiveNotice: '', readOnly: false,
    onSave: () => calls.push('save'), onDiscard: () => calls.push('discard'),
    onReconcile: () => calls.push('reconcile'), onReload: () => calls.push('reload'), onReviewConflict: () => calls.push('review'),
    children: null,
  }

  const unconfirmed = await h.render(SettingsEditorShell, { ...props, state: { status: 'unconfirmed', draft: {} } })
  assert.equal(buttonNamed(unconfirmed.root, 'Salvar alterações').props.disabled, true)
  assert.equal(buttonNamed(unconfirmed.root, 'Descartar').props.disabled, true)
  await act(async () => buttonNamed(unconfirmed.root, 'Reconsultar').props.onClick())

  const conflict = await h.render(SettingsEditorShell, { ...props, state: { status: 'conflict', draft: {} } })
  assert.equal(buttonNamed(conflict.root, 'Salvar alterações').props.disabled, true)
  assert.equal(buttonNamed(conflict.root, 'Descartar').props.disabled, false)
  await act(async () => buttonNamed(conflict.root, 'Revisar alterações').props.onClick())

  const failedSave = await h.render(SettingsEditorShell, {
    ...props, state: { status: 'error', dirty: true, draft: {}, confirmed: { data: {} }, error: 'Falha conclusiva.' },
  })
  assert.equal(buttonNamed(failedSave.root, 'Salvar alterações').props.disabled, false)
  assert.equal(buttonNamed(failedSave.root, 'Descartar').props.disabled, false)

  const failedLoad = await h.render(SettingsEditorShell, { ...props, state: { status: 'error', error: 'Falha de leitura.' } })
  assert.equal(buttonNamed(failedLoad.root, 'Salvar alterações').props.disabled, true)
  assert.equal(buttonNamed(failedLoad.root, 'Descartar').props.disabled, true)
  await act(async () => buttonNamed(failedLoad.root, 'Reconsultar').props.onClick())

  assert.deepEqual(calls, ['reconcile', 'review', 'reload'])
})

test('item dialog changes the draft through onAdd and never calls save itself', async (t) => {
  const h = await workspaceHarness(t)
  const { default: SettingsItemDialog } = await h.load('/src/app/surfaces/settings/components/SettingsItemDialog.jsx')
  const additions = []
  let saves = 0
  const screen = await h.render(SettingsItemDialog, {
    open: true, kind: 'cancellation', initialValue: '', onAdd: (value) => additions.push(value),
    onClose() {}, onSave() { saves += 1 },
  })
  const input = screen.root.findAllByType('input').find((node) => node.props.type === 'text')
  await act(async () => input.props.onChange({ target: { value: 'Endereço incompleto' } }))
  await act(async () => buttonNamed(screen.root, 'Adicionar à lista').props.onClick())

  assert.deepEqual(additions, ['Endereço incompleto'])
  assert.equal(saves, 0)
})

test('finance dialog uses the existing modal Escape close and focus restoration behavior', async (t) => {
  const h = await workspaceHarness(t)
  const { default: SettingsItemDialog } = await h.load('/src/app/surfaces/settings/components/SettingsItemDialog.jsx')
  let closed = 0
  let restored = 0
  h.document.activeElement = { focus: () => { restored += 1 } }
  h.document.querySelectorAll = () => [null]
  const screen = await h.render(SettingsItemDialog, {
    open: true, kind: 'finance', initialValue: 'Taxa', onAdd() {}, onClose: () => { closed += 1 },
  })
  assert.ok(screen.root.findByProps({ role: 'dialog' }))
  assert.equal(screen.root.findByType('input').props.value, 'Taxa')
  await act(async () => h.document.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' })))
  assert.equal(closed, 1)
  await act(async () => screen.unmount())
  assert.equal(restored, 1)
})

test('finance dialog selects income or expense and returns only a draft item', async (t) => {
  const h = await workspaceHarness(t)
  const { default: SettingsItemDialog } = await h.load('/src/app/surfaces/settings/components/SettingsItemDialog.jsx')
  const additions = []
  let closed = 0
  const screen = await h.render(SettingsItemDialog, {
    open: true, kind: 'finance', initialValue: { label: '', type: 'entrada' },
    onAdd: (value) => additions.push(value), onClose: () => { closed += 1 },
  })

  const type = screen.root.findByProps({ role: 'combobox' })
  assert.equal(type.props['aria-label'], 'Tipo')
  await act(async () => type.props.onClick())
  await act(async () => buttonNamed(screen.root, 'Saída').props.onClick())
  await act(async () => screen.root.findByType('input').props.onChange({ target: { value: 'Marketing' } }))
  await act(async () => buttonNamed(screen.root, 'Adicionar à lista').props.onClick())

  assert.deepEqual(additions, [{ label: 'Marketing', type: 'saida' }])
  assert.equal(closed, 1)
})

test('item dialog keeps validation failures open and announces the duplicate', async (t) => {
  const h = await workspaceHarness(t)
  const { default: SettingsItemDialog } = await h.load('/src/app/surfaces/settings/components/SettingsItemDialog.jsx')
  let closed = 0
  const screen = await h.render(SettingsItemDialog, {
    open: true, kind: 'cancellation', initialValue: '',
    onAdd: () => 'Já existe um item com esse nome.', onClose: () => { closed += 1 },
  })

  const input = screen.root.findAllByType('input').find((node) => node.props.type === 'text')
  await act(async () => input.props.onChange({ target: { value: 'Cliente desistiu' } }))
  await act(async () => buttonNamed(screen.root, 'Adicionar à lista').props.onClick())

  assert.equal(closed, 0)
  assert.match(nodeText(screen.root.findByProps({ role: 'alert' })), /já existe/i)
})

test('item dialog associates validation errors and returns focus to the invalid name', async (t) => {
  const h = await workspaceHarness(t)
  const { default: SettingsItemDialog } = await h.load('/src/app/surfaces/settings/components/SettingsItemDialog.jsx')
  let focused = 0
  const screen = await h.render(SettingsItemDialog, {
    open: true, kind: 'cancellation', initialValue: '',
    onAdd: () => 'Já existe um item com esse nome.', onClose() {},
  }, {
    createNodeMock: (element) => element.type === 'input'
      ? { focus: () => { focused += 1 } }
      : { querySelectorAll: () => [] },
  })

  const input = screen.root.findAllByType('input').find((node) => node.props.type === 'text')
  await act(async () => input.props.onChange({ target: { value: 'Cliente desistiu' } }))
  await act(async () => buttonNamed(screen.root, 'Adicionar à lista').props.onClick())

  const error = screen.root.findByProps({ role: 'alert' })
  assert.equal(input.props['aria-invalid'], true)
  assert.equal(input.props['aria-describedby'], error.props.id)
  assert.equal(focused, 1)
})

test('item dialog reports an empty name instead of exposing a dead submit action', async (t) => {
  const h = await workspaceHarness(t)
  const { default: SettingsItemDialog } = await h.load('/src/app/surfaces/settings/components/SettingsItemDialog.jsx')
  const screen = await h.render(SettingsItemDialog, {
    open: true, kind: 'cancellation', initialValue: '', onAdd() {}, onClose() {},
  })

  const submit = buttonNamed(screen.root, 'Adicionar à lista')
  assert.notEqual(submit.props.disabled, true)
  await act(async () => submit.props.onClick())
  assert.match(nodeText(screen.root.findByProps({ role: 'alert' })), /informe um nome/i)
})

test('item list keeps disabled action reasons available to keyboard users', async (t) => {
  const h = await workspaceHarness(t)
  const { default: SettingsItemList } = await h.load('/src/app/surfaces/settings/components/SettingsItemList.jsx')
  const screen = await h.render(SettingsItemList, {
    label: 'Motivos de cancelamento', items: [{ id: 'other', label: 'Outro', active: true }],
    getActions: () => [{ id: 'delete', label: 'Excluir', disabledReason: 'Motivo nativo protegido.' }], onAction() {},
  })
  const action = buttonNamed(screen.root, 'Excluir')
  assert.equal(action.props.disabled, true)
  assert.equal(action.props.title, 'Motivo nativo protegido.')
  assert.ok(action.props['aria-describedby'])
  assert.equal(screen.root.findByProps({ id: action.props['aria-describedby'] }).children.join(''), 'Motivo nativo protegido.')
  assert.match(nodeText(screen.root), /Motivo nativo protegido/)
})

test('mobile harness renders settings items as actionable rows instead of a squeezed table', async (t) => {
  const h = await workspaceHarness(t, { mobile: true })
  const { default: SettingsItemList } = await h.load('/src/app/surfaces/settings/components/SettingsItemList.jsx')
  const calls = []
  const screen = await h.render(SettingsItemList, {
    label: 'Categorias financeiras', items: [{ id: 'delivery', label: 'Taxa de entrega', active: true }],
    getActions: () => [{ id: 'edit', label: 'Editar' }], onAction: (item, action) => calls.push([item.id, action]),
  })
  const row = screen.root.findByProps({ className: 'settings-item-row' })
  const action = buttonNamed(row, 'Editar')
  assert.equal(h.media.matches, true)
  assert.equal(screen.root.findAllByType('table').length, 0)
  assert.equal(row.props.style, undefined)
  assert.equal(action.props.type, 'button')
  await act(async () => action.props.onClick())
  assert.deepEqual(calls, [['delivery', 'edit']])
})


test('editor shell can block only Save for offline writes while keeping discard available', async (t) => {
  const h = await workspaceHarness(t)
  const { default: SettingsEditorShell } = await h.load('/src/app/surfaces/settings/components/SettingsEditorShell.jsx')
  let saves = 0
  let discards = 0
  const screen = await h.render(SettingsEditorShell, {
    title: 'Identidade da operação',
    description: 'Dados do estabelecimento.',
    scope: 'Configurações',
    state: { status: 'ready', dirty: true, draft: {} },
    readOnly: false,
    saveBlocked: true,
    saveBlockedMessage: 'Sem conexão. Reconecte para salvar.',
    onSave: () => { saves += 1 },
    onDiscard: () => { discards += 1 },
    children: null,
  })

  assert.equal(buttonNamed(screen.root, 'Salvar alterações').props.disabled, true)
  assert.equal(buttonNamed(screen.root, 'Descartar').props.disabled, false)
  assert.match(nodeText(screen.root), /Sem conexão/)
  await act(async () => buttonNamed(screen.root, 'Salvar alterações').props.onClick())
  await act(async () => buttonNamed(screen.root, 'Descartar').props.onClick())
  assert.equal(saves, 0)
  assert.equal(discards, 1)
})
