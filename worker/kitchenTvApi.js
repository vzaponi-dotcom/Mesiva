import { authenticatedTv } from './kitchenTvSession.js'
import { handleTvRealtimeApi } from './realtime/api.js'
import { multiCompanyEnabled } from './tenancy/routePolicy.js'
import {
  clearKitchenTvPairingRequestCookie,
  createKitchenTvCredential,
  createKitchenTvPairingCode,
  hashKitchenTvToken,
  kitchenTvPairingExpiresAt,
  kitchenTvPairingRequestCookie,
  kitchenTvSessionCookie,
  readKitchenTvPairingRequestToken,
} from './kitchenTvAuth.js'
import {
  activateKitchenTvApprovedRequest,
  approveKitchenTvPairingCode,
  createKitchenTvPairingRequest,
  loadKitchenTvAccess,
  loadKitchenTvPairingRequestByHash,
  loadKitchenTvPendingApproval,
  revokeKitchenTvAccess,
  touchKitchenTvSession,
} from './kitchenTvRepository.js'
import { loadKitchenTvState } from './kitchenTvReadRepository.js'
import { loadOperationalEditSignals, acknowledgeOperationalOrderEdit } from './orderEditSignalsRepository.js'
import {
  getKitchenTvOrderControlEligibility,
  hideKitchenTvOrder,
  listKitchenTvHiddenOrderIds,
  loadKitchenTvControl,
  reportKitchenTvDisplay,
  restoreKitchenTvOrder,
  setKitchenTvRequestedModality,
  setKitchenTvRequestedPage,
} from './kitchenTvControlRepository.js'
import { KITCHEN_TV_MODALITIES } from '../shared/kitchenTvModality.js'
import { apiError, assertSameOriginMutation, json, readJson } from './http.js'
import { requireCapability } from './settingsAccess.js'

const pairingExpired = () => apiError(410, 'KITCHEN_TV_PAIRING_EXPIRED', 'O código expirou. Um novo código será gerado.')
const normalizePairingCode = (value) => String(value ?? '').replace(/\D/g, '').slice(0, 6)
const needsLegacySessionTokenFallback = (request) => /\bTizen\b/i.test(request.headers.get('user-agent') || '')

const settingsPayload = (access, pending) => ({
  configured: Boolean(access?.sessionTokenHash || pending),
  waitingPairing: Boolean(pending),
  paired: Boolean(access?.sessionTokenHash && !access?.revokedAt),
  pairedAt: access?.pairedAt ?? null,
  lastSeenAt: access?.lastSeenAt ?? null,
  revokedAt: access?.revokedAt ?? null,
  pairingExpiresAt: pending?.expiresAt ?? null,
})

async function loadSettingsState(db, businessId, now) {
  const [access, pending] = await Promise.all([
    loadKitchenTvAccess(db, businessId),
    loadKitchenTvPendingApproval(db, businessId, now),
  ])
  return settingsPayload(access, pending)
}

async function pairingRequestToken(request) {
  const cookieToken = readKitchenTvPairingRequestToken(request)
  if (request.method !== 'POST') return cookieToken
  assertSameOriginMutation(request)
  try {
    const body = await readJson(request)
    const storedToken = typeof body.requestToken === 'string' ? body.requestToken.trim() : ''
    return storedToken || cookieToken
  } catch {
    return cookieToken
  }
}

const paired = (access) => Boolean(access?.sessionTokenHash && !access?.revokedAt)
const requirePairedKitchenTv = async (db, businessId) => {
  const access = await loadKitchenTvAccess(db, businessId)
  if (!paired(access)) {
    throw apiError(409, 'KITCHEN_TV_NOT_PAIRED', 'A TV da cozinha precisa estar conectada para receber comandos.')
  }
  return access
}
const controlPayload = (access, control, hiddenOrderIds) => ({
  paired: paired(access),
  control: {
    revision: control.revision,
    requestedPage: control.requestedPage,
    requestedModality: control.requestedModality,
    updatedAt: control.updatedAt,
  },
  telemetry: control.telemetry,
  hiddenOrderIds,
})

async function loadControlState(db, businessId) {
  const [access, control, hiddenOrderIds] = await Promise.all([
    loadKitchenTvAccess(db, businessId),
    loadKitchenTvControl(db, businessId),
    listKitchenTvHiddenOrderIds(db, businessId),
  ])
  const signals=await loadOperationalEditSignals(db,businessId)
  const pendingOrderEdits=[...signals.entries()].filter(([,v])=>v.editPending)
    .map(([orderId,v])=>({orderId,...v}))
  return {...controlPayload(access, control, hiddenOrderIds),...(pendingOrderEdits.length?{pendingOrderEdits}:{})}
}

const pageInput = (body) => {
  if (Object.keys(body).length !== 1 || !Number.isSafeInteger(body.page) || body.page < 1) {
    throw apiError(400, 'KITCHEN_TV_PAGE_INVALID', 'Informe uma página válida da TV.')
  }
  return body.page
}

const modalityInput = (body) => {
  if (Object.keys(body).length !== 1 || !KITCHEN_TV_MODALITIES.includes(body.modality)) {
    throw apiError(400, 'KITCHEN_TV_MODALITY_INVALID', 'Informe uma modalidade válida da TV.')
  }
  return body.modality
}

const REPORT_KEYS = new Set([
  'appliedRevision', 'currentPage', 'pageCount',
  'viewportWidth', 'viewportHeight', 'visibleOrderIds',
])

const reportInput = (body) => {
  const keys = Object.keys(body)
  const ids = body.visibleOrderIds
  const validIds = Array.isArray(ids)
    && ids.length <= 100
    && ids.every((id) => typeof id === 'string' && id.trim().length > 0 && id.length <= 128)
    && new Set(ids).size === ids.length
  const valid = keys.length === REPORT_KEYS.size
    && keys.every((key) => REPORT_KEYS.has(key))
    && Number.isSafeInteger(body.appliedRevision) && body.appliedRevision >= 0
    && Number.isSafeInteger(body.currentPage) && body.currentPage >= 1
    && Number.isSafeInteger(body.pageCount) && body.pageCount >= 1
    && body.currentPage <= body.pageCount
    && Number.isSafeInteger(body.viewportWidth) && body.viewportWidth >= 1 && body.viewportWidth <= 10_000
    && Number.isSafeInteger(body.viewportHeight) && body.viewportHeight >= 1 && body.viewportHeight <= 10_000
    && validIds
  if (!valid) throw apiError(400, 'KITCHEN_TV_REPORT_INVALID', 'Estado renderizado da TV inválido.')
  return {
    appliedRevision: body.appliedRevision,
    currentPage: body.currentPage,
    pageCount: body.pageCount,
    viewportWidth: body.viewportWidth,
    viewportHeight: body.viewportHeight,
    visibleOrderIds: ids,
  }
}

export async function handleKitchenTvAdminApi(request, env, context, url = new URL(request.url), now = new Date()) {
  if (url.pathname === '/api/kitchen-tv/control' && request.method === 'GET') {
    requireCapability(context, 'orders.view')
    return json(await loadControlState(env.DB, context.businessId))
  }
  const acknowledgeMatch=url.pathname.match(/^\/api\/kitchen-tv\/control\/orders\/([^/]+)\/edits\/([0-9]+)\/acknowledge$/)
  if (acknowledgeMatch && request.method === 'PATCH') {
    requireCapability(context, 'orders.kitchen.control')
    assertSameOriginMutation(request)
    const orderId=decodeURIComponent(acknowledgeMatch[1]),revision=Number(acknowledgeMatch[2])
    await acknowledgeOperationalOrderEdit(env.DB,context.businessId,orderId,revision,context.userId,now)
    return json({orderId,revision,acknowledged:true})
  }
  if (url.pathname === '/api/kitchen-tv/control/page' && request.method === 'PATCH') {
    requireCapability(context, 'orders.kitchen.control')
    assertSameOriginMutation(request)
    const page = pageInput(await readJson(request))
    const access = await requirePairedKitchenTv(env.DB, context.businessId)
    const control = await setKitchenTvRequestedPage(env.DB, context.businessId, page, now)
    return json(controlPayload(
      access,
      control,
      await listKitchenTvHiddenOrderIds(env.DB, context.businessId),
    ))
  }
  if (url.pathname === '/api/kitchen-tv/control/modality' && request.method === 'PATCH') {
    requireCapability(context, 'orders.kitchen.control')
    assertSameOriginMutation(request)
    const modality = modalityInput(await readJson(request))
    const access = await requirePairedKitchenTv(env.DB, context.businessId)
    const control = await setKitchenTvRequestedModality(env.DB, context.businessId, modality, now)
    return json(controlPayload(
      access,
      control,
      await listKitchenTvHiddenOrderIds(env.DB, context.businessId),
    ))
  }
  const hiddenMatch = url.pathname.match(/^\/api\/kitchen-tv\/control\/orders\/([^/]+)\/hidden$/)
  if (hiddenMatch && request.method === 'PUT') {
    requireCapability(context, 'orders.kitchen.control')
    assertSameOriginMutation(request)
    await requirePairedKitchenTv(env.DB, context.businessId)
    const orderId = decodeURIComponent(hiddenMatch[1])
    const eligibility = await getKitchenTvOrderControlEligibility(env.DB, context.businessId, orderId, now)
    if (!eligibility.exists) throw apiError(404, 'ORDER_NOT_FOUND', 'Pedido não encontrado.')
    if (!eligibility.eligible) throw apiError(409, 'KITCHEN_TV_ORDER_NOT_ELIGIBLE', 'Este pedido ainda não pode ser retirado da TV.')
    await hideKitchenTvOrder(env.DB, context.businessId, orderId, now)
    return json({ orderId, hidden: true })
  }
  if (hiddenMatch && request.method === 'DELETE') {
    requireCapability(context, 'orders.kitchen.control')
    assertSameOriginMutation(request)
    await requirePairedKitchenTv(env.DB, context.businessId)
    const orderId = decodeURIComponent(hiddenMatch[1])
    const eligibility = await getKitchenTvOrderControlEligibility(env.DB, context.businessId, orderId, now)
    if (!eligibility.exists) throw apiError(404, 'ORDER_NOT_FOUND', 'Pedido não encontrado.')
    await restoreKitchenTvOrder(env.DB, context.businessId, orderId)
    return json({ orderId, hidden: false })
  }
  if (url.pathname === '/api/kitchen-tv/settings' && request.method === 'GET') {
    requireCapability(context, 'orders.settings.view')
    return json(await loadSettingsState(env.DB, context.businessId, now))
  }
  if (url.pathname === '/api/kitchen-tv/approve' && request.method === 'POST') {
    requireCapability(context, 'orders.settings.manage')
    assertSameOriginMutation(request)
    const access = await loadKitchenTvAccess(env.DB, context.businessId)
    if (access?.sessionTokenHash && !access.revokedAt) {
      throw apiError(409, 'KITCHEN_TV_ALREADY_PAIRED', 'Revogue a TV atual antes de conectar outra.')
    }
    const body = await readJson(request)
    const code = normalizePairingCode(body.code)
    if (code.length !== 6) throw apiError(400, 'KITCHEN_TV_PAIRING_CODE_INVALID', 'Informe o código de 6 dígitos exibido na TV.')
    const approved = await approveKitchenTvPairingCode(env.DB, code, context.businessId, now)
    if (!approved) throw apiError(404, 'KITCHEN_TV_PAIRING_CODE_INVALID', 'Código inválido ou expirado.')
    return json(await loadSettingsState(env.DB, context.businessId, now))
  }
  if (url.pathname === '/api/kitchen-tv/revoke' && request.method === 'POST') {
    requireCapability(context, 'orders.settings.manage')
    assertSameOriginMutation(request)
    await revokeKitchenTvAccess(env.DB, context.businessId, now)
    return json(await loadSettingsState(env.DB, context.businessId, now))
  }
  return null
}

export async function handleKitchenTvPublicApi(request, env, url = new URL(request.url), now = new Date()) {
  const realtime=await handleTvRealtimeApi(request,env,url)
  if(realtime)return realtime
  if (url.pathname === '/api/kitchen-tv/pairing-request' && request.method === 'POST') {
    assertSameOriginMutation(request)
    const expiresAt = kitchenTvPairingExpiresAt(now)
    let lastError
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const credential = await createKitchenTvCredential()
      const code = createKitchenTvPairingCode()
      try {
        await createKitchenTvPairingRequest(env.DB, credential.tokenHash, code, expiresAt, now)
        return json({ paired: false, code, expiresAt: expiresAt.toISOString(), requestToken: credential.token }, {
          status: 201,
          headers: { 'set-cookie': kitchenTvPairingRequestCookie(credential.token) },
        })
      } catch (error) {
        lastError = error
        if (!/UNIQUE|pairing_code/i.test(String(error?.message || error))) throw error
      }
    }
    throw apiError(503, 'KITCHEN_TV_PAIRING_UNAVAILABLE', lastError ? 'Não foi possível gerar um código agora.' : 'Pareamento indisponível.')
  }

  if (url.pathname === '/api/kitchen-tv/pairing-status' && ['GET', 'POST'].includes(request.method)) {
    const token = await pairingRequestToken(request)
    if (!token) throw pairingExpired()
    const requestHash = await hashKitchenTvToken(token)
    const pairing = await loadKitchenTvPairingRequestByHash(env.DB, requestHash)
    if (!pairing || pairing.consumedAt || pairing.expiresAt <= now.toISOString()) throw pairingExpired()
    if (!pairing.approvedBusinessId) {
      return json({ paired: false, code: pairing.pairingCode, expiresAt: pairing.expiresAt })
    }

    const sessionCredential = await createKitchenTvCredential()
    const access = await activateKitchenTvApprovedRequest(env.DB, requestHash, sessionCredential.tokenHash, now,{requireActive:multiCompanyEnabled(env)})
    if (!access) throw pairingExpired()
    const legacySessionTokenFallback = needsLegacySessionTokenFallback(request)
    const headers = new Headers()
    headers.append('set-cookie', kitchenTvSessionCookie(sessionCredential.token))
    if (!legacySessionTokenFallback) headers.append('set-cookie', clearKitchenTvPairingRequestCookie())
    return json(legacySessionTokenFallback
      ? { paired: true, sessionToken: sessionCredential.token }
      : { paired: true }, { headers })
  }

  if (url.pathname === '/api/kitchen-tv/report' && request.method === 'POST') {
    assertSameOriginMutation(request)
    const { access } = await authenticatedTv(request, env)
    const report = reportInput(await readJson(request))
    await reportKitchenTvDisplay(env.DB, access.businessId, report, now)
    await authenticatedTv(request,env)
    return json({ reported: true })
  }

  if (url.pathname === '/api/kitchen-tv/state' && request.method === 'GET') {
    const { token, access } = await authenticatedTv(request, env)
    const state = await loadKitchenTvState(env.DB, access.businessId)
    const touched = await touchKitchenTvSession(env.DB, access.businessId, now, 300_000)
    await authenticatedTv(request,env)
    return json({ serverNow: now.toISOString(), ...state }, touched
      ? { headers: { 'set-cookie': kitchenTvSessionCookie(token) } }
      : undefined)
  }
  return null
}
