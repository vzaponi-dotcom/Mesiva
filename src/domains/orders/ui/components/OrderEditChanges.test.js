import test from 'node:test'
import assert from 'node:assert/strict'
import { workspaceHarness, nodeText } from '../../../../test-support/renderWorkspace.js'

test('edited order history differentiates quantity, note, added and removed lines', async t => {
  const h = await workspaceHarness(t)
  const {default:OrderEditChanges} = await h.load('/src/domains/orders/ui/components/OrderEditChanges.jsx')
  const screen = await h.render(OrderEditChanges,{changes:[
    {kind:'updated',before:{name:'Café',quantity:2,note:'Com açúcar'},after:{name:'Café',quantity:3,note:'Sem açúcar'}},
    {kind:'added',before:null,after:{name:'Suco',quantity:1,note:''}},
    {kind:'removed',before:{name:'Torta',quantity:2,note:'Quente'},after:null},
  ]})
  const summary = nodeText(screen.root)
  for (const value of ['Últimas alterações','3 alterações','Café','Suco','Torta','Adicionado','Removido','Alterado','Com açúcar','Sem açúcar']) assert.ok(summary.includes(value),value)
  assert.equal(screen.root.findAll(n=>n.props?.className?.includes?.('order-edit-change-row')).length,3)
  assert.equal(screen.root.findAll(n=>n.type==='details').length,1)
  await screen.unmount?.()
})

test('quantity-only change shows before and after without inventing a note change', async t => {
  const h = await workspaceHarness(t)
  const {default:OrderEditChanges} = await h.load('/src/domains/orders/ui/components/OrderEditChanges.jsx')
  const screen = await h.render(OrderEditChanges,{changes:[
    {kind:'updated',before:{name:'Hambúrguer',quantity:1,note:'Sem cebola'},after:{name:'Hambúrguer',quantity:4,note:'Sem cebola'}},
  ]})
  const content = nodeText(screen.root)
  assert.match(content,/Quantidade/)
  assert.match(content,/Sem cebola|Hambúrguer/)
  assert.doesNotMatch(content,/Observação alterada/)
  await screen.unmount?.()
})
