import test from 'node:test'
import assert from 'node:assert/strict'
import { buildMonthlyWorkload, projectMonthlyBudget, assertMonthlyBudget, BUDGET_LIMITS } from './realtime-budget-report.mjs'
const dimensions=['rowsRead','rowsWritten','workerRequests','workerCpuMs','durableRequests','durableDurationGbS','durableRowsRead','durableRowsWritten','d1StorageGb','durableStorageGb','r2StorageGb','r2ClassA','r2ClassB','logs']
const baseline=()=>Object.fromEntries(dimensions.map(key=>[key,0]))
const workload={devices:2,tvDevices:0,printerDevices:1,controlDevices:0,hoursPerDay:1,days:1,changesPerDay:100,connections:2}
const sample=()=>{
  const counts=buildMonthlyWorkload(workload),names=new Set([...Object.keys(counts.normal),...Object.keys(counts.degraded)])
  return {workload,operations:Object.fromEntries([...names].map(name=>[name,{rowsRead:10,rowsWritten:2,durableRequests:name.startsWith('renew') || name.startsWith('prepare')?1:0}])),stageMetrics:{workerCpuMsByOperation:Object.fromEntries([...names].map(name=>[name,1])),durableDurationGbSPerRequest:0.001,d1StorageGrowthGb:0.01,durableStorageGb:0.001},accountBaseline:baseline()}
}
test('projection counts authenticated renewals, printing execution, heartbeat, recovery and fallback',()=>{
  const counts=buildMonthlyWorkload(workload)
  assert.equal(counts.normal.renewHuman,120)
  assert.equal(counts.normal.printClaim,1800)
  assert.equal(counts.normal.printHeartbeat,240)
  assert.equal(counts.normal.bootstrap,48)
  assert.equal(counts.degraded.bootstrap,244)
  assert.ok(counts.normal.printState>840)
  const report=projectMonthlyBudget(sample())
  assert.equal(report.normal.workerRequests,Object.values(counts.normal).reduce((a,b)=>a+b,0))
  assert.equal(report.normal.rowsRead,report.normal.workerRequests*10)
  assert.equal(assertMonthlyBudget(report),true)
})
test('unknown billing dimensions and account baseline cannot be claimed free',()=>{
  const input=sample();delete input.stageMetrics.workerCpuMsByOperation.bootstrap;input.accountBaseline.workerCpuMs=null
  const report=projectMonthlyBudget(input)
  assert.equal(report.passed,false);assert.ok(report.unknownDimensions.some(key=>key.includes('workerCpuMs')))
  assert.throws(()=>assertMonthlyBudget(report),/unknown|desconhecid/)
})
test('normal requires twenty percent margin and degraded cannot exceed any included quota',()=>{
  const report=projectMonthlyBudget(sample())
  report.normal.rowsRead=BUDGET_LIMITS.rowsRead*0.8+1
  assert.throws(()=>assertMonthlyBudget(report),/rowsRead/)
  report.normal.rowsRead=0;report.degraded.workerRequests=BUDGET_LIMITS.workerRequests+1
  assert.throws(()=>assertMonthlyBudget(report),/workerRequests/)
})
test('incoming ACK billing ratio is counted separately from outgoing notifications',()=>{
  const report=projectMonthlyBudget(sample())
  assert.equal(report.normal.incomingAckMessages,200)
  const rpc=Object.entries(report.counts.normal).reduce((sum,[name,count])=>sum+count*report.operations[name].durableRequests,0)
  assert.equal(report.normal.durableRequests,rpc+10)
  assert.equal(report.normal.durableRowsRead>=report.normal.durableRequests,true)
})


test('modeled workload remains visible when account usage is unknown and includes ACK logs',()=>{
  const input=sample();input.accountBaseline={}
  const report=projectMonthlyBudget(input)
  assert.equal(report.normal.rowsRead,null)
  assert.equal(report.normal.modeled.rowsRead,report.normal.workerRequests===null?Object.values(report.counts.normal).reduce((a,b)=>a+b,0)*10:report.normal.workerRequests*10)
  const rpc=Object.entries(report.counts.normal).reduce((sum,[name,count])=>sum+count*report.operations[name].durableRequests,0)
  assert.equal(report.normal.modeled.logs,report.normal.modeled.workerRequests*2+(rpc+report.normal.incomingAckMessages)*2)
  assert.equal(report.passed,false)
})

test('scoped workload includes every mounted surface owner, action preparation and explicit user history queries',()=>{
 const counts=buildMonthlyWorkload({devices:5,tvDevices:1,days:1,hoursPerDay:1,connections:5,changesPerDay:100,surfaceMix:{orders:1,clients:1,receivables:1,finance:1}})
 for(const name of ['kitchenSummary','customersPage','customerRelationship','receivablesGroups','receivablesGroupOrders','receivablesQuick','financeMovements','receivablesRefunds','historyPage','historySearch','customerDuplicates'])assert.ok(counts.normal[name]>0,name)
 assert.ok(counts.degraded.customersPage>counts.normal.customersPage)
 assert.ok(counts.degraded.byIds>0,'Explicit user actions still prepare canonical IDs without a socket')
 assert.throws(()=>buildMonthlyWorkload({devices:5,tvDevices:1,surfaceMix:{orders:5}}),/surface|mix/i)
})

test('query invalidations follow operational topics while every printing transition remains billed',async()=>{
 const {EFFECT_CATALOG}=await import('../../worker/realtime/effectCatalog.js')
 for(const [action,effect] of Object.entries(EFFECT_CATALOG))if(action.startsWith('printing.'))assert.equal(effect.topics.includes('orders')||effect.topics.includes('finance'),false,action)
 const counts=buildMonthlyWorkload({devices:2,tvDevices:0,days:1,hoursPerDay:1,changesPerDay:100,connections:2,administrativeChangesPerDay:0,surfaceMix:{clients:2}})
 assert.equal(counts.normal.customerRelationship,24+4+60)
 assert.equal(counts.normal.printMutation,70)
})


test('manager state is counted once per refresh while a mounted queue keeps its own reads',()=>{
 const counts=buildMonthlyWorkload({...workload,surfaceMix:{orders:2}})
 assert.ok(counts.normal.printState>840)
 assert.equal(counts.normal.printStations,2)
 assert.equal(counts.normal.printJobs,0)
 assert.equal(counts.normal.printSummary,0)
 const queue=buildMonthlyWorkload({...workload,surfaceMix:{orders:1,'print-queue':1}})
 assert.ok(queue.normal.printJobs>0)
 assert.ok(queue.normal.printSummary>0)
 assert.equal(queue.normal.printState,counts.normal.printState)
})


test('printing state includes its timer, independent realtime reconciliation and initial channel reconciliation',()=>{
 const counts=buildMonthlyWorkload({...workload,surfaceMix:{orders:2}})
 assert.equal(counts.normal.printState,1068)
 assert.equal(counts.degraded.printState,1084)
})


test('mounted read owners include mount and initial channel reconciliation independently',()=>{
 const counts=buildMonthlyWorkload({...workload,surfaceMix:{orders:1,'print-queue':1}})
 assert.equal(counts.normal.printJobs,114)
 assert.equal(counts.degraded.printSummary,122)
 assert.equal(counts.normal.kitchenSummary,64)
})


test('session discovery and sign-in are billed without treating TV reconnects as human logins',()=>{
 const counts=buildMonthlyWorkload({devices:5,tvDevices:1,connections:10,days:1,hoursPerDay:1,changesPerDay:100,administrativeChangesPerDay:3})
 for(const mode of ['normal','degraded']){
  assert.equal(counts[mode].authLogin,8)
  assert.equal(counts[mode].authSession,28)
 }
 const input=sample();delete input.operations.authSession
 const report=projectMonthlyBudget(input)
 assert.equal(report.passed,false)
 assert.equal(report.normal.modeled.rowsRead,null)
})
