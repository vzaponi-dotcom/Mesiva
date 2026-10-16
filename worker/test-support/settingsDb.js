import { DatabaseSync } from 'node:sqlite'
import { readdirSync, readFileSync } from 'node:fs'

const migrations = new URL('../../migrations/', import.meta.url)
const SPEC_B_MIGRATION = 24

// A local SQLite-backed subset of D1, for repository tests. Batches execute real
// SQL serially in one transaction, including rollback on deferred FK failures.
export function d1Adapter(sqlite) {
  const prepare = (sql, values = []) => {
    const execute = () => {
      const before = sqlite.prepare('SELECT total_changes() AS n').get().n
      const results = sqlite.prepare(sql).all(...values).map((row) => ({ ...row }))
      const changes = sqlite.prepare('SELECT total_changes() AS n').get().n - before
      return { success: true, results, meta: { changes } }
    }
    return {
      bind: (...bound) => prepare(sql, bound),
      async first(column) {
        const row = sqlite.prepare(sql).get(...values)
        return row ? (column === undefined ? { ...row } : row[column]) : null
      },
      async all() { return execute() },
      async run() { return execute() },
      execute,
    }
  }
  return {
    prepare,
    async batch(statements) {
      sqlite.exec('BEGIN')
      try {
        const results = statements.map((statement) => statement.execute())
        sqlite.exec('COMMIT')
        return results
      } catch (error) {
        sqlite.exec('ROLLBACK')
        throw error
      }
    },
  }
}

export function createSettingsDb({ beforeSpecB, beforeMigration } = {}) {
  const sqlite = new DatabaseSync(':memory:')
  try {
    const files = readdirSync(migrations).filter((name) => name.endsWith('.sql')).sort()
    // Legacy migrations control their own PRAGMAs for table rebuilds. Apply them
    // verbatim; fixtures are inserted only after the complete pre-B schema.
    for (const file of files.filter((name) => Number(name.slice(0, 4)) < SPEC_B_MIGRATION)) {
      beforeMigration?.(file,sqlite)
      sqlite.exec(readFileSync(new URL(file, migrations), 'utf8'))
    }
    sqlite.exec('PRAGMA foreign_keys = ON')
    beforeSpecB?.(sqlite)
    for (const file of files.filter((name) => Number(name.slice(0, 4)) >= SPEC_B_MIGRATION)) {
      beforeMigration?.(file,sqlite)
      sqlite.exec('BEGIN')
      try {
        sqlite.exec(readFileSync(new URL(file, migrations), 'utf8'))
        sqlite.exec('COMMIT')
      } catch (error) {
        sqlite.exec('ROLLBACK')
        throw error
      }
    }
    return { db: d1Adapter(sqlite), sqlite, close: () => sqlite.close() }
  } catch (error) {
    sqlite.close()
    throw error
  }
}
