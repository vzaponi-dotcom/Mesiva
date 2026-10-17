import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8')

test('Orders owns cancellation orchestration while History consumes the central order collection', async () => {
  const app = await read('./App.jsx')
  const orders = await read('./domains/orders/ui/Orders.jsx')
  const history = await read('./domains/orders/ui/OrderHistory.jsx')
  const shell = await read('./app/shell/AppShell.jsx')

  assert.match(app, /useOrderCommands/)
  assert.match(app, /api: clientsForContext\.orders/)
  assert.match(app, /<OrderHistory/)
  assert.match(app, /onCancelOrder=\{orderCommands\.cancelOrder\}/)
  assert.doesNotMatch(app, /cancelOrder as cancelOrderApi|const handleCancelOrder/)
  assert.doesNotMatch(orders, /cancelOrder as cancelOrderApi/)
  assert.doesNotMatch(orders, /cancelledIds/)
  assert.doesNotMatch(history, /getOrders as getOrdersApi/)
  assert.doesNotMatch(history, /cancelOrder as cancelOrderApi/)
  assert.doesNotMatch(shell, /<OrderHistory\s*\/>/)
})

test('central cancellation applies authoritative effects through the operational runtime before success feedback', async () => {
  const [commands, runtime] = await Promise.all([
    read('./domains/orders/application/useOrderCommands.js'),
    read('./app/runtime/data/useOperationalDataRuntime.js'),
  ])

  assert.match(commands, /const result = await api\.cancelOrder\(orderId, payload\)/)
  assert.match(commands, /applyOfficialEffects\(result\)/)
  assert.match(commands, /onSuccess\(payload\?\.refundNow \? 'Pedido cancelado e estorno registrado' : 'Pedido cancelado com sucesso'\)/)
  assert.ok(commands.indexOf('applyOfficialEffects(result)') < commands.indexOf("onSuccess(payload?.refundNow"))
  assert.match(runtime, /const applyOfficialEffects = useCallback/)
  assert.match(runtime, /if \(order\) commitOrders\(\(current\) => upsertById\(current, order\)\)/)
  assert.match(runtime, /if \(movement\) setMovements\(\(current\) => upsertById\(current, movement\)\)/)
  assert.match(runtime, /if \(tableTab\) setTableTabs\(\(current\) => upsertById\(current, tableTab\)\)/)
})


test('App delegates kitchen search to Orders with the complete order collection', async () => {
  const app = await read('./App.jsx')

  assert.match(app, /<Orders orders=\{orders\}/)
  assert.doesNotMatch(app, /const filteredOrders = useMemo/)
})
