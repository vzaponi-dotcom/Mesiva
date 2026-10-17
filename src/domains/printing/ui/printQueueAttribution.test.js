import test from 'node:test'
import assert from 'node:assert/strict'
import { getPrintJobDetails } from './printQueueDetails.js'

test('print attribution uses server actors and ignores an old label without evidence', () => {
  const details = getPrintJobDetails({ attribution: { requestedBy: { type: 'system', displayName: 'fake' }, lastActionBy: { type: 'user', displayName: 'Maria' } }, actionActorLabel: 'First manager' })
  assert.equal(details.requestedBy, 'Sistema'); assert.equal(details.audit.actor, 'Maria')
  const historical = getPrintJobDetails({ actionActorLabel: 'First manager' })
  assert.equal(historical.requestedBy, 'Autor não identificado'); assert.equal(historical.audit.actor, 'Autor não identificado')
  assert.equal(getPrintJobDetails(null).audit.actor, 'Autor não identificado')
})

test('historical job detail retains its snapshotted display number with no global order cache',()=>{
 assert.equal(getPrintJobDetails({type:'order',orderId:'old',document:{order:{id:'old',number:'42'}}}).title,'Pedido #42')
})
