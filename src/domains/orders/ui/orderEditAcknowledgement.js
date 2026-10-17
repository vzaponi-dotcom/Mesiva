// Local UI acknowledgement is only a visual hint after an authorized server
// success. A new operational revision uses a distinct key and remains visible.
export const operationalEditAckKey = (order) => {
  const revision = Number(order?.operationalRevision)
  return order?.id != null && Number.isSafeInteger(revision) && revision > 0
    ? `${String(order.id)}:${revision}`
    : null
}

export const isOperationalEditPending = (order, locallyAcknowledged = new Set()) => {
  const key = operationalEditAckKey(order)
  return order?.editPending === true && (!key || !locallyAcknowledged.has(key))
}

export const rememberOperationalEditAck = (previous, order) => {
  const key = operationalEditAckKey(order)
  if (!key || previous.has(key)) return previous
  const next = new Set(previous)
  next.add(key)
  // This transient hint need not grow for the duration of a long kitchen shift.
  if (next.size > 160) next.delete(next.values().next().value)
  return next
}
