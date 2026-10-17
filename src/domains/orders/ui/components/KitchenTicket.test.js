import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), 'utf8')

test('kitchen ticket exposes only the operational ticket information and complete item-note lines', () => {
  const ticket = source('./KitchenTicket.jsx')
  const notes = source('./KitchenTicketNotes.jsx')

  for (const label of ['formatOrderDisplayNumber', 'order.client', 'Icon', 'order.type', 'buildKitchenItemSummary', 'StatusBadge', 'buildKitchenTimingCopy', 'Exibir detalhes']) {
    assert.match(ticket, new RegExp(label.replace('.', '\\.')))
  }
  assert.match(notes, /kitchen-ticket-notes/)
  assert.match(notes, /getKitchenItemNotes\(order\)/)
  assert.match(notes, /note\.text/)
  assert.doesNotMatch(ticket, /order\.(?:total|paymentMethod|deliveryFee|address|phone|note)/)
  assert.doesNotMatch(notes, /order\.note/)
  assert.doesNotMatch(ticket, /order-items-(?:toggle|list)/)
})

test('kitchen ticket scopes actions to the queue phase', () => {
  const ticket = source('./KitchenTicket.jsx')

  assert.match(ticket, /entry\.phase === 'scheduled'/)
  assert.match(ticket, /onCancel/)
  assert.match(ticket, /onFinalize/)
  assert.match(ticket, /getFinalActionLabel\(order\)/)
  assert.match(ticket, /icon="note"/)
  assert.match(ticket, /icon=\{order\.type === 'Entrega' \? 'delivery' : 'check'\}/)
})

test('kitchen ticket prioritizes the customer name and de-emphasizes the order id', () => {
  const ticket = source('./KitchenTicket.jsx')
  const styles = source('../../../../order-operations.css')

  assert.match(ticket, /kitchen-ticket-customer-name[^}]*order\.client/)
  assert.match(ticket, /kitchen-ticket-id[^}]*formatOrderDisplayNumber\(order\)/)
  assert.match(ticket, /aria-label=\{formatOrderDisplayNumber\(order\)\}/)
  assert.match(styles, /\.kitchen-ticket-id[\s\S]*opacity:/)
  assert.match(styles, /\.kitchen-ticket-customer-name/)
})

test('edited badge remains visible on narrow kitchen tickets without changing the card actions', () => {
  const ticket = source('./KitchenTicket.jsx')
  const css = source('./kitchen-ticket-organized.css')
  assert.match(ticket, /Number\(order\.operationalRevision\) > 0 && <OrderEditedBadge/)
  assert.match(css, /\.kitchen-page \.kitchen-ticket-organized \.kitchen-ticket-customer > \.order-edited-badge\s*\{[^}]*color:\s*var\(--warning/s)
  assert.match(css, /\.kitchen-page \.kitchen-ticket-organized \.kitchen-ticket-customer \.order-edited-badge span\s*\{[^}]*color:\s*inherit/s)
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*\.kitchen-ticket-customer > span:last-child:not\(\.order-edited-badge\)\s*\{[^}]*flex-basis:\s*100%/s)
})
