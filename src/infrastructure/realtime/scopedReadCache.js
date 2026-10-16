const contexts = new WeakMap()
const COLLECTION_TOPIC = { orders:'orders', clients:'clients', products:'catalog', tables:'tables', tableTabs:'tables', movements:'finance', financeSettings:'finance' }
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)

export function getScopedReadCache(guard, accessContextId) {
  if (!guard || !accessContextId) return null
  let owner = contexts.get(guard)
  if (owner?.accessContextId === accessContextId) return owner.cache
  const entries = new Map()
  const cache = {
    version: 0,
    get(key, officialRevision) {
      const entry = entries.get(key)
      if (!entry) return null
      if (Date.now() >= entry.expiresAt || entry.collections.some(key => !guard.canApply(entry.token, key))
        || officialRevision !== undefined && entry.officialRevision !== officialRevision) {
        entries.delete(key)
        return null
      }
      entries.delete(key); entries.set(key, entry)
      return entry.data
    },
    set(key, data, { topics, collections, token, version, officialRevision } = {}) {
      const canStore = version === cache.version && collections.every(key => guard.canApply(token, key))
      if (key.startsWith('snapshot:')) {
        const changed = new Set()
        for (const [storedKey, entry] of entries) {
          if (!storedKey.startsWith('snapshot:')) continue
          const previous = entry.data
          for (const field of ['business', 'effectiveBusinessConfig', 'effectiveConfigVersion'])
            if (Object.hasOwn(data, field) && Object.hasOwn(previous, field) && !same(data[field], previous[field])) changed.add('settings')
          for (const [field, topic] of [['operationalOrders', 'orders'], ['openTableTabIds', 'tables']])
            if (data.readModel?.[field] && previous.readModel?.[field] && !same(data.readModel[field], previous.readModel[field])) changed.add(topic)
          for (const name of data.readModel.completeCollections) {
            if (!previous.readModel.completeCollections.includes(name)) continue
            if (!Array.isArray(data[name])) {
              if (!same(data[name], previous[name])) changed.add(COLLECTION_TOPIC[name])
              continue
            }
            const before = new Map(previous[name].map(row => [row.id, row]))
            const sameScope = name !== 'orders' || data.readModel.orderScope === previous.readModel.orderScope
            if (data[name].some(row => before.has(row.id) && !same(row, before.get(row.id)))
              || sameScope && (data[name].length !== before.size || data[name].some(row => !before.has(row.id)))) changed.add(COLLECTION_TOPIC[name])
          }
        }
        if (changed.size) cache.invalidate([...changed])
      }
      if (!canStore) return
      // Keep memory bounded even when a user explicitly loads a large history.
      if (Object.values(data || {}).some(value => Array.isArray(value) && value.length > 500) || data?.readModel?.operationalOrders?.length > 500 || data?.readModel?.openTableTabIds?.length > 500) { entries.delete(key); return }
      entries.delete(key)
      entries.set(key, { data, topics, collections, token, officialRevision, expiresAt: Date.now() + 300_000 })
      while (entries.size > 20) entries.delete(entries.keys().next().value)
    },
    delete(key) { entries.delete(key) },
    invalidate(topics) {
      cache.version++
      for (const [key, entry] of entries) if (!topics?.length || entry.topics.some(topic => topics.includes(topic))) entries.delete(key)
    },
  }
  owner = { accessContextId, cache }
  contexts.set(guard, owner)
  return cache
}
