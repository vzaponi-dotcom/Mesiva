import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
// Paid included allocations verified against primary Cloudflare docs, 14/10/2026.
export const BUDGET_LIMITS=Object.freeze({rowsRead:25e9,rowsWritten:50e6,workerRequests:10e6,workerCpuMs:30e6,durableRequests:1e6,durableDurationGbS:400_000,durableRowsRead:25e9,durableRowsWritten:50e6,d1StorageGb:5,durableStorageGb:5,r2StorageGb:10,r2ClassA:1e6,r2ClassB:10e6,logs:20e6})
const finite=value=>typeof value==='number' && Number.isFinite(value) && value>=0
export function buildMonthlyWorkload(input={}) {
  const w={devices:5,tvDevices:1,printerDevices:1,controlDevices:1,hoursPerDay:12,days:31,changesPerDay:5000,connections:5000,...input}
  for(const [key,value] of Object.entries(w))assert.ok(finite(value),`Invalid workload ${key}`)
  assert.ok(Number.isInteger(w.devices) && w.devices>0 && w.tvDevices<w.devices && w.printerDevices<=w.devices-w.tvDevices && w.controlDevices<=w.devices-w.tvDevices,'Invalid device mix')
  const humans=w.devices-w.tvDevices,seconds=w.hoursPerDay*3600*w.days,changes=w.changesPerDay*w.days
  const humanConnections=Math.ceil(w.connections*humans/w.devices),tvConnections=w.connections-humanConnections
  // Explicit workload: 10% order creates, 10% finalizations, 10% payments,
  // 70% printing transitions. These are sizing assumptions, not observed sales.
  const shared={orderCreate:changes*.1,orderFinalize:changes*.1,payment:changes*.1,printMutation:changes*.7,
    printHeartbeat:seconds*w.printerDevices/15,printClaim:seconds*w.printerDevices/2,
    tvReport:seconds*w.tvDevices/5,tvReportChanged:changes*w.tvDevices,
    controlState:seconds*w.controlDevices/5,stationUpsert:humanConnections}
  const manager=seconds*(w.printerDevices/5+(humans-w.printerDevices)/30)
  const normalManager=manager+changes*.8*humans+humanConnections
  const degradedManager=manager+humanConnections
  return {workload:w,
    normal:{...shared,prepareHuman:humanConnections,upgradeHuman:humanConnections,renewHuman:seconds*humans/60,
      prepareTv:tvConnections,upgradeTv:tvConnections,renewTv:seconds*w.tvDevices/60,
      bootstrap:Math.ceil(seconds*humans/300)+humanConnections+changes*.1*humans,
      byIds:changes*.2*humans,tvState:Math.ceil(seconds*w.tvDevices/300)+tvConnections+changes*w.tvDevices,
      printStations:normalManager+humanConnections,printJobs:normalManager,printSummary:normalManager},
    degraded:{...shared,prepareHuman:humanConnections,upgradeHuman:0,renewHuman:0,prepareTv:tvConnections,upgradeTv:0,renewTv:0,
      bootstrap:Math.ceil(seconds*humans/30)+humanConnections,byIds:0,tvState:Math.ceil(seconds*w.tvDevices/30)+tvConnections,
      printStations:degradedManager+humanConnections,printJobs:degradedManager,printSummary:degradedManager},
  }
}
export function projectMonthlyBudget({operations,workload,stageMetrics={},accountBaseline={}}) {
  const counts=buildMonthlyWorkload(workload),unknownDimensions=[]
  function scenario(label){
    const result=Object.fromEntries(Object.keys(BUDGET_LIMITS).map(key=>[key,0]))
    const unknown=key=>{result[key]=null;unknownDimensions.push(`${label}.${key}`)}
    let rpc=0
    for(const [name,count] of Object.entries(counts[label])){
      if(!count)continue
      const op=operations[name]
      for(const [dimension,source] of [['rowsRead','rowsRead'],['rowsWritten','rowsWritten'],['durableRequests','durableRequests']]){
        if(!finite(op?.[source]))unknown(dimension)
        else if(result[dimension]!==null)result[dimension]+=count*op[source]
      }
      const cpu=stageMetrics.workerCpuMsByOperation?.[name]
      if(!finite(cpu))unknown('workerCpuMs');else if(result.workerCpuMs!==null)result.workerCpuMs+=count*cpu
      result.workerRequests+=count
    }
    rpc=result.durableRequests
    // Outbound messages are unbilled; validated client receipt ACKs are incoming.
    result.incomingAckMessages=label==='normal'?counts.workload.changesPerDay*counts.workload.days*(1+counts.workload.tvDevices)*counts.workload.devices:0
    if(rpc!==null){
      result.durableRequests+=result.incomingAckMessages/20
      // Conservative hidden SQLite KV/index bounds, not measured storage billing.
      result.durableRowsRead=rpc*64+result.incomingAckMessages
      result.durableRowsWritten=rpc*64+result.incomingAckMessages
      if(finite(stageMetrics.durableDurationGbSPerRequest))result.durableDurationGbS=(rpc+result.incomingAckMessages)*stageMetrics.durableDurationGbSPerRequest
      else unknown('durableDurationGbS')
    }else {unknown('durableRowsRead');unknown('durableRowsWritten');unknown('durableDurationGbS')}
    if(finite(stageMetrics.d1StorageGrowthGb))result.d1StorageGb=stageMetrics.d1StorageGrowthGb;else unknown('d1StorageGb')
    if(finite(stageMetrics.durableStorageGb))result.durableStorageGb=stageMetrics.durableStorageGb;else unknown('durableStorageGb')
    result.logs=result.workerRequests*2+((rpc ?? 0)+result.incomingAckMessages)*2
    result.modeled={...result}
    for(const key of Object.keys(BUDGET_LIMITS)){
      if(!finite(accountBaseline[key]))unknown(key)
      else if(result[key]!==null)result[key]+=accountBaseline[key]
    }
    return result
  }
  const report={workload:counts.workload,operations,counts,normal:scenario('normal'),degraded:scenario('degraded'),unknownDimensions:[...new Set(unknownDimensions)],assumptions:[
    'Projeção de regime estável; excedente já acumulado no ciclo não é estornado.',
    'Cinco dispositivos totais incluem uma TV, uma estação principal e uma tela de controle no padrão; composição é configurável.',
    '12h/dia,31dias,5000mudanças/dia:10%criação,10%finalização,10%pagamento,70%transições impressão; não é volume observado.',
    'Inclui auth/guards medidos em HTTP,claim2s,heartbeat15s,aging5s/30s,presençaTV5s,controle5s,renovação60s e ACK20:1.',
    'TV pode mudar projeção a cada alteração (limite conservador); heartbeat idêntico não publica.',
    'DO storage usa limite conservador64linhas porRPC e1porACK; confirmar com métricas SQLite antes de ampliar volume.',
    'CPU/duração de workerd local não são faturamento Cloudflare; métricas externas e baseline da conta são obrigatórias.',
    'Outros serviços da conta e armazenamento atual entram pelo baseline; ausência nunca equivale a zero.',
  ],passed:false}
  try{assertMonthlyBudget(report);report.passed=true}catch{ /* Retain all measured/unknown dimensions for review. */ }
  return report
}
export function assertMonthlyBudget(report){
  assert.ok(Array.isArray(report.unknownDimensions) && report.unknownDimensions.length===0,'Billing/account dimensions unknown (desconhecidas)')
  for(const label of ['normal','degraded'])for(const [key,limit] of Object.entries(BUDGET_LIMITS)){
    assert.ok(finite(report[label]?.[key]),`${label}.${key} unknown`)
    assert.ok(report[label][key]<=limit*(label==='normal'?.8:1),`${label}.${key} exceeds included budget`)
  }
  return true
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const input=JSON.parse(readFileSync(process.argv[2],'utf8')),report=projectMonthlyBudget(input)
  const output=process.argv.slice(3).find(arg=>!arg.startsWith('--'))
  if(output)writeFileSync(output,JSON.stringify(report,null,2)+'\n')
  else console.log(JSON.stringify(report,null,2))
  if(process.argv.includes('--require-complete'))assertMonthlyBudget(report)
}
