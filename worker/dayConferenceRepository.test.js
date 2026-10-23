import test from 'node:test'
import assert from 'node:assert/strict'
import { createSettingsDb } from './test-support/settingsDb.js'
import { readReceivedToday } from './readModels/movementReads.js'
import {
  readConferenceDate, readDayConferenceSummary, readDayConferenceEntries,
  readDayConferenceHistory, completeDayConference,
} from './dayConferenceRepository.js'

const day='2026-10-15'
function fixture(t){
  const f=createSettingsDb()
  t.after(f.close)
  f.sqlite.exec(`INSERT INTO businesses (id,slug,name,created_at,updated_at)
    VALUES ('a','a','A','2026-10-10','2026-10-10'),('b','b','B','2026-10-10','2026-10-10')`)
  const insert=f.sqlite.prepare(`INSERT INTO movements
    (id,business_id,type,category,description,value_cents,source,movement_date,created_at,payment_method,receipt_id,payment_allocation_id)
    VALUES (?,?,?,'Recebimentos','Teste',?,?,?,?,?,?,?)`)
  const receipt=f.sqlite.prepare(`INSERT INTO payment_receipts
    (id,business_id,total_cents,paid_at,created_at,received_date) VALUES (?,?,?,?,?,?)`)
  const allocation=f.sqlite.prepare(`INSERT INTO payment_allocations
    (id,business_id,receipt_id,method_label,amount_cents,created_at) VALUES (?,?,?,?,?,?)`)
  const add=(id,biz,type,source,cents,method,date=day)=>{
    const created=date+'T13:00:00.000Z'
    if(source==='order-payment'){
      receipt.run('receipt-'+id,biz,cents,created,created,date)
      allocation.run('allocation-'+id,biz,'receipt-'+id,method,cents,created)
    }
    insert.run(id,biz,type,cents,source,date,created,method,
      source==='order-payment'?'receipt-'+id:null,
      source==='order-payment'?'allocation-'+id:null)
  }
  add('pix-1','a','entrada','order-payment',1000,'Pix')
  add('pix-2','a','entrada','order-payment',500,'Pix')
  add('cash-1','a','entrada','order-payment',800,'Dinheiro')
  add('refund','a','saida','order-refund',200,'Pix')
  add('manual','a','entrada','manual',9000,'Pix')
  add('other-day','a','entrada','order-payment',600,'Pix','2026-10-14')
  add('other-business','b','entrada','order-payment',80000,'Pix')
  return {...f,add}
}

test('daily conference totals match real receipt movements, not unrelated/manual records',async t=>{
  const f=fixture(t)
  const s=await readDayConferenceSummary(f.db,'a',day)
  assert.deepEqual(s.methods.map(({method,grossCents,refundCents,netCents})=>[method,grossCents,refundCents,netCents]),[
    ['Dinheiro',800,0,800],['Pix',1500,200,1300],
  ])
  const pix=await readDayConferenceEntries(f.db,'a',day,'Pix',1)
  assert.equal(pix.entries.length,3)
  assert.equal(pix.entries.reduce((n,item)=>n+(item.type==='saida'?-item.amountCents:item.amountCents),0),1300)
  assert.equal((await readDayConferenceSummary(f.db,'b',day)).methods[0].grossCents,80000)
  assert.equal((await readDayConferenceSummary(f.db,'a','2026-10-14')).methods[0].grossCents,600)
})

test('a difference in one method requires a note even when global differences cancel',async t=>{
  const f=fixture(t),summary=await readDayConferenceSummary(f.db,'a',day)
  const now=new Date('2026-10-15T18:00:00Z')
  const body={date:day,sourceVersion:summary.sourceVersion,requestKey:'request-00000000000001',
    lines:[{method:'Dinheiro',checkedCents:900,verified:true},{method:'Pix',checkedCents:1200,verified:true}]}
  await assert.rejects(completeDayConference(f.db,'a','manager',body,now),{code:'INVALID_CONFERENCE_NOTE'})
  const done=await completeDayConference(f.db,'a','manager',{...body,note:'Conferir diferenças individuais.'},now)
  assert.equal(done.status,'com_ressalva')
  assert.deepEqual(done.lines.map(x=>x.differenceCents),[100,-100])
  assert.equal((await readDayConferenceHistory(f.db,'a',day))[0].status,'com_ressalva')
  const replay=await completeDayConference(f.db,'a','manager',{...body,note:'Conferir diferenças individuais.'},now)
  assert.equal(replay.id,done.id)
  await assert.rejects(completeDayConference(f.db,'a','manager',{...body,requestKey:'request-00000000000002',note:'Diferenças.'},now),{code:'CONFERENCE_ALREADY_DONE'})
})

test('changes to receipts invalidate an old summary, preserve prior snapshot and allow revision',async t=>{
  const f=fixture(t),now=new Date('2026-10-15T18:00:00Z')
  const initial=await readDayConferenceSummary(f.db,'a',day)
  const body={date:day,sourceVersion:initial.sourceVersion,requestKey:'request-00000000000003',
    lines:initial.methods.map(m=>({method:m.method,checkedCents:m.netCents,verified:true})),note:''}
  const done=await completeDayConference(f.db,'a','manager',body,now)
  f.add('late','a','entrada','order-payment',500,'Pix')
  await assert.rejects(completeDayConference(f.db,'a','manager',{...body,requestKey:'request-00000000000004'},now),{code:'CONFERENCE_CHANGED'})
  const updated=await readDayConferenceSummary(f.db,'a',day)
  const second=await completeDayConference(f.db,'a','manager',{
    ...body,sourceVersion:updated.sourceVersion,requestKey:'request-00000000000005',
    lines:updated.methods.map(m=>({method:m.method,checkedCents:m.netCents,verified:true})),
  },now)
  assert.equal(done.revision,1)
  assert.equal(second.status,'conferida')
  const history=await readDayConferenceHistory(f.db,'a',day)
  assert.deepEqual(history.map(x=>x.revision),[2,1])
  assert.equal(history[1].lines.find(x=>x.method==='Pix').grossCents,1500)
})

test('invalid dates, unknown methods and incomplete entries are rejected',async t=>{
  const f=fixture(t),now=new Date('2026-10-15T18:00:00Z')
  assert.throws(()=>readConferenceDate('2026-02-30',now),{status:400})
  assert.throws(()=>readConferenceDate('2026-10-16',now),{status:400})
  await assert.rejects(readDayConferenceEntries(f.db,'a',day,'',1),{status:400})
  const s=await readDayConferenceSummary(f.db,'a',day)
  await assert.rejects(completeDayConference(f.db,'a','manager',{
    date:day,sourceVersion:s.sourceVersion,requestKey:'request-00000000000006',
    lines:[{method:'Pix',checkedCents:1300,verified:true}],
  },now),{code:'INVALID_CONFERENCE_LINES'})
})

test('sourceVersion detects compensated edits, replacement, deletion and restoration', async t => {
  const f = fixture(t)
  const initial = await readDayConferenceSummary(f.db, 'a', day)
  f.sqlite.exec("UPDATE movements SET value_cents=value_cents+100 WHERE id='pix-1'; UPDATE movements SET value_cents=value_cents-100 WHERE id='pix-2'")
  const edited = await readDayConferenceSummary(f.db, 'a', day)
  assert.notEqual(edited.sourceVersion, initial.sourceVersion)
  f.sqlite.exec("UPDATE movements SET id='pix-0' WHERE id='pix-1'")
  const replaced = await readDayConferenceSummary(f.db, 'a', day)
  assert.notEqual(replaced.sourceVersion, edited.sourceVersion)
  f.sqlite.exec("UPDATE movements SET deleted_at='2026-10-16' WHERE id='pix-0'; UPDATE movements SET deleted_at=NULL WHERE id='pix-0'")
  assert.notEqual((await readDayConferenceSummary(f.db, 'a', day)).sourceVersion, replaced.sourceVersion)
})

test('completion rejects a movement inserted after its authoritative read', async t => {
  const f = fixture(t), summary = await readDayConferenceSummary(f.db, 'a', day)
  let injected = false
  const db = { ...f.db, prepare(sql) {
    if (/INSERT.*daily_receipt_conferences/s.test(sql) && !injected) {
      injected = true
      f.add('racing-payment', 'a', 'entrada', 'order-payment', 100, 'Pix')
    }
    return f.db.prepare(sql)
  } }
  await assert.rejects(completeDayConference(db, 'a', 'manager', {
    date:day, sourceVersion:summary.sourceVersion, requestKey:'request-racing-000001',
    lines:summary.methods.map(m=>({method:m.method,checkedCents:m.netCents,verified:true})),
  }, new Date('2026-10-15T18:00:00Z')), { code:'CONFERENCE_CHANGED' })
  assert.equal((await readDayConferenceHistory(f.db, 'a')).length, 0)
})

test('refunds never inherit the method used for an original legacy payment', async t => {
  const f = createSettingsDb({ beforeMigration(name, sqlite) {
    if (!name.startsWith('0026_')) return
    sqlite.exec(`INSERT INTO orders(id,business_id,client_name_snapshot,type,order_date,status,subtotal_cents,total_cents,created_at)
      VALUES('legacy-order','amor-e-sabor','Legacy','Retirada','2026-10-14','Finalizado',1000,1000,'2026-10-14');
      INSERT INTO payments(id,business_id,order_id,amount_cents,method,paid_at,created_at)
      VALUES('legacy-payment','amor-e-sabor','legacy-order',1000,'Crédito','2026-10-14T15:00:00Z','2026-10-14');
      INSERT INTO movements(id,business_id,type,category,description,value_cents,source,order_id,payment_id,movement_date,created_at)
      VALUES('legacy-refund','amor-e-sabor','saida','Estornos','Legacy',200,'order-refund','legacy-order','legacy-payment','2026-10-15','2026-10-15')`)
  } })
  t.after(f.close)
  const summary = await readDayConferenceSummary(f.db, 'amor-e-sabor', day)
  assert.equal(summary.methods.find(m=>m.method==='Não informado')?.refundCents, 200)
  assert.equal(summary.methods.some(m=>m.method==='Crédito'), false)
})

test('idempotency rejects reuse of a key with a different date, value or actor', async t => {
  const f = fixture(t), summary = await readDayConferenceSummary(f.db,'a',day)
  const body = {date:day,sourceVersion:summary.sourceVersion,requestKey:'request-replay-000001',
    lines:summary.methods.map(m=>({method:m.method,checkedCents:m.netCents,verified:true}))}
  const now = new Date('2026-10-15T18:00:00Z')
  await completeDayConference(f.db,'a','manager',body,now)
  for (const patch of [{date:'2026-10-14'}, {note:'Alterado'}, {lines:body.lines.map(l=>({...l,checkedCents:l.checkedCents+1})),note:'Diferença'}]) {
    await assert.rejects(completeDayConference(f.db,'a','manager',{...body,...patch},now),{code:'CONFERENCE_KEY_REUSED'})
  }
  await assert.rejects(completeDayConference(f.db,'a','other-user',body,now),{code:'CONFERENCE_KEY_REUSED'})
})

test('refund-only days can be reconciled with a negative external net amount', async t => {
  const f = fixture(t)
  f.add('refund-only','a','saida','order-edit-refund',1000,'Pix','2026-10-13')
  const summary = await readDayConferenceSummary(f.db,'a','2026-10-13')
  const done = await completeDayConference(f.db,'a','manager',{
    date:'2026-10-13',sourceVersion:summary.sourceVersion,requestKey:'request-negative-00001',
    lines:[{method:'Pix',checkedCents:-1000,verified:true}],
  },new Date('2026-10-15T18:00:00Z'))
  assert.equal(done.status,'conferida')
  assert.equal(done.revision,1)
})

test('receipt/allocation inconsistencies are visible and block completion without repairing data', async t => {
  const f = fixture(t)
  f.sqlite.exec("UPDATE payment_allocations SET amount_cents=900 WHERE id='allocation-pix-1'")
  const summary=await readDayConferenceSummary(f.db,'a',day)
  assert.ok(summary.integrityIssues>0)
  await assert.rejects(completeDayConference(f.db,'a','manager',{
    date:day,sourceVersion:summary.sourceVersion,requestKey:'request-inconsistent-00001',
    lines:summary.methods.map(m=>({method:m.method,checkedCents:m.netCents,verified:true})),
  },new Date('2026-10-15T18:00:00Z')),{code:'CONFERENCE_SOURCE_INCONSISTENT'})
  assert.equal(f.sqlite.prepare("SELECT amount_cents FROM payment_allocations WHERE id='allocation-pix-1'").get().amount_cents,900)
})

test('a receipt whose allocation has no active movement cannot silently disappear from the day', async t => {
  const f=fixture(t)
  f.sqlite.exec("UPDATE movements SET deleted_at='2026-10-15' WHERE id='pix-1'")
  assert.ok((await readDayConferenceSummary(f.db,'a',day)).integrityIssues>0)
})

test('each full paginated detail reconciles exactly and rejects a changed day between pages', async t=>{
  const f=fixture(t)
  for(let i=0;i<110;i++)f.add('paged-'+String(i).padStart(3,'0'),'a','entrada','order-payment',101,'Pix')
  const summary=await readDayConferenceSummary(f.db,'a',day)
  let page=1,entries=[]
  do{
    const result=await readDayConferenceEntries(f.db,'a',day,'Pix',page,summary.sourceVersion)
    entries.push(...result.entries);page=result.nextPage
  }while(page)
  assert.equal(entries.length,113)
  assert.equal(new Set(entries.map(e=>e.id)).size,113)
  assert.equal(entries.reduce((sum,e)=>sum+(e.type==='entrada'?e.amountCents:-e.amountCents),0),12410)
  f.add('new-page-entry','a','entrada','order-payment',100,'Pix')
  await assert.rejects(readDayConferenceEntries(f.db,'a',day,'Pix',2,summary.sourceVersion),{code:'CONFERENCE_CHANGED'})
})

test('overview reconciliation distinguishes gross, cancellation refunds and edit refunds in integer cents',async t=>{
  const f=fixture(t)
  f.add('partial','a','saida','order-edit-refund',300,'Dinheiro')
  const summary=await readDayConferenceSummary(f.db,'a',day)
  assert.equal(summary.methods.reduce((sum,m)=>sum+m.grossCents,0),2300)
  assert.equal(summary.methods.reduce((sum,m)=>sum+m.refundCents,0),500)
  assert.equal(summary.methods.reduce((sum,m)=>sum+m.netCents,0),1800)
  assert.equal(await readReceivedToday(f.db,'a',new Set(['finance.movements']),day),21)
  assert.equal(summary.methods.reduce((sum,m)=>sum+m.netCents+m.editRefundCents,0),2100)
})

test('parallel completions produce one revision and same-key retries return that exact result',async t=>{
  const f=fixture(t), summary=await readDayConferenceSummary(f.db,'a',day),now=new Date('2026-10-15T18:00:00Z')
  const body={date:day,sourceVersion:summary.sourceVersion,requestKey:'parallel-request-00001',
    lines:summary.methods.map(m=>({method:m.method,checkedCents:m.netCents,verified:true}))}
  const results=await Promise.all([completeDayConference(f.db,'a','user',body,now),completeDayConference(f.db,'a','user',body,now)])
  assert.equal(results[0].id,results[1].id)
  assert.equal(results[0].revision,1)
  assert.equal((await readDayConferenceHistory(f.db,'a')).length,1)
})

test('date validation follows São Paulo at UTC midnight and leap-year boundaries',()=>{
  const before=new Date('2026-10-16T02:59:59Z'),after=new Date('2026-10-16T03:00:00Z')
  assert.throws(()=>readConferenceDate('2026-10-16',before),{code:'INVALID_CONFERENCE_DATE'})
  assert.equal(readConferenceDate('2026-10-16',after),'2026-10-16')
  assert.throws(()=>readConferenceDate('2025-02-29',after),{code:'INVALID_CONFERENCE_DATE'})
  assert.equal(readConferenceDate('2024-02-29',after),'2024-02-29')
})

test('moving a launch to another date invalidates both dates and leaves other companies untouched',async t=>{
  const f=fixture(t)
  const a=await readDayConferenceSummary(f.db,'a',day),b=await readDayConferenceSummary(f.db,'b',day)
  const other=await readDayConferenceSummary(f.db,'a','2026-10-14')
  f.sqlite.exec("UPDATE movements SET movement_date='2026-10-14' WHERE id='pix-1'")
  assert.notEqual((await readDayConferenceSummary(f.db,'a',day)).sourceVersion,a.sourceVersion)
  assert.notEqual((await readDayConferenceSummary(f.db,'a','2026-10-14')).sourceVersion,other.sourceVersion)
  assert.equal((await readDayConferenceSummary(f.db,'b',day)).sourceVersion,b.sourceVersion)
})

test('ambiguous legacy receipts block every date of their movements, not only the paid_at fallback day',async t=>{
  const f=fixture(t)
  f.sqlite.exec(`UPDATE payment_receipts SET total_cents=2000,received_date=NULL,paid_at='2026-10-15T15:00:00Z' WHERE id='receipt-pix-1';
    INSERT INTO payment_allocations(id,business_id,receipt_id,method_label,amount_cents,created_at)
      VALUES('mixed-cash','a','receipt-pix-1','Dinheiro',1000,'2026-10-15');
    UPDATE movements SET movement_date='2026-10-14' WHERE id='pix-1';
    INSERT INTO movements(id,business_id,type,category,description,value_cents,source,movement_date,created_at,receipt_id,payment_allocation_id,payment_method)
      VALUES('mixed-m','a','entrada','sales','Legacy',1000,'order-payment','2026-10-16','2026-10-16','receipt-pix-1','mixed-cash','Dinheiro')`)
  for(const date of ['2026-10-14','2026-10-15','2026-10-16']){
    assert.ok((await readDayConferenceSummary(f.db,'a',date)).integrityIssues>0,date)
  }
})

test('shared receipts resolve all linked orders in one bounded read, without assigning receipt total to one order',async t=>{
  const f=fixture(t)
  for(const [id,businessId,client] of [['one','a','Cliente Um'],['two','a','Cliente Dois']]){
    f.sqlite.prepare(`INSERT INTO orders (id,business_id,client_name_snapshot,type,order_date,status,subtotal_cents,total_cents,created_at)
      VALUES (?,?,?,'Retirada',?,'Finalizado',500,500,?)`).run('order-'+id,businessId,client,day,day+'T12:00:00Z')
  }
  for(const [id,cents] of [['one',600],['two',400]]){
    f.sqlite.prepare(`INSERT INTO payments(id,business_id,order_id,receipt_id,amount_cents,paid_at,created_at)
      VALUES (?,'a',?,'receipt-pix-1',?,?,?)`).run('payment-'+id,'order-'+id,cents,day+'T13:00:00Z',day+'T13:00:00Z')
  }
  const noPermission=await readDayConferenceEntries(f.db,'a',day,'Pix',1,null,false)
  assert.deepEqual(noPermission.entries.find(e=>e.id==='pix-1').linkedOrders,[])
  const withPermission=await readDayConferenceEntries(f.db,'a',day,'Pix',1,null,true)
  const entry=withPermission.entries.find(e=>e.id==='pix-1')
  assert.equal(entry.amountCents,1000,'movement retains receipt allocation amount, not an order amount')
  assert.deepEqual(entry.linkedOrders.map(x=>x.client),['Cliente Um','Cliente Dois'])
  assert.equal(withPermission.entries.length,noPermission.entries.length)
  assert.deepEqual((await readDayConferenceEntries(f.db,'b',day,'Pix',1,null,true)).entries[0].linkedOrders,[])
})
