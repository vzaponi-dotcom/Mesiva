import { copyFile, mkdir, mkdtemp, readFile, readdir, writeFile, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir, homedir } from 'node:os'
import { dirname, join, resolve, relative, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { createProbeProcessManager } from './spec-b-processes.mjs'
import { assertPreservedPrintContext } from './print-context-snapshot.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const version = '4.128.0'

async function findWrangler() {
  const candidates = []
  try { candidates.push(createRequire(import.meta.url).resolve('wrangler/package.json')) } catch { /* try the local npm executable cache */ }
  const cache = process.env.npm_config_cache ?? (process.platform === 'win32'
    ? join(process.env.LOCALAPPDATA, 'npm-cache') : join(homedir(), '.npm'))
  try {
    for (const name of await readdir(join(cache, '_npx'))) candidates.push(join(cache, '_npx', name, 'node_modules/wrangler/package.json'))
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  for (const candidate of candidates) {
    try {
      const pkg = JSON.parse(await readFile(candidate, 'utf8'))
      if (pkg.version === version) return join(dirname(candidate), 'bin/wrangler.js')
    } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  throw new Error(`Wrangler ${version} is required locally (npm exec --yes --package=wrangler@${version} -- wrangler --version). Gate cannot skip.`)
}

async function freePort() {
  const server = createServer()
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const { port } = server.address()
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  return port
}

async function removeProbeDirectory(temp) {
  const relativeTarget = relative(resolve(tmpdir()), resolve(temp))
  if (!relativeTarget || relativeTarget.startsWith('..') || isAbsolute(relativeTarget) || !relativeTarget.startsWith('spec-b-d1-')) {
    throw new Error('Unsafe temporary cleanup path')
  }
  await rm(temp, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
}

let temp
let child
let output
let failure
const processes = createProbeProcessManager()
try {
  const wrangler = await findWrangler()
  temp = await mkdtemp(join(tmpdir(), 'spec-b-d1-'))
  const config = JSON.parse(await readFile(join(root, 'scripts/infra/spec-b-wrangler.jsonc'), 'utf8'))
  const base = join(root, 'scripts/infra')
  config.main = resolve(base, config.main)
  const fullMigrations = resolve(base, config.d1_databases[0].migrations_dir)
  const runId = randomUUID()
  config.vars = { PROBE_RUN_ID: runId }
  const configPath = join(temp, 'wrangler.jsonc')
  const writeConfig = async (migrationsDirectory) => {
    config.d1_databases[0].migrations_dir = migrationsDirectory
    await writeFile(configPath, JSON.stringify(config))
  }
  // CWD and config both live in a fresh directory: no project .env/.dev.vars, auth
  // profile, inherited Cloudflare tokens, application endpoints or persistent DBs.
  const env = Object.fromEntries(['SystemRoot', 'SYSTEMROOT', 'PATH', 'Path', 'TEMP', 'TMP', 'ComSpec'].filter((key) => process.env[key]).map((key) => [key, process.env[key]]))
  Object.assign(env, { USERPROFILE: temp, APPDATA: temp, LOCALAPPDATA: temp, XDG_CONFIG_HOME: temp,
    CI: 'true', WRANGLER_SEND_METRICS: 'false', CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false', WRANGLER_LOG_PATH: join(temp, 'logs') })
  const options = { cwd: temp, env }
  const run = async (args) => {
    const processChild = processes.spawn(process.execPath, [wrangler, ...args], options)
    let log = ''
    processChild.stdout.on('data', (chunk) => { log = (log + chunk).slice(-40000) })
    processChild.stderr.on('data', (chunk) => { log = (log + chunk).slice(-40000) })
    let timer
    try {
      const result = await processes.wait(Promise.race([processChild.exited,
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Wrangler migration timeout')), 60000) })]))
      if (result.error || result.code !== 0) throw new Error(`Wrangler exited ${result.code}: ${result.error?.message ?? ''} ${log}`)
      await processes.wait(processChild.stop())
    } finally { clearTimeout(timer) }
  }
  const startProbe = async (persistPath) => {
    const port = await freePort()
    const inspectorPort = await freePort()
    child = processes.spawn(process.execPath, [wrangler, 'dev', '--local', '--config', configPath, '--ip', '127.0.0.1', '--port', String(port),
      '--inspector-ip', '127.0.0.1', '--inspector-port', String(inspectorPort), '--persist-to', persistPath, '--show-interactive-dev-session=false'], options)
    let logs = ''
    child.stdout.on('data', (chunk) => { logs = (logs + chunk).slice(-12000) })
    child.stderr.on('data', (chunk) => { logs = (logs + chunk).slice(-12000) })
    const origin = `http://127.0.0.1:${port}`
    const deadline = Date.now() + 45000
    let ready = false
    while (Date.now() < deadline) {
      processes.signal.throwIfAborted()
      if (child.failure) throw child.failure
      if (child.exitCode !== null) throw new Error(`Probe exited ${child.exitCode}: ${logs}`)
      try {
        const response = await fetch(`${origin}/health`, { signal: AbortSignal.any([processes.signal, AbortSignal.timeout(1000)]) })
        ready = response.ok && (await response.json()).probe === runId
        if (ready) break
      } catch { /* wait for startup; deadline below is a blocking failure */ }
      await new Promise((resolve) => setTimeout(resolve, 150))
    }
    if (!ready) throw new Error(`Probe startup timeout: ${logs}`)
    return { origin, processChild: child }
  }
  const requestProbe = async (origin, pathname) => {
    const response = await fetch(`${origin}${pathname}`, { method: 'POST', signal: AbortSignal.any([processes.signal, AbortSignal.timeout(45000)]) })
    const result = await response.json()
    if (!response.ok || result.ok !== true) throw new Error(`D1 probe failed at ${pathname}: ${JSON.stringify(result)}`)
    return result
  }
  const stopProbe = async (probe) => processes.wait(probe.processChild.stop())

  const legacyMigrations = join(temp, 'migrations-through-0024')
  await mkdir(legacyMigrations)
  for (const name of (await readdir(fullMigrations)).filter((name) => name.endsWith('.sql') && Number(name.slice(0, 4)) <= 24)) {
    await copyFile(join(fullMigrations, name), join(legacyMigrations, name))
  }

  const upgradePersist = join(temp, 'upgrade-state')
  await writeConfig(legacyMigrations)
  await run(['d1', 'migrations', 'apply', 'DB', '--local', '--config', configPath, '--persist-to', upgradePersist])
  const legacyProbe = await startProbe(upgradePersist)
  const legacy = await requestProbe(legacyProbe.origin, '/print-context/seed-legacy')
  await stopProbe(legacyProbe)

  await writeConfig(fullMigrations)
  await run(['d1', 'migrations', 'apply', 'DB', '--local', '--config', configPath, '--persist-to', upgradePersist])
  const upgradedProbe = await startProbe(upgradePersist)
  const upgraded = await requestProbe(upgradedProbe.origin, '/print-context/verify-upgrade')
  await stopProbe(upgradedProbe)
  assertPreservedPrintContext(legacy.snapshot, upgraded.preservedSnapshot, await readFile(join(fullMigrations, '0039_tenant_reference_guards.sql'), 'utf8'), await readFile(join(fullMigrations, '0042_print_recovery_candidate_indexes.sql'), 'utf8'))

  const cleanPersist = join(temp, 'clean-state')
  await run(['d1', 'migrations', 'apply', 'DB', '--local', '--config', configPath, '--persist-to', cleanPersist])
  const cleanProbe = await startProbe(cleanPersist)
  const clean = await requestProbe(cleanProbe.origin, '/print-context/verify-clean')
  const result = await requestProbe(cleanProbe.origin, '/probe')
  if (Object.keys(result.checks ?? {}).length !== 9 || Object.values(result.checks).some((value) => value !== true)) {
    throw new Error(`D1 settings probe failed: ${JSON.stringify(result)}`)
  }
  await stopProbe(cleanProbe)
  output = { ...result, printContextMigration: {
    legacyRejectsTwoCopies: legacy.legacyRejectsTwoCopies,
    rowsPreserved: true,
    referencesPreserved: upgraded.constraints,
    cleanInstall: clean.cleanInstall,
  }, wrangler: version, local: true, migrations: (await readdir(fullMigrations)).filter((name) => name.endsWith('.sql')).length }
} catch (error) {
  failure = error
} finally {
  try {
    await processes.cleanup()
    if (temp) await removeProbeDirectory(temp)
  } catch (error) { failure ??= error }
  finally { processes.dispose() }
}
if (processes.signal.aborted) failure ??= processes.signal.reason
if (failure) {
  process.stdout.write(`${JSON.stringify({ ok: false, error: failure.message })}\n`)
  process.exitCode = 1
} else {
  process.stdout.write(`${JSON.stringify(output)}\n`)
}
