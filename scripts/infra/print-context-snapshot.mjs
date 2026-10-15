import assert from 'node:assert/strict'

const normalizeSql = sql => sql.trim().replace(/;$/, '').replace(/\s+/g, ' ')
const guardTables = ['print_jobs', 'print_job_attempts', 'print_stations']
const suffixes = ['ownership_immutable', 'reference_insert', 'reference_update']

export function assertPreservedPrintContext(before, after, migrationSql, recoveryIndexSql, summaryIndexSql) {
  assert.equal(before.length, 5); assert.equal(after.length, 5)
  assert.deepEqual(after.slice(0, 4), before.slice(0, 4), 'D1 print history changed')
  const expected = new Map()
  for (const table of guardTables) for (const suffix of suffixes) {
    const name = `tenant_${table}_${suffix}`
    const sql = migrationSql.match(new RegExp(`CREATE TRIGGER ${name}\\b[\\s\\S]*?END;`))?.[0]
    assert.ok(sql, `Reviewed migration is missing ${name}`)
    expected.set(name, { type: 'trigger', name, tbl_name: table, sql: normalizeSql(sql) })
  }
  for (const name of ['print_job_attempts_unresolved_status_idx', 'print_job_attempts_job_lookup_idx']) {
    const sql = recoveryIndexSql.match(new RegExp(`CREATE INDEX ${name}\\b[\\s\\S]*?;`))?.[0]
    assert.ok(sql, `Reviewed migration is missing ${name}`)
    expected.set(name, { type: 'index', name, tbl_name: 'print_job_attempts', sql: normalizeSql(sql) })
  }
  for (const name of ['print_jobs_terminal_expiry_idx', 'print_jobs_printed_time_idx', 'print_jobs_nonterminal_idx']) {
    const sql = summaryIndexSql.match(new RegExp(`CREATE INDEX ${name}\\b[\\s\\S]*?;`))?.[0]
    assert.ok(sql, `Reviewed migration is missing ${name}`)
    expected.set(name, { type: 'index', name, tbl_name: 'print_jobs', sql: normalizeSql(sql) })
  }
  // Compare all historical indexes/triggers byte-for-byte. Only the fourteen named
  // additions are separated, and each must match the reviewed migration SQL.
  assert.deepEqual(after[4].filter(row => !expected.has(row.name)), before[4], 'D1 prior print schema changed')
  const additions = after[4].filter(row => expected.has(row.name)).map(row => ({ ...row, sql: normalizeSql(row.sql) })).sort((a, b) => a.name.localeCompare(b.name))
  assert.deepEqual(additions, [...expected.values()].sort((a, b) => a.name.localeCompare(b.name)), 'D1 tenant print guards differ from the reviewed migration')
}
