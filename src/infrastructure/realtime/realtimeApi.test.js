import assert from 'node:assert/strict'
import test from 'node:test'
import { createContextHttpClient } from '../api/contextHttpClient.js'
let module={}
try { module=await import('./realtimeApi.js') } catch(error) { if(error.code!=='ERR_MODULE_NOT_FOUND')throw error }

test('prepare and renew preserve canonical context, credentials and JSON requests',async()=>{
  assert.equal(typeof module.createRealtimeApi,'function','missing createRealtimeApi')
  const calls=[]
  const contextClient=createContextHttpClient({context:{contextId:'context-A'},fetchImpl:async(path,options)=>{calls.push({path,options});return Response.json({enabled:true})}})
  const api=module.createRealtimeApi(contextClient)
  await api.prepare();await api.renew('connection-A')
  assert.deepEqual(calls.map(call=>call.path),['/api/realtime/prepare','/api/realtime/renew'])
  assert.deepEqual(calls.map(call=>JSON.parse(call.options.body)),[{}, {connectionId:'connection-A'}])
  assert.ok(calls.every(call=>call.options.method==='POST' && call.options.credentials==='same-origin' && new Headers(call.options.headers).get('X-Mesiva-Context')==='context-A'))
})

test('TV adapter keeps legacy header and cookie transport on prepare and renew',async()=>{
  const tv=await import('../../kitchen-display/kitchenDisplayApi.js')
  assert.equal(typeof tv.createKitchenDisplayRealtimeApi,'function','missing TV realtime adapter')
  const calls=[],api=tv.createKitchenDisplayRealtimeApi('fictional-tv-token',async(path,options)=>{calls.push({path,options});return Response.json({enabled:true})})
  await api.prepare();await api.renew('connection-TV')
  assert.deepEqual(calls.map(call=>call.path),['/api/kitchen-tv/realtime/prepare','/api/kitchen-tv/realtime/renew'])
  assert.ok(calls.every(call=>call.options.credentials==='same-origin' && call.options.headers['x-kitchen-tv-session']==='fictional-tv-token'))
})
