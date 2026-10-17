import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const read = relative => readFileSync(new URL(relative, import.meta.url), 'utf8')

test('order details expose eligible action classes without replacing existing action handlers', () => {
  const jsx = read('./OrderDetail.jsx')
  assert.match(jsx, /const showEditAction = canEditOrders && order\.status === 'Em preparo'/)
  assert.ok(jsx.includes("' has-edit-action'"))
  assert.ok(jsx.includes("' has-cancel-action'"))
  assert.match(jsx, /showEditAction && <Button[^>]*className="order-detail-edit-action"[^>]*onClick/)
  assert.match(jsx, /showCancelAction && <Button[^>]*className="order-detail-cancel-action"/)
  assert.ok(jsx.includes('onRegisterPayment?.()'))
})

test('desktop layout stays intact; mobile actions use two columns and full-width payment', () => {
  const css = read('./order-detail-redesigned.css')
  assert.match(css, /\.order-detail-dialog-actions\s*\{\s*display:\s*flex;/)
  const responsive = css.slice(css.indexOf('@media (max-width: 640px)'))
  assert.match(responsive, /\.order-detail-dialog-actions\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s)
  assert.match(responsive, /\.order-detail-dialog-primary-actions\s*\{[^}]*grid-column:\s*1\s*\/\s*-1;[^}]*width:\s*100%/s)
  assert.match(responsive, /\.order-detail-dialog-primary-actions\s+\.button\s*\{[^}]*width:\s*100%/s)
  assert.match(responsive, /\.order-detail-edit-action\s*\{[^}]*grid-column:\s*1/s)
  assert.match(responsive, /\.order-detail-cancel-action\s*\{[^}]*grid-column:\s*2/s)
})

test('mobile action layout handles missing edit or cancellation eligibility', () => {
  const css = read('./order-detail-redesigned.css')
  const responsive = css.slice(css.indexOf('@media (max-width: 640px)'))
  assert.match(responsive, /\.order-detail-dialog-actions:not\(\.has-edit-action\)\s*>\s*\.order-detail-cancel-action\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/s)
  assert.match(responsive, /\.order-detail-dialog-actions:not\(\.has-cancel-action\)\s*>\s*\.order-detail-edit-action\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/s)
  assert.match(responsive, /min-height:\s*44px/)
})
