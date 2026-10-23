import test from 'node:test'
import assert from 'node:assert/strict'
import { loadBootstrap } from './repositories.js'
import { createSettingsDb } from './test-support/settingsDb.js'

test('bootstrap exposes active finance movements, allocation evidence and opening settings', async t => {
  const f=createSettingsDb();t.after(f.close)
  f.sqlite.exec(`
    INSERT INTO businesses(id,slug,name,created_at,updated_at) VALUES('biz','biz','Delivery','2026-09-01','2026-09-01');
    INSERT INTO finance_settings(business_id,opening_balance_cents,opening_date,created_at,updated_at)
      VALUES('biz',15000,'2026-09-01','created','updated');
    INSERT INTO payment_receipts(id,business_id,total_cents,paid_at,received_date,created_at)
      VALUES('receipt','biz',1000,'2026-09-03','2026-09-03','2026-09-03');
    INSERT INTO payment_allocations(id,business_id,receipt_id,method_label,amount_cents,created_at)
      VALUES('allocation','biz','receipt','Pix',1000,'2026-09-03');
    INSERT INTO movements(id,business_id,type,category,description,value_cents,source,movement_date,created_at,receipt_id,payment_allocation_id)
      VALUES('sale','biz','entrada','Vendas','Venda',1000,'order-payment','2026-09-03','2026-09-03','receipt','allocation');
    INSERT INTO movements(id,business_id,type,category,description,value_cents,source,movement_date,created_at)
      VALUES('refund','biz','saida','Estornos','Estorno',500,'order-refund','2026-09-03','2026-09-03');
    INSERT INTO movements(id,business_id,type,category,description,value_cents,source,movement_date,created_at,deleted_at)
      VALUES('deleted','biz','entrada','other_income','Deleted',500,'manual','2026-09-03','2026-09-03','2026-09-04');
  `)
  const result = await loadBootstrap(f.db, 'biz')
  assert.equal(result.movements.find((m) => m.id === 'sale').paymentMethod, 'Pix')
  assert.equal(result.movements.find((m) => m.id === 'refund').paymentMethod, null)
  assert.deepEqual(result.movements.map(m=>m.id).sort(),['refund','sale'])
  assert.deepEqual(result.financeSettings, { openingBalance: 150, openingDate: '2026-09-01', createdAt: 'created', updatedAt: 'updated' })
})
