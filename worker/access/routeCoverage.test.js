import test from 'node:test'
import assert from 'node:assert/strict'
import { createSettingsDb } from '../test-support/settingsDb.js'
import { seedBuiltinRoles } from './roles.js'
import { createUserSession } from './sessions.js'
import { handleRequest } from '../index.js'
import { getBusinessDate } from '../../shared/finance.js'

const BUSINESS = 'amor-e-sabor'
const request = (token, path, method = 'GET', body = {}) => new Request(`https://delivery.test${path}`, {
  method, headers: { cookie: `amor_session=${token}`, origin: 'https://delivery.test', 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
  ...(['GET', 'HEAD'].includes(method) ? {} : { body: JSON.stringify(body) }),
})
async function setup(t) {
  const fixture = createSettingsDb(); t.after(fixture.close)
  const { db, sqlite } = fixture
  const timestamp = new Date().toISOString()
  await seedBuiltinRoles(db, BUSINESS, new Date())
  sqlite.exec("UPDATE business_auth_state SET mode='user_only'")
  const tokens = {}
  for (const name of ['manager', 'operator', 'empty']) {
    const role = name === 'empty' ? 'operator' : name
    sqlite.prepare(`INSERT INTO users(id,business_id,display_name,login_normalized,role_id,email_verified_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)`)
      .run(name, BUSINESS, name, `${name}@example.test`, `${BUSINESS}:${role}`, timestamp, timestamp, timestamp)
    sqlite.prepare(`INSERT INTO user_credentials(business_id,user_id,password_verifier,password_changed_at,created_at,updated_at) VALUES(?,?,?,?,?,?)`)
      .run(BUSINESS, name, 'test-verifier', timestamp, timestamp, timestamp)
    tokens[name] = (await createUserSession({ DB: db }, { businessId: BUSINESS, userId: name })).token
  }
  // A third persisted role lets the same real dispatcher exercise absence of grants.
  sqlite.prepare(`INSERT INTO roles(id,business_id,code,name,created_at,updated_at) VALUES('empty',?,'empty','Empty',?,?)`).run(BUSINESS,timestamp,timestamp)
  sqlite.exec("UPDATE users SET role_id='empty' WHERE id='empty'")
  return { ...fixture, tokens, env: { DB: db } }
}

// Literal Appendix A operational routes. Allowed malformed writes return their
// domain validation status, proving authorization precedes input processing.
const routes = [
  ['POST','/api/tables','tables.manage',403,400],
  ['PUT','/api/tables/order','tables.manage',403,400],
  ['PATCH','/api/tables/missing','tables.manage',403,400],
  ['POST','/api/tables/missing/transfer','comandas.transfer',403,400],
  ['POST','/api/clients','clients.create',400,400],
  ['PATCH','/api/clients/missing','clients.update',400,400],
  ['DELETE','/api/clients/missing','clients.delete',403,404],
  ['POST','/api/clients/missing/receivables/payment','payments.receive',400,400],
  ['GET','/api/orders','orders.view',200,200],
  ['POST','/api/orders','orders.create',400,400],
  ['PATCH','/api/orders/missing/status','orders.finalize',400,400],
  ['PATCH','/api/orders/missing','orders.edit',400,400],
  ['POST','/api/orders/missing/payment','payments.receive',400,400],
  ['PATCH','/api/orders/missing/payment-promise','finance.promises.manage',403,404],
  ['POST','/api/orders/missing/cancel','orders.cancel',403,400],
  ['POST','/api/orders/missing/refund','payments.refund',403,400],
  ['GET','/api/table-tabs/missing','comandas.view',404,404],
  ['POST','/api/table-tabs/missing/payment','payments.receive',400,400],
  ['GET','/api/table-reservations','orders.view',200,200],
  ['GET','/api/table-reservations/missing','orders.view',404,404],
  ['PUT','/api/table-reservations/missing','orders.create',400,400],
  ['POST','/api/table-reservations/missing/confirm-arrival','orders.create',400,400],
  ['POST','/api/table-reservations/missing/cancel','orders.cancel',403,400],
  ['POST','/api/table-reservations/missing/no-show','orders.cancel',403,400],
  ['POST','/api/movements','finance.movements.manage',403,400],
  ['PATCH','/api/movements/missing','finance.movements.manage',403,400],
  ['DELETE','/api/movements/missing','finance.movements.manage',403,404],
  ['PUT','/api/finance-settings','finance.movements.manage',403,400],
  ['POST','/api/products','products.manage',403,400],
  ['PATCH','/api/products/missing','products.manage',403,400],
  ['DELETE','/api/products/missing','products.manage',403,404],
  ['GET','/api/settings/receipts/missing?resource=operations','operations.settings.manage',403,200],
  ['GET','/api/settings/operations','operations.settings.view',403,200],
  ['PUT','/api/settings/operations','operations.settings.manage',403,400],
  ['GET','/api/settings/payment-methods','payments.settings.view',403,200],
  ['PUT','/api/settings/payment-methods','payments.settings.manage',403,400],
  ['GET','/api/settings/cancellation-reasons','orders.settings.view',403,200],
  ['PUT','/api/settings/cancellation-reasons','orders.settings.manage',403,400],
  ['GET','/api/settings/finance-categories','finance.categories.view',403,200],
  ['PUT','/api/settings/finance-categories','finance.categories.manage',403,400],
  ['GET','/api/settings/business-profile','business.profile.view',403,200],
  ['PUT','/api/settings/business-profile','business.profile.manage',403,400],
  ['GET','/api/reporting/overview','reports.view',403,200],
  ['GET','/api/reporting/operation','reports.view',403,200],
  ['GET','/api/reporting/sales','reports.view',403,200],
  ['GET','/api/reporting/products','reports.view',403,200],
  ['GET','/api/reporting/orders','reports.view',403,200],
  ['GET','/api/reporting/orders/missing','reports.view',403,404],
  ['POST','/api/reporting/export-model','reports.export',403,200],
  ['GET','/api/kitchen-tv/settings','orders.settings.view',403,200],
  ['POST','/api/kitchen-tv/approve','orders.settings.manage',403,400],
  ['POST','/api/kitchen-tv/revoke','orders.settings.manage',403,200],
  ['GET','/api/kitchen-tv/control','orders.view',200,200],
  ['PATCH','/api/kitchen-tv/control/page','orders.kitchen.control',403,400],
  ['PATCH','/api/kitchen-tv/control/modality','orders.kitchen.control',403,400],
  ['PUT','/api/kitchen-tv/control/orders/missing/hidden','orders.kitchen.control',403,409],
  ['DELETE','/api/kitchen-tv/control/orders/missing/hidden','orders.kitchen.control',403,409],
]
for (const [method,path,capability,operatorStatus,managerStatus] of routes) {
  test(`${method} ${path} requires ${capability} through HTTP dispatch`, async (t) => {
    const { env,tokens,sqlite } = await setup(t)
    for (const [role,status] of [['empty',403],['operator',operatorStatus],['manager',managerStatus]]) {
      const response = await handleRequest(request(tokens[role],path,method),env)
      const body = await response.json()
      assert.equal(response.status,status,`${role}: ${JSON.stringify(body)}`)
      if (status === 403) assert.equal(body.error.code,'FORBIDDEN')
    }
    // Grant only the literal policy for this method, so a wrong guard cannot
    // hide behind the manager's complete catalog.
    const grants = [capability]
    if (path.includes('/receivables/payment')) grants.push('clients.view')
    if (path.includes('/table-tabs/') && method === 'POST') grants.push('comandas.view')
    for (const key of grants) sqlite.prepare('INSERT INTO role_capabilities(business_id,role_id,capability) VALUES(?,?,?)').run(BUSINESS,'empty',key)
    const allowed = await handleRequest(request(tokens.empty,path,method),env)
    assert.equal(allowed.status,managerStatus,`minimal grants: ${JSON.stringify(await allowed.json())}`)
  })
}

test('authenticated bootstrap/effective/logo reads and unknown methods keep their explicit policy', async (t) => {
  const { env,tokens } = await setup(t)
  for (const [method,path,status] of [
    ['GET','/api/bootstrap',200], ['GET','/api/settings/effective',200], ['GET','/api/business/logo',404],
    ['DELETE','/api/orders',404], ['POST','/api/settings/operations',404], ['GET','/api/unknown',404],
  ]) assert.equal((await handleRequest(request(tokens.empty,path,method),env)).status,status,`${method} ${path}`)
})

test('compound order payloads fail before validation or writes without each additional grant', async (t) => {
  const { env,tokens,sqlite } = await setup(t)
  sqlite.prepare('DELETE FROM role_capabilities WHERE role_id=? AND capability<>?').run(`${BUSINESS}:operator`,'orders.create')
  for (const payload of [
    { paymentAllocations:[{methodCode:'pix',amountCents:100}] },
    { adjustment:{type:'discount',value:0} }, { adjustment:{type:'surcharge',value:0} },
    { isBackdated:true }, { orderDate:'2001-01-01' },
  ]) {
    const response = await handleRequest(request(tokens.operator,'/api/orders','POST',payload),env)
    assert.equal(response.status,403,JSON.stringify(await response.json()))
  }
  assert.equal(sqlite.prepare('SELECT count(*) n FROM orders').get().n,0)
})

test('operator client create/update succeed and delete remains forbidden with server business scope', async (t) => {
  const { env,tokens,sqlite } = await setup(t)
  const create = await handleRequest(request(tokens.operator,'/api/clients','POST',{name:'Joana',businessId:'evil',actorId:'evil'}),env)
  assert.equal(create.status,201)
  const {client} = await create.json()
  assert.equal(sqlite.prepare('SELECT business_id FROM clients WHERE id=?').get(client.id).business_id,BUSINESS)
  assert.equal((await handleRequest(request(tokens.operator,`/api/clients/${client.id}`,'PATCH',{name:'Joana Silva'}),env)).status,200)
  assert.equal((await handleRequest(request(tokens.operator,`/api/clients/${client.id}`,'DELETE'),env)).status,403)
  assert.equal(sqlite.prepare('SELECT name FROM clients WHERE id=?').get(client.id).name,'Joana Silva')
})

test('reservation edits and cancellation enforce payment adjustment backdate and refund compounds', async (t) => {
  const { env,tokens,sqlite } = await setup(t)
  sqlite.prepare('DELETE FROM role_capabilities WHERE role_id=? AND capability NOT IN (?,?)').run(`${BUSINESS}:manager`,'orders.create','orders.cancel')
  for (const [path,method,body] of [
    ['/api/table-reservations/missing','PUT',{paymentAllocations:[]}],
    ['/api/table-reservations/missing','PUT',{adjustment:{type:'discount',value:0}}],
    ['/api/table-reservations/missing','PUT',{isBackdated:true}],
    ['/api/table-reservations/missing/cancel','POST',{refundNow:true}],
    ['/api/table-reservations/missing/no-show','POST',{refundNow:true}],
    ['/api/orders/missing/cancel','POST',{refundNow:true}],
  ]) assert.equal((await handleRequest(request(tokens.manager,path,method,body),env)).status,403,`${method} ${path}`)
})

test('each request reloads persisted grants and ignores browser role grants', async (t) => {
  const { env,tokens,sqlite } = await setup(t)
  assert.equal((await handleRequest(request(tokens.operator,'/api/clients','POST',{name:'Before'}),env)).status,201)
  sqlite.prepare('DELETE FROM role_capabilities WHERE role_id=? AND capability=?').run(`${BUSINESS}:operator`,'clients.create')
  assert.equal((await handleRequest(request(tokens.operator,'/api/clients','POST',{name:'After',role:'manager',granted:['clients.create']}),env)).status,403)
})

function seedTenantResources(sqlite) {
  sqlite.exec(`
    INSERT INTO businesses(id,slug,name,created_at,updated_at) VALUES('other','other','Other','2026-09-01','2026-09-01');
    INSERT INTO clients(id,business_id,name,created_at,updated_at) VALUES('foreign','other','Foreign','2026-09-01','2026-09-01');
    INSERT INTO products(id,business_id,category,name,price_cents,created_at,updated_at) VALUES('foreign','other','Bebidas','Foreign',100,'2026-09-01','2026-09-01');
    INSERT INTO tables(id,business_id,name,name_key,sort_order,created_at,updated_at) VALUES('foreign','other','Foreign','FOREIGN',1,'2026-09-01','2026-09-01');
    INSERT INTO table_tabs(id,business_id,table_id,table_identifier,tab_number,opened_at,created_at,updated_at) VALUES('foreign','other','foreign','Foreign',1,'2026-09-01','2026-09-01','2026-09-01');
    INSERT INTO orders(id,business_id,order_number,client_id,client_name_snapshot,type,order_date,status,subtotal_cents,total_cents,created_at) VALUES('foreign','other',1,'foreign','Foreign','Local','2026-09-01','Em preparo',100,100,'2026-09-01');
    INSERT INTO movements(id,business_id,type,category,description,value_cents,movement_date,created_at,updated_at) VALUES('foreign','other','entrada','other_income','Foreign',100,'2026-09-01','2026-09-01','2026-09-01');
    INSERT INTO table_reservations(id,business_id,order_id,table_id,table_name_snapshot,status,scheduled_for,ends_at,duration_minutes,created_at,updated_at) VALUES('foreign','other','foreign','foreign','Foreign','reserved','2026-10-01T15:00:00Z','2026-10-01T16:00:00Z',60,'2026-09-01','2026-09-01');
    INSERT INTO kitchen_tv_access(business_id,session_token_hash,session_issued_at,paired_at,created_at,updated_at) VALUES('amor-e-sabor','paired-test','2026-09-01','2026-09-01','2026-09-01','2026-09-01');
  `)
}
const product = {category:'Bebidas',name:'Water',price:1}
const movement = {type:'entrada',category:'other_income',description:'Deposit',value:1,movementDate:'2026-09-01',paymentMethod:'Pix'}
const foreignRoutes = [
  ['PATCH','/api/clients/foreign',{name:'Changed'},404], ['DELETE','/api/clients/foreign',{},404],
  ['POST','/api/clients/foreign/receivables/payment',{orderIds:['foreign','foreign-2'],allocations:[{methodCode:'pix',amountCents:100}]},404],
  ['PATCH','/api/products/foreign',product,404], ['DELETE','/api/products/foreign',{},404],
  ['PATCH','/api/tables/foreign',{name:'Changed'},404],
  ['POST','/api/tables/foreign/transfer',{destinationTableId:'local',expectedTableTabId:'foreign'},409],
  ['PATCH','/api/orders/foreign/status',{status:'Finalizado'},404],
  ['POST','/api/orders/foreign/payment',{allocations:[{methodCode:'pix',amountCents:100}]},404],
  ['PATCH','/api/orders/foreign/payment-promise',{promisedPaymentDate:null},404],
  ['POST','/api/orders/foreign/cancel',{reason:'client_changed_mind'},404],
  ['POST','/api/orders/foreign/refund',{refundMethod:'Pix'},404],
  ['GET','/api/table-tabs/foreign',{},404],
  ['POST','/api/table-tabs/foreign/payment',{allocations:[{methodCode:'pix',amountCents:100}]},404],
  ['GET','/api/table-reservations/foreign',{},404],
  ['POST','/api/table-reservations/foreign/confirm-arrival',{expectedRevision:1,mutationId:'arrival'},404],
  ['POST','/api/table-reservations/foreign/cancel',{expectedRevision:1,reason:'client_changed_mind'},404],
  ['POST','/api/table-reservations/foreign/no-show',{expectedRevision:1,reason:'client_changed_mind'},404],
  ['PATCH','/api/movements/foreign',movement,404], ['DELETE','/api/movements/foreign',{},404],
  ['GET','/api/reporting/orders/foreign',{},404],
  ['PUT','/api/kitchen-tv/control/orders/foreign/hidden',{},404],
  ['DELETE','/api/kitchen-tv/control/orders/foreign/hidden',{},404],
]
for (const [method,path,body,status] of foreignRoutes) test(`${method} ${path} cannot access another business resource`,async(t)=>{
  const {env,tokens,sqlite} = await setup(t)
  seedTenantResources(sqlite)
  const before = JSON.stringify(['clients','products','tables','table_tabs','orders','movements','table_reservations']
    .map(table => sqlite.prepare(`SELECT * FROM ${table} WHERE business_id='other'`).all()))
  const response = await handleRequest(request(tokens.manager,path,method,path.startsWith('/api/tables/') ? body : {...body,businessId:'other'}),env)
  assert.equal(response.status,status,JSON.stringify(await response.json()))
  const after = JSON.stringify(['clients','products','tables','table_tabs','orders','movements','table_reservations']
    .map(table => sqlite.prepare(`SELECT * FROM ${table} WHERE business_id='other'`).all()))
  assert.equal(after,before)
})

test('reservation replacement cannot access foreign reservation with a valid checkout body',async(t)=>{
  const {env,tokens,sqlite} = await setup(t)
  seedTenantResources(sqlite)
  const scheduled = new Date(Date.now()+2*86400000)
  const response = await handleRequest(request(tokens.manager,'/api/table-reservations/foreign','PUT',{
    expectedRevision:1,type:'Local',customerIdentity:{type:'table',tableId:'foreign'},
    orderDate:getBusinessDate(scheduled),scheduledFor:scheduled.toISOString(),items:[{productId:'foreign',quantity:1}],
  }),env)
  assert.equal(response.status,404,JSON.stringify(await response.json()))
  assert.equal(sqlite.prepare("SELECT revision FROM table_reservations WHERE id='foreign'").get().revision,1)
})

test('compound read grants remain necessary for client batch and table tab payments',async(t)=>{
  const {env,tokens,sqlite} = await setup(t)
  sqlite.prepare('DELETE FROM role_capabilities WHERE role_id=? AND capability<>?').run(`${BUSINESS}:operator`,'payments.receive')
  for (const path of ['/api/clients/missing/receivables/payment','/api/table-tabs/missing/payment']) {
    assert.equal((await handleRequest(request(tokens.operator,path,'POST',{}),env)).status,403,path)
  }
  sqlite.prepare('INSERT INTO role_capabilities(business_id,role_id,capability) VALUES(?,?,?)').run(BUSINESS,'empty','orders.history')
  assert.equal((await handleRequest(request(tokens.empty,'/api/orders'),env)).status,200)
  sqlite.prepare('DELETE FROM role_capabilities WHERE role_id=?').run('empty')
  sqlite.prepare('INSERT INTO role_capabilities(business_id,role_id,capability) VALUES(?,?,?)').run(BUSINESS,'empty','comandas.view')
  assert.equal((await handleRequest(request(tokens.empty,'/api/table-reservations'),env)).status,200)
})

test('ordinary operator checkout allows canonical none adjustment and preserves origin enforcement',async(t)=>{
  const {env,tokens,sqlite} = await setup(t)
  sqlite.prepare(`INSERT INTO products(id,business_id,category,name,price_cents,created_at,updated_at) VALUES('local',?,'Bebidas','Water',100,?,?)`).run(BUSINESS,new Date().toISOString(),new Date().toISOString())
  sqlite.prepare("INSERT INTO clients(id,business_id,name,created_at,updated_at) VALUES('local',?,'Ana',?,?)").run(BUSINESS,new Date().toISOString(),new Date().toISOString())
  const input = {type:'Retirada',customerIdentity:{type:'registered_client',clientId:'local'},orderDate:getBusinessDate(new Date()),items:[{productId:'local',quantity:1}],adjustment:{type:'none',value:0}}
  const response = await handleRequest(request(tokens.operator,'/api/orders','POST',input),env)
  assert.equal(response.status,201,JSON.stringify(await response.json()))
  assert.equal(sqlite.prepare('SELECT count(*) n FROM orders').get().n,1)
  const crossOrigin = request(tokens.operator,'/api/clients','POST',{name:'No'})
  crossOrigin.headers.set('origin','https://evil.test')
  assert.equal((await handleRequest(crossOrigin,env)).status,403)
  assert.equal(sqlite.prepare('SELECT count(*) n FROM clients').get().n,1)
})

test('TV public protocol never substitutes a human session for its own credential',async(t)=>{
  const {env,tokens} = await setup(t)
  for (const [method,path,status] of [
    ['GET','/api/kitchen-tv/pairing-status',410], ['POST','/api/kitchen-tv/pairing-status',410],
    ['GET','/api/kitchen-tv/state',401], ['POST','/api/kitchen-tv/report',401],
    ['POST','/api/kitchen-tv/pairing-request',201],
  ]) assert.equal((await handleRequest(request(tokens.manager,path,method),env)).status,status,`${method} ${path}`)
  const tvOnly = new Request('https://delivery.test/api/clients',{method:'POST',headers:{cookie:'kitchen_tv_session=tv-credential',origin:'https://delivery.test'},body:'{}'})
  assert.equal((await handleRequest(tvOnly,env)).status,401)
})

for (const [resource,capability,scope] of [
  ['operations','operations.settings.manage',''], ['paymentMethods','payments.settings.manage',''],
  ['cancellationReasons','orders.settings.manage',''], ['financeCategories','finance.categories.manage',''],
  ['businessProfile','business.profile.manage',''], ['printingPolicy','printing.settings',''],
  ['stationConfiguration','printing.station.configure','&scopeId=foreign'], ['stationPrimary','printing.station.configure',''],
]) test(`GET /api/settings/receipts/:id requires ${capability} for ${resource}`,async(t)=>{
  const {env,tokens,sqlite} = await setup(t)
  const path = `/api/settings/receipts/foreign?resource=${resource}${scope}`
  for (const role of ['empty','operator']) assert.equal((await handleRequest(request(tokens[role],path),env)).status,403)
  sqlite.prepare('INSERT INTO role_capabilities(business_id,role_id,capability) VALUES(?,?,?)').run(BUSINESS,'empty',capability)
  const response = await handleRequest(request(tokens.empty,path),env)
  assert.equal(response.status,200)
  assert.deepEqual(await response.json(),{status:'unconfirmed'})
})

test('settings receipt lookup cannot confirm another business mutation',async(t)=>{
  const {env,tokens,sqlite} = await setup(t)
  seedTenantResources(sqlite)
  const now = new Date().toISOString()
  sqlite.prepare(`INSERT INTO settings_mutation_receipts(business_id,resource_key,mutation_id,payload_hash,committed_revision,committed_at,resource_created_at,resource_updated_at)
    VALUES('other','operations','foreign','foreign-payload',1,?,?,?)`).run(now,now,now)
  const response = await handleRequest(request(tokens.manager,'/api/settings/receipts/foreign?resource=operations'),env)
  assert.equal(response.status,200)
  assert.deepEqual(await response.json(),{status:'unconfirmed'})
})
