import { installAuditSchema } from '../test-support/auditSchema.js'
import { DatabaseSync } from 'node:sqlite'
import { hashPin } from '../auth.js'
export class D1Sqlite {
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
      INSERT INTO business_auth_state VALUES ('amor-e-sabor','legacy'),('other-business','legacy');
      CREATE TABLE businesses (id TEXT PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE business_print_settings (
        business_id TEXT PRIMARY KEY REFERENCES businesses(id),
        default_copies INTEGER NOT NULL DEFAULT 2 CHECK (default_copies IN (1, 2)),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        table_tab_default_copies INTEGER NOT NULL DEFAULT 1 CHECK (table_tab_default_copies IN (1, 2)),
        revision INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE orders (
        id TEXT PRIMARY KEY, business_id TEXT NOT NULL, order_number INTEGER, client_id TEXT, client_name_snapshot TEXT NOT NULL,
        client_phone_snapshot TEXT NOT NULL DEFAULT '', client_address_snapshot TEXT NOT NULL DEFAULT '',
        customer_identity_type TEXT NOT NULL DEFAULT 'registered_client', table_tab_id TEXT,
        type TEXT NOT NULL, order_date TEXT NOT NULL, scheduled_for TEXT, status TEXT NOT NULL DEFAULT 'Em preparo', subtotal_cents INTEGER NOT NULL,
        delivery_fee_cents INTEGER NOT NULL DEFAULT 0, adjustment_type TEXT NOT NULL DEFAULT 'none',
        adjustment_amount_cents INTEGER NOT NULL DEFAULT 0, adjustment_reason TEXT NOT NULL DEFAULT '',
        total_cents INTEGER NOT NULL, created_at TEXT NOT NULL
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
      CREATE TABLE table_tabs (
        id TEXT PRIMARY KEY, business_id TEXT NOT NULL, table_identifier TEXT NOT NULL, tab_number INTEGER
      );
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
        default_copies INTEGER NOT NULL DEFAULT 2, last_seen_at TEXT,
        qz_ready INTEGER NOT NULL DEFAULT 0, printer_ready INTEGER NOT NULL DEFAULT 0, last_ready_at TEXT,
        physical_state TEXT NOT NULL DEFAULT 'verifying', physical_status_text TEXT, physical_status_code TEXT,
        physical_status_at TEXT, last_offline_at TEXT, recovery_state TEXT NOT NULL DEFAULT 'normal', recovery_pending_at TEXT,
        recovery_job_id TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, config_revision INTEGER NOT NULL DEFAULT 1
      );
      CREATE UNIQUE INDEX print_stations_one_primary_idx ON print_stations (business_id) WHERE is_primary = 1;
      CREATE UNIQUE INDEX print_stations_business_id_id_idx ON print_stations (business_id, id);
      CREATE TABLE business_print_topology_settings (
        business_id TEXT PRIMARY KEY REFERENCES businesses(id), primary_station_id TEXT,
        revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        FOREIGN KEY (business_id, primary_station_id) REFERENCES print_stations(business_id, id) DEFERRABLE INITIALLY DEFERRED
      );
      CREATE TABLE settings_mutation_receipts (
        business_id TEXT NOT NULL REFERENCES businesses(id), resource_key TEXT NOT NULL, mutation_id TEXT NOT NULL,
        payload_hash TEXT NOT NULL, committed_revision INTEGER NOT NULL, committed_at TEXT NOT NULL,
        resource_created_at TEXT, resource_updated_at TEXT, PRIMARY KEY (business_id, resource_key, mutation_id)
      );
      CREATE TABLE settings_tx_assertions (
        tx_id TEXT NOT NULL, check_key TEXT NOT NULL, valid INTEGER NOT NULL CHECK (valid = 1), PRIMARY KEY (tx_id, check_key)
      );
      CREATE TRIGGER settings_tx_assertions_insert_guard BEFORE INSERT ON settings_tx_assertions
      WHEN NEW.valid IS NOT 1 BEGIN SELECT CASE NEW.check_key
        WHEN 'revision' THEN RAISE(ABORT, 'SETTINGS_REVISION_CONFLICT')
        WHEN 'policy' THEN RAISE(ABORT, 'POLICY_CHANGED')
        ELSE RAISE(ABORT, 'SETTINGS_INVALID') END; END;
      CREATE TRIGGER settings_tx_assertions_update_guard BEFORE UPDATE ON settings_tx_assertions
      WHEN NEW.valid IS NOT 1 BEGIN SELECT RAISE(ABORT, 'SETTINGS_TX_ASSERTION_FAILED'); END;
      CREATE TABLE print_jobs (
        id TEXT PRIMARY KEY, business_id TEXT NOT NULL, order_id TEXT, table_tab_id TEXT, type TEXT NOT NULL, trigger TEXT NOT NULL,
        status TEXT NOT NULL, priority INTEGER NOT NULL DEFAULT 0, parent_job_id TEXT,
        copies_requested INTEGER NOT NULL, copies_printed INTEGER NOT NULL DEFAULT 0,
        station_id TEXT, snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL, available_at TEXT, processing_started_at TEXT,
        processed_at TEXT, discarded_at TEXT, attention_reason TEXT, action_actor_label TEXT, action_at TEXT,
        second_copy_prompted_at TEXT, second_copy_requested_at TEXT, second_copy_skipped_at TEXT,
        last_error_code TEXT, last_error_message TEXT
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
  }
  prepare(sql) {
    const database = this.sqlite
    return { bind(...values) { return {
      async first() { return database.prepare(sql).get(...values) ?? null },
      async all() { return { results: database.prepare(sql).all(...values) } },
      run() { const results = database.prepare(sql).all(...values)
        return { success: true, results, meta: { changes: /^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql) ? Number(database.prepare('SELECT changes() AS n').get().n) : 0 } } },
    } } }
  }
  async batch(statements) {
    this.sqlite.exec('BEGIN')
    try {
      const results = []
      for (const statement of statements) results.push(statement.run())
      this.sqlite.exec('COMMIT')
      return results
    } catch (error) {
      this.sqlite.exec('ROLLBACK')
      throw error
    }
  }
  exec(sql) { this.sqlite.exec(sql) }
}

export const makeEnv = async () => {
  const DB = new D1Sqlite()
  const pinHash = await hashPin('4827', new Uint8Array(16).fill(7))
  DB.sqlite.prepare('INSERT INTO auth_credentials (business_id, pin_hash) VALUES (?, ?)').run('amor-e-sabor', pinHash)
  DB.exec(`
    INSERT INTO businesses (id, name) VALUES ('amor-e-sabor', 'Amor & Sabor'), ('other-business', 'Outro');
    INSERT INTO business_print_topology_settings (business_id, primary_station_id, created_at, updated_at) VALUES
      ('amor-e-sabor', NULL, '2026-09-12T00:00:00.000Z', '2026-09-12T00:00:00.000Z'),
      ('other-business', NULL, '2026-09-12T00:00:00.000Z', '2026-09-12T00:00:00.000Z');
    INSERT INTO orders (
      id, business_id, order_number, client_name_snapshot, client_phone_snapshot, client_address_snapshot, type,
      order_date, subtotal_cents, delivery_fee_cents, adjustment_type, adjustment_amount_cents,
      adjustment_reason, total_cents, created_at
    ) VALUES ('o1', 'amor-e-sabor', 1, 'Maria', '(11) 99876-5432', 'Rua A, 10', 'Entrega',
      '2026-09-03', 5000, 800, 'none', 0, '', 5800, '2026-09-03T23:00:00.000Z');
    INSERT INTO order_items (
      id, business_id, order_id, name_snapshot, size_snapshot, quantity, unit_price_cents, note, created_at
    ) VALUES ('i1', 'amor-e-sabor', 'o1', 'X-BURGER', 'G', 1, 5000, 'sem cebola', '2026-09-03T23:00:00.000Z');
  `)
  return {
    DB,
    LOGIN_RATE_LIMITER: { limit: async () => ({ success: true }) },
    ASSETS: { fetch: async () => new Response('asset') },
  }
}
