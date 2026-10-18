import test from 'node:test'
import assert from 'node:assert/strict'
import {
  calculateCurrentBalance,
  calculateReceivedToday,
  filterFinanceHistory,
  filterMovementsByPeriod,
  getFinancePeriodRange,
  hasFinanceSecondaryFilters,
  summarizeFinancePeriod,
} from './cashFlow.js'

test('today, 7d, 30d and custom finance ranges are inclusive', () => {
  assert.deepEqual(getFinancePeriodRange({ key: 'today' }, '2026-09-03'), { startDate: '2026-09-03', endDate: '2026-09-03' })
  assert.deepEqual(getFinancePeriodRange({ key: '7d' }, '2026-09-03'), { startDate: '2026-08-28', endDate: '2026-09-03' })
  assert.deepEqual(getFinancePeriodRange({ key: '30d' }, '2026-09-03'), { startDate: '2026-08-05', endDate: '2026-09-03' })
  assert.deepEqual(getFinancePeriodRange({ key: 'custom', startDate: '2026-08-10', endDate: '2026-08-12' }, '2026-09-03'), { startDate: '2026-08-10', endDate: '2026-08-12' })
})

test('period summary and current balance ignore deleted rows and respect opening date', () => {
  const movements = [
    { id: 'before', type: 'entrada', value: 100, movementDate: '2026-08-31' },
    { id: 'open', type: 'entrada', value: 50, movementDate: '2026-09-01' },
    { id: 'exit', type: 'saida', value: 20, movementDate: '2026-09-02' },
    { id: 'deleted', type: 'entrada', value: 999, movementDate: '2026-09-02', deletedAt: '2026-09-03T12:00:00.000Z' },
  ]

  const range = { startDate: '2026-09-01', endDate: '2026-09-03' }
  assert.deepEqual(filterMovementsByPeriod(movements, range).map((item) => item.id), ['open', 'exit'])
  assert.deepEqual(summarizeFinancePeriod(movements, range), { entries: 50, exits: 20, result: 30 })
  assert.equal(calculateCurrentBalance(movements, { openingBalance: 200, openingDate: '2026-09-01' }), 230)
  assert.equal(calculateCurrentBalance(movements, null), null)
})

test('history filters combine search, type, normalized category and payment method', () => {
  const movements = [
    { id: 'm-packaging', type: 'saida', category: 'packaging', description: 'Compra de embalagem kraft', value: 25, paymentMethod: 'Pix', movementDate: '2026-09-03' },
    { id: 'm-supplies', type: 'saida', category: 'Insumos', description: 'Arroz', value: 40, paymentMethod: null, movementDate: '2026-09-03' },
    { id: 'm-income', type: 'entrada', category: 'Aporte', description: 'Reforço de caixa', value: 100, paymentMethod: 'Dinheiro', movementDate: '2026-09-03' },
  ]

  assert.deepEqual(filterFinanceHistory(movements, {
    search: 'embalagem', type: 'saida', category: 'packaging', paymentMethod: 'Pix',
  }).map((item) => item.id), ['m-packaging'])

  assert.deepEqual(filterFinanceHistory(movements, {
    search: '', type: 'saida', category: 'supplies', paymentMethod: '__missing__',
  }).map((item) => item.id), ['m-supplies'])
})

test('secondary filter detection ignores an empty filter set', () => {
  assert.equal(hasFinanceSecondaryFilters({ search: '', type: '', category: '', paymentMethod: '' }), false)
  assert.equal(hasFinanceSecondaryFilters({ search: 'arroz', type: '', category: '', paymentMethod: '' }), true)
  assert.equal(hasFinanceSecondaryFilters({ search: '', type: 'saida', category: '', paymentMethod: '' }), true)
})

test('received today is net payments minus same-day refunds', () => {
  const movements = [
    { type: 'entrada', source: 'order-payment', value: 100, movementDate: '2026-09-18', createdAt: '2026-09-18T10:00:00.000Z' },
    { type: 'saida', source: 'order-refund', value: 30, movementDate: '2026-09-18', createdAt: '2026-09-18T11:00:00.000Z' },
    { type: 'entrada', source: 'manual', value: 999, createdAt: '2026-09-18T12:00:00.000Z' },
  ]
  assert.equal(calculateReceivedToday(movements, '2026-09-18'), 70)
})


test('Task 7: received today respects movement_date, not createdAt, while preserving refund policy',()=>{
  const movements=[
    {type:'entrada',source:'order-payment',value:100,movementDate:'2026-10-15',createdAt:'2026-10-17T15:00:00Z'},
    {type:'saida',source:'order-refund',value:10,movementDate:'2026-10-15',createdAt:'2026-10-17T15:00:00Z'},
    {type:'entrada',source:'order-payment',value:50,movementDate:'2026-10-17',createdAt:'2026-10-17T15:00:00Z'},
    {type:'saida',source:'order-edit-refund',value:20,movementDate:'2026-10-17',createdAt:'2026-10-17T15:00:00Z'},
    {type:'entrada',source:'manual',value:999,movementDate:'2026-10-17',createdAt:'2026-10-17T15:00:00Z'},
    {type:'entrada',source:'order-payment',value:30,movementDate:'2026-10-17',createdAt:'2026-10-17T15:00:00Z',deletedAt:'2026-10-17T16:00:00Z'},
  ]
  assert.equal(calculateReceivedToday(movements,'2026-10-15'),90)
  assert.equal(calculateReceivedToday(movements,'2026-10-17'),50)
})
