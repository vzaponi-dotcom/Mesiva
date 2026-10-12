// Task 10 RED boundary: deliberately unimplemented until transaction tests fail.
export async function registerOrderSupplementalPayment() {
  throw Object.assign(new Error('Supplemental payment not implemented'), {
    status: 501,
    code: 'ORDER_SUPPLEMENTAL_NOT_IMPLEMENTED',
  })
}
