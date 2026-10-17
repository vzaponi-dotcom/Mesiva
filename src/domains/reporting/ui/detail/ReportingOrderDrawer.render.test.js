import test from 'node:test'
import assert from 'node:assert/strict'
import { act } from 'react-test-renderer'
import { workspaceHarness, nodeText } from '../../../../test-support/renderWorkspace.js'

const order = {
  id: 'o186', order_number: 186, order_date: '2026-09-25', created_at: '2026-09-25T22:42:00Z',
  client_id: 'c1', client_name_snapshot: 'Teles', client_phone_snapshot: '(31) 31656-5949', client_address_snapshot: '',
  type: 'Retirada', status: 'Em preparo', subtotal_cents: 15500, total_cents: 15500,
  delivery_fee_cents: 0, adjustment_type: 'none', adjustment_amount_cents: 0,
  paidCents: 0, pendingCents: 15500, durationMinutes: null, onTime: null,
  items: [
    { id: 'i1', quantity: 1, name_snapshot: '[TESTE] Combo Família', category_snapshot: 'Combos', size_snapshot: 'Un', unit_price_cents: 7900 },
    { id: 'i2', quantity: 1, name_snapshot: '[TESTE] Combo Individual', category_snapshot: 'Combos', size_snapshot: 'Un', unit_price_cents: 2800 },
    { id: 'i3', quantity: 1, name_snapshot: '[TESTE] Combo Duplo', category_snapshot: 'Combos', size_snapshot: 'Un', unit_price_cents: 4800 },
  ],
  paymentAllocations: [
    { receipt_id: 'r1', method_code: 'pix', method_label: 'Pix', amount_cents: 5000, paid_at: '2026-09-25T22:44:00Z' },
  ],
  clientContext: {
    profile: { id: 'c1', name: 'Teles', phone: '31316565949', address: '' },
    summary: { ordersCount: 8, totalSpentCents: 62400, averageTicketCents: 7800, pendingCents: 15500, cancellationCount: 1, lastPurchaseDate: '2026-09-25' },
    orders: [
      { id: 'o186', order_number: 186, order_date: '2026-09-25', created_at: '2026-09-25T22:42:00Z', type: 'Retirada', status: 'Em preparo', total_cents: 15500, paidCents: 0, pendingCents: 15500 },
      { id: 'o173', order_number: 173, order_date: '2026-09-18', created_at: '2026-09-18T20:00:00Z', type: 'Entrega', status: 'Finalizado', total_cents: 8200, paidCents: 8200, pendingCents: 0 },
      { id: 'o172', order_number: 172, order_date: '2026-09-17', created_at: '2026-09-17T20:00:00Z', type: 'Entrega', status: 'Finalizado', total_cents: 5000, paidCents: 2000, pendingCents: 3000 },
      { id: 'o119', order_number: 119, order_date: '2026-09-02', created_at: '2026-09-02T20:00:00Z', type: 'Entrega', status: 'Cancelado', total_cents: 9300, paidCents: 0, pendingCents: 0 },
    ],
  },
}

test('reporting order drawer implements Details, History, Client and client-order views from the approved mockups', async (t) => {
  const h = await workspaceHarness(t)
  const { ReportingOrderDrawer } = await h.load('/src/domains/reporting/ui/detail/ReportingOrderDrawer.jsx')
  const openedClients = []
  const openedOrders = []
  const api = { loadOrder: async () => ({ data: order }) }
  const renderer = await h.render(ReportingOrderDrawer, {
    id: 'o186', api, onClose() {},
    onOpenClient: (client) => openedClients.push(client.id),
    onSelectOrder: (id) => openedOrders.push(id),
  })

  assert.match(nodeText(renderer.root), /Informações do pedido/)
  const tab = (name) => renderer.root.findAllByType('button').find((button) => nodeText(button) === name)
  const filterButton = (name) => renderer.root.findAllByType('button').find((button) => nodeText(button) === name)
  const visibleClientOrders = () => renderer.root
    .findAll((node) => node.props?.className === 'reporting-client-order-title')
    .map((title) => nodeText(title.findByType('strong')))

  await act(async () => tab('Histórico').props.onClick())
  const history = nodeText(renderer.root)
  assert.match(history, /Linha do tempo do pedido/)
  assert.match(history, /Pedido criado/)
  assert.match(history, /Pagamento registrado/)
  assert.match(history, /Status atual do pedido/)
  assert.equal(tab('Histórico').props['aria-selected'], true)

  await act(async () => tab('Cliente').props.onClick())
  const client = nodeText(renderer.root)
  for (const label of ['Perfil do cliente', 'Relacionamento com a loja', 'Dados deste pedido', 'Abrir cadastro do cliente', 'Ver pedidos do cliente']) {
    assert.match(client, new RegExp(label))
  }
  assert.match(client, /\(31\) 31656-5949/)
  const openClient = renderer.root.findAllByType('button').find((button) => nodeText(button).includes('Abrir cadastro do cliente'))
  await act(async () => openClient.props.onClick())
  assert.deepEqual(openedClients, ['c1'])

  const clientOrders = renderer.root.findAllByType('button').find((button) => nodeText(button).includes('Ver pedidos do cliente'))
  await act(async () => clientOrders.props.onClick())
  const ordersText = nodeText(renderer.root)
  assert.match(ordersText, /Pedidos do cliente/)
  assert.match(ordersText, /Pedido atual/)
  assert.match(ordersText, /Pedido #173/)
  for (const filter of ['Todos', 'Em andamento', 'Finalizados', 'A receber', 'Cancelados']) assert.match(ordersText, new RegExp(filter))

  await act(async () => filterButton('Em andamento').props.onClick())
  assert.deepEqual(visibleClientOrders(), ['Pedido #186'])

  await act(async () => filterButton('Finalizados').props.onClick())
  assert.deepEqual(visibleClientOrders(), ['Pedido #173', 'Pedido #172'])

  await act(async () => filterButton('A receber').props.onClick())
  assert.deepEqual(visibleClientOrders(), ['Pedido #186', 'Pedido #172'])
  const receivableRows = renderer.root.findAll((node) => typeof node.props?.className === 'string' && node.props.className.includes('reporting-client-order-row'))
  assert.match(nodeText(receivableRows[0]), /Não pago/)
  assert.match(nodeText(receivableRows[1]), /Parcial/)
  assert.doesNotMatch(nodeText(receivableRows[0]), /Finalizado/)

  await act(async () => filterButton('Cancelados').props.onClick())
  assert.deepEqual(visibleClientOrders(), ['Pedido #119'])

  await act(async () => filterButton('Todos').props.onClick())
  const previous = renderer.root.findAllByType('button').find((button) => nodeText(button).includes('Pedido #173'))
  await act(async () => previous.props.onClick())
  assert.deepEqual(openedOrders, ['o173'])
})


test('Task 8: report timeline shows effective date separately from actual registration and keeps recorded order',async t=>{
  const h=await workspaceHarness(t)
  const {ReportingOrderDrawer}=await h.load('/src/domains/reporting/ui/detail/ReportingOrderDrawer.jsx')
  const data={...order,id:'backdated-order',status:'Finalizado',paidCents:9500,pendingCents:0,finished_at:'2026-10-17T13:00:00Z',
    paymentAllocations:[
      {receipt_id:'initial',method_label:'Pix',amount_cents:8000,paid_at:'2026-10-17T10:00:00Z',received_date:'2026-10-14'},
      {receipt_id:'later',method_label:'Pix',amount_cents:1000,paid_at:'2026-10-17T12:00:00Z',received_date:'2026-10-15'},
      {receipt_id:'later',method_label:'Dinheiro',amount_cents:500,paid_at:'2026-10-17T12:00:00Z',received_date:'2026-10-15'},
    ]}
  const renderer=await h.render(ReportingOrderDrawer,{id:'backdated-order',api:{loadOrder:async()=>({data})},onClose(){}})
  const tabs=renderer.root.findAllByType('button')
  await act(async()=>tabs.find(x=>nodeText(x)==='Histórico').props.onClick())
  const history=nodeText(renderer.root)
  assert.match(history,/Recebido em 14\/10\/2026/)
  assert.match(history,/Recebido em 15\/10\/2026/)
  assert.match(history,/Registrado em 17\/10\/2026/)
  assert.equal((history.match(/Pagamento registrado/g)||[]).length,2)
  assert.ok(history.indexOf('Recebido em 14/10/2026')<history.indexOf('Recebido em 15/10/2026'))
})
