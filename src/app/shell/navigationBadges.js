const normalizedCount = (value) => {
  const count = Number(value)
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0
}

const copy = {
  orders: (count) => `${count} ${count === 1 ? 'pedido em andamento' : 'pedidos em andamento'}`,
  comandas: (count) => `${count} ${count === 1 ? 'comanda aberta' : 'comandas abertas'}`,
  'print-queue': (count) => `${count} ${count === 1 ? 'job ativo' : 'jobs ativos'}`,
  finance: (count) => `${count} ${count === 1 ? 'devolução ou estorno pendente' : 'devoluções ou estornos pendentes'}`,
}

export const getNavigationBadge = (entry, badges = {}) => {
  // The mobile "Financeiro" area can resolve to Visão geral, but this badge
  // identifies the pending devoluções in the Movimentações destination.
  const badgeId = entry?.area === 'finance' && entry?.icon === 'finance' ? 'finance' : entry?.id
  const formatter = copy[badgeId]
  if (!formatter) return null
  const count = normalizedCount(badges[badgeId])
  if (!count) return null
  return { count, text: count > 99 ? '99+' : String(count), ariaLabel: `${entry.label}, ${formatter(count)}` }
}
