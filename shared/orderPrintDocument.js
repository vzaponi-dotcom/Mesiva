export const ORDER_PRINT_DOCUMENT_VERSION = 1
export const ORDER_PRINT_THANK_YOU = 'Obrigado pela compra! Agradecemos a preferência.'

const nonNegativeInteger = (value) => Math.max(0, Math.round(Number(value) || 0))
const positiveQuantity = (value) => Math.max(1, Math.floor(Number(value) || 1))

export const formatPrintMoneyCents = (cents) => new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
}).format(nonNegativeInteger(cents) / 100)

export const formatOrderCustomerIdentity = ({ tableIdentifier, customerName } = {}) => {
  const table = String(tableIdentifier || '').trim()
  const customer = String(customerName || '').trim()
  if (table && customer && customer !== table && !customer.startsWith(`${table} ·`)) return `${table} · ${customer}`
  return table || customer || null
}

export const createOrderPrintDocument = (input = {}) => ({
  version: ORDER_PRINT_DOCUMENT_VERSION,
  type: 'order',
  business: {
    name: String(input.businessName || 'Estabelecimento'),
  },
  order: {
    id: String(input.orderId ?? ''),
    number: Number.isInteger(Number(input.orderNumber)) && Number(input.orderNumber) > 0 ? String(input.orderNumber) : '',
    orderDate: String(input.orderDate ?? ''),
    createdAt: String(input.createdAt ?? ''),
    type: String(input.type ?? ''),
    scheduledFor: String(input.scheduledFor ?? ''),
    scheduleLabel: ['AGENDADO', 'RESERVA'].includes(input.scheduleLabel) ? input.scheduleLabel : '',
  },
  customer: {
    name: formatOrderCustomerIdentity({
      tableIdentifier: input.customerIdentityType === 'table' ? input.tableIdentifier : '',
      customerName: input.customerIdentityType === 'table' && !input.hasOptionalClient ? '' : input.customer?.name,
    }) || '',
    phone: String(input.customer?.phone || ''),
    address: String(input.customer?.address || ''),
  },
  items: (Array.isArray(input.items) ? input.items : []).map((item) => {
    const quantity = positiveQuantity(item?.quantity)
    const unitPriceCents = nonNegativeInteger(item?.unitPriceCents)
    return {
      name: String(item?.name || ''),
      presentation: String(item?.presentation || ''),
      quantity,
      note: String(item?.note || ''),
      unitPriceCents,
      lineTotalCents: unitPriceCents * quantity,
    }
  }),
  financial: {
    subtotalCents: nonNegativeInteger(input.subtotalCents),
    deliveryFeeCents: nonNegativeInteger(input.deliveryFeeCents),
    adjustment: {
      type: input.adjustment?.type || 'none',
      amountCents: nonNegativeInteger(input.adjustment?.amountCents),
      reason: String(input.adjustment?.reason || ''),
    },
    totalCents: nonNegativeInteger(input.totalCents),
  },
  payment: {
    status: ['Pago','Parcialmente pago','Devolução pendente'].includes(input.payment?.status)
      ? input.payment.status : 'Pendente',
    method: String(input.payment?.method || ''),
  },
  message: ORDER_PRINT_THANK_YOU,
})

export const createTestPrintDocument = ({ businessName = 'Estabelecimento', createdAt = new Date().toISOString() } = {}) => ({
  version: ORDER_PRINT_DOCUMENT_VERSION,
  type: 'test',
  business: {
    name: String(businessName || 'Estabelecimento'),
  },
  test: {
    title: 'TESTE DE IMPRESSÃO',
    message: 'Impressora configurada com sucesso.',
    createdAt: String(createdAt),
  },
})
