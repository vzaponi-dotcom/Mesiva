import {
  createKitchenDisplayPairingRequest,
  createKitchenDisplayRealtimeApi,
  readKitchenDisplayPairingStatus,
  readKitchenDisplayState,
  reportKitchenDisplayState,
} from './kitchenDisplayApi.js'

export const KITCHEN_TV_PAIRING_STORAGE_KEY = 'kitchen-tv-pairing-request-token'
export const KITCHEN_TV_SESSION_STORAGE_KEY = 'kitchen-tv-session-token'

let volatilePairingToken = null
let volatileSessionToken = null

const storageGet = (storage, key, fallback) => {
  try { return storage?.getItem?.(key) || fallback }
  catch { return fallback }
}

const storageSet = (storage, key, value, setFallback) => {
  setFallback(value || null)
  try {
    if (value) storage?.setItem?.(key, value)
    else storage?.removeItem?.(key)
  } catch {
    // Older Smart TV browsers may restrict Web Storage. The in-memory fallback
    // keeps both pairing and legacy-session credentials alive for this page.
  }
}

const pairingTokenGet = (storage) => storageGet(storage, KITCHEN_TV_PAIRING_STORAGE_KEY, volatilePairingToken)
const pairingTokenSet = (storage, value) => storageSet(storage, KITCHEN_TV_PAIRING_STORAGE_KEY, value, (next) => { volatilePairingToken = next })
const sessionTokenGet = (storage) => storageGet(storage, KITCHEN_TV_SESSION_STORAGE_KEY, volatileSessionToken)
const sessionTokenSet = (storage, value) => storageSet(storage, KITCHEN_TV_SESSION_STORAGE_KEY, value, (next) => { volatileSessionToken = next })

const visiblePairing = (pairing) => pairing ? {
  paired: Boolean(pairing.paired),
  code: pairing.code,
  expiresAt: pairing.expiresAt,
} : pairing

async function createAndRememberPairing(createPairingRequest, storage) {
  const pairing = await createPairingRequest()
  if (pairing?.requestToken) pairingTokenSet(storage, pairing.requestToken)
  return visiblePairing(pairing)
}

export class KitchenDisplayActivationError extends Error {
  constructor(cause) {
    super(cause?.message || 'A sessão aprovada da TV não pôde ser ativada.')
    this.name = 'KitchenDisplayActivationError'
    this.status = cause?.status
    this.activationFailure = true
    this.cause = cause
  }
}

export async function readStoredKitchenDisplayState({
  storage = globalThis.sessionStorage,
  readState = readKitchenDisplayState,
} = {}) {
  return readState(sessionTokenGet(storage))
}

export async function reportStoredKitchenDisplayState(report, {
  storage = globalThis.sessionStorage,
  reportState = reportKitchenDisplayState,
} = {}) {
  return reportState(report, sessionTokenGet(storage))
}

export async function pollKitchenDisplayPairing({
  storage = globalThis.sessionStorage,
  readPairingStatus = readKitchenDisplayPairingStatus,
  createPairingRequest = createKitchenDisplayPairingRequest,
  readState = readKitchenDisplayState,
} = {}) {
  const storedToken = pairingTokenGet(storage)
  let pairing
  try {
    pairing = await readPairingStatus(storedToken)
  } catch (error) {
    if (error?.status !== 401 && error?.status !== 410) throw error
    pairingTokenSet(storage, null)
    return { kind: 'pairing', pairing: await createAndRememberPairing(createPairingRequest, storage) }
  }

  if (pairing?.paired) {
    const issuedSessionToken = typeof pairing.sessionToken === 'string' ? pairing.sessionToken.trim() : ''
    if (issuedSessionToken) sessionTokenSet(storage, issuedSessionToken)
    try {
      const state = await readState(sessionTokenGet(storage))
      pairingTokenSet(storage, null)
      return { kind: 'paired', state }
    } catch (error) {
      pairingTokenSet(storage, null)
      throw new KitchenDisplayActivationError(error)
    }
  }

  return { kind: 'pairing', pairing: visiblePairing(pairing) }
}

export async function bootstrapKitchenDisplay({
  storage = globalThis.sessionStorage,
  readState = readKitchenDisplayState,
  readPairingStatus = readKitchenDisplayPairingStatus,
  createPairingRequest = createKitchenDisplayPairingRequest,
} = {}) {
  const storedSessionToken = sessionTokenGet(storage)
  try {
    const state = await readState(storedSessionToken)
    pairingTokenSet(storage, null)
    return { kind: 'paired', state }
  } catch (error) {
    if (error?.status !== 401 && error?.status !== 403) throw error
    if (storedSessionToken) sessionTokenSet(storage, null)
  }

  return pollKitchenDisplayPairing({ storage, readState, readPairingStatus, createPairingRequest })
}

export function createStoredKitchenDisplayRealtimeApi({storage=globalThis.sessionStorage,fetchImpl=globalThis.fetch}={}) {
  return Object.freeze({
    prepare:options=>createKitchenDisplayRealtimeApi(sessionTokenGet(storage),fetchImpl).prepare(options),
    renew:(connectionId,options)=>createKitchenDisplayRealtimeApi(sessionTokenGet(storage),fetchImpl).renew(connectionId,options),
  })
}
