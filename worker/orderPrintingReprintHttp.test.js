import { d1Adapter } from './test-support/settingsDb.js'
import { installAuditSchema } from './test-support/auditSchema.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { hashPin } from './auth.js'
import { handleRequest } from './index.js'

class D1Sqlite {
  constructor() {
    this.sqlite = new DatabaseSync(':memory:')
    this.sqlite.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE auth_credentials (business_id TEXT PRIMARY KEY, pin_hash TEXT NOT NULL);
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY, business_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL, expires_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, revoked_at TEXT, user_id TEXT, device_mode TEXT
      );
      CREATE TABLE business_auth_state (business_id TEXT PRIMARY KEY, mode TEXT);
      INSERT INTO business_auth_state VALUES ('amor-e-sabor','legacy');
      CREATE TABLE businesses (id TEXT PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE business_print_settings (
        business_id TEXT PRIMARY KEY, default_copies INTEGER NOT NULL DEFAULT 2,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE orders (
        id TEXT PRIMARY KEY, business_id TEXT NOT NULL, order_number INTEGER, client_id TEXT, client_name_snapshot TEXT NOT NULL,
        client_phone_snapshot TEXT NOT NULL DEFAULT '', client_address_snapshot TEXT NOT NULL DEFAULT '',
        customer_identity_type TEXT NOT NULL DEFAULT 'registered_client', table_tab_id TEXT,
        type TEXT NOT NULL, order_date TEXT NOT NULL, scheduled_for TEXT, status TEXT NOT NULL DEFAULT 'Em preparo',
        subtotal_cents INTEGER NOT NULL, delivery_fee_cents INTEGER NOT NULL DEFAULT 0,
        adjustment_type TEXT NOT NULL DEFAULT 'none', adjustment_amount_cents INTEGER NOT NULL DEFAULT 0,
        adjustment_reason TEXT NOT NULL DEFAULT '', total_cents INTEGER NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE order_items (
        id TEXT PRIMARY KEY, business_id TEXT NOT NULL, order_id TEXT NOT NULL, name_snapshot TEXT NOT NULL,
        size_snapshot TEXT NOT NULL DEFAULT '', quantity INTEGER NOT NULL, unit_price_cents INTEGER NOT NULL,
        note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
      );
      CREATE TABLE payments (
        id TEXT PRIMARY KEY, business_id TEXT NOT NULL, order_id TEXT NOT NULL, method TEXT NOT NULL, paid_at TEXT NOT NULL,
        amount_cents INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE order_settlement_entries (
        id TEXT PRIMARY KEY, business_id TEXT, order_id TEXT, kind TEXT,
        amount_cents INTEGER, receipt_id TEXT, movement_id TEXT
      );
      CREATE TABLE movements (
        id TEXT PRIMARY KEY, business_id TEXT, order_id TEXT, source TEXT, type TEXT,
        value_cents INTEGER, deleted_at TEXT
      );
      CREATE TABLE table_tabs (id TEXT PRIMARY KEY, business_id TEXT NOT NULL, table_identifier TEXT NOT NULL);
      CREATE TABLE tables (
        id TEXT PRIMARY KEY, business_id TEXT NOT NULL, name TEXT NOT NULL
      );
      CREATE TABLE table_reservations (
        id TEXT PRIMARY KEY, business_id TEXT NOT NULL, order_id TEXT NOT NULL,
        table_id TEXT NOT NULL, table_name_snapshot TEXT NOT NULL, status TEXT NOT NULL
      );
      CREATE TABLE print_stations (
        id TEXT PRIMARY KEY, business_id TEXT NOT NULL, name TEXT NOT NULL, platform TEXT NOT NULL,
        is_primary INTEGER NOT NULL DEFAULT 0, auto_print_enabled INTEGER NOT NULL DEFAULT 0,
        default_copies INTEGER NOT NULL DEFAULT 2, last_seen_at TEXT, recovery_job_id TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX print_stations_one_primary_idx ON print_stations (business_id) WHERE is_primary = 1;
      CREATE TABLE print_jobs (
        id TEXT PRIMARY KEY, business_id TEXT NOT NULL, order_id TEXT, type TEXT NOT NULL, trigger TEXT NOT NULL,
        status TEXT NOT NULL, priority INTEGER NOT NULL DEFAULT 0, parent_job_id TEXT,
        copies_requested INTEGER NOT NULL, copies_printed INTEGER NOT NULL DEFAULT 0,
        station_id TEXT, snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL, available_at TEXT,
        processing_started_at TEXT, processed_at TEXT, discarded_at TEXT, attention_reason TEXT,
        action_actor_label TEXT, action_at TEXT, second_copy_requested_at TEXT, second_copy_skipped_at TEXT, last_error_code TEXT, last_error_message TEXT
      );
      CREATE UNIQUE INDEX print_jobs_one_auto_order_idx ON print_jobs (business_id, order_id)
        WHERE type = 'order' AND trigger = 'automatic';
      CREATE TABLE print_job_attempts (
        id TEXT PRIMARY KEY, business_id TEXT NOT NULL, job_id TEXT NOT NULL,
        copy_number INTEGER NOT NULL, attempt_number INTEGER NOT NULL, station_id TEXT,
        spool_job_name TEXT NOT NULL UNIQUE, spool_job_id INTEGER, status TEXT NOT NULL,
        submission_started_at TEXT, submitted_at TEXT, last_event_at TEXT, completed_at TEXT,
        resolution TEXT, resolution_actor_label TEXT, resolved_at TEXT,
        last_error_code TEXT, last_error_message TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE (job_id, copy_number, attempt_number)
      );
    `)
    installAuditSchema(this.sqlite)
    Object.assign(this,d1Adapter(this.sqlite))
    this.exec = sql => this.sqlite.exec(sql)
  }


}

const makeEnv = async () => {
  const DB = new D1Sqlite()
  const pinHash = await hashPin('4827', new Uint8Array(16).fill(7))
  DB.sqlite.prepare('INSERT INTO auth_credentials (business_id, pin_hash) VALUES (?, ?)').run('amor-e-sabor', pinHash)
  DB.sqlite.exec(`
    INSERT INTO businesses (id, name) VALUES ('amor-e-sabor', 'Amor & Sabor');
    INSERT INTO orders (
      id, business_id, order_number, client_name_snapshot, client_phone_snapshot, client_address_snapshot, type,
      order_date, subtotal_cents, delivery_fee_cents, adjustment_type, adjustment_amount_cents,
      adjustment_reason, total_cents, created_at
    ) VALUES ('o1', 'amor-e-sabor', 1, 'Maria', '(11) 99876-5432', 'Rua A, 10', 'Entrega',
      '2026-09-08', 5000, 800, 'none', 0, '', 5800, '2026-09-08T19:00:00.000Z');
    INSERT INTO order_items (
      id, business_id, order_id, name_snapshot, size_snapshot, quantity, unit_price_cents, note, created_at
    ) VALUES ('i1', 'amor-e-sabor', 'o1', 'X-BURGER', 'G', 1, 5000, 'sem cebola', '2026-09-08T19:00:00.000Z');
  `)
  return { DB, LOGIN_RATE_LIMITER: { limit: async () => ({ success: true }) }, ASSETS: { fetch: async () => new Response('asset') } }
}

const loginCookie = async (env) => {
  const response = await handleRequest(new Request('https://delivery.example/api/auth/login', {
    method: 'POST',
    headers: { origin: 'https://delivery.example', 'content-type': 'application/json' },
    body: JSON.stringify({ pin: '4827' }),
  }), env)
  assert.equal(response.status, 200)
  return response.headers.get('set-cookie').split(';')[0]
}

const requestJson = (env, cookie, path, method, body) => handleRequest(new Request(`https://delivery.example${path}`, {
  method,
  headers: { cookie, origin: 'https://delivery.example', 'content-type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
}), env)

test('reprint API creates a linked pending manual job from the current official order without requiring a station on the requesting device', async () => {
  const env = await makeEnv()
  const cookie = await loginCookie(env)

  const created = await requestJson(env, cookie, '/api/orders/o1/print-jobs', 'POST', { copies: 1 })
  assert.equal(created.status, 201)
  const original = (await created.json()).job
  env.DB.sqlite.prepare("UPDATE print_jobs SET status = 'printed', copies_printed = 1, processed_at = ? WHERE id = ?")
    // A printed job should remain within the queue's 30-day retention window.
    .run(new Date().toISOString(), original.id)
  const countBefore = env.DB.sqlite.prepare('SELECT count(*) AS count FROM print_jobs').get().count

  env.DB.sqlite.prepare(`UPDATE orders SET client_name_snapshot = ?, client_address_snapshot = ?
    WHERE id = ? AND business_id = ?`).run('Maria Atualizada', 'Rua Nova, 20', 'o1', 'amor-e-sabor')

  const response = await requestJson(env, cookie, `/api/printing/jobs/${original.id}/reprint`, 'POST', { copies: 2 })
  assert.equal(response.status, 201)
  const reprint = (await response.json()).job
  assert.notEqual(reprint.id, original.id)
  assert.equal(reprint.parentJobId, original.id)
  assert.equal(reprint.trigger, 'manual')
  assert.equal(reprint.status, 'pending')
  assert.equal(reprint.copiesRequested, 2)
  assert.equal(reprint.stationId, null)
  assert.equal(original.document.customer.name, 'Maria')
  assert.equal(reprint.document.customer.name, 'Maria Atualizada')
  assert.equal(reprint.document.customer.address, 'Rua Nova, 20')
  assert.notDeepEqual(reprint.document, original.document)
  assert.equal(env.DB.sqlite.prepare('SELECT count(*) AS count FROM print_jobs').get().count, countBefore + 1)

  const jobsResponse = await requestJson(env, cookie, '/api/printing/jobs?orderId=o1&limit=20', 'GET')
  const jobs = (await jobsResponse.json()).jobs
  const preservedOriginal = jobs.find((job) => job.id === original.id)
  assert.equal(preservedOriginal.status, 'printed')
  assert.equal(preservedOriginal.parentJobId, null)
  assert.equal(preservedOriginal.document.customer.name, 'Maria')
})

test('reprint API validates copies as one or two', async () => {
  const env = await makeEnv()
  const cookie = await loginCookie(env)
  env.DB.sqlite.prepare(`INSERT INTO print_jobs (
    id, business_id, order_id, type, trigger, status, copies_requested, copies_printed,
    station_id, snapshot_json, created_at, available_at, processed_at
  ) VALUES (?, ?, ?, 'order', 'manual', 'printed', 1, 1, NULL, ?, ?, ?, ?)`)
    .run('printed-job', 'amor-e-sabor', 'o1', JSON.stringify({ version: 1, type: 'order', order: { id: 'o1' } }),
      '2026-09-08T19:00:00.000Z', '2026-09-08T19:00:00.000Z', '2026-09-08T19:00:00.000Z')

  const response = await requestJson(env, cookie, '/api/printing/jobs/printed-job/reprint', 'POST', { copies: 3 })
  assert.equal(response.status, 400)
  assert.equal((await response.json()).error.code, 'INVALID_PRINT_COPIES')
})
