export class MemoryStorage {
  data = new Map()
  queue = Promise.resolve()
  async get(key) { return structuredClone(this.data.get(key)) }
  async put(key,value) { this.data.set(key,structuredClone(value)) }
  async delete(key) { return this.data.delete(key) }
  async list({prefix='',limit=Infinity}={}) { return new Map([...this.data].filter(([key])=>key.startsWith(prefix)).sort(([a],[b])=>a.localeCompare(b)).slice(0,limit).map(([key,value])=>[key,structuredClone(value)])) }
  transaction(callback) {
    const result=this.queue.then(async()=>{
      const before=structuredClone(this.data)
      try { return await callback(this) } catch(error) { this.data=before;throw error }
    })
    this.queue=result.catch(()=>{})
    return result
  }
}
export class TestSocket {
  readyState=1
  messages=[]
  bufferedAmount=0
  attachment=null
  failSend=false
  send(text) { if(this.failSend)throw new Error('backpressure');this.messages.push(JSON.parse(text)) }
  close(code,reason) { this.readyState=3;this.closed={code,reason} }
  serializeAttachment(value) { this.attachment=structuredClone(value) }
  deserializeAttachment() { return structuredClone(this.attachment) }
}
export function createHubFixture() {
  const sockets=[], storage=new MemoryStorage(), clock={now:Date.parse('2026-10-14T18:00:00.000Z')}
  const ctx={id:{toString:()=> 'a'.repeat(64)},storage,acceptWebSocket(socket){sockets.push(socket)},getWebSockets(){return sockets.filter(socket=>socket.readyState!==3)}}
  const options={now:()=>clock.now,createPair:()=>({0:{},1:new TestSocket()}),upgradeResponse:socket=>({status:101,webSocket:socket})}
  const descriptor={kind:'human',businessId:'company-A',principalId:'account-A',sessionId:'session-A',contextId:'context-A',authVersion:'auth-v1',topics:['orders','printing'],expiresAt:'2026-10-15T00:00:00.000Z'}
  return {ctx,storage,sockets,clock,options,descriptor}
}
