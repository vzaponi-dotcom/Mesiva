import assert from 'node:assert/strict'
import test from 'node:test'
import { handlePrintingApi } from '../orderPrintingApi.js'
import { makeEnv } from './printingTestSupport.js'
import { createSession } from '../auth.js'
import { handleRequest } from '../index.js'
import { createSettingsDb } from '../test-support/settingsDb.js'
import { printingActor, projectPrintingPayload } from './printingAuthorization.js'

const context = (grants) => ({ businessId: 'amor-e-sabor', userId: 'operator-1', displayName: 'Maria Operadora', sessionId: 'session-1', granted: new Set(grants), legacy: false })
const call = async (env, path, method, grants, body = {}) => {
  const request = new Request(`https://delivery.example${path}`, { method, headers: { origin: 'https://delivery.example', 'content-type': 'application/json' }, ...(method === 'GET' ? {} : { body: JSON.stringify(body) }) })
  try { return await handlePrintingApi(request, env, context(grants), new URL(request.url)) }
  catch (error) { return Response.json({ code: error.code }, { status: error.status || 500 }) }
}

// Literal HTTP inventory: removing any guard admits an empty-grant human session.
const routes = [
  ['GET', '/api/printing/settings', 'printing.settings.view'],
  ['PUT', '/api/printing/settings', 'printing.settings'],
  ['GET', '/api/printing/stations', 'printing.station.view'],
  ['PUT', '/api/printing/stations/foreign', 'printing.station.configure'],
  ['POST', '/api/printing/stations/foreign/make-primary', 'printing.station.configure'],
  ['GET', '/api/printing/jobs', 'printing.queue'],
  ['GET', '/api/printing/jobs/summary', 'printing.queue'],
  ['GET', '/api/orders/foreign/print-document', 'printing.execute'],
  ['POST', '/api/orders/foreign/print-jobs', 'printing.execute'],
  ['GET', '/api/printing/qz/certificate', 'printing.execute'],
  ['POST', '/api/printing/qz/sign', 'printing.execute'],
  ['POST', '/api/printing/test-jobs', 'printing.execute'],
  ['POST', '/api/printing/stations/foreign/heartbeat', 'printing.execute'],
  ['POST', '/api/printing/stations/foreign/recovery', 'printing.execute'],
  ['POST', '/api/printing/jobs/claim-next', 'printing.execute'],
  ['POST', '/api/printing/jobs/claim-recovery-next', 'printing.execute'],
  ['POST', '/api/printing/jobs/foreign/claim', 'printing.execute'],
  ['POST', '/api/printing/jobs/foreign/complete', 'printing.execute'],
  ['POST', '/api/printing/jobs/foreign/fail', 'printing.execute'],
  ['POST', '/api/printing/jobs/foreign/retry', 'printing.execute'],
  ['POST', '/api/printing/jobs/foreign/attempts', 'printing.execute'],
  ['POST', '/api/printing/attempts/foreign/submitting', 'printing.execute'],
  ['POST', '/api/printing/attempts/foreign/events', 'printing.execute'],
  ['POST', '/api/printing/jobs/foreign/resolve-outcome', 'printing.execute'],
  ['POST', '/api/printing/jobs/foreign/second-copy-prompt', 'printing.execute'],
  ['POST', '/api/printing/jobs/foreign/request-second-copy', 'printing.execute'],
  ['POST', '/api/printing/jobs/foreign/skip-second-copy', 'printing.execute'],
  ['POST', '/api/printing/jobs/foreign/reprint', 'printing.execute'],
  ['POST', '/api/printing/jobs/discard-pending', 'printing.discard'],
  ['POST', '/api/printing/jobs/discard-operational', 'printing.discard'],
  ['POST', '/api/printing/jobs/foreign/discard', 'printing.discard'],
  ['POST', '/api/printing/jobs/foreign/prioritize', 'printing.force'],
  ['POST', '/api/printing/jobs/foreign/force-print', 'printing.force'],
]
for (const [method, path, capability] of routes) test(`${method} ${path} requires ${capability}`, async () => {
  const env = await makeEnv()
  assert.equal((await call(env, path, method, [])).status, 403)
  const grants = path.startsWith('/api/orders/') ? [capability, 'orders.view'] : [capability]
  const allowed = await call(env, path, method, grants, { stationId: 'foreign', name: 'Station', platform: 'windows', defaultCopies: 1, copyNumber: 1, copiesPrinted: 1, copies: 1, code: 'failure', message: 'failed', attemptId: 'foreign', resolution: 'manual_not_printed', state: 'active', expectedRevision: 1, mutationId: 'one' })
  assert.ok([200, 400, 404, 503].includes(allowed.status), `expected allowed response or domain validation, got ${allowed.status}`)
  assert.ok(allowed, 'recognized route')
})

const seedJob = (env, { id = 'job1', status = 'pending', trigger = 'automatic', type = 'order', orderId = 'o1', tableTabId = null } = {}) => {
  env.DB.sqlite.prepare(`INSERT INTO print_jobs (id,business_id,order_id,table_tab_id,type,trigger,status,copies_requested,copies_printed,snapshot_json,created_at,available_at,last_error_message) VALUES (?,'amor-e-sabor',?,?,?,?,?,1,0,?,'2099-01-01','2000-01-01',?)`).run(id, orderId, tableTabId, type, trigger, status, JSON.stringify({ private: 'SECRET_DOCUMENT', order: { status: 'Em preparo' } }), 'SECRET_DOCUMENT')
}
const seedStation = (env, recovery = 'normal') => env.DB.sqlite.prepare(`INSERT INTO print_stations (id,business_id,name,platform,is_primary,auto_print_enabled,default_copies,last_seen_at,qz_ready,printer_ready,physical_state,recovery_state,created_at,updated_at) VALUES ('s1','amor-e-sabor','Caixa','windows',1,1,1,?,1,1,'ready',?,'2000','2000')`).run(new Date().toISOString(), recovery)

test('queue documents require execution and CURRENT matching order status read', async () => {
  for (const [status, grants, readable] of [
    ['Em preparo', ['printing.queue'], false],
    ['Em preparo', ['printing.queue', 'printing.execute', 'orders.history'], false],
    ['Em preparo', ['printing.queue', 'printing.execute', 'orders.view'], true],
    ['Finalizado', ['printing.queue', 'printing.execute', 'orders.view'], false],
    ['Finalizado', ['printing.queue', 'printing.execute', 'orders.history'], true],
    ['Cancelado', ['printing.queue', 'printing.execute', 'orders.view'], false],
    ['Agendado', ['printing.queue', 'printing.execute', 'orders.view'], true],
    ['Unknown', ['printing.queue', 'printing.execute', 'orders.history', 'orders.view'], false],
  ]) {
    const env = await makeEnv(); seedJob(env)
    env.DB.sqlite.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, 'o1')
    const response = await call(env, '/api/printing/jobs?orderId=o1', 'GET', grants)
    const raw = await response.text()
    assert.equal(raw.includes('SECRET_DOCUMENT'), readable, `${status}: ${grants}`)
    assert.equal(JSON.parse(raw).jobs[0].id, 'job1')
  }
})
test('claim and recovery never reserve inaccessible documents, including existing recovery lock', async () => {
  for (const [path, recovery, locked] of [['claim-next','normal',false], ['claim-recovery-next','active',false], ['claim-recovery-next','active',true]]) {
    const env = await makeEnv(); seedStation(env, recovery); seedJob(env)
    if (locked) env.DB.exec("UPDATE print_stations SET recovery_job_id='job1' WHERE id='s1'")
    const response = await call(env, `/api/printing/jobs/${path}`, 'POST', ['printing.execute', 'orders.history'], { stationId: 's1' })
    assert.equal(response.status, 200)
    assert.equal((await response.json()).job, null)
    assert.equal(env.DB.sqlite.prepare("SELECT status FROM print_jobs WHERE id='job1'").get().status, 'pending')
    assert.equal(env.DB.sqlite.prepare("SELECT recovery_state FROM print_stations WHERE id='s1'").get().recovery_state, recovery)
  }
})
test('direct claim fails before reserving a denied current order', async () => {
  const env = await makeEnv(); seedStation(env); seedJob(env)
  const response = await call(env, '/api/printing/jobs/job1/claim', 'POST', ['printing.execute', 'orders.history'], { stationId: 's1' })
  assert.equal(response.status, 403)
  assert.equal(env.DB.sqlite.prepare("SELECT status FROM print_jobs WHERE id='job1'").get().status, 'pending')
})
test('manual retry of automatic origin uses trusted human name and omits inaccessible snapshot', async () => {
  const env = await makeEnv(); seedJob(env, { status: 'failed' })
  const response = await call(env, '/api/printing/jobs/job1/retry', 'POST', ['printing.execute'], { actorLabel: 'Forged Manager', userId: 'other', automatic: true })
  assert.equal(response.status, 200)
  assert.equal((await response.text()).includes('SECRET_DOCUMENT'), false)
  assert.equal(env.DB.sqlite.prepare("SELECT action_actor_label FROM print_jobs WHERE id='job1'").get().action_actor_label, 'Maria Operadora')
})
test('force and discard mutations use trusted actor and safe metadata without execute/read', async () => {
  for (const [action, grant] of [['discard','printing.discard'], ['prioritize','printing.force']]) {
    const env = await makeEnv(); seedJob(env)
    const response = await call(env, `/api/printing/jobs/job1/${action}`, 'POST', [grant], { actorLabel: 'Forged Manager' })
    assert.equal(response.status, 200)
    assert.equal((await response.text()).includes('SECRET_DOCUMENT'), false)
    assert.equal(env.DB.sqlite.prepare("SELECT action_actor_label FROM print_jobs WHERE id='job1'").get().action_actor_label, 'Maria Operadora')
  }
})
test('manual order creation stores trusted label', async () => {
  const env = await makeEnv()
  const response = await call(env, '/api/orders/o1/print-jobs', 'POST', ['printing.execute','orders.view'], { copies: 1, actorLabel: 'Forged' })
  assert.equal(response.status, 201)
  assert.equal((await response.json()).job.actionActorLabel, 'Maria Operadora')
})
test('server automatic identity requires station context and retains system identity', () => {
  assert.throws(() => printingActor(context(['printing.execute']), {automatic:true}), error=>error.code==='PRINT_STATION_ID_REQUIRED')
  assert.deepEqual(printingActor(context(['printing.execute']), {automatic:true,stationId:'s1'}), {businessId:'amor-e-sabor',actorType:'system',userId:null,displayName:'Sistema',sessionId:'session-1',stationId:'s1'})
  assert.deepEqual(printingActor({...context([]),legacy:true,userId:null,displayName:'Acesso legado'}), {businessId:'amor-e-sabor',actorType:'legacy',userId:null,displayName:'Acesso legado',sessionId:'session-1',stationId:null})
})
test('queue projection batches current statuses within D1 100 bind limit', async () => {
  const env = await makeEnv()
  const jobs = []
  for (let i=0;i<120;i++) {
    env.DB.sqlite.prepare(`INSERT INTO orders (id,business_id,client_name_snapshot,type,order_date,status,subtotal_cents,total_cents,created_at) VALUES (?,'amor-e-sabor','Maria','Retirada','2026-09-30','Em preparo',0,0,'2000')`).run(`order-${i}`)
    jobs.push({id:`job-${i}`,type:'order',orderId:`order-${i}`,document:{marker:'SECRET_DOCUMENT'}})
  }
  let queries = 0
  const original = env.DB.prepare.bind(env.DB)
  env.DB.prepare = sql => {
    const statement = original(sql)
    if (!sql.includes('FROM orders')) return statement
    queries++
    return {bind(...args){assert.ok(args.length<=100);return statement.bind(...args)}}
  }
  const payload = await projectPrintingPayload(env.DB,context(['printing.execute','orders.view']),{jobs})
  assert.equal(payload.jobs.filter(job=>job.document?.marker==='SECRET_DOCUMENT').length,120)
  assert.equal(queries,2)
})
test('test job execution does not require a nonexistent order and records trusted requester', async () => {
  const env = await makeEnv(); seedStation(env)
  const response = await call(env,'/api/printing/test-jobs','POST',['printing.execute'],{stationId:'s1',actorLabel:'Forged'})
  assert.equal(response.status,201)
  const {job} = await response.json()
  assert.ok(job.document)
  assert.equal(job.actionActorLabel,'Maria Operadora')
})
test('comanda queue snapshots require comanda read as well as execution', async () => {
  for (const [grants,readable] of [[['printing.queue','printing.execute','orders.view'],false],[['printing.queue','printing.execute','comandas.view'],true],[['printing.queue','comandas.view'],false]]) {
    const env = await makeEnv(); seedJob(env,{type:'table-tab',orderId:null,tableTabId:'tab1'})
    const response = await call(env,'/api/printing/jobs','GET',grants)
    assert.equal((await response.text()).includes('SECRET_DOCUMENT'),readable)
  }
})
test('operator reprint and manual resolution of automatic job bind human identity', async () => {
  const env = await makeEnv(); seedJob(env,{status:'printed'})
  env.DB.exec("UPDATE print_jobs SET copies_printed=1 WHERE id='job1'")
  const reprint = await call(env,'/api/printing/jobs/job1/reprint','POST',['printing.execute','orders.view'],{copies:1,actorLabel:'Forged',automatic:true})
  assert.equal(reprint.status,201)
  assert.equal((await reprint.json()).job.actionActorLabel,'Maria Operadora')
  env.DB.exec("UPDATE print_jobs SET status='requires_attention',copies_printed=0 WHERE id='job1'")
  env.DB.exec("INSERT INTO print_job_attempts(id,business_id,job_id,copy_number,attempt_number,station_id,spool_job_name,status,submission_started_at,created_at,updated_at) VALUES ('a1','amor-e-sabor','job1',1,1,'s1','spool','unknown','2000','2000','2000')")
  const resolved = await call(env,'/api/printing/jobs/job1/resolve-outcome','POST',['printing.execute'],{attemptId:'a1',resolution:'manual_not_printed',actorLabel:'Forged',automatic:true})
  assert.equal(resolved.status,200)
  assert.equal((await resolved.json()).attempt.resolutionActorLabel,'Maria Operadora')
  assert.equal(env.DB.sqlite.prepare("SELECT copies_printed,status FROM print_jobs WHERE id='job1'").get().copies_printed,0)
})
test('parameterized printing mutations preserve foreign station job and attempt ownership', async () => {
  const rows = [
    ['/api/printing/stations/foreign/heartbeat',{qzReady:true,printerReady:true,physicalState:'ready'}],
    ['/api/printing/stations/foreign/recovery',{state:'active'}],
    ['/api/printing/test-jobs',{stationId:'foreign'}],
    ['/api/printing/jobs/claim-next',{stationId:'foreign'}],
    ['/api/printing/jobs/claim-recovery-next',{stationId:'foreign'}],
    ['/api/printing/jobs/foreign/claim',{stationId:'s1'}],
    ['/api/printing/jobs/foreign/complete',{stationId:'s1',copiesPrinted:1}],
    ['/api/printing/jobs/foreign/fail',{stationId:'s1',code:'FAIL',message:'Failure'}],
    ['/api/printing/jobs/foreign/retry',{}],
    ['/api/printing/jobs/foreign/attempts',{stationId:'s1',copyNumber:1}],
    ['/api/printing/attempts/foreign/submitting',{stationId:'s1'}],
    ['/api/printing/attempts/foreign/events',{stationId:'s1',event:{type:'SPOOLING',jobName:'foreign-spool',spoolJobId:1}}],
    ['/api/printing/jobs/foreign/resolve-outcome',{attemptId:'foreign',resolution:'manual_not_printed'}],
    ['/api/printing/jobs/foreign/second-copy-prompt',{stationId:'s1'}],
    ['/api/printing/jobs/foreign/request-second-copy',{}],
    ['/api/printing/jobs/foreign/skip-second-copy',{}],
    ['/api/printing/jobs/foreign/reprint',{copies:1}],
    ['/api/printing/jobs/foreign/discard',{}],
    ['/api/printing/jobs/foreign/prioritize',{}],
    ['/api/printing/jobs/foreign/force-print',{}],
  ]
  for (const [path,body] of rows) {
    const env=await makeEnv(); seedStation(env)
    env.DB.exec("INSERT INTO print_stations(id,business_id,name,platform,created_at,updated_at) VALUES ('foreign','other-business','Foreign','windows','2000','2000')")
    env.DB.exec("INSERT INTO print_jobs(id,business_id,type,trigger,status,copies_requested,snapshot_json,created_at) VALUES ('foreign','other-business','test','manual','pending',1,'{}','2000')")
    env.DB.exec("INSERT INTO print_job_attempts(id,business_id,job_id,copy_number,attempt_number,station_id,spool_job_name,status,created_at,updated_at) VALUES ('foreign','other-business','foreign',1,1,'foreign','foreign-spool','unknown','2000','2000')")
    assert.equal((await call(env,path,'POST',['printing.execute','printing.force','printing.discard','orders.view'],body)).status,404,path)
    assert.equal(env.DB.sqlite.prepare("SELECT status FROM print_jobs WHERE id='foreign'").get().status,'pending')
  }
})
test('accepted completion and uncertain failure return safe metadata after order read changes', async () => {
  for (const [action,body,status,copies] of [
    ['complete',{stationId:'s1',copiesPrinted:1},'printed',1],
    ['fail',{stationId:'s1',code:'QZ_PRINT_FAILED',message:'SECRET_DOCUMENT',uncertain:true},'requires_attention',0],
  ]) {
    const env = await makeEnv(); seedJob(env,{status:'processing'})
    env.DB.exec("UPDATE print_jobs SET station_id='s1' WHERE id='job1'; UPDATE orders SET status='Finalizado' WHERE id='o1'")
    const response = await call(env,`/api/printing/jobs/job1/${action}`,'POST',['printing.execute','orders.view'],body)
    assert.equal(response.status,200)
    const raw = await response.text()
    assert.equal(raw.includes('SECRET_DOCUMENT'),false)
    const job=JSON.parse(raw).job
    assert.equal(job.status,status)
    assert.equal(job.copiesPrinted,copies)
  }
})
for (const [method,path] of [['GET','/api/table-tabs/foreign/print-document'],['POST','/api/table-tabs/foreign/print-jobs']]) test(`${method} ${path} requires comanda read and execution`, async (t) => {
  const fixture = createSettingsDb(); t.after(fixture.close)
  const env = { DB: fixture.db }
  const session = await createSession(env, 'amor-e-sabor')
  for (const grants of [[], ['printing.execute'], ['comandas.view'], ['printing.execute','comandas.view']]) {
    env.resolveCapabilities = async () => new Set(grants)
    const response = await handleRequest(new Request(`https://delivery.example${path}`, { method, headers: { origin: 'https://delivery.example', cookie: `amor_session=${session.token}`, 'content-type':'application/json' }, ...(method==='GET'?{}:{body:'{}'}) }),env)
    assert.equal(response.status, grants.length===2?404:403)
  }
})

const humanRequest = async (env, path, method, grants, body = {}) => {
  env.resolveCapabilities = async () => new Set(grants)
  const session = await createSession(env, 'amor-e-sabor')
  return handleRequest(new Request(`https://delivery.example${path}`, {
    method, headers: { origin: 'https://delivery.example', cookie: `amor_session=${session.token}`, 'content-type': 'application/json' },
    ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
  }), env)
}

test('direct document HTTP read rechecks current status after initial authorization', async () => {
  for (const [initial, terminal, grant] of [['Em preparo','Finalizado','orders.view'],['Finalizado','Em preparo','orders.history']]) {
    const env = await makeEnv()
    env.DB.sqlite.prepare("UPDATE orders SET status=?,client_address_snapshot='SECRET_DOCUMENT' WHERE id='o1'").run(initial)
    let reads = 0
    const prepare = env.DB.prepare.bind(env.DB)
    env.DB.prepare = sql => {
      const statement = prepare(sql)
      if (!sql.startsWith('SELECT status FROM orders')) return statement
      return { bind(...args) {
        const bound = statement.bind(...args)
        return { ...bound, async first() {
          const row = await bound.first()
          if (++reads === 2) env.DB.sqlite.prepare("UPDATE orders SET status=? WHERE id='o1'").run(terminal)
          return row
        } }
      } }
    }
    const response = await humanRequest(env,'/api/orders/o1/print-document','GET',['printing.execute',grant])
    assert.equal(response.status,403,`${initial} -> ${terminal}`)
    assert.equal((await response.text()).includes('SECRET_DOCUMENT'),false)
    assert.equal(env.DB.sqlite.prepare("SELECT status FROM orders WHERE id='o1'").get().status,terminal)
  }
})

// Model a concurrent D1 request: independent writes may run between calls but
// cannot execute between statements inside a transactional batch.
const afterRecoveryLock = (env, mutate) => {
  const prepare = env.DB.prepare.bind(env.DB)
  const batch = env.DB.batch.bind(env.DB)
  let inBatch = false
  let pending = false
  let fired = false
  const afterLock = () => { if (fired) return; fired = true; if (inBatch) pending = true; else mutate() }
  env.DB.batch = async statements => {
    inBatch = true
    try { return await batch(statements) }
    finally { inBatch = false; if (pending) { pending = false; mutate() } }
  }
  env.DB.prepare = sql => {
    const statement = prepare(sql)
    if (!sql.startsWith("UPDATE print_stations SET recovery_state = 'deferred'")) return statement
    return { bind(...args) {
      const bound = statement.bind(...args)
      return { ...bound,
        async first() { const row = await bound.first(); if (row) afterLock(); return row },
        async run() { const result = await bound.run(); if (result.meta.changes === 1) afterLock(); return result },
      }
    } }
  }
  return () => fired
}

for (const existing of [false,true]) test(`HTTP recovery status interleaving preserves claim and station consistency (${existing ? 'existing lock' : 'new candidate'})`, async () => {
  const env = await makeEnv(); seedStation(env,'active'); seedJob(env)
  if (existing) env.DB.exec("UPDATE print_stations SET recovery_job_id='job1' WHERE id='s1'")
  const fired = afterRecoveryLock(env, () => env.DB.exec("UPDATE orders SET status='Finalizado' WHERE id='o1'"))
  const response = await humanRequest(env,'/api/printing/jobs/claim-recovery-next','POST',['printing.execute','orders.view'],{stationId:'s1'})
  assert.equal(response.status,200)
  const raw = await response.text()
  assert.equal(fired(),true)
  assert.equal(raw.includes('SECRET_DOCUMENT'),false)
  const station = env.DB.sqlite.prepare("SELECT recovery_state,recovery_job_id FROM print_stations WHERE id='s1'").get()
  const job = env.DB.sqlite.prepare("SELECT status,copies_printed FROM print_jobs WHERE id='job1'").get()
  assert.equal(station.recovery_state === 'deferred' && job.status === 'pending',false,'no stranded reservation')
  assert.equal(job.copies_printed,0)
})

for (const existing of [false,true]) test(`recovery transaction rolls back station when job update fails (${existing ? 'existing lock' : 'new candidate'})`, async () => {
  const env=await makeEnv(); seedStation(env,'active'); seedJob(env)
  if (existing) env.DB.exec("UPDATE print_stations SET recovery_job_id='job1' WHERE id='s1'")
  env.DB.exec("CREATE TRIGGER reject_claim BEFORE UPDATE ON print_jobs WHEN NEW.status='processing' BEGIN SELECT RAISE(ABORT,'test recovery claim failure'); END")
  const response=await call(env,'/api/printing/jobs/claim-recovery-next','POST',['printing.execute','orders.view'],{stationId:'s1'})
  assert.equal(response.status,500)
  const station=env.DB.sqlite.prepare("SELECT recovery_state,recovery_job_id FROM print_stations WHERE id='s1'").get()
  assert.equal(station.recovery_state,'active')
  assert.equal(station.recovery_job_id,existing?'job1':null)
  assert.equal(env.DB.sqlite.prepare("SELECT status FROM print_jobs WHERE id='job1'").get().status,'pending')
})

for (const competingState of ['deferred','active']) test(`HTTP recovery cannot claim another request's ${competingState} reservation`, async () => {
  const env=await makeEnv(); seedStation(env,'active'); seedJob(env)
  const prepare=env.DB.prepare.bind(env.DB)
  let competed=false
  env.DB.prepare=sql=>{
    const statement=prepare(sql)
    if (!sql.startsWith('SELECT id FROM print_jobs')) return statement
    return {bind(...args){const bound=statement.bind(...args);return {...bound,async first(){
      const row=await bound.first()
      if (row) {competed=true;env.DB.sqlite.prepare("UPDATE print_stations SET recovery_state=?,recovery_job_id='other-job' WHERE id='s1'").run(competingState)}
      return row
    }}}}
  }
  const response=await humanRequest(env,'/api/printing/jobs/claim-recovery-next','POST',['printing.execute','orders.view'],{stationId:'s1'})
  assert.equal(response.status,200)
  assert.equal(competed,true)
  assert.equal((await response.json()).job,null)
  assert.equal(env.DB.sqlite.prepare("SELECT recovery_job_id FROM print_stations WHERE id='s1'").get().recovery_job_id,'other-job')
  assert.equal(env.DB.sqlite.prepare("SELECT status FROM print_jobs WHERE id='job1'").get().status,'pending')
})


test('combined printing state preserves both read grants, tenant isolation and the existing projections', async () => {
 const env=await makeEnv()
 seedJob(env,{id:'state-local',status:'requires_attention'})
 seedJob(env,{id:'state-foreign',type:'test',orderId:null})
 env.DB.sqlite.exec("UPDATE print_jobs SET business_id='other-business' WHERE id='state-foreign'")
 for(const grants of [[],['printing.queue'],['printing.station.view']])assert.equal((await call(env,'/api/printing/state','GET',grants))?.status,403)
 const grants=['printing.queue','printing.station.view','printing.execute','orders.view']
 const response=await call(env,'/api/printing/state','GET',grants)
 assert.equal(response?.status,200)
 const state=await response.json()
 const stations=await (await call(env,'/api/printing/stations','GET',grants)).json()
 const jobs=await (await call(env,'/api/printing/jobs','GET',grants)).json()
 const summary=await (await call(env,'/api/printing/jobs/summary','GET',grants)).json()
 assert.deepEqual(state,{stations:stations.stations,jobs:jobs.jobs,summary:summary.summary})
 assert.equal(state.jobs.some(job=>job.id==='state-foreign'),false)
 const restricted=await (await call(env,'/api/printing/state','GET',['printing.queue','printing.station.view'])).json()
 assert.equal(Object.hasOwn(restricted.jobs[0],'document'),false)
})
