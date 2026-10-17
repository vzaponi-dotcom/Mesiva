const allocationsOf = (allocations) => Array.isArray(allocations) ? allocations : []

export const hasMixedPayment = (allocations) => allocationsOf(allocations).length > 1

export const formatPaymentSummary = (allocations, fallback = '') => {
  const values = allocationsOf(allocations)
  if (values.length === 1) return values[0]?.methodLabel || fallback || 'Não informado'
  if (values.length > 1) return `${values.length} formas`
  return fallback || 'Não informado'
}

export const paymentSearchText = (allocations, fallback = '') => {
  const values = allocationsOf(allocations)
  if (!values.length) return String(fallback || '').toLowerCase()
  return values.flatMap((allocation) => [allocation?.methodLabel, allocation?.methodCode])
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}
