import {createSettingsDb} from './settingsDb.js'
import {seedOperationalReadFixture} from './operationalReadFixture.js'
export const businessId='amor-e-sabor',now=new Date('2026-10-15T17:00:00.000Z')
export const allReadGrants=new Set(['clients.view','orders.view','orders.history','finance.receivables','finance.overview','finance.movements'])
export async function financialReadFixture(t,count=115){
  const f=createSettingsDb();t.after(f.close)
  const ids=await seedOperationalReadFixture(f.db,{businessId,historicalOrders:count,activeOrders:3,itemsPerOrder:2})
  f.sqlite.exec("INSERT INTO clients(id,business_id,name,phone,address,created_at,updated_at) VALUES('customer-a','amor-e-sabor','João Fictício','11999998888','Rua A','2020','2020'),('customer-b','amor-e-sabor','Ana Fictícia','11911112222','Rua B','2020','2020'),('customer-empty','amor-e-sabor','Sem Compras','11933334444','','2020','2020')")
  f.sqlite.exec("UPDATE orders SET client_id='customer-a',customer_identity_type='registered_client',client_name_snapshot='João Fictício',order_date='2020-01-01',promised_payment_date='2020-01-02'; UPDATE order_items SET name_snapshot='Feijão Mineiro',category_snapshot='Refeições';")
  f.sqlite.prepare("UPDATE orders SET status='Cancelado' WHERE id=?").run(ids.historicalIds[0])
  f.sqlite.prepare("UPDATE orders SET client_id='customer-b',order_date='2030-01-01',promised_payment_date=NULL WHERE id=?").run(ids.activeIds[1])
  f.sqlite.prepare("UPDATE orders SET created_at='2026-10-15T03:00:00.000Z',order_date='2026-10-15',promised_payment_date=NULL WHERE id=?").run(ids.activeIds[0])
  pay(f.sqlite,ids.historicalIds[1]);pay(f.sqlite,ids.historicalIds[0])
  return {...f,ids}
}
export function pay(sqlite,orderId){
  const at=now.toISOString(),receipt='receipt-'+orderId
  const total=sqlite.prepare('SELECT total_cents FROM orders WHERE business_id=? AND id=?').get(businessId,orderId).total_cents
  sqlite.prepare('INSERT INTO payment_receipts(id,business_id,total_cents,paid_at,created_at) VALUES(?,?,?,?,?)').run(receipt,businessId,total,at,at)
  sqlite.prepare("INSERT INTO payment_allocations(id,business_id,receipt_id,method_label,amount_cents,created_at) VALUES(?,?,?,'Pix',?,?)").run('allocation-'+orderId,businessId,receipt,total,at)
  sqlite.prepare('INSERT INTO payments(id,business_id,order_id,receipt_id,amount_cents,paid_at,created_at) VALUES(?,?,?,?,?,?,?)').run('payment-'+orderId,businessId,orderId,receipt,total,at,at)
}
