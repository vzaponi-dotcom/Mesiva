import test from 'node:test'
import assert from 'node:assert/strict'

test('export model reuses official detail rows, selected columns and report summary', async () => {
  const { createExportModel } = await import('./exportModel.js')
  const query = { view: 'sales', period: 'custom', from: '2026-09-01', to: '2026-09-10' }
  const model = createExportModel({ query, report: { data: { salesCents: 1234 }, quality: { count: 1 } },
    detail: { total: 1, items: [{ order_number: 1, total_cents: 1234 }] }, columns: ['order_number', 'total_cents'],
    operation: { id: 'business-a', name: 'Amor & Sabor', slug: 'amor-sabor' }, generatedAt: '2026-09-10T12:00:00Z' })
  assert.deepEqual(model.columns, ['Pedido', 'Total'])
  assert.deepEqual(model.rows, [[1, 1234]])
  assert.equal(model.summary.salesCents, 1234)
  assert.deepEqual(model.operation, { id: 'business-a', name: 'Amor & Sabor', slug: 'amor-sabor' })
  assert.equal(model.filters.from, '2026-09-01')
  assert.equal(model.timezone, 'America/Sao_Paulo')
})

test('export accepts exactly 10,000 rows and explicitly rejects 10,001 without truncation', async () => {
  const { createExportModel } = await import('./exportModel.js')
  const base = { query: { view: 'detail', from: '2026-09-01', to: '2026-09-30' }, report: { data: {} }, columns: ['order_number'] }
  const items = Array.from({ length: 10_000 }, (_, index) => ({ order_number: index + 1 }))
  assert.equal(createExportModel({ ...base, detail: { total: 10_000, items } }).rows.length, 10_000)
  assert.throws(() => createExportModel({ ...base, detail: { total: 10_001, items } }), { status: 422, code: 'REPORTING_EXPORT_LIMIT' })
})


test('export model preserves a stable reference for orders without order_number', async () => {
  const { createExportModel } = await import('./exportModel.js')
  const model = createExportModel({
    query: { view: 'detail', from: '2026-09-01', to: '2026-09-25' },
    report: { data: {} },
    detail: {
      total: 1,
      items: [{ id: 'f9a1cb3b-d4fb-405f-b3ad-ca7027fa92a3', order_number: null }],
    },
    columns: ['order_number'],
  })
  assert.deepEqual(model.rows, [['Sem nº · f9a1cb3b']])
})


test('default data export is one detailed row per order with customer, modality and payment context', async () => {
  const { createExportModel, REPORTING_DATA_EXPORT_COLUMNS } = await import('./exportModel.js')
  const model = createExportModel({
    query: { view: 'overview', period: 'custom', from: '2026-09-01', to: '2026-09-30' },
    report: { data: { metrics: {} } },
    detail: {
      total: 1,
      items: [{
        id: 'o1',
        order_number: 42,
        order_date: '2026-09-10',
        created_at: '2026-09-10T15:30:00Z',
        client_name_snapshot: 'Ana',
        client_phone_snapshot: '11999999999',
        type: 'Entrega',
        scheduled_for: '2026-09-10T16:00:00Z',
        status: 'Finalizado',
        subtotal_cents: 9000,
        delivery_fee_cents: 1000,
        adjustment_type: 'discount',
        adjustment_amount_cents: 500,
        total_cents: 9500,
        paidCents: 9500,
        pendingCents: 0,
        payment_label: 'Pix,Dinheiro',
        promised_payment_date: null,
        durationMinutes: 35,
        onTime: true,
      }],
    },
  })

  assert.deepEqual(model.columnKeys, REPORTING_DATA_EXPORT_COLUMNS)
  assert.equal(model.rowCount, 1)
  const row = Object.fromEntries(model.columnKeys.map((key, index) => [key, model.rows[0][index]]))
  assert.equal(row.order_number, 42)
  assert.equal(row.client_name_snapshot, 'Ana')
  assert.equal(row.client_phone_snapshot, '11999999999')
  assert.equal(row.type, 'Entrega')
  assert.equal(row.scheduleLabel, 'Agendado')
  assert.equal(row.adjustment_type, 'Desconto')
  assert.equal(row.paymentState, 'Pago')
  assert.equal(row.payment_label, 'Pix + Dinheiro')
  assert.equal(row.durationMinutes, 35)
  assert.equal(row.onTime, true)
})


test('Task 8: exported order rows include explicit financial receipt dates without modifying commercial date and unpaid rows',async()=>{
  const {createExportModel}=await import('./exportModel.js')
  const model=createExportModel({
    query:{view:'detail',from:'2026-10-14',to:'2026-10-17'},
    report:{data:{}},
    detail:{total:2,items:[
      {order_number:7,order_date:'2026-10-17',payment_received_dates:'2026-10-14 + 2026-10-15',paidCents:9500},
      {order_number:8,order_date:'2026-10-17',payment_received_dates:null,paidCents:0},
    ]},
    columns:['order_number','order_date','payment_received_dates','paidCents'],
  })
  assert.deepEqual(model.columns,['Pedido','Data','Data(s) do recebimento','Recebido'])
  assert.deepEqual(model.rows,[[7,'2026-10-17','2026-10-14 + 2026-10-15',9500],[8,'2026-10-17',null,0]])
})
