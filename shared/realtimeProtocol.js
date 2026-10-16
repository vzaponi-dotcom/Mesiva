export const REALTIME_PROTOCOL = 'mesiva.realtime.v1'
export const REALTIME_TOPICS = Object.freeze(['orders','tables','reservations','clients','catalog','finance','settings','kitchen-tv','printing'])
export const REALTIME_MAX_BYTES = 16 * 1024
export const REALTIME_MAX_IDS = 99
const types = ['ready','invalidate','resync_required','access_changed']
const id = value => typeof value === 'string' && value.length <= 200 && Boolean(value.trim())
const unique = values => new Set(values).size === values.length
export function parseRealtimeMessage(input) {
  try {
    const encoded = typeof input === 'string' ? input : JSON.stringify(input)
    if (typeof encoded !== 'string' || new TextEncoder().encode(encoded).length > REALTIME_MAX_BYTES) return null
    const value = JSON.parse(encoded)
    if (!value || Array.isArray(value) || value.version !== 1 || !types.includes(value.type)
      || typeof value.revision !== 'string' || !/^(0|[1-9][0-9]{0,79})$/.test(value.revision)
      || !Array.isArray(value.topics) || !unique(value.topics) || !value.topics.every(topic=>REALTIME_TOPICS.includes(topic))
      || !Array.isArray(value.orderIds) || value.orderIds.length > REALTIME_MAX_IDS || !unique(value.orderIds) || !value.orderIds.every(id)) return null
    const keys = ['version','type','revision','topics','orderIds']
    if (value.type === 'ready') {
      keys.push('connectionId','expiresAt')
      if (!id(value.connectionId) || typeof value.expiresAt !== 'string' || !Number.isFinite(Date.parse(value.expiresAt)) || value.orderIds.length) return null
    }
    if (value.type !== 'invalidate' && value.orderIds.length) return null
    if (value.orderIds.length && !value.topics.includes('orders')) return null
    if (Object.keys(value).some(key=>!keys.includes(key))) return null
    return value
  } catch { return null }
}
