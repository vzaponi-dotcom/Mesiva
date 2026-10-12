import { createSettingsDb } from './test-support/settingsDb.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mapMovementRow } from './financeRepository.js'
import { createClient, createProduct, deleteClient, deleteProduct, loadBootstrap, mapOrderItemRow, mapOrderRow, mapProductRow, mapTableTabRow, updateClient, updateProduct } from './repositories.js'

test('product row maps integer cents to current frontend price number', () => {
  assert.deepEqual(mapProductRow({ id: 'p1', category: 'Bebida', size: '350ml', name: 'Coca', price_cents: 850 }), {
    id: 'p1', category: 'Bebida', size: '350ml', name: 'Coca', price: 8.5,
  })
})

test('order item snapshots map prices and product identity', () => {
  assert.deepEqual(mapOrderItemRow({
    id: 'i1', product_id: 'p1', name_snapshot: 'Coca', category_snapshot: 'Bebida', size_snapshot: '350ml',
    quantity: 2, catalog_price_cents: 850, unit_price_cents: 800, price_reason: 'Promoção', note: '',
  }), {
    id: 'i1', productId: 'p1', name: 'Coca', category: 'Bebida', size: '350ml', quantity: 2,
    catalogPrice: 8.5, unitPrice: 8, priceReason: 'Promoção', note: '',
  })
})

test('order row exposes current payment fields and first-item compatibility fields', () => {
  const item = { id: 'i1', productId: 'p1', name: 'Marmita Média', category: 'Marmita', size: 'M', quantity: 2, catalogPrice: 21, unitPrice: 21, priceReason: '', note: '' }
  const order = mapOrderRow({
    id: 'o1', order_number: 7, client_id: 'c1', client_name_snapshot: 'Maria', type: 'Entrega', status: 'Em preparo',
    order_date: '2026-09-01', subtotal_cents: 4200, delivery_fee_cents: 0, total_cents: 4200, created_at: '2026-09-01T20:00:00.000Z',
    finished_at: null, payment_id: null, payment_method: null, paid_at: null, paid_amount_cents: null,
    adjustment_type: 'none', adjustment_mode: 'fixed', adjustment_value: 0, adjustment_amount_cents: 0, adjustment_reason: '',
  }, [item])
  assert.equal(order.paymentStatus, 'Pendente')
  assert.equal(order.orderNumber, 7)
  assert.equal(order.total, 42)
  assert.equal(order.deliveryFee, 0)
  assert.equal(order.productName, 'Marmita Média')
  assert.equal(order.quantity, 2)
  assert.deepEqual(order.items, [item])
})

test('paid order and movement map cents to current frontend numbers', () => {
  const order = mapOrderRow({
    id: 'o1', client_name_snapshot: 'Maria', type: 'Entrega', status: 'Finalizado', order_date: '2026-09-01',
    total_cents: 4200, subtotal_cents: 4200, delivery_fee_cents: 0, created_at: '2026-09-01T20:00:00.000Z', finished_at: null,
    payment_id: 'pay1', payment_method: 'Pix', paid_at: '2026-09-01T20:05:00.000Z', paid_amount_cents: 4200,
  })
  assert.equal(order.paymentStatus, 'Pago')
  assert.equal(order.paidAmount, 42)
  assert.equal(order.paymentMethod, 'Pix')

  assert.equal(mapMovementRow({
    id: 'm1', type: 'entrada', category: 'Vendas', description: 'Pedido', value_cents: 4200,
    source: 'order-payment', order_id: 'o1', payment_id: 'pay1', movement_date: '2026-09-01', created_at: '2026-09-01T20:05:00.000Z',
  }).value, 42)
})

test('paid order maps one receipt allocation as structured data and a simple compatibility method', () => {
  const order = mapOrderRow({
    id: 'o-one', client_name_snapshot: 'Maria', type: 'Entrega', status: 'Finalizado', order_date: '2026-09-21',
    total_cents: 4200, created_at: '2026-09-21T12:00:00.000Z', payment_id: 'pay-one', receipt_id: 'receipt-one',
    payment_method: null, paid_at: '2026-09-21T12:01:00.000Z', paid_amount_cents: 4200,
    payment_allocations_json: '[{"methodCode":"pix","methodLabel":"Pix","amountCents":4200}]',
  })

  assert.equal(order.paymentMethod, 'Pix')
  assert.deepEqual(order.paymentAllocations, [{ methodCode: 'pix', methodLabel: 'Pix', amountCents: 4200 }])
})

test('paid order maps a mixed receipt without inventing a scalar payment method', () => {
  const order = mapOrderRow({
    id: 'o-mixed', client_name_snapshot: 'João', type: 'Retirada', status: 'Finalizado', order_date: '2026-09-21',
    total_cents: 4200, created_at: '2026-09-21T12:00:00.000Z', payment_id: 'pay-mixed', receipt_id: 'receipt-mixed',
    payment_method: 'Dinheiro + Pix', paid_at: '2026-09-21T12:01:00.000Z', paid_amount_cents: 4200,
    payment_allocations_json: '[{"methodCode":"cash","methodLabel":"Dinheiro","amountCents":1200},{"methodCode":"pix","methodLabel":"Pix","amountCents":3000}]',
  })

  assert.equal(order.paymentMethod, null)
  assert.deepEqual(order.paymentAllocations, [
    { methodCode: 'cash', methodLabel: 'Dinheiro', amountCents: 1200 },
    { methodCode: 'pix', methodLabel: 'Pix', amountCents: 3000 },
  ])
})

test('malformed receipt allocation JSON fails closed without inventing payment data', () => {
  const order = mapOrderRow({
    id: 'o-bad', client_name_snapshot: 'Bia', type: 'Entrega', status: 'Finalizado', order_date: '2026-09-21',
    total_cents: 4200, created_at: '2026-09-21T12:00:00.000Z', payment_id: 'pay-bad', receipt_id: 'receipt-bad',
    payment_method: 'Pix', paid_at: '2026-09-21T12:01:00.000Z', paid_amount_cents: 4200,
    payment_allocations_json: '{bad json',
  })

  assert.equal(order.paymentMethod, null)
  assert.deepEqual(order.paymentAllocations, [])
})

test('legacy backfill keeps an unknown historical label as one structured allocation', () => {
  const order = mapOrderRow({
    id: 'o-legacy', client_name_snapshot: 'Histórico', type: 'Entrega', status: 'Finalizado', order_date: '2026-08-01',
    total_cents: 2500, created_at: '2026-08-01T12:00:00.000Z', payment_id: 'pay-legacy', receipt_id: 'legacy-receipt:pay-legacy',
    payment_method: 'Cheque legado', paid_at: '2026-08-01T12:01:00.000Z', paid_amount_cents: 2500,
    payment_allocations_json: '[{"methodCode":null,"methodLabel":"Cheque legado","amountCents":2500}]',
  })

  assert.equal(order.paymentMethod, 'Cheque legado')
  assert.deepEqual(order.paymentAllocations, [{ methodCode: null, methodLabel: 'Cheque legado', amountCents: 2500 }])
})

test('table tab rows expose stable numeric tab numbers', () => {
  assert.deepEqual(mapTableTabRow({
    id: 'tab-1', table_id: 'table-1', table_identifier: '04', tab_number: '1042', status: 'open',
    opened_at: '2026-09-02T18:00:00.000Z', closed_at: null,
  }), {
    id: 'tab-1', tableId: 'table-1', tableIdentifier: '04', tabNumber: 1042, status: 'open',
    openedAt: '2026-09-02T18:00:00.000Z', closedAt: null,
  })
})

class BootstrapDb {
  constructor() {
    this.calls = []
    this.businesses = new Map([
      ['amor-e-sabor', {
        id: 'amor-e-sabor',
        name: 'Amor & Sabor',
        has_logo: 1,
        logo_version: '2026-09-24T03:00:00.000Z',
      }],
      ['sem-logo', {
        id: 'sem-logo',
        name: 'Sem Logo',
        has_logo: 0,
        logo_version: null,
      }],
      ['outro-negocio', {
        id: 'outro-negocio',
        name: 'Outro Negócio',
        has_logo: 1,
        logo_version: '2026-09-24T04:00:00.000Z',
      }],
    ])
  }

  prepare(sql) {
    const db = this
    return {
      bind(...values) {
        db.calls.push({ sql, values })
        return {
          async first() {
            if (sql.includes('FROM businesses')) return db.businesses.get(values[0]) ?? null
            return null
          },
          async all() {
            if (sql.includes('FROM clients')) return { results: [{ id: 'c1', name: 'Maria', phone: '11', address: 'Centro' }] }
            if (sql.includes('FROM products')) return { results: [{ id: 'p1', category: 'Bebida', size: '350ml', name: 'Coca', price_cents: 850 }] }
            if (sql.includes('FROM table_tabs')) return { results: [{ id: 'tab-1', table_id: 'table-1', table_identifier: '04', tab_number: 1042, status: 'open', opened_at: '2026-09-02T18:00:00.000Z', closed_at: null }] }
            if (sql.includes('FROM orders')) return { results: [{
              id: 'o1', order_number: 7, client_id: 'c1', client_name_snapshot: 'Maria', table_tab_id: null, type: 'Entrega', order_date: '2026-09-01', status: 'Em preparo',
              subtotal_cents: 850, delivery_fee_cents: 0, adjustment_type: 'none', adjustment_mode: 'fixed', adjustment_value: 0,
              adjustment_amount_cents: 0, adjustment_reason: '', total_cents: 850, created_at: '2026-09-01T20:00:00.000Z', finished_at: null,
              payment_id: null, payment_method: null, paid_at: null, paid_amount_cents: null,
            }] }
            if (sql.includes('FROM order_items')) return { results: [{
              id: 'i1', order_id: 'o1', product_id: 'p1', name_snapshot: 'Coca', category_snapshot: 'Bebida', size_snapshot: '350ml',
              quantity: 1, catalog_price_cents: 850, unit_price_cents: 850, price_reason: '', note: '', created_at: '2026-09-01T20:00:00.000Z',
            }] }
            if (sql.includes('FROM movements')) return { results: [] }
            return { results: [] }
          },
        }
      },
    }
  }
}

test('loadBootstrap scopes every business-owned query and attaches order items and table tabs', async () => {
  const db = new BootstrapDb()
  const result = await loadBootstrap(db, 'amor-e-sabor')
  assert.deepEqual(result.business, {
    id: 'amor-e-sabor',
    name: 'Amor & Sabor',
    hasLogo: true,
    logoVersion: '2026-09-24T03:00:00.000Z',
  })
  assert.equal(result.clients[0].name, 'Maria')
  assert.equal(result.products[0].price, 8.5)
  assert.equal(result.orders[0].items[0].name, 'Coca')
  assert.equal(result.orders[0].orderNumber, 7)
  assert.equal(result.orders[0].items[0].note, '')
  assert.deepEqual(result.tableTabs, [{
    id: 'tab-1', tableId: 'table-1', tableIdentifier: '04', tabNumber: 1042, status: 'open',
    openedAt: '2026-09-02T18:00:00.000Z', closedAt: null,
  }])
  assert.deepEqual(result.movements, [])

  const movementRead = db.calls.find((call) => call.sql.includes('LEFT JOIN business_finance_categories fc'))
  assert.ok(movementRead, 'bootstrap must load finance movements')
  assert.match(movementRead.sql, /m\.receipt_id/)
  assert.match(movementRead.sql, /m\.payment_allocation_id/)

  for (const call of db.calls) {
    assert.equal(call.values[0], 'amor-e-sabor')
    if (!call.sql.includes('FROM businesses')) assert.match(call.sql, /business_id/)
  }
})

test('bootstrap exposes only safe operation identity fields and keeps logo/name state isolated by business', async () => {
  const db = new BootstrapDb()

  const withoutLogo = await loadBootstrap(db, 'sem-logo')
  assert.deepEqual(withoutLogo.business, {
    id: 'sem-logo',
    name: 'Sem Logo',
    hasLogo: false,
    logoVersion: null,
  })

  db.businesses.get('amor-e-sabor').name = 'Amor & Sabor Renomeado'
  const renamed = await loadBootstrap(db, 'amor-e-sabor')
  assert.deepEqual(renamed.business, {
    id: 'amor-e-sabor',
    name: 'Amor & Sabor Renomeado',
    hasLogo: true,
    logoVersion: '2026-09-24T03:00:00.000Z',
  })

  const other = await loadBootstrap(db, 'outro-negocio')
  assert.deepEqual(other.business, {
    id: 'outro-negocio',
    name: 'Outro Negócio',
    hasLogo: true,
    logoVersion: '2026-09-24T04:00:00.000Z',
  })

  for (const business of [withoutLogo.business, renamed.business, other.business]) {
    assert.deepEqual(Object.keys(business).sort(), ['hasLogo', 'id', 'logoVersion', 'name'])
  }

  const businessReads = db.calls.filter(({ sql }) => sql.includes('FROM businesses'))
  assert.ok(businessReads.length >= 3)
  for (const read of businessReads) {
    assert.match(read.sql, /business_profiles/)
    assert.doesNotMatch(read.sql, /bp\.phone|bp\.address_|bp\.logo_sha256|bp\.\*/)
  }
})

test('client CRUD scopes lookup/update/delete by business id', async t => {
  const {db,sqlite,close}=createSettingsDb();t.after(close)
  const now = new Date('2026-09-01T20:00:00.000Z')
  const client = await createClient(db, 'amor-e-sabor', { name: 'Maria', phone: '11', address: 'Centro' }, now)
  assert.equal(client.name, 'Maria')

  sqlite.exec("INSERT INTO businesses(id,slug,name,created_at,updated_at) VALUES('outra-empresa','outra','Outra','2026-09-30','2026-09-30'); INSERT INTO clients(id,business_id,name,created_at,updated_at) VALUES('c-other','outra-empresa','Other','2026-09-30','2026-09-30')")
  assert.equal(await updateClient(db, 'amor-e-sabor', 'c-other', { name: 'X', phone: '', address: '' }, now), null)

  const updated = await updateClient(db, 'amor-e-sabor', client.id, { name: 'Maria Silva', phone: '22', address: 'Bairro' }, now)
  assert.equal(updated.name, 'Maria Silva')
  assert.equal(await deleteClient(db, 'amor-e-sabor', client.id), true)
  assert.equal(await deleteClient(db, 'amor-e-sabor', client.id), false)

  assert.equal(sqlite.prepare("SELECT name FROM clients WHERE id='c-other'").get().name,'Other')
  assert.equal(sqlite.prepare("SELECT count(*) n FROM audit_events WHERE action IN ('client.created','client.updated','client.deleted') AND business_id='amor-e-sabor'").get().n,3)
})

test('product delete is soft and all product writes are business scoped', async t => {
  const {db,sqlite,close}=createSettingsDb();t.after(close)
  const now = new Date('2026-09-01T20:00:00.000Z')
  const product = await createProduct(db, 'amor-e-sabor', { presentationType:'unit',presentationValue:'',presentationUnit:'',category: 'Bebida', size: '350ml', name: 'Coca', priceCents: 850 }, now)
  assert.equal(product.price, 8.5)

  const updated = await updateProduct(db, 'amor-e-sabor', product.id, { presentationType:'unit',presentationValue:'',presentationUnit:'',category: 'Bebida', size: 'Lata', name: 'Coca Cola', priceCents: 900 }, now)
  assert.equal(updated.price, 9)

  assert.equal(await updateProduct(db,'outside',product.id,{category:'Bebida',size:'Lata',name:'Wrong tenant',priceCents:1},now),null)
  assert.equal(await deleteProduct(db,'outside',product.id,now),false)
  assert.equal(sqlite.prepare('SELECT name FROM products WHERE id=?').get(product.id).name,'Coca Cola')
  assert.equal(await deleteProduct(db, 'amor-e-sabor', product.id, now), true)
  assert.equal(sqlite.prepare('SELECT active FROM products WHERE id=?').get(product.id).active, 0)
  assert.equal(sqlite.prepare("SELECT count(*) n FROM audit_events WHERE resource_id=?").get(product.id).n,3)
})
