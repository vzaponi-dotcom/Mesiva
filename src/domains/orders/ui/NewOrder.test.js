import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { act } from 'react-test-renderer'
import { workspaceHarness, nodeText, buttonNamed } from '../../../test-support/renderWorkspace.js'

const source = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), 'utf8')

test('new order uses one searchable client picker without phone in the selected label', () => {
  const customerStep = source('./components/NewOrderCustomerStep.jsx')

  assert.match(customerStep, /new-order-client-picker/)
  assert.match(customerStep, /role="combobox"/)
  assert.match(customerStep, /role="listbox"/)
  assert.doesNotMatch(customerStep, />Buscar cliente</)
  assert.doesNotMatch(customerStep, /\[client\.name, client\.phone\]/)
  assert.doesNotMatch(customerStep, /client\.name\}\{client\.phone/)
})

test('new order starts with no client preselected', () => {
  const page = source('./NewOrder.jsx')

  assert.match(page, /const initialClientId = initialDraft\?\.clientId \|\| ''/)
  assert.match(page, /const \[clientId, setClientId\] = useState\(initialClientId\)/)
  assert.match(page, /const \[clientSearch, setClientSearch\] = useState\(initialClientName\)/)
  assert.doesNotMatch(page, /useState\(clients\[0\]\?\.id/)
  assert.doesNotMatch(page, /useState\(clients\[0\]\?\.name/)
})

test('new order from a selected table starts at products without marking the untouched draft dirty', async (t) => {
  const harness = await workspaceHarness(t)
  const dirtyStates = []
  const { default: NewOrder } = await harness.load('/src/domains/orders/ui/NewOrder.jsx')
  const renderer = await harness.render(NewOrder, {
    clients: [],
    products: [],
    tables: [{ id: 'table-7', name: 'Mesa 7', isActive: true, occupancy: 'occupied' }],
    initialType: 'Entrega',
    initialTableId: 'table-7',
    currency: (value) => `R$ ${value}`,
    disabled: false,
    onCancel: () => {},
    onCreateClient: async () => null,
    onSubmit: async () => false,
    onDraftDirtyChange: (dirty) => dirtyStates.push(dirty),
  })

  const steps = renderer.root.findByProps({ 'aria-label': 'Etapas da nova venda' })
  assert.match(nodeText(steps.findByProps({ 'aria-current': 'step' })), /Produtos/)
  assert.match(nodeText(renderer.root), /Mesa 7/)
  assert.equal(renderer.root.findAllByProps({ 'aria-label': 'Tipo do pedido' }).length, 0)
  assert.deepEqual(dirtyStates, [false])
})

test('quick client phone reuses the normal phone mask', () => {
  const page = source('./NewOrder.jsx')
  const customerStep = source('./components/NewOrderCustomerStep.jsx')

  assert.match(page, /formatPhone/)
  assert.match(page, /phone: formatPhone\(patch\.phone\)/)
  assert.match(customerStep, /onQuickClientChange\(\{ phone: event\.target\.value \}\)/)
})

test('product catalog replaces added action with synchronized quantity controls', () => {
  const page = source('./NewOrder.jsx')
  const productsStep = source('./components/NewOrderProductsStep.jsx')
  const catalog = source('./components/OrderProductCatalog.jsx')
  const css = source('./new-order.css')

  assert.match(page, /decrementCartProduct/)
  assert.match(page, /onDecrease=\{\(productId\) => setItems/)
  assert.match(productsStep, /onDecrease/)
  assert.match(catalog, /getCartProductQuantity/)
  assert.match(catalog, /new-order-product-quantity new-order-quantity-control/)
  assert.match(catalog, /Remover uma unidade/)
  assert.match(catalog, /Adicionar mais uma unidade/)
  assert.doesNotMatch(catalog, /✓ Adicionado/)
  assert.match(css, /\.new-order-quantity-control\s*\{/)
})

test('product catalog opens its first available category and keeps a selection', () => {
  const catalog = source('./components/OrderProductCatalog.jsx')

  assert.match(catalog, /const \[category, setCategory\] = useState\(null\)/)
  assert.doesNotMatch(catalog, /\['Todos',/)
  assert.match(catalog, /const activeCategory = category \|\| categories\[0\] \|\| null/)
  assert.match(catalog, /Selecione uma categoria ou busque um produto/)
})

test('product search ignores the selected category and adding keeps the category active', () => {
  const catalog = source('./components/OrderProductCatalog.jsx')

  assert.match(catalog, /if \(normalized\) return matchesSearch/)
  assert.match(catalog, /return uiCategory === activeCategory/)
  assert.match(catalog, /onClick=\{\(\) => onAdd\(product\)\}/)
})

test('item note typing preserves spaces and commits normalization on blur', () => {
  const page = source('./NewOrder.jsx')
  const cart = source('./components/OrderCart.jsx')

  assert.match(page, /editCartItemNote/)
  assert.match(page, /commitCartItemNote/)
  assert.match(cart, /onNoteChange/)
  assert.match(cart, /onNoteCommit/)
  assert.match(cart, /onChange=\{\(event\) => onNoteChange/)
  assert.match(cart, /onBlur=\{\(\) => \{[^}]*onNoteCommit\(item\.lineId\)/s)
})

test('item observation stays collapsed until requested and collapses to a summary after editing', () => {
  const cart = source('./components/OrderCart.jsx')

  assert.match(cart, /useState/)
  assert.match(cart, /Adicionar observação/)
  assert.match(cart, /Editar observação/)
  assert.match(cart, /new-order-note-summary/)
  assert.match(cart, /expandedNote/)
  assert.match(cart, /onBlur=\{\(\) => \{[^}]*onNoteCommit\(item\.lineId\)[^}]*closeNote/s)
})

test('cart item layout is horizontal and compact with quantity on the left', () => {
  const cart = source('./components/OrderCart.jsx')
  const css = source('./new-order.css')

  assert.match(cart, /new-order-cart-quantity/)
  assert.match(cart, /new-order-cart-content/)
  assert.match(cart, /new-order-cart-aside/)
  assert.match(css, /\.new-order-cart-line\s*\{[^}]*grid-template-columns:\s*auto minmax\(0, 1fr\) auto/s)
})

test('product form uses a BRL formatted text input', () => {
  const form = source('../../catalog/ui/ProductForm.jsx')
  const draft = source('../../catalog/domain/productDraft.js')

  assert.match(form, /formatBRLCurrencyInput/)
  assert.match(draft, /parseBRLCurrencyInput/)
  assert.match(form, /inputMode="decimal"/)
  assert.doesNotMatch(form, /<span>Preço<\/span>[\s\S]*<input type="number"/)
})

test('new order keeps money display formatted but normalizes preview and payload to numbers', () => {
  const page = source('./NewOrder.jsx')

  assert.match(page, /formatBRLCurrencyValue/)
  assert.match(page, /parseBRLCurrencyInput/)
  assert.match(page, /formatBRLCurrencyValue\(0\)/)
  assert.match(page, /numericDraft/)
  assert.match(page, /calculateOrderPreview\(numericDraft\)/)
  assert.match(page, /buildOrderPayload\(numericDraft, paymentAllocations, \{ receivedDate \}\)/)
})

test('new order still exposes catalog, cart and both checkout actions', () => {
  const page = source('./NewOrder.jsx')
  const customerStep = source('./components/NewOrderCustomerStep.jsx')
  const catalog = source('./components/OrderProductCatalog.jsx')
  const cart = source('./components/OrderCart.jsx')
  const checkout = source('./components/OrderCheckoutSummary.jsx')

  assert.match(page, /Nova venda/)
  assert.match(customerStep, /\+ Novo cliente/)
  assert.match(catalog, /Buscar produto/)
  assert.match(catalog, /Categorias de produtos/)
  assert.match(cart, /Revise seu pedido/)
  assert.match(cart, /Observação deste item/)
  assert.match(checkout, /Salvar pedido/)
  assert.match(checkout, /Salvar e receber/)
  assert.match(checkout, /renderPaymentComposition/)
  assert.match(page, /renderPaymentComposition/)
})

test('wizard keeps checkout payload unchanged and never persists intermediate step metadata', () => {
  const page = source('./NewOrder.jsx')

  assert.match(page, /buildOrderPayload\(numericDraft, paymentAllocations, \{ receivedDate \}\)/)
  assert.match(page, /await onSubmit\(buildOrderPayload\(numericDraft, paymentAllocations, \{ receivedDate \}\)\)/)
  assert.doesNotMatch(page, /app\/workflows\/payments/)
  assert.doesNotMatch(page, /step:\s*currentStep/)
  assert.doesNotMatch(page, /currentStep:\s*currentStep/)
})

test('scheduling uses the shared business timezone source', () => {
  const page = source('./NewOrder.jsx')
  const review = source('./components/NewOrderContext.jsx')
  assert.match(page, /import \{ getBusinessDate \} from '\.\.\/\.\.\/\.\.\/\.\.\/shared\/finance\.js'/)
  assert.match(page, /useState\(initialDraft\?\.orderDate \|\| getBusinessDate\(\)\)/)
  assert.match(page, /const todayValue = getBusinessDate\(\)/)
  assert.match(page, /todayValue=\{todayValue\}/)
  assert.match(review, /FINANCE_TIME_ZONE/)
  assert.doesNotMatch(review, /timeZone:\s*'America\/Sao_Paulo'/)
})


test('new order extends the current wizard with multiday schedule and Local Reservar controls', () => {
  const page = source('./NewOrder.jsx')
  const customerStep = source('./components/NewOrderCustomerStep.jsx')
  const review = source('./components/NewOrderContext.jsx')
  const tableSelector = source('../../table-service/ui/LocalTableSelector.jsx')

  assert.match(page, /getScheduleMaxBusinessDate/)
  assert.match(page, /getNewOrderScheduleState/)
  assert.match(page, /maxDateValue/)
  assert.match(page, /reservationMode/)
  assert.match(customerStep, /max=\{maxDateValue \|\| todayValue\}/)
  assert.match(customerStep, /scheduleOptionLabel/)
  assert.match(customerStep, /scheduleNowAllowed/)
  assert.match(customerStep, /Reservar|scheduleOptionLabel/)
  assert.match(tableSelector, /reservationMode/)
  assert.match(tableSelector, /selectedTable\?\.occupancy === 'occupied' && !reservationMode/)
  assert.match(review, /year:\s*'numeric'/)
  assert.match(review, /RESERVA|Reserva|draft\?\.type === 'Local'/)
})

test('Local customer step exposes Reservar in the existing mobile-friendly layout and hides open-tab hint after choosing it', async (t) => {
  const harness = await workspaceHarness(t, { mobile: true })
  const { default: NewOrder } = await harness.load('/src/domains/orders/ui/NewOrder.jsx')
  const renderer = await harness.render(NewOrder, {
    clients: [],
    products: [],
    tables: [{ id: 'table-3', name: 'Mesa 3', isActive: true, occupancy: 'occupied' }],
    initialType: 'Local',
    currency: (value) => `R$ ${value}`,
    disabled: false,
    onCancel: () => {},
    onCreateClient: async () => null,
    onSubmit: async () => false,
  })

  const reserve = buttonNamed(renderer.root, 'Reservar')
  assert.ok(reserve)
  const table = buttonNamed(renderer.root, 'Mesa 3Ocupada') || renderer.root.findAllByType('button').find((node) => nodeText(node).includes('Mesa 3'))
  assert.ok(table)

  await act(async () => table.props.onClick())
  assert.match(nodeText(renderer.root), /Comanda aberta/)

  await act(async () => reserve.props.onClick())
  assert.doesNotMatch(nodeText(renderer.root), /este pedido será adicionado/)
})

test('open-comanda new order keeps Local locked to Agora and does not expose Reservar', async (t) => {
  const harness = await workspaceHarness(t)
  const { default: NewOrder } = await harness.load('/src/domains/orders/ui/NewOrder.jsx')
  const renderer = await harness.render(NewOrder, {
    clients: [],
    products: [],
    tables: [{ id: 'table-7', name: 'Mesa 7', isActive: true, occupancy: 'occupied' }],
    initialTableId: 'table-7',
    expectedTableTabId: 'tab-7',
    currency: (value) => `R$ ${value}`,
    disabled: false,
    onCancel: () => {},
    onCreateClient: async () => null,
    onSubmit: async () => false,
  })

  const back = buttonNamed(renderer.root, '← Voltar para cliente')
    || renderer.root.findAllByType('button').find((node) => nodeText(node).includes('Cliente'))
  if (back) await act(async () => back.props.onClick())
  assert.equal(buttonNamed(renderer.root, 'Reservar'), undefined)
})


test('shared new-order wizard owns edit-reservation initialization, labels and manual-print warning', () => {
  const page = source('./NewOrder.jsx')

  assert.match(page, /mode = 'create'/)
  assert.match(page, /reservationContext = null/)
  assert.match(page, /initialDraft = null/)
  assert.match(page, /mode === 'edit-reservation'/)
  assert.match(page, /initialDraft\?\.selectedTableId/)
  assert.match(page, /initialDraft\?\.localClientId/)
  assert.match(page, /initialDraft\?\.orderDate/)
  assert.match(page, /initialDraft\?\.scheduleMode/)
  assert.match(page, /initialDraft\?\.scheduledTime/)
  assert.match(page, /initialDraft\?\.items/)
  assert.match(page, /Editar reserva/)
  assert.match(page, /Cancelar edição/)
  assert.match(page, /já foi impressa manualmente/i)
  assert.match(page, /Salvar mesmo assim/)
})

test('edit-reservation wizard starts clean from the official snapshot and does not expose immediate payment', async (t) => {
  const harness = await workspaceHarness(t)
  const dirtyStates = []
  const { default: NewOrder } = await harness.load('/src/domains/orders/ui/NewOrder.jsx')
  const renderer = await harness.render(NewOrder, {
    mode: 'edit-reservation',
    reservationContext: {
      id: 'reservation-1',
      orderId: 'order-1',
      orderNumber: 81,
      expectedRevision: 7,
      hasManualPrintHistory: true,
    },
    initialDraft: {
      type: 'Local',
      selectedTableId: 'table-3',
      localClientId: 'client-2',
      orderDate: '2026-10-10',
      scheduleMode: 'scheduled',
      scheduledTime: '20:30',
      items: [{
        lineId: 'reservation:item:0',
        productId: 'p1',
        name: 'Marmita',
        category: 'Refeições',
        size: 'G',
        unitPrice: 32,
        quantity: 2,
        note: 'sem cebola',
      }],
      deliveryFee: 0,
      adjustment: { type: 'none', mode: 'fixed', value: 0, reason: '' },
    },
    clients: [{ id: 'client-2', name: 'Maria', phone: '', address: '' }],
    products: [{ id: 'p1', name: 'Marmita', category: 'Refeições', size: 'G', price: 32, active: true }],
    tables: [{ id: 'table-3', name: 'Mesa 3', isActive: true, occupancy: 'free' }],
    currency: (value) => `R$ ${value}`,
    disabled: false,
    onCancel: () => {},
    onCreateClient: async () => null,
    onSubmit: async () => false,
    onDraftDirtyChange: (dirty) => dirtyStates.push(dirty),
  })

  assert.match(nodeText(renderer.root), /Editar reserva/)
  assert.match(nodeText(renderer.root), /Mesa 3/)
  assert.equal(renderer.root.findByProps({ role: 'combobox' }).props.value, 'Maria')
  assert.equal(buttonNamed(renderer.root, 'Salvar e receber'), undefined)
  assert.deepEqual(dirtyStates, [false])
})

test('reservation conflict renders the specific server guidance instead of a generic checkout error', async (t) => {
  // Keep the fixture in the future: a hard-coded 2026-10-10 becomes invalid
  // once that day passes, and blocks checkout before the conflict can be tested.
  const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const harness = await workspaceHarness(t)
  const { default: NewOrder } = await harness.load('/src/domains/orders/ui/NewOrder.jsx')
  const renderer = await harness.render(NewOrder, {
    initialType: 'Local',
    initialDraft: {
      type: 'Local',
      selectedTableId: 'table-2',
      localClientId: '',
      orderDate: futureDate,
      scheduleMode: 'scheduled',
      scheduledTime: '20:30',
      items: [{
        lineId: 'reservation:item:0',
        productId: 'p1',
        name: 'Mousse',
        category: 'Sobremesas',
        size: 'Un',
        unitPrice: 9,
        quantity: 1,
        note: '',
      }],
      deliveryFee: 0,
      adjustment: { type: 'none', mode: 'fixed', value: 0, reason: '' },
    },
    clients: [],
    products: [{ id: 'p1', name: 'Mousse', category: 'Sobremesas', size: 'Un', price: 9, active: true }],
    tables: [{ id: 'table-2', name: 'Mesa 2', isActive: true, occupancy: 'free' }],
    currency: (value) => `R$ ${value}`,
    disabled: false,
    onCancel: () => {},
    onCreateClient: async () => null,
    onSubmit: async () => ({
      ok: false,
      code: 'TABLE_RESERVATION_CONFLICT',
      message: 'Esta mesa já possui uma reserva nesse horário. Escolha outra mesa ou outro horário.',
    }),
  })

  await act(async () => buttonNamed(renderer.root, 'Escolher produtos →').props.onClick())
  await act(async () => buttonNamed(renderer.root, 'Revisar pedido →').props.onClick())
  await act(async () => buttonNamed(renderer.root, 'Salvar reserva').props.onClick())

  const text = nodeText(renderer.root)
  assert.match(text, /Esta mesa já possui uma reserva nesse horário/)
  assert.match(text, /Escolha outra mesa ou outro horário/)
  assert.doesNotMatch(text, /Não foi possível salvar a venda/)
})

for (const canBackdateOrders of [false, true]) test(`date selection honors backdate capability ${canBackdateOrders} and preserves future scheduling`, async t => {
  const h = await workspaceHarness(t)
  const { default: NewOrder } = await h.load('/src/domains/orders/ui/NewOrder.jsx')
  const screen = await h.render(NewOrder, { clients: [{ id: 'c', name: 'Ana' }], products: [], canBackdateOrders, initialDraft: { clientId: 'c' }, currency: String })
  const input = () => screen.root.findByProps({ type: 'date' })
  const today = input().props.value
  assert.equal(input().props.min, canBackdateOrders ? undefined : today)
  await act(async () => input().props.onChange({ target: { value: '2020-01-01' } }))
  assert.equal(input().props.value, canBackdateOrders ? '2020-01-01' : today)
  const future = input().props.max
  await act(async () => input().props.onChange({ target: { value: future } }))
  assert.equal(input().props.value, future)
  assert.equal(buttonNamed(screen.root, 'Agendado').props['aria-pressed'], true)
})

test('restored past-date draft blocks advancement early for an operator', async t => {
  const h = await workspaceHarness(t)
  const { default: NewOrder } = await h.load('/src/domains/orders/ui/NewOrder.jsx')
  const screen = await h.render(NewOrder, { clients: [{ id: 'c', name: 'Ana' }], products: [], canBackdateOrders: false, initialDraft: { clientId: 'c', orderDate: '2020-01-01' }, currency: String })
  assert.match(nodeText(screen.root), /data de hoje ou futura/)
  const continueButton = screen.root.findAllByType('button').find(n => /Continuar|Escolher produtos/.test(nodeText(n)))
  assert.equal(continueButton.props.disabled, true)
})
