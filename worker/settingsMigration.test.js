import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readdirSync, readFileSync } from 'node:fs'
import { DEFAULT_OPERATIONS, DEFAULT_PAYMENT_METHODS, paymentLabel } from '../shared/businessPolicies.js'
import { nativeCancellationReasons, nativeFinanceCategories } from '../shared/settingsCatalogs.js'
import { createSettingsDb } from './test-support/settingsDb.js'

const migrations = new URL('../migrations/', import.meta.url)

const BUSINESS = 'amor-e-sabor'
const EARLY = '2025-01-01T10:00:00.000Z'
const LATE = '2025-02-01T10:00:00.000Z'
const rows = (sqlite, sql, ...values) => sqlite.prepare(sql).all(...values).map((row) => ({ ...row }))
const one = (sqlite, sql, ...values) => rows(sqlite, sql, ...values)[0]
const names = (sqlite) => rows(sqlite, "SELECT name FROM sqlite_master WHERE type = 'table'").map(({ name }) => name)
const normalized = (label) => label.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('pt-BR')
const normalizedSchema = (schemaRows) => schemaRows.map(({ type, name, tbl_name, sql }) => ({
  type, name, tbl_name, sql: sql?.replaceAll('"', '').replace(/\s+/g, ' ').trim() ?? null,
}))
const settingsTables = ['business_operation_settings', 'business_order_modalities', 'business_payment_settings',
  'business_payment_methods', 'business_cancellation_settings', 'business_cancel_reasons',
  'business_finance_category_settings', 'business_finance_categories', 'business_print_topology_settings',
  'settings_mutation_receipts', 'settings_tx_assertions']

function insert(sqlite, table, data) {
  const keys = Object.keys(data)
  sqlite.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...Object.values(data))
}

function seedHistory(sqlite) {
  insert(sqlite, 'businesses', { id: 'second', slug: 'second', name: 'Second', created_at: EARLY, updated_at: LATE })
  insert(sqlite, 'businesses', { id: 'third', slug: 'third', name: 'Third', created_at: EARLY, updated_at: LATE })
  sqlite.exec("UPDATE business_print_settings SET default_copies = 1")
  for (const business of [BUSINESS, 'second']) {
    insert(sqlite, 'print_stations', { id: `${business}-primary`, business_id: business, name: 'Primary',
      platform: 'windows', is_primary: 1, default_copies: 2, created_at: EARLY, updated_at: LATE })
  }
  for (const [id, business, reason, time] of [['cancelled', BUSINESS, 'other', EARLY], ['later', BUSINESS, 'other', LATE], ['paid', BUSINESS, null, LATE], ['second-order', 'second', 'entry_error', LATE]]) {
    insert(sqlite, 'orders', { id, business_id: business, client_name_snapshot: 'Historical name', type: 'Entrega',
      order_date: time.slice(0, 10), status: reason ? 'Cancelado' : 'Finalizado', subtotal_cents: 1250,
      total_cents: 1275, delivery_fee_cents: 25, cancel_reason: reason, cancel_reason_note: reason ? 'Historical note' : null,
      cancelled_at: reason ? time : null, created_at: time, finished_at: time, order_number: id === 'cancelled' ? 42 : null })
  }
  insert(sqlite, 'order_items', { id: 'item', business_id: BUSINESS, order_id: 'cancelled', name_snapshot: 'Historical item',
    quantity: 1, catalog_price_cents: 1300, unit_price_cents: 1250, price_reason: 'special', created_at: EARLY })
  insert(sqlite, 'payments', { id: 'payment', business_id: BUSINESS, order_id: 'paid', amount_cents: 1275, method: 'Pix', paid_at: LATE, created_at: LATE })
  const movement = { business_id: BUSINESS, type: 'saida', category: 'Insumos', description: 'Preserve history',
    value_cents: 700, source: 'manual', movement_date: '2025-01-01', created_at: EARLY, updated_at: LATE, deleted_at: LATE, payment_method: 'Pix' }
  insert(sqlite, 'movements', { ...movement, id: 'deleted' })
  insert(sqlite, 'movements', { ...movement, id: 'current', category: 'supplies', created_at: LATE, deleted_at: null })
  insert(sqlite, 'movements', { ...movement, id: 'delivery', category: 'Delivery', payment_method: 'cash' })
  insert(sqlite, 'movements', { ...movement, id: 'other-in', type: 'entrada', category: 'Outros' })
  insert(sqlite, 'movements', { ...movement, id: 'other-out', category: 'Despesas' })
  insert(sqlite, 'movements', { ...movement, id: 'automatic', type: 'entrada', category: 'Vendas', source: 'order-payment', payment_id: 'payment', order_id: 'paid' })
  insert(sqlite, 'table_tabs', { id: 'tab', business_id: BUSINESS, table_identifier: 'Mesa histórica', status: 'closed',
    opened_at: EARLY, closed_at: LATE, created_at: EARLY, updated_at: LATE, tab_number: 17 })
  const job = { business_id: BUSINESS, order_id: 'paid', type: 'order', trigger: 'manual', status: 'awaiting_second_copy',
    copies_requested: 2, copies_printed: 1, station_id: `${BUSINESS}-primary`, snapshot_json: '{"historical":true}',
    created_at: EARLY, second_copy_prompted_at: LATE, second_copy_requested_at: LATE }
  insert(sqlite, 'print_jobs', { ...job, id: 'job' })
  insert(sqlite, 'print_jobs', { ...job, id: 'retry', parent_job_id: 'job', status: 'printed', copies_printed: 2, second_copy_skipped_at: LATE })
  insert(sqlite, 'print_jobs', { ...job, id: 'tab-job', order_id: null, table_tab_id: 'tab', type: 'table-tab', copies_requested: 1, status: 'printed' })
  for (const [id, jobId, number] of [['attempt', 'job', 1], ['retry-attempt', 'retry', 2], ['tab-attempt', 'tab-job', 1]]) {
    insert(sqlite, 'print_job_attempts', { id, business_id: BUSINESS, job_id: jobId, copy_number: number, attempt_number: 1,
      station_id: `${BUSINESS}-primary`, spool_job_name: id, spool_job_id: 123, status: 'complete',
      resolution: 'manual_printed', resolution_actor_label: 'Historical operator', completed_at: LATE, created_at: EARLY, updated_at: LATE })
  }
  sqlite.prepare('UPDATE print_stations SET recovery_job_id = ? WHERE id = ?').run('job', `${BUSINESS}-primary`)
}

test('real migrations seed an empty database with every typed resource and T01 defaults', (t) => {
  const { sqlite, close } = createSettingsDb()
  t.after(close)
  for (const table of settingsTables) assert.ok(names(sqlite).includes(table), `missing Spec B table: ${table}`)
  const operation = one(sqlite, 'SELECT * FROM business_operation_settings')
  assert.deepEqual({ timing: {
    scheduledPrepLeadMinutes: operation.scheduled_prep_lead_minutes,
    scheduledLateGraceMinutes: operation.scheduled_late_grace_minutes,
    immediateLateAfterMinutes: operation.immediate_late_after_minutes,
    immediateVeryLateAfterMinutes: operation.immediate_very_late_after_minutes,
  }, defaultModality: operation.default_modality,
  enabledModalities: rows(sqlite, 'SELECT code FROM business_order_modalities WHERE active = 1 ORDER BY rowid').map(({ code }) => code) }, DEFAULT_OPERATIONS)
  assert.equal(one(sqlite, 'SELECT default_method FROM business_payment_settings').default_method, DEFAULT_PAYMENT_METHODS.defaultMethod)
  assert.deepEqual(rows(sqlite, 'SELECT code, active, sort_order FROM business_payment_methods ORDER BY sort_order'),
    DEFAULT_PAYMENT_METHODS.methods.map(({ code, active, sortOrder }) => ({ code, active: Number(active), sort_order: sortOrder })))
  for (const { code } of DEFAULT_PAYMENT_METHODS.methods) {
    const payment = one(sqlite, 'SELECT * FROM business_payment_methods WHERE code = ?', code)
    assert.equal(payment.label, paymentLabel(code))
    assert.equal(payment.name_key, normalized(paymentLabel(code)))
    assert.equal(payment.is_system, 1)
    assert.equal(payment.first_used_at, null)
  }
  for (const [table, items] of [['business_cancel_reasons', nativeCancellationReasons().items], ['business_finance_categories', nativeFinanceCategories().items]]) {
    const actual = rows(sqlite, `SELECT * FROM ${table}`)
    assert.equal(actual.length, items.length)
    for (const item of items) {
      const seeded = actual.find(({ id }) => id === item.id)
      assert.ok(seeded)
      assert.equal(seeded.label, item.label)
      assert.equal(seeded.name_key, normalized(item.label))
      assert.equal(seeded.sort_order, item.sortOrder)
      assert.equal(seeded.active, 1)
      assert.equal(seeded.is_system, 1)
      assert.equal(seeded.first_used_at, null)
      if (item.type) assert.equal(seeded.type, item.type)
      if ('requiresNote' in item) assert.equal(seeded.requires_note, Number(item.requiresNote))
    }
  }
  for (const table of ['business_operation_settings', 'business_payment_settings', 'business_cancellation_settings',
    'business_finance_category_settings', 'business_print_settings', 'business_print_topology_settings']) {
    const seeded = one(sqlite, `SELECT * FROM ${table}`)
    assert.equal(seeded.revision, 1)
    assert.ok(seeded.created_at)
    assert.ok(seeded.updated_at)
  }
  assert.equal(one(sqlite, 'SELECT primary_station_id FROM business_print_topology_settings').primary_station_id, null)
  assert.deepEqual(one(sqlite, 'SELECT default_copies, table_tab_default_copies FROM business_print_settings'), { default_copies: 2, table_tab_default_copies: 1 })
  assert.deepEqual(rows(sqlite, 'PRAGMA foreign_key_check'), [])
})

test('upgrade seeds each business and retains overrides, earliest usage and every historical column', (t) => {
  const historical = {}
  let jobSchema
  const tables = ['orders', 'order_items', 'payments', 'movements', 'print_jobs', 'print_job_attempts', 'print_stations', 'table_tabs', 'business_print_settings']
  const { sqlite, close } = createSettingsDb({ beforeSpecB(db) {
    seedHistory(db)
    for (const table of tables) historical[table] = rows(db, `SELECT * FROM ${table} ORDER BY rowid`)
    jobSchema = rows(db, "SELECT * FROM sqlite_master WHERE tbl_name IN ('print_jobs', 'print_job_attempts') ORDER BY name")
  } })
  t.after(close)
  assert.ok(names(sqlite).includes('business_cancel_reasons'), 'missing seeded catalogs')
  for (const table of tables) {
    const columns = Object.keys(historical[table][0]).join(',')
    assert.deepEqual(rows(sqlite, `SELECT ${columns} FROM ${table} ${table === 'business_print_settings' ? "WHERE business_id = 'amor-e-sabor'" : ''} ORDER BY rowid`), historical[table], table)
  }
  const recoveryIndexNames = ['print_job_attempts_unresolved_status_idx', 'print_job_attempts_job_lookup_idx']
  const summaryIndexNames = ['print_jobs_terminal_expiry_idx', 'print_jobs_printed_time_idx', 'print_jobs_nonterminal_idx']
  const reviewedIndexNames = [...recoveryIndexNames,...summaryIndexNames]
  const schemaAfter = rows(sqlite, "SELECT * FROM sqlite_master WHERE tbl_name IN ('print_jobs', 'print_job_attempts') ORDER BY name")
  assert.deepEqual(normalizedSchema(schemaAfter.filter(({ name }) => name !== 'print_jobs' && !name.startsWith('tenant_') && !reviewedIndexNames.includes(name))),
    normalizedSchema(jobSchema.filter(({ name }) => name !== 'print_jobs')))
  const recoverySql = readFileSync(new URL('0042_print_recovery_candidate_indexes.sql', migrations), 'utf8')
  const summarySql = readFileSync(new URL('0044_print_summary_retention_indexes.sql', migrations), 'utf8')
  for (const name of reviewedIndexNames) {
    const reviewedSql=summaryIndexNames.includes(name)?summarySql:recoverySql
    const index = schemaAfter.find(row => row.name === name)
    assert.equal(index?.type, 'index')
    const expected = reviewedSql.match(new RegExp(`CREATE INDEX ${name}\\b[\\s\\S]*?;`))?.[0]
    assert.ok(expected)
    assert.equal(index.sql.trim().replace(/;$/, '').replace(/\s+/g, ' '), expected.trim().replace(/;$/, '').replace(/\s+/g, ' '))
  }
  assert.equal(schemaAfter.filter(row => row.name.startsWith('tenant_')).length, 6)
  assert.ok(schemaAfter.filter(row => row.name.startsWith('tenant_')).every(row => row.type === 'trigger'))
  assert.match(schemaAfter.find(({ name }) => name === 'print_jobs').sql,
    /type = 'table-tab'.*copies_requested IN \(1, 2\)/s)
  assert.ok(rows(sqlite, 'SELECT timing_policy_snapshot_json FROM orders').every((row) => row.timing_policy_snapshot_json === null))
  assert.ok(rows(sqlite, 'SELECT config_revision FROM print_stations').every((row) => row.config_revision === 1))
  for (const business of [BUSINESS, 'second', 'third']) {
    for (const table of ['business_operation_settings', 'business_payment_settings', 'business_cancellation_settings', 'business_finance_category_settings', 'business_print_topology_settings', 'business_print_settings']) {
      assert.equal(one(sqlite, `SELECT revision FROM ${table} WHERE business_id = ?`, business).revision, 1)
    }
    assert.equal(one(sqlite, 'SELECT count(*) AS n FROM business_cancel_reasons WHERE business_id = ?', business).n, 5)
    assert.equal(one(sqlite, 'SELECT count(*) AS n FROM business_finance_categories WHERE business_id = ?', business).n, 13)
  }
  assert.equal(one(sqlite, 'SELECT default_copies FROM business_print_settings WHERE business_id = ?', BUSINESS).default_copies, 1)
  assert.equal(one(sqlite, 'SELECT default_copies FROM business_print_settings WHERE business_id = ?', 'second').default_copies, 2)
  assert.equal(one(sqlite, 'SELECT primary_station_id FROM business_print_topology_settings WHERE business_id = ?', BUSINESS).primary_station_id, `${BUSINESS}-primary`)
  assert.equal(one(sqlite, 'SELECT primary_station_id FROM business_print_topology_settings WHERE business_id = ?', 'second').primary_station_id, 'second-primary')
  assert.equal(one(sqlite, "SELECT first_used_at FROM business_cancel_reasons WHERE business_id = ? AND id = 'other'", BUSINESS).first_used_at, EARLY)
  assert.equal(one(sqlite, "SELECT first_used_at FROM business_cancel_reasons WHERE business_id = 'second' AND id = 'other'").first_used_at, null)
  assert.equal(one(sqlite, "SELECT first_used_at FROM business_cancel_reasons WHERE business_id = 'second' AND id = 'entry_error'").first_used_at, LATE)
  for (const id of ['supplies', 'delivery_costs', 'other_income', 'other_expense']) {
    assert.equal(one(sqlite, 'SELECT first_used_at FROM business_finance_categories WHERE business_id = ? AND id = ?', BUSINESS, id).first_used_at, EARLY)
  }
  for (const code of ['pix', 'cash']) assert.equal(one(sqlite, 'SELECT first_used_at FROM business_payment_methods WHERE business_id = ? AND code = ?', BUSINESS, code).first_used_at, EARLY)
  assert.deepEqual(rows(sqlite, 'PRAGMA foreign_key_check'), [])
})

test('SQL rejects invalid limits, enums, copy counts, revisions and cross-business defaults', (t) => {
  const { sqlite, close } = createSettingsDb({ beforeSpecB: seedHistory })
  t.after(close)
  assert.ok(names(sqlite).includes('business_operation_settings'), 'missing typed constraints')
  const reject = (sql, ...values) => assert.throws(() => sqlite.prepare(sql).run(...values), /constraint|SETTINGS_/i)
  for (const [field, invalid] of [
    ['scheduled_prep_lead_minutes', [-1, 241, 0.5, 'oops', null]],
    ['scheduled_late_grace_minutes', [-1, 121, 1.5, null]],
    ['immediate_late_after_minutes', [0, 181, 1.5, null]],
    ['immediate_very_late_after_minutes', [0, 241, 30, 1.5, null]],
  ]) for (const value of invalid) reject(`UPDATE business_operation_settings SET ${field} = ?`, value)
  sqlite.exec('UPDATE business_operation_settings SET scheduled_prep_lead_minutes = 0, scheduled_late_grace_minutes = 0, immediate_late_after_minutes = 1, immediate_very_late_after_minutes = 2')
  sqlite.exec('UPDATE business_operation_settings SET scheduled_prep_lead_minutes = 240, scheduled_late_grace_minutes = 120, immediate_late_after_minutes = 180, immediate_very_late_after_minutes = 240')
  reject("UPDATE business_operation_settings SET default_modality = 'invalid'")
  reject("UPDATE business_order_modalities SET code = 'invalid'")
  reject("UPDATE business_order_modalities SET active = 0 WHERE code = 'Entrega'")
  reject("UPDATE business_payment_methods SET active = 0 WHERE code = 'pix'")
  reject("UPDATE business_payment_methods SET code = 'invalid'")
  reject("UPDATE business_payment_settings SET default_method = 'invalid'")
  reject("UPDATE business_order_modalities SET active = 2")
  reject("UPDATE business_print_settings SET table_tab_default_copies = 3")
  reject("UPDATE business_print_settings SET table_tab_default_copies = 1.5")
  reject("UPDATE business_operation_settings SET revision = 0")
  reject("UPDATE print_stations SET config_revision = 0")
  reject("UPDATE business_print_topology_settings SET primary_station_id = 'second-primary' WHERE business_id = 'amor-e-sabor'")
  reject("UPDATE business_finance_categories SET type = 'invalid'")
  reject("UPDATE business_finance_categories SET name_key = 'vendas' WHERE id = 'supplies'")
  reject("UPDATE business_cancel_reasons SET active = 0 WHERE id = 'other'")
  reject("UPDATE business_cancel_reasons SET requires_note = 0 WHERE id = 'other'")
  // Deferred constraints allow a valid aggregate replacement, including temporarily disabling the old default.
  sqlite.exec("BEGIN; UPDATE business_order_modalities SET active = 0 WHERE code = 'Entrega'; UPDATE business_operation_settings SET default_modality = 'Local'; COMMIT")
  sqlite.exec("BEGIN; UPDATE business_payment_methods SET active = 0 WHERE code = 'pix'; UPDATE business_payment_settings SET default_method = 'cash'; COMMIT")
  assert.deepEqual(rows(sqlite, 'PRAGMA foreign_key_check'), [])
})

test('catalog usage remains permanent after historical references change or are removed', (t) => {
  const { sqlite, close } = createSettingsDb({ beforeSpecB: seedHistory })
  t.after(close)
  assert.ok(names(sqlite).includes('business_finance_categories'), 'missing usage protection')
  sqlite.exec("UPDATE movements SET category = 'gas', payment_method = 'cash'; UPDATE orders SET cancel_reason = 'entry_error'")
  for (const [table, key, value] of [['business_finance_categories', 'id', 'supplies'], ['business_cancel_reasons', 'id', 'other'], ['business_payment_methods', 'code', 'pix']]) {
    assert.equal(one(sqlite, `SELECT first_used_at FROM ${table} WHERE business_id = ? AND ${key} = ?`, BUSINESS, value).first_used_at, EARLY)
    assert.throws(() => sqlite.prepare(`UPDATE ${table} SET first_used_at = NULL WHERE business_id = ? AND ${key} = ?`).run(BUSINESS, value), /SETTINGS_USAGE_PERMANENT/)
    assert.throws(() => sqlite.prepare(`DELETE FROM ${table} WHERE business_id = ? AND ${key} = ?`).run(BUSINESS, value), /SETTINGS_/)
  }
})

test('catalog identities cannot be moved, renamed after use, or demoted from native to deletable', (t) => {
  const { sqlite, close } = createSettingsDb({ beforeSpecB: seedHistory })
  t.after(close)
  for (const table of ['business_cancel_reasons', 'business_finance_categories']) {
    const id = table === 'business_cancel_reasons' ? 'entry_error' : 'gas'
    for (const change of ["id = 'custom'", "label = 'Renamed'", 'is_system = 0', "business_id = 'third'"]) {
      assert.throws(() => sqlite.exec(`UPDATE ${table} SET ${change} WHERE business_id = 'amor-e-sabor' AND id = '${id}'`), /constraint|SETTINGS_|TENANT_OWNERSHIP_IMMUTABLE/i)
    }
    insert(sqlite, table, { business_id: BUSINESS, id: 'custom', label: 'Custom', name_key: 'custom', active: 1,
      is_system: 0, sort_order: 20, ...(table === 'business_finance_categories' ? { type: 'saida' } : {}) })
    sqlite.exec(`UPDATE ${table} SET label = 'Unused rename', name_key = 'unused rename' WHERE id = 'custom'`)
    sqlite.prepare(`UPDATE ${table} SET first_used_at = ? WHERE id = 'custom'`).run(EARLY)
    assert.throws(() => sqlite.exec(`UPDATE ${table} SET label = 'Used rename' WHERE id = 'custom'`), /SETTINGS_/)
    assert.throws(() => sqlite.exec(`UPDATE ${table} SET id = 'replacement' WHERE id = 'custom'`), /SETTINGS_/)
    assert.throws(() => sqlite.exec(`DELETE FROM ${table} WHERE id = 'custom'`), /SETTINGS_/)
  }
  assert.throws(() => sqlite.exec("UPDATE business_finance_categories SET type = 'entrada' WHERE id = 'custom'"), /SETTINGS_/)
  assert.throws(() => sqlite.exec("UPDATE business_payment_methods SET label = 'Renamed' WHERE code = 'cash'"), /SETTINGS_/)
  // Removing an entire business remains a valid cascade, despite native catalog guards.
  sqlite.exec("DELETE FROM businesses WHERE id = 'third'")
  assert.equal(one(sqlite, "SELECT count(*) AS n FROM business_payment_methods WHERE business_id = 'third'").n, 0)
  assert.deepEqual(rows(sqlite, 'PRAGMA foreign_key_check'), [])
})

test('settings test helper provides real bound D1 reads and atomic batches with RETURNING', async (t) => {
  const { db, sqlite, close } = createSettingsDb()
  t.after(close)
  assert.ok(db, 'missing D1 adapter')
  const query = db.prepare('SELECT default_modality FROM business_operation_settings WHERE business_id = ?').bind(BUSINESS)
  assert.deepEqual(await query.first(), { default_modality: 'Entrega' })
  assert.equal(await query.first('default_modality'), 'Entrega')
  const result = await db.batch([
    db.prepare('UPDATE business_operation_settings SET revision = revision + 1 WHERE business_id = ? RETURNING revision').bind(BUSINESS),
    db.prepare("INSERT INTO settings_tx_assertions (tx_id, check_key, valid) VALUES ('batch-ok', 'revision', 1)"),
  ])
  assert.deepEqual(result[0].results, [{ revision: 2 }])
  assert.equal(result[0].meta.changes, 1)
  assert.equal((await db.prepare('SELECT revision FROM business_operation_settings').all()).results[0].revision, 2)
  await assert.rejects(db.batch([
    db.prepare('UPDATE business_operation_settings SET revision = 3'),
    db.prepare("INSERT INTO settings_tx_assertions (tx_id, check_key, valid) VALUES ('batch-fail', 'revision', 0)"),
  ]), /SETTINGS_REVISION_CONFLICT/)
  assert.equal(one(sqlite, 'SELECT revision FROM business_operation_settings').revision, 2)
  await assert.rejects(db.batch([db.prepare("UPDATE business_order_modalities SET active = 0 WHERE code = 'Entrega'")]), /FOREIGN KEY constraint/)
  assert.equal(one(sqlite, "SELECT active FROM business_order_modalities WHERE code = 'Entrega'").active, 1)
  assert.equal((await db.prepare('UPDATE business_operation_settings SET revision = 4').run()).meta.changes, 1)
})

test('mutation receipts isolate business/resource identities and SQL assertions abort an entire batch', (t) => {
  const { sqlite, close } = createSettingsDb({ beforeSpecB: seedHistory })
  t.after(close)
  assert.ok(names(sqlite).includes('settings_mutation_receipts'), 'missing receipts')
  const receipt = { business_id: BUSINESS, resource_key: 'operations', mutation_id: 'mutation', payload_hash: 'hash', committed_revision: 2, committed_at: LATE }
  insert(sqlite, 'settings_mutation_receipts', receipt)
  insert(sqlite, 'settings_mutation_receipts', { ...receipt, business_id: 'second' })
  insert(sqlite, 'settings_mutation_receipts', { ...receipt, resource_key: 'paymentMethods' })
  assert.throws(() => insert(sqlite, 'settings_mutation_receipts', receipt), /UNIQUE constraint/)
  assert.throws(() => insert(sqlite, 'settings_mutation_receipts', { ...receipt, business_id: 'missing' }), /FOREIGN KEY constraint/)
  sqlite.exec('BEGIN')
  try {
    sqlite.exec('UPDATE business_operation_settings SET revision = 2')
    assert.throws(() => sqlite.exec("INSERT INTO settings_tx_assertions (tx_id, check_key, valid) VALUES ('tx', 'revision', 0)"), /SETTINGS_REVISION_CONFLICT/)
  } finally { sqlite.exec('ROLLBACK') }
  assert.equal(one(sqlite, 'SELECT revision FROM business_operation_settings').revision, 1)
  assert.equal(one(sqlite, 'SELECT count(*) AS n FROM settings_tx_assertions').n, 0)
  sqlite.exec("INSERT INTO settings_tx_assertions (tx_id, check_key, valid) VALUES ('ok', 'revision', 1)")
  assert.throws(() => sqlite.exec("UPDATE settings_tx_assertions SET valid = 0"), /SETTINGS_TX_ASSERTION_FAILED/)
  assert.deepEqual(rows(sqlite, 'PRAGMA foreign_key_check'), [])
})

test('a late migration failure rolls back all new tables, columns, seeds and historical changes', () => {
  // Keep ownership here so the rolled-back connection can be inspected after the error.
  const sqlite = new DatabaseSync(':memory:')
  try {
    for (const file of readdirSync(migrations).filter((name) => name.endsWith('.sql') && Number(name.slice(0, 4)) < 24).sort()) {
      sqlite.exec(readFileSync(new URL(file, migrations), 'utf8'))
    }
    seedHistory(sqlite)
    const before = rows(sqlite, 'SELECT * FROM orders ORDER BY id')
    const migrationFiles = readdirSync(migrations).filter((name) => Number(name.slice(0, 4)) === 24)
    assert.equal(migrationFiles.length, 1, 'missing migration to exercise rollback')
    sqlite.exec('BEGIN')
    try {
      sqlite.exec(readFileSync(new URL(migrationFiles[0], migrations), 'utf8'))
      // Failure after every schema and seed statement, in the migration transaction.
      sqlite.exec("INSERT INTO settings_tx_assertions (tx_id, check_key, valid) VALUES ('migration', 'injected-failure', 0)")
      assert.fail('invalid assertion must abort')
    } catch (error) {
      assert.match(error.message, /SETTINGS_INVALID/)
      sqlite.exec('ROLLBACK')
    }
    for (const table of settingsTables) assert.equal(names(sqlite).includes(table), false, table)
    assert.deepEqual(rows(sqlite, 'SELECT * FROM orders ORDER BY id'), before)
    assert.equal(rows(sqlite, 'PRAGMA table_info(business_print_settings)').some(({ name }) => name === 'revision'), false)
    assert.equal(rows(sqlite, 'PRAGMA table_info(print_stations)').some(({ name }) => name === 'config_revision'), false)
    assert.deepEqual(rows(sqlite, 'PRAGMA foreign_key_check'), [])
  } finally { sqlite.close() }
})
