import { REALTIME_PROTOCOL } from '../../shared/realtimeProtocol.js'
import { apiError, assertSameOriginMutation, json, readJson } from '../http.js'
import { authenticateAccountRequest, getRoleGrantsSnapshot, contextChanged } from '../identity/sessions.js'
import { requireBusinessContext } from '../tenancy/businessContext.js'
import { multiCompanyEnabled } from '../tenancy/routePolicy.js'
import { authenticatedTv } from '../kitchenTvSession.js'
import { loadKitchenTvSessionByHash } from '../kitchenTvRepository.js'
import { readKitchenTvSessionToken, hashKitchenTvToken } from '../kitchenTvAuth.js'
import { sha256Hex } from '../auth.js'

export const realtimeEnabled=env=>env.REALTIME_ENABLED===true || env.REALTIME_ENABLED==='true'
const denied=()=>apiError(403,'FORBIDDEN','Você não tem acesso a esta conexão.')
const unavailable=()=>apiError(503,'REALTIME_UNAVAILABLE','Atualização por eventos indisponível no momento.')
const hasAny=(session,keys)=>keys.some(key=>session.granted?.has(key))
const topicCapabilities={orders:['orders.view','orders.history'],tables:['tables.view','comandas.view'],reservations:['orders.view','tables.view'],clients:['clients.view'],catalog:['products.view'],finance:['finance.overview','finance.movements','finance.receivables'], 'kitchen-tv':['orders.view'],printing:['printing.queue','printing.execute','printing.settings','printing.settings.view','printing.station.view']}
function namespace(env) { if(!env.BUSINESS_REALTIME)throw unavailable();return env.BUSINESS_REALTIME }
const companyHub=(env,businessId)=>{const ns=namespace(env);return ns.get(ns.idFromName(`business:${businessId}`))}
async function rpc(callback) {
  try { return await callback() } catch(error) {
    const code=error?.code || error?.message
    if(code==='REALTIME_ACCESS_CHANGED')throw contextChanged()
    const status={REALTIME_TICKET_LIMIT:429,REALTIME_COMPANY_MISMATCH:403,INVALID_REALTIME_ACCESS:403,REALTIME_CONNECTION_OWNER_MISMATCH:403,REALTIME_CONNECTION_EXPIRED:409}[code]
    if(status)throw apiError(status,code,'Não foi possível manter esta conexão de atualização.')
    throw unavailable()
  }
}
async function humanDescriptor(session) {
  if(!session || session.scope!=='business' || !session.identitySessionId || !session.accountId || !session.businessId)throw denied()
  const topics=Object.entries(topicCapabilities).filter(([,keys])=>hasAny(session,keys)).map(([topic])=>topic)
  // Settings responses already project by the same session; this is only an invalidation.
  topics.push('settings')
  const authVersion=await sha256Hex(JSON.stringify({roleId:session.roleId,roleVersion:session.roleVersion,credentialRevision:session.credentialRevision,grants:getRoleGrantsSnapshot(session) ?? [...session.granted].sort()}))
  return {kind:'human',businessId:session.businessId,principalId:session.accountId,sessionId:session.identitySessionId,contextId:session.contextId,authVersion,topics,expiresAt:session.expiresAt}
}
async function tvDescriptor(access) {
  return {kind:'tv',businessId:access.businessId,principalId:`tv:${access.sessionTokenHash}`,sessionId:access.sessionTokenHash,contextId:access.sessionTokenHash,
    authVersion:await sha256Hex(JSON.stringify([access.sessionTokenHash,access.sessionIssuedAt])),topics:['orders','kitchen-tv'],
    // Existing server-side pairing has no hard expiry; every75s lease still revalidates it.
    expiresAt:'9999-12-31T23:59:59.999Z'}
}
async function prepare(env,access) {
  const issued=await rpc(()=>companyHub(env,access.businessId).issueTicket(access))
  return json({enabled:true,...issued,socketPath:'/api/realtime/socket',protocol:REALTIME_PROTOCOL},{headers:{'cache-control':'no-store'}})
}
async function renew(request,env,access) {
  const body=await readJson(request)
  if(Object.keys(body).length!==1 || typeof body.connectionId!=='string' || !body.connectionId.trim() || body.connectionId.length>200)throw apiError(400,'INVALID_REALTIME_CONNECTION','Informe uma conexão válida.')
  const result=await rpc(()=>companyHub(env,access.businessId).renew(body.connectionId,access))
  return json(result,{headers:{'cache-control':'no-store'}})
}
export async function handleHumanRealtimeApi(request,env,session,url=new URL(request.url)) {
  if(request.method!=='POST' || !['/api/realtime/prepare','/api/realtime/renew'].includes(url.pathname))return null
  assertSameOriginMutation(request)
  if(!multiCompanyEnabled(env))return json({enabled:false},{headers:{'cache-control':'no-store'}})
  requireBusinessContext(request,session)
  if(!realtimeEnabled(env))return json({enabled:false},{headers:{'cache-control':'no-store'}})
  const access=await humanDescriptor(session)
  return url.pathname.endsWith('/prepare')?prepare(env,access):renew(request,env,access)
}
export async function handleTvRealtimeApi(request,env,url=new URL(request.url)) {
  if(request.method!=='POST' || !['/api/kitchen-tv/realtime/prepare','/api/kitchen-tv/realtime/renew'].includes(url.pathname))return null
  assertSameOriginMutation(request)
  const {access}=await authenticatedTv(request,env)
  if(!realtimeEnabled(env))return json({enabled:false},{headers:{'cache-control':'no-store'}})
  const descriptor=await tvDescriptor(access)
  const response=await (url.pathname.endsWith('/prepare')?prepare(env,descriptor):renew(request,env,descriptor))
  await authenticatedTv(request,env)
  return response
}
export async function handleRealtimeUpgrade(request,env) {
  const url=new URL(request.url)
  if(request.headers.get('origin')!==url.origin)throw apiError(403,'ORIGIN_NOT_ALLOWED','Origem da requisição não permitida.')
  if(url.search || request.method!=='GET')throw apiError(400,'INVALID_REALTIME_UPGRADE','Conexão de atualização inválida.')
  if(!realtimeEnabled(env))throw apiError(404,'REALTIME_DISABLED','Atualização por eventos desativada.')
  if(request.headers.get('upgrade')?.toLowerCase()!=='websocket')throw apiError(426,'WEBSOCKET_REQUIRED','Esta rota requer WebSocket.')
  const protocols=(request.headers.get('sec-websocket-protocol') || '').split(',').map(value=>value.trim())
  const ticketProtocol=protocols.find(value=>/^ticket\.[a-f0-9]{64}\.[A-Za-z0-9_-]{43}$/.test(value))
  if(protocols.length!==2 || !protocols.includes(REALTIME_PROTOCOL) || !ticketProtocol)throw apiError(400,'INVALID_REALTIME_TICKET','Ticket de conexão inválido.')
  const ticket=ticketProtocol.slice(7),ns=namespace(env)
  let hub
  try { hub=ns.get(ns.idFromString(ticket.slice(0,64))) } catch { throw apiError(400,'INVALID_REALTIME_TICKET','Ticket de conexão inválido.') }
  const access=await rpc(()=>hub.consumeTicket(ticket))
  if(!access)throw apiError(401,'REALTIME_TICKET_EXPIRED','A conexão precisa ser preparada novamente.')
  let current
  if(access.kind==='human') {
    const session=await authenticateAccountRequest(request,env)
    if(!session)throw apiError(401,'UNAUTHENTICATED','Sua sessão expirou. Entre novamente.')
    current=await humanDescriptor(session)
  } else if(access.kind==='tv') {
    const token=readKitchenTvSessionToken(request)
    if(token && await hashKitchenTvToken(token)!==access.sessionId)throw denied()
    const paired=await loadKitchenTvSessionByHash(env.DB,access.sessionId,access.businessId,{requireActive:multiCompanyEnabled(env)})
    if(!paired)throw apiError(401,'KITCHEN_TV_UNAUTHORIZED','Este painel não está mais autorizado.')
    current=await tvDescriptor(paired)
  } else throw denied()
  if(JSON.stringify(current)!==JSON.stringify(access))throw contextChanged()
  // Construct the internal request; never forward browser credentials or descriptor headers.
  return rpc(()=>hub.fetch(new Request('https://realtime.internal/connect',{headers:{upgrade:'websocket','Sec-WebSocket-Protocol':REALTIME_PROTOCOL,'X-Mesiva-Realtime-Descriptor':JSON.stringify(current)}})))
}
