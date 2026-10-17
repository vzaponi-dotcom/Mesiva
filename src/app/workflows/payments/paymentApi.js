import { apiRequest, withJson } from '../../../infrastructure/api/httpClient.js'

export const createPaymentApi = ({ request = apiRequest, json = withJson } = {}) => Object.freeze({
  registerOrderPayment: (id, allocations, { receivedDate } = {}) => request(
    `/api/orders/${encodeURIComponent(id)}/payment`,
    json('POST', { allocations, ...(receivedDate !== undefined ? { receivedDate } : {}) }),
  ),
  registerSupplementalPayment: (id, payload) => request(
    `/api/orders/${encodeURIComponent(id)}/supplemental-payment`,
    json('POST',payload),
  ),
  registerTableTabPayment: (id, allocations, {receivedDate} = {}) => request(
    `/api/table-tabs/${encodeURIComponent(id)}/payment`,
    json('POST', { allocations, ...(receivedDate !== undefined ? {receivedDate} : {}) }),
  ),
  registerClientOrdersPayment: (clientId, orderIds, allocations, {mutationId,receivedDate} = {}) => request(
    `/api/clients/${encodeURIComponent(clientId)}/receivables/payment`,
    json('POST', { orderIds, allocations, ...(mutationId?{mutationId}:{}), ...(receivedDate!==undefined?{receivedDate}:{}) }),
  ),
})

export const paymentApi = createPaymentApi()
