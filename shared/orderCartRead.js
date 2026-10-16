const cleanSpaces = (value) => String(value ?? '').trim().replace(/\s+/g, ' ')
const toNonNegativeNumber = (value) => {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : 0
}

export const getOrderItemDisplayName = (item = {}) => {
  const name = cleanSpaces(item.name || 'Produto')
  const size = cleanSpaces(item.size)
  if (!size) return name
  const normalizedName = name.toLocaleLowerCase('pt-BR')
  const normalizedSize = size.toLocaleLowerCase('pt-BR')
  if (normalizedName === normalizedSize || normalizedName.endsWith(` ${normalizedSize}`)) return name
  return `${name} ${size}`
}

export const getOrderItems = (order = {}) => {
  if (Array.isArray(order.items) && order.items.length) return order.items
  const quantity = Math.max(1, Math.trunc(Number(order.quantity) || 1))
  const total = toNonNegativeNumber(order.total)
  const inferredUnitPrice = quantity ? total / quantity : total
  const name = order.productName || (order.size ? `Marmita ${order.size}` : 'Produto')
  return [{
    id: `legacy-${order.id ?? 'order'}`, lineId: `legacy-${order.id ?? 'order'}`, productId: order.productId ?? null,
    name, category: order.category || '', size: order.size || '', quantity,
    catalogPrice: inferredUnitPrice, unitPrice: inferredUnitPrice, note: '',
  }]
}

export const getOrderItemsSummary = (order) => getOrderItems(order)
  .map((item) => `${Math.max(1, Number(item.quantity) || 1)}× ${getOrderItemDisplayName(item)}`)
  .join(' · ')

export const getOrderItemsSearchText = (order) => getOrderItems(order)
  .map((item) => [item.name, item.category, item.size, item.note].filter(Boolean).join(' '))
  .join(' ')
