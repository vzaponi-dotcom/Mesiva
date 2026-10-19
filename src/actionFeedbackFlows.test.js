import test from 'node:test'
import assert from 'node:assert/strict'
import { workspaceHarness } from './test-support/renderWorkspace.js'

test('payment confirmation renders pending from the workflow without changing its official result', async t => {
  const h = await workspaceHarness(t)
  const { default: OrderPaymentDialog } = await h.load('/src/app/workflows/payments/order/OrderPaymentDialog.jsx')
  const screen = await h.render(OrderPaymentDialog, {
    currency: value => String(value),
    dialog: { order: { number: 1, total: 20 }, submitting: true, composition: { valid: true }, dateValid: true, allocations: [], paymentOptions: [], onClose() {}, onConfirm() {} },
  })
  const pending = screen.root.findAllByType('button').filter(button => button.props['aria-busy'])
  assert.equal(pending.length, 1)
  assert.equal(pending[0].props.disabled, true)
})
