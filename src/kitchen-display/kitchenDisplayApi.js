import { createRealtimeApi } from '../infrastructure/realtime/realtimeApi.js'
export const KITCHEN_TV_SESSION_HEADER = 'x-kitchen-tv-session'

export class KitchenDisplayHttpError extends Error {
  constructor(status, message = 'Kitchen TV request failed') {
    super(message)
    this.name = 'KitchenDisplayHttpError'
    this.status = status
    this.definitive = status === 401 || status === 403
  }
}

async function requestJson(path, init, fetchImpl) {
  const response = await fetchImpl(path, { credentials: 'same-origin', ...init })
  if (!response.ok) {
    let message = `Kitchen TV request failed (${response.status})`
    try {
      const payload = await response.json()
      if (payload?.error?.message || payload?.message) message = payload?.error?.message || payload.message
    } catch {
      // Status is the authoritative boundary when the server did not return JSON.
    }
    throw new KitchenDisplayHttpError(response.status, message)
  }
  return response.json()
}

export const createKitchenDisplayPairingRequest = (fetchImpl = globalThis.fetch) => requestJson('/api/kitchen-tv/pairing-request', {
  method: 'POST',
}, fetchImpl)

export const readKitchenDisplayPairingStatus = (requestToken, fetchImpl = globalThis.fetch) => requestJson('/api/kitchen-tv/pairing-status', requestToken
  ? {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestToken }),
    }
  : { method: 'GET' }, fetchImpl)

export const readKitchenDisplayState = (sessionTokenOrFetch = null, maybeFetch = globalThis.fetch) => {
  const fetchImpl = typeof sessionTokenOrFetch === 'function' ? sessionTokenOrFetch : maybeFetch
  const sessionToken = typeof sessionTokenOrFetch === 'string' ? sessionTokenOrFetch.trim() : ''
  return requestJson('/api/kitchen-tv/state', {
    method: 'GET',
    ...(sessionToken ? { headers: { [KITCHEN_TV_SESSION_HEADER]: sessionToken } } : {}),
  }, fetchImpl)
}


export const reportKitchenDisplayState = (
  report,
  sessionTokenOrFetch = null,
  maybeFetch = globalThis.fetch,
) => {
  const fetchImpl = typeof sessionTokenOrFetch === 'function' ? sessionTokenOrFetch : maybeFetch
  const sessionToken = typeof sessionTokenOrFetch === 'string' ? sessionTokenOrFetch.trim() : ''
  return requestJson('/api/kitchen-tv/report', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(sessionToken ? { [KITCHEN_TV_SESSION_HEADER]: sessionToken } : {}),
    },
    body: JSON.stringify(report),
  }, fetchImpl)
}

export const createKitchenDisplayRealtimeApi=(sessionTokenOrFetch=null,maybeFetch=globalThis.fetch)=>{
  const fetchImpl=typeof sessionTokenOrFetch==='function'?sessionTokenOrFetch:maybeFetch
  const sessionToken=typeof sessionTokenOrFetch==='string'?sessionTokenOrFetch.trim():''
  return createRealtimeApi({basePath:'/api/kitchen-tv/realtime',request:(path,options)=>requestJson(path,{
    ...options,headers:{'content-type':'application/json',...(sessionToken?{[KITCHEN_TV_SESSION_HEADER]:sessionToken}:{})},
  },fetchImpl)})
}