// Task 16: additive migration gate from pre-edit 0041, using real SQLite
// constraints. Wrangler/local-D1 is separately exercised by Validate.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'

const dir = new URL('../../migrations/', import.meta.url)
const files = readdirSync(dir).filter(s=>/^[0-9]{4}_.*[.]sql$/.test(s)).sort()
const cut = files.findIndex(s=>s.startsWith('0042_'))
const at='2026-10-12T12:00:00.000Z', biz='amor-e-sabor'
const source = n=>readFileSync(new URL(n,dir),'utf8')
const one = (db,q,...params)=>db.prepare(q).get(...params)
const count = (db,q,...params)=>one(db,q,...params).n
const fk = db=>assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[])
const ddl = db=>db.prepare("SELECT name,type,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name!='gate_versions' ORDER BY name,type").all()
function apply(db,until=files.length) {
  for(const name of files.slice(0,until)){
    const text=source(name),hash=createHash('sha256').update(text).digest('hex')
    const saved=one(db,'SELECT hash FROM gate_versions WHERE file=?',name)
    if(saved){assert.equal(saved.hash,hash,'migration drift: '+name);continue}
    if(Number(name.slice(0,4))<24)db.exec(text)
    else{
      db.exec('PRAGMA foreign_keys=ON')
      db.exec('BEGIN')
      try{db.exec(text);db.exec('COMMIT')}
      catch(e){db.exec('ROLLBACK');throw Error('migration '+name+': '+e.message)}
    }
    db.prepare('INSERT INTO gate_versions(file,hash) VALUES(?,?)').run(name,hash)
  }
  db.exec('PRAGMA foreign_keys=ON')
}
function fresh(until=files.length){
  const db=new DatabaseSync(':memory:')
  db.exec('CREATE TABLE gate_versions(file TEXT PRIMARY KEY,hash TEXT NOT NULL)')
  apply(db,until);fk(db);return db
}
function historical(db) {
  db.prepare('INSERT INTO businesses(id,slug,name,created_at,updated_at) VALUES(?,?,?,?,?)')
    .run('other-upgrade-gate','other-upgrade-gate','Other company',at,at)
  for(const [id,number] of [['upgrade-a',901],['upgrade-b',902]])db.prepare(
    "INSERT INTO orders(id,business_id,order_number,client_name_snapshot,type,order_date,status,subtotal_cents,total_cents,created_at) "+
    "VALUES(?, ?, ?, 'Cliente','Entrega','2026-10-12','Em preparo',8000,8000,?)"
  ).run(id,biz,number,at)
  db.prepare('INSERT INTO payment_receipts(id,business_id,total_cents,paid_at,created_at) VALUES(?,?,?,?,?)')
    .run('legacy-shared',biz,16000,at,at)
  for(const [id,code,value] of [['old-pix','pix',10000],['old-cash','cash',6000]]){
    db.prepare('INSERT INTO payment_allocations(id,business_id,receipt_id,method_code,method_label,amount_cents,created_at) VALUES(?,?,?,?,?,?,?)')
      .run(id,biz,'legacy-shared',code,code==='pix'?'Pix':'Dinheiro',value,at)
  }
  for(const [i,id] of ['upgrade-a','upgrade-b'].entries())
    db.prepare('INSERT INTO payments(id,business_id,order_id,receipt_id,amount_cents,paid_at,created_at) VALUES(?,?,?,?,?,?,?)')
      .run('old-payment-'+i,biz,id,'legacy-shared',8000,at,at)
  fk(db)
}
const savedHistorical=db=>({
  orders:db.prepare("SELECT id,business_id,order_number,status,total_cents FROM orders WHERE id LIKE 'upgrade-%' ORDER BY id").all(),
  receipts:db.prepare("SELECT id,business_id,total_cents FROM payment_receipts WHERE id='legacy-shared'").all(),
  payments:db.prepare("SELECT id,order_id,receipt_id,amount_cents FROM payments WHERE id LIKE 'old-payment-%' ORDER BY id").all(),
  allocations:db.prepare("SELECT id,receipt_id,method_code,amount_cents FROM payment_allocations WHERE receipt_id='legacy-shared' ORDER BY id").all()
})
function schema(db){
  for(const name of ['order_edit_revisions','order_edit_mutation_receipts',
    'order_settlement_entries','order_supplemental_mutation_receipts',
    'order_partial_refund_mutation_receipts'])
    assert.ok(one(db,"SELECT name FROM sqlite_master WHERE type='table' AND name=?",name),'missing '+name)
  assert.ok(db.prepare('PRAGMA table_info(orders)').all().some(x=>x.name==='content_revision'))
  assert.equal(count(db,"SELECT count(*) n FROM order_edit_revisions"),0)
  assert.equal(count(db,"SELECT count(*) n FROM order_settlement_entries"),0)
  fk(db)
}
function settlement(db) {
  db.prepare('INSERT INTO payment_receipts(id,business_id,total_cents,paid_at,created_at) VALUES(?,?,?,?,?)')
    .run('new-receipt',biz,1500,at,at)
  for(const [id,code,cents] of [['new-pix','pix',1000],['new-cash','cash',500]])
    db.prepare('INSERT INTO payment_allocations(id,business_id,receipt_id,method_code,method_label,amount_cents,created_at) VALUES(?,?,?,?,?,?,?)')
      .run(id,biz,'new-receipt',code,code==='pix'?'Pix':'Dinheiro',cents,at)
  const supplement=db.prepare(
    "INSERT INTO order_settlement_entries(id,business_id,order_id,kind,amount_cents,receipt_id,mutation_id,actor_name,created_at) "+
    "VALUES(?,?,?,'supplemental_payment',?,?,?,'Operador',?)")
  supplement.run('extra-1',biz,'upgrade-a',1500,'new-receipt','cmd-extra',at)
  db.prepare("INSERT INTO order_supplemental_mutation_receipts(business_id,order_id,mutation_id,request_hash,settlement_entry_id,result_json,created_at) VALUES(?,?,?,?,?,'{}',?)")
    .run(biz,'upgrade-a','cmd-extra','a'.repeat(64),'extra-1',at)
  assert.throws(()=>supplement.run('foreign','other-upgrade-gate','upgrade-a',500,'new-receipt','foreign',at),/FOREIGN KEY|ORDER_SETTLEMENT_RECEIPT_INVALID/)
  assert.throws(()=>supplement.run('duplicate',biz,'upgrade-a',100,'new-receipt','duplicate',at),/UNIQUE|ORDER_SETTLEMENT_RECEIPT_OVERALLOCATED/)
  assert.throws(()=>db.prepare("UPDATE order_settlement_entries SET amount_cents=5 WHERE id='extra-1'").run(),/ORDER_SETTLEMENT_IMMUTABLE/)
  assert.throws(()=>db.prepare("UPDATE payment_receipts SET total_cents=2000 WHERE id='new-receipt'").run(),/ORDER_SETTLEMENT_RECEIPT_IMMUTABLE/)
  assert.throws(()=>db.prepare("UPDATE payment_allocations SET amount_cents=9 WHERE id='new-pix'").run(),/ORDER_SETTLEMENT_ALLOCATION_IMMUTABLE/)
  db.prepare("INSERT INTO movements(id,business_id,type,category,description,value_cents,source,order_id,movement_date,created_at,updated_at) VALUES(?,?,'saida','Estornos','Devolução',1000,'order-edit-refund','upgrade-a','2026-10-12',?,?)")
    .run('refund-move',biz,at,at)
  db.prepare("INSERT INTO order_settlement_entries(id,business_id,order_id,kind,amount_cents,movement_id,mutation_id,actor_name,created_at) VALUES(?,?,?,'refund',1000,?,'cmd-refund','Operador',?)")
    .run('refund-entry',biz,'upgrade-a','refund-move',at)
  db.prepare("INSERT INTO order_partial_refund_mutation_receipts(business_id,order_id,mutation_id,request_hash,settlement_entry_id,result_json,created_at) VALUES(?,?,?,?,?,'{}',?)")
    .run(biz,'upgrade-a','cmd-refund','b'.repeat(64),'refund-entry',at)
  assert.throws(()=>db.prepare("UPDATE movements SET value_cents=2500 WHERE id='refund-move'").run(),/ORDER_SETTLEMENT_MOVEMENT_IMMUTABLE/)
  const totals=db.prepare("SELECT o.id,COALESCE(p.amount_cents,0) + COALESCE((SELECT SUM(e.amount_cents) FROM order_settlement_entries e WHERE e.business_id=o.business_id AND e.order_id=o.id AND e.kind='supplemental_payment'),0) AS gross,COALESCE((SELECT SUM(e.amount_cents) FROM order_settlement_entries e WHERE e.business_id=o.business_id AND e.order_id=o.id AND e.kind='refund'),0) AS refunded FROM orders o LEFT JOIN payments p ON p.business_id=o.business_id AND p.order_id=o.id WHERE o.id LIKE 'upgrade-%' ORDER BY o.id").all()
  assert.deepEqual(totals.map(x=>[x.id,x.gross,x.refunded]),[['upgrade-a',9500,1000],['upgrade-b',8000,0]])
  fk(db)
}
const result={gate:'order-editing-0041-upgrade',upgrade:false,clean:false,idempotent:false,foreignKeys:false,immutability:false}
try{
  assert.ok(cut>0&&files[cut-1].startsWith('0041_'),'expected migration boundary 0041→0042')
  const clean=fresh()
  try{schema(clean);result.clean=true}finally{clean.close()}
  const db=fresh(cut)
  try{
    historical(db)
    const before=savedHistorical(db)
    apply(db);schema(db)
    assert.deepEqual(savedHistorical(db),before,'historical payment or business rows changed')
    assert.equal(count(db,"SELECT count(*) n FROM orders WHERE id LIKE 'upgrade-%' AND content_revision=0"),2)
    const versionRows=db.prepare('SELECT * FROM gate_versions ORDER BY file').all(),master=ddl(db)
    apply(db)
    assert.deepEqual(db.prepare('SELECT * FROM gate_versions ORDER BY file').all(),versionRows,'retry must be no-op')
    assert.deepEqual(ddl(db),master,'retry must not modify schema')
    assert.deepEqual(savedHistorical(db),before,'retry must preserve financial data')
    result.idempotent=true
    settlement(db)
    result.upgrade=true;result.foreignKeys=true;result.immutability=true
  }finally{db.close()}
  result.migrations=files.length
  result.ok=true
}catch(error){result.ok=false;result.error=error.message;process.exitCode=1}
process.stdout.write(JSON.stringify(result)+'\n')
