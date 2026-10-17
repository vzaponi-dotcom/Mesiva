import test from 'node:test'
import assert from 'node:assert/strict'
import { loadEffectiveBusinessConfig, readEffectiveConfigVersion } from './effectiveBusinessConfig.js'
import { createSettingsDb } from './test-support/settingsDb.js'
import { loadBootstrap } from './repositories.js'

const BUSINESS = 'amor-e-sabor'

test('effective projection contains only operational data allowed by server capabilities', async (t) => {
  const { db, sqlite, close } = createSettingsDb()
  t.after(close)
  sqlite.exec("UPDATE business_payment_methods SET active = 0 WHERE code = 'cash'; UPDATE business_cancel_reasons SET active = 0 WHERE id = 'duplicate_order'; UPDATE business_finance_categories SET active = 0 WHERE id = 'supplies'")
  const granted = new Set(['orders.create', 'payments.receive', 'orders.cancel', 'finance.movements.manage', 'printing.execute'])
  const effective = await loadEffectiveBusinessConfig(db, BUSINESS, granted)

  assert.deepEqual(Object.keys(effective).sort(), ['cancellationReasons', 'financeCategories', 'operations', 'paymentMethods', 'printingPolicy', 'revisions', 'version'])
  assert.equal(effective.paymentMethods.methods.some(({ code }) => code === 'cash'), false)
  assert.equal(effective.cancellationReasons.items.some(({ id }) => id === 'duplicate_order'), false)
  assert.equal(effective.financeCategories.items.some(({ id }) => id === 'supplies'), false)
  assert.equal(JSON.stringify(effective).includes('meta'), false)
  assert.equal(JSON.stringify(effective).includes('receipt'), false)
  assert.equal(JSON.stringify(effective).includes('active'), false)
})

test('effective config validates loaded revisions with one version batch', async t => {
  const { db, close } = createSettingsDb()
  t.after(close)
  const batch = db.batch.bind(db)
  let calls = 0
  db.batch = async statements => { calls++; return batch(statements) }
  const effective = await loadEffectiveBusinessConfig(db, BUSINESS, new Set(['orders.view', 'payments.receive', 'printing.execute']))
  assert.equal(effective.operations.defaultModality, 'Entrega')
  assert.equal(calls, 1)
})

test('effective config retries if a revision changes while loading', async t => {
  const { db, sqlite, close } = createSettingsDb()
  t.after(close)
  const batch = db.batch.bind(db)
  let calls = 0
  db.batch = async statements => {
    if (++calls === 1) sqlite.prepare('UPDATE business_operation_settings SET revision=revision+1 WHERE business_id=?').run(BUSINESS)
    return batch(statements)
  }
  const effective = await loadEffectiveBusinessConfig(db, BUSINESS, new Set(['orders.view']))
  assert.equal(effective.revisions.operations, 2)
  assert.equal(calls, 2)
})

test('effective version is deterministic for revision vector and capability identity', async (t) => {
  const { db, close } = createSettingsDb()
  t.after(close)
  const left = new Set(['printing.queue', 'orders.view', 'payments.receive'])
  const right = new Set(['payments.receive', 'orders.view', 'printing.queue'])
  const first = await readEffectiveConfigVersion(db, BUSINESS, left)
  const reordered = await readEffectiveConfigVersion(db, BUSINESS, right)
  const narrower = await readEffectiveConfigVersion(db, BUSINESS, new Set(['orders.view']))
  assert.equal(first.version, reordered.version)
  assert.deepEqual(first.revisions, reordered.revisions)
  assert.notEqual(first.version, narrower.version)
})

test('effective projection omits domains not needed by granted operations', async (t) => {
  const { db, close } = createSettingsDb()
  t.after(close)
  const effective = await loadEffectiveBusinessConfig(db, BUSINESS, new Set(['orders.cancel']))
  assert.deepEqual(Object.keys(effective).sort(), ['cancellationReasons', 'revisions', 'version'])
})

test('bootstrap preserves legacy datasets and adds the effective projection', async (t) => {
  const { db, close } = createSettingsDb()
  t.after(close)
  const effective = await loadEffectiveBusinessConfig(db, BUSINESS, new Set(['orders.view']))
  const bootstrap = await loadBootstrap(db, BUSINESS, effective)
  assert.equal(Array.isArray(bootstrap.orders), true)
  assert.equal(Array.isArray(bootstrap.products), true)
  assert.equal(bootstrap.effectiveBusinessConfig.version, effective.version)
})

test('a new business without settings rows receives defensive revision-zero defaults', async (t) => {
  const { db, sqlite, close } = createSettingsDb()
  t.after(close)
  sqlite.prepare('INSERT INTO businesses (id, slug, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run('new-business', 'new-business', 'New', '2026-09-12T10:00:00.000Z', '2026-09-12T10:00:00.000Z')
  const effective = await loadEffectiveBusinessConfig(db, 'new-business', new Set(['orders.view']))
  assert.equal(effective.revisions.operations, 0)
  assert.equal(effective.operations.defaultModality, 'Entrega')
})
