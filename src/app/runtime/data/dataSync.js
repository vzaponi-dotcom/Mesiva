export const createCollectionSyncGuard = (collections = []) => {
  const readVersion = Object.fromEntries(collections.map((key) => [key, 0]))
  const mutationVersion = Object.fromEntries(collections.map((key) => [key, 0]))

  const ensureCollection = (key) => {
    if (!(key in readVersion)) readVersion[key] = 0
    if (!(key in mutationVersion)) mutationVersion[key] = 0
  }

  return {
    beginRead(keys = []) {
      const snapshot = {}
      for (const key of keys) {
        ensureCollection(key)
        readVersion[key] += 1
        snapshot[key] = {
          readVersion: readVersion[key],
          mutationVersion: mutationVersion[key],
        }
      }
      return snapshot
    },

    beginQueryRead(keys = []) {
      const snapshot = {}
      for (const key of keys) {
        ensureCollection(key)
        snapshot[key] = { independent: true, mutationVersion: mutationVersion[key] }
      }
      return snapshot
    },

    markMutation(keys = []) {
      for (const key of keys) {
        ensureCollection(key)
        mutationVersion[key] += 1
      }
    },

    canApply(token, key) {
      ensureCollection(key)
      return Boolean(token?.[key])
        && (token[key].independent === true || token[key].readVersion === readVersion[key])
        && token[key].mutationVersion === mutationVersion[key]
    },
  }
}

export const upsertById = (items = [], entity) => {
  if (!entity?.id) return items
  return items.some((item) => item?.id === entity.id)
    ? items.map((item) => item?.id === entity.id ? entity : item)
    : [entity, ...items]
}

export const upsertManyById = (items = [], entities = []) => {
  let next = items
  for (const entity of entities) next = upsertById(next, entity)
  return next
}

export const removeById = (items = [], id) => items.filter((item) => item?.id !== id)

// Point reads preserve every existing member; stable sorting retains tie order.
export const upsertManyInCreatedOrder=(items=[],entities=[])=>upsertManyById(items,entities)
  .slice().sort((a,b)=>String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
