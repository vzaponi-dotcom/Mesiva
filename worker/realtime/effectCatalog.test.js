import test from 'node:test'
import assert from 'node:assert/strict'
import { AUDIT_ACTIONS } from '../../shared/auditActions.js'
import { EFFECT_CATALOG, topicsForCommittedEvent } from './effectCatalog.js'

test('every current audit action has an explicit projection or exclusion',()=>{
  for(const action of AUDIT_ACTIONS) assert.ok(EFFECT_CATALOG[action],`Unclassified action: ${action}`)
  assert.deepEqual(topicsForCommittedEvent({action:'login.success'}),{topics:[],orderIds:[]})
  assert.deepEqual(topicsForCommittedEvent({action:'access.denied'}),{topics:[],orderIds:[]})
  assert.deepEqual(topicsForCommittedEvent({action:'future.unreviewed'}),{topics:[],orderIds:[]})
})
test('projection topics reflect official cross-domain effects and IDs are order-only',()=>{
  assert.deepEqual(topicsForCommittedEvent({action:'payment.received',resourceType:'order',resourceId:'o1'}),{topics:['orders','tables','reservations','finance','kitchen-tv'],orderIds:['o1']})
  assert.deepEqual(topicsForCommittedEvent({action:'printing.requested',resourceType:'print-job',resourceId:'j1'}),{topics:['printing'],orderIds:[]})
  assert.deepEqual(topicsForCommittedEvent({action:'kitchen-tv.page.updated',resourceType:'settings',resourceId:'page'}),{topics:['kitchen-tv'],orderIds:[]})
})

test('plain order changes do not force unrelated bootstrap collections',()=>{
  for(const action of ['order.created','order.finalized','order.payment-promise.updated','order.price.adjusted'])
    assert.deepEqual(topicsForCommittedEvent({action,resourceType:'order',resourceId:'o1'}),{topics:['orders','kitchen-tv'],orderIds:['o1']})
})
