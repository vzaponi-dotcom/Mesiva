import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { act } from 'react-test-renderer'
import { workspaceHarness, buttonNamed, nodeText } from '../../../test-support/renderWorkspace.js'

const clients = [{ id: 'c1', name: 'Ana', phone: '11999990000', address: 'Rua Um' }]
const order = { id: 'o1', orderNumber: 148, clientId: 'c1', client: 'Ana', type: 'Retirada', status: 'Em preparo', total: 67, subtotal: 67, orderDate: '2026-10-04', createdAt: '2026-10-04T18:00:00Z', paymentStatus: 'Pendente', items: [{ productId: 'p', name: 'Café', quantity: 1, unitPrice: 67 }] }

test('customer profile opens readable order history and collection only with the payment grant', async t => {
  const h = await workspaceHarness(t)
  const { default: Clients } = await h.load('/src/app/surfaces/customers/CustomersSurface.jsx')
  const received = []
  const props = { clients, orders: [order], search: '', sort: 'name-asc', onSearchChange() {}, onSortChange() {}, granted: new Set(['clients.view', 'orders.view', 'orders.history', 'payments.receive']), currency: n => `R$ ${n}`, onRegisterPayment: (...args) => received.push(args) }
  const renderer = await h.render(Clients, props)
  assert.ok(buttonNamed(renderer.root, 'Abrir perfil de Ana'))
  await act(async () => buttonNamed(renderer.root, 'Abrir perfil de Ana').props.onClick())
  assert.match(nodeText(renderer.root), /Ticket médio/)
  await act(async () => buttonNamed(renderer.root, 'Receber pagamento').props.onClick())
  await act(async () => buttonNamed(renderer.root, 'Receber pagamento do Pedido #148').props.onClick())
  assert.deepEqual(received, [['o1', 'orders']])
  await act(async () => renderer.update(React.createElement(Clients, { ...props, granted: new Set(['clients.view', 'orders.view', 'orders.history']) })))
  assert.equal(buttonNamed(renderer.root, 'Receber pagamento do Pedido #148'), undefined)
})

test('Clientes selects an edited supplemental balance together with unpaid orders at the exact due total',async t=>{
 const h=await workspaceHarness(t)
 const {default:Surface}=await h.load('/src/app/surfaces/customers/CustomersSurface.jsx')
 const received=[]
 const partial={...order,customerIdentityType:'registered_client',total:60,totalCents:6000,netReceivedCents:3000,dueCents:3000,contentRevision:1,paymentId:'paid',paymentStatus:'Parcialmente pago'}
 const renderer=await h.render(Surface,{clients,orders:[partial,{...order,id:'o2',orderNumber:149,customerIdentityType:'registered_client',total:20,dueCents:2000}],granted:new Set(['clients.view','orders.view','orders.history','payments.receive']),currency:n=>`R$ ${n}`,onRegisterPayment(){},onRegisterClientOrdersPayment:target=>received.push(target)})
 await act(async()=>buttonNamed(renderer.root,'Abrir perfil de Ana').props.onClick())
 await act(async()=>buttonNamed(renderer.root,'Receber pagamento').props.onClick())
 await act(async()=>buttonNamed(renderer.root,'Selecionar todos').props.onClick())
 assert.match(nodeText(renderer.root),/R\$ 50/)
 const receive=buttonNamed(renderer.root,'Receber selecionados')
 assert.ok(receive)
 await act(async()=>receive.props.onClick())
 assert.deepEqual(new Set(received[0].orderIds),new Set(['o1','o2']))
})

test('customers without order access retain registration without fabricated zero purchase metrics', async t => {
  const h = await workspaceHarness(t)
  const { default: Clients } = await h.load('/src/app/surfaces/customers/CustomersSurface.jsx')
  const renderer = await h.render(Clients, { clients, orders: [order], search: '', sort: 'name-asc', onSearchChange() {}, onSortChange() {}, granted: new Set(['clients.view']), currency: n => `R$ ${n}` })
  await act(async () => buttonNamed(renderer.root, 'Abrir perfil de Ana').props.onClick())
  assert.doesNotMatch(nodeText(renderer.root), /Ticket médio|Receber pagamento/)
  assert.match(nodeText(renderer.root), /Sem permissão para consultar pedidos/)
})

test('paid cancelled and table-linked orders never expose standalone collection and live updates refresh the balance', async t => {
  const h = await workspaceHarness(t)
  const { default: Surface } = await h.load('/src/app/surfaces/customers/CustomersSurface.jsx')
  const props = { clients, orders: [order, { ...order, id: 'paid', orderNumber: 149, paymentStatus: 'Pago' }, { ...order, id: 'cancelled', orderNumber: 150, status: 'Cancelado' }, { ...order, id: 'table', orderNumber: 151, type: 'Local', tableTabId: 'tab' }], granted: new Set(['clients.view', 'orders.view', 'orders.history', 'payments.receive']), currency: n => `R$ ${n}`, onRegisterPayment() {} }
  const renderer = await h.render(Surface, props)
  await act(async () => buttonNamed(renderer.root, 'Abrir perfil de Ana').props.onClick())
  await act(async () => buttonNamed(renderer.root, 'Pedidos').props.onClick())
  assert.ok(buttonNamed(renderer.root, 'Receber pagamento do Pedido #148'))
  for (const number of [149, 150, 151]) assert.equal(buttonNamed(renderer.root, `Receber pagamento do Pedido #${number}`), undefined)
  assert.match(nodeText(renderer.root), /Receber pela comanda/)
  await act(async () => buttonNamed(renderer.root, 'Ver detalhes do Pedido #148').props.onClick())
  assert.ok(buttonNamed(renderer.root, 'Registrar pagamento'))
  await act(async () => renderer.update(React.createElement(Surface, { ...props, orders: props.orders.map(o => ({ ...o, paymentStatus: 'Pago' })) })))
  assert.equal(buttonNamed(renderer.root, 'Registrar pagamento'), undefined)
  assert.equal(buttonNamed(renderer.root, 'Receber pagamento do Pedido #148'), undefined)
  assert.doesNotMatch(nodeText(renderer.root), /Receber pela comanda/)
  assert.match(nodeText(renderer.root.findAllByProps({ className: 'client-open-balance ' })[0]), /Sem saldo/)
})

test('client deletion remains an explicit confirmation and cancelled filters leave the list untouched', async t => {
  const h = await workspaceHarness(t)
  const { default: Clients } = await h.load('/src/domains/customers/ui/Clients.jsx')
  const deleted = []
  const props = { clients: [...clients, { id: 'empty', name: 'Bia' }], orders: [order], granted: new Set(['clients.view', 'orders.view', 'orders.history']), canDeleteClients: true, onDelete: async id => { deleted.push(id); return true } }
  const renderer = await h.render(Clients, props)
  await act(async () => buttonNamed(renderer.root, 'Filtros').props.onClick())
  await act(async () => renderer.root.findAllByType('input').find(n => n.props.value === 'empty').props.onChange())
  await act(async () => buttonNamed(renderer.root, 'Fechar').props.onClick())
  assert.ok(buttonNamed(renderer.root, 'Abrir perfil de Ana'))
  assert.ok(buttonNamed(renderer.root, 'Abrir perfil de Bia'))
  await act(async () => buttonNamed(renderer.root, 'Abrir perfil de Ana').props.onClick())
  await act(async () => buttonNamed(renderer.root, 'Cadastro').props.onClick())
  assert.ok(!buttonNamed(renderer.root, 'Mais ações do cliente'))
  await act(async () => buttonNamed(renderer.root, 'Excluir cliente').props.onClick())
  assert.deepEqual(deleted, [])
  const confirm = renderer.root.findAllByProps({ role: 'dialog' }).find(n => n.props['aria-label'] === 'Excluir cliente')
  await act(async () => buttonNamed(confirm, 'Excluir cliente').props.onClick())
  assert.deepEqual(deleted, ['c1'])
})

test('customer batch selection excludes ineligible orders and drops paid selections after official updates', async t => {
  const h = await workspaceHarness(t)
  const { default: Surface } = await h.load('/src/app/surfaces/customers/CustomersSurface.jsx')
  const received = []
  const registered = { ...order, customerIdentityType: 'registered_client' }
  const rows = [registered, { ...registered, id: 'o2', orderNumber: 149, total: 13 }, { ...registered, id: 'table', orderNumber: 150, type: 'Local', tableTabId: 'tab' }, { ...registered, id: 'paid', paymentStatus: 'Pago' }, { ...registered, id: 'cancelled', status: 'Cancelado' }]
  const props = { clients, orders: rows, granted: new Set(['clients.view', 'orders.view', 'orders.history', 'payments.receive']), currency: n => `R$ ${n}`, onRegisterPayment: (...args) => received.push(args), onRegisterClientOrdersPayment: target => { received.push(target); return true } }
  const renderer = await h.render(Surface, props)
  await act(async () => buttonNamed(renderer.root, 'Abrir perfil de Ana').props.onClick())
  await act(async () => buttonNamed(renderer.root, 'Receber pagamento').props.onClick())
  const boxes = () => renderer.root.findAllByType('input').filter(n => n.props.type === 'checkbox')
  assert.equal(boxes().length, 2)
  assert.equal(buttonNamed(renderer.root, 'Receber selecionados').props.disabled, true)
  await act(async () => buttonNamed(renderer.root, 'Selecionar todos').props.onClick())
  assert.match(nodeText(renderer.root), /2 pedidos selecionadosR\$ 80/)
  await act(async () => buttonNamed(renderer.root, 'Receber selecionados').props.onClick())
  assert.deepEqual(received, [{ clientId: 'c1', orderIds: ['o1', 'o2'] }])
  await act(async () => renderer.update(React.createElement(Surface, { ...props, orders: rows.map(o => o.id === 'o1' ? { ...o, paymentStatus: 'Pago' } : o) })))
  assert.equal(boxes().length, 1)
  assert.match(nodeText(renderer.root), /1 pedido selecionadoR\$ 13/)
  await act(async () => buttonNamed(renderer.root, 'Receber selecionados').props.onClick())
  assert.deepEqual(received[1], ['o2', 'orders'])
  await act(async () => renderer.update(React.createElement(Surface, { ...props, granted: new Set(['clients.view', 'orders.view', 'orders.history']) })))
  assert.equal(boxes().length, 0)
  assert.equal(buttonNamed(renderer.root, 'Receber selecionados'), undefined)
})
