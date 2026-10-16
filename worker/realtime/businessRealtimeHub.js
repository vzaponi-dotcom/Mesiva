import { REALTIME_PROTOCOL, REALTIME_TOPICS, REALTIME_MAX_IDS, parseRealtimeMessage } from '../../shared/realtimeProtocol.js'

const LEASE_MS = 75000, TICKET_MS = 60000
const fail = (status,code) => Object.assign(new Error(code),{status,code})
const textId = value => typeof value === 'string' && value.length <= 200 && Boolean(value.trim())
const hash = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(byte=>byte.toString(16).padStart(2,'0')).join('')
const nonce = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')
function limit(env,key,maximum) {
  const value=Number(env[key] ?? maximum)
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw fail(500,'INVALID_REALTIME_LIMIT')
  return value
}
function descriptor(value,now) {
  if (!value || !['human','tv'].includes(value.kind) || !['businessId','principalId','sessionId','contextId','authVersion'].every(key=>textId(value[key]))
    || !Array.isArray(value.topics) || value.topics.length===0 || !value.topics.every(topic=>REALTIME_TOPICS.includes(topic))
    || new Set(value.topics).size!==value.topics.length || typeof value.expiresAt!=='string' || !(Date.parse(value.expiresAt)>now)) throw fail(403,'INVALID_REALTIME_ACCESS')
  return Object.fromEntries(['kind','businessId','principalId','sessionId','contextId','authVersion','topics','expiresAt'].map(key=>[key,structuredClone(value[key])]))
}

// Runtime inheritance is kept in the small adapter, so this logic runs under node:test too.
export class BusinessRealtimeHub {
  constructor(ctx,env={},options={}) {
    this.ctx=ctx
    this.now=options.now ?? (()=>Date.now())
    this.createPair=options.createPair ?? (()=>new WebSocketPair())
    this.upgradeResponse=options.upgradeResponse ?? (socket=>new Response(null,{status:101,webSocket:socket,headers:{'Sec-WebSocket-Protocol':REALTIME_PROTOCOL}}))
    this.maxConnections=limit(env,'REALTIME_MAX_CONNECTIONS',25)
    this.maxPrincipal=limit(env,'REALTIME_MAX_CONNECTIONS_PER_PRINCIPAL',5)
    this.maxTickets=limit(env,'REALTIME_MAX_PENDING_TICKETS',25)
  }
  async issueTicket(input) {
    const access=descriptor(input,this.now()),ticket=`${this.ctx.id.toString()}.${nonce()}`,key=`ticket:${await hash(ticket)}`
    const expiresAt=new Date(Math.min(this.now()+TICKET_MS,Date.parse(access.expiresAt))).toISOString()
    await this.ctx.storage.transaction(async storage=>{
      const company=await storage.get('businessId')
      if (company && company!==access.businessId) throw fail(403,'REALTIME_COMPANY_MISMATCH')
      const tickets=await storage.list({prefix:'ticket:',limit:26})
      let pending=0
      for (const [storedKey,value] of tickets) {
        if (Date.parse(value.expiresAt)<=this.now()) await storage.delete(storedKey)
        else pending++
      }
      if (pending>=this.maxTickets) throw fail(429,'REALTIME_TICKET_LIMIT')
      if (!company) await storage.put('businessId',access.businessId)
      await storage.put(key,{access,expiresAt})
    })
    return {ticket,expiresAt}
  }
  async consumeTicket(ticket) {
    if (typeof ticket!=='string' || !/^[a-f0-9]{64}\.[A-Za-z0-9_-]{43}$/.test(ticket) || !ticket.startsWith(this.ctx.id.toString()+'.')) return null
    const key=`ticket:${await hash(ticket)}`
    return this.ctx.storage.transaction(async storage=>{
      const stored=await storage.get(key)
      if (!stored) return null
      await storage.delete(key)
      return Date.parse(stored.expiresAt)>this.now() && Date.parse(stored.access.expiresAt)>this.now() ? stored.access : null
    })
  }
  attachment(socket) {
    try { return socket.deserializeAttachment() } catch { return null }
  }
  close(socket,code=1008) {
    try { socket.close(code,'Realtime access ended') } catch { /* Already disconnected. */ }
  }
  send(socket,message) {
    try {
      if (socket.readyState!==1) { this.close(socket,1013);return false }
      socket.send(JSON.stringify(message));return true
    } catch { this.close(socket,1013);return false }
  }
  async fetch(request) {
    if (new URL(request.url).origin!=='https://realtime.internal' || new URL(request.url).pathname!=='/connect') return new Response(null,{status:404})
    if (request.headers.get('Upgrade')?.toLowerCase()!=='websocket') return new Response(null,{status:426})
    let access
    try { access=descriptor(JSON.parse(request.headers.get('X-Mesiva-Realtime-Descriptor')),this.now()) } catch { return new Response(null,{status:403}) }
    if (await this.ctx.storage.get('businessId')!==access.businessId) return new Response(null,{status:403})
    const revision=await this.ctx.storage.get('revision') ?? '0'
    const active=[]
    for (const socket of this.ctx.getWebSockets()) {
      const data=this.attachment(socket)
      if (!data || data.leaseExpiresAt<=this.now() || Date.parse(data.access.expiresAt)<=this.now()) this.close(socket)
      else if (socket.readyState===1) active.push(data)
    }
    if (active.length>=this.maxConnections || active.filter(data=>data.access.principalId===access.principalId).length>=this.maxPrincipal) return new Response(null,{status:429})
    const pair=this.createPair(),client=pair[0],server=pair[1],connectionId=crypto.randomUUID()
    const leaseExpiresAt=Math.min(this.now()+LEASE_MS,Date.parse(access.expiresAt))
    this.ctx.acceptWebSocket(server)
    server.serializeAttachment({connectionId,access,leaseExpiresAt,pendingMessages:0,lastSentRevision:revision})
    this.send(server,{version:1,type:'ready',revision,topics:access.topics,orderIds:[],connectionId,expiresAt:new Date(leaseExpiresAt).toISOString()})
    return this.upgradeResponse(client)
  }
  async renew(connectionId,input) {
    const access=descriptor(input,this.now())
    const socket=this.ctx.getWebSockets().find(socket=>this.attachment(socket)?.connectionId===connectionId)
    const data=socket && this.attachment(socket)
    if (!data || socket.readyState!==1 || data.leaseExpiresAt<=this.now()) throw fail(409,'REALTIME_CONNECTION_EXPIRED')
    if (['kind','businessId','principalId','sessionId','contextId'].some(key=>data.access[key]!==access[key])) throw fail(403,'REALTIME_CONNECTION_OWNER_MISMATCH')
    if (data.access.authVersion!==access.authVersion || JSON.stringify(data.access.topics)!==JSON.stringify(access.topics) || data.access.expiresAt!==access.expiresAt) {
      const revision=await this.ctx.storage.get('revision') ?? '0'
      this.send(socket,{version:1,type:'access_changed',revision,topics:[],orderIds:[]});this.close(socket)
      throw fail(409,'REALTIME_ACCESS_CHANGED')
    }
    data.leaseExpiresAt=Math.min(this.now()+LEASE_MS,Date.parse(access.expiresAt))
    socket.serializeAttachment(data)
    return {expiresAt:new Date(data.leaseExpiresAt).toISOString()}
  }
  async publish({topics,orderIds=[]}) {
    if (!Array.isArray(topics) || !topics.length || !topics.every(topic=>REALTIME_TOPICS.includes(topic)) || !Array.isArray(orderIds) || !orderIds.every(textId)) throw fail(400,'INVALID_REALTIME_EFFECT')
    const revision=await this.ctx.storage.transaction(async storage=>{
      const next=(BigInt(await storage.get('revision') ?? '0')+1n).toString()
      await storage.put('revision',next);return next
    })
    for (const socket of this.ctx.getWebSockets()) {
      const data=this.attachment(socket)
      if (!data || data.leaseExpiresAt<=this.now() || Date.parse(data.access.expiresAt)<=this.now()) { this.close(socket);continue }
      const allowed=[...new Set(topics)].filter(topic=>data.access.topics.includes(topic))
      if (!allowed.length) continue
      if ((data.pendingMessages ?? 0)>=32) { this.close(socket,1013);continue }
      let message={version:1,type:'invalidate',revision,topics:allowed,orderIds:allowed.includes('orders')?[...new Set(orderIds)]:[]}
      if (message.orderIds.length>REALTIME_MAX_IDS || !parseRealtimeMessage(message)) message={...message,type:'resync_required',orderIds:[]}
      if (this.send(socket,message)) {
        data.pendingMessages=(data.pendingMessages ?? 0)+1
        data.lastSentRevision=revision
        socket.serializeAttachment(data)
      }
    }
    return revision
  }
  async invalidate({scope,id}) {
    if (!['session','principal','business'].includes(scope) || !textId(id)) throw fail(400,'INVALID_REALTIME_INVALIDATION')
    const field={session:'sessionId',principal:'principalId',business:'businessId'}[scope]
    const revision=await this.ctx.storage.get('revision') ?? '0'
    for (const socket of this.ctx.getWebSockets()) {
      if (this.attachment(socket)?.access[field]!==id) continue
      this.send(socket,{version:1,type:'access_changed',revision,topics:[],orderIds:[]});this.close(socket)
    }
  }
  webSocketMessage(socket,message) {
    const data=this.attachment(socket)
    if (!data || data.leaseExpiresAt<=this.now() || typeof message!=='string' || new TextEncoder().encode(message).length>512) { this.close(socket);return }
    let ack
    try { ack=JSON.parse(message) } catch { this.close(socket);return }
    if (!ack || ack.version!==1 || ack.type!=='ack' || typeof ack.revision!=='string' || !/^(0|[1-9][0-9]{0,79})$/.test(ack.revision)
      || Object.keys(ack).some(key=>!['version','type','revision'].includes(key)) || BigInt(ack.revision)>BigInt(data.lastSentRevision)) { this.close(socket);return }
    if (ack.revision===data.lastSentRevision) { data.pendingMessages=0;socket.serializeAttachment(data) }
  }
  webSocketClose(socket) { this.close(socket,1000) }
  webSocketError(socket) { this.close(socket,1011) }
}
