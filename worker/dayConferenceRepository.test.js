import test from 'node:test'
import assert from 'node:assert/strict'
import { createSettingsDb } from './test-support/settingsDb.js'
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
    (id,business_id,type,category,description,value_cents,source,movement_date,created_at,payment_method)
    VALUES (?,?,?,'Recebimentos','Teste',?,?,?,?,?)`)
  const add=(id,biz,type,source,cents,method,date=day)=>{
    insert.run(id,biz,type,cents,source,date,date+'T13:00:00.000Z',method)
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
  const replay=await completeDayConference(f.db,'a','manager',body,now)
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
  assert.equal(done.revision,null)
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
