// Test-only workerd entry. Wrangler production/staging never imports this module.
import api,{BusinessRealtimeHub} from '../../../worker/entry.js'
export {BusinessRealtimeHub}
function meterDb(db,stats){
  const originals=new WeakMap()
  const record=(result,sql)=>{stats.rowsRead+=Number(result.meta?.rows_read || 0);stats.rowsWritten+=Number(result.meta?.rows_written || 0);stats.sqlStatements++;if(/\bFROM audit_events\b/i.test(sql))stats.auditRowsRead+=Number(result.meta?.rows_read || 0);if(/\bFROM (orders|order_items)\b/i.test(sql))stats.orderRowsRead+=Number(result.meta?.rows_read || 0);return result}
  const wrap=(statement,sql)=>{
    const value={bind:(...values)=>wrap(statement.bind(...values),sql),async all(){return record(await statement.all(),sql)},async run(){return record(await statement.run(),sql)},async first(column){const row=(await value.all()).results?.[0];return row?(column===undefined?row:row[column]):null}}
    originals.set(value,{statement,sql});return value
  }
  return {prepare:sql=>wrap(db.prepare(sql),sql),async batch(statements){return (await db.batch(statements.map(s=>originals.get(s)?.statement||s))).map((result,index)=>record(result,originals.get(statements[index])?.sql || ''))}}
}
export default {async fetch(request,env,ctx){
  const stats={rowsRead:0,rowsWritten:0,sqlStatements:0,durableRequests:0,auditRowsRead:0,orderRowsRead:0}
  const namespace=env.BUSINESS_REALTIME
  const metered={idFromName:name=>namespace.idFromName(name),idFromString:id=>namespace.idFromString(id),get(id){
    const stub=namespace.get(id),proxy={}
    for(const name of ['issueTicket','consumeTicket','renew','publish','invalidate','fetch'])proxy[name]=(...args)=>{
      if(name==='publish' && request.headers.get('X-Gate-Drop-Publication')==='1')return Promise.reject(new Error('GATE_DROPPED_PUBLICATION'))
      stats.durableRequests++;return stub[name](...args)
    }
    return proxy
  }}
  const response=await api.fetch(request,{...env,DB:meterDb(env.DB,stats),BUSINESS_REALTIME:metered},ctx)
  const headers=new Headers(response.headers);headers.set('X-Mesiva-Gate-Metrics',JSON.stringify(stats))
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers,...(response.webSocket?{webSocket:response.webSocket}:{})})
}}
