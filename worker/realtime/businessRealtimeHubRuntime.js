import { DurableObject } from 'cloudflare:workers'
import { BusinessRealtimeHub } from './businessRealtimeHub.js'

export class BusinessRealtimeHubRuntime extends DurableObject {
  constructor(ctx,env) { super(ctx,env);this.hub=new BusinessRealtimeHub(ctx,env) }
  issueTicket(descriptor) { return this.hub.issueTicket(descriptor) }
  consumeTicket(ticket) { return this.hub.consumeTicket(ticket) }
  renew(connectionId,descriptor) { return this.hub.renew(connectionId,descriptor) }
  publish(effect) { return this.hub.publish(effect) }
  invalidate(target) { return this.hub.invalidate(target) }
  fetch(request) { return this.hub.fetch(request) }
  webSocketMessage(socket,message) { return this.hub.webSocketMessage(socket,message) }
  webSocketClose(socket) { return this.hub.webSocketClose(socket) }
  webSocketError(socket) { return this.hub.webSocketError(socket) }
}
