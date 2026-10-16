export class FakeClock {
  time=Date.parse('2026-10-14T15:00:00Z');next=1;timers=new Map()
  now=()=>this.time
  setTimeout=(callback,delay)=>{const id=this.next++;this.timers.set(id,{at:this.time+delay,callback});return id}
  clearTimeout=id=>this.timers.delete(id)
  async tick(ms){const end=this.time+ms;for(let n=0;n<10000;n++){
    await settle()
    const next=[...this.timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0]
    if(!next){this.time=end;await settle();return}
    this.time=next[1].at;this.timers.delete(next[0]);next[1].callback()
  }throw new Error('Timer loop')}
}
export async function settle(){for(let n=0;n<10;n++)await Promise.resolve()}
export class FakeSocket {
  readyState=1;sent=[];closed=false
  send(value){this.sent.push(JSON.parse(value))}
  close(){this.closed=true;this.readyState=3;this.onclose?.({})}
  message(value){this.onmessage?.({data:JSON.stringify(value)})}
  ready(clock,revision='1'){this.message({version:1,type:'ready',revision,topics:['orders','printing'],orderIds:[],connectionId:'connection',expiresAt:new Date(clock.now()+75_000).toISOString()})}
  invalidate(revision,ids=['o1']){this.message({version:1,type:'invalidate',revision,topics:['orders'],orderIds:ids})}
}
export function clientFixture(){
  const clock=new FakeClock(),sockets=[],events=[],states=[],attemptTimes=[],renewals=[]
  const api={prepare:async()=>({enabled:true,ticket:'a'.repeat(64)+'.'+'b'.repeat(43),socketPath:'/api/realtime/socket',protocol:'mesiva.realtime.v1'}),renew:async id=>{renewals.push({id,at:clock.now()});return {expiresAt:new Date(clock.now()+75_000).toISOString()}}}
  const createSocket=(url,protocols)=>{const socket=new FakeSocket();socket.url=url;socket.protocols=protocols;sockets.push(socket);attemptTimes.push(clock.now());return socket}
  return {clock,sockets,events,states,attemptTimes,renewals,api,createSocket}
}
