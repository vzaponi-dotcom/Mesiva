import test from 'node:test'
import assert from 'node:assert/strict'
import { createRefreshQueue } from './refreshQueue.js'
test('refresh queue coalesces a burst and retains a notification arriving during a read',async()=>{
  let reads=0,resolve
  const queue=createRefreshQueue({run:()=>++reads===1?new Promise(r=>resolve=r):Promise.resolve()})
  const first=queue.refresh();queue.refresh();queue.refresh();await Promise.resolve()
  assert.equal(reads,1)
  queue.refresh();resolve();await first
  assert.equal(reads,2)
})
test('stopping refresh queue prevents queued follow-up work after the read settles',async()=>{
  let reads=0,resolve
  const queue=createRefreshQueue({run:()=>{reads++;return new Promise(r=>resolve=r)}})
  const pending=queue.refresh();await Promise.resolve();queue.refresh();queue.stop();resolve();await pending
  assert.equal(reads,1)
  await queue.refresh();assert.equal(reads,1)
})
