import test from 'node:test'
import assert from 'node:assert/strict'
import { createSettingsDb } from '../test-support/settingsDb.js'

test('reporting repository scopes every base read to the authenticated business', async (t) => {
  const { createReportingRepository } = await import('./repository.js')
  const { db, sqlite, close } = createSettingsDb()
  t.after(close)
  sqlite.exec("INSERT INTO businesses (id, slug, name, created_at, updated_at) VALUES ('business-a', 'a', 'A', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'), ('business-b', 'b', 'B', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'); INSERT INTO orders (id, business_id, order_number, client_name_snapshot, order_date, type, status, subtotal_cents, delivery_fee_cents, adjustment_type, adjustment_mode, adjustment_value, adjustment_amount_cents, total_cents, created_at) VALUES ('a', 'business-a', 1, 'Ana', '2026-09-10', 'Entrega', 'Finalizado', 1000, 0, 'none', 'fixed', 0, 0, 1000, '2026-09-10T12:00:00.000Z'), ('b', 'business-b', 2, 'Bia', '2026-09-10', 'Entrega', 'Finalizado', 2000, 0, 'none', 'fixed', 0, 0, 2000, '2026-09-10T12:00:00.000Z')")
  const repository = createReportingRepository(db)
  const rows = await repository.listOrders('business-a', { from: '2026-09-01', to: '2026-09-30' })
  assert.deepEqual(rows.map((row) => row.id), ['a'])
})

test('overview reads receipts once and only official refunds for the selected business and dates', async (t) => {
  const { createReportingRepository } = await import('./repository.js')
  const { db, sqlite, close } = createSettingsDb()
  t.after(close)
  sqlite.exec(`
    INSERT INTO businesses (id, slug, name, created_at, updated_at) VALUES
      ('business-a', 'a', 'A', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'),
      ('business-b', 'b', 'B', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z');
    INSERT INTO orders (id, business_id, order_number, client_name_snapshot, order_date, type, status, subtotal_cents, delivery_fee_cents, adjustment_type, adjustment_mode, adjustment_value, adjustment_amount_cents, total_cents, created_at) VALUES
      ('order-a', 'business-a', 1, 'Ana', '2026-09-10', 'Entrega', 'Finalizado', 1000, 0, 'none', 'fixed', 0, 0, 1000, '2026-09-10T12:00:00.000Z'),
      ('order-b', 'business-b', 2, 'Bia', '2026-09-10', 'Entrega', 'Finalizado', 2000, 0, 'none', 'fixed', 0, 0, 2000, '2026-09-10T12:00:00.000Z');
    INSERT INTO payment_receipts (id, business_id, total_cents, paid_at, created_at) VALUES
      ('receipt-a', 'business-a', 1000, '2026-09-10T15:00:00.000Z', '2026-09-10T15:00:00.000Z'),
      ('receipt-b', 'business-b', 2000, '2026-09-10T15:00:00.000Z', '2026-09-10T15:00:00.000Z');
    INSERT INTO payment_allocations (id, business_id, receipt_id, method_label, amount_cents, created_at) VALUES
      ('allocation-a', 'business-a', 'receipt-a', 'Pix', 1000, '2026-09-10T15:00:00.000Z'),
      ('allocation-b', 'business-b', 'receipt-b', 'Pix', 2000, '2026-09-10T15:00:00.000Z');
    INSERT INTO payments (id, business_id, order_id, receipt_id, amount_cents, method, paid_at, created_at) VALUES
      ('payment-a', 'business-a', 'order-a', 'receipt-a', 1000, NULL, '2026-09-10T15:00:00.000Z', '2026-09-10T15:00:00.000Z');
    INSERT INTO movements (id, business_id, type, category, description, value_cents, source, order_id, movement_date, created_at) VALUES
      ('refund-a', 'business-a', 'saida', 'refunds', 'Estorno', 100, 'order-refund', 'order-a', '2026-09-10', '2026-09-10T16:00:00.000Z'),
      ('manual-a', 'business-a', 'saida', 'refunds', 'Manual', 900, 'manual', NULL, '2026-09-10', '2026-09-10T16:00:00.000Z');
  `)
  const result = await createReportingRepository(db).loadOverview('business-a', { from: '2026-09-01', to: '2026-09-30' })
  assert.equal(result.orders.length, 1)
  assert.equal(result.receipts[0].total_cents, 1000)
  assert.equal(result.refunds[0].value_cents, 100)
})

test('receipts use Sao Paulo business dates across the UTC midnight boundary', async (t) => {
  const { createReportingRepository } = await import('./repository.js')
  const { db, sqlite, close } = createSettingsDb()
  t.after(close)
  sqlite.exec(`
    INSERT INTO businesses (id, slug, name, created_at, updated_at) VALUES ('a', 'a', 'A', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z');
    INSERT INTO payment_receipts (id, business_id, total_cents, paid_at, created_at) VALUES
      ('previous', 'a', 100, '2026-09-10T02:59:59.000Z', '2026-09-10T02:59:59.000Z'),
      ('current', 'a', 200, '2026-09-10T03:00:00.000Z', '2026-09-10T03:00:00.000Z'),
      ('late', 'a', 300, '2026-09-11T02:59:59.000Z', '2026-09-11T02:59:59.000Z'),
      ('next', 'a', 400, '2026-09-11T03:00:00.000Z', '2026-09-11T03:00:00.000Z');
  `)
  const result = await createReportingRepository(db).loadOverview('a', { from: '2026-09-10', to: '2026-09-10' })
  assert.deepEqual(result.receipts.map((row) => row.total_cents), [200, 300])
})

test('sales method filter allocates a split receipt only to the selected method on its business day', async (t) => {
  const { createReportingRepository } = await import('./repository.js')
  const { db, sqlite, close } = createSettingsDb()
  t.after(close)
  sqlite.exec(`
    INSERT INTO businesses (id,slug,name,created_at,updated_at) VALUES ('a','a','A','2026-09-01T00:00:00Z','2026-09-01T00:00:00Z');
    INSERT INTO orders (id,business_id,order_number,client_name_snapshot,order_date,type,status,subtotal_cents,delivery_fee_cents,adjustment_type,adjustment_mode,adjustment_value,adjustment_amount_cents,total_cents,created_at) VALUES ('o','a',1,'Ana','2026-09-09','Entrega','Finalizado',1000,0,'none','fixed',0,0,1000,'2026-09-09T12:00:00Z');
    INSERT INTO payment_receipts (id,business_id,total_cents,paid_at,created_at) VALUES ('r','a',1000,'2026-09-10T02:30:00Z','2026-09-10T02:30:00Z');
    INSERT INTO payment_allocations (id,business_id,receipt_id,method_label,amount_cents,created_at) VALUES ('pix','a','r','Pix',700,'2026-09-10T02:30:00Z'),('cash','a','r','Dinheiro',300,'2026-09-10T02:30:00Z');
    INSERT INTO payments (id,business_id,order_id,receipt_id,amount_cents,method,paid_at,created_at) VALUES ('p','a','o','r',1000,NULL,'2026-09-10T02:30:00Z','2026-09-10T02:30:00Z');
  `)
  const source = await createReportingRepository(db).loadSales('a', { from: '2026-09-09', to: '2026-09-09', paymentMethod: 'Pix' })
  assert.deepEqual(source.receipts.map((row) => row.total_cents), [700])
  assert.deepEqual(source.allocations.map((row) => row.amount_cents), [700])
  assert.deepEqual(source.orders.map((row) => row.id), ['o'])
})


test('sales refund rows expose movement_date for the daily refund series', async (t) => {
  const { createReportingRepository } = await import('./repository.js')
  const { db, sqlite, close } = createSettingsDb()
  t.after(close)
  sqlite.exec("INSERT INTO businesses (id,slug,name,created_at,updated_at) VALUES ('a','a','A','2026-09-01T00:00:00Z','2026-09-01T00:00:00Z'); INSERT INTO movements (id,business_id,type,category,description,value_cents,source,order_id,movement_date,created_at) VALUES ('r','a','saida','refunds','Estorno',15500,'order-refund',NULL,'2026-09-20','2026-09-20T15:00:00Z');")
  const source = await createReportingRepository(db).loadSales('a', { from: '2026-09-01', to: '2026-09-25' })
  assert.deepEqual(source.refunds, [{ value_cents: 15500, movement_date: '2026-09-20' }])
})


test('shared client receipt stays singular in reporting repository with two linked payments', async (t) => {
  const { createReportingRepository } = await import('./repository.js')
  const { db, sqlite, close } = createSettingsDb()
  t.after(close)

  sqlite.exec(`
    INSERT INTO businesses (id,slug,name,created_at,updated_at)
    VALUES ('shared-business','shared-business','Shared','2026-09-01T00:00:00Z','2026-09-01T00:00:00Z');

    INSERT INTO orders (
      id,business_id,order_number,client_name_snapshot,order_date,type,status,
      subtotal_cents,delivery_fee_cents,adjustment_type,adjustment_mode,
      adjustment_value,adjustment_amount_cents,total_cents,created_at
    ) VALUES
      ('shared-o1','shared-business',1,'Fernanda','2026-09-27','Entrega','Finalizado',4900,0,'none','fixed',0,0,4900,'2026-09-27T12:00:00Z'),
      ('shared-o2','shared-business',2,'Fernanda','2026-09-27','Entrega','Finalizado',2000,0,'none','fixed',0,0,2000,'2026-09-27T12:05:00Z');

    INSERT INTO payment_receipts (id,business_id,total_cents,paid_at,created_at)
    VALUES ('shared-r','shared-business',6900,'2026-09-27T15:00:00Z','2026-09-27T15:00:00Z');

    INSERT INTO payment_allocations (id,business_id,receipt_id,method_code,method_label,amount_cents,created_at) VALUES
      ('shared-cash','shared-business','shared-r',NULL,'Dinheiro',3000,'2026-09-27T15:00:00Z'),
      ('shared-pix','shared-business','shared-r',NULL,'Pix',3900,'2026-09-27T15:00:00Z');

    INSERT INTO payments (id,business_id,order_id,receipt_id,amount_cents,method,paid_at,created_at) VALUES
      ('shared-p1','shared-business','shared-o1','shared-r',4900,NULL,'2026-09-27T15:00:00Z','2026-09-27T15:00:00Z'),
      ('shared-p2','shared-business','shared-o2','shared-r',2000,NULL,'2026-09-27T15:00:00Z','2026-09-27T15:00:00Z');
  `)

  const source = await createReportingRepository(db).loadSales('shared-business', {
    from: '2026-09-27',
    to: '2026-09-27',
  })

  assert.equal(source.orders.length, 2)
  assert.deepEqual(source.receipts.map(({ id, total_cents }) => ({ id, total_cents })), [
    { id: 'shared-r', total_cents: 6900 },
  ])
  assert.deepEqual(source.allocations.map(({ method_label, amount_cents }) => ({ method_label, amount_cents })), [
    { method_label: 'Dinheiro', amount_cents: 3000 },
    { method_label: 'Pix', amount_cents: 3900 },
  ])
  assert.deepEqual(source.payments.map(({ order_id, amount_cents }) => ({ order_id, amount_cents })).sort((a, b) => a.order_id.localeCompare(b.order_id)), [
    { order_id: 'shared-o1', amount_cents: 4900 },
    { order_id: 'shared-o2', amount_cents: 2000 },
  ])
})

test('future schedules are selected by order_date, and Local scheduled filters reconcile independently from created_at', async (t) => {
  const { createReportingRepository } = await import('./repository.js')
  const { db, sqlite, close } = createSettingsDb()
  t.after(close)

  sqlite.exec(`
    INSERT INTO businesses (id, slug, name, created_at, updated_at)
    VALUES ('future-report', 'future-report', 'Future report', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z');

    INSERT INTO orders (
      id, business_id, order_number, client_name_snapshot, customer_identity_type,
      order_date, type, status, scheduled_for, is_backdated,
      subtotal_cents, delivery_fee_cents, adjustment_type, adjustment_mode,
      adjustment_value, adjustment_amount_cents, total_cents, created_at, finished_at
    ) VALUES
      ('created-now', 'future-report', 1, 'Agora', 'registered_client',
        '2026-09-29', 'Entrega', 'Finalizado', NULL, 0,
        1000, 0, 'none', 'fixed', 0, 0, 1000, '2026-09-29T12:00:00Z', '2026-09-29T12:20:00Z'),
      ('future-local', 'future-report', 2, 'Mesa 1', 'table',
        '2026-10-03', 'Local', 'Finalizado', '2026-10-03T15:00:00Z', 0,
        2000, 0, 'none', 'fixed', 0, 0, 2000, '2026-09-29T12:05:00Z', '2026-10-03T14:30:00Z'),
      ('future-local-now', 'future-report', 3, 'Mesa 2', 'table',
        '2026-10-03', 'Local', 'Finalizado', NULL, 0,
        3000, 0, 'none', 'fixed', 0, 0, 3000, '2026-09-29T12:10:00Z', '2026-10-03T14:20:00Z'),
      ('future-delivery', 'future-report', 4, 'Entrega', 'registered_client',
        '2026-10-03', 'Entrega', 'Finalizado', '2026-10-03T16:00:00Z', 0,
        4000, 0, 'none', 'fixed', 0, 0, 4000, '2026-09-29T12:15:00Z', '2026-10-03T15:30:00Z');
  `)

  const repository = createReportingRepository(db)
  const creationDay = await repository.listOrders('future-report', { from: '2026-09-29', to: '2026-09-29' })
  const serviceDay = await repository.listOrders('future-report', { from: '2026-10-03', to: '2026-10-03' })
  const scheduledLocal = await repository.listOperationalOrders('future-report', {
    from: '2026-10-03',
    to: '2026-10-03',
    type: 'Local',
    schedule: 'scheduled',
  })

  assert.deepEqual(creationDay.map(({ id }) => id), ['created-now'])
  assert.deepEqual(serviceDay.map(({ id }) => id), ['future-local', 'future-local-now', 'future-delivery'])
  assert.deepEqual(scheduledLocal.map(({ id, type, scheduled_for }) => ({ id, type, scheduled_for })), [{
    id: 'future-local',
    type: 'Local',
    scheduled_for: '2026-10-03T15:00:00Z',
  }])
})

test('early payment remains on its financial date while the future sale remains on order_date', async (t) => {
  const { createReportingRepository } = await import('./repository.js')
  const { db, sqlite, close } = createSettingsDb()
  t.after(close)

  sqlite.exec(`
    INSERT INTO businesses (id,slug,name,created_at,updated_at)
    VALUES ('future-paid','future-paid','Future paid','2026-09-01T00:00:00Z','2026-09-01T00:00:00Z');

    INSERT INTO orders (
      id,business_id,order_number,client_name_snapshot,customer_identity_type,
      order_date,type,status,scheduled_for,is_backdated,
      subtotal_cents,delivery_fee_cents,adjustment_type,adjustment_mode,
      adjustment_value,adjustment_amount_cents,total_cents,created_at,finished_at
    ) VALUES (
      'future-order','future-paid',1,'Ana','registered_client',
      '2026-10-03','Entrega','Finalizado','2026-10-03T15:00:00Z',0,
      4000,0,'none','fixed',0,0,4000,'2026-09-29T12:00:00Z','2026-10-03T14:30:00Z'
    );

    INSERT INTO payment_receipts (id,business_id,total_cents,paid_at,created_at)
    VALUES ('early-receipt','future-paid',4000,'2026-09-29T15:00:00Z','2026-09-29T15:00:00Z');

    INSERT INTO payment_allocations (id,business_id,receipt_id,method_label,amount_cents,created_at)
    VALUES ('early-allocation','future-paid','early-receipt','Pix',4000,'2026-09-29T15:00:00Z');

    INSERT INTO payments (id,business_id,order_id,receipt_id,amount_cents,method,paid_at,created_at)
    VALUES ('early-payment','future-paid','future-order','early-receipt',4000,NULL,'2026-09-29T15:00:00Z','2026-09-29T15:00:00Z');
  `)

  const repository = createReportingRepository(db)
  const paymentDay = await repository.loadSales('future-paid', { from: '2026-09-29', to: '2026-09-29' })
  const serviceDay = await repository.loadSales('future-paid', { from: '2026-10-03', to: '2026-10-03' })

  assert.deepEqual(paymentDay.orders, [])
  assert.deepEqual(paymentDay.receipts.map(({ id, total_cents }) => ({ id, total_cents })), [{
    id: 'early-receipt',
    total_cents: 4000,
  }])
  assert.deepEqual(serviceDay.orders.map(({ id, order_date }) => ({ id, order_date })), [{
    id: 'future-order',
    order_date: '2026-10-03',
  }])
  assert.deepEqual(serviceDay.receipts, [])
  assert.deepEqual(serviceDay.payments.map(({ order_id, amount_cents }) => ({ order_id, amount_cents })), [{
    order_id: 'future-order',
    amount_cents: 4000,
  }])
})

test('reporting sources expose reservation identity so receivable analytics can exclude active reservations', async (t) => {
  const { createReportingRepository } = await import('./repository.js')
  const { db, sqlite, close } = createSettingsDb()
  t.after(close)
  const at = '2026-09-29T12:00:00Z'

  sqlite.exec(`
    INSERT INTO businesses (id,slug,name,created_at,updated_at)
    VALUES ('reservation-report','reservation-report','Reservation report','${at}','${at}');

    INSERT INTO tables (id,business_id,name,name_key,sort_order,is_active,created_at,updated_at)
    VALUES ('table-report','reservation-report','Mesa 1','mesa 1',1,1,'${at}','${at}');

    INSERT INTO orders (
      id,business_id,order_number,client_name_snapshot,customer_identity_type,
      order_date,type,status,scheduled_for,is_backdated,
      subtotal_cents,delivery_fee_cents,adjustment_type,adjustment_mode,
      adjustment_value,adjustment_amount_cents,total_cents,created_at,finished_at
    ) VALUES (
      'reservation-order','reservation-report',1,'Mesa 1','table',
      '2026-10-03','Local','Finalizado','2026-10-03T15:00:00Z',0,
      5000,0,'none','fixed',0,0,5000,'${at}','2026-10-03T14:30:00Z'
    );

    INSERT INTO table_reservations (
      id,business_id,order_id,table_id,table_name_snapshot,status,
      scheduled_for,ends_at,duration_minutes,revision,
      created_at,updated_at
    ) VALUES (
      'reservation-report-1','reservation-report','reservation-order','table-report','Mesa 1','reserved',
      '2026-10-03T15:00:00Z','2026-10-03T17:00:00Z',120,1,'${at}','${at}'
    );
  `)

  const repository = createReportingRepository(db)
  const overview = await repository.loadOverview('reservation-report', { from: '2026-10-03', to: '2026-10-03' })
  const sales = await repository.loadSales('reservation-report', { from: '2026-10-03', to: '2026-10-03' })

  assert.equal(overview.orders[0].table_reservation_id, 'reservation-report-1')
  assert.equal(sales.orders[0].table_reservation_id, 'reservation-report-1')
})

test('detail receivable filter and pending amount exclude active reservation orders', async (t) => {
  const { createReportingRepository } = await import('./repository.js')
  const { db, sqlite, close } = createSettingsDb()
  t.after(close)
  const at = '2026-09-29T12:00:00Z'

  sqlite.exec(`
    INSERT INTO businesses (id,slug,name,created_at,updated_at)
    VALUES ('detail-reservation','detail-reservation','Detail reservation','${at}','${at}');

    INSERT INTO tables (id,business_id,name,name_key,sort_order,is_active,created_at,updated_at)
    VALUES ('detail-table','detail-reservation','Mesa 1','mesa 1',1,1,'${at}','${at}');

    INSERT INTO orders (
      id,business_id,order_number,client_name_snapshot,customer_identity_type,
      order_date,type,status,scheduled_for,is_backdated,
      subtotal_cents,delivery_fee_cents,adjustment_type,adjustment_mode,
      adjustment_value,adjustment_amount_cents,total_cents,created_at,finished_at
    ) VALUES
      ('detail-reservation-order','detail-reservation',1,'Mesa 1','table',
        '2026-10-03','Local','Finalizado','2026-10-03T15:00:00Z',0,
        5000,0,'none','fixed',0,0,5000,'${at}','2026-10-03T14:30:00Z'),
      ('detail-delivery-order','detail-reservation',2,'Ana','registered_client',
        '2026-10-03','Entrega','Finalizado','2026-10-03T16:00:00Z',0,
        4000,0,'none','fixed',0,0,4000,'${at}','2026-10-03T15:30:00Z');

    INSERT INTO table_reservations (
      id,business_id,order_id,table_id,table_name_snapshot,status,
      scheduled_for,ends_at,duration_minutes,revision,created_at,updated_at
    ) VALUES (
      'detail-reservation-1','detail-reservation','detail-reservation-order','detail-table','Mesa 1','reserved',
      '2026-10-03T15:00:00Z','2026-10-03T17:00:00Z',120,1,'${at}','${at}'
    );
  `)

  const repository = createReportingRepository(db)
  const all = await repository.listDetail('detail-reservation', {
    from: '2026-10-03',
    to: '2026-10-03',
    page: 1,
    pageSize: 25,
    sort: 'date-desc',
  })
  const unpaid = await repository.listDetail('detail-reservation', {
    from: '2026-10-03',
    to: '2026-10-03',
    receivable: 'unpaid',
    page: 1,
    pageSize: 25,
    sort: 'date-desc',
  })

  const reservation = all.items.find(({ id }) => id === 'detail-reservation-order')
  assert.equal(reservation.table_reservation_id, 'detail-reservation-1')
  assert.equal(reservation.pendingCents, 0)
  assert.deepEqual(unpaid.items.map(({ id }) => id), ['detail-delivery-order'])
})


test('Task 7: reporting uses received_date over paid_at for receipts, split methods and tenant isolation',async t=>{
  const {createReportingRepository}=await import('./repository.js')
  const {db,sqlite,close}=createSettingsDb();t.after(close)
  sqlite.exec(`
    INSERT INTO businesses(id,slug,name,created_at,updated_at) VALUES
      ('a','a','A','2026-10-01','2026-10-01'),('b','b','B','2026-10-01','2026-10-01');
    INSERT INTO orders(id,business_id,order_number,client_name_snapshot,order_date,type,status,subtotal_cents,total_cents,created_at) VALUES
      ('oa','a',1,'Ana','2026-10-17','Entrega','Finalizado',10000,10000,'2026-10-17T15:00:00Z');
    INSERT INTO payment_receipts(id,business_id,total_cents,paid_at,received_date,created_at) VALUES
      ('backdated','a',10000,'2026-10-17T15:00:00Z','2026-10-15','2026-10-17T15:00:00Z'),
      ('other-company','b',9000,'2026-10-17T15:00:00Z','2026-10-15','2026-10-17T15:00:00Z'),
      ('current','a',2500,'2026-10-17T15:00:00Z','2026-10-17','2026-10-17T15:00:00Z');
    INSERT INTO payment_allocations(id,business_id,receipt_id,method_code,method_label,amount_cents,created_at) VALUES
      ('split-pix','a','backdated',NULL,'Pix',7000,'2026-10-17T15:00:00Z'),
      ('split-cash','a','backdated',NULL,'Dinheiro',3000,'2026-10-17T15:00:00Z'),
      ('current-pix','a','current',NULL,'Pix',2500,'2026-10-17T15:00:00Z'),
      ('other-pix','b','other-company',NULL,'Pix',9000,'2026-10-17T15:00:00Z');
    INSERT INTO movements(id,business_id,type,category,description,value_cents,source,movement_date,created_at) VALUES
      ('refund','a','saida','refunds','Estorno',500,'order-refund','2026-10-15','2026-10-17T15:00:00Z'),
      ('manual','a','saida','other','Manual',1000,'manual','2026-10-15','2026-10-17T15:00:00Z');
  `)
  const repo=createReportingRepository(db),retro={from:'2026-10-15',to:'2026-10-15'},today={from:'2026-10-17',to:'2026-10-17'}
  const overview=await repo.loadOverview('a',retro)
  assert.deepEqual(overview.receipts.map(r=>r.total_cents),[10000])
  assert.deepEqual(overview.refunds.map(r=>r.value_cents),[500])
  const sales=await repo.loadSales('a',retro)
  assert.deepEqual(sales.receipts.map(r=>[r.id,r.received_date,r.total_cents]),[['backdated','2026-10-15',10000]])
  assert.deepEqual(sales.allocations.map(a=>a.amount_cents).sort((a,b)=>a-b),[3000,7000])
  assert.deepEqual((await repo.loadSales('a',{...retro,paymentMethod:'Pix'})).receipts.map(r=>r.total_cents),[7000])
  assert.deepEqual((await repo.loadSales('a',{...retro,paymentMethod:'Pix'})).allocations.map(r=>r.amount_cents),[7000])
  assert.deepEqual((await repo.loadSales('a',today)).receipts.map(r=>r.id),['current'])
  assert.deepEqual((await repo.loadSales('b',retro)).receipts.map(r=>r.id),['other-company'])
  assert.deepEqual((await repo.loadSales('a',today)).orders.map(o=>o.id),['oa'])
})

test('Task 7: NULL legacy receipts use Sao Paulo historical DST without altering stored data',async t=>{
  const {createReportingRepository}=await import('./repository.js')
  const {db,sqlite,close}=createSettingsDb();t.after(close)
  sqlite.exec(`
    INSERT INTO businesses(id,slug,name,created_at,updated_at) VALUES ('a','a','A','2018-01-01','2018-01-01');
    INSERT INTO payment_receipts(id,business_id,total_cents,paid_at,created_at) VALUES
      ('before-midnight','a',400,'2018-12-01T01:59:59.000Z','2018-12-01T01:59:59.000Z'),
      ('midnight','a',600,'2018-12-01T02:00:00.000Z','2018-12-01T02:00:00.000Z'),
      ('after','a',800,'2018-12-02T01:59:59.000Z','2018-12-02T01:59:59.000Z'),
      ('next','a',1000,'2018-12-02T02:00:00.000Z','2018-12-02T02:00:00.000Z');
  `)
  const repo=createReportingRepository(db),query={from:'2018-12-01',to:'2018-12-01'}
  assert.deepEqual((await repo.loadOverview('a',query)).receipts.map(x=>x.total_cents),[600,800])
  const sales=await repo.loadSales('a',query)
  assert.deepEqual(sales.receipts.map(x=>x.id).sort(),['after','midnight'])
  assert.deepEqual(sales.receipts.map(x=>x.received_date ?? null),[null,null])
  assert.equal(sqlite.prepare("SELECT count(*) n FROM payment_receipts WHERE received_date IS NOT NULL").get().n,0)
})

test('Task 7: 100 orders linked to one dated receipt never multiply received totals',async t=>{
  const {createReportingRepository}=await import('./repository.js')
  const {db,sqlite,close}=createSettingsDb();t.after(close)
  sqlite.exec("INSERT INTO businesses(id,slug,name,created_at,updated_at) VALUES('a','a','A','2026-10-01','2026-10-01')")
  sqlite.exec("INSERT INTO payment_receipts(id,business_id,total_cents,paid_at,received_date,created_at) VALUES('shared','a',10000,'2026-10-17T15:00:00Z','2026-10-15','2026-10-17T15:00:00Z')")
  sqlite.exec("INSERT INTO payment_allocations(id,business_id,receipt_id,method_code,method_label,amount_cents,created_at) VALUES('alloc','a','shared',NULL,'Pix',10000,'2026-10-17T15:00:00Z')")
  const order=sqlite.prepare("INSERT INTO orders(id,business_id,order_number,client_name_snapshot,order_date,type,status,subtotal_cents,total_cents,created_at) VALUES(?,'a',?,'Ana','2026-10-17','Entrega','Finalizado',100,100,'2026-10-17T15:00:00Z')")
  const pay=sqlite.prepare("INSERT INTO payments(id,business_id,order_id,receipt_id,amount_cents,paid_at,created_at) VALUES(?,'a',?,'shared',100,'2026-10-17T15:00:00Z','2026-10-17T15:00:00Z')")
  for(let i=1;i<=100;i++){order.run('order-'+i,i);pay.run('payment-'+i,'order-'+i)}
  const repo=createReportingRepository(db),query={from:'2026-10-15',to:'2026-10-15'}
  assert.deepEqual((await repo.loadOverview('a',query)).receipts.map(x=>x.total_cents),[10000])
  assert.deepEqual((await repo.loadSales('a',query)).receipts.map(x=>x.total_cents),[10000])
  assert.deepEqual((await repo.loadSales('a',query)).allocations.map(x=>x.amount_cents),[10000])
})


test('Task 7: report period lookup remains indexable with 10k receipts and no duplicated financial value',async t=>{
  const {createReportingRepository}=await import('./repository.js')
  const {db,sqlite,close}=createSettingsDb();t.after(close)
  sqlite.exec("INSERT INTO businesses(id,slug,name,created_at,updated_at) VALUES('a','a','A','2020-01-01','2020-01-01')")
  const insert=sqlite.prepare("INSERT INTO payment_receipts(id,business_id,total_cents,paid_at,received_date,created_at) VALUES(?,'a',100,?,?,?)")
  for(let i=0;i<10000;i++){
    const at='2020-01-01T15:00:00.000Z'
    insert.run('historic-'+i,at,i%2===0?'2020-01-01':null,at)
  }
  insert.run('target','2026-10-17T15:00:00.000Z','2026-10-15','2026-10-17T15:00:00.000Z')
  const details=[],prepare=db.prepare
  db.prepare=sql=>({bind:(...values)=>{
    if(sql.includes('period_receipts')){
      details.push(...sqlite.prepare('EXPLAIN QUERY PLAN '+sql).all(...values).map(row=>row.detail))
    }
    return prepare(sql).bind(...values)
  }})
  const repo=createReportingRepository(db)
  const query={from:'2026-10-15',to:'2026-10-15'}
  assert.deepEqual((await repo.loadOverview('a',query)).receipts.map(r=>r.total_cents),[100])
  assert.deepEqual((await repo.loadSales('a',query)).receipts.map(r=>r.total_cents),[100])
  assert.ok(details.some(d=>d.includes('payment_receipts_business_received_date_idx')),details.join('\n'))
  assert.ok(details.some(d=>d.includes('payment_receipts_business_paid_idx')),details.join('\n'))
  assert.ok(!details.some(d=>/SCAN payment_receipts(?:\b|$)/i.test(d)),details.join('\n'))
})


test('Task 8: reporting detail retains effective financial day per original and supplemental receipt while ordering by registration',async t=>{
  const {createReportingRepository}=await import('./repository.js')
  const {db,sqlite,close}=createSettingsDb();t.after(close)
  sqlite.exec(`
    INSERT INTO businesses(id,slug,name,created_at,updated_at) VALUES('r8','r8','R8','2026-10-01','2026-10-01');
    INSERT INTO orders(id,business_id,order_number,client_name_snapshot,type,order_date,status,subtotal_cents,total_cents,created_at)
      VALUES('order-r8','r8',8,'Ana','Entrega','2026-10-17','Finalizado',9500,9500,'2026-10-17T09:00:00Z');
    INSERT INTO payment_receipts(id,business_id,total_cents,paid_at,received_date,created_at) VALUES
      ('original-r8','r8',8000,'2026-10-17T10:00:00Z','2026-10-14','2026-10-17T10:00:00Z'),
      ('extra-r8','r8',1500,'2026-10-17T12:00:00Z','2026-10-15','2026-10-17T12:00:00Z');
    INSERT INTO payment_allocations(id,business_id,receipt_id,method_label,amount_cents,created_at) VALUES
      ('original-pix','r8','original-r8','Pix',8000,'2026-10-17T10:00:00Z'),
      ('extra-pix','r8','extra-r8','Pix',1000,'2026-10-17T12:00:00Z'),
      ('extra-cash','r8','extra-r8','Dinheiro',500,'2026-10-17T12:00:00Z');
    INSERT INTO payments(id,business_id,order_id,receipt_id,amount_cents,paid_at,created_at) VALUES
      ('payment-r8','r8','order-r8','original-r8',8000,'2026-10-17T10:00:00Z','2026-10-17T10:00:00Z');
    INSERT INTO order_settlement_entries(id,business_id,order_id,kind,amount_cents,receipt_id,mutation_id,created_at) VALUES
      ('supp-r8','r8','order-r8','supplemental_payment',1500,'extra-r8','supp-r8','2026-10-17T12:00:00Z');
  `)
  const repo=createReportingRepository(db)
  const result=await repo.getOrderDetail('r8','order-r8')
  assert.deepEqual(result.paymentAllocations.map(x=>[x.receipt_id,x.received_date,x.paid_at,x.amount_cents]),[
    ['original-r8','2026-10-14','2026-10-17T10:00:00Z',8000],
    ['extra-r8','2026-10-15','2026-10-17T12:00:00Z',1000],
    ['extra-r8','2026-10-15','2026-10-17T12:00:00Z',500],
  ])
  assert.equal(result.grossReceivedCents,9500)
  assert.equal((await repo.getOrderDetail('r8','absent')),null)
  assert.equal((await repo.getOrderDetail('amor-e-sabor','order-r8')),null)
})
