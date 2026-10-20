import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { useTableServiceCommands } from './useTableServiceCommands.js'

const tabA = { id: 'tab-A', number: 41 }
const source = {
  id: 'table-1',
  name: 'Mesa 1',
  isActive: true,
  occupancy: 'occupied',
  sortOrder: 1,
  openTableTab: tabA,
}
const destination = {
  id: 'table-5',
  name: 'Mesa 5',
  isActive: true,
  occupancy: 'free',
  sortOrder: 2,
  openTableTab: null,
}
const officialTables = [source, destination]

const mountProbe = async (props) => {
  let latest
  let renderer
  function Probe(currentProps) {
    latest = useTableServiceCommands(currentProps)
    return null
  }
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(Probe, props))
  })
  return {
    getLatest: () => latest,
    unmount: () => renderer.unmount(),
  }
}

test('table management commands apply only backend-authoritative tables and preserve request keys/messages', async () => {
  const calls = []
  const commits = []
  const keys = []
  const successes = []
  const returnedTables = [{ ...destination, id: 'official', name: 'Nome oficial' }]
  const api = {
    createTable: async (...args) => { calls.push(['createTable', ...args]); return { tables: returnedTables } },
    updateTable: async (...args) => { calls.push(['updateTable', ...args]); return { tables: returnedTables } },
    reorderTables: async (...args) => { calls.push(['reorderTables', ...args]); return { tables: returnedTables } },
    transferTableTab: async () => assert.fail('transfer is not part of this management test'),
  }
  const probe = await mountProbe({
    api,
    getOfficialTables: () => officialTables,
    applyOfficialEffects: (effects) => commits.push(effects),
    refreshOfficialData: async () => {},
    writesBlocked: false,
    canManageTables: true,
    canTransfer: true,
    setRequestKey: (key) => keys.push(key),
    onSuccess: (message) => successes.push(message),
    onError: (error) => assert.fail(error?.message || 'unexpected error'),
    onStaleTarget: () => assert.fail('unexpected stale target'),
  })

  await act(async () => {
    assert.equal(await probe.getLatest().createTable('Varanda'), true)
    assert.equal(await probe.getLatest().renameTable('table-1', 'Mesa nova'), true)
    assert.equal(await probe.getLatest().setTableActive('table-1', false), true)
    assert.equal(await probe.getLatest().setTableActive('table-1', true), true)
    assert.equal(await probe.getLatest().reorderTables(['table-5', 'table-1']), true)
  })

  assert.deepEqual(calls, [
    ['createTable', { name: 'Varanda' }],
    ['updateTable', 'table-1', { name: 'Mesa nova' }],
    ['updateTable', 'table-1', { isActive: false }],
    ['updateTable', 'table-1', { isActive: true }],
    ['reorderTables', ['table-5', 'table-1']],
  ])
  assert.deepEqual(commits, Array.from({ length: 5 }, () => ({ tables: returnedTables })))
  assert.deepEqual(successes, [
    'Mesa adicionada com sucesso',
    'Mesa renomeada com sucesso',
    'Mesa desativada com sucesso',
    'Mesa ativada com sucesso',
  ])
  assert.deepEqual(keys, [
    'table:create', null,
    'table:rename:table-1', null,
    'table:active:table-1', null,
    'table:active:table-1', null,
    'table:reorder', null,
  ])
  probe.unmount()
})

test('write and capability guards block management and transfer before the API', async () => {
  let apiCalls = 0
  const api = {
    createTable: async () => { apiCalls += 1; return { tables: [] } },
    updateTable: async () => { apiCalls += 1; return { tables: [] } },
    reorderTables: async () => { apiCalls += 1; return { tables: [] } },
    transferTableTab: async () => { apiCalls += 1; return { tables: [], tableTab: tabA } },
  }
  const common = {
    api,
    getOfficialTables: () => officialTables,
    applyOfficialEffects: () => {},
    refreshOfficialData: async () => {},
    setRequestKey: () => {},
    onSuccess: () => {},
    onError: () => {},
    onStaleTarget: () => {},
  }

  const blocked = await mountProbe({ ...common, writesBlocked: true, canManageTables: true, canTransfer: true })
  await act(async () => {
    assert.equal(await blocked.getLatest().createTable('X'), false)
    assert.equal(await blocked.getLatest().renameTable('table-1', 'X'), false)
    assert.equal(await blocked.getLatest().setTableActive('table-1', false), false)
    assert.equal(await blocked.getLatest().reorderTables(['table-1']), false)
    assert.equal(await blocked.getLatest().transferTableTab('table-1', 'table-5', 'tab-A'), false)
  })
  blocked.unmount()

  const denied = await mountProbe({ ...common, writesBlocked: false, canManageTables: false, canTransfer: false })
  await act(async () => {
    assert.equal(await denied.getLatest().createTable('X'), false)
    assert.equal(await denied.getLatest().renameTable('table-1', 'X'), false)
    assert.equal(await denied.getLatest().setTableActive('table-1', false), false)
    assert.equal(await denied.getLatest().reorderTables(['table-1']), false)
    assert.equal(await denied.getLatest().transferTableTab('table-1', 'table-5', 'tab-A'), false)
  })
  denied.unmount()

  assert.equal(apiCalls, 0)
})

test('transfer captures exact identity and applies tables plus tableTab in one official effect', async () => {
  const calls = []
  const commits = []
  const keys = []
  const successes = []
  let refreshCalls = 0
  const returnedTables = [
    { ...source, occupancy: 'free', openTableTab: null },
    { ...destination, occupancy: 'occupied', openTableTab: tabA },
  ]
  const returnedTab = { id: 'tab-A', tableId: 'table-5', status: 'open' }
  const probe = await mountProbe({
    api: {
      createTable: async () => ({}),
      updateTable: async () => ({}),
      reorderTables: async () => ({}),
      transferTableTab: async (...args) => {
        calls.push(args)
        return { tables: returnedTables, tableTab: returnedTab }
      },
    },
    getOfficialTables: () => officialTables,
    applyOfficialEffects: (effects) => commits.push(effects),
    refreshOfficialData: async () => { refreshCalls += 1 },
    writesBlocked: false,
    canManageTables: true,
    canTransfer: true,
    setRequestKey: (key) => keys.push(key),
    onSuccess: (message) => successes.push(message),
    onError: (error) => assert.fail(error?.message || 'unexpected error'),
    onStaleTarget: () => assert.fail('unexpected stale target'),
  })

  await act(async () => {
    assert.equal(await probe.getLatest().transferTableTab('table-1', 'table-5', 'tab-A'), true)
  })

  assert.deepEqual(calls, [['table-1', 'table-5', 'tab-A']])
  assert.deepEqual(commits.at(-1), { tables: returnedTables, tableTab: returnedTab })
  assert.equal(refreshCalls, 0)
  assert.deepEqual(successes, ['Comanda transferida: Mesa 1 → Mesa 5'])
  assert.deepEqual(keys, ['table:transfer:table-1', null])
  probe.unmount()
})

test('stale transfer target refreshes official data without issuing a transfer request', async () => {
  let transferCalls = 0
  let refreshCalls = 0
  const staleMessages = []
  const probe = await mountProbe({
    api: {
      createTable: async () => ({}),
      updateTable: async () => ({}),
      reorderTables: async () => ({}),
      transferTableTab: async () => { transferCalls += 1; return {} },
    },
    getOfficialTables: () => [{ ...source, openTableTab: { id: 'tab-B' } }, destination],
    applyOfficialEffects: () => {},
    refreshOfficialData: async () => { refreshCalls += 1 },
    writesBlocked: false,
    canManageTables: true,
    canTransfer: true,
    setRequestKey: () => {},
    onSuccess: () => {},
    onError: () => {},
    onStaleTarget: (message) => staleMessages.push(message),
  })

  await act(async () => {
    assert.equal(await probe.getLatest().transferTableTab('table-1', 'table-5', 'tab-A'), false)
    await Promise.resolve()
  })

  assert.equal(transferCalls, 0)
  assert.equal(refreshCalls, 1)
  assert.deepEqual(staleMessages, ['A comanda ou a mesa de destino mudou. Atualizamos a consulta.'])
  probe.unmount()
})

test('transfer 409 refreshes exactly once, reports the error and never retries', async () => {
  const calls = []
  const errors = []
  const keys = []
  let refreshCalls = 0
  const conflict = Object.assign(new Error('A comanda mudou.'), { status: 409 })
  const probe = await mountProbe({
    api: {
      createTable: async () => ({}),
      updateTable: async () => ({}),
      reorderTables: async () => ({}),
      transferTableTab: async (...args) => {
        calls.push(args)
        throw conflict
      },
    },
    getOfficialTables: () => officialTables,
    applyOfficialEffects: () => assert.fail('conflict cannot commit'),
    refreshOfficialData: async () => { refreshCalls += 1 },
    writesBlocked: false,
    canManageTables: true,
    canTransfer: true,
    setRequestKey: (key) => keys.push(key),
    onSuccess: () => assert.fail('conflict cannot succeed'),
    onError: (error) => errors.push(error),
    onStaleTarget: () => assert.fail('server conflict is not a client stale preflight'),
  })

  await act(async () => {
    assert.equal(await probe.getLatest().transferTableTab('table-1', 'table-5', 'tab-A'), false)
  })

  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0], ['table-1', 'table-5', 'tab-A'])
  assert.equal(refreshCalls, 1)
  assert.equal(errors.length, 1)
  assert.equal(errors[0].status, 409)
  assert.deepEqual(keys, ['table:transfer:table-1', null])
  probe.unmount()
})
