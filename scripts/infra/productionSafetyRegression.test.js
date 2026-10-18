import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))
const wrangler = readFileSync('wrangler.jsonc', 'utf8')
const validateWorkflow = readFileSync('.github/workflows/validate.yml', 'utf8')
const stagingWorkflowPath = '.github/workflows/deploy-staging.yml'
const productionWorkflow = readFileSync('.github/workflows/deploy-production.yml', 'utf8')
const prTemplate = readFileSync('.github/pull_request_template.md', 'utf8')
const runbook = readFileSync('docs/release-and-migration-runbook.md', 'utf8')

const productionDatabaseId = 'baa83769-4637-43f6-bf77-711f4f2ed069'

test('production is exposed only on app.mesiva.com.br while staging keeps workers.dev diagnostics', () => {
  const config = JSON.parse(wrangler)
  assert.equal(config.workers_dev, false)
  assert.deepEqual(config.routes, [{ pattern: 'app.mesiva.com.br', custom_domain: true }])
  assert.equal(config.env.staging.workers_dev, true)
  assert.deepEqual(config.env.staging.routes, [{ pattern: 'staging.mesiva.com.br', custom_domain: true }])
  assert.notDeepEqual(config.routes, config.env.staging.routes, 'production and staging must never share the same custom domain')
  assert.equal(config.env.staging.d1_databases[0].database_id, '73a1c0c1-142f-4247-8ffc-e858ab2ac400')
  assert.equal(config.env.staging.r2_buckets[0].bucket_name, 'mesiva-business-assets-staging')
})

test('staging uses an isolated Worker, D1 database, and rate-limit namespace', () => {
  assert.match(wrangler, /"staging"\s*:\s*\{/)
  assert.match(wrangler, /"name"\s*:\s*"sistema-para-delivery-staging"/)
  assert.match(wrangler, /"database_name"\s*:\s*"amor-e-sabor-delivery-staging"/)
  assert.match(wrangler, /"namespace_id"\s*:\s*"2026090401"/)

  const stagingStart = wrangler.indexOf('"staging"')
  assert.notEqual(stagingStart, -1)
  const stagingBlock = wrangler.slice(stagingStart)
  assert.doesNotMatch(stagingBlock, new RegExp(productionDatabaseId))
})

test('package scripts make staging and production targets explicit', () => {
  assert.equal(
    packageJson.scripts['d1:migrate:staging'],
    'npx --yes wrangler@4.128.0 d1 migrations apply amor-e-sabor-delivery-staging --remote --env staging',
  )
  assert.equal(
    packageJson.scripts['d1:migrate:production'],
    'npx --yes wrangler@4.128.0 d1 migrations apply amor-e-sabor-delivery --remote',
  )
  assert.equal(
    packageJson.scripts['deploy:staging'],
    'npm run build && npx --yes wrangler@4.128.0 deploy --env staging',
  )
  assert.equal(
    packageJson.scripts['deploy:production'],
    'npm run build && npx --yes wrangler@4.128.0 deploy',
  )
  assert.equal(packageJson.scripts['d1:migrate:remote'], undefined)
  assert.equal(packageJson.scripts.deploy, undefined)
})

test('generic validation runs before merge and performs no remote writes', () => {
  assert.match(validateWorkflow, /pull_request:/)
  assert.match(validateWorkflow, /branches:\s*\n\s*- master/)
  assert.match(validateWorkflow, /npm run d1:migrate:local/)
  assert.match(validateWorkflow, /deploy --dry-run --env staging/)
  assert.doesNotMatch(validateWorkflow, /d1:migrate:production/)
  assert.doesNotMatch(validateWorkflow, /d1:migrate:staging/)
  assert.doesNotMatch(validateWorkflow, /--remote/)
})

test('staging workflow targets only staging resources', () => {
  const workflow = readFileSync(stagingWorkflowPath, 'utf8')
  assert.match(workflow, /workflow_dispatch:/)
  assert.match(workflow, /environment: staging/)
  assert.match(workflow, /npm run d1:migrate:staging/)
  assert.match(workflow, /wrangler@4\.128\.0 deploy --env staging/)
  assert.match(workflow, /STAGING_PIN/)
  assert.match(workflow, /STAGING_URL:\s*https:\/\/staging\.mesiva\.com\.br/)
  assert.doesNotMatch(workflow, /sistema-para-delivery-staging\.vzaponi\.workers\.dev/)
  assert.doesNotMatch(workflow, /npm run d1:migrate:production/)
  assert.doesNotMatch(workflow, /npm run deploy:production/)
  assert.doesNotMatch(workflow, /amor-e-sabor-delivery --remote/)
})

test('staging smoke stops after its configured propagation window', async () => {
  const { verifyStagingAuth } = await import('./staging-auth-smoke.mjs')
  let reads = 0
  const delays = []
  await assert.rejects(verifyStagingAuth({ baseUrl: 'https://staging.test', attempts: 3,
    fetchImpl: async () => { reads++; return new Response('', { status: 503 }) },
    sleep: async ms => delays.push(ms), log() {},
  }), /bounded propagation window/)
  assert.equal(reads, 3)
  assert.deepEqual(delays, [5000, 5000])
})

test('production deploy is manual, master-only, and validates locally before remote writes', () => {
  assert.match(productionWorkflow, /workflow_dispatch:/)
  assert.match(productionWorkflow, /github\.ref == 'refs\/heads\/master'/)
  assert.match(productionWorkflow, /ref: \$\{\{ github\.sha \}\}/)
  assert.match(productionWorkflow, /npm run d1:migrate:local/)
  assert.match(productionWorkflow, /npm run d1:migrate:production/)
  assert.match(productionWorkflow, /npm run deploy:production/)
  assert.doesNotMatch(productionWorkflow, /npm run d1:migrate:remote/)
  assert.doesNotMatch(productionWorkflow, /npm run deploy\s*$/m)
})

test('deploy workflows require GitHub validation before installation and remote writes instead of repeating the suite', () => {
  for (const [workflow, environment, remoteWrite] of [
    [productionWorkflow, 'production', '- name: Record production D1 restore point'],
    [readFileSync(stagingWorkflowPath, 'utf8'), 'staging', '- name: Ensure staging R2 bucket'],
  ]) {
    const gate = workflow.indexOf('run: node scripts/infra/deploy-validation-gate.mjs')
    const installation = workflow.indexOf('run: npm ci')
    const remote = workflow.indexOf(remoteWrite)
    for (const index of [gate, installation, remote]) assert.notEqual(index, -1)
    assert.ok(gate < installation && gate < remote, 'approval must precede dependency installation and remote operations')
    assert.match(workflow, /actions: read/)
    assert.match(workflow.slice(0, gate), /GH_TOKEN: \$\{\{ github\.token \}\}/)
    assert.match(workflow.slice(0, gate), new RegExp(`DEPLOY_ENVIRONMENT: ${environment}`))
    assert.doesNotMatch(workflow, /run: npm test/)
  }
})

test('production smoke defaults to the official app.mesiva.com.br origin', () => {
  assert.match(productionWorkflow, /PRODUCTION_URL:\s*\$\{\{ vars\.PRODUCTION_URL \|\| 'https:\/\/app\.mesiva\.com\.br' \}\}/)
  assert.doesNotMatch(productionWorkflow, /sistema-para-delivery\.vzaponi\.workers\.dev/)
})

test('production auth-state guard runs only after the schema exists and before remote account configuration', () => {
  const migrations = productionWorkflow.indexOf('- name: Apply D1 migrations')
  const authStateGuard = productionWorkflow.indexOf('- name: Guard production authentication state')
  const emailSecret = productionWorkflow.indexOf('- name: Configure production e-mail secret')
  const deploy = productionWorkflow.indexOf('- name: Deploy')

  for (const index of [migrations, authStateGuard, emailSecret, deploy]) assert.notEqual(index, -1)
  assert.ok(migrations < authStateGuard, 'business_auth_state must not be queried before its migration can create the table')
  assert.ok(authStateGuard < emailSecret, 'auth-state guard must run before production secret changes')
  assert.ok(authStateGuard < deploy, 'auth-state guard must run before production publish')
  assert.doesNotMatch(productionWorkflow, /Configure production PIN/)
})

test('production auth-state guard uses bounded Wrangler D1 query instead of getPlatformProxy', () => {
  const start = productionWorkflow.indexOf('- name: Guard production authentication state')
  const end = productionWorkflow.indexOf('- name: Configure production e-mail secret')
  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  const guard = productionWorkflow.slice(start, end)
  assert.match(guard, /timeout 60s npx --yes wrangler@4\.128\.0 d1 execute amor-e-sabor-delivery --remote --yes/)
  assert.match(guard, /SELECT mode FROM business_auth_state WHERE business_id='amor-e-sabor' LIMIT 1/)
  assert.match(guard, /--json/)
  assert.doesNotMatch(guard, /connectInfrastructure|getPlatformProxy|issue-44-access-admin/)
})

test('production records a D1 Time Travel restore point before migrations or deployment', () => {
  const checkpoint = productionWorkflow.indexOf('- name: Record production D1 restore point')
  const nextStep = productionWorkflow.indexOf('\n      - name:', checkpoint + 1)
  const migrations = productionWorkflow.indexOf('- name: Apply D1 migrations')
  const deploy = productionWorkflow.indexOf('- name: Deploy')

  for (const index of [checkpoint, nextStep, migrations, deploy]) assert.notEqual(index, -1)
  const guard = productionWorkflow.slice(checkpoint, nextStep)
  assert.match(guard, /set -euo pipefail/)
  assert.doesNotMatch(guard, /continue-on-error:|\n\s+if:/)
  assert.match(productionWorkflow, /d1 time-travel info amor-e-sabor-delivery/)
  assert.match(productionWorkflow, /PRODUCTION_D1_BOOKMARK/)
  assert.match(productionWorkflow, /printf 'Production D1 restore bookmark recorded before publish: `%s`\\n'/)
  assert.ok(checkpoint < migrations, 'restore point must be recorded before production migrations')
  assert.ok(checkpoint < deploy, 'restore point must be recorded before production publish')
})

test('production restore checkpoint rejects missing or invalid bookmarks without confirmation input', () => {
  assert.doesNotMatch(productionWorkflow, /backup_confirmed|BACKUP_CONFIRMED|Require production safety checkpoint/)
  const checkpoint = productionWorkflow.split('- name: Record production D1 restore point')[1].split('\n      - name:')[0]
  const parser = checkpoint.match(/<<'NODE'\r?\n([\s\S]*?)\r?\n\s+NODE/)[1]
  for (const raw of ['null', '{}', '{"bookmark":"short"}', '{"bookmark":"invalid bookmark with spaces"}', 'invalid json']) {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', parser], {
      env: { ...process.env, RAW: raw }, encoding: 'utf8',
    })
    assert.equal(result.status, 1, `invalid restore point must block production: ${raw}`)
    assert.equal(result.stdout, '')
  }
  const bookmark = '00000000-00000000-00000000-00000000'
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', parser], {
    env: { ...process.env, RAW: JSON.stringify([{ result: { bookmark } }]) }, encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, bookmark)
})

test('production deploy is permanently multi-company and cannot recreate legacy PIN', () => {
  assert.doesNotMatch(productionWorkflow, /auth_phase:/)
  assert.doesNotMatch(productionWorkflow, /readiness_confirmed:/)
  assert.doesNotMatch(productionWorkflow, /- legacy|\\n\\s*- prepare/)
  assert.doesNotMatch(productionWorkflow, /Configure production PIN|generate-pin-hash|auth_credentials .*pin_hash|AMOR_PIN:/)
  assert.match(productionWorkflow, /PRODUCTION_AUTH_PHASE:\s*multi_company/)
  assert.match(productionWorkflow, /Validate production multi-company configuration/)
  assert.match(productionWorkflow, /Guard production authentication state/)
  assert.match(productionWorkflow, /production-auth-smoke\.mjs/)
  assert.match(productionWorkflow, /legacy PIN deployment is unavailable/)
  const config = JSON.parse(wrangler)
  assert.equal(config.vars.AUTH_EMAIL_ENABLED, 'true')
  assert.equal(config.vars.AUTH_MULTI_COMPANY_ENABLED, 'true')
  assert.equal(config.vars.AUTH_MULTI_COMPANY_PREPARE_ENABLED, 'false')
  assert.equal(config.vars.AUTH_PUBLIC_ORIGIN, 'https://app.mesiva.com.br')
  assert.equal(config.vars.AUTH_EMAIL_FROM, 'Mesiva <acesso@mesiva.com.br>')
})

test('PR template requires migration and rollback review', () => {
  assert.match(prTemplate, /Migration impact/)
  assert.match(prTemplate, /Rollback/)
  assert.match(prTemplate, /Staging/)
  assert.match(prTemplate, /Production data/)
})

test('release runbook documents staging before explicit production release', () => {
  assert.match(runbook, /feature\/fix branch/i)
  assert.match(runbook, /staging/i)
  assert.match(runbook, /Deploy production/)
  assert.match(runbook, /rollback/i)
  assert.match(runbook, /never.*production.*staging/i)
})


test('completed production cutover one-time Actions are retired from the repository', () => {
  for (const path of [
    '.github/workflows/prepare-mesiva-admin.yml',
    '.github/workflows/manage-production-cutover.yml',
    '.github/workflows/finalize-production-cutover.yml',
    'scripts/infra/prepare-mesiva-admin-actions.mjs',
    'scripts/infra/manage-production-cutover-actions.mjs',
    'scripts/infra/finalize-production-cutover-actions.mjs',
    'scripts/infra/cloudflare-d1-rest.mjs',
    'scripts/infra/productionAdminBootstrapWorkflow.test.js',
    'scripts/infra/productionCutoverAdminWorkflow.test.js',
    'scripts/infra/productionFinalizationWorkflow.test.js',
  ]) assert.equal(existsSync(path), false, `retired cutover artifact must be absent: ${path}`)
})

test('Task 11: staging feature branch requires explicit dispatch and read-only receipt audit before ANY remote writes', () => {
  const workflow = readFileSync(stagingWorkflowPath, 'utf8')
  assert.match(workflow, /github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/codex\/received-date-tdd'/)
  assert.doesNotMatch(workflow.slice(workflow.indexOf('on:'), workflow.indexOf('permissions:')), /\n\s*- codex\/received-date-tdd/)
  const audit=workflow.indexOf('node scripts/infra/effective-receipt-staging-preflight.mjs')
  const r2=workflow.indexOf('- name: Ensure staging R2 bucket')
  const migrations=workflow.indexOf('- name: Apply staging migrations')
  for(const index of [audit,r2,migrations]) assert.notEqual(index,-1)
  assert.ok(audit<r2 && audit<migrations, 'legacy audit must precede R2 and all remote D1 writes')
  assert.match(workflow.slice(Math.max(0,audit-240),audit), /if: github\.ref == 'refs\/heads\/codex\/received-date-tdd'/)
})
