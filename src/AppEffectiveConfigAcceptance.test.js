import test from 'node:test'
import assert from 'node:assert/strict'
import { act } from 'react-test-renderer'
import { workspaceHarness, buttonNamed, nodeText } from './test-support/renderWorkspace.js'

const session = {
  authenticated: true, authMode: 'user_only', deviceMode: 'shared',
  businessId: 'amor-e-sabor', settingsContextId: 'operator-context',
  user: { id: 'operator', displayName: 'Operador de Teste', roleName: 'Operador' },
  capabilities: ['orders.view', 'orders.history', 'orders.create', 'orders.finalize', 'comandas.view',
    'payments.receive', 'clients.view', 'clients.create', 'clients.update', 'products.view',
    'tables.view', 'printing.queue', 'printing.execute', 'printing.station.view', 'preferences.local'],
}
const effectiveBusinessConfig = {
  version: 'v1-4384a3de2330e2be7a48745a',
  revisions: { operations: 34, paymentMethods: 11, printingPolicy: 20 },
  operations: {
    enabledModalities: ['Entrega', 'Retirada', 'Local'], defaultModality: 'Retirada',
    timing: { scheduledPrepLeadMinutes: 50, scheduledLateGraceMinutes: 15, immediateLateAfterMinutes: 30, immediateVeryLateAfterMinutes: 40 },
  },
  paymentMethods: { methods: [{ code: 'cash', label: 'Dinheiro', value: 'Dinheiro' }], defaultMethod: 'cash' },
  printingPolicy: { automaticCopies: 1 },
}
const bootstrap = {
  business: { id: 'amor-e-sabor', name: 'Loja' }, clients: [{ id: 'client', name: 'Ana', phone: '', address: '' }], products: [],
  orders: [], tables: [], tableTabs: [], effectiveBusinessConfig,
}

async function mountOperator(t, initialEntries = ['/pedidos/novo'], initialBootstrap = bootstrap, initialSession = session) {
  const h = await workspaceHarness(t)
  let currentSession = initialSession, currentBootstrap = initialBootstrap, nextBootstrap
  globalThis.fetch = async path => {
    const pathname = new URL(path, 'https://delivery.test').pathname
    if (pathname === '/api/bootstrap' && nextBootstrap) {
      const pending = nextBootstrap
      nextBootstrap = null
      return pending
    }
    const data = pathname === '/api/auth/session' ? currentSession
      : pathname === '/api/bootstrap' ? currentBootstrap
      : pathname === '/api/orders' ? { orders: currentBootstrap.orders || [] }
      : pathname === '/api/printing/stations' ? { stations: [] }
      : pathname === '/api/printing/jobs/summary' ? { summary: {} }
      : pathname === '/api/printing/jobs' ? { jobs: [] } : null
    assert.ok(data, `Unexpected request: ${path}`)
    return { ok: true, json: async () => data }
  }
  const { default: App } = await h.load('/src/App.jsx')
  const { renderer, router } = await h.renderAdminApp(App, {}, { initialEntries, unstable_strictMode: true })
  return { h, App, renderer, router,
    setBootstrap: value => { currentBootstrap = value },
    holdNextBootstrap: value => { nextBootstrap = value },
    setSession: value => { currentSession = value },
  }
}
const assertConfirmedModality = (renderer, name = 'Retirada') => {
  assert.doesNotMatch(nodeText(renderer.root), /modalidades de pedido estão indisponíveis/)
  const modalities = renderer.root.findByProps({ 'aria-label': 'Tipo do pedido' })
  assert.equal(buttonNamed(modalities, name).props['aria-pressed'], true)
}
const selectClient = async renderer => {
  await act(async () => renderer.root.findByProps({ 'aria-label': 'Cliente' }).props.onFocus())
  await act(async () => buttonNamed(renderer.root, 'Ana').props.onClick())
}

test('opening a paid order editor from the App preserves identity and the official received balance',async t=>{
 const at=new Date().toISOString()
 const order={id:'paid-edit',orderNumber:27,clientId:'client',client:'Ana',type:'Retirada',status:'Em preparo',
  orderDate:at.slice(0,10),createdAt:at,subtotal:30,total:30,totalCents:3000,contentRevision:0,
  paymentId:'payment',paymentStatus:'Pago',netReceivedCents:3000,grossReceivedCents:3000,dueCents:0,refundDueCents:0,
  items:[{id:'line',productId:'prod',name:'Suco',category:'Bebidas',size:'Un',quantity:1,unitPrice:30,catalogPrice:30,note:''}]}
 const {renderer}=await mountOperator(t,['/pedidos'],{...bootstrap,orders:[order],products:[{id:'prod',name:'Suco',category:'Bebidas',size:'Un',price:30}]},{...session,capabilities:[...session.capabilities,'orders.edit','payments.refund']})
 await act(async()=>renderer.root.findAllByType('button').find(node=>node.props['aria-label']==='Exibir detalhes').props.onClick())
 await act(async()=>buttonNamed(renderer.root,'Editar pedido').props.onClick())
 assert.match(nodeText(renderer.root),/Editar pedido #27/)
 await act(async()=>buttonNamed(renderer.root,'Adicionar mais uma unidade de Suco').props.onClick())
 const next=renderer.root.findAllByType('button').find(node=>nodeText(node).includes('Revisar pedido'))
 assert.ok(next)
 await act(async()=>next.props.onClick())
 const summary=renderer.root.findByProps({'aria-label':'Resumo financeiro da edição'})
 for(const label of ['Total anterior','Recebido líquido','Saldo a receber']){
  const row=summary.findAllByType('div').find(node=>nodeText(node).startsWith(label))
  assert.match(nodeText(row),/30,00/,label)
 }
 assert.equal(buttonNamed(renderer.root,'Salvar e receber').props.disabled,false)
})

test('fresh and reloaded Operator new-order deep links initialize the confirmed default and pristine draft baseline', async t => {
  const { h, App, renderer, router } = await mountOperator(t)
  assertConfirmedModality(renderer)
  await act(async () => buttonNamed(renderer.root, 'Cancelar venda').props.onClick())
  assert.equal(router.state.location.pathname, '/pedidos')
  assert.doesNotMatch(nodeText(renderer.root), /Descartar venda em andamento/)
  await act(async () => renderer.unmount())
  const reloaded = await h.renderAdminApp(App, {}, { initialEntries: ['/pedidos/novo'], unstable_strictMode: true })
  assertConfirmedModality(reloaded.renderer)
  await act(async () => buttonNamed(reloaded.renderer.root, 'Cancelar venda').props.onClick())
  assert.equal(reloaded.router.state.location.pathname, '/pedidos')
  assert.doesNotMatch(nodeText(reloaded.renderer.root), /Descartar venda em andamento/)
})

test('normal Novo pedido entry retains confirmed options and requires review if its selected modality is disabled', async t => {
  const { h, renderer, setBootstrap } = await mountOperator(t, ['/pedidos'])
  await act(async () => buttonNamed(renderer.root, 'Novo pedido').props.onClick())
  assertConfirmedModality(renderer)
  await selectClient(renderer)
  assert.equal(buttonNamed(renderer.root, 'Escolher produtos →').props.disabled, false)
  setBootstrap({ ...bootstrap, effectiveBusinessConfig: { ...effectiveBusinessConfig, version: 'operator-v2',
    revisions: { ...effectiveBusinessConfig.revisions, operations: 35 },
    operations: { ...effectiveBusinessConfig.operations, enabledModalities: ['Entrega', 'Local'], defaultModality: 'Entrega' },
  } })
  await act(async () => h.fireInterval(5000))
  assert.match(nodeText(renderer.root), /Retirada não está mais ativa/)
  assert.equal(buttonNamed(renderer.root.findByProps({ 'aria-label': 'Tipo do pedido' }), 'Retirada').props['aria-pressed'], true)
  assert.equal(buttonNamed(renderer.root, 'Escolher produtos →').props.disabled, true)
  await act(async () => buttonNamed(renderer.root, 'Cancelar venda').props.onClick())
  assert.match(nodeText(renderer.root), /Descartar venda em andamento/)
})

test('direct new-order route owns its dirty draft before switch-user and cancel confirmations', async t => {
  const { renderer, router } = await mountOperator(t)
  assertConfirmedModality(renderer)
  await selectClient(renderer)
  assert.equal(buttonNamed(renderer.root, 'Escolher produtos →').props.disabled, false)
  await act(async () => buttonNamed(renderer.root, 'Loja, empresa atual').props.onClick())
  await act(async () => buttonNamed(renderer.root, 'Trocar usuário').props.onClick())
  assert.match(nodeText(renderer.root), /Descartar venda em andamento/)
  await act(async () => buttonNamed(renderer.root, 'Continuar na venda').props.onClick())
  assert.equal(renderer.root.findByProps({ 'aria-label': 'Cliente' }).props.value, 'Ana')
  assertConfirmedModality(renderer)
  await act(async () => buttonNamed(renderer.root, 'Cancelar venda').props.onClick())
  assert.match(nodeText(renderer.root), /Descartar venda em andamento/)
  await act(async () => buttonNamed(renderer.root, 'Descartar venda').props.onClick())
  assert.equal(router.state.location.pathname, '/pedidos')
  assert.equal(renderer.root.findAllByProps({ 'aria-label': 'Tipo do pedido' }).length, 0)
})

test('identity rediscovery initializes only the current Operator configuration and rejects a late former-owner bootstrap', async t => {
  const { h, renderer, router, setSession, setBootstrap, holdNextBootstrap } = await mountOperator(t)
  let release
  holdNextBootstrap(new Promise(resolve => { release = resolve }))
  await act(async () => h.fireInterval(5000))
  setSession({ ...session, user: { ...session.user, id: 'next-operator' }, settingsContextId: 'next-context' })
  setBootstrap({ ...bootstrap, effectiveBusinessConfig: { ...effectiveBusinessConfig, version: 'next-operator',
    operations: { ...effectiveBusinessConfig.operations, defaultModality: 'Entrega' },
  } })
  await act(async () => h.window.dispatchEvent(Object.assign(new Event('storage'), {
    key: 'delivery-session-change', newValue: JSON.stringify({ type: 'session-change', id: 'identity-change' }),
  })))
  await act(async () => router.navigate('/pedidos/novo'))
  assertConfirmedModality(renderer, 'Entrega')
  await act(async () => release({ ok: true, json: async () => bootstrap }))
  assertConfirmedModality(renderer, 'Entrega')
})

test('missing bootstrap configuration still blocks modality selection without inventing defaults', async t => {
  const { renderer } = await mountOperator(t, ['/pedidos/novo'], { ...bootstrap, effectiveBusinessConfig: null })
  assert.match(nodeText(renderer.root), /modalidades de pedido estão indisponíveis/)
  assert.equal(renderer.root.findByProps({ 'aria-label': 'Tipo do pedido' }).findAllByType('button').length, 0)
  assert.equal(buttonNamed(renderer.root, 'Escolher produtos →').props.disabled, true)
})
