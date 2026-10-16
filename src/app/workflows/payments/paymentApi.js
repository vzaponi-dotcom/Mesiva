import { apiRequest, withJson } from '../../../infrastructure/api/httpClient.js'

export const createPaymentApi = ({ request = apiRequest, json = withJson } = {}) => Object.freeze({
  registerOrderPayment: (id, allocations) => request(
    `/api/orders/${encodeURIComponent(id)}/payment`,
    json('POST', { allocations }),
  ),
  registerSupplementalPayment: (id, payload) => request(
    `/api/orders/${encodeURIComponent(id)}/supplemental-payment`,
    json('POST',payload),
  ),
  registerTableTabPayment: (id, allocations) => request(
    `/api/table-tabs/${encodeURIComponent(id)}/payment`,
    json('POST', { allocations }),
  ),
  registerClientOrdersPayment: (clientId, orderIds, allocations, {mutationId} = {}) => request(
    `/api/clients/${encodeURIComponent(clientId)}/receivables/payment`,
    json('POST', { orderIds, allocations, ...(mutationId?{mutationId}:{}) }),
  ),
})

export const paymentApi = createPaymentApi()
