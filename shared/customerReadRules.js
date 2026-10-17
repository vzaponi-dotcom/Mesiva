import {getBusinessDate} from './finance.js'
export function filterAndSortClients(clients, { search = '', sort = 'name-asc', filter = 'all', relationships = new Map() } = {}) {
  const normalizedSearch = search.trim().toLowerCase()
  const filtered = (Array.isArray(clients) ? clients : []).filter((client) => (
    !normalizedSearch
    || [client.name, client.phone, client.address].join(' ').toLowerCase().includes(normalizedSearch)
  )).filter(client => {
    const profile = relationships.get(client.id)
    if (filter === 'pending') return profile?.pending > 0
    if (filter === 'inactive') return profile?.daysSincePurchase >= 30
    if (filter === 'empty') return profile?.orderCount === 0
    return true
  })

  return [...filtered].sort((a, b) => {
    const left = relationships.get(a.id), right = relationships.get(b.id)
    if (sort === 'recent') return (right?.lastPurchase || '').localeCompare(left?.lastPurchase || '') || a.name.localeCompare(b.name)
    if (sort === 'orders') return (right?.orderCount || 0) - (left?.orderCount || 0) || a.name.localeCompare(b.name)
    return sort === 'name-desc' ? b.name.localeCompare(a.name) : a.name.localeCompare(b.name)
  })
}

const businessDate = value => getBusinessDate(value)
export const clientOrderDate = order => order.orderDate || (order.createdAt && Number.isFinite(Date.parse(order.createdAt)) ? businessDate(new Date(order.createdAt)) : '')
const cents = value => Math.max(0, Math.round((Number(value) || 0) * 100))

export function buildClientRelationships(clients, orders, { now = new Date() } = {}) {
  const grouped = new Map()
  for (const order of orders || []) {
    if (!order.clientId) continue
    const existing = grouped.get(order.clientId) || []
    existing.push(order)
    grouped.set(order.clientId, existing)
  }
  return new Map(clients.map(client => {
    const history = [...(grouped.get(client.id) || [])].sort((a, b) => clientOrderDate(b).localeCompare(clientOrderDate(a)) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    const purchases = history.filter(order => order.status !== 'Cancelado')
    const totalCents = purchases.reduce((sum, order) => sum + cents(order.total), 0)
    const pendingCents = purchases.reduce((sum, order) => sum + (Number.isSafeInteger(order.dueCents) ? Math.max(0,order.dueCents) : order.paymentStatus === 'Pago' ? 0 : cents(order.total)), 0)
    const lastPurchase = purchases.map(clientOrderDate).filter(Boolean).sort().at(-1) || null
    const daysSincePurchase = lastPurchase ? Math.max(0, Math.round((Date.parse(businessDate(now)) - Date.parse(lastPurchase)) / 86400000)) : null
    const purchaseDates = purchases.map(clientOrderDate).filter(Boolean)
    const dates = [...new Set(purchaseDates)].sort()
    const frequencyDays = dates.length > 1 ? Math.round((Date.parse(dates.at(-1)) - Date.parse(dates[0])) / 86400000 / (dates.length - 1)) : purchaseDates.length > 1 ? 0 : null
    const favorites = new Map()
    for (const order of purchases) for (const item of order.items || []) {
      const key = item.productId || item.name
      if (!key) continue
      const product = favorites.get(key) || { key, name: item.name || 'Produto', quantity: 0 }
      product.quantity += Math.max(0, Number(item.quantity) || 0)
      favorites.set(key, product)
    }
    return [client.id, { orders: history, orderCount: history.length, cancelledCount: history.length - purchases.length, total: totalCents / 100, pending: pendingCents / 100, average: purchases.length ? Math.round(totalCents / purchases.length) / 100 : 0, lastPurchase, daysSincePurchase, frequencyDays, favorites: [...favorites.values()].sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name)).slice(0, 3) }]
  }))
}
