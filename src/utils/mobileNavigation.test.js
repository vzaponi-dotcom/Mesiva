import test from 'node:test'
import assert from 'node:assert/strict'
import { MOBILE_SECTION_IDS } from '../app/navigation/registry.js'

test('mobile sections keep the approved navigation order for page transitions', () => {
  assert.deepEqual(MOBILE_SECTION_IDS, [
    'orders',
    'history',
    'kitchen-tv-control',
    'comandas',
    'dashboard',
    'day-conference',
    'receivables',
    'finance',
    'print-queue',
    'clients',
    'products',
    'tables',
    'settings-kitchen-tv',
    'settings-printing',
    'settings-device',
  ])
})
