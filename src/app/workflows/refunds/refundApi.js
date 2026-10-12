import { apiRequest, withJson } from '../../../infrastructure/api/httpClient.js'

export const createRefundApi = ({ request = apiRequest, json = withJson } = {}) => Object.freeze({
  registerPartialRefund: (id,payload) => request(
    `/api/orders/${encodeURIComponent(id)}/partial-refund`,
    json('POST',payload),
  ),
  refundOrder: (id, payload) => request(
    `/api/orders/${encodeURIComponent(id)}/refund`,
    json('POST', payload),
  ),
})

export const refundApi = createRefundApi()
