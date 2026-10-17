import test from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {readdirSync,readFileSync,existsSync} from 'node:fs'
import {d1Adapter} from './test-support/settingsDb.js'
import {seedOperationalReadFixture} from './test-support/operationalReadFixture.js'

const migrations=new URL('../migrations/',import.meta.url)
const migration=new URL('0043_operational_order_read_indexes.sql',migrations)
const indexNames=['orders_business_active_created_idx','order_items_business_order_created_idx']

test('operational read indexes preserve the full previous schema and historical data on upgrade',async t=>{
  assert.ok(existsSync(migration),'missing operational read migration 0043')
  const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close())
  for(const file of readdirSync(migrations).filter(name=>name.endsWith('.sql') && Number(name.slice(0,4))<43).sort()){
    if(Number(file.slice(0,4))===24)sqlite.exec('PRAGMA foreign_keys=ON')
    sqlite.exec(readFileSync(new URL(file,migrations),'utf8'))
  }
  const db=d1Adapter(sqlite)
  await seedOperationalReadFixture(db,{historicalOrders:100,activeOrders:2})
  sqlite.prepare(`INSERT INTO print_jobs(id,business_id,type,trigger,status,copies_requested,copies_printed,snapshot_json,created_at,available_at)
    VALUES ('read-preserved-print','amor-e-sabor','test','manual','printed',1,1,'{"historical":true}','2026-10-13','2026-10-13')`).run()
  const tables=['orders','order_items','print_jobs','print_job_attempts','audit_events']
  const snapshot=()=>Object.fromEntries(tables.map(table=>[table,sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
  const before=snapshot()
  const schema=()=>sqlite.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
  const priorSchema=schema(),sql=readFileSync(migration,'utf8')
  sqlite.exec(sql)
  assert.deepEqual(snapshot(),before)
  assert.deepEqual(schema().filter(row=>!indexNames.includes(row.name)),priorSchema)
  assert.deepEqual(schema().filter(row=>indexNames.includes(row.name)).map(row=>row.name),[...indexNames].sort())
  for(const name of indexNames){
    const index=schema().find(row=>row.name===name)
    assert.equal(index.type,'index')
    const expected=sql.match(new RegExp(`CREATE INDEX ${name}\\b[\\s\\S]*?;`))?.[0]
    assert.ok(expected)
    const normalize=text=>text.trim().replace(/;$/,'').replace(/\s+/g,' ')
    assert.equal(normalize(index.sql),normalize(expected))
  }
  assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[])
})
