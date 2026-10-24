import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

test('order history candidate can deploy manually to staging without admitting other feature branches', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/deploy-staging.yml', import.meta.url), 'utf8')
  const condition = /^    if: (.+)$/m.exec(workflow)?.[1]
  assert.ok(condition, 'staging job must have an explicit branch gate')
  const allowed = (ref, event_name, message = '') => runInNewContext(condition, {
    github: { ref: `refs/heads/${ref}`, event_name, event: { head_commit: { message } } },
    startsWith: (value, prefix) => String(value).startsWith(prefix),
    contains: (value, fragment) => String(value).includes(fragment),
  })
  assert.equal(allowed('feature/orders-history-ui-polish', 'workflow_dispatch'), true)
  assert.equal(allowed('feature/orders-history-ui-polish', 'push'), false)
  assert.equal(allowed('feature/clients-relationship', 'workflow_dispatch'), true)
  assert.equal(allowed('feature/clients-relationship', 'push'), false)
  assert.equal(allowed('codex/settings-home-refinement', 'workflow_dispatch'), true)
  assert.equal(allowed('codex/settings-home-refinement', 'push'), false)
  assert.equal(allowed('codex/printing-background-self-recovery', 'workflow_dispatch'), true)
  assert.equal(allowed('codex/printing-background-self-recovery', 'push'), false)
  assert.equal(allowed('codex/administracao-empresas', 'workflow_dispatch'), true)
  assert.equal(allowed('codex/administracao-empresas', 'push'), false)
  assert.equal(allowed('codex/operational-read-budget', 'workflow_dispatch'), true)
  assert.equal(allowed('codex/operational-read-budget', 'push'), false)
  assert.equal(allowed('codex/melhorias-visuais-2026-10-19', 'workflow_dispatch'), true)
  assert.equal(allowed('codex/melhorias-visuais-2026-10-19', 'push'), false)
  assert.equal(allowed('codex/melhorias-visuais-2026-10-20', 'workflow_dispatch'), false)
  assert.equal(allowed('codex/another-unapproved-candidate', 'workflow_dispatch'), false)
  assert.equal(allowed('feature/unapproved-candidate', 'workflow_dispatch'), false)
  assert.equal(allowed('feature/finance-daily-reconciliation-mvp', 'workflow_dispatch'), false)
  assert.equal(allowed('feature/finance-daily-reconciliation-mvp', 'push'), false)
  assert.equal(allowed('feature/finance-daily-reconciliation-mvp', 'push', 'ci(staging): authorize PR124 QA deploy (staging only)'), false)
  assert.equal(allowed('feature/finance-daily-reconciliation-mvp', 'push', 'ci(staging): another task'), false)
  assert.equal(allowed('master', 'push'), true)
  assert.doesNotMatch(workflow.split('workflow_dispatch:')[0], /feature\/finance-daily-reconciliation-mvp/)
  assert.match(workflow, /Feature staging is allowed only while its pull request is open/)
  assert.match(workflow, /latest.*GITHUB_SHA/s)
})

test('staging smoke requests SPA deep links/assets from the canonical staging release branches', async () => {
  const workflow = readFileSync(new URL('../../.github/workflows/deploy-staging.yml', import.meta.url), 'utf8')
  const jobEnv = workflow.split('    env:')[1]?.split('    steps:')[0]
  const baseUrl = /STAGING_URL:\s*(\S+)/.exec(jobEnv)?.[1]
  assert.equal(baseUrl, 'https://staging.mesiva.com.br')
  assert.equal((workflow.match(/STAGING_URL:/g) || []).length, 1, 'smoke steps must inherit the job URL')
  assert.match(workflow, /echo "Staging URL: \$STAGING_URL" >> "\$GITHUB_STEP_SUMMARY"/)
  const smokeStep = workflow.split('- name: Verify staging deep links')[1]
  assert.ok(smokeStep, 'staging deep-link step is missing')
  const script = /node --input-type=module <<'NODE'\r?\n([\s\S]*?)\r?\n\s+NODE/.exec(smokeStep)?.[1]
  assert.ok(script, 'staging deep-link script is missing')
  const requested = []
  const fetch = async (url) => {
    requested.push(String(url))
    const parsed = new URL(String(url), baseUrl)
    if (parsed.pathname.endsWith('.js')) {
      return { ok: true, status: 200, headers: { get: () => 'application/javascript' } }
    }
    if (parsed.pathname.endsWith('.css')) {
      return { ok: true, status: 200, headers: { get: () => 'text/css' } }
    }
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'text/html' },
      text: async () => '<div id="root"></div><script src="/assets/app.js"></script>',
    }
  }
  await runInNewContext(`(async () => { ${script} })()`, {
    process: { env: { STAGING_URL: baseUrl, STAGING_READY_ATTEMPTS: '1' }, exit: (code) => { throw new Error(`Smoke exited ${code}`) } },
    fetch,
    URL,
    Date,
    console: { log() {}, error() {} },
  })
  const paths = requested.map((value) => new URL(value, baseUrl).pathname)
  assert.ok(requested.every((value) => new URL(value).origin === baseUrl), 'SPA and assets must use the configured staging domain')
  assert.equal(new Set(paths.filter((path) => !path.startsWith('/assets/'))).size, 22)
  for (const path of ['/aceitar-convite', '/empresas', '/mesiva', '/mesiva/empresas']) assert.ok(paths.includes(path))
  assert.match(workflow.split('workflow_dispatch:')[0], /feature\/account-menu-company-context/)
  assert.ok(paths.includes('/relatorios'))
  assert.ok(paths.includes('/financeiro/conferencia-do-dia'))
  assert.ok(paths.includes('/clientes'))
  assert.ok(paths.includes('/pedidos/controle-da-tv'))
  for (const path of ['/minha-conta', '/configuracoes/equipe', '/configuracoes/atividades', '/ativar-conta', '/recuperar-senha', '/redefinir-senha']) {
    assert.ok(paths.includes(path), `access deep link ${path} must be checked`)
  }
  assert.ok(paths.includes('/assets/app.js'))
  const pushSection = workflow.split('workflow_dispatch:')[0]
  assert.match(pushSection, /- master/)
  assert.doesNotMatch(pushSection, /feature\/issue-34-reporting-center|feature\/kitchen-tv-control-center/)
})
