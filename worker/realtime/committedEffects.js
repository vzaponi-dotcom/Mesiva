// Statements carry trusted repository metadata; never infer effects from SQL text.
const effects=new WeakMap(),originals=new WeakMap()
export function registerCommittedEffect(statement,effect) {
  for(let current=statement;current;current=originals.get(current)) effects.set(current,effect)
  return statement
}
export function linkCommittedStatement(facade,statement) {
  originals.set(facade,statement)
  if(effects.has(statement)) effects.set(facade,effects.get(statement))
  return facade
}
export function inheritCommittedEffect(source,target) {
  if(effects.has(source)) registerCommittedEffect(target,effects.get(source))
  return target
}

export function withCommittedEffects(db,{onCommitted}) {
  const raw=new WeakMap()
  function confirmed(statements,results) {
    const groups=new Map()
    try {
      statements.forEach((statement,index)=>{
        const result=results[index],marker=effects.get(statement)
        if(!marker || !(Number(result?.meta?.changes)>0)) return
        const resolved=typeof marker==='function'?marker(result):marker
        for(const effect of Array.isArray(resolved)?resolved:[resolved]) {
          if(!effect?.businessId) continue
          let group=groups.get(effect.businessId)
          if(!group){group={businessId:effect.businessId,topics:new Set(),orderIds:new Set(),invalidations:new Map(),full:false};groups.set(effect.businessId,group)}
          for(const topic of effect.topics || []) group.topics.add(topic)
          if(effect.topics?.includes('orders') && !effect.orderIds?.length) group.full=true
          for(const id of effect.orderIds || []) group.orderIds.add(id)
          for(const target of effect.invalidations || []) group.invalidations.set(`${target.scope}:${target.id}`,target)
        }
      })
      for(const group of groups.values()) {
        const event={businessId:group.businessId,topics:[...group.topics],orderIds:group.full?[]:[...group.orderIds],invalidations:[...group.invalidations.values()]}
        // Delivery is advisory: callback failures must never change a committed result.
        try { Promise.resolve(onCommitted(event)).catch(()=>{}) } catch { /* lease/reconciliation bound delivery loss */ }
      }
    } catch { /* A metadata failure cannot turn a successful transaction into a retry. */ }
  }
  const wrap=statement=>{
    const facade={
      bind:(...values)=>inheritCommittedEffect(facade,wrap(statement.bind(...values))),
      async run(){const result=await statement.run();confirmed([facade],[result]);return result},
      async all(){const result=await statement.all();confirmed([facade],[result]);return result},
      async first(column){
        if(!effects.has(facade))return statement.first(column)
        const result=await facade.all(),row=result.results?.[0]
        return row?(column===undefined?row:row[column]):null
      },
    }
    raw.set(facade,statement)
    return linkCommittedStatement(facade,statement)
  }
  return {prepare:sql=>wrap(db.prepare(sql)),async batch(statements){
    const results=await db.batch(statements.map(statement=>raw.get(statement)||statement))
    confirmed(statements,results);return results
  },...(db.auditContext?{auditContext:db.auditContext}:{})}
}

export function publishCommittedEffect(env,businessId,effect,executionContext) {
  if(![true,'true'].includes(env.REALTIME_ENABLED) || !env.BUSINESS_REALTIME) return
  const pending=Promise.resolve().then(async()=>{
    const hub=env.BUSINESS_REALTIME.get(env.BUSINESS_REALTIME.idFromName(`business:${businessId}`))
    // Revoke first so an obsolete connection cannot receive IDs from this effect.
    for(const target of effect.invalidations || []) await hub.invalidate(target)
    if(effect.topics?.length)await hub.publish({topics:effect.topics,orderIds:effect.orderIds || []})
  }).catch(()=>{console.warn('REALTIME_PUBLICATION_UNAVAILABLE')})
  if(executionContext?.waitUntil)executionContext.waitUntil(pending)
  return pending
}
