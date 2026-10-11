import test from 'node:test'
import assert from 'node:assert/strict'

import {
  formatKitchenDisplayItemName,
  getKitchenCardContentMetrics,
  normalizeKitchenItemNote,
  packKitchenDisplaySlots,
  positionKitchenDisplayGrid,
  resolveKitchenBoardCandidates,
  resolveKitchenBoardProfile,
  resolveKitchenViewportProfile,
} from './kitchenDisplayContentLayout.js'

const item = (name, note = '', size = '') => ({ quantity: 1, name, note, size })

test('three short items stay comfortable and require one visual slot', () => {
  const metrics = getKitchenCardContentMetrics([
    item('Arroz'),
    item('Feijão'),
    item('Batata frita'),
  ])

  assert.equal(metrics.density, 'comfortable')
  assert.equal(metrics.layoutDemand, 'normal')
  assert.equal(metrics.itemCount, 3)
  assert.ok(metrics.visualLines < 5)
})

test('five medium items become compact without requesting a tall card', () => {
  const metrics = getKitchenCardContentMetrics([
    item('Marmita de frango'),
    item('Marmita de carne'),
    item('Tilápia à milanesa'),
    item('Virado à paulista'),
    item('Omelete com queijo'),
  ])

  assert.equal(metrics.density, 'compact')
  assert.equal(metrics.layoutDemand, 'normal')
  assert.equal(metrics.itemCount, 5)
})

test('eight short items stay normal by using two columns when one column would not fit', () => {
  const metrics = getKitchenCardContentMetrics(
    Array.from({ length: 8 }, (_, index) => item(`Produto ${index + 1}`)),
    { viewportHeight: 720 },
  )

  assert.equal(metrics.density, 'dense')
  assert.equal(metrics.layoutDemand, 'normal')
  assert.equal(metrics.columnCount, 2)
  assert.equal(metrics.fitStrategy, 'normal-two-columns')
  assert.equal(metrics.itemCount, 8)
})

test('a request grows only after two columns no longer fit, then prefers one column while tall', () => {
  const metrics = getKitchenCardContentMetrics([
    item('[TESTE] Combo Individual Família Especial'),
    item('[TESTE] Sanduíche de Frango Especial Família'),
    item('[TESTE] Porção de Arroz Temperado Grande'),
    item('[TESTE] Calabresa Acebolada Especial Grande'),
    item('[TESTE] Marmita Frango Completa Família'),
    item('[TESTE] Mandioca Frita Crocante Grande'),
    item('[TESTE] Prato Executivo Completo Família'),
    item('[TESTE] Filé de Frango Grelhado Especial'),
  ], { viewportHeight: 720 })

  assert.equal(metrics.density, 'dense')
  assert.equal(metrics.layoutDemand, 'tall')
  assert.equal(metrics.columnCount, 1)
  assert.equal(metrics.fitStrategy, 'tall-one-column')
  assert.ok(metrics.visualLines >= 15)
  assert.ok(metrics.twoColumnVisualLines > metrics.normalLineCapacity)
  assert.ok(metrics.visualLines <= metrics.tallLineCapacity)
})

test('an extreme tall request returns to two columns only when one tall column is insufficient', () => {
  const metrics = getKitchenCardContentMetrics(
    Array.from({ length: 12 }, (_, index) => item(
      `Produto Família Especial Muito Completo ${index + 1}`,
      index % 2 === 0 ? 'Observação longa de produção em embalagem separada' : '',
    )),
    { viewportHeight: 720 },
  )

  assert.equal(metrics.layoutDemand, 'tall')
  assert.equal(metrics.columnCount, 2)
  assert.equal(metrics.fitStrategy, 'tall-two-columns')
  assert.ok(metrics.visualLines > metrics.tallLineCapacity)
})

test('shared item formatting normalizes whitespace and does not duplicate an existing size suffix', () => {
  assert.equal(formatKitchenDisplayItemName(item('  Marmita  ', '', ' G ')), 'Marmita G')
  assert.equal(formatKitchenDisplayItemName(item('Pizza Grande', '', 'Grande')), 'Pizza Grande')
  assert.equal(normalizeKitchenItemNote(item('X', '  sem   cebola  ')), 'sem cebola')
})


const normalEntry = (id) => ({
  order: {
    id,
    items: [item('Arroz'), item('Feijão')],
  },
})

const tallEntry = (id) => ({
  order: {
    id,
    items: Array.from({ length: 8 }, (_, index) => item(`Produto ${id}-${index + 1} Família Especial Completo`)),
  },
})

test('six normal cards consume the six visual slots without changing priority order', () => {
  const entries = Array.from({ length: 6 }, (_, index) => normalEntry(`n-${index + 1}`))
  const result = packKitchenDisplaySlots(entries)

  assert.equal(result.usedSlots, 6)
  assert.equal(result.remainingSlots, 0)
  assert.equal(result.overflow, 0)
  assert.deepEqual(result.cards.map((entry) => entry.order.id), entries.map((entry) => entry.order.id))
  assert.deepEqual(result.cards.map((entry) => entry.slotCost), [1, 1, 1, 1, 1, 1])
})

test('one tall card plus four normal cards fills six slots with five visible orders', () => {
  const entries = [tallEntry('t-1'), ...Array.from({ length: 5 }, (_, index) => normalEntry(`n-${index + 1}`))]
  const result = packKitchenDisplaySlots(entries)

  assert.equal(result.usedSlots, 6)
  assert.equal(result.cards.length, 5)
  assert.equal(result.overflow, 1)
  assert.deepEqual(result.cards.map((entry) => entry.order.id), ['t-1', 'n-1', 'n-2', 'n-3', 'n-4'])
  assert.deepEqual(result.cards.map((entry) => entry.slotCost), [2, 1, 1, 1, 1])
})

test('two tall cards plus two normal cards fill the board with four visible orders', () => {
  const entries = [
    tallEntry('t-1'),
    normalEntry('n-1'),
    tallEntry('t-2'),
    normalEntry('n-2'),
    normalEntry('n-3'),
  ]
  const result = packKitchenDisplaySlots(entries)

  assert.equal(result.usedSlots, 6)
  assert.equal(result.cards.length, 4)
  assert.equal(result.overflow, 1)
  assert.deepEqual(result.cards.map((entry) => entry.order.id), ['t-1', 'n-1', 't-2', 'n-2'])
})

test('three tall cards consume all six visual slots', () => {
  const entries = [tallEntry('t-1'), tallEntry('t-2'), tallEntry('t-3'), normalEntry('n-1')]
  const result = packKitchenDisplaySlots(entries)

  assert.equal(result.usedSlots, 6)
  assert.equal(result.cards.length, 3)
  assert.equal(result.overflow, 1)
  assert.deepEqual(result.cards.map((entry) => entry.order.id), ['t-1', 't-2', 't-3'])
  assert.deepEqual(result.cards.map((entry) => entry.layoutDemand), ['tall', 'tall', 'tall'])
})

test('packing never skips a higher-priority tall card to promote a lower-priority normal card', () => {
  const entries = [
    normalEntry('p-1'),
    normalEntry('p-2'),
    normalEntry('p-3'),
    normalEntry('p-4'),
    normalEntry('p-5'),
    tallEntry('p-6'),
    normalEntry('p-7'),
  ]
  const result = packKitchenDisplaySlots(entries)

  assert.equal(result.usedSlots, 5)
  assert.equal(result.remainingSlots, 1)
  assert.equal(result.overflow, 2)
  assert.deepEqual(result.cards.map((entry) => entry.order.id), ['p-1', 'p-2', 'p-3', 'p-4', 'p-5'])
  assert.equal(result.cards.some((entry) => entry.order.id === 'p-7'), false)
})

test('packing accepts a custom slot ceiling without changing the source array', () => {
  const entries = [tallEntry('t-1'), normalEntry('n-1'), normalEntry('n-2')]
  const snapshot = JSON.stringify(entries)
  const result = packKitchenDisplaySlots(entries, { maxSlots: 3 })

  assert.equal(result.usedSlots, 3)
  assert.equal(result.cards.length, 2)
  assert.equal(result.overflow, 1)
  assert.equal(JSON.stringify(entries), snapshot)
})


test('viewport profiles distinguish spacious, standard and constrained heights', () => {
  assert.equal(resolveKitchenViewportProfile(1080), 'spacious')
  assert.equal(resolveKitchenViewportProfile(720), 'standard')
  assert.equal(resolveKitchenViewportProfile(600), 'constrained')
  assert.equal(resolveKitchenViewportProfile(undefined), 'standard')
})

test('the same eight-line order adapts columns before consuming a second visual slot', () => {
  const items = Array.from({ length: 8 }, (_, index) => item(`Produto ${index + 1}`))
  const spacious = getKitchenCardContentMetrics(items, { viewportHeight: 1080 })
  const standard = getKitchenCardContentMetrics(items, { viewportHeight: 720 })

  assert.equal(spacious.density, 'dense')
  assert.equal(spacious.layoutDemand, 'normal')
  assert.equal(spacious.columnCount, 1)
  assert.equal(spacious.fitStrategy, 'normal-one-column')
  assert.equal(spacious.viewportProfile, 'spacious')
  assert.equal(standard.layoutDemand, 'normal')
  assert.equal(standard.columnCount, 2)
  assert.equal(standard.fitStrategy, 'normal-two-columns')
  assert.equal(standard.viewportProfile, 'standard')
})

test('constrained height still tries normal two-column fit before promoting to tall', () => {
  const items = Array.from({ length: 7 }, (_, index) => item(`Marmita Família Especial Completa ${index + 1}`))
  const spacious = getKitchenCardContentMetrics(items, { viewportHeight: 1080 })
  const constrained = getKitchenCardContentMetrics(items, { viewportHeight: 600 })

  assert.equal(spacious.layoutDemand, 'normal')
  assert.equal(spacious.columnCount, 2)
  assert.equal(constrained.layoutDemand, 'tall')
  assert.equal(constrained.columnCount, 1)
  assert.equal(constrained.fitStrategy, 'tall-one-column')
})

test('slot packing keeps six cards when two columns are enough and drops to five only when tall is necessary', () => {
  const adaptable = {
    order: {
      id: 'adaptive',
      items: Array.from({ length: 8 }, (_, index) => item(`Produto ${index + 1}`)),
    },
  }
  const trulyTall = {
    order: {
      id: 'tall',
      items: Array.from({ length: 8 }, (_, index) => item(`Produto Família Especial Completo ${index + 1}`)),
    },
  }
  const normals = Array.from({ length: 5 }, (_, index) => normalEntry(`n-${index + 1}`))

  const standardNormal = packKitchenDisplaySlots([adaptable, ...normals], { maxSlots: 6, viewportHeight: 720 })
  const standardTall = packKitchenDisplaySlots([trulyTall, ...normals], { maxSlots: 6, viewportHeight: 720 })

  assert.equal(standardNormal.cards.length, 6)
  assert.equal(standardNormal.cards[0].layoutDemand, 'normal')
  assert.equal(standardNormal.cards[0].contentMetrics.columnCount, 2)
  assert.equal(standardTall.cards.length, 5)
  assert.equal(standardTall.cards[0].layoutDemand, 'tall')
  assert.equal(standardTall.cards[0].contentMetrics.columnCount, 1)
})


test('board profile keeps small queues spacious and expands density only when useful', () => {
  assert.deepEqual(resolveKitchenBoardProfile({ viewportWidth: 1920, viewportHeight: 1080, queueSize: 4 }), {
    id: 'focus', columns: 3, rows: 2, gridRows: 6, maxSlots: 18,
  })
  assert.deepEqual(resolveKitchenBoardProfile({ viewportWidth: 1920, viewportHeight: 1080, queueSize: 8 }), {
    id: 'roomy', columns: 3, rows: 3, gridRows: 18, maxSlots: 54,
  })
  assert.deepEqual(resolveKitchenBoardProfile({ viewportWidth: 1920, viewportHeight: 1080, queueSize: 10 }), {
    id: 'compact', columns: 4, rows: 3, gridRows: 24, maxSlots: 96,
  })
})

test('board profile allows compact density on the approved large viewport reference', () => {
  assert.equal(resolveKitchenBoardProfile({ viewportWidth: 1640, viewportHeight: 924, queueSize: 10 }).id, 'compact')
})

test('board profile can use compact density on 1366x768 when the queue needs it', () => {
  const profile = resolveKitchenBoardProfile({ viewportWidth: 1366, viewportHeight: 768, queueSize: 10 })
  assert.equal(profile.id, 'compact')
  assert.equal(profile.columns, 4)
  assert.equal(profile.rows, 3)
  assert.equal(profile.gridRows, 24)
  assert.equal(profile.maxSlots, 96)
})

test('board profile uses a safe fallback when viewport dimensions are unavailable', () => {
  assert.deepEqual(resolveKitchenBoardProfile({ queueSize: 10 }), {
    id: 'focus', columns: 3, rows: 2, gridRows: 6, maxSlots: 18,
  })
})


test('compact profile keeps short orders at one row and promotes complex content before shrinking it', () => {
  const profile = resolveKitchenBoardProfile({ viewportWidth: 1640, viewportHeight: 924, queueSize: 10 })
  const short = getKitchenCardContentMetrics([
    item('Marmita executiva'),
    item('Suco'),
  ], { viewportHeight: 924, boardProfile: profile })
  const medium = getKitchenCardContentMetrics(
    Array.from({ length: 7 }, (_, index) => item(`Marmita Família Especial Completa ${index + 1}`)),
    { viewportHeight: 924, boardProfile: profile },
  )
  const extreme = getKitchenCardContentMetrics(
    Array.from({ length: 12 }, (_, index) => item(
      `Produto Família Especial Muito Completo ${index + 1}`,
      index % 2 === 0 ? 'Observação longa para produção e embalagem separada' : '',
    )),
    { viewportHeight: 924, boardProfile: profile },
  )

  assert.equal(short.boardProfile, 'compact')
  assert.equal(short.rowSpan, 1)
  assert.equal(short.layoutDemand, 'normal')
  assert.equal(medium.rowSpan >= 2, true)
  assert.equal(extreme.rowSpan, 3)
  assert.equal(extreme.layoutDemand, 'full')
})

test('compact packing fits twelve short cards with the safer four-track minimum', () => {
  const profile = resolveKitchenBoardProfile({ viewportWidth: 1920, viewportHeight: 1080, queueSize: 12 })
  const entries = Array.from({ length: 12 }, (_, index) => normalEntry(`compact-${index + 1}`))
  const packed = packKitchenDisplaySlots(entries, { boardProfile: profile, viewportHeight: 1080 })
  const positioned = positionKitchenDisplayGrid(packed.cards, { boardProfile: profile })

  assert.equal(packed.cards.length, 12)
  assert.equal(packed.usedSlots, 48)
  assert.equal(packed.overflow, 0)
  assert.equal(positioned.length, 12)
  assert.equal(new Set(positioned.map((card) => `${card.gridPosition.gridColumn}:${card.gridPosition.gridRow}`)).size, 12)
  for (const card of positioned) {
    assert.ok(card.gridPosition.gridColumn >= 1 && card.gridPosition.gridColumn <= 4)
    const row = Number(String(card.gridPosition.gridRow).split(' ')[0])
    assert.ok(row >= 1 && row <= 24)
  }
})

test('compact packing reserves granular tracks for complex cards without exceeding the twenty-four-row matrix', () => {
  const profile = resolveKitchenBoardProfile({ viewportWidth: 1920, viewportHeight: 1080, queueSize: 10 })
  const entries = [
    {
      order: {
        id: 'complex',
        items: Array.from({ length: 8 }, (_, index) => item(`Produto família completo ${index + 1}`)),
      },
    },
    ...Array.from({ length: 8 }, (_, index) => normalEntry(`small-${index + 1}`)),
  ]
  const packed = packKitchenDisplaySlots(entries, { boardProfile: profile, viewportHeight: 1080 })
  const positioned = positionKitchenDisplayGrid(packed.cards, { boardProfile: profile })

  assert.equal(positioned[0].gridSpan >= 6, true)
  assert.equal(positioned.every((card) => {
    const row = Number(String(card.gridPosition.gridRow).split(' ')[0])
    return row + card.gridPosition.rowSpan - 1 <= 24
  }), true)
})


test('explicit compact positioning spreads nine short cards across all four columns before starting the third row', () => {
  const profile = resolveKitchenBoardCandidates({ viewportWidth: 1640, viewportHeight: 924 })
    .find(({ id }) => id === 'compact')
  const entries = Array.from({ length: 9 }, (_, index) => normalEntry(`spread-${index + 1}`))
  const packed = packKitchenDisplaySlots(entries, { boardProfile: profile, viewportHeight: 924 })
  const positioned = positionKitchenDisplayGrid(packed.cards, { boardProfile: profile })

  const positions = positioned.map((card) => ({
    column: card.gridPosition.gridColumn,
    row: Number(String(card.gridPosition.gridRow).split(' ')[0]),
  }))

  assert.deepEqual(positions.slice(0, 4), [
    { column: 1, row: 1 },
    { column: 2, row: 1 },
    { column: 3, row: 1 },
    { column: 4, row: 1 },
  ])
  assert.deepEqual(positions.slice(4, 8), [
    { column: 1, row: 5 },
    { column: 2, row: 5 },
    { column: 3, row: 5 },
    { column: 4, row: 5 },
  ])
  assert.deepEqual(positions[8], { column: 1, row: 9 })
})


test('queue-size fallback keeps focus through six and uses roomy before four-column density', () => {
  assert.equal(resolveKitchenBoardProfile({ viewportWidth: 1640, viewportHeight: 924, queueSize: 4 }).id, 'focus')
  assert.equal(resolveKitchenBoardProfile({ viewportWidth: 1640, viewportHeight: 924, queueSize: 6 }).id, 'focus')
  assert.equal(resolveKitchenBoardProfile({ viewportWidth: 1640, viewportHeight: 924, queueSize: 7 }).id, 'roomy')
  assert.equal(resolveKitchenBoardProfile({ viewportWidth: 1640, viewportHeight: 924, queueSize: 9 }).id, 'roomy')
})

test('compact one-line cards use a two-track micro height while notes and wrapped names keep more room', () => {
  const profile = resolveKitchenBoardProfile({ viewportWidth: 1640, viewportHeight: 924, queueSize: 12 })
  const short = getKitchenCardContentMetrics([
    item('Marmita executiva'),
  ], { viewportHeight: 924, boardProfile: profile })
  const withNote = getKitchenCardContentMetrics([
    item('Marmita executiva', 'Sem cebola'),
  ], { viewportHeight: 924, boardProfile: profile })
  const wrappedName = getKitchenCardContentMetrics([
    item('Marmita executiva completa família especial'),
  ], { viewportHeight: 924, boardProfile: profile })
  const medium = getKitchenCardContentMetrics([
    item('Marmita executiva'),
    item('Refrigerante'),
    item('Sobremesa'),
    item('Batata frita'),
  ], { viewportHeight: 924, boardProfile: profile })

  assert.equal(profile.id, 'compact')
  assert.equal(profile.gridRows, 24)
  assert.equal(profile.maxSlots, 96)
  assert.equal(short.gridSpan, 4)
  assert.equal(withNote.gridSpan, 5)
  assert.equal(wrappedName.gridSpan, 5)
  assert.equal(medium.gridSpan >= 3, true)
  assert.equal(medium.gridSpan, 4)
})

test('compact micro-grid can show sixteen truly short orders with reclaimed vertical room', () => {
  const profile = resolveKitchenBoardProfile({ viewportWidth: 1920, viewportHeight: 1080, queueSize: 16 })
  const entries = Array.from({ length: 16 }, (_, index) => ({
    order: {
      id: `micro-${index + 1}`,
      items: [item('Marmita')],
    },
  }))
  const packed = packKitchenDisplaySlots(entries, { boardProfile: profile, viewportHeight: 1080 })
  const positioned = positionKitchenDisplayGrid(packed.cards, { boardProfile: profile })

  assert.equal(packed.cards.length, 16)
  assert.equal(packed.usedSlots, 64)
  assert.equal(packed.overflow, 0)
  assert.equal(positioned.every((card) => card.gridPosition.rowSpan === 4), true)
  assert.equal(Math.max(...positioned.map((card) => Number(String(card.gridPosition.gridRow).split(' ')[0]))), 13)
})

test('compact masonry preserves source priority order when placing mixed card heights', () => {
  const profile = resolveKitchenBoardProfile({ viewportWidth: 1640, viewportHeight: 924, queueSize: 10 })
  const entries = [
    normalEntry('p-1'),
    {
      order: {
        id: 'p-2',
        items: Array.from({ length: 8 }, (_, index) => item(`Pedido grande ${index + 1}`)),
      },
    },
    normalEntry('p-3'),
    normalEntry('p-4'),
    normalEntry('p-5'),
  ]
  const packed = packKitchenDisplaySlots(entries, { boardProfile: profile, viewportHeight: 924 })
  const positioned = positionKitchenDisplayGrid(packed.cards, { boardProfile: profile })

  assert.deepEqual(positioned.map((card) => card.order.id), ['p-1', 'p-2', 'p-3', 'p-4', 'p-5'])
  assert.equal(positioned[0].gridPosition.gridColumn, 1)
  assert.equal(positioned[1].gridPosition.gridColumn, 2)
})


test('compact one-line nano cards reclaim structure without reducing text', () => {
  const profile = resolveKitchenBoardProfile({ viewportWidth: 1640, viewportHeight: 924, queueSize: 12 })
  const nano = getKitchenCardContentMetrics([
    item('Marmita'),
  ], { viewportHeight: 924, boardProfile: profile })
  const twoItems = getKitchenCardContentMetrics([
    item('Marmita'),
    item('Suco'),
  ], { viewportHeight: 924, boardProfile: profile })
  const noted = getKitchenCardContentMetrics([
    item('Marmita', 'Sem cebola'),
  ], { viewportHeight: 924, boardProfile: profile })

  assert.equal(profile.gridRows, 24)
  assert.equal(nano.gridSpan, 4)
  assert.equal(twoItems.gridSpan, 4)
  assert.equal(noted.gridSpan, 5)
})


test('compact layout prefers two item columns earlier when that saves vertical tracks', () => {
  const profile = resolveKitchenBoardProfile({ viewportWidth: 1640, viewportHeight: 924, queueSize: 16 })
  const fourShortItems = getKitchenCardContentMetrics([
    item('Arroz'),
    item('Feijão'),
    item('Batata'),
    item('Carne'),
  ], { viewportHeight: 924, boardProfile: profile })

  assert.equal(profile.gridRows, 24)
  assert.equal(fourShortItems.columnCount, 2)
  assert.equal(fourShortItems.fitStrategy, 'normal-two-columns')
  assert.equal(fourShortItems.gridSpan, 4)
})

test('compact height follows effective visual lines instead of coarse normal/tall buckets', () => {
  const profile = resolveKitchenBoardProfile({ viewportWidth: 1640, viewportHeight: 924, queueSize: 16 })
  const simple = getKitchenCardContentMetrics([item('Marmita')], { viewportHeight: 924, boardProfile: profile })
  const noted = getKitchenCardContentMetrics([item('Marmita', 'Sem cebola')], { viewportHeight: 924, boardProfile: profile })
  const four = getKitchenCardContentMetrics([
    item('Arroz'),
    item('Feijão'),
    item('Batata'),
    item('Carne'),
  ], { viewportHeight: 924, boardProfile: profile })
  const large = getKitchenCardContentMetrics(
    Array.from({ length: 8 }, (_, index) => item(
      `Produto família ${index + 1}`,
      index % 2 === 0 ? 'Observação de produção' : '',
    )),
    { viewportHeight: 924, boardProfile: profile },
  )

  assert.equal(simple.gridSpan, 4)
  assert.equal(noted.gridSpan, 5)
  assert.equal(four.gridSpan, 4)
  assert.equal(large.gridSpan > four.gridSpan, true)
  assert.equal(large.gridSpan < 12, true)
})


test('nano metrics expose an explicit nano flag only for one-line no-note compact orders', () => {
  const profile = resolveKitchenBoardProfile({ viewportWidth: 1640, viewportHeight: 924, queueSize: 12 })
  const nano = getKitchenCardContentMetrics([item('Marmita')], { viewportHeight: 924, boardProfile: profile })
  const noted = getKitchenCardContentMetrics([item('Marmita', 'Sem cebola')], { viewportHeight: 924, boardProfile: profile })
  const wrapped = getKitchenCardContentMetrics([item('Marmita executiva completa família especial')], { viewportHeight: 924, boardProfile: profile })

  assert.equal(nano.isNano, true)
  assert.equal(nano.gridSpan, 4)
  assert.equal(noted.isNano, false)
  assert.equal(noted.gridSpan, 5)
  assert.equal(wrapped.isNano, false)
  assert.equal(wrapped.gridSpan, 5)
})


test('board candidates expose progressively denser layouts without using queue size as the only decision', () => {
  assert.deepEqual(
    resolveKitchenBoardCandidates({ viewportWidth: 1920, viewportHeight: 1080 }).map(({ id, columns }) => [id, columns]),
    [['focus', 3], ['roomy', 3], ['balanced', 4], ['compact', 4]],
  )
  assert.deepEqual(
    resolveKitchenBoardCandidates({ viewportWidth: 1366, viewportHeight: 768 }).map(({ id, columns }) => [id, columns]),
    [['focus', 3], ['roomy', 3], ['balanced', 4], ['compact', 4]],
  )
  assert.deepEqual(
    resolveKitchenBoardCandidates({}).map(({ id, columns }) => [id, columns]),
    [['focus', 3]],
  )
})

test('roomy keeps three columns with a granular vertical grid for seven-to-nine short orders', () => {
  const roomy = resolveKitchenBoardCandidates({ viewportWidth: 1920, viewportHeight: 1080 })
    .find(({ id }) => id === 'roomy')

  assert.deepEqual(roomy, {
    id: 'roomy', columns: 3, rows: 3, gridRows: 18, maxSlots: 54,
  })

  const short = getKitchenCardContentMetrics([
    item('Marmita'),
  ], { viewportHeight: 1080, boardProfile: roomy })
  assert.equal(short.gridSpan, 6)
  assert.equal(short.boardProfile, 'roomy')
})

test('compact card minimum keeps a real-TV safety margin for chrome and one item line', () => {
  const compact = resolveKitchenBoardCandidates({ viewportWidth: 1920, viewportHeight: 1080 })
    .find(({ id }) => id === 'compact')

  const simple = getKitchenCardContentMetrics([
    item('Marmita'),
  ], { viewportHeight: 1080, boardProfile: compact })
  const noted = getKitchenCardContentMetrics([
    item('Marmita', 'Sem cebola'),
  ], { viewportHeight: 1080, boardProfile: compact })
  const twoItems = getKitchenCardContentMetrics([
    item('Marmita'),
    item('Suco'),
  ], { viewportHeight: 1080, boardProfile: compact })

  assert.equal(simple.gridSpan, 4)
  assert.equal(noted.gridSpan >= 5, true)
  assert.equal(twoItems.gridSpan >= 4, true)
})


test('legacy TV viewport still exposes four-column best-fit candidates', () => {
  assert.deepEqual(
    resolveKitchenBoardCandidates({ viewportWidth: 960, viewportHeight: 540 }).map(({ id, columns }) => [id, columns]),
    [['focus', 3], ['roomy', 3], ['balanced', 4], ['compact', 4]],
  )
})

test('very small viewport still degrades conservatively', () => {
  assert.deepEqual(
    resolveKitchenBoardCandidates({ viewportWidth: 640, viewportHeight: 360 }).map(({ id, columns }) => [id, columns]),
    [['focus', 3]],
  )
})


test('legacy compact cards reserve extra tracks for real TV text rasterization', () => {
  const compact = resolveKitchenBoardCandidates({ viewportWidth: 960, viewportHeight: 540 })
    .find(({ id }) => id === 'compact')

  const simple = getKitchenCardContentMetrics([
    item('Marmita'),
  ], { viewportWidth: 960, viewportHeight: 540, boardProfile: compact })
  const noted = getKitchenCardContentMetrics([
    item('Marmita', 'Sem cebola'),
  ], { viewportWidth: 960, viewportHeight: 540, boardProfile: compact })
  const medium = getKitchenCardContentMetrics([
    item('Combo Duplo Un'),
    item('Combo Família Un'),
    item('Refrigerante Cola 2L'),
    item('X-Bacon Un'),
  ], { viewportWidth: 960, viewportHeight: 540, boardProfile: compact })

  assert.equal(simple.viewportProfile, 'constrained')
  assert.equal(simple.gridSpan >= 6, true)
  assert.equal(noted.gridSpan >= 8, true)
  assert.equal(medium.columnCount, 1)
  assert.equal(medium.gridSpan >= 10, true)
})

test('legacy compact width estimates more wrapping than desktop compact width', () => {
  const compact = resolveKitchenBoardCandidates({ viewportWidth: 1920, viewportHeight: 1080 })
    .find(({ id }) => id === 'compact')
  const items = [
    item('Refrigerante Guaraná 350ml 350 ml'),
    item('Combo Família Individual Un'),
    item('Marmita Frango Completa Família'),
    item('X-Salada Especial Un'),
  ]

  const desktop = getKitchenCardContentMetrics(items, {
    viewportWidth: 1920,
    viewportHeight: 1080,
    boardProfile: compact,
  })
  const legacy = getKitchenCardContentMetrics(items, {
    viewportWidth: 960,
    viewportHeight: 540,
    boardProfile: compact,
  })

  assert.equal(desktop.columnCount, 2)
  assert.equal(legacy.columnCount, 1)
  assert.equal(legacy.gridSpan > desktop.gridSpan, true)
})


test('board-profile packing skips one oversized blocked card and still fills later safe capacity', () => {
  const profile = resolveKitchenBoardCandidates({ viewportWidth: 1920, viewportHeight: 1080 })
    .find(({ id }) => id === 'focus')
  const entries = [
    normalEntry('p-1'),
    normalEntry('p-2'),
    normalEntry('p-3'),
    normalEntry('p-4'),
    normalEntry('p-5'),
    {
      order: {
        id: 'p-6',
        items: Array.from({ length: 24 }, (_, index) => item(
          `Produto muito grande família especial completo ${index + 1}`,
        )),
      },
    },
    normalEntry('p-7'),
  ]

  const result = packKitchenDisplaySlots(entries, {
    boardProfile: profile,
    viewportWidth: 1920,
    viewportHeight: 1080,
  })

  assert.deepEqual(result.cards.map((entry) => entry.order.id), [
    'p-1', 'p-2', 'p-3', 'p-4', 'p-5', 'p-7',
  ])
  assert.equal(result.cards.some((entry) => entry.order.id === 'p-6'), false)
  assert.equal(result.usedSlots, 18)
  assert.equal(result.remainingSlots, 0)
  assert.equal(result.overflow, 1)
})

test('edited orders use exactly the same original item-only card layout as ordinary orders', () => {
  const profile = resolveKitchenBoardCandidates({ viewportWidth: 1280, viewportHeight: 720 })
    .find(({ id, columns }) => id === 'focus' && columns === 2)
  const items = [
    item('[TESTE] Prato Executivo Un'),
    item('[TESTE] Prato feito comercial Família'),
    item('[TESTE] Marmita Churrasco M'),
    item('[TESTE] Sanduíche de Frango'),
  ]
  const editSummary = { items: [
    { kind: 'removed', before: { name: '[TESTE] Marmita Frango P', quantity: 1 }, after: null },
    { kind: 'modified', before: { name: 'Marmita Churrasco', quantity: 1, note: '' }, after: { name: 'Marmita Churrasco', quantity: 1, note: 'Sem churras' } },
    { kind: 'added', before: null, after: { name: 'Sanduíche de Frango', quantity: 1 } },
  ] }
  const options = { viewportWidth: 1280, viewportHeight: 720, boardProfile: profile }
  const ordinary = getKitchenCardContentMetrics(items, options)
  const edited = getKitchenCardContentMetrics(items, { ...options, editSummary })
  assert.deepEqual(edited, ordinary, 'revision history must not resize TV cards')

  const packed = packKitchenDisplaySlots([
    { order: { id: 'normal', items } },
    { order: { id: 'edited', items, operationalRevision: 2, editSummary } },
  ], options)
  assert.deepEqual(packed.cards.map(card => card.contentMetrics), [ordinary, ordinary])
})
