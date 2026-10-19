import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { act } from 'react-test-renderer'
import { readFile } from 'node:fs/promises'

import { buttonNamed, nodeText, workspaceHarness } from '../../../test-support/renderWorkspace.js'
import { adminFixture } from '../../../test-support/settingsFixtures.js'

const resourceState = () => ({
  status: 'ready',
  confirmed: adminFixture,
  base: adminFixture,
  draft: structuredClone(adminFixture.data),
  dirty: false,
})

const timingInput = (root, name) => root.findAllByType('input').find((input) => input.props.name === name)
const modalityRow = (root, name) => root.findByProps({ 'data-modality': name })

async function renderEditable(h, OperationSettings, initialState = resourceState(), initialSection = 'timing', options = {}) {
  const edits = []
  let saves = 0
  function Editor() {
    const [state, setState] = React.useState(initialState)
    return React.createElement(OperationSettings, {
      resourceState: state,
      initialSection,
      readOnly: false,
      onEdit: (draft) => {
        edits.push(draft)
        setState((current) => ({ ...current, draft, dirty: true }))
      },
      onSave: () => { saves += 1 },
      onDiscard() {}, onReconcile() {}, onReload() {}, onReviewConflict() {},
    })
  }
  return { screen: await h.render(Editor, {}, options), edits, saved: () => saves }
}

test('Operation and Modalities routes open one shared operations resource', async (t) => {
  const h = await workspaceHarness(t)
  h.document.documentElement.dataset = {}
  const [{ default: Settings }, { ThemeProvider }] = await Promise.all([
    h.load('/src/test-support/SettingsSurfaceTestContext.jsx'),
    h.load('/src/app/shell/theme/ThemeProvider.jsx'),
  ])
  const loaded = []
  const operations = {
    resources: { operations: resourceState() },
    load: (resource) => loaded.push(resource),
    edit() {}, save() {}, discard() {}, reconcile() {}, reviewConflict() {},
  }
  const props = {
    settings: {}, printing: {}, granted: new Set(['operations.settings.view', 'operations.settings.manage']),
    implemented: new Set(['settings-home', 'settings-operations', 'settings-modalities']),
    onNavigate() {}, soundEnabled: true, onSoundEnabledChange() {}, policyEditing: operations,
  }

  const Timing = () => React.createElement(ThemeProvider, null, React.createElement(Settings, { ...props, section: 'settings-operations' }))
  const timing = await h.render(Timing)
  assert.match(nodeText(timing.root), /Tempos e regras operacionais/)
  assert.equal(timing.root.findAllByProps({ className: 'area-navigation' }).length, 0)

  const Modalities = () => React.createElement(ThemeProvider, null, React.createElement(Settings, { ...props, section: 'settings-modalities' }))
  const modalities = await h.render(Modalities)
  assert.match(nodeText(modalities.root), /Modalidades de pedido/)
  assert.deepEqual(loaded, ['operations', 'operations'])
  assert.equal(operations.resources.operations.draft.timing.scheduledPrepLeadMinutes, adminFixture.data.timing.scheduledPrepLeadMinutes)
})

test('confirmed operation save acknowledges on its button and failed save has no success', async (t) => {
  const h = await workspaceHarness(t)
  h.document.documentElement.dataset = {}
  const [{ default: Settings }, { ThemeProvider }] = await Promise.all([
    h.load('/src/test-support/SettingsSurfaceTestContext.jsx'), h.load('/src/app/shell/theme/ThemeProvider.jsx'),
  ])
  const messages = []
  let saveResult = true
  const controller = {
    resources: { operations: { ...resourceState(), dirty: true } },
    load() {}, edit() {}, discard() {}, reconcile() {}, reviewConflict() {},
    save: async () => saveResult,
  }
  const Page = () => React.createElement(ThemeProvider, null, React.createElement(Settings, {
    section: 'settings-operations', settings: {}, printing: {},
    granted: new Set(['operations.settings.view', 'operations.settings.manage']),
    implemented: new Set(['settings-home', 'settings-operations']),
    onNavigate() {}, soundEnabled: true, onSoundEnabledChange() {}, policyEditing: controller,
    onSuccessMessage: (message) => messages.push(message),
  }))
  const screen = await h.render(Page)
  t.mock.timers.enable({ apis: ['setTimeout'] })

  await act(async () => buttonNamed(screen.root, 'Salvar altera\u00e7\u00f5es').props.onClick())
  assert.equal(nodeText(buttonNamed(screen.root, 'Salvar alterações').findByProps({ role: 'status' })), 'Salvo')
  assert.deepEqual(messages, [])
  await act(async () => t.mock.timers.tick(1800))

  saveResult = false
  await act(async () => buttonNamed(screen.root, 'Salvar altera\u00e7\u00f5es').props.onClick())
  assert.equal(nodeText(buttonNamed(screen.root, 'Salvar alterações').findByProps({ role: 'status' })), '')
  assert.equal(messages.length, 0)
})

test('operation Cancel delegates to the explicit discard-and-return action', async (t) => {
  const h = await workspaceHarness(t)
  h.document.documentElement.dataset = {}
  const [{ default: Settings }, { ThemeProvider }] = await Promise.all([
    h.load('/src/test-support/SettingsSurfaceTestContext.jsx'), h.load('/src/app/shell/theme/ThemeProvider.jsx'),
  ])
  const navigations = []
  const controller = {
    resources: { operations: { ...resourceState(), dirty: true } },
    load() {}, edit() {}, save() {}, discard() {}, reconcile() {}, reviewConflict() {},
  }
  const Page = () => React.createElement(ThemeProvider, null, React.createElement(Settings, {
    section: 'settings-operations', settings: {}, printing: {},
    granted: new Set(['operations.settings.view', 'operations.settings.manage']),
    implemented: new Set(['settings-home', 'settings-operations']),
    onNavigate: (target) => navigations.push(target), soundEnabled: true, onSoundEnabledChange() {}, policyEditing: controller,
  }))
  const screen = await h.render(Page)

  await act(async () => buttonNamed(screen.root, 'Cancelar').props.onClick())
  assert.deepEqual(navigations, ['settings-home'])
})

test('switching between Operation and Modalities preserves one draft in both directions', async (t) => {
  const h = await workspaceHarness(t)
  h.document.documentElement.dataset = {}
  const [{ default: Settings }, { ThemeProvider }] = await Promise.all([
    h.load('/src/test-support/SettingsSurfaceTestContext.jsx'), h.load('/src/app/shell/theme/ThemeProvider.jsx'),
  ])
  function RoutedSettings() {
    const [section, setSection] = React.useState('settings-operations')
    const [operationsState, setOperationsState] = React.useState(resourceState())
    const controller = {
      resources: { operations: operationsState }, load() {}, save() {}, discard() {}, reconcile() {}, reviewConflict() {},
      edit: (_resource, draft) => setOperationsState((current) => ({ ...current, draft, dirty: true })),
    }
    return React.createElement(ThemeProvider, null,
      React.createElement('button', { onClick: () => setSection('settings-modalities') }, 'Abrir modalidades'),
      React.createElement('button', { onClick: () => setSection('settings-operations') }, 'Abrir operação'),
      React.createElement(Settings, {
      section, settings: {}, printing: {},
      granted: new Set(['operations.settings.view', 'operations.settings.manage']),
      implemented: new Set(['settings-home', 'settings-operations', 'settings-modalities']),
      onNavigate: setSection, soundEnabled: true, onSoundEnabledChange() {}, policyEditing: controller,
    }))
  }
  const screen = await h.render(RoutedSettings)

  await act(async () => timingInput(screen.root, 'scheduledPrepLeadMinutes').props.onChange({ target: { value: '40' } }))
  await act(async () => buttonNamed(screen.root, 'Abrir modalidades').props.onClick())
  assert.equal(timingInput(screen.root, 'scheduledPrepLeadMinutes').props.value, '40')
  await act(async () => buttonNamed(modalityRow(screen.root, 'Retirada'), 'Definir como padrão').props.onClick({ currentTarget: { closest: () => null } }))
  await act(async () => buttonNamed(screen.root, 'Abrir operação').props.onClick())
  assert.equal(timingInput(screen.root, 'scheduledPrepLeadMinutes').props.value, '40')
  assert.match(nodeText(modalityRow(screen.root, 'Retirada')), /Padrão/)
})

test('timing entry renders four bounded minute fields and edits only the shared draft', async (t) => {
  const h = await workspaceHarness(t)
  const { default: OperationSettings } = await h.load('/src/app/surfaces/settings/OperationSettings.jsx')
  const fixture = await renderEditable(h, OperationSettings)
  const fields = [
    ['scheduledPrepLeadMinutes', 0, 240],
    ['scheduledLateGraceMinutes', 0, 120],
    ['immediateLateAfterMinutes', 1, 180],
    ['immediateVeryLateAfterMinutes', 1, 240],
  ]

  assert.equal(fixture.screen.root.findByProps({ id: 'settings-timing' }).props.className.includes('is-selected'), true)
  for (const [name, min, max] of fields) {
    const input = timingInput(fixture.screen.root, name)
    assert.equal(input.props.type, 'number')
    assert.equal(input.props.inputMode, 'numeric')
    assert.equal(input.props.min, min)
    assert.equal(input.props.max, max)
    assert.equal(input.props.step, 1)
  }
  assert.match(nodeText(fixture.screen.root), /Essas configurações organizam a fila da cozinha/)

  await act(async () => timingInput(fixture.screen.root, 'scheduledPrepLeadMinutes').props.onChange({ target: { value: '40' } }))
  assert.equal(fixture.edits.at(-1).timing.scheduledPrepLeadMinutes, 40)
  assert.equal(fixture.edits.at(-1).defaultModality, 'Entrega')
  assert.equal(fixture.saved(), 0)
})

test('timing validation keeps invalid values in the draft, links errors and blocks save', async (t) => {
  const h = await workspaceHarness(t)
  const { default: OperationSettings } = await h.load('/src/app/surfaces/settings/OperationSettings.jsx')
  const focused = []
  const fixture = await renderEditable(h, OperationSettings, resourceState(), 'timing', {
    createNodeMock: ({ props }) => ({ focus: () => focused.push(props.name || props.id), scrollIntoView() {} }),
  })

  await act(async () => timingInput(fixture.screen.root, 'scheduledPrepLeadMinutes').props.onChange({ target: { value: '241' } }))
  let input = timingInput(fixture.screen.root, 'scheduledPrepLeadMinutes')
  assert.equal(input.props['aria-invalid'], true)
  assert.ok(input.props['aria-describedby'])
  assert.match(nodeText(fixture.screen.root.findByProps({ id: input.props['aria-describedby'].split(' ').at(-1) })), /0 e 240/)
  await act(async () => buttonNamed(fixture.screen.root, 'Salvar alterações').props.onClick())
  assert.equal(fixture.saved(), 0)
  assert.equal(focused.at(-1), 'scheduledPrepLeadMinutes')

  await act(async () => input.props.onChange({ target: { value: '40' } }))
  await act(async () => timingInput(fixture.screen.root, 'immediateVeryLateAfterMinutes').props.onChange({ target: { value: '30' } }))
  input = timingInput(fixture.screen.root, 'immediateVeryLateAfterMinutes')
  assert.equal(input.props['aria-invalid'], true)
  assert.match(nodeText(fixture.screen.root.findByProps({ id: input.props['aria-describedby'].split(' ').at(-1) })), /maior que/i)
  assert.equal(fixture.saved(), 0)

  for (const [name, invalid] of [
    ['scheduledLateGraceMinutes', '-1'],
    ['immediateLateAfterMinutes', '181'],
    ['immediateVeryLateAfterMinutes', '241'],
  ]) {
    await act(async () => timingInput(fixture.screen.root, name).props.onChange({ target: { value: invalid } }))
    assert.equal(timingInput(fixture.screen.root, name).props['aria-invalid'], true)
  }
})

test('modality entry focuses its block and preserves timing while default and activation change independently', async (t) => {
  const h = await workspaceHarness(t)
  const { default: OperationSettings } = await h.load('/src/app/surfaces/settings/OperationSettings.jsx')
  const draft = structuredClone(adminFixture.data)
  draft.timing.scheduledPrepLeadMinutes = 40
  const focused = []
  const scrolled = []
  const fixture = await renderEditable(h, OperationSettings, { ...resourceState(), draft, dirty: true }, 'modalities', {
    createNodeMock: ({ props }) => ({ focus: () => focused.push(props.id || props.name), scrollIntoView: () => scrolled.push(props.id || props.name) }),
  })

  assert.equal(fixture.screen.root.findByProps({ id: 'settings-modalities' }).props.className.includes('is-selected'), true)
  assert.deepEqual(focused, ['settings-modalities'])
  assert.deepEqual(scrolled, ['settings-modalities'])
  assert.deepEqual(fixture.screen.root.findAll((node) => typeof node.props?.['data-modality'] === 'string').map((row) => row.props['data-modality']), ['Entrega', 'Retirada', 'Local'])
  assert.equal(modalityRow(fixture.screen.root, 'Entrega').findByProps({ role: 'switch' }).props.disabled, true)

  await act(async () => buttonNamed(modalityRow(fixture.screen.root, 'Retirada'), 'Definir como padrão').props.onClick({ currentTarget: { closest: () => null } }))
  assert.equal(fixture.edits.at(-1).defaultModality, 'Retirada')
  assert.deepEqual(fixture.edits.at(-1).enabledModalities, ['Entrega', 'Retirada', 'Local'])
  assert.equal(fixture.edits.at(-1).timing.scheduledPrepLeadMinutes, 40)

  await act(async () => modalityRow(fixture.screen.root, 'Entrega').findByProps({ role: 'switch' }).props.onClick())
  assert.deepEqual(fixture.edits.at(-1).enabledModalities, ['Retirada', 'Local'])
  assert.equal(fixture.edits.at(-1).defaultModality, 'Retirada')
  assert.equal(fixture.saved(), 0)
  assert.deepEqual(focused, ['settings-modalities'])
})

test('modality controls never create a draft without an active and active default modality', async (t) => {
  const h = await workspaceHarness(t)
  const { default: OperationSettings } = await h.load('/src/app/surfaces/settings/OperationSettings.jsx')
  const draft = structuredClone(adminFixture.data)
  draft.enabledModalities = ['Entrega']
  const fixture = await renderEditable(h, OperationSettings, { ...resourceState(), draft })
  const deactivateDefault = modalityRow(fixture.screen.root, 'Entrega').findByProps({ role: 'switch' })

  assert.equal(deactivateDefault.props.disabled, true)
  assert.match(nodeText(modalityRow(fixture.screen.root, 'Entrega')), /Defina outra modalidade ativa como padrão/i)
  assert.equal(buttonNamed(modalityRow(fixture.screen.root, 'Retirada'), 'Definir como padrão').props.disabled, true)
  assert.equal(fixture.edits.length, 0)
})

test('an error in the other block remains visible and has an accessible jump', async (t) => {
  const h = await workspaceHarness(t)
  const { default: OperationSettings } = await h.load('/src/app/surfaces/settings/OperationSettings.jsx')
  const draft = structuredClone(adminFixture.data)
  draft.timing.scheduledPrepLeadMinutes = 241
  draft.timing.immediateVeryLateAfterMinutes = 20
  const focused = []
  const screen = await h.render(OperationSettings, {
    resourceState: { ...resourceState(), draft, dirty: true }, initialSection: 'modalities', readOnly: false,
    onEdit() {}, onSave() {}, onDiscard() {},
  }, { createNodeMock: ({ props }) => ({ focus: () => focused.push(props.id || props.name), scrollIntoView() {} }) })

  const jump = buttonNamed(screen.root, 'Ver 2 pendências em Tempos e regras operacionais')
  assert.ok(jump)
  assert.match(nodeText(screen.root), /2 pendências/)
  assert.match(nodeText(screen.root), /maior que/i)
  await act(async () => jump.props.onClick())
  assert.equal(focused.at(-1), 'settings-timing')
})

test('review action presents the conflict returned by the shared controller', async (t) => {
  const h = await workspaceHarness(t)
  h.document.documentElement.dataset = {}
  const [{ default: Settings }, { ThemeProvider }] = await Promise.all([
    h.load('/src/test-support/SettingsSurfaceTestContext.jsx'), h.load('/src/app/shell/theme/ThemeProvider.jsx'),
  ])
  const review = { reviewId: 'review-2', resource: 'operations' }
  const presented = []
  const controller = {
    resources: { operations: { ...resourceState(), status: 'conflict' } },
    load() {}, edit() {}, save() {}, discard() {}, reconcile() {}, reviewConflict: async () => review,
  }
  const Page = () => React.createElement(ThemeProvider, null, React.createElement(Settings, {
    section: 'settings-operations', settings: {}, printing: {},
    granted: new Set(['operations.settings.view', 'operations.settings.manage']),
    implemented: new Set(['settings-home', 'settings-operations', 'settings-modalities']),
    onNavigate() {}, soundEnabled: true, onSoundEnabledChange() {}, policyEditing: {
      ...controller,
      activeConflict: null,
      acceptActiveConflict() {}, dismissActiveConflict() {}, reset() {},
      reviewConflict: async (...args) => {
        const value = await controller.reviewConflict(...args)
        presented.push(value)
        return value
      },
    },
  }))
  const screen = await h.render(Page)

  await act(async () => buttonNamed(screen.root, 'Revisar alterações').props.onClick())
  assert.deepEqual(presented, [review])
})

test('read-only and controller states use the shared shell without editable actions', async (t) => {
  const h = await workspaceHarness(t)
  const { default: OperationSettings } = await h.load('/src/app/surfaces/settings/OperationSettings.jsx')
  for (const [status, message] of Object.entries({
    loading: /Carregando configurações/,
    saving: /Salvando alterações/,
    unconfirmed: /ainda precisa de confirmação/,
    conflict: /alterações concorrentes/,
    error: /Conexão indisponível/,
  })) {
    const screen = await h.render(OperationSettings, {
      resourceState: { ...resourceState(), status, error: status === 'error' ? new Error('Conexão indisponível.') : null },
      readOnly: false, initialSection: 'timing', onEdit() {}, onSave() {}, onDiscard() {},
    })
    assert.match(nodeText(screen.root), message)
    if (['loading', 'saving', 'unconfirmed', 'conflict'].includes(status)) {
      assert.equal(timingInput(screen.root, 'scheduledPrepLeadMinutes').props.disabled, true)
    }
  }

  const screen = await h.render(OperationSettings, {
    resourceState: resourceState(), readOnly: true, initialSection: 'modalities',
    onEdit() { throw new Error('read-only must not edit') }, onSave() { throw new Error('read-only must not save') }, onDiscard() {},
  })
  assert.match(nodeText(screen.root), /Somente leitura/)
  assert.equal(screen.root.findAllByType('input').length, 0)
  assert.equal(buttonNamed(screen.root, 'Salvar alterações'), undefined)
  assert.equal(buttonNamed(screen.root, 'Definir como padrão'), undefined)
})

test('operation layout uses theme tokens and renders full labels with mobile-safe controls', async (t) => {
  const css = await readFile(new URL('../../../operation-settings.css', import.meta.url), 'utf8')
  const sharedCss = await readFile(new URL('../../../settings.css', import.meta.url), 'utf8')
  assert.match(css, /\.operation-editor \.operation-settings-section[^{]*\{[^}]*background: var\(--surface\)/s)
  assert.match(sharedCss, /\.operation-timing-grid \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/s)

  const h = await workspaceHarness(t, { mobile: true })
  const { default: OperationSettings } = await h.load('/src/app/surfaces/settings/OperationSettings.jsx')
  const screen = await h.render(OperationSettings, {
    resourceState: resourceState(), initialSection: 'timing', readOnly: false,
    onEdit() {}, onSave() {}, onDiscard() {},
  })
  assert.equal(h.media.matches, true)
  assert.match(nodeText(screen.root), /Pedido imediato fica muito atrasado/)
  assert.match(nodeText(screen.root), /Essas configurações organizam a fila da cozinha/)
  assert.equal(screen.root.findByProps({ className: 'operation-timing-grid' }).props.style, undefined)
  assert.equal(buttonNamed(screen.root, 'Salvar alterações').props.type, 'button')
})

test('operation inherits light and dark theme tokens instead of forcing a light palette', async () => {
  const css = await readFile(new URL('../../../operation-settings.css', import.meta.url), 'utf8')
  assert.doesNotMatch(css, /color-scheme\s*:\s*light/i)
  for (const token of ['bg', 'surface', 'surface-soft', 'surface-strong', 'text', 'text-soft', 'muted', 'border']) {
    assert.doesNotMatch(css, new RegExp(`--${token}\\s*:`))
  }
  assert.match(css, /background:\s*var\(--surface\)/)
  assert.match(css, /color:\s*var\(--text\)/)
})

test('operation switches to its real mobile composition at the shell breakpoint', async () => {
  const css = await readFile(new URL('../../../operation-settings.css', import.meta.url), 'utf8')
  const mobile = css.slice(css.indexOf('@media (max-width: 820px)'))
  assert.match(mobile, /\.operation-editor \.operation-timing-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s)
  assert.match(mobile, /\.operation-editor \.operation-modality-row\s*\{[^}]*grid-template-areas:/s)
  assert.match(mobile, /\.operation-editor \.operation-minute-input input\s*\{[^}]*min-height:\s*44px/s)
  assert.match(mobile, /\.operation-modality-menu summary\s*\{[^}]*min-height:\s*44px/s)
})

test('operation desktop sizing keeps the approved mockup at application scale', async () => {
  const css = await readFile(new URL('../../../operation-settings.css', import.meta.url), 'utf8')
  assert.match(css, /\.app-content:has\(> \.operation-settings-page\)\s*\{[^}]*width:\s*min\(1600px, 100%\)/s)
  assert.match(css, /\.operation-editor\s*\{[^}]*font-size:\s*14px/s)
  assert.match(css, /\.operation-editor \.settings-editor-header h1\s*\{[^}]*font-size:\s*32px/s)
  assert.match(css, /\.operation-editor \.operation-section-heading h2\s*\{[^}]*font-size:\s*18px/s)
  assert.match(css, /\.operation-editor \.operation-minute-input input\s*\{[^}]*min-height:\s*42px/s)
  assert.match(css, /\.operation-editor \.operation-modality-row\s*\{[^}]*min-height:\s*54px/s)
  assert.match(css, /\.operation-editor \.settings-editor-footer \.button\s*\{[^}]*min-height:\s*42px/s)
})

test('printing settings route remains available and separate from operations', async (t) => {
  const h = await workspaceHarness(t)
  h.document.documentElement.dataset = {}
  const [{ default: Settings }, { ThemeProvider }] = await Promise.all([
    h.load('/src/test-support/SettingsSurfaceTestContext.jsx'), h.load('/src/app/shell/theme/ThemeProvider.jsx'),
  ])
  const printingSettings = {
    resources: {
      'business-copies': { status: 'ready', confirmedValue: 1, draftValue: 1 },
      'station-config': { status: 'ready', confirmedValue: null },
      'local-printer': { status: 'ready', confirmedValue: null },
    },
    reload() {}, saveCopies() {}, saveStation() {}, selectPrinter() {}, makePrimary() {},
  }
  const Page = () => React.createElement(ThemeProvider, null, React.createElement(Settings, {
    section: 'settings-printing', settings: printingSettings, printing: {},
    granted: new Set(['printing.settings.view']), implemented: new Set(['settings-printing']),
    onNavigate() {}, soundEnabled: true, onSoundEnabledChange() {}, policyEditing: {
      resources: {}, load() {}, edit() {}, save() {}, discard() {}, reconcile() {}, reviewConflict() {},
      activeConflict: null, acceptActiveConflict() {}, dismissActiveConflict() {}, reset() {},
    },
  }))
  const screen = await h.render(Page)
  assert.match(nodeText(screen.root), /Impressão/)
  assert.equal(screen.root.findAllByProps({ id: 'settings-timing' }).length, 0)
})
