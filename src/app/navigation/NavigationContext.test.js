import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { act } from 'react-test-renderer'
import { workspaceHarness } from '../../test-support/renderWorkspace.js'

test('NavigationProvider expõe só navegação e possui um listener app:navigate', async (t) => {
  const h = await workspaceHarness(t)
  const { NavigationProvider, useNavigation } = await h.load('/src/app/navigation/NavigationContext.jsx')
  const seen = React.createRef()
  const calls = []
  function Probe() {
    seen.current = useNavigation()
    return React.createElement('output', null, seen.current.activeTab)
  }
  const before = h.activitySnapshot({ ignoreFocus: true }).listeners
  const renderer = await h.render(NavigationProvider, {
    activeTab: 'orders', activeMobileEntry: undefined, authenticated: true,
    granted: new Set(['orders.view']), implemented: new Set(['orders']),
    moreOpen: false, requestNavigation: (id) => calls.push(id), openMore() {}, closeMore() {},
    children: React.createElement(Probe),
  })
  assert.deepEqual(Object.keys(seen.current).sort(), [
    'activeMobileEntry', 'activeTab', 'authenticated', 'closeMore', 'granted', 'implemented',
    'moreOpen', 'navigationBadges', 'openMore', 'requestNavigation',
  ].sort())
  assert.equal(seen.current.authenticated, true)
  assert.deepEqual(seen.current.navigationBadges, {})
  assert.equal(h.activitySnapshot({ ignoreFocus: true }).listeners, before + 1)
  await act(async () => h.window.dispatchEvent(Object.assign(new Event('app:navigate'), { detail: 'clients' })))
  await act(async () => h.window.dispatchEvent(Object.assign(new Event('app:navigate'), { detail: { id: 'clients' } })))
  assert.deepEqual(calls, ['clients'])
  await act(async () => renderer.unmount())
  assert.equal(h.activitySnapshot({ ignoreFocus: true }).listeners, before)
})
