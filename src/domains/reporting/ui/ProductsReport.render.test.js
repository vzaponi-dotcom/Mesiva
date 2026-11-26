import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { act } from 'react-test-renderer'
import { workspaceHarness, nodeText } from '../../../test-support/renderWorkspace.js'

test('products render dashboard analytics, rankings and drill-down from API data', async (t) => {
  const harness = await workspaceHarness(t)
  const { ProductsReport } = await harness.load('/src/domains/reporting/ui/views/ProductsReport.jsx')
  const drilled = []
  const item = { id: 'p1', name: 'X-Bacon', size: 'Grande', category: 'Lanches', quantity: 3, revenueCents: 4500, sharePercent: 100, growthPercent: 50 }
  const renderer = await harness.render(ProductsReport, { state: {
    data: { unitsSold: 3, mealsSold: 0, merchandiseRevenueCents: 4500, ranking: [item], top10: [item], categories: [{ category: 'Lanches', quantity: 3, revenueCents: 4500 }], presentations: [{ productId: 'p1', name: 'X-Bacon', size: 'Grande', quantity: 3, revenueCents: 4500 }] },
    loading: false,
  }, onDrilldown: (id) => drilled.push(id) })

  const text = nodeText(renderer.root)
  for (const label of [
    'Unidades vendidas',
    'Receita de mercadoria',
    'Produtos no período',
    'Categorias',
    'Refeições vendidas',
    'Ticket por item',
    'Top produto',
    'Participação do Top 10',
    'Top 10 produtos',
    'Receita por categoria',
    'Mix por categoria',
    'Produtos que mais cresceram',
    'Apresentações / tamanhos',
    'Destaques do período',
    'Ranking completo',
  ]) assert.match(text, new RegExp(label))

  assert.match(text, /R\$\s*45,00/)
  assert.match(text, /100%/)
  renderer.root.findAllByType('button').find((button) => nodeText(button).startsWith('X-Bacon')).props.onClick()
  assert.deepEqual(drilled, ['p1'])
})

test('consults one product and keeps the selection when the new period has no sales for it', async (t) => {
  const harness = await workspaceHarness(t)
  const { ProductsReport } = await harness.load('/src/domains/reporting/ui/views/ProductsReport.jsx')
  const juice = { id: 'juice', productId: 'juice', name: 'Suco de laranja', size: '300 ml', category: 'Bebidas', quantity: 3, revenueCents: 2500 }
  const water = { id: 'water', name: 'Água', category: 'Bebidas', quantity: 8, revenueCents: 3200 }
  const state = { data: {
    unitsSold: 11, merchandiseRevenueCents: 5700, ranking: [water, juice], top10: [water, juice],
    presentations: [
      { productId: 'juice', name: juice.name, size: '300 ml', quantity: 2, revenueCents: 1500 },
      { productId: 'juice', name: juice.name, size: '500 ml', quantity: 1, revenueCents: 1000 },
      { productId: 'water', name: water.name, size: '1 L', quantity: 8, revenueCents: 3200 },
    ],
  } }
  const renderer = await harness.render(ProductsReport, { state })
  const choose = async (name) => {
    await act(async () => renderer.root.findByProps({ role: 'combobox', 'aria-label': 'Produto' }).props.onClick())
    const option = renderer.root.findAllByProps({ role: 'option' }).find((node) => nodeText(node).startsWith(name))
    await act(async () => option.props.onClick())
  }
  const totals = () => renderer.root.findByProps({ 'aria-label': 'Indicadores do produto' })
    .findAllByType('article').map((card) => nodeText(card.findByType('strong')))

  await choose('Suco de laranja')
  assert.equal(nodeText(renderer.root.findByProps({ role: 'combobox', 'aria-label': 'Produto' })), 'Suco de laranja · Bebidas')
  assert.deepEqual(totals(), ['3', 'R$\u00a025,00'])
  assert.match(nodeText(renderer.root), /300 ml.*500 ml/)
  assert.doesNotMatch(nodeText(renderer.root), /Água|Ranking completo/)

  const nextState = { data: { ...state.data, ranking: [water], top10: [water], presentations: [] } }
  await act(async () => renderer.update(React.createElement(ProductsReport, { state: nextState })))
  assert.deepEqual(totals(), ['0', 'R$\u00a00,00'])
  assert.match(nodeText(renderer.root), /Suco de laranja/)
  assert.doesNotMatch(nodeText(renderer.root), /300 ml|500 ml/)

  await choose('Todos os produtos')
  assert.match(nodeText(renderer.root), /Ranking completo/)
  assert.match(nodeText(renderer.root), /Água/)
})
