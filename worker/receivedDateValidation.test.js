import test from 'node:test'
import assert from 'node:assert/strict'
import * as validation from './paymentValidation.js'

const now = new Date('2026-10-17T15:00:00.000Z')
const resolve = (value, reference = now) => validation.resolveReceivedDate(value, reference)

const invalidReceivedDate = (value, reference = now) => assert.throws(
  () => resolve(value, reference),
  (error) => error?.status === 400 && error?.code === 'VALIDATION_ERROR'
    && error?.field === 'receivedDate',
)

test('receipt effective date uses the business day by default and accepts today or past dates', () => {
  assert.equal(resolve(undefined), '2026-10-17')
  assert.equal(resolve('2026-10-17'), '2026-10-17')
  assert.equal(resolve('2026-10-15'), '2026-10-15')
  assert.equal(resolve('2024-02-29'), '2024-02-29')
})

test('receipt effective date rejects future and invalid explicit values in the Worker', () => {
  for (const value of [
    '2026-10-18', '2026-10-17T12:00:00Z', '2026-02-30',
    '2025-02-29', '2026-13-01', '2026-00-01', '2026-10-17 ',
    '', null, 20261017, {}, false,
  ]) invalidReceivedDate(value)
})

test('receipt effective date uses São Paulo midnight rather than UTC date for validation and default', () => {
  const beforeMidnight = new Date('2026-10-17T02:59:59.000Z')
  const atMidnight = new Date('2026-10-17T03:00:00.000Z')
  assert.equal(resolve(undefined, beforeMidnight), '2026-10-16')
  assert.equal(resolve('2026-10-16', beforeMidnight), '2026-10-16')
  invalidReceivedDate('2026-10-17', beforeMidnight)
  assert.equal(resolve(undefined, atMidnight), '2026-10-17')
  assert.equal(resolve('2026-10-17', atMidnight), '2026-10-17')
})
