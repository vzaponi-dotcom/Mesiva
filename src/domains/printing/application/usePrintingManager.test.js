import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { usePrintingManager } from '../index.js'
import { canConsumeAutomaticPrintJob } from '../domain/printingEligibility.js'

test('printing application owns the manager without importing qz-tray directly', async () => {
  assert.equal(typeof usePrintingManager, 'function')
  assert.equal(typeof canConsumeAutomaticPrintJob, 'function')
  const source = await readFile(new URL('./usePrintingManager.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /from ['"]qz-tray['"]/)
  assert.match(source, /createQzTransport/)
  assert.match(source, /PRINT_JOB_POLL_MS = 2_000/)
  assert.match(source, /PRINT_STATE_POLL_MS = 5_000/)
  assert.match(source, /STATION_HEARTBEAT_MS = 15_000/)
})

test('manager exposes origin-order ownership through one public command', async () => {
  const source = await readFile(new URL('./usePrintingManager.js', import.meta.url), 'utf8')
  assert.match(source, /rememberOriginOrderId/)
  assert.match(source, /rememberOriginOrder/)
})


test('remote queue mutations can skip the manager-wide refresh when a caller owns its refresh', async () => {
  const source = await readFile(new URL('./usePrintingManager.js', import.meta.url), 'utf8')
  assert.match(source, /refreshManager/)
  for (const marker of [
    'const requestPrintNow = useCallback',
    'const requestRetry = useCallback',
    'const requestDiscard = useCallback',
    'const requestSecondCopy = useCallback',
    'const skipSecondCopy = useCallback',
    'const requestForcePrint = useCallback',
    'const requestReprint = useCallback',
  ]) {
    const start = source.indexOf(marker)
    assert.notEqual(start, -1)
    const next = source.indexOf('\n  const ', start + marker.length)
    const block = source.slice(start, next === -1 ? undefined : next)
    assert.match(block, /refreshManager/)
  }
})


test('job mutation synchronization replaces existing state and prepends a new reprint without a full refresh', async () => {
  const { mergePrintJobMutation } = await import('./usePrintingManager.js')
  const current = [
    { id: 'job-a', status: 'pending', queueState: 'queued', copiesRequested: 1 },
    { id: 'job-b', status: 'pending', queueState: 'queued', copiesRequested: 1 },
  ]
  assert.deepEqual(
    mergePrintJobMutation(current, { id: 'job-a', status: 'discarded' }).map(({ id, status, queueState }) => ({ id, status, queueState })),
    [
      { id: 'job-a', status: 'discarded', queueState: 'queued' },
      { id: 'job-b', status: 'pending', queueState: 'queued' },
    ],
  )
  assert.deepEqual(
    mergePrintJobMutation(current, { id: 'job-new', status: 'pending' }, { prepend: true }).map(({ id }) => id),
    ['job-new', 'job-a', 'job-b'],
  )
})

test('manager exposes the authoritative active print-job count from the combined state summary', async () => {
  const source = await readFile(new URL('./usePrintingManager.js', import.meta.url), 'utf8')
  assert.match(source, /const \[activeJobCount, setActiveJobCount\] = useState\(0\)/)
  assert.match(source, /setActiveJobCount\(Math\.max\(0, Number\(state\?\.summary\?\.active\) \|\| 0\)\)/)
  assert.match(source, /setActiveJobCount\(0\)/)
  assert.match(source, /\bactiveJobCount: stateContextRef\.current === accessContextId \? activeJobCount : 0/)
  assert.match(source, /getPrintState\(\)/)
  assert.doesNotMatch(source, /ACTIVE_PRINT_JOB_POLL/)
})
