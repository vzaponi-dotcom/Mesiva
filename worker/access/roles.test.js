import test from 'node:test'
import assert from 'node:assert/strict'
import { APPLICATION_CAPABILITIES } from '../../shared/settingsAccess.js'
import { createSettingsDb } from '../test-support/settingsDb.js'
import { normalizeLogin, seedBuiltinRoles, loadRoleGrants } from './roles.js'

const BUSINESS = 'amor-e-sabor'
const NOW = new Date('2026-09-30T12:00:00.000Z')
const OPERATOR_GRANTS = [
  'orders.view', 'orders.history', 'orders.create', 'orders.edit', 'orders.finalize', 'orders.discount', 'comandas.view',
  'payments.receive', 'clients.view', 'clients.create', 'clients.update', 'products.view',
  'tables.view', 'printing.queue', 'printing.execute', 'printing.station.view', 'preferences.local',
]
const setup = (t) => { const fixture = createSettingsDb(); t.after(fixture.close); return fixture }
const roleId = (sqlite, businessId, code) => sqlite.prepare('SELECT id FROM roles WHERE business_id = ? AND code = ?').get(businessId, code).id

test('login normalization makes compatibility characters, case and outer whitespace equivalent', () => {
  assert.equal(normalizeLogin('  Ｖictor.ZAPONI  '), 'victor.zaponi')
  assert.equal(normalizeLogin('  JOSE\u0301  '), 'josé')
  assert.equal(normalizeLogin('Ana Silva'), 'ana silva')
  assert.equal(normalizeLogin('  '), '')
  assert.throws(() => normalizeLogin(null), TypeError)
})

test('built-in seeding persists explicit manager grants and the exact operator grant set idempotently', async (t) => {
  const { db, sqlite } = setup(t)
  await seedBuiltinRoles(db, BUSINESS, NOW)
  const initialRoles = sqlite.prepare('SELECT * FROM roles ORDER BY code').all()
  const initialGrants = sqlite.prepare('SELECT * FROM role_capabilities ORDER BY role_id, capability').all()
  await seedBuiltinRoles(db, BUSINESS, new Date('2026-10-01T12:00:00.000Z'))
  assert.deepEqual(sqlite.prepare('SELECT * FROM roles ORDER BY code').all(), initialRoles)
  assert.deepEqual(sqlite.prepare('SELECT * FROM role_capabilities ORDER BY role_id, capability').all(), initialGrants)
  assert.equal(initialRoles.length, 2)
  assert.deepEqual(initialRoles.map(({ code, name, active, version, is_builtin }) => ({ code, name, active, version, is_builtin })), [
    { code: 'manager', name: 'Gerente', active: 1, version: 1, is_builtin: 1 },
    { code: 'operator', name: 'Operador', active: 1, version: 1, is_builtin: 1 },
  ])
  const managerGrants = await loadRoleGrants(db, BUSINESS, roleId(sqlite, BUSINESS, 'manager'))
  assert.deepEqual([...managerGrants].sort(), [...APPLICATION_CAPABILITIES].sort())
  for (const capability of ['clients.create', 'clients.update', 'clients.delete', 'printing.force', 'orders.backdate', 'access.users.view', 'access.users.manage', 'access.audit.view']) {
    assert.ok(managerGrants.has(capability), capability)
  }
  const operatorGrants = await loadRoleGrants(db, BUSINESS, roleId(sqlite, BUSINESS, 'operator'))
  assert.deepEqual([...operatorGrants].sort(), [...OPERATOR_GRANTS].sort())
  assert.ok(operatorGrants.has('payments.receive'))
  assert.ok(operatorGrants.has('orders.discount'))
  for (const capability of ['payments.refund', 'finance.movements', 'clients.manage', 'clients.delete', 'printing.force', 'access.users.manage']) assert.ok(!operatorGrants.has(capability))
})

test('grant loading ignores unknown grants and denies missing, inactive and other-tenant roles', async (t) => {
  const { db, sqlite } = setup(t)
  await seedBuiltinRoles(db, BUSINESS, NOW)
  const id = roleId(sqlite, BUSINESS, 'operator')
  sqlite.prepare('INSERT INTO role_capabilities (business_id, role_id, capability) VALUES (?, ?, ?)').run(BUSINESS, id, '*')
  sqlite.prepare('INSERT INTO role_capabilities (business_id, role_id, capability) VALUES (?, ?, ?)').run(BUSINESS, id, 'future.unknown')
  assert.deepEqual([...await loadRoleGrants(db, BUSINESS, id)].sort(), [...OPERATOR_GRANTS].sort())
  assert.deepEqual([...await loadRoleGrants(db, 'another-business', id)], [])
  assert.deepEqual([...await loadRoleGrants(db, BUSINESS, 'missing')], [])
  sqlite.prepare('UPDATE roles SET active = 0 WHERE id = ?').run(id)
  assert.deepEqual([...await loadRoleGrants(db, BUSINESS, id)], [])
})

test('retired clients.manage is never seeded and persisted old rows confer no permission', async t => {
  const { db, sqlite } = setup(t)
  await seedBuiltinRoles(db, BUSINESS, NOW)
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM role_capabilities WHERE capability='clients.manage'").get().n, 0)
  const id = roleId(sqlite, BUSINESS, 'operator')
  sqlite.prepare('INSERT INTO role_capabilities (business_id,role_id,capability) VALUES (?,?,?)').run(BUSINESS, id, 'clients.manage')
  assert.equal((await loadRoleGrants(db, BUSINESS, id)).has('clients.manage'), false)
})

test('built-in roles and grants stay isolated when seeding multiple businesses', async (t) => {
  const { db, sqlite } = setup(t)
  sqlite.prepare('INSERT INTO businesses (id, slug, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('other', 'other', 'Other', NOW.toISOString(), NOW.toISOString())
  await seedBuiltinRoles(db, BUSINESS, NOW)
  await seedBuiltinRoles(db, 'other', NOW)
  assert.notEqual(roleId(sqlite, BUSINESS, 'manager'), roleId(sqlite, 'other', 'manager'))
  assert.deepEqual([...await loadRoleGrants(db, 'other', roleId(sqlite, BUSINESS, 'manager'))], [])
  assert.deepEqual([...await loadRoleGrants(db, 'other', roleId(sqlite, 'other', 'operator'))].sort(), [...OPERATOR_GRANTS].sort())
})
