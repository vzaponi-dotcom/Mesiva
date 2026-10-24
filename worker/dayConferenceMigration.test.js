import test from 'node:test'
import assert from 'node:assert/strict'
import { createSettingsDb } from './test-support/settingsDb.js'
import { readDayConferenceState } from './dayConferenceRepository.js'

test('0053/0054 populated upgrade preserves every financial row and historical snapshot',async t=>{
  let before
  const financial=sqlite=>JSON.stringify(['payments','payment_receipts','payment_allocations','movements']
    .map(table=>sqlite.prepare(`SELECT * FROM ${table} ORDER BY id`).all()))
  const f=createSettingsDb({beforeMigration(name,sqlite){
    if(name.startsWith('0053_'))sqlite.exec(`
      INSERT INTO payment_receipts(id,business_id,total_cents,paid_at,received_date,created_at)
        VALUES('old-r','amor-e-sabor',1000,'2026-10-17T15:00:00Z','2026-10-15','2026-10-17T15:00:00Z');
      INSERT INTO payment_allocations(id,business_id,receipt_id,method_label,amount_cents,created_at)
        VALUES('old-a','amor-e-sabor','old-r','Pix',1000,'2026-10-17');
      INSERT INTO movements(id,business_id,type,category,description,value_cents,source,movement_date,created_at,receipt_id,payment_allocation_id)
        VALUES('old-m','amor-e-sabor','entrada','sales','Upgrade',1000,'order-payment','2026-10-15','2026-10-17','old-r','old-a');
    `)
    if(name.startsWith('0054_')){
      sqlite.exec(`INSERT INTO daily_receipt_conferences(id,business_id,business_date,revision,source_version,snapshot_json,status,request_key,created_at)
        VALUES('old-c','amor-e-sabor','2026-10-15',1,'original-version','[]','conferida','old-request','2026-10-17')`)
      before=financial(sqlite)
    }
  }})
  t.after(f.close)
  assert.equal(financial(f.sqlite),before)
  const state=await readDayConferenceState(f.db,'amor-e-sabor','2026-10-15')
  assert.equal(state.integrityIssues,0)
  assert.equal(state.methods[0].grossCents,1000)
  assert.equal(state.latest.sourceVersion,'original-version')
  assert.notEqual(state.sourceVersion,state.latest.sourceVersion,'old fingerprints require a new review')
  assert.deepEqual(f.sqlite.prepare('PRAGMA foreign_key_check').all(),[])
})

test('day source tracking preserves physical company cascade compatibility',t=>{
  const f=createSettingsDb();t.after(f.close)
  f.sqlite.exec(`INSERT INTO businesses(id,slug,name,created_at,updated_at) VALUES('cascade','cascade','Cascade','2026-10-01','2026-10-01');
    INSERT INTO movements(id,business_id,type,category,description,value_cents,source,movement_date,created_at)
    VALUES('cascade-m','cascade','saida','refunds','Test',100,'order-edit-refund','2026-10-15','2026-10-15');
    DELETE FROM businesses WHERE id='cascade'`)
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM daily_receipt_source_revisions WHERE business_id='cascade'").get().n,0)
  assert.deepEqual(f.sqlite.prepare('PRAGMA foreign_key_check').all(),[])
})
