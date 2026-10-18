import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { act } from 'react-test-renderer'
import { workspaceHarness, nodeText, buttonNamed } from '../../../../test-support/renderWorkspace.js'
import { comandaDetail, deferred } from '../../../../test-support/comandaFixtures.js'
import { getBusinessDate } from '../../../../../shared/finance.js'

test('mounted mobile payment and method sheet release locks together and preserve nested focus', async (t) => {
  const h = await workspaceHarness(t, { mobile: true })
  const { default: Dialog } = await h.load('/src/app/workflows/payments/table-tab/TableTabPaymentDialog.jsx')
  h.document.body.style.overflow = 'scroll'
  const focusable = (name) => ({ name, focus() { h.document.activeElement = this } })
  const launcher = focusable('payment launcher')
  launcher.focus()
  const overlays = new Map()
  let combobox, renderer
  const props = { open: true, detail: comandaDetail, currency: String, onClose() {}, onConfirm() {} }
  renderer = await h.render(Dialog, props, { createNodeMock(element) {
    if (element.props.role === 'combobox') { combobox = focusable('method trigger'); return combobox }
    if (element.props.role === 'dialog') {
      const control = focusable(element.props['aria-label'])
      const overlay = { querySelectorAll: () => [control] }
      overlays.set(element.props['aria-label'], overlay)
      return overlay
    }
    return null
  } })
  h.document.querySelectorAll = () => renderer.root.findAll((node) => typeof node.type === 'string' && node.props.role === 'dialog').map((node) => overlays.get(node.props['aria-label']))
  combobox.focus()
  await act(async () => renderer.root.findByProps({ role: 'combobox' }).props.onClick())
  assert.equal(renderer.root.findAllByProps({ role: 'dialog' }).length, 2)
  assert.equal(h.document.activeElement.name, 'Forma de pagamento')
  await act(async () => h.document.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape' })))
  assert.equal(renderer.root.findAllByProps({ role: 'dialog' }).length, 1, 'Escape closes only the top sheet')
  assert.equal(h.document.activeElement, combobox)
  assert.equal(h.document.body.style.overflow, 'hidden')
  await act(async () => renderer.root.findByProps({ role: 'combobox' }).props.onClick())
  await act(async () => renderer.update(React.createElement(Dialog, { ...props, open: false })))
  assert.equal(renderer.root.findAllByProps({ role: 'dialog' }).length, 0)
  assert.equal(h.document.body.style.overflow, 'scroll', 'closing payment with its sheet open must release both locks')
})

for (const mobile of [false, true]) test(`full payment dialog uses official methods and prevents duplicate submission (${mobile ? 'mobile' : 'desktop'})`, async (t) => {
  const h = await workspaceHarness(t, { mobile })
  const { default: Dialog } = await h.load('/src/app/workflows/payments/table-tab/TableTabPaymentDialog.jsx')
  const pending = deferred(), calls = []
  const props = { open: true, detail: comandaDetail, currency: (v) => v.toFixed(2), onClose() {}, onConfirm: (...args) => { calls.push(args); return pending.promise } }
  const r = await h.render(Dialog, props)
  assert.match(nodeText(r.root), /123.45/)
  assert.equal(r.root.findAllByType('input').length, 2, 'one editable allocation and one financial date field')
  assert.equal(nodeText(r.root.findByProps({ role: 'combobox' })), 'Pix')
  await act(async () => r.root.findByProps({ role: 'combobox' }).props.onClick())
  assert.deepEqual(r.root.findAllByProps({ role: 'option' }).map(nodeText), ['Pix', 'Dinheiro', 'Cartão de débito', 'Cartão de crédito', 'Transferência', 'Outro'])
  await act(async () => buttonNamed(r.root, 'Dinheiro').props.onClick())
  const submit = r.root.findByType('form').props.onSubmit
  await act(async () => { void submit({ preventDefault() {} }); void submit({ preventDefault() {} }) })
  assert.deepEqual(calls, [['tab-42', [{ methodCode: 'cash', amountCents: 12345 }], {receivedDate:getBusinessDate()}]])
  assert.ok(buttonNamed(r.root, 'Confirmar pagamento').props.disabled)
  await act(async () => pending.resolve(false))
  assert.ok(!buttonNamed(r.root, 'Confirmar pagamento').props.disabled, 'failed payment permits retry')
  await act(async () => r.update(React.createElement(Dialog, { ...props, open: false })))
  await act(async () => r.update(React.createElement(Dialog, props)))
  assert.equal(nodeText(r.root.findByProps({ role: 'combobox' })), 'Pix')
  await act(async () => r.update(React.createElement(Dialog, { ...props, disabled: true })))
  await act(async () => r.root.findByType('form').props.onSubmit({ preventDefault() {} }))
  assert.equal(calls.length, 1)
})


test('whole-table dialog submits a structured Dinheiro + Pix composition instead of one method', async (t) => {
  const h = await workspaceHarness(t)
  const { default: Dialog } = await h.load('/src/app/workflows/payments/table-tab/TableTabPaymentDialog.jsx')
  const detail = { ...comandaDetail, id: 'tab-split', totalCents: 8000, status: 'open', orderCount: 2 }
  const paymentOptions = [
    { code: 'cash', value: 'Dinheiro', label: 'Dinheiro' },
    { code: 'pix', value: 'Pix', label: 'Pix' },
  ]
  const calls = []
  const r = await h.render(Dialog, {
    open: true,
    detail,
    currency: (value) => `R$ ${value.toFixed(2)}`,
    paymentOptions,
    defaultPaymentMethod: 'Dinheiro',
    onClose() {},
    onConfirm: (...args) => { calls.push(args); return true },
  })

  assert.equal(nodeText(r.root.findByProps({ role: 'combobox', 'aria-label': 'Forma de pagamento' })), 'Dinheiro')
  assert.equal(r.root.findByProps({ 'aria-label': 'Valor da forma de pagamento 1' }).props.inputMode, 'decimal')
  assert.match(nodeText(r.root), /Restante.*R\$ 0,00/s)

  await act(async () => buttonNamed(r.root, 'Adicionar outra forma').props.onClick())
  let inputs = r.root.findAll((node) => node.type === 'input' && String(node.props?.['aria-label'] || '').startsWith('Valor da forma de pagamento'))
  await act(async () => inputs[0].props.onChange({ target: { value: 'R$ 30,00' } }))

  const second = r.root.findByProps({ role: 'combobox', 'aria-label': 'Forma de pagamento 2' })
  await act(async () => second.props.onClick())
  await act(async () => buttonNamed(r.root, 'Pix').props.onClick())

  inputs = r.root.findAll((node) => node.type === 'input' && String(node.props?.['aria-label'] || '').startsWith('Valor da forma de pagamento'))
  await act(async () => inputs[1].props.onChange({ target: { value: 'R$ 50,00' } }))

  await act(async () => r.root.findByType('form').props.onSubmit({ preventDefault() {} }))

  assert.deepEqual(calls, [[
    'tab-split',
    [
      { methodCode: 'cash', amountCents: 3000 },
      { methodCode: 'pix', amountCents: 5000 },
    ],
    {receivedDate:getBusinessDate()},
  ]])
})


test('Task 9: comanda date defaults to business today, rejects future, survives failed submit and resets on reopen',async t=>{
  const {getBusinessDate}=await import('../../../../../shared/finance.js')
  const h=await workspaceHarness(t,{mobile:true})
  const {default:Dialog}=await h.load('/src/app/workflows/payments/table-tab/TableTabPaymentDialog.jsx')
  const today=getBusinessDate()
  const props={open:true,detail:comandaDetail,currency:String,onClose(){},onConfirm:(...args)=>{calls.push(args);return false}}
  const calls=[]
  const r=await h.render(Dialog,props)
  const dateField=()=>r.root.findByProps({'aria-label':'Data do recebimento'})
  assert.equal(dateField().props.type,'date')
  assert.equal(dateField().props.value,today)
  assert.equal(dateField().props.max,today)
  await act(async()=>dateField().props.onChange({target:{value:'2999-01-01'}}))
  assert.ok(buttonNamed(r.root,'Confirmar pagamento').props.disabled)
  await act(async()=>r.root.findByType('form').props.onSubmit({preventDefault(){}}))
  assert.equal(calls.length,0)
  await act(async()=>dateField().props.onChange({target:{value:'2026-10-15'}}))
  await act(async()=>r.root.findByType('form').props.onSubmit({preventDefault(){}}))
  assert.equal(calls[0][2].receivedDate,'2026-10-15')
  assert.equal(dateField().props.value,'2026-10-15')
  await act(async()=>r.update(React.createElement(Dialog,{...props,open:false})))
  await act(async()=>r.update(React.createElement(Dialog,props)))
  assert.equal(dateField().props.value,today)
})


test('Task 9: checkout date is part of confirmed payment, not of save-without-payment',async t=>{
  const {getBusinessDate}=await import('../../../../../shared/finance.js')
  const h=await workspaceHarness(t)
  const {default:Checkout}=await h.load('/src/app/workflows/payments/CheckoutPaymentComposition.jsx')
  const calls=[]
  const r=await h.render(Checkout,{totalCents:4000,paymentOptions:[{code:'pix',value:'Pix',label:'Pix'}],
    defaultPaymentMethod:'Pix',onConfirm:(...args)=>calls.push(args),onCancel(){}})
  const date=r.root.findByProps({'aria-label':'Data do recebimento'})
  assert.equal(date.props.value,getBusinessDate())
  assert.equal(date.props.max,getBusinessDate())
  await act(async()=>date.props.onChange({target:{value:'2026-10-15'}}))
  await act(async()=>buttonNamed(r.root,'Confirmar recebimento').props.onClick())
  assert.equal(calls[0][1],'2026-10-15')
  assert.deepEqual(calls[0][0],[{methodCode:'pix',amountCents:4000}])
  await act(async()=>r.root.findByProps({'aria-label':'Data do recebimento'}).props.onChange({target:{value:'2999-01-01'}}))
  assert.ok(buttonNamed(r.root,'Confirmar recebimento').props.disabled)
})

test('Task 9: standalone and client dialogs render the same controlled financial date, blocking invalid submissions',async t=>{
  const h=await workspaceHarness(t)
  const {default:OrderDialog}=await h.load('/src/app/workflows/payments/order/OrderPaymentDialog.jsx')
  const {default:ClientDialog}=await h.load('/src/app/workflows/payments/client-orders/ClientOrdersPaymentDialog.jsx')
  const allocation=[{methodCode:'pix',amountCents:1500}]
  const options=[{code:'pix',value:'Pix',label:'Pix'}]
  for(const [Component,extra] of [
    [OrderDialog,{order:{id:'o1',client:'Ana',orderNumber:1},supplemental:true}],
    [ClientDialog,{orders:[{id:'o1',orderNumber:1,total:15}],clientName:'Ana'}],
  ]){
    const dates=[]
    const dialog={...extra,totalCents:1500,allocations:allocation,setAllocations(){},
      paymentOptions:options,composition:{valid:true},receivedDate:'2026-10-15',
      dateValid:true,setReceivedDate:value=>dates.push(value),submit(){},onClose(){}}
    const r=await h.render(Component,{dialog,currency:v=>String(v)})
    const input=r.root.findByProps({'aria-label':'Data do recebimento'})
    assert.equal(input.props.value,'2026-10-15')
    assert.equal(input.props.max,getBusinessDate())
    await act(async()=>input.props.onChange({target:{value:'2026-10-14'}}))
    assert.deepEqual(dates,['2026-10-14'])
    await act(async()=>r.update(React.createElement(Component,{dialog:{...dialog,dateValid:false},currency:v=>String(v)})))
    assert.ok(buttonNamed(r.root,Component===OrderDialog?'Confirmar pagamento':'Confirmar recebimento').props.disabled)
    await act(async()=>r.unmount())
  }
})

test('Task 9: post-edit supplemental payment forwards its chosen date without changing refund flow',async t=>{
  const h=await workspaceHarness(t)
  const {default:Dialog}=await h.load('/src/app/workflows/payments/order/OrderEditSettlementDialog.jsx')
  const calls=[]
  const order={id:'after-edit',contentRevision:2,totalCents:9500,netReceivedCents:8000,dueCents:1500,refundDueCents:0,paymentId:'old'}
  const r=await h.render(Dialog,{order,stage:'receive',source:'edit',
    canReceivePayments:true,paymentOptions:[{code:'pix',value:'Pix',label:'Pix'}],
    defaultPaymentMethod:'Pix',onReceive:(...args)=>calls.push(args),onClose(){}})
  const date=r.root.findByProps({'aria-label':'Data do recebimento'})
  await act(async()=>date.props.onChange({target:{value:'2026-10-15'}}))
  await act(async()=>buttonNamed(r.root,'Confirmar recebimento').props.onClick())
  assert.deepEqual(calls[0][1],'2026-10-15')
  assert.deepEqual(calls[0][0],[{methodCode:'pix',amountCents:1500}])
})
