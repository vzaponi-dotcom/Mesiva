import {readModelsEnabled,handleReadModelsApi} from './readModels/api.js'
import {loadSurfaceSnapshot} from './readModels/snapshotRepository.js'
import { withCommittedEffects, publishCommittedEffect } from './realtime/committedEffects.js'
import { realtimeEnabled, handleHumanRealtimeApi, handleRealtimeUpgrade } from './realtime/api.js'
import { clearSessionCookie, createSession, revokeSession, sessionCookie, SESSION_MAX_AGE, verifyPin } from './auth.js'
import { authenticateHumanRequest, loadAuthMode } from './access/sessions.js'
import { handleEmailAuthApi, loginWithEmail } from './access/emailAuthApi.js'
import { recordSecurityEvent, withAuditContext } from './access/audit.js'
import { withFinanceMutationGuard } from './access/financeMutationGuard.js'
import { attachOperationalAttributions } from './access/attribution.js'
import { createManualMovement, softDeleteManualMovement, updateManualMovement, upsertFinanceSettings } from './financeRepository.js'
import { parseFinanceSettingsInput, parseManualMovementInput } from './financeValidation.js'
import { apiError, assertSameOriginMutation, handleError, json, readJson } from './http.js'
import { cancelOrder, registerOrderRefund } from './orderCancellation.js'
import { validateCheckoutInput } from './orderCheckout.js'
import { validateOrderEditInput } from './orderEditValidation.js'
import { updateExistingOrder } from './orderEditRepository.js'
import { registerOrderSupplementalPayment } from './orderSupplementalPayment.js'
import { registerOrderPartialRefund } from './orderPartialRefund.js'
import { handlePrintingApi } from './orderPrintingApi.js'
import { handleSettingsApi } from './settingsApi.js'
import { resolveSettingsAccess } from './settingsAccess.js'
import { requireCapability, requireAnyCapability, authorizeOrderCreate } from './access/authorization.js'
import { projectMutationEffects, projectOrderList } from './access/projections.js'
import { printingActor } from './access/printingAuthorization.js'
import { loadEffectiveBusinessConfig } from './effectiveBusinessConfig.js'
import { createManualTableTabPrintJob, loadAutomaticPrintJobForOrder } from './orderPrintingRepository.js'
import { listOrders, listOrdersByIds } from './orderReadRepository.js'
import { loadMovementsByOrderSource, loadTableTabById } from './orderWriteEffects.js'
import { loadOpenTableTabDetail } from './tableTabDetailRepository.js'
import { updateOrderPaymentPromise } from './orderPaymentPromise.js'
import { createClient, createOrder, createProduct, deleteClient, deleteProduct, loadBootstrap, updateClient, updateOrderStatus, updateProduct } from './repositories.js'
import { registerClientOrdersPayment, registerOrderPayment, registerTableTabPayment } from './paymentRepository.js'
import { validatePaymentAllocations, validateReceivableOrderIds } from './paymentValidation.js'
import { createTable, listTables, renameTable, reorderTables, setTableActive, transferOpenTableTab } from './tableRepository.js'
import { loadTableReservationByOrderId } from './tableReservationRepository.js'
import { moneyToCents, optionalText, requireNonEmpty, validateProductCategory, validateStructuredPresentation } from './validation.js'
import { createTableTabPrintDocument } from '../shared/tableTabPrintDocument.js'
import { handleKitchenTvAdminApi, handleKitchenTvPublicApi } from './kitchenTvApi.js'
import { handleBusinessProfileApi } from './businessProfileApi.js'
import { handleReportingApi } from './reporting/api.js'
import { handleDayConferenceApi } from './dayConferenceApi.js'
import { handleTableReservationApi } from './tableReservationApi.js'
import { acceptAccessInvitation } from './access/invitations.js'
import { handleAccessApi } from './access/api.js'
import { handleGlobalAuthApi } from './identity/authApi.js'
import { handleCompanyInvitationsApi } from './tenancy/invitationsApi.js'
import { handlePlatformBusinessesApi } from './platform/businessesApi.js'
import { classifyApiRoute, multiCompanyEnabled, resolveRequestContext } from './tenancy/routePolicy.js'
import { requireBusinessContext } from './tenancy/businessContext.js'
import { authenticateAccountRequest, contextChanged, getRoleGrantsSnapshot } from './identity/sessions.js'
import { withBusinessSessionGuard } from './tenancy/guardedBusinessDb.js'

// Shared with the infrastructure CLI; never sourced from a request or CLI flag.
export const BUSINESS_ID = 'amor-e-sabor'
const authJson = (body, init = {}) => json(body, { ...init, headers: { 'cache-control': 'no-store', ...init.headers } })
const LOGIN_RATE_LIMIT_KEY = 'amor-e-sabor:auth-login'
const LEGACY_PRODUCT_CATEGORIES = {
  Marmita: 'Refeições',
  Bebida: 'Bebidas',
  Doce: 'Sobremesas',
  Adicional: 'Adicionais',
}

const assertLoginAllowed = async (env) => {
  if (!env.LOGIN_RATE_LIMITER?.limit) throw apiError(503, 'RATE_LIMIT_UNAVAILABLE', 'Proteção de acesso indisponível. Tente novamente.')
  const { success } = await env.LOGIN_RATE_LIMITER.limit({ key: LOGIN_RATE_LIMIT_KEY })
  if (!success) throw apiError(429, 'LOGIN_RATE_LIMITED', 'Muitas tentativas de acesso. Aguarde um minuto e tente novamente.')
}

const login = async (request, env) => {
  assertSameOriginMutation(request)
  const body = await readJson(request)
  const authMode = await loadAuthMode(env.DB, BUSINESS_ID)
  if (authMode === 'user_only' || (authMode === 'enrollment' && (Object.hasOwn(body,'email') || Object.hasOwn(body,'identifier')))) return loginWithEmail(request,env,{businessId:BUSINESS_ID,body,validateSession:validateResponseSession})
  if (!['legacy', 'enrollment'].includes(authMode)) throw apiError(401, 'INVALID_LOGIN', 'Identificador ou senha inválidos.')
  await assertLoginAllowed(env)
  const pin = requireNonEmpty(body.pin, 'pin')
  const credential = await env.DB.prepare('SELECT pin_hash FROM auth_credentials WHERE business_id = ? LIMIT 1').bind(BUSINESS_ID).first()
  if (!credential?.pin_hash) throw apiError(503, 'AUTH_NOT_CONFIGURED', 'O acesso por PIN ainda não foi configurado.')
  if (!(await verifyPin(pin, credential.pin_hash))) throw apiError(401, 'INVALID_PIN', 'PIN inválido.')
  const { token } = await createSession(env, BUSINESS_ID)
  const sessionRequest = new Request(request.url, { headers: { cookie: `amor_session=${token}` } })
  const context = await authenticateHumanRequest(sessionRequest, env)
  if (!context) throw apiError(401, 'INVALID_LOGIN', 'Identificador ou senha inválidos.')
  return validateResponseSession(sessionRequest, env, context, authJson({ authenticated: true, businessId: BUSINESS_ID }, { headers: { 'set-cookie': sessionCookie(token, SESSION_MAX_AGE) } }))
}

const logout = async (request, env) => { assertSameOriginMutation(request); const context = await authenticateHumanRequest(request, env); await revokeSession(request, context ? {...env,DB:withAuditContext(env.DB,context)} : env); return authJson({ authenticated: false }, { headers: { 'set-cookie': clearSessionCookie() } }) }
const resolveBusinessSettingsContext = async (env, session) => resolveSettingsAccess(session,
  session.legacy && typeof env.resolveCapabilities === 'function' ? await env.resolveCapabilities(session) : session.granted)

const validateResponseSession = async (request, env, session, response) => {
  if (multiCompanyEnabled(env)) {
    const current = await authenticateAccountRequest(request, env)
    if (!current || current.contextId !== session.contextId || current.accountId !== session.accountId
      || current.businessId !== session.businessId || current.userId !== session.userId || current.roleId !== session.roleId
      || getRoleGrantsSnapshot(current) !== getRoleGrantsSnapshot(session)
      || current.roleVersion !== session.roleVersion || [...current.granted].sort().join('\n') !== [...session.granted].sort().join('\n')) throw contextChanged()
    return response
  }
  let validationRequest = request
  const url = new URL(request.url)
  // Only this server-controlled response can rotate its current session.
  if (url.pathname === '/api/access/me/password' && request.method === 'POST' && response?.ok) {
    const replacement = response.headers.get('set-cookie')?.match(/^amor_session=([A-Za-z0-9_-]{43});/)
    if (replacement) validationRequest = new Request(request.url, { headers: { cookie: `amor_session=${replacement[1]}` } })
  }
  const current = await authenticateHumanRequest(validationRequest, env)
  if (!current || current.businessId !== BUSINESS_ID || current.userId !== session.userId) throw apiError(401, 'UNAUTHENTICATED', 'Sua sessão expirou. Entre novamente.')
  if (current.authMode !== session.authMode || current.roleId !== session.roleId || [...current.granted].sort().join('\n') !== [...session.granted].sort().join('\n')) {
    throw apiError(403, 'ACCESS_CHANGED', 'Seu acesso mudou. Atualize sua sessão.')
  }
  return response
}
const sessionStatus = async (request, env) => {
  const session = await authenticateHumanRequest(request, env)
  if (!session || session.businessId !== BUSINESS_ID) return authJson({ authenticated: false, authMode: await loadAuthMode(env.DB, BUSINESS_ID) })
  const context = await resolveBusinessSettingsContext(env, session)
  return validateResponseSession(request, env, session, authJson({ authenticated: true, businessId: session.businessId, settingsContextId: context.settingsContextId,
    capabilities: [...context.granted], user: session.userId ? { id: session.userId, displayName: session.displayName, roleName: session.roleName, email:session.email,emailVerified:session.emailVerified } : null,
    authMode: session.authMode, deviceMode: session.deviceMode }))
}
const clientInput = (body) => ({ name: requireNonEmpty(body.name, 'name'), phone: optionalText(body.phone), address: optionalText(body.address) })
const productInput = (body) => {
  const category = validateProductCategory(LEGACY_PRODUCT_CATEGORIES[body.category] || body.category)
  const legacySize = optionalText(body.size)
  const presentation = body.presentationType
    ? validateStructuredPresentation(body)
    : validateStructuredPresentation(legacySize && !['Un', 'Unidade'].includes(legacySize)
      ? { presentationType: 'size', presentationValue: legacySize, presentationUnit: '' }
      : { presentationType: 'unit', presentationValue: '', presentationUnit: '' })
  return {
    category,
    name: requireNonEmpty(body.name, 'name'),
    priceCents: moneyToCents(body.price, 'price'),
    ...presentation,
  }
}

const tablePatchInput = (body) => {
  const keys = Object.keys(body)
  if (keys.length !== 1 || !['name', 'isActive'].includes(keys[0])) {
    throw apiError(400, 'INVALID_TABLE_PATCH', 'Informe somente name ou isActive.')
  }
  return keys[0]
}

const authenticatedApi = async (request, env) => {
  const url = new URL(request.url)
  const session = await resolveRequestContext(request, env)
  if (multiCompanyEnabled(env)) requireBusinessContext(request, session)
  else if (!session || session.businessId !== BUSINESS_ID) throw apiError(401, 'UNAUTHENTICATED', 'Sua sessão expirou. Entre novamente.')
  const context = await resolveBusinessSettingsContext(env, session)
  if (session.userId && session.authMode === 'enrollment' && !url.pathname.startsWith('/api/access/')) {
    await recordSecurityEvent(env.DB,{businessId:context.businessId,context,action:'access.denied',result:'denied'})
    throw apiError(403, 'ENROLLMENT_ONLY', 'Durante a preparação, use somente a administração de acesso.')
  }
  let response, failure
  try { response = await dispatchAuthenticatedApi(request, env, session, context, url) } catch (error) {
    failure = error
    if (error.status === 403) await recordSecurityEvent(env.DB,{businessId:context.businessId,context,action:'access.denied',result:'denied'})
  }
  if (failure) { await validateResponseSession(request, env, session, response); throw failure }
  if (response.ok && response.headers.get('content-type')?.includes('application/json')) {
    const payload = await response.json()
    response = new Response(JSON.stringify(await attachOperationalAttributions(env.DB,context.businessId,payload,{reportOrder:/^\/api\/reporting\/orders\/[^/]+$/.test(url.pathname)})), {status:response.status,headers:response.headers})
  }
  try { await validateResponseSession(request, env, session, response) } catch(error) {
    if(error.status===403) await recordSecurityEvent(env.DB,{businessId:context.businessId,context,action:'access.denied',result:'denied'})
    throw error
  }
  response.headers.set('cache-control', 'no-store')
  return response
}

const dispatchAuthenticatedApi = async (request, env, session, context, url) => {
  env = { ...env, DB: withAuditContext(multiCompanyEnabled(env) ? withBusinessSessionGuard(env.DB, session) : env.DB, context) }
  const effectsJson = (payload, init) => json(projectMutationEffects(payload, context.granted), init)
  const financeDb = withFinanceMutationGuard(env.DB, context)

  const realtimeResponse=await handleHumanRealtimeApi(request,env,session,url)
  if(realtimeResponse)return realtimeResponse
  const readModelsResponse=await handleReadModelsApi(request,env,context,url)
  if(readModelsResponse)return readModelsResponse
  const accessResponse = await handleAccessApi(request, env, context, url)
  if (accessResponse) return accessResponse

  const kitchenTvResponse = await handleKitchenTvAdminApi(request, env, context, url)
  if (kitchenTvResponse) return kitchenTvResponse

  const businessProfileResponse = await handleBusinessProfileApi(request, env, context, url)
  if (businessProfileResponse) return businessProfileResponse

  const settingsResponse = await handleSettingsApi(request, env, context, url)
  if (settingsResponse) return settingsResponse

  const printingResponse = await handlePrintingApi(request, env, context, url)
  if (printingResponse) return printingResponse

  const conferenceResponse = await handleDayConferenceApi(request, env, context, url)
  if (conferenceResponse) return conferenceResponse

  const reportingResponse = await handleReportingApi(request, env, context, url)
  if (reportingResponse) return reportingResponse

  const tableReservationResponse = await handleTableReservationApi(request, env, context, url)
  if (tableReservationResponse) return tableReservationResponse

  if (url.pathname === '/api/bootstrap' && request.method === 'GET') {
    const effectiveBusinessConfig = await loadEffectiveBusinessConfig(env.DB, session.businessId, context.granted, context.userId)
    const knownVersion = url.searchParams.get('knownEffectiveConfigVersion')
    const bootstrap = readModelsEnabled(env) && url.searchParams.has('surface')
      ? await loadSurfaceSnapshot(env.DB,session.businessId,{surface:url.searchParams.get('surface'),granted:context.granted,currentTiming:effectiveBusinessConfig.operations?.timing,
        effectiveBusinessConfig:knownVersion===effectiveBusinessConfig.version?undefined:effectiveBusinessConfig})
      : await loadBootstrap(
      env.DB,
      session.businessId,
      knownVersion === effectiveBusinessConfig.version ? undefined : effectiveBusinessConfig,
      context.granted,
    )
    return json({ ...bootstrap, effectiveConfigVersion: effectiveBusinessConfig.version })
  }
  if (url.pathname === '/api/tables' && request.method === 'POST') {
    requireCapability(context, 'tables.manage')
    assertSameOriginMutation(request)
    await createTable(env.DB, session.businessId, await readJson(request))
    return effectsJson({ tables: await listTables(env.DB, session.businessId) }, { status: 201 })
  }
  if (url.pathname === '/api/tables/order' && request.method === 'PUT') {
    requireCapability(context, 'tables.manage')
    assertSameOriginMutation(request)
    const { tableIds } = await readJson(request)
    return effectsJson({ tables: await reorderTables(env.DB, session.businessId, tableIds) })
  }
  const tableTransferMatch = url.pathname.match(/^\/api\/tables\/([^/]+)\/transfer$/)
  if (tableTransferMatch && request.method === 'POST') {
    requireCapability(context, 'comandas.transfer')
    assertSameOriginMutation(request)
    const { destinationTableId, expectedTableTabId } = await readJson(request)
    if (typeof expectedTableTabId !== 'string' || !expectedTableTabId.trim()) {
      throw apiError(400, 'EXPECTED_TABLE_TAB_REQUIRED', 'A comanda confirmada não foi informada. Recarregue a página e selecione novamente.')
    }
    const normalizedDestinationTableId = requireNonEmpty(destinationTableId, 'destinationTableId')
    const tableTab = await transferOpenTableTab(
      env.DB,
      session.businessId,
      decodeURIComponent(tableTransferMatch[1]),
      normalizedDestinationTableId,
      new Date(),
      expectedTableTabId.trim(),
    )
    return effectsJson({ tables: await listTables(env.DB, session.businessId), tableTab })
  }
  const tableMatch = url.pathname.match(/^\/api\/tables\/([^/]+)$/)
  if (tableMatch && request.method === 'PATCH') {
    requireCapability(context, 'tables.manage')
    assertSameOriginMutation(request)
    const body = await readJson(request)
    const field = tablePatchInput(body)
    const tableId = decodeURIComponent(tableMatch[1])
    const table = field === 'name'
      ? await renameTable(env.DB, session.businessId, tableId, body.name)
      : await setTableActive(env.DB, session.businessId, tableId, body.isActive)
    if (!table) throw apiError(404, 'TABLE_NOT_FOUND', 'Mesa não encontrada.')
    return effectsJson({ tables: await listTables(env.DB, session.businessId) })
  }
  if (url.pathname === '/api/clients' && request.method === 'POST') {
    requireCapability(context, 'clients.create')
    assertSameOriginMutation(request)
    const client = await createClient(env.DB, session.businessId, clientInput(await readJson(request)))
    return effectsJson({ client }, { status: 201 })
  }
  const clientMatch = url.pathname.match(/^\/api\/clients\/([^/]+)$/)
  if (clientMatch && request.method === 'PATCH') {
    requireCapability(context, 'clients.update')
    assertSameOriginMutation(request)
    const client = await updateClient(env.DB, session.businessId, decodeURIComponent(clientMatch[1]), clientInput(await readJson(request)))
    if (!client) throw apiError(404, 'CLIENT_NOT_FOUND', 'Cliente não encontrado.')
    return effectsJson({ client })
  }
  if (clientMatch && request.method === 'DELETE') {
    requireCapability(context, 'clients.delete')
    assertSameOriginMutation(request)
    const deleted = await deleteClient(env.DB, session.businessId, decodeURIComponent(clientMatch[1]))
    if (!deleted) throw apiError(404, 'CLIENT_NOT_FOUND', 'Cliente não encontrado.')
    return json({ deleted: true })
  }

  const clientReceivablesPaymentMatch = url.pathname.match(/^\/api\/clients\/([^/]+)\/receivables\/payment$/)
  if (clientReceivablesPaymentMatch && request.method === 'POST') {
    requireCapability(context, 'payments.receive')
    requireCapability(context, 'clients.view')
    assertSameOriginMutation(request)
    const { orderIds, allocations, mutationId, receivedDate } = await readJson(request)
    const result = await registerClientOrdersPayment(
      financeDb,
      session.businessId,
      decodeURIComponent(clientReceivablesPaymentMatch[1]),
      validateReceivableOrderIds(orderIds),
      validatePaymentAllocations(allocations),
      new Date(),
      {mutationId,receivedDate},
    )
    return effectsJson(result, { status: 201 })
  }

  if (url.pathname === '/api/orders/by-ids' && request.method === 'GET') {
    requireAnyCapability(context, ['orders.view', 'orders.history'])
    let ids
    try { ids = JSON.parse(url.searchParams.get('ids')) } catch {
      throw apiError(400, 'INVALID_ORDER_IDS', 'Informe uma lista válida de pedidos.')
    }
    if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !id.trim() || id.length > 200)
      || new Set(ids).size > 99) throw apiError(400, 'INVALID_ORDER_IDS', 'Informe até 99 pedidos válidos.')
    return json({ orders: projectOrderList(await listOrdersByIds(env.DB, session.businessId, ids), context.granted) })
  }
  if (url.pathname === '/api/orders' && request.method === 'GET') {
    requireAnyCapability(context, ['orders.view', 'orders.history'])
    return json({ orders: projectOrderList(await listOrders(env.DB, session.businessId), context.granted) })
  }
  if (url.pathname === '/api/orders' && request.method === 'POST') {
    requireCapability(context, 'orders.create')
    assertSameOriginMutation(request)
    const body = await readJson(request)
    authorizeOrderCreate(context, body)
    const input = validateCheckoutInput(body, request.headers.get('idempotency-key'))
    const order = await createOrder(env.DB, session.businessId, input)
    const movements = input.paymentAllocations
      ? await loadMovementsByOrderSource(env.DB, session.businessId, order.id, 'order-payment')
      : []
    const tableTab = order.tableTabId
      ? await loadTableTabById(env.DB, session.businessId, order.tableTabId)
      : null
    const printJob = await loadAutomaticPrintJobForOrder(env.DB, session.businessId, order.id)
    const reservation = await loadTableReservationByOrderId(env.DB, session.businessId, order.id)
    const response = { order, movements, tableTab, printJob }
    if (reservation) response.reservation = reservation
    if (order.tableTabId || reservation) response.tables = await listTables(env.DB, session.businessId)
    return effectsJson(response, { status: 201 })
  }
  const editOrderMatch = url.pathname.match(/^\/api\/orders\/([^/]+)$/)
  if (editOrderMatch && request.method === 'PATCH') {
    requireCapability(context, 'orders.edit')
    assertSameOriginMutation(request)
    const body = validateOrderEditInput(await readJson(request))
    const result = await updateExistingOrder(financeDb, session.businessId,
      decodeURIComponent(editOrderMatch[1]), body,
      {allowAdjustment:context.granted.has('orders.discount')})
    return effectsJson({order:result.order})
  }
  const statusMatch = url.pathname.match(/^\/api\/orders\/([^/]+)\/status$/)
  if (statusMatch && request.method === 'PATCH') {
    requireCapability(context, 'orders.finalize')
    assertSameOriginMutation(request)
    const body = await readJson(request)
    if (body.status !== 'Finalizado') throw apiError(400, 'INVALID_STATUS', 'Transição de status inválida.')
    const order = await updateOrderStatus(financeDb, session.businessId, decodeURIComponent(statusMatch[1]))
    if (!order) throw apiError(404, 'ORDER_NOT_FOUND', 'Pedido não encontrado.')
    return effectsJson({ order })
  }
  const paymentMatch = url.pathname.match(/^\/api\/orders\/([^/]+)\/payment$/)
  if (paymentMatch && request.method === 'POST') {
    requireCapability(context, 'payments.receive')
    assertSameOriginMutation(request)
    const { allocations, receivedDate } = await readJson(request)
    const result = await registerOrderPayment(
      financeDb, session.businessId, decodeURIComponent(paymentMatch[1]),
      validatePaymentAllocations(allocations), new Date(), { receivedDate },
    )
    return effectsJson(result, { status: 201 })
  }
  const supplementMatch=url.pathname.match(/^\/api\/orders\/([^/]+)\/supplemental-payment$/)
  if(supplementMatch && request.method==='POST'){
    requireCapability(context,'payments.receive')
    assertSameOriginMutation(request)
    const result=await registerOrderSupplementalPayment(financeDb,session.businessId,
      decodeURIComponent(supplementMatch[1]),await readJson(request))
    return effectsJson(result,{status:201})
  }
  const partialRefundMatch=url.pathname.match(/^\/api\/orders\/([^/]+)\/partial-refund$/)
  if(partialRefundMatch && request.method==='POST'){
    requireCapability(context,'payments.refund')
    assertSameOriginMutation(request)
    const result=await registerOrderPartialRefund(financeDb,session.businessId,
      decodeURIComponent(partialRefundMatch[1]),await readJson(request))
    return effectsJson(result,{status:201})
  }
  const paymentPromiseMatch = url.pathname.match(/^\/api\/orders\/([^/]+)\/payment-promise$/)
  if (paymentPromiseMatch && request.method === 'PATCH') {
    requireCapability(context, 'finance.promises.manage')
    assertSameOriginMutation(request)
    const { promisedPaymentDate } = await readJson(request)
    const order = await updateOrderPaymentPromise(env.DB, session.businessId, decodeURIComponent(paymentPromiseMatch[1]), promisedPaymentDate)
    return effectsJson({ order })
  }
  const cancelMatch = url.pathname.match(/^\/api\/orders\/([^/]+)\/cancel$/)
  if (cancelMatch && request.method === 'POST') {
    requireCapability(context, 'orders.cancel')
    assertSameOriginMutation(request)
    const body = await readJson(request)
    if (body.refundNow) requireCapability(context, 'payments.refund')
    const result = await cancelOrder(financeDb, session.businessId, decodeURIComponent(cancelMatch[1]), body)
    return effectsJson(result)
  }
  const refundMatch = url.pathname.match(/^\/api\/orders\/([^/]+)\/refund$/)
  if (refundMatch && request.method === 'POST') {
    requireCapability(context, 'payments.refund')
    assertSameOriginMutation(request)
    const result = await registerOrderRefund(financeDb, session.businessId, decodeURIComponent(refundMatch[1]), await readJson(request))
    return effectsJson(result, { status: 201 })
  }
  const tableTabPrintMatch = url.pathname.match(/^\/api\/table-tabs\/([^/]+)\/print-document$/)
  if (tableTabPrintMatch && request.method === 'GET') {
    requireCapability(context, 'comandas.view')
    requireCapability(context, 'printing.execute')
    const detail = await loadOpenTableTabDetail(env.DB, session.businessId, decodeURIComponent(tableTabPrintMatch[1]))
    if (!detail) throw apiError(404, 'TABLE_TAB_NOT_FOUND', 'Comanda aberta n\u00e3o encontrada.')
    return json({ document: createTableTabPrintDocument(detail) })
  }
  const tableTabPrintJobMatch = url.pathname.match(/^\/api\/table-tabs\/([^/]+)\/print-jobs$/)
  if (tableTabPrintJobMatch && request.method === 'POST') {
    requireCapability(context, 'comandas.view')
    requireCapability(context, 'printing.execute')
    assertSameOriginMutation(request)
    const body = await readJson(request)
    const tableTabId = decodeURIComponent(tableTabPrintJobMatch[1])
    const detail = await loadOpenTableTabDetail(env.DB, session.businessId, tableTabId)
    if (!detail) throw apiError(404, 'TABLE_TAB_NOT_FOUND', 'Comanda aberta não encontrada.')
    const job = await createManualTableTabPrintJob(env.DB, session.businessId, {
      tableTabId,
      copies: body.copies,
      document: createTableTabPrintDocument(detail),
      actorLabel: printingActor(context).displayName,
    })
    return json({ job }, { status: 201 })
  }
  const tableTabDetailMatch = url.pathname.match(/^\/api\/table-tabs\/([^/]+)$/)
  if (tableTabDetailMatch && request.method === 'GET') {
    requireCapability(context, 'comandas.view')
    const tableTab = await loadOpenTableTabDetail(env.DB, session.businessId, decodeURIComponent(tableTabDetailMatch[1]))
    if (!tableTab) throw apiError(404, 'TABLE_TAB_NOT_FOUND', 'Comanda aberta n\u00e3o encontrada.')
    return effectsJson({ tableTab })
  }
  const tableTabPaymentMatch = url.pathname.match(/^\/api\/table-tabs\/([^/]+)\/payment$/)
  if (tableTabPaymentMatch && request.method === 'POST') {
    requireCapability(context, 'payments.receive')
    requireCapability(context, 'comandas.view')
    assertSameOriginMutation(request)
    const { allocations, receivedDate } = await readJson(request)
    const result = await registerTableTabPayment(
      financeDb,
      session.businessId,
      decodeURIComponent(tableTabPaymentMatch[1]),
      validatePaymentAllocations(allocations),
      new Date(), {receivedDate},
    )
    return effectsJson({ ...result, tables: await listTables(env.DB, session.businessId) }, { status: 201 })
  }

  if (url.pathname === '/api/movements' && request.method === 'POST') {
    requireCapability(context, 'finance.movements.manage')
    assertSameOriginMutation(request)
    const movement = await createManualMovement(env.DB, session.businessId, parseManualMovementInput(await readJson(request)))
    return effectsJson({ movement }, { status: 201 })
  }
  const movementMatch = url.pathname.match(/^\/api\/movements\/([^/]+)$/)
  if (movementMatch && request.method === 'PATCH') {
    requireCapability(context, 'finance.movements.manage')
    assertSameOriginMutation(request)
    const id = decodeURIComponent(movementMatch[1])
    const movement = await updateManualMovement(env.DB, session.businessId, id, parseManualMovementInput(await readJson(request)))
    if (!movement) throw apiError(404, 'MOVEMENT_NOT_FOUND', 'Movimentação não encontrada.')
    return effectsJson({ movement })
  }
  if (movementMatch && request.method === 'DELETE') {
    requireCapability(context, 'finance.movements.manage')
    assertSameOriginMutation(request)
    const id = decodeURIComponent(movementMatch[1])
    const deletedMovementId = await softDeleteManualMovement(env.DB, session.businessId, id)
    if (!deletedMovementId) throw apiError(404, 'MOVEMENT_NOT_FOUND', 'Movimentação não encontrada.')
    return effectsJson({ deletedMovementId })
  }
  if (url.pathname === '/api/finance-settings' && request.method === 'PUT') {
    requireCapability(context, 'finance.movements.manage')
    assertSameOriginMutation(request)
    const financeSettings = await upsertFinanceSettings(env.DB, session.businessId, parseFinanceSettingsInput(await readJson(request)))
    return effectsJson({ financeSettings })
  }

  if (url.pathname === '/api/products' && request.method === 'POST') {
    requireCapability(context, 'products.manage')
    assertSameOriginMutation(request)
    const product = await createProduct(env.DB, session.businessId, productInput(await readJson(request)))
    return effectsJson({ product }, { status: 201 })
  }
  const productMatch = url.pathname.match(/^\/api\/products\/([^/]+)$/)
  if (productMatch && request.method === 'PATCH') {
    requireCapability(context, 'products.manage')
    assertSameOriginMutation(request)
    const product = await updateProduct(env.DB, session.businessId, decodeURIComponent(productMatch[1]), productInput(await readJson(request)))
    if (!product) throw apiError(404, 'PRODUCT_NOT_FOUND', 'Produto não encontrado.')
    return effectsJson({ product })
  }
  if (productMatch && request.method === 'DELETE') {
    requireCapability(context, 'products.manage')
    assertSameOriginMutation(request)
    const deleted = await deleteProduct(env.DB, session.businessId, decodeURIComponent(productMatch[1]))
    if (!deleted) throw apiError(404, 'PRODUCT_NOT_FOUND', 'Produto não encontrado.')
    return json({ deleted: true })
  }
  throw apiError(404, 'NOT_FOUND', 'Rota de API não encontrada.')
}

export const handleRequest = async (request, env, executionContext) => {
  if(realtimeEnabled(env) && env.BUSINESS_REALTIME) {
    const originalEnv=env
    env={...env,DB:withCommittedEffects(env.DB,{onCommitted:effect=>publishCommittedEffect(originalEnv,effect.businessId,effect,executionContext)})}
  }
  try {
    const url = new URL(request.url)
    if(url.pathname==='/api/realtime/socket' && request.method==='GET')return await handleRealtimeUpgrade(request,env)
    if (!multiCompanyEnabled(env) && [true, 'true'].includes(env.AUTH_MULTI_COMPANY_PREPARE_ENABLED)) {
      if (['/api/auth/email-challenges/inspect', '/api/auth/email-challenges/complete'].includes(url.pathname)) return await handleGlobalAuthApi(request, env)
      if (['/api/auth/company-invitations/inspect', '/api/auth/company-invitations/accept'].includes(url.pathname)) return await handleCompanyInvitationsApi(request, env)
    }
    if (multiCompanyEnabled(env)) {
      const options = { waitUntil: executionContext?.waitUntil?.bind(executionContext) }
      const identity = await handleGlobalAuthApi(request, env, options)
      if (identity) return identity
      const invitation = await handleCompanyInvitationsApi(request, env)
      if (invitation) return invitation
      const policy = classifyApiRoute(request.method, url.pathname)
      if (policy === 'platform') return await handlePlatformBusinessesApi(request, env, await resolveRequestContext(request, env), options)
      if (policy === 'public-tv') return await handleKitchenTvPublicApi(request, env, url)
      if (policy === 'business') return await authenticatedApi(request, env)
      if (url.pathname.startsWith('/api/')) throw apiError(404, 'NOT_FOUND', 'Rota de API não encontrada.')
      if (!env.ASSETS?.fetch) throw apiError(404, 'NOT_FOUND', 'Página não encontrada.')
      return env.ASSETS.fetch(request)
    }
    if (url.pathname === '/api/access/invitations/accept' && request.method === 'POST') return await acceptAccessInvitation(request, env, BUSINESS_ID)
    const emailAuthResponse = url.pathname==='/api/auth/login' ? null : await handleEmailAuthApi(request,env,{businessId:BUSINESS_ID,waitUntil:executionContext?.waitUntil?.bind(executionContext)})
    if (emailAuthResponse) return emailAuthResponse
    if (url.pathname === '/api/auth/login' && request.method === 'POST') return await login(request, env)
    if (url.pathname === '/api/auth/logout' && request.method === 'POST') return await logout(request, env)
    if (url.pathname === '/api/auth/session' && request.method === 'GET') return await sessionStatus(request, env)
    const kitchenTvResponse = await handleKitchenTvPublicApi(request, env, url)
    if (kitchenTvResponse) return kitchenTvResponse
    if (url.pathname.startsWith('/api/')) return await authenticatedApi(request, env)
    if (!env.ASSETS?.fetch) throw apiError(404, 'NOT_FOUND', 'Página não encontrada.')
    return env.ASSETS.fetch(request)
  } catch (error) { const response=handleError(error); if (new URL(request.url).pathname.startsWith('/api/')) response.headers.set('cache-control','no-store'); return response }
}

export default { fetch: handleRequest }
