import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import { assertPreservedPrintContext } from './print-context-snapshot.mjs'

const directory = new URL('../../migrations/', import.meta.url)
const files = readdirSync(directory).filter(name => name.endsWith('.sql')).sort()
const recoveryIndexSql = readFileSync(new URL('0042_print_recovery_candidate_indexes.sql', directory), 'utf8')
const guardSql = readFileSync(new URL('0039_tenant_reference_guards.sql', directory), 'utf8')
function fixture(t) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close())
  const snapshot = () => [
    ...['print_jobs', 'print_job_attempts', 'print_stations', 'business_print_topology_settings'].map(table => db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()),
    db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE type IN ('index','trigger') AND tbl_name IN ('print_jobs','print_job_attempts','print_stations') AND sql IS NOT NULL ORDER BY type,name").all(),
  ]
  for (const name of files.filter(name => Number(name.slice(0, 4)) <= 24)) db.exec(readFileSync(new URL(name, directory), 'utf8'))
  db.exec("INSERT INTO orders(id,business_id,client_name_snapshot,type,order_date,status,subtotal_cents,total_cents,created_at) VALUES('old-order','amor-e-sabor','Synthetic customer','Entrega','2026-01-01','Finalizado',100,100,'2026-01-01'); INSERT INTO print_jobs(id,business_id,order_id,type,trigger,status,copies_requested,snapshot_json,created_at,available_at) VALUES('old-job','amor-e-sabor','old-order','order','manual','pending',1,'{\"unchanged\":true}','2026-01-01','2026-01-01')")
  const before = snapshot()
  for (const name of files.filter(name => Number(name.slice(0, 4)) > 24)) db.exec(readFileSync(new URL(name, directory), 'utf8'))
  return { before, after: snapshot() }
}
test('the real full migration sequence preserves printing data and prior schema while adding exactly the reviewed tenant guards', t => {
  const { before, after } = fixture(t)
  assert.equal(after[4].length - before[4].length, 11)
  assert.doesNotThrow(() => assertPreservedPrintContext(before, after, guardSql, recoveryIndexSql))
})
test('the D1 gate still rejects changed history, changed old schema and missing, weakened or unexpected guards', t => {
  const { before, after } = fixture(t)
  for (const mutate of [
    value => { value[0][0].snapshot_json = '{}' },
    value => { value[4].find(row => !row.name.startsWith('tenant_')).sql += ' changed' },
    value => { value[4] = value[4].filter(row => row.name !== 'tenant_print_jobs_reference_insert') },
    value => { value[4].find(row => row.name === 'tenant_print_jobs_reference_insert').sql = 'CREATE TRIGGER unsafe' },
    value => { value[4] = value[4].filter(row => row.name !== 'print_job_attempts_job_lookup_idx') },
    value => { value[4].find(row => row.name === 'print_job_attempts_unresolved_status_idx').sql = 'CREATE INDEX unsafe' },
    value => { value[4].push({ type: 'trigger', name: 'unexpected', tbl_name: 'print_jobs', sql: 'unsafe' }) },
  ]) { const altered = structuredClone(after); mutate(altered); assert.throws(() => assertPreservedPrintContext(before, altered, guardSql, recoveryIndexSql)) }
})
