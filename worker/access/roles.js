import { APPLICATION_CAPABILITIES } from '../../shared/settingsAccess.js'

const OPERATOR_CAPABILITIES = Object.freeze([
  'orders.view', 'orders.history', 'orders.create', 'orders.edit', 'orders.finalize', 'orders.discount', 'comandas.view',
  'payments.receive', 'clients.view', 'clients.create', 'clients.update', 'products.view',
  'tables.view', 'printing.queue', 'printing.execute', 'printing.station.view', 'preferences.local',
])
export const BUILTIN_ROLES = Object.freeze([
  { code: 'manager', name: 'Gerente', capabilities: APPLICATION_CAPABILITIES },
  { code: 'operator', name: 'Operador', capabilities: OPERATOR_CAPABILITIES },
])

export function normalizeLogin(input) {
  if (typeof input !== 'string') throw new TypeError('Login must be a string')
  return input.normalize('NFKC').trim().toLowerCase()
}

export function prepareBuiltinRoles(db, businessId, now) {
  const timestamp = now.toISOString()
  const statements = []
  for (const { code, name, capabilities } of BUILTIN_ROLES) {
    statements.push(db.prepare(`INSERT INTO roles
      (id, business_id, code, name, active, version, is_builtin, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, 1, 1, ?, ?)
      ON CONFLICT (business_id, code) DO NOTHING`
    ).bind(`${businessId}:${code}`, businessId, code, name, timestamp, timestamp))
    for (const capability of capabilities) {
      statements.push(db.prepare(`INSERT INTO role_capabilities (business_id, role_id, capability)
        SELECT business_id, id, ? FROM roles WHERE business_id = ? AND code = ?
        ON CONFLICT (business_id, role_id, capability) DO NOTHING`
      ).bind(capability, businessId, code))
    }
  }
  return statements
}

export async function seedBuiltinRoles(db, businessId, now) {
  await db.batch(prepareBuiltinRoles(db, businessId, now))
}

export async function loadRoleGrants(db, businessId, roleId) {
  const { results } = await db.prepare(`SELECT rc.capability FROM role_capabilities rc
    JOIN roles r ON r.business_id = rc.business_id AND r.id = rc.role_id
    WHERE rc.business_id = ? AND rc.role_id = ? AND r.active = 1`
  ).bind(businessId, roleId).all()
  return new Set(results.map(({ capability }) => capability).filter((capability) => APPLICATION_CAPABILITIES.includes(capability)))
}
