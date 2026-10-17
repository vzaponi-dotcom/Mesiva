import test from 'node:test'
import assert from 'node:assert/strict'
import {
  addPaymentAllocation,
  createInitialPaymentComposition,
  paymentOptionsForAllocation,
  removePaymentAllocation,
  summarizePaymentComposition,
  toPaymentAllocations,
  updatePaymentAllocation,
} from './paymentComposition.js'

const options = [
  { code: 'pix', value: 'Pix', label: 'Pix' },
  { code: 'cash', value: 'Dinheiro', label: 'Dinheiro' },
  { code: 'debit_card', value: 'Cartão de débito', label: 'Cartão de débito' },
]

test('composition starts with the effective default and the full amount', () => {
  assert.deepEqual(createInitialPaymentComposition({
    totalCents: 8000,
    defaultPaymentMethod: 'Dinheiro',
    paymentOptions: options,
  }), [{ methodCode: 'cash', amountCents: 8000 }])
})

test('adding a form autofills the exact remaining amount without redistributing existing rows', () => {
  const initial = [{ methodCode: 'cash', amountCents: 3000 }]
  assert.deepEqual(addPaymentAllocation(initial, 8000), [
    { methodCode: 'cash', amountCents: 3000 },
    { methodCode: '', amountCents: 5000 },
  ])

  assert.deepEqual(addPaymentAllocation([{ methodCode: 'cash', amountCents: 8000 }], 8000), [
    { methodCode: 'cash', amountCents: 8000 },
    { methodCode: '', amountCents: 0 },
  ])
})

test('composition calculates exact entered, remaining, overage and valid state in cents', () => {
  let allocations = addPaymentAllocation([{ methodCode: 'cash', amountCents: 8000 }], 8000)
  allocations = updatePaymentAllocation(allocations, 0, { amountCents: 3000 })
  allocations = updatePaymentAllocation(allocations, 1, { methodCode: 'pix', amountCents: 5000 })

  assert.deepEqual(summarizePaymentComposition(allocations, 8000, options), {
    totalCents: 8000,
    enteredCents: 8000,
    remainingCents: 0,
    overageCents: 0,
    hasDuplicateMethods: false,
    needsReview: false,
    valid: true,
  })
  assert.deepEqual(toPaymentAllocations(allocations, 8000, options), [
    { methodCode: 'cash', amountCents: 3000 },
    { methodCode: 'pix', amountCents: 5000 },
  ])

  const under = updatePaymentAllocation(allocations, 1, { amountCents: 4000 })
  assert.equal(summarizePaymentComposition(under, 8000, options).remainingCents, 1000)
  assert.equal(toPaymentAllocations(under, 8000, options), null)

  const over = updatePaymentAllocation(allocations, 1, { amountCents: 6000 })
  assert.equal(summarizePaymentComposition(over, 8000, options).overageCents, 1000)
  assert.equal(toPaymentAllocations(over, 8000, options), null)
})

test('duplicate, zero and newly inactive methods invalidate the composition', () => {
  const duplicate = [
    { methodCode: 'cash', amountCents: 3000 },
    { methodCode: 'cash', amountCents: 5000 },
  ]
  assert.equal(summarizePaymentComposition(duplicate, 8000, options).hasDuplicateMethods, true)
  assert.equal(summarizePaymentComposition(duplicate, 8000, options).valid, false)

  const zero = [
    { methodCode: 'cash', amountCents: 8000 },
    { methodCode: 'pix', amountCents: 0 },
  ]
  assert.equal(summarizePaymentComposition(zero, 8000, options).valid, false)

  const inactive = [
    { methodCode: 'cash', amountCents: 3000 },
    { methodCode: 'pix', amountCents: 5000 },
  ]
  const onlyCash = options.filter(({ code }) => code === 'cash')
  assert.equal(summarizePaymentComposition(inactive, 8000, onlyCash).needsReview, true)
  assert.equal(toPaymentAllocations(inactive, 8000, onlyCash), null)
})

test('available options hide methods used by other rows but retain the current selection', () => {
  const allocations = [
    { methodCode: 'cash', amountCents: 3000 },
    { methodCode: 'pix', amountCents: 5000 },
  ]
  assert.deepEqual(paymentOptionsForAllocation(options, allocations, 1).map(({ code }) => code), ['pix', 'debit_card'])
})

test('removing a row recalculates from the remaining immutable composition', () => {
  const allocations = [
    { methodCode: 'cash', amountCents: 3000 },
    { methodCode: 'pix', amountCents: 5000 },
  ]
  const remaining = removePaymentAllocation(allocations, 1)
  assert.deepEqual(remaining, [{ methodCode: 'cash', amountCents: 3000 }])
  assert.equal(summarizePaymentComposition(remaining, 8000, options).remainingCents, 5000)
})


test('Task 9: received date validates Sao Paulo calendar boundaries, empty and impossible dates', async () => {
  const { isValidReceivedDate } = await import('./paymentComposition.js')
  assert.equal(isValidReceivedDate('2026-10-15','2026-10-17'),true)
  assert.equal(isValidReceivedDate('2026-10-17','2026-10-17'),true)
  for(const invalid of ['','2026-10-18','2026-02-30','2026-1-1','2026-10-17T12:00:00Z',' 2026-10-15','2026-13-02',null]){
    assert.equal(isValidReceivedDate(invalid,'2026-10-17'),false,String(invalid))
  }
})
