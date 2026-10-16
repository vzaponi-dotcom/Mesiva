import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8')

test('operational runtime owns finance settings and merges authoritative finance write effects immediately', async () => {
  const [app, runtime] = await Promise.all([
    read('./App.jsx'),
    read('./app/runtime/data/useOperationalDataRuntime.js'),
  ])
  assert.match(app, /financeSettings,/)
  assert.match(app, /applyOfficialEffects/)
  assert.match(runtime, /const DATA_COLLECTIONS = \[[^\]]*'financeSettings'/s)
  assert.match(runtime, /const \[financeSettings, setFinanceSettings\] = useState\(null\)/)
  assert.match(runtime, /data\?\.financeSettings \?\? null/)
  assert.match(runtime, /selected\.includes\(key\)&&guard\.canApply\(token,key\)/)
  assert.match(runtime, /deletedMovementId/)
  assert.match(runtime, /removeById\(current, deletedMovementId\)/)
  assert.match(runtime, /setFinanceSettings\(nextFinanceSettings\)/)
  assert.match(runtime, /if\(allowed\('movements'\)\)setMovements\(Array\.isArray\(data\?\.movements\)\?data\.movements:\[\]\)/)
})

test('App delegates movement and opening-balance ownership to FinanceWorkspace', async () => {
  const [app, workspace] = await Promise.all([
    read('./App.jsx'),
    read('./domains/finance/ui/FinanceWorkspace.jsx'),
  ])
  for (const token of [
    'movementDialogOpen',
    'editingMovement',
    'openingBalanceDialogOpen',
    'handleSaveMovement',
    'handleDeleteMovement',
    'handleSaveFinanceSettings',
    '<MovementDialog',
    '<OpeningBalanceDialog',
  ]) assert.equal(app.includes(token), false, token)
  assert.match(app, /FinanceWorkspace/)
  assert.match(workspace, /useFinanceCommands/)
  assert.match(workspace, /MovementDialog/)
  assert.match(workspace, /OpeningBalanceDialog/)
})
