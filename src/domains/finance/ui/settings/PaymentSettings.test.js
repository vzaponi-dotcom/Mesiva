import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { act } from 'react-test-renderer'
import { readFile } from 'node:fs/promises'

import { buttonNamed, nodeText, workspaceHarness } from '../../../../test-support/renderWorkspace.js'

const paymentData = () => ({
  methods: [
    { code: 'pix', active: true, sortOrder: 0 },
    { code: 'cash', active: true, sortOrder: 1 },
    { code: 'debit_card', active: true, sortOrder: 2 },
    { code: 'credit_card', active: true, sortOrder: 3 },
    { code: 'transfer', active: true, sortOrder: 4 },
    { code: 'other', active: true, sortOrder: 5 },
  ],
  defaultMethod: 'pix',
})

const resourceState = (data = paymentData(), extra = {}) => ({
  status: 'ready',
  confirmed: { resource: 'paymentMethods', revision: 1, data },
  base: { resource: 'paymentMethods', revision: 1, data },
  draft: structuredClone(data),
  dirty: false,
  ...extra,
})

async function renderEditable(h, PaymentSettings, initial = resourceState()) {
  const edits = []
  let saves = 0
  function Editor() {
    const [state, setState] = React.useState(initial)
    return React.createElement(PaymentSettings, {
      resourceState: state,
      onEdit(draft) {
        edits.push(draft)
        setState((current) => ({ ...current, draft, dirty: true }))
      },
      onSave() { saves += 1 },
      onDiscard() {},
    })
  }
  return { screen: await h.render(Editor), edits, saves: () => saves }
}

const row = (root, code) => root.findByProps({ 'data-payment-code': code })
const settingsSwitch = (root, code) => root.findByProps({ 'data-settings-switch': code })

test('renders the native payment editor without free-CRUD controls and with specific payment icons', async (t) => {
  const h = await workspaceHarness(t)
  const { default: PaymentSettings } = await h.load('/src/domains/finance/ui/settings/PaymentSettings.jsx')
  const screen = await h.render(PaymentSettings, {
    resourceState: resourceState(), readOnly: false, onEdit() {}, onSave() {}, onDiscard() {},
  })

  assert.deepEqual(
    screen.root.findAll((node) => node.props?.['data-payment-code']).map((node) => node.props['data-payment-code']),
    ['pix', 'cash', 'debit_card', 'credit_card', 'transfer', 'other'],
  )
  assert.match(nodeText(screen.root), /Pix.*Dinheiro.*Cartão de débito.*Cartão de crédito.*Transferência.*Outro/s)
  assert.match(nodeText(screen.root), /Configurações.*Formas de pagamento.*Gerencie os métodos de pagamento aceitos no seu delivery/s)
  assert.match(nodeText(screen.root), /Os métodos nativos não podem ser renomeados.*As alterações realizadas serão aplicadas após salvar/s)
  assert.equal(Boolean(buttonNamed(screen.root, 'Adicionar forma')), false)
  assert.equal(screen.root.findAll((node) => node.props?.className === 'payment-editor-toolbar').length, 0)
  assert.equal(screen.root.findAll((node) => node.props?.className === 'payment-notice-secondary').length, 1)
  assert.equal(screen.root.findByProps({ role: 'table', 'aria-label': 'Formas de pagamento' }).props.role, 'table')
  assert.match(nodeText(screen.root), /ORDEM.*FORMA.*STATUS.*PADRÃO.*AÇÕES/s)
  assert.match(nodeText(row(screen.root, 'pix')), /Pagamento instantâneo.*Padrão/s)
  assert.doesNotMatch(nodeText(row(screen.root, 'pix')), /Ativo|Inativo/)
  assert.match(nodeText(row(screen.root, 'cash')), /Pagamento na entrega/s)
  assert.doesNotMatch(nodeText(row(screen.root, 'cash')), /Ativo|Inativo/)
  assert.match(nodeText(row(screen.root, 'debit_card')), /Visa, Mastercard, Elo e outros/s)
  assert.match(nodeText(row(screen.root, 'transfer')), /TED, DOC ou transferência bancária/s)
  assert.equal(screen.root.findAll((node) => node.props?.['data-payment-drag-handle']).length, 6)
  assert.equal(screen.root.findAll((node) => node.props?.['data-payment-actions']).length, 6)
  assert.equal(screen.root.findAll((node) => node.props?.['data-settings-switch']).length, 6)
  assert.equal(row(screen.root, 'pix').findByProps({ 'data-payment-icon': 'pix' }).props['data-payment-icon'], 'pix')
  assert.equal(row(screen.root, 'cash').findByProps({ 'data-payment-icon': 'cash' }).props['data-payment-icon'], 'cash')
  assert.equal(row(screen.root, 'debit_card').findByProps({ 'data-payment-icon': 'card' }).props['data-payment-icon'], 'card')
  assert.equal(row(screen.root, 'credit_card').findByProps({ 'data-payment-icon': 'card' }).props['data-payment-icon'], 'card')
  assert.equal(row(screen.root, 'transfer').findByProps({ 'data-payment-icon': 'transfer' }).props['data-payment-icon'], 'transfer')
  assert.equal(row(screen.root, 'other').findByProps({ 'data-payment-icon': 'other' }).props['data-payment-icon'], 'other')
  assert.doesNotMatch(nodeText(screen.root), /Renomear|Excluir/i)
})

test('activation and default actions never create an impossible draft or autosave', async (t) => {
  const h = await workspaceHarness(t)
  const { default: PaymentSettings } = await h.load('/src/domains/finance/ui/settings/PaymentSettings.jsx')
  const fixture = await renderEditable(h, PaymentSettings)

  assert.equal(settingsSwitch(row(fixture.screen.root, 'pix'), 'pix').props.disabled, true)
  assert.match(nodeText(row(fixture.screen.root, 'pix')), /padrão/i)
  await act(async () => buttonNamed(row(fixture.screen.root, 'cash'), 'Definir como padrão').props.onClick())
  assert.equal(fixture.edits.at(-1).defaultMethod, 'cash')
  assert.equal(fixture.edits.at(-1).methods.find((item) => item.code === 'cash').active, true)
  assert.equal(settingsSwitch(row(fixture.screen.root, 'pix'), 'pix').props.disabled, false)
  await act(async () => settingsSwitch(row(fixture.screen.root, 'pix'), 'pix').props.onClick())
  assert.equal(fixture.edits.at(-1).methods.find((item) => item.code === 'pix').active, false)
  assert.equal(fixture.edits.at(-1).defaultMethod, 'cash')
  await act(async () => settingsSwitch(row(fixture.screen.root, 'pix'), 'pix').props.onClick())
  assert.equal(fixture.edits.at(-1).methods.find((item) => item.code === 'pix').active, true)
  assert.equal(fixture.saves(), 0, 'draft actions must not autosave')

  const onlyCash = paymentData()
  onlyCash.defaultMethod = 'cash'
  onlyCash.methods = onlyCash.methods.map((item) => ({ ...item, active: item.code === 'cash' }))
  const last = await renderEditable(h, PaymentSettings, resourceState(onlyCash))
  assert.equal(settingsSwitch(row(last.screen.root, 'cash'), 'cash').props.disabled, true)
  assert.equal(last.edits.length, 0)
})

test('controller-blocked states disable payment actions and reorder shortcuts', async (t) => {
  const h = await workspaceHarness(t)
  const { default: PaymentSettings } = await h.load('/src/domains/finance/ui/settings/PaymentSettings.jsx')
  const screen = await h.render(PaymentSettings, {
    resourceState: resourceState(paymentData(), { status: 'saving', dirty: true }),
    readOnly: false, onEdit() { throw new Error('saving state must not edit') }, onSave() {}, onDiscard() {},
  })

  assert.equal(settingsSwitch(row(screen.root, 'cash'), 'cash').props.disabled, true)
  assert.equal(row(screen.root, 'cash').props.onKeyDown, undefined)
})

test('reorders by explicit action and Alt+Arrow keyboard without changing identities', async (t) => {
  const h = await workspaceHarness(t)
  const { default: PaymentSettings } = await h.load('/src/domains/finance/ui/settings/PaymentSettings.jsx')
  const fixture = await renderEditable(h, PaymentSettings)

  await act(async () => buttonNamed(row(fixture.screen.root, 'cash'), 'Mover para cima').props.onClick())
  assert.deepEqual(fixture.edits.at(-1).methods.map((item) => item.code), ['cash', 'pix', 'debit_card', 'credit_card', 'transfer', 'other'])
  assert.deepEqual(fixture.edits.at(-1).methods.map((item) => item.sortOrder), [0, 1, 2, 3, 4, 5])

  const debit = row(fixture.screen.root, 'debit_card')
  let prevented = false
  await act(async () => debit.props.onKeyDown({ altKey: true, key: 'ArrowUp', preventDefault() { prevented = true } }))
  assert.equal(prevented, true)
  assert.deepEqual(fixture.edits.at(-1).methods.map((item) => item.code), ['cash', 'debit_card', 'pix', 'credit_card', 'transfer', 'other'])
})

test('dnd-kit owns the sortable lifecycle and Pix uses the stable brand asset', async () => {
  const source = await readFile(new URL('./PaymentSettings.jsx', import.meta.url), 'utf8')
  const pkg = JSON.parse(await readFile(new URL('../../../../../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.dependencies['@dnd-kit/react'], '0.5.0')
  assert.match(source, /DragDropProvider/)
  assert.match(source, /DragOverlay/)
  assert.match(source, /useSortable/)
  assert.match(source, /pix-symbol\.svg/)
  assert.doesNotMatch(source, /targetIndexAt|startPointerDrag|movePointerDrag|finishPointerDrag|setPointerCapture|elementFromPoint/)
  const pix = await readFile(new URL('../../../../assets/pix-symbol.svg', import.meta.url), 'utf8')
  assert.match(pix, /viewBox="0 0 24 24"/)
  assert.match(pix, /M5\.283 18\.36/)
})

test('reorderPaymentMethods keeps six identities and normalizes sortOrder', async (t) => {
  const h = await workspaceHarness(t)
  const { reorderPaymentMethods } = await h.load('/src/domains/finance/ui/settings/PaymentSettings.jsx')
  const methods = paymentData().methods
  const middle = reorderPaymentMethods(methods, 0, 2)
  assert.deepEqual(middle.map((item) => item.code), ['cash', 'debit_card', 'pix', 'credit_card', 'transfer', 'other'])
  assert.deepEqual(middle.map((item) => item.sortOrder), [0, 1, 2, 3, 4, 5])
  assert.deepEqual(reorderPaymentMethods(methods, 2, 0).map((item) => item.code), ['debit_card', 'pix', 'cash', 'credit_card', 'transfer', 'other'])
  assert.deepEqual(reorderPaymentMethods(methods, 2, 5).map((item) => item.code), ['pix', 'cash', 'credit_card', 'transfer', 'other', 'debit_card'])
  assert.deepEqual(reorderPaymentMethods(methods, 2, 2).map((item) => item.code), methods.map((item) => item.code))
  assert.equal(new Set(middle.map((item) => item.code)).size, 6)
})

test('read-only uses the shared shell and disables editing controls', async (t) => {
  const h = await workspaceHarness(t)
  const { default: PaymentSettings } = await h.load('/src/domains/finance/ui/settings/PaymentSettings.jsx')
  const screen = await h.render(PaymentSettings, {
    resourceState: resourceState(), readOnly: true,
    onEdit() { throw new Error('read-only must not edit') },
    onSave() { throw new Error('read-only must not save') }, onDiscard() {},
  })
  assert.match(nodeText(screen.root), /Somente leitura/)
  assert.equal(buttonNamed(screen.root, 'Salvar alterações'), undefined)
  const switches = screen.root.findAll((node) => node.props?.['data-settings-switch'])
  assert.equal(switches.length, 6)
  assert.equal(switches.every((node) => node.props.disabled), true)
  assert.equal(row(screen.root, 'pix').findByProps({ 'data-payment-drag-handle': 'pix' }).props.disabled, true)
})

test('mobile payment settings use one flexible metadata region for contained badges', async (t) => {
  const h = await workspaceHarness(t, { mobile: true })
  const { default: PaymentSettings } = await h.load('/src/domains/finance/ui/settings/PaymentSettings.jsx')
  const screen = await h.render(PaymentSettings, {
    resourceState: resourceState(), readOnly: false, onEdit() {}, onSave() {}, onDiscard() {},
  })
  assert.equal(screen.root.findAllByType('table').length, 0)
  assert.equal(screen.root.findAll((node) => node.props?.['data-payment-code']).length, 6)
  assert.equal(row(screen.root, 'pix').findAll((node) => node.props?.className === 'payment-meta-cell').length, 1)
})

test('desktop keeps dedicated metadata columns while mobile anchors badges and switch in one region', async () => {
  const css = await readFile(new URL('../../../../payment-settings.css', import.meta.url), 'utf8')
  assert.match(css, /grid-template-columns:\s*88px minmax\(300px, 1\.6fr\) 130px 116px 54px/)
  assert.match(css, /payment-meta-cell \{ display: flex; grid-area: meta; align-items: center; justify-content: space-between/)
  assert.match(css, /payment-meta-switch \{ margin-left: auto; \}/)
})

test('payment save confirms only after success and Cancel discards then returns to settings home', async (t) => {
  const h = await workspaceHarness(t)
  h.document.documentElement.dataset = {}
  const [{ default: Settings }, { ThemeProvider }] = await Promise.all([
    h.load('/src/test-support/SettingsSurfaceTestContext.jsx'), h.load('/src/app/shell/theme/ThemeProvider.jsx'),
  ])
  const messages = []
  const calls = []
  let saved = true
  const controller = {
    resources: { paymentMethods: { ...resourceState(), dirty: true } },
    load() {}, edit() {}, reconcile() {}, reviewConflict() {},
    save: async () => saved,
    discard: () => calls.push('discard'),
  }
  const Page = () => React.createElement(ThemeProvider, null, React.createElement(Settings, {
    section: 'settings-payments', settings: {}, printing: {},
    granted: new Set(['payments.settings.view', 'payments.settings.manage']),
    implemented: new Set(['settings-home', 'settings-payments']), onNavigate: (destination) => calls.push(destination),
    soundEnabled: true, onSoundEnabledChange() {}, policyEditing: { ...controller, activeConflict: null, acceptActiveConflict() {}, dismissActiveConflict() {}, reset() {} },
    onSuccessMessage: (message) => messages.push(message),
  }))
  const screen = await h.render(Page)
  t.mock.timers.enable({ apis: ['setTimeout'] })

  await act(async () => buttonNamed(screen.root, 'Salvar alterações').props.onClick())
  assert.equal(nodeText(buttonNamed(screen.root, 'Salvar alterações').findByProps({ role: 'status' })), 'Salvo')
  assert.deepEqual(messages, [])
  await act(async () => t.mock.timers.tick(1800))
  saved = false
  await act(async () => buttonNamed(screen.root, 'Salvar alterações').props.onClick())
  assert.equal(nodeText(buttonNamed(screen.root, 'Salvar alterações').findByProps({ role: 'status' })), '')
  assert.equal(messages.length, 0)
  await act(async () => buttonNamed(screen.root, 'Cancelar').props.onClick())
  assert.deepEqual(calls, ['discard', 'settings-home'])
})

test('settings route loads and edits the single paymentMethods controller resource', async (t) => {
  const h = await workspaceHarness(t)
  h.document.documentElement.dataset = {}
  const [{ default: Settings }, { ThemeProvider }] = await Promise.all([
    h.load('/src/test-support/SettingsSurfaceTestContext.jsx'), h.load('/src/app/shell/theme/ThemeProvider.jsx'),
  ])
  const loaded = []
  const edited = []
  const controller = {
    resources: { paymentMethods: resourceState() },
    load: (resource) => loaded.push(resource),
    edit: (resource, draft) => edited.push([resource, draft]),
    save() {}, discard() {}, reconcile() {}, reviewConflict() {},
  }
  const Page = () => React.createElement(ThemeProvider, null, React.createElement(Settings, {
    section: 'settings-payments', settings: {}, printing: {},
    granted: new Set(['payments.settings.view', 'payments.settings.manage']),
    implemented: new Set(['settings-payments']), onNavigate() {},
    soundEnabled: true, onSoundEnabledChange() {}, policyEditing: { ...controller, activeConflict: null, acceptActiveConflict() {}, dismissActiveConflict() {}, reset() {} },
  }))
  const screen = await h.render(Page)
  assert.deepEqual(loaded, ['paymentMethods'])
  assert.doesNotMatch(nodeText(screen.root), /Operação.*Modalidades de pedido.*Motivos de cancelamento/s)
  await act(async () => buttonNamed(row(screen.root, 'cash'), 'Definir como padrão').props.onClick())
  assert.equal(edited.at(-1)[0], 'paymentMethods')
  assert.equal(edited.at(-1)[1].defaultMethod, 'cash')
})
