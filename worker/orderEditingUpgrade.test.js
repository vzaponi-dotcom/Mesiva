import test from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {readdirSync,readFileSync} from 'node:fs'
const dir=new URL('../migrations/',import.meta.url)
const files=readdirSync(dir).filter(f=>f.endsWith('.sql')).sort()
const feature=new Set(['0042_order_editing_foundation.sql','0043_order_settlement_ledger.sql','0044_order_supplemental_idempotency.sql','0045_order_partial_refund_idempotency.sql'])
const base=files.filter(f=>Number(f.slice(0,4))<=41)
const at='2026-10-16T12:00:00.000Z',biz='amor-e-sabor'
function apply(db,names){for(const file of names){const sql=readFileSync(new URL(file,dir),'utf8');if(Number(file.slice(0,4))<24)db.exec(sql);else{db.exec('PRAGMA foreign_keys=ON; BEGIN');try{db.exec(sql);db.exec('COMMIT')}catch(error){db.exec('ROLLBACK');throw error}}}}
for(const history of ['master','pr108'])test(`editing upgrade preserves ${history} history and backfills balances without duplicating money`,t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close())
 const old=history==='master'?files.filter(f=>Number(f.slice(0,4))<50&&!feature.has(f)):[...base,...files.filter(f=>feature.has(f))]
 apply(db,old)
 db.prepare("INSERT INTO orders(id,business_id,client_name_snapshot,type,order_date,status,subtotal_cents,total_cents,created_at) VALUES('legacy',?,'Fictício','Retirada','2026-10-16','Em preparo',3000,3000,?)").run(biz,at)
 db.prepare("INSERT INTO payment_receipts(id,business_id,total_cents,paid_at,created_at) VALUES('r',?,3000,?,?)").run(biz,at,at)
 db.prepare("INSERT INTO payment_allocations(id,business_id,receipt_id,method_code,method_label,amount_cents,created_at) VALUES('a',?,'r','pix','Pix',3000,?)").run(biz,at)
 db.prepare("INSERT INTO payments(id,business_id,order_id,receipt_id,amount_cents,paid_at,created_at) VALUES('p',?,'legacy','r',3000,?,?)").run(biz,at,at)
 // Both histories may have real content/price changes before the combined upgrade.
 db.exec("UPDATE orders SET subtotal_cents=4500,total_cents=4500 WHERE id='legacy'")
 const tables=['orders','payments','payment_receipts','payment_allocations','movements','audit_events']
 const before=tables.map(table=>db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all())
 apply(db,files.filter(file=>!old.includes(file)))
 for(const [i,table] of tables.entries()){
  const after=db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()
  // Foundation adds columns, preserving every value already stored in master.
  for(const [j,row] of before[i].entries())for(const key of Object.keys(row))assert.deepEqual(after[j][key],row[key],table+'.'+key)
 }
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[])
 assert.equal(db.prepare("SELECT kind FROM order_financial_candidates WHERE order_id='legacy'").get().kind,'unpaid')
 assert.equal(db.prepare("SELECT net_received_cents FROM order_financial_candidate_source WHERE order_id='legacy'").get().net_received_cents,3000)
 assert.throws(()=>db.prepare("INSERT INTO client_payment_mutation_receipts(business_id,client_id,mutation_id,request_hash,receipt_id,order_ids_json,created_at) VALUES('other','client','cross','hash','r','[\"legacy\"]',?)").run(at),/FOREIGN KEY/)
})
