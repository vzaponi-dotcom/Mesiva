import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createSettingsDb } from './test-support/settingsDb.js'
import { seedOperationalReadFixture } from './test-support/operationalReadFixture.js'
import { listOrders, listOrdersByIds } from './orderReadRepository.js'
import { loadBootstrap, loadOrderById } from './repositories.js'

const businessId = 'amor-e-sabor'
const migration = readFileSync(new URL('../migrations/0043_operational_order_read_indexes.sql', import.meta.url), 'utf8')
const readers = {
  list: async (db, id) => (await listOrders(db, businessId)).find(order => order.id === id),
  byIds: async (db, id) => (await listOrdersByIds(db, businessId, [id]))[0],
  mutation: (db, id) => loadOrderById(db, businessId, id),
  bootstrap: async (db, id) => (await loadBootstrap(db, businessId)).orders.find(order => order.id === id),
}

for (const [name, read] of Object.entries(readers)) {
  test(`${name} preserves tied item insertion order and derived fields across operational index migration`, async t => {
    const fixture = createSettingsDb()
    t.after(fixture.close)
    const { db, sqlite } = fixture
    sqlite.exec('DROP INDEX orders_business_active_created_idx; DROP INDEX order_items_business_order_created_idx;')
    const { activeIds: [id] } = await seedOperationalReadFixture(db, { activeOrders: 1, itemsPerOrder: 2 })
    sqlite.prepare('UPDATE order_items SET id=?, name_snapshot=?, quantity=? WHERE id=?')
      .run('z-item', 'Primeiro', 1, `${id}:item:0`)
    sqlite.prepare('UPDATE order_items SET id=?, name_snapshot=?, quantity=? WHERE id=?')
      .run('a-item', 'Segundo', 2, `${id}:item:1`)
    const before = await read(db, id)
    assert.deepEqual(before.items.map(item => item.id), ['z-item', 'a-item'])
    assert.equal(before.productName, 'Primeiro')
    assert.equal(before.quantity, 1)
    sqlite.exec(migration)
    const after = await read(db, id)
    assert.deepEqual(after, before, 'migration must preserve the full order contract')
    assert.deepEqual(after, (await listOrders(db, businessId))[0], 'all readers must agree')
  })
}
