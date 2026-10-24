import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import { APPLICATION_CAPABILITIES } from '../../../shared/settingsAccess.js'
import { legacyCapabilities } from '../../app/access.js'
import {
  AREA_DESTINATION_IDS,
  DESKTOP_NAV_GROUPS,
  MOBILE_DIRECT_ENTRIES,
  NAVIGATION_DESTINATIONS,
} from '../../app/navigation/registry.js'

test('reporting capabilities and destination are canonical', () => {
  assert.equal(APPLICATION_CAPABILITIES.includes('reports.view'), true)
  assert.equal(APPLICATION_CAPABILITIES.includes('reports.export'), true)
  assert.equal(legacyCapabilities(true).has('reports.view'), true)
  assert.equal(legacyCapabilities(true).has('reports.export'), true)

  const destination = NAVIGATION_DESTINATIONS.find(({ id }) => id === 'reports')
  assert.deepEqual(destination, {
    id: 'reports',
    path: '/relatorios',
    area: 'finance',
    label: 'Relatórios',
    mobileEntry: null,
    capability: 'reports.view',
  })
  assert.deepEqual(AREA_DESTINATION_IDS.finance, ['dashboard', 'reports', 'receivables', 'finance', 'day-conference'])
  assert.deepEqual(
    DESKTOP_NAV_GROUPS.find(({ label }) => label === 'FINANCEIRO').items.map((item) => item.id || item.area),
    ['dashboard', 'day-conference', 'reports', 'receivables', 'finance'],
  )
  assert.deepEqual(MOBILE_DIRECT_ENTRIES.map((item) => item.area || item.id), ['orders', 'comandas', 'finance'])
})

test('App composes Reporting through its public boundary without operational collections', async () => {
  const source = await readFile(new URL('../../App.jsx', import.meta.url), 'utf8')
  assert.match(source, /from '\.\/domains\/reporting\/index\.js'/)
  assert.match(source, /IMPLEMENTED_DESTINATIONS[^\n]+['"]reports['"]/)
  assert.match(source, /activeTab === 'reports' && <ReportingWorkspace granted=\{granted\}/)
  const reportLine = source.split('\n').find((line) => line.includes("activeTab === 'reports'") && line.includes('<ReportingWorkspace')) || ''
  assert.ok(reportLine, 'ReportingWorkspace must be rendered by App')
  assert.doesNotMatch(reportLine, /\borders=/)
  assert.doesNotMatch(reportLine, /\bmovements=/)
  assert.doesNotMatch(reportLine, /\bproducts=/)
  assert.doesNotMatch(reportLine, /\bclients=/)
})

test('reporting UI keeps official metric formulas in the Worker', async () => {
  const source = await readFile(new URL('./ui/ReportingMetricCard.jsx', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /reduce\(|total_cents|payment_receipts/)
})
