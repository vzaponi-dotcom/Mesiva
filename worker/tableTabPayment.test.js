import test from 'node:test'
import assert from 'node:assert/strict'
import { registerTableTabPayment } from './paymentRepository.js'
import { listTables } from './tableRepository.js'
import { OperationalDb } from './test-support/operationalDb.js'

const BUSINESS = 'amor-e-sabor'
const NOW = new Date('2026-09-12T19:00:00.000Z')
const ISO = '2026-09-12T18:00:00.000Z'
const pix = [{ methodCode: 'pix', amountCents: 2500 }]

class TableTabPaymentDb extends OperationalDb {
  constructor({ status = 'open', tableId = 'table-1', withOrder = true } = {}) {
    super({ businesses: ['other-business'] })
    this.sqlite.exec(`
      INSERT INTO tables (id, business_id, name, name_key, sort_order, is_active, created_at, updated_at) VALUES
        ('table-1', '${BUSINESS}', 'Mesa 1', 'mesa 1', 1, 1, '${ISO}', '${ISO}'),
        ('table-2', '${BUSINESS}', 'Mesa 2', 'mesa 2', 2, 1, '${ISO}', '${ISO}');
      INSERT INTO table_tabs (
        id, business_id, table_id, table_identifier, tab_number, status,
        opened_at, closed_at, created_at, updated_at
      ) VALUES (
        'tab-1', '${BUSINESS}', '${tableId}', '${tableId === 'table-2' ? 'Mesa 2' : 'Mesa 1'}',
        37, '${status}', '${ISO}', ${status === 'closed' ? `'${ISO}'` : 'NULL'}, '${ISO}', '${ISO}'
      );
    `)
    if (withOrder) {
      this.sqlite.prepare(`INSERT INTO orders (
        id, business_id, client_id, client_name_snapshot, client_phone_snapshot,
        client_address_snapshot, customer_identity_type, table_tab_id, type,
        order_date, status, scheduled_for, promised_payment_date, is_backdated,
        subtotal_cents, delivery_fee_cents, adjustment_type, adjustment_mode,
        adjustment_value, adjustment_amount_cents, adjustment_reason, total_cents,
        created_at, finished_at, cancelled_at, cancel_reason, cancel_reason_note,
        idempotency_key, order_number
      ) VALUES (
        'order-1', ?, NULL, ?, '', '', 'table', 'tab-1', 'Local',
        '2026-09-12', 'Em preparo', NULL, NULL, 0, 2500, 0, 'none', 'fixed',
        0, 0, '', 2500, ?, NULL, NULL, NULL, NULL, 'table-pay-1', 1
      )`).run(BUSINESS, tableId === 'table-2' ? 'Mesa 2' : 'Mesa 1', ISO)
    }
  }
}

test('table-tab payment enforces business scope and closed-tab retry safety', async () => {
  const db = new TableTabPaymentDb()

  await assert.rejects(
    registerTableTabPayment(db, 'other-business', 'tab-1', pix, NOW),
    { status: 404, code: 'TABLE_TAB_NOT_FOUND' },
  )

  const closedDb = new TableTabPaymentDb({ status: 'closed', withOrder: false })
  await assert.rejects(
    registerTableTabPayment(closedDb, BUSINESS, 'tab-1', pix, NOW),
    { status: 409, code: 'TABLE_TAB_ALREADY_CLOSED' },
  )
})

test('table-tab payment keeps the transferred tab id and releases the destination table', async () => {
  const db = new TableTabPaymentDb({ tableId: 'table-2' })

  const result = await registerTableTabPayment(db, BUSINESS, 'tab-1', pix, NOW)

  assert.equal(result.tableTab.id, 'tab-1')
  assert.equal(result.tableTab.tableId, 'table-2')
  assert.equal(result.tableTab.tabNumber, 37)
  assert.equal(result.tableTab.status, 'closed')
  assert.equal((await listTables(db, BUSINESS)).find((table) => table.id === 'table-2').occupancy, 'free')
  assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM table_tabs WHERE status = 'open'").get().n, 0)
})

test('table-tab payment detects a concurrent close without leaving financial effects', async () => {
  const db = new TableTabPaymentDb()
  const batch = db.batch.bind(db)
  db.batch = async (statements) => {
    db.sqlite.prepare("UPDATE table_tabs SET status = 'closed', closed_at = ?, updated_at = ? WHERE id = 'tab-1' AND status = 'open'")
      .run(ISO, ISO)
    return batch(statements)
  }

  await assert.rejects(
    registerTableTabPayment(db, BUSINESS, 'tab-1', pix, NOW),
    { status: 409, code: 'TABLE_TAB_PAYMENT_CONFLICT' },
  )
  assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM payments").get().n, 0)
  assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM payment_receipts").get().n, 0)
  assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM payment_allocations").get().n, 0)
  assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM movements WHERE source = 'order-payment'").get().n, 0)
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM settings_tx_assertions').get().n, 0)
})

test('table-tab payment closes normally, returns one receipt and clears its policy assertion', async () => {
  const db = new TableTabPaymentDb()

  const result = await registerTableTabPayment(db, BUSINESS, 'tab-1', pix, NOW)

  assert.equal(result.receipt.totalCents, 2500)
  assert.equal(result.receipt.tableTabId, 'tab-1')
  assert.equal(result.payments.length, 1)
  assert.equal(result.movements.length, 1)
  assert.equal(result.tableTab.status, 'closed')
  assert.equal(db.sqlite.prepare("SELECT status FROM table_tabs WHERE id = 'tab-1'").get().status, 'closed')
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM settings_tx_assertions').get().n, 0)
})

test('table-tab payment rejects an open tab without payable orders', async () => {
  const db = new TableTabPaymentDb({ withOrder: false })

  await assert.rejects(
    registerTableTabPayment(db, BUSINESS, 'tab-1', pix, NOW),
    { status: 409, code: 'TABLE_TAB_NOT_PAYABLE' },
  )
  assert.equal(db.sqlite.prepare("SELECT status FROM table_tabs WHERE id = 'tab-1'").get().status, 'open')
})

test('Task 12 table-tab payment aborts on an edit revision even when the total is unchanged', async () => {
  const db = new TableTabPaymentDb()
  const batch = db.batch.bind(db)
  db.batch = async statements => {
    db.sqlite.prepare("UPDATE orders SET content_revision = content_revision + 1 WHERE id = 'order-1'").run()
    return batch(statements)
  }
  await assert.rejects(registerTableTabPayment(db,BUSINESS,'tab-1',pix,NOW),
    {status:409,code:'TABLE_TAB_PAYMENT_CONFLICT'})
  assert.equal(db.sqlite.prepare("SELECT count(*) n FROM payments").get().n,0)
  assert.equal(db.sqlite.prepare("SELECT count(*) n FROM movements").get().n,0)
  assert.equal(db.sqlite.prepare("SELECT status FROM table_tabs WHERE id='tab-1'").get().status,'open')
})

test('Task 12 edited open-tab totals are authoritative without extra occupation changes', async () => {
  const db = new TableTabPaymentDb()
  db.sqlite.prepare("UPDATE orders SET total_cents=3500,subtotal_cents=3500,content_revision=1 WHERE id='order-1'").run()
  const result = await registerTableTabPayment(db,BUSINESS,'tab-1',[{methodCode:'pix',amountCents:3500}],NOW)
  assert.equal(result.receipt.totalCents,3500)
  assert.equal(result.payments.length,1)
  assert.equal(result.tableTab.status,'closed')
  assert.equal((await listTables(db,BUSINESS)).find(table=>table.id==='table-1').occupancy,'free')
  assert.equal(db.sqlite.prepare("SELECT count(*) n FROM payments WHERE order_id='order-1'").get().n,1)
})

test('Task 12 standalone payment cannot bypass an open table tab', async () => {
  const db = new TableTabPaymentDb()
  const { registerOrderPayment } = await import('./paymentRepository.js')
  await assert.rejects(registerOrderPayment(db,BUSINESS,'order-1',pix,NOW),
    {status:409,code:'TABLE_TAB_PAYMENT_REQUIRED'})
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM payments').get().n,0)
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM payment_receipts').get().n,0)
})


test('table-tab settlement dates one shared mixed receipt for all orders without changing close time', async () => {
  const db = new TableTabPaymentDb()
  db.sqlite.prepare("INSERT INTO orders(id,business_id,client_name_snapshot,customer_identity_type,table_tab_id,type,order_date,status,subtotal_cents,total_cents,created_at) VALUES('order-2',?,'Mesa 1','table','tab-1','Local','2026-09-12','Em preparo',1500,1500,?)").run(BUSINESS,ISO)
  const registeredAt = NOW.toISOString()
  const result = await registerTableTabPayment(db, BUSINESS, 'tab-1', [
    { methodCode: 'pix', amountCents: 2500 }, { methodCode: 'cash', amountCents: 1500 },
  ], NOW, { receivedDate: '2026-09-10' })
  assert.equal(result.receipt.receivedDate,'2026-09-10')
  assert.equal(result.payments.length,2)
  assert.equal(db.sqlite.prepare('SELECT received_date FROM payment_receipts WHERE id=?').get(result.receipt.id).received_date,'2026-09-10')
  assert.deepEqual(db.sqlite.prepare("SELECT movement_date FROM movements WHERE receipt_id=? AND source='order-payment'").all(result.receipt.id).map(x=>x.movement_date),['2026-09-10','2026-09-10'])
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM payment_receipts').get().n,1)
  assert.equal(db.sqlite.prepare('SELECT SUM(value_cents) n FROM movements WHERE receipt_id=?').get(result.receipt.id).n,4000)
  assert.equal(db.sqlite.prepare("SELECT closed_at FROM table_tabs WHERE id='tab-1'").get().closed_at, registeredAt)
  assert.equal(db.sqlite.prepare('SELECT paid_at FROM payment_receipts WHERE id=?').get(result.receipt.id).paid_at,registeredAt)
})

test('table-tab future receipt date rejects atomically and preserves open tab', async () => {
  const db=new TableTabPaymentDb()
  await assert.rejects(registerTableTabPayment(db,BUSINESS,'tab-1',pix,NOW,{receivedDate:'2026-09-13'}),
    {status:400,code:'VALIDATION_ERROR',field:'receivedDate'})
  assert.equal(db.sqlite.prepare("SELECT status FROM table_tabs WHERE id='tab-1'").get().status,'open')
  for(const table of ['payment_receipts','payment_allocations','payments','movements'])
    assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM '+table).get().n,0)
})
