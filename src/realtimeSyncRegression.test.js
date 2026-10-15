import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8')
const [app, runtime, onlineRuntime, newOrderDraft] = await Promise.all([
  read('./App.jsx'),
  read('./app/runtime/data/useOperationalDataRuntime.js'),
  read('./app/runtime/network/useOnlineStatus.js'),
  read('./domains/orders/application/useNewOrderDraft.js'),
])

test('operation indicators use domain selectors without new network or polling loops', async () => {
  assert.match(app, /getOperationalOrderCount/)
  assert.match(app, /getOpenComandaCount/)
  assert.match(app, /businessId={sessionContext\?\.businessId/)
  assert.match(app, /navigationBadges={{\s*orders:/)
  assert.match(app, /currentTiming={currentTiming}/)
  for (const path of ['./app/shell/AppTopBar.jsx', './app/shell/navigationBadges.js', './domains/table-service/domain/comandaActivity.js']) {
    const source = await read(path)
    assert.doesNotMatch(source, /setInterval|fetch\(|WebSocket|EventSource/)
  }
})

test('App delegates official-data synchronization to the operational runtime', () => {
  assert.match(app, /useOperationalDataRuntime/)
  // Actual App cadence/enrollment and stale-session behavior is exercised by
  // kitchenLiveRefresh, AppSessionAccess and the runtime's behavioral tests.
  assert.doesNotMatch(app, /createCollectionSyncGuard/)
  assert.doesNotMatch(app, /bootstrapSyncInFlightRef/)
  assert.doesNotMatch(app, /ordersSyncInFlightRef/)
})

test('operational runtime owns per-collection guards and the global/orders cadences', () => {
  assert.match(runtime, /createCollectionSyncGuard/)
  assert.match(runtime, /const DATA_COLLECTIONS = \['clients', 'products', 'orders', 'tables', 'tableTabs', 'movements', 'financeSettings'\]/)
  assert.match(runtime, /export const GLOBAL_SYNC_INTERVAL_MS = 5_000/)
  assert.match(runtime, /export const ORDER_SYNC_INTERVAL_MS = 2_000/)
  assert.match(runtime, /bootstrapSyncInFlightRef/)
  assert.match(runtime, /ordersSyncInFlightRef/)
  assert.match(runtime, /beginRead\(GUARD_COLLECTIONS\)/)
  assert.match(runtime, /beginRead\(\['orders','operationalCounters'\]\)/)
  assert.match(runtime, /canApply\(token, 'orders'\)/)
})

test('global sync remains silent and reacts to visibility focus and reconnect through runtime boundaries', () => {
  assert.match(runtime, /refreshBootstrapSilently/)
  assert.match(runtime, /createRefreshSubscription/)
  assert.match(runtime, /visibilitychange/)
  assert.match(runtime, /addEventListener\?\.\('focus'/)
  assert.match(onlineRuntime, /addEventListener\('online'/)
  assert.match(onlineRuntime, /addEventListener\('offline'/)
  assert.match(app, /const isOnline = useOnlineStatus\(\)/)
})

test('orders keep the faster cadence and stale order reads cannot overwrite newer state', () => {
  assert.match(runtime, /getOrders/)
  assert.match(runtime, /ORDER_SYNC_INTERVAL_MS/)
  assert.match(runtime, /ordersSyncInFlightRef\.current/)
  assert.match(runtime, /canApply\(token, 'orders'\)/)
})

test('paid checkout applies authoritative effects locally instead of awaiting full bootstrap', () => {
  assert.match(app, /submitOrder: clientsForContext\.orders\.createOrder/)
  assert.match(app, /commitOfficialEffects: applyOfficialEffects/)
  assert.match(newOrderDraft, /await submitOrderRef\.current\(payload, token\.idempotencyKey\)/)
  assert.match(newOrderDraft, /commitOfficialEffectsRef\.current\(result\)/)
  assert.doesNotMatch(app, /if \(order\.paymentStatus === 'Pago'\) await refreshBootstrap\(\)/)
  assert.match(runtime, /markMutation/)
  assert.match(runtime, /upsertById/)
})
