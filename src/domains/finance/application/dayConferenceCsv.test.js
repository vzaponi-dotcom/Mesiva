import test from 'node:test'
import assert from 'node:assert/strict'
import { buildDayConferenceCsv } from './dayConferenceCsv.js'

const summary={date:'2026-10-15',sourceVersion:'a'.repeat(64),integrityIssues:0,
  methods:[{method:'Pix',count:2,grossCents:1000,refundCents:200,netCents:800},
    {method:'=personalizada',count:1,grossCents:50,refundCents:0,netCents:50}]}
const entry=(id,amountCents,type='entrada',method='Pix')=>({id,amountCents,type,method,date:summary.date,
  receiptId:'r-'+id,orderId:'o-'+id,orderNumber:'=1+1',source:type==='entrada'?'order-payment':'order-refund',createdAt:'2026-10-16T02:30:00Z'})

test('CSV exports all pages and methods with signed adjustments, scope and safe spreadsheet text',async()=>{
  const calls=[]
  const csv=await buildDayConferenceCsv({summary,request:async path=>{
    const query=new URL(path,'http://local').searchParams;calls.push(query)
    return query.get('method')==='Pix'
      ?query.get('page')==='1'?{entries:[entry('1',1000)],nextPage:2}:{entries:[entry('2',200,'saida')],nextPage:null}
      :{entries:[entry('3',50,'entrada','=personalizada')],nextPage:null}
  }})
  assert.equal(calls.length,3)
  assert.ok(calls.every(q=>q.get('date')===summary.date&&q.get('sourceVersion')===summary.sourceVersion))
  assert.match(csv,/1000/);assert.match(csv,/-200/);assert.match(csv,/'=personalizada/);assert.match(csv,/'=1\+1/)
  assert.match(csv,/America\/Sao_Paulo/);assert.match(csv,/23:30:00/)
  assert.equal(csv.split('\r\n').filter(line=>line.includes('r-')).length,3)
})

test('CSV never returns a partial or mixed snapshot on mismatch, duplicate, stale source or cancelled date',async()=>{
  const one={...summary,methods:[summary.methods[0]]}
  await assert.rejects(buildDayConferenceCsv({summary:one,request:async()=>({entries:[entry('1',1000)],nextPage:null})}),/reconcilia/)
  await assert.rejects(buildDayConferenceCsv({summary:one,request:async()=>({entries:[entry('1',400),entry('1',400)],nextPage:null})}),/inválido/)
  await assert.rejects(buildDayConferenceCsv({summary,request:async()=>{throw new Error('Os lançamentos mudaram')}}),/mudaram/)
  const controller=new AbortController();controller.abort()
  let requests=0
  await assert.rejects(buildDayConferenceCsv({summary,signal:controller.signal,request:async()=>{requests++}}),{name:'AbortError'})
  assert.equal(requests,0)
})
