import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

test('order edit print confirmation uses a distinct compact responsive and themed dialog', () => {
  const app = read('../../../App.jsx')
  const css = read('../../../app/workflows/printing/orderEditPrintPrompt.css')
  assert.match(app, /className="order-edit-print-modal"/)
  assert.match(app, /className="order-edit-print-layout"/)
  assert.match(app, /className="order-edit-print-actions"/)
  assert.match(app, /Reimprimir pedido completo/)
  assert.match(app, /Não, obrigado/)
  assert.match(app, /await printing\.printOrder\(editedPrintPrompt\.orderId\)/)
  assert.match(app, /setEditedPrintPrompt\(null\)/)
  assert.match(css, /\.order-edit-print-modal\s*\{[^}]*width:\s*min\(4\d\dpx,/s)
  assert.match(css, /\.order-edit-print-modal\s+\.modal-body\s*\{[^}]*padding:/s)
  assert.match(css, /var\(--surface/)
  assert.match(css, /@media\s*\(max-width:\s*480px\)/)
})

test('kitchen order edit uses a persistent edit icon instead of confirm-read actions', () => {
  const ticket = read('./components/KitchenTicket.jsx')
  const kitchen = read('./Orders.jsx')
  assert.match(ticket, /<OrderEditedBadge/)
  assert.match(ticket, /Number\(order\.operationalRevision\) > 0/)
  assert.doesNotMatch(kitchen, /Confirmar leitura|confirmOrderEditRead|kitchen-order-edit-banner/)
  assert.doesNotMatch(kitchen, /onAcknowledgeOrderEdit/)
  assert.match(kitchen, /<KitchenTicket/)
  assert.match(read('../../../shared/ui/OrderEditedBadge.jsx'), /<Icon name="edit"/)
})

test('TV keeps only its edited-order icon, even after an older acknowledgement', () => {
  const tv = read('../../../kitchen-display/KitchenDisplayCard.jsx')
  assert.match(tv, /Number\(order\.operationalRevision\) > 0/)
  assert.match(tv, /<OrderEditedBadge/)
  assert.doesNotMatch(tv, /getKitchenDisplayEditRows|kds-card__edit-details|editItems\.map/)
  assert.match(tv, /getKitchenCardContentMetrics\(items\)/)
  assert.doesNotMatch(tv, /order\.editPending \&\& editItems/)
  const controls = read('../../../app/surfaces/kitchen-tv-control/KitchenTvControlSurface.jsx')
  assert.match(controls, /Number\(entry\.order\.operationalRevision\) > 0/)
  assert.doesNotMatch(controls, /Confirmar leitura|acknowledgeEdit/)
  assert.match(controls, /selectedEntry\?\.order/)
})

test('edited badge is non-interactive, legible in dark/light mode and does not mark new arrivals', () => {
  const css = read('../../../shared/ui/orderEditedBadge.css')
  const badge = read('../../../shared/ui/OrderEditedBadge.jsx')
  assert.match(badge, /role="status"/)
  assert.match(badge, /Icon name="edit"/)
  assert.doesNotMatch(badge, /onClick|<button/)
  assert.match(css, /--warning/)
  assert.match(css, /border-radius:/)
  assert.match(css, /display:\s*inline-flex/)
  const status = read('../../../kitchen-display/KitchenDisplayCard.jsx')
  assert.match(status, /data-highlighted=\{state === 'new'\}/)
})

test('edited badge reuses the rectangular system status badge with regular-weight text', () => {
  const badge = read('../../../shared/ui/OrderEditedBadge.jsx')
  const css = read('../../../shared/ui/orderEditedBadge.css')
  assert.match(badge, /'status-badge',\s*'order-edited-badge'/)
  assert.match(css, /border-radius:\s*var\(--badge-radius\)/)
  assert.match(css, /font-weight:\s*var\(--badge-font-weight\)/)
  assert.doesNotMatch(css, /border-radius:\s*999px/)
})

test('latest order edit panel displays individual changes instead of unstructured bullets', () => {
  const detail = read('./components/OrderDetail.jsx')
  const panel = read('./components/OrderEditChanges.jsx')
  const css = read('./components/order-edit-changes.css')
  assert.match(detail, /<OrderEditChanges changes={latestItemChanges}/)
  assert.doesNotMatch(detail, /<ul>[\s\S]*latestItemChanges\.map/)
  assert.match(panel, /order-edit-change-row/)
  assert.match(panel, /order-edit-change-notes/)
  assert.match(panel, /<details/)
  assert.match(css, /@media\s*\(max-width:\s*640px\)/)
  assert.match(css, /var\(--surface/)
})
