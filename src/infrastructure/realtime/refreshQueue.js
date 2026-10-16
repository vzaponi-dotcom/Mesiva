// Presentation reads only. The mutation/executor owner is never called by a hint.
export function createRefreshQueue({run,isCurrent=()=>true,onError=()=>{}}) {
  let active=true,dirty=false,pending=null
  const refresh=()=>{
    if(!active || !isCurrent())return Promise.resolve()
    dirty=true
    pending ??= Promise.resolve().then(async()=>{
      while(active && dirty && isCurrent()){
        dirty=false
        try {await run()}catch(error){if(active && isCurrent())onError(error)}
      }
    }).finally(()=>{pending=null;if(active && dirty && isCurrent())void refresh()})
    return pending
  }
  return {refresh,stop(){active=false;dirty=false}}
}
