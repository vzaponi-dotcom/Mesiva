import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildKitchenQueueModel } from './domains/orders/domain/kitchenQueue.js'
import { buildKitchenTimingCopy, getKitchenItemNotes } from './domains/orders/domain/kitchenTicket.js'

const read = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), 'utf8')

const kitchenCss = read('./order-operations.css')
const kitchenTokens = Object.fromEntries(
  [...read('./index.css').matchAll(/--(kitchen-[\w-]+):\s*(#[0-9a-f]{6});/gi)].map((match) => [match[1], match[2]]),
)

function cssRule(selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = kitchenCss.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, 's'))
  assert.ok(match, `missing CSS rule for ${selector}`)
  return match[1]
}

function declaration(rule, property) {
  const match = rule.match(new RegExp(`(?:^|\\n)\\s*${property}:\\s*([^;]+);`, 'm'))
  assert.ok(match, `missing ${property} declaration`)
  return match[1].trim()
}

function hexToRgb(hex) {
  return [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16))
}

function resolveColor(expression) {
  const variable = expression.match(/^var\(--([\w-]+)\)$/)
  if (variable) {
    assert.ok(kitchenTokens[variable[1]], `missing color token --${variable[1]}`)
    return hexToRgb(kitchenTokens[variable[1]])
  }

  const mix = expression.match(
    /^color-mix\(in srgb,\s*var\(--([\w-]+)\)\s*(\d+(?:\.\d+)?)%,\s*var\(--([\w-]+)\)\)$/,
  )
  assert.ok(mix, `unsupported color expression: ${expression}`)
  const [, firstToken, firstPercentage, secondToken] = mix
  assert.ok(kitchenTokens[firstToken], `missing color token --${firstToken}`)
  assert.ok(kitchenTokens[secondToken], `missing color token --${secondToken}`)
  const first = hexToRgb(kitchenTokens[firstToken])
  const second = hexToRgb(kitchenTokens[secondToken])
  const weight = Number(firstPercentage) / 100
  return first.map((channel, index) => channel * weight + second[index] * (1 - weight))
}

function relativeLuminance(rgb) {
  const linear = rgb.map((channel) => {
    const normalized = channel / 255
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4
  })
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
}

function contrastRatio(foreground, background) {
  const foregroundLuminance = relativeLuminance(foreground)
  const backgroundLuminance = relativeLuminance(background)
  const lighter = Math.max(foregroundLuminance, backgroundLuminance)
  const darker = Math.min(foregroundLuminance, backgroundLuminance)
  return (lighter + 0.05) / (darker + 0.05)
}

test('integrated kitchen fixture preserves queues, counts, timing copy and item-note association', () => {
  const now = new Date('2026-09-04T15:20:00.000Z')
  const fixtures = [
    { id: 'immediate-late', status: 'Em preparo', client: 'Ana', type: 'Local', createdAt: '2026-09-04T14:45:00.000Z', items: [{ name: 'Marmita G', note: 'sem cebola' }] },
    { id: 'scheduled-before', status: 'Em preparo', client: 'Bruno', type: 'Entrega', createdAt: '2026-09-04T13:00:00.000Z', scheduledFor: '2026-09-04T16:30:00.000Z', items: [{ name: 'Suco', note: 'sem gelo' }] },
    { id: 'scheduled-at-window', status: 'Em preparo', client: 'Carla', type: 'Retirada', createdAt: '2026-09-04T13:00:00.000Z', scheduledFor: '2026-09-04T16:10:00.000Z', items: [{ name: 'Pudim' }] },
    { id: 'scheduled-overdue', status: 'Em preparo', client: 'Davi', type: 'Entrega', createdAt: '2026-09-04T13:00:00.000Z', scheduledFor: '2026-09-04T15:00:00.000Z', items: [{ name: 'Marmita P' }] },
    { id: 'finished-today', status: 'Finalizado', type: 'Local', createdAt: '2026-09-04T13:00:00.000Z', finishedAt: '2026-09-04T15:00:00.000Z' },
    { id: 'cancelled', status: 'Cancelado', type: 'Local', createdAt: '2026-09-04T13:00:00.000Z' },
  ]

  const model = buildKitchenQueueModel(fixtures, now, '')
  const ids = (entries) => entries.map(({ order }) => order.id)
  assert.deepEqual(ids(model.preparing), ['scheduled-overdue', 'immediate-late', 'scheduled-at-window'])
  assert.deepEqual(ids(model.scheduled), ['scheduled-before'])
  assert.deepEqual(model.counts, { preparing: 3, scheduled: 1, late: 2, finishedToday: 1 })
  assert.equal(model.allActive.length, 4)

  const scheduledBefore = model.scheduled[0]
  assert.deepEqual(buildKitchenTimingCopy(scheduledBefore, now), { primary: 'Preparo em 20 min', secondary: 'Desejado 13:30' })
  assert.deepEqual(getKitchenItemNotes(scheduledBefore.order).map(({ text }) => text), ['Suco — sem gelo'])

  const atWindow = model.preparing.find(({ order }) => order.id === 'scheduled-at-window')
  assert.deepEqual(buildKitchenTimingCopy(atWindow, now), { primary: 'Em preparo há 0 min', secondary: 'Desejado 13:10' })

  const overdue = model.preparing.find(({ order }) => order.id === 'scheduled-overdue')
  assert.deepEqual(buildKitchenTimingCopy(overdue, now), { primary: 'Fora do prazo há 5 min', secondary: 'Desejado 12:00' })
})

test('kitchen ticket exposes the approved derived state, attendance icons and exact actions', () => {
  const ticket = read('./domains/orders/ui/components/KitchenTicket.jsx')

  assert.match(ticket, /Fora do prazo/)
  assert.match(ticket, /Agendado para preparo/)
  assert.match(ticket, /Entrega:\s*'delivery'/)
  assert.match(ticket, /Retirada:\s*'pickup'/)
  assert.match(ticket, /Local:\s*'local'/)
  assert.match(ticket, /kitchen-ticket-cancel-action/)
  assert.match(ticket, /Cancelar pedido/)
  assert.match(ticket, /Cancelar reserva/)
  assert.doesNotMatch(ticket, />Cancelar<\/Button>/)
  for (const label of ['Exibir detalhes', 'Saiu para entrega', 'Finalizar']) {
    const sources = `${ticket}\n${read('./domains/orders/domain/orderWorkflow.js')}`
    assert.match(sources, new RegExp(label))
  }
})

test('ticket privacy stays operational while shared details retain contact and financial data', () => {
  const ticket = read('./domains/orders/ui/components/KitchenTicket.jsx')
  const detail = read('./domains/orders/ui/components/OrderDetail.jsx')

  assert.doesNotMatch(ticket, /order\.(?:total|subtotal|deliveryFee|paymentStatus|paymentMethod|clientPhone|clientAddress)/)
  for (const field of ['clientPhone', 'clientAddress', 'subtotal', 'deliveryFee', 'total']) assert.match(detail, new RegExp(`order\\.${field}`))
  assert.match(detail, /item\.note/)
})

test('kitchen visual primitives expose the approved icon and StatCard contracts', () => {
  const icon = read('./shared/ui/Icon.jsx')
  const statCard = read('./shared/ui/StatCard.jsx')
  const packageJson = read('../package.json')
  const iconNames = ['kitchen', 'preparation', 'clock', 'alert', 'client', 'delivery', 'pickup', 'local', 'note', 'details', 'printer', 'volume-on', 'volume-off', 'cancel']

  const iconMap = icon.match(/const icons = \{([\s\S]*?)\n\}/)?.[1] ?? ''
  for (const name of iconNames) assert.match(iconMap, new RegExp(`(?:['"]${name.replace('-', '\\-')}['"]|${name.replace('-', '\\-')}):`))
  assert.match(icon, /strokeWidth="1\.8"/)
  assert.match(icon, /strokeLinecap="round"/)
  assert.match(icon, /strokeLinejoin="round"/)
  assert.doesNotMatch(packageJson, /lucide|heroicons|react-icons|@fortawesome/)
  assert.match(statCard, /function StatCard\(\{[^}]*className\s*=\s*['"]['"]/)
  const classes = statCard.match(/const classes = \[([^\]]+)\]/)?.[1] ?? ''
  assert.match(classes, /className/)
  assert.match(statCard, /<article\s+className=\{classes\}/)
})

test('kitchen page keeps the approved two-queue composition and search vocabulary', () => {
  const orders = read('./domains/orders/ui/Orders.jsx')

  assert.match(orders, /placeholder="Buscar cliente, pedido, produto ou tipo"/)
  assert.match(orders, /queueModel\.counts\.preparing/)
  assert.match(orders, /preparing\.map/)
  assert.match(orders, /queueModel\.scheduled\.filter/)
  assert.match(orders, /scheduled\.map/)
  assert.match(orders, /Nenhum pedido em preparo agora\./)
  assert.match(orders, /Nenhum pedido agendado aguardando preparo\./)
  assert.doesNotMatch(orders, /expandedOrderIds|toggleOrderItems|itemsExpanded|sort/i)
})

test('kitchen page exposes accessible queue names and full-text controls', () => {
  const orders = read('./domains/orders/ui/Orders.jsx')
  const ticket = read('./domains/orders/ui/components/KitchenTicket.jsx')

  assert.equal(orders.match(/className="kitchen-queue-section" aria-labelledby=/g)?.length, 2)
  assert.match(orders, /<h2 id="kitchen-preparing-heading">/)
  assert.match(orders, /<h2 id="kitchen-scheduled-heading">/)
  assert.match(ticket, /<article[^>]*aria-label=/)
  assert.match(ticket, /<StatusBadge/)
  assert.match(ticket, /Exibir detalhes/)
})

test('kitchen theme centralizes the approved semantic palette in both themes', () => {
  const css = read('./index.css')
  const lightTokens = {
    'kitchen-bg': 'var(--bg)',
    'kitchen-panel': 'var(--surface-soft)',
    'kitchen-ticket': 'var(--surface)',
    'kitchen-ticket-text': 'var(--text)',
    'kitchen-ticket-muted': 'var(--muted)',
    'kitchen-preparing': 'var(--warning)',
    'kitchen-scheduled': 'var(--info)',
    'kitchen-late': 'var(--danger)',
    'kitchen-finished': 'var(--success)',
  }
  const darkTokens = {
    'kitchen-bg': '#1b1817',
    'kitchen-panel': '#24201e',
    'kitchen-ticket': '#fffaf7',
    'kitchen-ticket-text': '#25211f',
    'kitchen-ticket-muted': '#6f6661',
    'kitchen-preparing': '#d97706',
    'kitchen-scheduled': '#2563eb',
    'kitchen-late': '#dc3545',
    'kitchen-finished': '#168a55',
  }
  const lightTheme = css.slice(css.indexOf(':root {'), css.indexOf(":root[data-theme='dark']"))
  const darkTheme = css.slice(css.indexOf(":root[data-theme='dark']"), css.indexOf('* {'))

  for (const [name, value] of Object.entries(lightTokens)) {
    assert.ok(lightTheme.includes(`--${name}: ${value};`), `light theme should map --${name} to ${value}`)
  }
  for (const [name, value] of Object.entries(darkTokens)) {
    assert.ok(darkTheme.includes(`--${name}: ${value};`), `dark theme should keep --${name} at ${value}`)
  }
})

test('desktop kitchen uses four counters, a warm board, and receipt tickets with compact actions beside the information zones', () => {
  const css = `${read('./order-operations.css')}\n${read('./order-operations-compact.css')}`

  assert.match(css, /\.kitchen-stats\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/s)
  assert.match(css, /\.kitchen-page\s*\{[^}]*background:\s*var\(--kitchen-bg\)/s)
  assert.match(css, /\.kitchen-board\s*\{[^}]*background:\s*var\(--kitchen-panel\)/s)
  assert.match(css, /\.kitchen-ticket\s*\{[^}]*grid-template-areas:\s*["']identity\s+summary\s+timing\s+actions["'][^}]*border-radius:\s*14px[^}]*background:\s*color-mix\([^}]*var\(--kitchen-ticket\)[^}]*color:\s*var\(--kitchen-ticket-text\)/s)
  assert.match(css, /\.kitchen-ticket-items\s*\{[^}]*color:\s*var\(--kitchen-ticket-text\)/s)
  assert.match(css, /\.kitchen-ticket-note\s*\{[^}]*color:\s*var\(--kitchen-ticket-muted\)[^}]*-webkit-line-clamp:\s*2[^}]*overflow:\s*hidden/s)
  assert.match(css, /\.kitchen-ticket-actions\s*\{[^}]*display:\s*flex[^}]*justify-content:\s*flex-end/s)
  assert.match(css, /\.kitchen-ticket-actions \.button\s*\{[^}]*min-height:\s*36px[^}]*white-space:\s*nowrap/s)
})

test('secondary copy on the dark kitchen surface derives readable contrast from semantic tokens', () => {
  const css = read('./order-operations.css')

  assert.match(css, /\.kitchen-page \.page-description\s*\{[^}]*color:\s*color-mix\(in srgb,\s*var\(--kitchen-ticket\)[^}]*var\(--kitchen-panel\)\)/s)
  assert.match(css, /\.kitchen-stat-card \.stat-copy > span,[\s\S]*?\{[^}]*color:\s*color-mix\(in srgb,\s*var\(--kitchen-ticket\)[^}]*var\(--kitchen-panel\)\)/s)
  assert.match(css, /\.kitchen-queue-help\s*\{[^}]*color:\s*color-mix\(in srgb,\s*var\(--kitchen-ticket\)[^}]*var\(--kitchen-panel\)\)/s)
})

test('small operational ticket text and actions meet WCAG AA contrast', () => {
  const pairs = [
    {
      name: 'Novo pedido',
      selector: '.kitchen-header-actions .button-primary',
      backgroundProperty: 'background',
    },
    {
      name: 'tempo do pedido',
      selector: '.kitchen-ticket-timing',
      background: 'var(--kitchen-ticket)',
    },
    {
      name: 'tempo do pedido atrasado',
      selector: '.kitchen-ticket-late .kitchen-ticket-timing',
      background: 'var(--kitchen-ticket)',
    },
    {
      name: 'Finalizar/Saiu para entrega',
      selector: '.kitchen-ticket-actions .button-primary',
      backgroundProperty: 'background',
    },
    {
      name: 'Cancelar',
      selector: '.kitchen-ticket:has(.status-agendado) .kitchen-ticket-actions .button:last-child',
      backgroundProperty: 'background',
    },
  ]

  const diagnostics = pairs.map((pair) => {
    const rule = cssRule(pair.selector)
    const foreground = declaration(rule, 'color')
    const background = pair.background ?? declaration(rule, pair.backgroundProperty)
    return {
      name: pair.name,
      ratio: contrastRatio(resolveColor(foreground), resolveColor(background)),
    }
  })

  assert.ok(
    diagnostics.every(({ ratio }) => ratio >= 4.5),
    diagnostics.map(({ name, ratio }) => `${name}: ${ratio.toFixed(2)}:1 (minimum 4.50:1)`).join('\n'),
  )
})

test('narrow kitchen keeps two counter columns and stacks ticket content without horizontal pressure', () => {
  const css = `${read('./order-operations.css')}\n${read('./order-operations-compact.css')}`
  const narrow = css.slice(css.lastIndexOf('@media (max-width: 640px)'))
  const forcingWidths = [...narrow.matchAll(/^\s*(?:min-)?width:\s*(\d+)px/gm)]
    .map((match) => Number(match[1]))
    .filter((width) => width > 320)

  assert.match(narrow, /\.kitchen-stats\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s)
  assert.match(narrow, /\.kitchen-ticket\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\) auto[^}]*grid-template-areas:\s*["']identity\s+identity["']\s*["']customer\s+timing["']\s*["']summary\s+summary["']\s*["']notes\s+notes["']\s*["']actions\s+actions["']/s)
  assert.match(narrow, /\.kitchen-ticket\s*\{[^}]*min-width:\s*0/s)
  assert.deepEqual(forcingWidths, [])
})

test('dark kitchen search keeps a light focused field with readable ticket text', () => {
  const contrastCss = read('./kitchen-theme-contrast.css')
  const searchCss = read('./order-operations.css')

  assert.match(searchCss, /\.kitchen-search input,[\s\S]*?color:\s*var\(--kitchen-ticket-text\)/)
  assert.match(
    contrastCss,
    /\[data-theme='dark'\] \.kitchen-page \.kitchen-search:focus-within\s*\{[^}]*background:\s*var\(--kitchen-ticket\)/s,
  )
})


test('Mesiva kitchen keeps brand identity separate from operational preparing state', () => {
  const css = read('./order-operations.css')

  assert.match(css, /\.kitchen-page \.eyebrow\s*\{[^}]*color:\s*var\(--kitchen-preparing\)/s)
  assert.match(css, /\.kitchen-header-actions \.button-primary\s*\{[^}]*background:\s*var\(--kitchen-preparing\)/s)

  assert.match(
    css,
    /:root\[data-visual-theme=['"]mesiva['"]\] \.kitchen-page \.eyebrow\s*\{[^}]*color:\s*var\(--brand\)/s,
  )
  assert.match(
    css,
    /:root\[data-visual-theme=['"]mesiva['"]\] \.kitchen-page \.kitchen-header-actions \.button-primary\s*\{[^}]*background:\s*var\(--primary-fill\)[^}]*color:\s*var\(--primary-contrast\)/s,
  )
})
