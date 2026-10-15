import {loadOrderAttributions} from '../../worker/access/attribution.js'
import {getBusinessDate} from '../../shared/finance.js'
import {validateCheckoutInput} from '../../worker/orderCheckout.js'
import assert from 'node:assert/strict'
import {readFileSync,readdirSync,writeFileSync,mkdirSync} from 'node:fs'
import {homedir} from 'node:os'
import {join,resolve,dirname} from 'node:path'
import {createRequire} from 'node:module'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {setTimeout as sleep} from 'node:timers/promises'
import {createTenancyFixture} from '../../worker/test-support/tenancyDb.js'
import {prepareAccountSession} from '../../worker/identity/sessions.js'
import {commitIdentityStatements} from '../../worker/identity/transactions.js'
import {createKitchenTvCredential} from '../../worker/kitchenTvAuth.js'
import {seedOperationalReadFixture} from '../../worker/test-support/operationalReadFixture.js'
import {createRealtimeClient} from '../../src/infrastructure/realtime/realtimeClient.js'
import {FakeClock} from '../../src/infrastructure/realtime/test-support/clientFixture.js'
import {projectMonthlyBudget} from './realtime-budget-report.mjs'
const root=fileURLToPath(new URL('../../',import.meta.url)),origin='https://realtime-gate.test'
const metrics=['rowsRead','rowsWritten','sqlStatements','durableRequests','auditRowsRead','orderRowsRead']
async function runtime(){
  const cache=process.env.npm_config_cache ?? (process.platform==='win32'?join(process.env.LOCALAPPDATA,'npm-cache'):join(homedir(),'.npm'))
  const pkg=readdirSync(join(cache,'_npx')).map(n=>join(cache,'_npx',n,'node_modules/wrangler/package.json')).find(p=>{try{return JSON.parse(readFileSync(p,'utf8')).version==='4.128.0'}catch{return false}})
  assert.ok(pkg,'Wrangler4.128.0 must be cached for the real gate')
  const require=createRequire(pkg)
  return {...await import(pathToFileURL(require.resolve('miniflare'))),...await import(pathToFileURL(require.resolve('esbuild')))}
}
async function waitFor(predicate,label,timeout=60000){const end=Date.now()+timeout;while(!predicate()){if(Date.now()>end)throw new Error(`Gate timeout: ${label}`);await sleep(10)}}
export function assertRealtimeRuntimeGate(report){
  const r=report.invariants
  assert.equal(r.legacyGlobalPolls,0,'legacy global polling remains')
  assert.equal(r.hibernationRecovered,true,'hibernation did not retain sockets/revision')
  assert.equal(r.restartConnectedClients,5,'restart lost clients')
  assert.equal(r.lostEventConvergedClients,5,'lost publication did not reconcile')
  assert.ok(r.convergenceVirtualMs<=331000,'lost event exceeded reconciliation window')
  assert.equal(r.publicationFailureMutationCount,1,'publication failure repeated mutation')
  assert.equal(r.unchangedHeartbeatNotifications,0,'no-change heartbeat broadcast')
  assert.equal(r.unknownClaimedAgain,false,'unknown outcome retried automatically')
  assert.equal(r.concurrentClaimWinners,1,'claim admitted multiple winners')
  assert.ok(report.pointReadHistoryGrowth<=32,'history multiplied point reads')
  assert.ok(report.scopedBootstrapHistoryGrowth<=32,'history multiplied scoped bootstrap reads')
  if(report.fixture?.historicalOrders>=1000)assert.ok(report.operations.historySearch.rowsRead<=report.fixture.historicalOrders*35+5000,'historical search repeatedly scanned the timeline prefix')
  assert.equal(report.historyPreserved,true,'historical orders were dropped')
  for(const op of Object.values(report.operations))for(const field of metrics)assert.ok(Number.isFinite(op[field]) && op[field]>=0,`invalid ${field}`)
  return true
}
export async function runRealtimeRuntimeGate({devices=5,historicalOrders=10000}={}){
  assert.equal(devices,5,'Gate requires five clients including TV')
  const progress=label=>{if(process.env.REALTIME_GATE_PROGRESS)console.error(`realtime-gate:${label}`)}
  const {Miniflare,convertV4MiniflareOptions,Log,LogLevel,build}=await runtime()
  const bundle=await build({entryPoints:[join(root,'scripts/infra/fixtures/realtime-gate-worker.js')],bundle:true,write:false,format:'esm',platform:'neutral',target:'es2022',external:['cloudflare:workers']})
  const orderInput={customerIdentity:{type:'registered_client',clientId:'gate-client'},type:'Entrega',orderDate:getBusinessDate(),items:[{productId:'gate-product',quantity:1,note:''}],deliveryFee:0,adjustment:{type:'none',mode:'fixed',value:0,reason:''}}
  validateCheckoutInput(orderInput,'gate-fixture-validation')
  const fixture=await createTenancyFixture(undefined,{operationalDefaults:true}),businessId=fixture.businesses.A,at=new Date().toISOString(),operations={},samples=[],bridges=[],clients=[],clock=new FakeClock()
  clock.time=Date.now()
  const prepared=await prepareAccountSession(fixture.db,{accountId:fixture.accounts.alice,businessId,scope:'business',expectedCredentialRevision:1})
  await commitIdentityStatements(fixture.db,prepared.statements)
  const session=prepared.value,tv=await createKitchenTvCredential()
  fixture.sqlite.prepare('INSERT INTO kitchen_tv_access(business_id,session_token_hash,session_issued_at,created_at,updated_at) VALUES(?,?,?,?,?)').run(businessId,tv.tokenHash,at,at,at)
  fixture.sqlite.prepare("INSERT INTO products(id,business_id,category,size,name,price_cents,active,created_at,updated_at) VALUES('gate-product',?,'Meals','','Prato fictício',1000,1,?,?)").run(businessId,at,at)
  fixture.sqlite.prepare("INSERT INTO clients(id,business_id,name,created_at,updated_at) VALUES('gate-client',?,'Cliente fictício',?,?)").run(businessId,at,at)
  const mf=new Miniflare((convertV4MiniflareOptions??(o=>o))({name:'mesiva-realtime-gate',modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-09-01',d1Databases:{DB:'realtime-runtime-gate'},durableObjects:{BUSINESS_REALTIME:{className:'BusinessRealtimeHub',useSQLite:true}},bindings:{AUTH_MULTI_COMPANY_ENABLED:'true',AUTH_EMAIL_ENABLED:'true',AUTH_MULTI_COMPANY_PREPARE_ENABLED:'false',REALTIME_ENABLED:'true',OPERATIONAL_READ_MODELS_ENABLED:'true',AUTH_PUBLIC_ORIGIN:origin},log:new Log(LogLevel.ERROR)}))
  let activeHttp=0,activeJson=0
  const record=(name,response,elapsed)=>{
    assert.ok(response.headers.has('X-Mesiva-Gate-Metrics'),'real HTTP D1 metrics missing')
    const value=JSON.parse(response.headers.get('X-Mesiva-Gate-Metrics'))
    samples.push({name,...value})
    const op=operations[name] ??= Object.fromEntries(metrics.map(k=>[k,0]))
    for(const field of metrics)op[field]=Math.max(op[field],value[field])
    op.localWallMs=Math.max(op.localWallMs || 0,elapsed)
  }
  const send=async(name,path,{tvMode=false,method='GET',body,headers={},signal}={})=>{
    activeHttp++;const started=performance.now()
    try {
      const response=await mf.dispatchFetch(origin+path,{method,signal,headers:{origin,...(tvMode?{'x-kitchen-tv-session':tv.token}:{cookie:`mesiva_session=${session.token}`,'X-Mesiva-Context':session.contextId}),...(body!==undefined?{'content-type':'application/json'}:{}),...headers},...(body!==undefined?{body:JSON.stringify(body)}:{})})
      record(name,response,performance.now()-started)
      if(!response.ok && response.status!==101){const error=await response.json().catch(()=>({}));throw new Error(`${name}: HTTP${response.status} ${error.error?.code || 'UNKNOWN'}`)}
      return response
    }finally{activeHttp--}
  }
  const json=async(name,path,options)=>{activeJson++;try{return await (await send(name,path,options)).json()}finally{activeJson--}}
  try {
    const db=await mf.getD1Database('DB')
    const schema=fixture.sqlite.prepare("SELECT type,name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END").all()
    for(const row of schema)await db.prepare(row.sql).run()
    const seed=[]
    for(const table of schema.filter(row=>row.type==='table'))for(const row of fixture.sqlite.prepare(`SELECT * FROM ${table.name}`).all()){
      const columns=Object.keys(row);seed.push(db.prepare(`INSERT INTO ${table.name} (${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')})`).bind(...Object.values(row)))
    }
    await db.batch([db.prepare('PRAGMA defer_foreign_keys=ON'),...seed])
    progress('schema-and-identities')
    await json('bootstrapEmpty','/api/bootstrap')
    const ids=await seedOperationalReadFixture(db,{businessId,activeOrders:20,itemsPerOrder:5})
    const pointPath='/api/orders/by-ids?ids='+encodeURIComponent(JSON.stringify([ids.activeIds[0]]))
    await json('byIdsSmall',pointPath)
    await json('bootstrapScopedSmall','/api/bootstrap?surface=orders')
    await seedOperationalReadFixture(db,{businessId,historicalOrders,itemsPerOrder:5,historicalOffset:100000})
    await db.prepare(`WITH RECURSIVE n(x) AS(SELECT 0 UNION ALL SELECT x+1 FROM n WHERE x+1<?)
      INSERT INTO audit_events(id,business_id,occurred_at,actor_type,actor_name,action,resource_type,resource_id,result,metadata_json)
      SELECT 'gate-audit:'||x,?,?,'system','Sistema','order.created','order',?||CAST(x+100000 AS INTEGER),'success','{}' FROM n`).bind(historicalOrders,businessId,at,`${businessId}:history:`).run()
    await db.prepare(`WITH RECURSIVE n(x) AS(SELECT 0 UNION ALL SELECT x+1 FROM n WHERE x+1<3000)
      INSERT INTO print_jobs(id,business_id,order_id,type,trigger,status,copies_requested,copies_printed,snapshot_json,created_at,processed_at)
      SELECT 'gate-terminal:'||x,?,?||CAST((x%?)+100000 AS INTEGER),'order','automatic','printed',1,1,'{}',?,? FROM n`).bind(businessId,`${businessId}:history:`,historicalOrders,at,at).run()
    await db.prepare('INSERT INTO order_sequences(business_id,last_order_number) SELECT ?,COALESCE(MAX(order_number),0) FROM orders WHERE business_id=? ON CONFLICT(business_id) DO UPDATE SET last_order_number=excluded.last_order_number').bind(businessId,businessId).run()
    progress('history-seeded')
    await json('byIdsHistory',pointPath)
    await json('bootstrapScopedHistory','/api/bootstrap?surface=orders')
    await json('historyPage','/api/reads/orders/history?limit=50')
    await json('historySearch','/api/reads/orders/history?limit=50&search=prato%20ficticio')
    const attributionPlans=[]
    await loadOrderAttributions({prepare:sql=>({bind:(...values)=>({async all(){const result=await db.prepare(sql).bind(...values).all();attributionPlans.push({rowsRead:result.meta.rows_read,details:(await db.prepare('EXPLAIN QUERY PLAN '+sql).bind(...values).all()).results.map(row=>row.detail)});return result}})})},businessId,[ids.activeIds[0]])
    progress('point-reads:'+JSON.stringify({small:operations.byIdsSmall,large:operations.byIdsHistory,attributionPlans}))
    await json('bootstrap','/api/bootstrap')
    await json('tvState','/api/kitchen-tv/state',{tvMode:true})
    await json('controlState','/api/kitchen-tv/control')
    const stationResult=await json('stationUpsert','/api/printing/stations/gate-station',{method:'PUT',body:{name:'Estação fictícia',platform:'windows',autoPrintEnabled:true,defaultCopies:1}})
    assert.ok(stationResult.station)
    const primaryInfo=await json('printStations','/api/printing/stations')
    await json('stationPrimary','/api/printing/stations/gate-station/make-primary',{method:'POST',body:{expectedRevision:primaryInfo.primary.revision,mutationId:crypto.randomUUID()}})
    const heartbeat=(label='printHeartbeat')=>json(label,'/api/printing/stations/gate-station/heartbeat',{method:'POST',body:{qzReady:true,printerReady:true,physicalState:'ready'}})
    await heartbeat('stationHealth')
    await json('printStations','/api/printing/stations')
    await json('printJobs','/api/printing/jobs?limit=100')
    await json('printSummary','/api/printing/jobs/summary')
    await json('printClaim','/api/printing/jobs/claim-next',{method:'POST',body:{stationId:'gate-station'}})
    const states=Array.from({length:devices},()=>new Map()),readyCounts=Array(devices).fill(0),hintCounts=Array(devices).fill(0)
    function socketFactory(index,tvMode){return (url,protocols)=>{
      const bridge={readyState:0,sent:0,server:null,closed:false,send(data){this.sent++;this.server?.send(data)},close(){this.closed=true;this.readyState=3;try{this.server?.close(1000)}catch{/* already closed */}}};bridges.push(bridge)
      void send(tvMode?'upgradeTv':'upgradeHuman',new URL(url).pathname,{tvMode,headers:{upgrade:'websocket','sec-websocket-protocol':protocols.join(',')}}).then(response=>{
        assert.equal(response.status,101);assert.equal(response.headers.get('sec-websocket-protocol'),'mesiva.realtime.v1')
        const ws=response.webSocket;assert.ok(ws);bridge.server=ws
        ws.addEventListener('message',event=>{
          const message=JSON.parse(event.data)
          // Map real server lease timestamps onto the compressed client clock.
          // Server authentication/renewal/hibernation still run in real workerd.
          if(message.type==='ready'){message.expiresAt=new Date(clock.now()+75000).toISOString();readyCounts[index]++}
          if(message.type==='invalidate' || message.type==='resync_required')hintCounts[index]++
          bridge.onmessage?.({data:JSON.stringify(message)})
        })
        ws.addEventListener('close',event=>{bridge.readyState=3;bridge.onclose?.(event)})
        ws.addEventListener('error',event=>bridge.onerror?.(event))
        ws.accept();bridge.readyState=1;if(bridge.closed)bridge.close()
      }).catch(error=>{bridge.error=error;bridge.onerror?.({})})
      return bridge
    }}
    for(let index=0;index<devices;index++){
      const tvMode=index===devices-1
      const api={prepare:options=>json(tvMode?'prepareTv':'prepareHuman',tvMode?'/api/kitchen-tv/realtime/prepare':'/api/realtime/prepare',{tvMode,method:'POST',body:{},...options}),renew:async(connectionId,options)=>{
        const result=await json(tvMode?'renewTv':'renewHuman',tvMode?'/api/kitchen-tv/realtime/renew':'/api/realtime/renew',{tvMode,method:'POST',body:{connectionId},...options})
        return {...result,expiresAt:new Date(clock.now()+75000).toISOString()}
      }}
      const client=createRealtimeClient({api,clock,createSocket:socketFactory(index,tvMode),random:()=>.1+index*.2})
      let clientState='stopped';client.subscribeState(state=>clientState=state)
      client.subscribeInvalidations(async event=>{
        const topics=tvMode?['orders','kitchen-tv']:['orders','tables','reservations','clients','catalog','finance','settings']
        if(!event.topics.some(topic=>topics.includes(topic)))return
        if(tvMode){const data=await json('tvState','/api/kitchen-tv/state',{tvMode:true});states[index]=new Map(data.orders.map(order=>[order.id,order.status]))}
        else if(event.requiresFullRefresh || event.topics.some(topic=>['tables','reservations','clients','catalog','finance','settings'].includes(topic)) || !event.orderIds.length){
          const data=await json('bootstrap','/api/bootstrap');states[index]=new Map(data.orders.map(order=>[order.id,order.status]))
        }else{const data=await json('byIds','/api/orders/by-ids?ids='+encodeURIComponent(JSON.stringify(event.orderIds)));for(const order of data.orders)states[index].set(order.id,order.status)}
      })
      clients.push({client,get state(){return clientState}});client.start()
      await waitFor(()=>clientState==='live' || bridges.some(bridge=>bridge.error),'socket ready')
      const error=bridges.find(bridge=>bridge.error)?.error;if(error)throw error
      await clock.tick(250);await waitFor(()=>activeHttp===0 && activeJson===0 && states[index].size>0,'initial snapshot')
    }
    progress('five-clients-live')
    const tick=async ms=>{const target=clock.now()+ms;while(clock.now()<target){await clock.tick(Math.min(1000,target-clock.now()));await waitFor(()=>activeHttp===0,'compressed HTTP settled');await sleep(5)}}
    const idleStart=samples.length
    await tick(30000)
    const legacyGlobalPolls=samples.slice(idleStart).filter(sample=>['bootstrap','byIds'].includes(sample.name)).length
    const totalHints=()=>hintCounts.reduce((a,b)=>a+b,0)
    await heartbeat('stationHealth');await sleep(50)
    const hintsBefore=totalHints();await heartbeat();await sleep(50)
    const printingHeartbeatNotifications=totalHints()-hintsBefore
    const reportBody={appliedRevision:0,currentPage:1,pageCount:1,viewportWidth:1280,viewportHeight:720,visibleOrderIds:[]}
    const beforeTvReport=totalHints()
    await json('tvReportChanged','/api/kitchen-tv/report',{tvMode:true,method:'POST',body:reportBody})
    await waitFor(()=>totalHints()>beforeTvReport,'changed TV projection hint')
    await tick(250)
    const noChangeBefore=totalHints()
    await json('tvReport','/api/kitchen-tv/report',{tvMode:true,method:'POST',body:reportBody});await sleep(50)
    const unchangedHeartbeatNotifications=(totalHints()-noChangeBefore)+printingHeartbeatNotifications
    await tick(30000) // exercise real authenticated renewal at virtual60s
    const beforeHibernate=totalHints()
    await mf.unsafeEvictDurableObject('mesiva-realtime-gate','BusinessRealtimeHub',{name:`business:${businessId}`,webSockets:'hibernate'})
    await json('orderFinalize',`/api/orders/${encodeURIComponent(ids.activeIds[0])}/status`,{method:'PATCH',body:{status:'Finalizado'}})
    await waitFor(()=>totalHints()>beforeHibernate,'hibernated notification');await tick(250)
    const hibernationRecovered=clients.every(c=>c.state==='live')
    const lostId=ids.activeIds[1],lostStart=clock.now(),hintsAtLoss=totalHints()
    await json('orderFinalize',`/api/orders/${encodeURIComponent(lostId)}/status`,{method:'PATCH',body:{status:'Finalizado'},headers:{'X-Gate-Drop-Publication':'1'}})
    await sleep(50);assert.equal(totalHints(),hintsAtLoss,'fixture failed to drop publication')
    const converged=()=>states.every((state,index)=>index===devices-1?!state.has(lostId):state.get(lostId)==='Finalizado')
    while(!converged() && clock.now()-lostStart<331000)await tick(1000)
    const lostEventConvergedClients=states.filter((state,index)=>index===devices-1?!state.has(lostId):state.get(lostId)==='Finalizado').length
    const convergenceVirtualMs=clock.now()-lostStart
    const mutationCount=(await db.prepare("SELECT count(*) n FROM audit_events WHERE business_id=? AND resource_id=? AND action='order.finalized'").bind(businessId,lostId).first()).n
    progress('lost-publication-reconciled')
    const beforeRestart=[...readyCounts]
    await mf.unsafeEvictDurableObject('mesiva-realtime-gate','BusinessRealtimeHub',{name:`business:${businessId}`,webSockets:'close'})
    await waitFor(()=>clients.every(c=>c.state==='fallback'),'restart close')
    await tick(1500);await waitFor(()=>readyCounts.every((n,i)=>n>beforeRestart[i]),'restart reconnect')
    await tick(250)
    const restartConnectedClients=clients.filter(c=>c.state==='live').length
    await heartbeat()
    const created=await json('orderCreate','/api/orders',{method:'POST',headers:{'idempotency-key':crypto.randomUUID()},body:orderInput})
    const order=created.order
    assert.ok(order?.id)
    await json('payment',`/api/orders/${order.id}/payment`,{method:'POST',body:{allocations:[{methodCode:'pix',amountCents:1000}]}})
    const claims=await Promise.all([1,2].map(()=>json('printMutation','/api/printing/jobs/claim-next',{method:'POST',body:{stationId:'gate-station'}})))
    const winner=claims.find(value=>value.job)?.job
    assert.ok(winner,'fictional pending print was not claimed')
    const attempt=(await json('printMutation',`/api/printing/jobs/${winner.id}/attempts`,{method:'POST',body:{stationId:'gate-station',copyNumber:1}})).attempt
    await json('printMutation',`/api/printing/attempts/${attempt.id}/submitting`,{method:'POST',body:{stationId:'gate-station'}})
    await json('printMutation',`/api/printing/attempts/${attempt.id}/events`,{method:'POST',body:{stationId:'gate-station',event:{type:'ERROR',jobName:attempt.spoolJobName,spoolJobId:1}}})
    const nextClaim=await json('printClaim','/api/printing/jobs/claim-next',{method:'POST',body:{stationId:'gate-station'}})
    const historyPreserved=states.slice(0,-1).every(state=>[...state.keys()].filter(id=>id.includes(':history:')).length===historicalOrders)
    const report={commit:process.env.GITHUB_SHA || null,workingTree:!process.env.GITHUB_SHA,runtime:'workerd/Wrangler4.128.0',fixture:{devices,historicalOrders,itemsPerOrder:5,terminalPrintJobs:3000},operations,
      pointReadHistoryGrowth:operations.byIdsHistory.rowsRead-operations.byIdsSmall.rowsRead,scopedBootstrapHistoryGrowth:operations.bootstrapScopedHistory.rowsRead-operations.bootstrapScopedSmall.rowsRead,historyPreserved,attributionPlans,
      invariants:{legacyGlobalPolls,hibernationRecovered,restartConnectedClients,lostEventConvergedClients,convergenceVirtualMs,publicationFailureMutationCount:mutationCount,unchangedHeartbeatNotifications,unknownClaimedAgain:Boolean(nextClaim.job),concurrentClaimWinners:claims.filter(value=>value.job).length},
      assumptions:['D1 metrics include real HTTP auth,session guards,audit and attributed payloads.','Client time compressed; real lease timestamps mapped to virtual clock.','Real workerd WebSocket101,SQLite DO hibernation/restart and D1. No physical printer output.','Local wall time is diagnostic; Cloudflare CPU/duration/account billing remain unknown.'],unknownDimensions:['workerCpuMs','durableDurationGbS','accountBaseline'],passed:false}
    const save=()=>{if(process.env.REALTIME_GATE_REPORT){const output=resolve(process.env.REALTIME_GATE_REPORT);mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(report,null,2)+'\n')}}
    save()
    assertRealtimeRuntimeGate(report);report.passed=true
    report.monthlyProjection=projectMonthlyBudget({operations})
    save()
    return report
  }finally{for(const {client} of clients)client.stop();await mf.dispose();fixture.close()}
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const report=await runRealtimeRuntimeGate()
  if(process.argv[2])writeFileSync(process.argv[2],JSON.stringify(report,null,2)+'\n')
  console.log(JSON.stringify({passed:report.passed,invariants:report.invariants,operations:report.operations,monthlyReady:report.monthlyProjection.passed,unknownDimensions:report.monthlyProjection.unknownDimensions}))
}
