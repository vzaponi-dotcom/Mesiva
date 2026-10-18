// Staging-only preflight for Task 11; read-only and compatible with both sides
// of migration 0052. No receipt IDs, customer data or credentials in logs.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const STAGING_DATABASE='amor-e-sabor-delivery-staging'
const KNOWN=new Set([
  'empty','canonical','consensus_legacy','legacy_no_movement',
  'BLOCKED_conflicting_movements','BLOCKED_invalid_movement_date',
  'BLOCKED_movement_amount_mismatch','BLOCKED_receipt_movement_mismatch',
  'BLOCKED_invalid_paid_at',
  'BLOCKED_invalid_received_date',
])
const DAY="'[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'"

export function buildReceiptAuditSql(hasReceivedDate) {
  const checks=hasReceivedDate ? [
    "WHEN r.received_date IS NOT NULL AND (r.received_date NOT GLOB "+DAY+" OR date(r.received_date,'+0 days') IS NULL OR date(r.received_date,'+0 days')<>r.received_date) THEN 'BLOCKED_invalid_received_date'",
    "WHEN r.received_date IS NOT NULL AND m.movement_count > 0 AND m.min_day <> r.received_date THEN 'BLOCKED_receipt_movement_mismatch'",
    "WHEN r.received_date IS NOT NULL THEN 'canonical'",
  ] : []
  return [
    'WITH movement_audit AS (',
    'SELECT business_id,receipt_id,COUNT(*) movement_count,',
    'MIN(movement_date) min_day,MAX(movement_date) max_day,SUM(value_cents) movement_cents',
    "FROM movements WHERE deleted_at IS NULL AND source='order-payment' AND type='entrada' AND receipt_id IS NOT NULL",
    'GROUP BY business_id,receipt_id',
    '), receipt_audit AS ( SELECT CASE',
    "WHEN m.movement_count > 0 AND (m.min_day IS NULL OR m.min_day<>m.max_day) THEN 'BLOCKED_conflicting_movements'",
    "WHEN m.movement_count > 0 AND (m.min_day NOT GLOB "+DAY+" OR date(m.min_day,'+0 days') IS NULL OR date(m.min_day,'+0 days')<>m.min_day) THEN 'BLOCKED_invalid_movement_date'",
    "WHEN m.movement_count > 0 AND m.movement_cents<>r.total_cents THEN 'BLOCKED_movement_amount_mismatch'",
    ...checks,
    // Period readers compare UTC timestamps lexically; other valid formats need
    // operator review too, rather than silently selecting the wrong business day.
    "WHEN r.paid_at IS NULL OR strftime('%Y-%m-%dT%H:%M:%fZ',r.paid_at) IS NOT r.paid_at OR SUBSTR(r.paid_at,12,2) NOT BETWEEN '00' AND '23' OR date(SUBSTR(r.paid_at,1,10),'+0 days')<>SUBSTR(r.paid_at,1,10) THEN 'BLOCKED_invalid_paid_at'",
    "WHEN m.movement_count IS NULL THEN 'legacy_no_movement'",
    "ELSE 'consensus_legacy' END classification",
    'FROM payment_receipts r LEFT JOIN movement_audit m',
    'ON m.business_id=r.business_id AND m.receipt_id=r.id',
    ') SELECT classification,COUNT(*) receipts FROM receipt_audit GROUP BY classification',
    "UNION ALL SELECT 'empty',0 WHERE NOT EXISTS (SELECT 1 FROM payment_receipts)",
    'ORDER BY classification',
  ].join('\n')
}

export async function auditEffectiveReceipts({query,log=console.log}) {
  assert.equal(typeof query,'function')
  const schema=await query('PRAGMA table_info(payment_receipts)')
  if(!Array.isArray(schema) || !['id','business_id','paid_at'].every(column=>
    schema.some(row=>row?.name===column)))
    throw new Error('Task 11 audit: payment_receipts schema missing or unreadable.')
  const hasReceivedDate=schema.some(row=>row.name==='received_date')
  const rows=await query(buildReceiptAuditSql(hasReceivedDate))
  if(!Array.isArray(rows)||rows.length===0)
    throw new Error('Task 11 audit: missing or invalid aggregate rows.')
  const distribution=Object.fromEntries([...KNOWN].map(key=>[key,0]))
  for(const row of rows){
    const type=row?.classification,count=Number(row?.receipts)
    if(!KNOWN.has(type))throw new Error('Task 11 audit: unknown classification.')
    if(!Number.isSafeInteger(count)||count<0)throw new Error('Task 11 audit: invalid receipt count.')
    if(type==='empty' && count!==0)throw new Error('Task 11 audit: invalid empty set.')
    distribution[type]+=count
  }
  const blocked=Object.entries(distribution).filter(([type,count])=>type.startsWith('BLOCKED_')&&count>0)
  const receipts=Object.values(distribution).reduce((sum,n)=>sum+n,0)
  const needsManualReview=distribution.consensus_legacy+distribution.legacy_no_movement
  log('Task 11 staging read-only audit: schema '+(hasReceivedDate?'post-0052':'pre-0052')
    +'; receipts '+receipts+'; canonical '+distribution.canonical
    +'; consensus '+distribution.consensus_legacy+'; legacy_no_movement '
    +distribution.legacy_no_movement+'; blockers '+blocked.reduce((sum,[,n])=>sum+n,0)+'.')
  if(blocked.length)
    throw new Error('Task 11 audit BLOCKED: conflicting/invalid receipts. Resolve before remote staging writes.')
  return {hasReceivedDate,receipts,needsManualReview,distribution}
}

// SQL and database are static and constrained to the staging D1 binding.
export function queryStagingD1(sql){
  if(typeof sql!=='string'||(!sql.startsWith('PRAGMA table_info(')&&
    !sql.startsWith('WITH movement_audit AS (')))
    throw new Error('Task 11 preflight permits only approved read queries.')
  const output=execFileSync('npx',[
    '--yes','wrangler@4.128.0','d1','execute',STAGING_DATABASE,
    '--remote','--env','staging','--yes','--json','--command',sql,
  ],{encoding:'utf8',timeout:90_000,maxBuffer:4*1024*1024,stdio:['ignore','pipe','pipe']})
  let parsed
  try{parsed=JSON.parse(output)}catch{throw new Error('Invalid D1 JSON response; staging blocked.')}
  const statement=Array.isArray(parsed)?parsed[0]:parsed
  if(!statement||statement.success===false||!Array.isArray(statement.results))
    throw new Error('D1 read failed or incomplete; staging blocked.')
  return statement.results
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    await auditEffectiveReceipts({query:queryStagingD1})
  }catch(error){
    // Never expose raw D1 response, auth headers, or customer information.
    console.error('Task 11 staging preflight blocked: '+error.message)
    process.exitCode=1
  }
}
