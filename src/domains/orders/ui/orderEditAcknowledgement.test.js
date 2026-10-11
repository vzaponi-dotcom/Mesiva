import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')

test('kitchen displays an edited badge instead of human acknowledgement', () => {
  const kitchen = read('./Orders.jsx')
  const ticket = read('./components/KitchenTicket.jsx')
  assert.doesNotMatch(kitchen,/confirmOrderEditRead|Confirmar leitura|locallyAcknowledgedEdits/)
  assert.match(ticket,/Number\(order\.operationalRevision\) > 0/)
  assert.match(ticket,/OrderEditedBadge/)
})
test('TV control no longer requires confirmation or permission to see edit information',()=>{
  const control=read('../../../app/surfaces/kitchen-tv-control/KitchenTvControlSurface.jsx')
  assert.doesNotMatch(control,/acknowledgeEdit|Confirmar leitura|acknowledgingEditId/)
  assert.match(control,/selectedEntry\?\.order/)
  assert.match(control,/Number\(entry\.order\.operationalRevision\) > 0/)
})
test('previously acknowledged edits remain visible as history',()=>{
  const tv=read('../../../kitchen-display/KitchenDisplayCard.jsx')
  assert.match(tv,/const edited = Number\(order\.operationalRevision\) > 0/)
  assert.match(tv,/edited && <OrderEditedBadge/)
  assert.doesNotMatch(tv,/editItems|kds-card__edit-details|Alterações:/)
})
