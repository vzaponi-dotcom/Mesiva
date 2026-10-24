import test from 'node:test'
import assert from 'node:assert/strict'
import { createSettingsDb } from './test-support/settingsDb.js'
import * as repository from './dayConferenceRepository.js'

function fixture(t,count=1){
  const f=createSettingsDb();t.after(f.close)
  const insert=f.sqlite.prepare(`INSERT INTO daily_receipt_conferences(id,business_id,business_date,revision,source_version,snapshot_json,note,status,request_key,created_at,actor_name)
    VALUES(?,'amor-e-sabor',?,?,?,?,?,'com_ressalva',?,'2026-10-15T18:00:00Z','Marina')`)
  for(let i=0;i<count;i++)insert.run('c'+String(i).padStart(3,'0'),'2026-10-15',i+1,'v'+i,
    JSON.stringify([{method:'Pix',netCents:7700,checkedCents:6000,differenceCents:-1700}]),'Nota original','request'+i)
  return f
}
const solution={reason:'conference_error',note:'Localizei o valor em outra conta.',confirmed:true}

test('pending discrepancies paginate across all dates without financial writes or duplicate rows',async t=>{
  assert.equal(typeof repository.readDayConferenceDiscrepancies,'function')
  const f=fixture(t,25),before=f.sqlite.prepare('SELECT total_changes() n').get().n
  const first=await repository.readDayConferenceDiscrepancies(f.db,'amor-e-sabor','pending')
  assert.equal(first.items.length,20);assert.ok(first.nextCursor)
  const next=await repository.readDayConferenceDiscrepancies(f.db,'amor-e-sabor','pending',first.nextCursor)
  assert.equal(next.items.length,5);assert.equal(next.nextCursor,null)
  assert.equal(new Set([...first.items,...next.items].map(x=>x.id)).size,25)
  assert.equal(first.items[0].differenceCents,-1700)
  assert.equal(f.sqlite.prepare('SELECT total_changes() n').get().n,before)
  assert.deepEqual((await repository.readDayConferenceDiscrepancies(f.db,'other','pending')).items,[])
  await assert.rejects(repository.readDayConferenceDiscrepancies(f.db,'amor-e-sabor','all'),{status:400})
  await assert.rejects(repository.readDayConferenceDiscrepancies(f.db,'amor-e-sabor','pending','broken'),{status:400})
})

test('resolve preserves snapshots and financial rows, records actor and supports only identical replay',async t=>{
  assert.equal(typeof repository.resolveDayConferenceDiscrepancy,'function')
  const f=fixture(t),before=JSON.stringify(f.sqlite.prepare('SELECT * FROM daily_receipt_conferences').all())
  const db={...f.db,auditContext:{businessId:'amor-e-sabor',displayName:'Gestora',userId:'manager'}}
  const now=new Date('2026-10-24T18:00:00Z')
  const done=await repository.resolveDayConferenceDiscrepancy(db,'amor-e-sabor','manager','c000:0',solution,now)
  assert.equal(done.status,'resolved');assert.equal(done.resolvedActorName,'Gestora')
  assert.equal(done.resolvedAt,now.toISOString());assert.equal(done.conferenceNote,'Nota original')
  const beforeReplay=f.sqlite.prepare('SELECT total_changes() n').get().n
  assert.deepEqual(await repository.resolveDayConferenceDiscrepancy(db,'amor-e-sabor','manager','c000:0',solution),done)
  assert.equal(f.sqlite.prepare('SELECT total_changes() n').get().n,beforeReplay)
  for(const [actor,body] of [['other',solution],['manager',{...solution,note:'Outra solução'}]])
    await assert.rejects(repository.resolveDayConferenceDiscrepancy(db,'amor-e-sabor',actor,'c000:0',body),{status:409})
  await assert.rejects(repository.readDayConferenceDiscrepancy(f.db,'other','c000:0'),{status:404})
  await assert.rejects(repository.resolveDayConferenceDiscrepancy(f.db,'other','manager','c000:0',solution),{status:404})
  assert.equal(JSON.stringify(f.sqlite.prepare('SELECT * FROM daily_receipt_conferences').all()),before)
  assert.equal((await repository.readDayConferenceDiscrepancies(f.db,'amor-e-sabor','resolved')).items.length,1)
  assert.equal((await repository.readDayConferenceDiscrepancies(f.db,'amor-e-sabor','pending')).items.length,0)
})

test('resolution validates every input and requires a reference for source corrections',async t=>{
  assert.equal(typeof repository.resolveDayConferenceDiscrepancy,'function')
  const f=fixture(t)
  for(const input of [null,[],{}, {...solution,confirmed:false},{...solution,note:'  '},
    {...solution,note:'a'.repeat(1001)},{...solution,reason:'unknown'},{...solution,reason:['conference_error']},
    {...solution,reason:'source_corrected'},{...solution,reference:123}])
    await assert.rejects(repository.resolveDayConferenceDiscrepancy(f.db,'amor-e-sabor','manager','c000:0',input),{status:400})
  const done=await repository.resolveDayConferenceDiscrepancy(f.db,'amor-e-sabor','manager','c000:0',{
    ...solution,reason:'source_corrected',reference:'Pedido #43 revisado',
  })
  assert.equal(done.resolutionReference,'Pedido #43 revisado')
})

test('two operators cannot overwrite each other while a later revision remains independently pending',async t=>{
  const f=fixture(t,2)
  const results=await Promise.allSettled(['first','second'].map(actor=>repository.resolveDayConferenceDiscrepancy(
    {...f.db,auditContext:{businessId:'amor-e-sabor',displayName:actor}},'amor-e-sabor',actor,'c000:0',solution)))
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1)
  assert.equal(results.find(x=>x.status==='rejected').reason.status,409)
  const pending=await repository.readDayConferenceDiscrepancies(f.db,'amor-e-sabor','pending')
  assert.deepEqual(pending.items.map(x=>x.id),['c001:0'])
  assert.equal((await repository.readDayConferenceDiscrepancies(f.db,'amor-e-sabor','resolved')).items.length,1)
})
