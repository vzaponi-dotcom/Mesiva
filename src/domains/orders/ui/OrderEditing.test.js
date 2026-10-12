import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const source=path=>readFileSync(new URL(path,import.meta.url),'utf8')
test('edition wired end-to-end through owned draft and official API',()=>{
 const app=source('../../../App.jsx')
 const order=source('./NewOrder.jsx')
 const detail=source('./components/OrderDetail.jsx')
 const hook=source('../application/useNewOrderDraft.js')
 const api=source('../infrastructure/ordersApi.js')
 assert.match(app,/handleEditOrder/)
 assert.match(app,/onEditOrder=\{handleEditOrder\}/)
 assert.match(detail,/Editar pedido/)
 assert.match(order,/editOrderMode/)
 assert.match(hook,/submitOrderEdit/)
 assert.match(api,/updateOrder:/)
})

test('Task 14 editor shows safe settlement actions and only receives after saved order revision',()=>{
 const checkout=source('./components/OrderCheckoutSummary.jsx')
 const form=source('./NewOrder.jsx')
 const draft=source('../application/useNewOrderDraft.js')
 const app=source('../../../App.jsx')
 assert.match(checkout,/Salvar e receber/)
 assert.match(checkout,/registrar devolução/)
 assert.match(checkout,/refundDueCents/)
 assert.match(checkout,/dueCents/)
 assert.match(checkout,/canReceivePayments/)
 assert.match(checkout,/canRefundPayments/)
 assert.match(form,/save\(undefined, false, 'receive'\)/)
 assert.match(draft,/onCommittedRef\.current\(result, token\.context, intent\)/)
 assert.match(app,/editSettlement/)
 assert.match(app,/CheckoutPaymentComposition/)
 assert.match(app,/registerSupplementalPayment/)
 assert.match(app,/registerPartialRefund/)
})
test('Task 14 financial endpoints require capability and explicit mutation identity',()=>{
 const routes=source('../../../../worker/index.js')
 const payment=source('../../../app/workflows/payments/paymentApi.js')
 const refund=source('../../../app/workflows/refunds/refundApi.js')
 assert.match(routes,/registerOrderSupplementalPayment/)
 assert.match(routes,/registerOrderPartialRefund/)
 assert.match(routes,/requireCapability\(context, 'payments\.receive'\)/)
 assert.match(routes,/requireCapability\(context, 'payments\.refund'\)/)
 assert.match(payment,/registerSupplementalPayment/)
 assert.match(refund,/registerPartialRefund/)
})

test('Task 14 order edit review renders only authorized due/refund actions on mobile and desktop',async t=>{
 const {workspaceHarness,nodeText,buttonNamed}=await import('../../../test-support/renderWorkspace.js')
 const h=await workspaceHarness(t)
 const {default:Checkout}=await h.load('/src/domains/orders/ui/components/OrderCheckoutSummary.jsx')
 const currency=n=>'R$ '+Number(n).toFixed(2)
 const base={draft:{type:'Entrega',adjustment:{type:'none',mode:'fixed',value:0,reason:''}},
   preview:{subtotal:95,deliveryFee:0,total:95,adjustmentAmount:0},currency,disabled:false,canSubmit:true,
   editOrderMode:true,orderContext:{originalTotal:80,netReceivedCents:8000,paid:true,paymentId:'p1'},
   canReceivePayments:true,canRefundPayments:false}
 let called=0
 const first=await h.render(Checkout,{...base,onSavePaid:()=>called++,onSavePending:()=>{}})
 assert.match(nodeText(first.root),/Saldo a receber/)
 assert.ok(buttonNamed(first.root,'Salvar e receber'))
 const saved=buttonNamed(first.root,'Salvar e receber')
 saved.props.onClick()
 assert.equal(called,1)
 await first.unmount?.()
 const refund=await h.render(Checkout,{...base,preview:{...base.preview,total:65},
   canReceivePayments:false,canRefundPayments:true,onSaveRefund:()=>called++})
 assert.match(nodeText(refund.root),/Devolução pendente/)
 assert.ok(buttonNamed(refund.root,'Salvar e registrar devolução'))
 assert.equal(refund.root.findAll(n=>n.type==='button'&&nodeText(n)==='Salvar e receber').length,0)
})

test('Task 17 UX: saving and receiving defers success feedback until the financial operation confirms', () => {
  const app = source('../../../App.jsx')
  // O hook precisa encaminhar a intenção, não apenas o pedido e o contexto.
  assert.match(app, /onSuccess:\s*\(order,\s*context,\s*intent\)\s*=>\s*newOrderDraftTargetsRef\.current\.onSuccess\(order,\s*context,\s*intent\)/)
  const start = app.lastIndexOf('onSuccess: (order, context')
  const end = app.indexOf('onConflict:', start)
  assert.ok(start > -1 && end > start)
  const editFeedback = app.slice(start, end)
  assert.match(editFeedback, /onSuccess:\s*\(order,\s*context,\s*intent\b/)
  assert.match(editFeedback, /if\s*\(\s*intent\s*===\s*'receive'\s*\|\|\s*intent\s*===\s*'refund'\s*\)\s*return/)
  assert.match(editFeedback, /showSuccessMessage\('Pedido atualizado com sucesso'\)/)
  const settlementStart = app.indexOf('const submitEditSettlement=')
  assert.ok(settlementStart > -1)
  const settlement = app.slice(settlementStart, app.indexOf('operationalRuntimeTargetsRef.current.onUnauthorized', settlementStart))
  assert.ok(settlement.indexOf('await clientsForContext.payments.registerSupplementalPayment') < settlement.indexOf("showSuccessMessage('Saldo complementar recebido com sucesso')"))
  assert.match(app, /Pedido atualizado\. (?:O pagamento|A operação financeira).*pendente/)
})

test('Task 17 UX: successful Financeiro refund closes the settlement modal, including partial refunds', () => {
  const app = source('../../../App.jsx')
  const start = app.indexOf("if(type==='receive')")
  const end = app.indexOf('return true', start)
  assert.ok(start > -1 && end > start)
  const result = app.slice(start, end)
  assert.match(result, /showSuccessMessage\('Devolução registrada com sucesso'\)/)
  assert.match(result, /else\s*\{[\s\S]*setEditSettlement\(null\)/)
  assert.doesNotMatch(result, /setEditSettlement\(prev\s*=>\s*prev\?\.owner/)
})
