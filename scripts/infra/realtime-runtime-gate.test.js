import test from 'node:test'
import assert from 'node:assert/strict'
import {assertRealtimeRuntimeGate} from './realtime-runtime-gate.mjs'
// Validator unit tests. The workerd integration runs once in validate.yml after
// the pinned Wrangler dry-runs populate its dependency cache.
const valid=()=>({invariants:{legacyGlobalPolls:0,hibernationRecovered:true,restartConnectedClients:5,lostEventConvergedClients:5,convergenceVirtualMs:264000,publicationFailureMutationCount:1,unchangedHeartbeatNotifications:0,unknownClaimedAgain:false,concurrentClaimWinners:1},pointReadHistoryGrowth:0,scopedBootstrapHistoryGrowth:0,financialCandidateHistoryGrowth:0,historyPreserved:true,operations:{byIds:{rowsRead:388,rowsWritten:1,sqlStatements:10,durableRequests:0,auditRowsRead:2,orderRowsRead:14},...Object.fromEntries(['printState','printJobs','printStations','printSummary'].map(name=>[name,{rowsRead:10,rowsWritten:2,sqlStatements:5,durableRequests:0,auditRowsRead:0,orderRowsRead:0}]))}})
test('runtime validator accepts a complete functional gate report',()=>assert.equal(assertRealtimeRuntimeGate(valid()),true))
for(const [key,value] of Object.entries({legacyGlobalPolls:1,hibernationRecovered:false,restartConnectedClients:4,lostEventConvergedClients:4,convergenceVirtualMs:332000,publicationFailureMutationCount:2,unchangedHeartbeatNotifications:1,unknownClaimedAgain:true,concurrentClaimWinners:2}))test(`runtime validator rejects broken ${key}`,()=>{
  const report=valid();report.invariants[key]=value;assert.throws(()=>assertRealtimeRuntimeGate(report))
})
test('runtime validator rejects history growth, missing history and invalid metering',()=>{
  for(const change of [r=>r.pointReadHistoryGrowth=33,r=>r.historyPreserved=false,r=>r.operations.byIds.rowsRead=NaN,r=>delete r.operations.byIds.rowsWritten]){
    const report=valid();change(report);assert.throws(()=>assertRealtimeRuntimeGate(report))
  }
})

test('runtime validator rejects scoped bootstrap reads growing with unrelated history',()=>{
  const report=valid();report.scopedBootstrapHistoryGrowth=33
  assert.throws(()=>assertRealtimeRuntimeGate(report))
})

test('runtime validator rejects historical search repeatedly walking the same timeline prefix',()=>{
  const report=valid();report.fixture={historicalOrders:10000}
  report.operations.historySearch={...report.operations.byIds,rowsRead:535598}
  assert.throws(()=>assertRealtimeRuntimeGate(report))
})

test('runtime validator rejects fixed pending reads growing with paid historical orders',()=>{
  const report=valid();report.financialCandidateHistoryGrowth=65
  assert.throws(()=>assertRealtimeRuntimeGate(report))
})


test('runtime validator requires measured combined state without increasing read/write/SQL work',()=>{
 for(const change of [r=>delete r.operations.printState,r=>r.operations.printState.rowsRead=31,r=>r.operations.printState.rowsWritten=7,r=>r.operations.printState.sqlStatements=16]){
  const r=valid();change(r);assert.throws(()=>assertRealtimeRuntimeGate(r))
 }
})
