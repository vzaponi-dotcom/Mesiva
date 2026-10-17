import { apiRequest, withJson } from '../../../infrastructure/api/httpClient.js'

export const createOrdersApi = ({ request = apiRequest, json = withJson, randomUUID = () => crypto.randomUUID() } = {}) => Object.freeze({
  getOrders: () => request('/api/orders'),
  getOrdersByIds: (ids,{signal}={}) => request(`/api/orders/by-ids?ids=${encodeURIComponent(JSON.stringify(ids))}`,...(signal?[{signal}]:[])),
  createOrder: (order, idempotencyKey = randomUUID()) => {
    const options = json('POST', order)
    return request('/api/orders', {
      ...options,
      headers: { ...(options.headers || {}), 'idempotency-key': idempotencyKey },
    })
  },
  updateOrder: (id,payload) => request(`/api/orders/${encodeURIComponent(id)}`,json('PATCH',payload)),
  acknowledgeOrderEdit: (id,revision) => request(`/api/kitchen-tv/control/orders/${encodeURIComponent(id)}/edits/${revision}/acknowledge`,json('PATCH',{})),
  updateOrderStatus: (id, status = 'Finalizado') => request(
    `/api/orders/${encodeURIComponent(id)}/status`,
    json('PATCH', { status }),
  ),
  cancelOrder: (id, payload) => request(
    `/api/orders/${encodeURIComponent(id)}/cancel`,
    json('POST', payload),
  ),
  updatePaymentPromise: (id, promisedPaymentDate) => request(
    `/api/orders/${encodeURIComponent(id)}/payment-promise`,
    json('PATCH', { promisedPaymentDate }),
  ),
})

export const ordersApi = createOrdersApi()
