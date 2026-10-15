import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {spawnSync} from 'node:child_process'

test('configured Worker entry exports only runtime handlers, never configuration constants',()=>{
  const config=JSON.parse(readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8'))
  const entryUrl=new URL(`../${config.main}`,import.meta.url).href
  // Node cannot load Workers built-ins. Stub only the base class in an isolated
  // process for this export contract; the workerd gate tests the actual runtime.
  const script=`import {registerHooks} from 'node:module';
    import assert from 'node:assert/strict';
    registerHooks({resolve(specifier,context,nextResolve){
      if(specifier==='cloudflare:workers')return {url:'data:text/javascript,export class DurableObject {}',shortCircuit:true};
      return nextResolve(specifier,context);
    }});
    const entry=await import(${JSON.stringify(entryUrl)});
    for(const [name,value] of Object.entries(entry))assert.ok(typeof value==='function' || value && typeof value.fetch==='function','Unsupported Worker export: '+name);
    assert.equal(typeof entry.BusinessRealtimeHub,'function');`
  const result=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8'})
  assert.equal(result.status,0,result.stderr || result.stdout)
})
