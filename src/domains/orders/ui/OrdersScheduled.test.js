import test from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8')

const readSourceTree = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true })
  const parts = await Promise.all(entries.map(async (entry) => {
    const url = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, directory)
    if (entry.isDirectory()) return readSourceTree(url)
    return entry.name.endsWith('.test.js') ? '' : readFile(url, 'utf8')
  }))
  return parts.flat(Infinity).join('\n')
}

test('orders page composes the approved kitchen heading, actions, counters, and persistent queues', async () => {
  const source = await read('./Orders.jsx')
  const requiredCopy = [
    'Cozinha',
    'Acompanhe os pedidos em preparo e agendados',
    'Som ativado',
    'Fila de impressão',
    'Novo pedido',
    'Em preparo',
    'Agendados',
    'Fora do prazo',
    'Finalizados hoje',
    'Prioridade por prazo',
    'Mais próximos primeiro',
    'Nenhum pedido em preparo agora.',
    'Nenhum pedido agendado aguardando preparo.',
  ]

  for (const text of requiredCopy) assert.match(source, new RegExp(text))
  assert.doesNotMatch(source, /Mais antigos primeiro/)
  assert.doesNotMatch(source, />Ver histórico</)
  assert.match(source, /<AreaNavigation area="orders" \/>/)
  assert.match(source, /buildKitchenQueueModel\(orders, now, search, currentTiming\)/)
  assert.match(source, /className="kitchen-page"/)
  assert.match(source, /className="kitchen-board"/)
  assert.equal(source.match(/className="kitchen-queue-section"/g)?.length, 2)
  assert.match(source, /<KitchenTicket/)
  assert.match(source, /queueModel\.counts\.(?:preparing|scheduled|late|finishedToday)/)
  assert.match(source, /queueModel\.preparing/)
  assert.match(source, /queueModel\.scheduled/)
})

test('orders page wires primary and cancellation actions by capability while keeping global counts independent from search results', async () => {
  const source = await read('./Orders.jsx')
  const preparingBlock = source.slice(source.indexOf('preparing.map'), source.indexOf('kitchen-scheduled-heading'))
  const scheduledBlock = source.slice(source.indexOf('queueModel.scheduled.map'), source.indexOf('!queueModel.scheduled.length'))
  assert.match(source, /onDetails=\{\(order\) => setDetailOrderId\(order\.id\)\}/)
  assert.match(preparingBlock, /disabled=\{actionsDisabled\}/)
  assert.match(preparingBlock, /onFinalize=\{canFinalizeOrders \? \(order\) => \{ setFinalizeCandidate\(order\); return true \} : undefined\}/)
  assert.match(preparingBlock, /onCancel=\{canCancelOrders \? \(order\) => \{ setCancelOrder\(order\); return true \} : undefined\}/)
  assert.match(scheduledBlock, /disabled=\{actionsDisabled\}/)
  assert.match(scheduledBlock, /onCancel=\{canCancelOrders \? \(order\) => \{ setCancelOrder\(order\); return true \} : undefined\}/)
  assert.doesNotMatch(scheduledBlock, /onFinalize=/)
  assert.doesNotMatch(source, /(?:preparing|scheduled)\.length[^\n]*StatCard/)
})

test('scheduled order details keep cancellation available and allow authorized editing of active orders', async () => {
  const source = await read('./Orders.jsx')

  assert.match(source, /<OrderDetail[\s\S]*onRequestCancel=\{canCancelOrders \? \(\) =>/)
  assert.doesNotMatch(source, /isScheduledWaiting\(detailOrder, now\)\s*\?\s*undefined/)
  assert.match(source, /onEditOrder=\{canEditOrders \?/)
  assert.match(source, /canEditOrders=\{canEditOrders\}/)
})

test('legacy waiting-window copy is absent from application source', async () => {
  const allSource = await readSourceTree(new URL('../../../', import.meta.url))
  assert.doesNotMatch(allSource, /Aguardando janela/i)
})
