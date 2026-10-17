import assert from 'node:assert/strict'
import test from 'node:test'
let protocol = {}
try { protocol = await import('./realtimeProtocol.js') } catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error }
const parse = input => { assert.equal(typeof protocol.parseRealtimeMessage, 'function', 'missing parseRealtimeMessage'); return protocol.parseRealtimeMessage(input) }
const message = {version:1,type:'invalidate',revision:'9007199254740993',topics:['orders'],orderIds:['order-A']}

test('protocol preserves decimal revisions beyond Number precision', () => {
  assert.deepEqual(parse(JSON.stringify(message)), message)
  assert.equal(parse({...message,revision:9007199254740992}), null)
  assert.equal(parse({...message,revision:'1e3'}), null)
})
test('protocol rejects payloads, foreign topics, invalid IDs and oversized envelopes', () => {
  for (const invalid of [null,[], 'broken', {...message,customer:'private'}, {...message,topics:['foreign']}, {...message,orderIds:['']}, {...message,orderIds:Array.from({length:100},(_,i)=>`order-${i}`)}, {...message,orderIds:Array(2).fill('duplicate')}, {...message,orderIds:['á'.repeat(10000)]}]) assert.equal(parse(invalid), null)
})
test('ready requires a connection identity and a valid lease without entity data', () => {
  const ready = {...message,type:'ready',orderIds:[],connectionId:'connection-A',expiresAt:'2026-10-14T18:01:15.000Z'}
  assert.deepEqual(parse(ready), ready)
  assert.equal(parse({...ready,expiresAt:'invalid'}), null)
  assert.equal(parse({...ready,connectionId:''}), null)
  assert.equal(parse({...ready,orderIds:['order-A']}), null)
})
test('resync and access changes cannot carry entity IDs', () => {
  for (const type of ['resync_required','access_changed']) {
    assert.deepEqual(parse({...message,type,orderIds:[]}), {...message,type,orderIds:[]})
    assert.equal(parse({...message,type}), null)
  }
})
