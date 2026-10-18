# Release and Migration Runbook

This document is the operating procedure for changing Gestão Delivery now that production contains real business data.

## Standard release flow

```text
feature/fix branch
-> Pull Request to master
-> required Validate application / validate check
-> manual/automatic staging deployment for the approved branch
-> human acceptance in staging
-> merge to master
-> explicit Deploy production workflow
-> production smoke test
```

A merge to `master` is source-control integration, not authorization to publish production. Production is released only through the explicit **Deploy production** GitHub Actions workflow after staging acceptance and review.

## Environment boundaries

Staging uses only the Worker `sistema-para-delivery-staging` and D1 database `amor-e-sabor-delivery-staging`.

Production uses only the Worker `sistema-para-delivery` and D1 database `amor-e-sabor-delivery`.

Production data is **never copied from production into staging**. This includes customers, orders, addresses, phone numbers, payments, finance movements, sessions, print jobs, database exports, and real PINs. Staging contains fake/test data only.

## Before opening or merging a PR

Run or obtain a green result for the complete validation gate:

```bash
npm test
npm run lint
npm run build
npx --yes wrangler@4.128.0 deploy --dry-run
npx --yes wrangler@4.128.0 deploy --dry-run --env staging
npm run d1:migrate:local
```

Branches/releases that include the Spec B settings schema/policies (`0024`/`0025`) must additionally pass the real local D1 upgrade/clean-install gate:

```bash
node scripts/infra/spec-b-d1-gate.mjs
```

The repository `Validate application` workflow runs this gate after local migrations while Spec B is being closed. A node:sqlite-only test is not a substitute for this Wrangler/D1 gate.

O CI também verifica os orçamentos de recuperação de impressão e leituras operacionais no D1 real, após as migrations locais. Consulte [as consultas, limites e reprodução do gate operacional](operations/operational-data-read-budget.md); preserve esses gates ao alterar queries ou índices. A sincronização WebSocket também exige o [gate real e orçamento agregado](operations/realtime-sync.md), com métricas externas para CPU/duração e baseline da conta. Flag de produção desabilitada enquanto orçamento/aceite não estiverem completos. A [exceção documentada para a ativação de16/10](superpowers/qa/2026-10-16-realtime-financial-validation.md#decisão-de-liberação-desta-entrega) adia somente a aferição financeira por decisão explícita do usuário; não dispensa CI, staging, aceite humano ou Deploy production manual e não altera a rejeição de dimensões desconhecidas no relatório.

Any red validation check blocks the release. Fix the root cause on the branch; do not merge around a failing check.

The complete suite runs in `Validate application`, split into eight shards. Deployments do not repeat `npm test`: before dependency installation or remote writes, `deploy-validation-gate.mjs` requires a successful validation run for the exact deployment SHA. Master requires its push validation, not the earlier PR commit. Feature staging retains its existing branch/open-PR restrictions and requires validation of that branch head. The gate checks workflow identity, repository, branch, event, SHA and the latest applicable run/attempt.

The gate waits for pending evidence for at most ten minutes in total, with a thirty-second maximum per API request. A failed/cancelled run, wrong SHA, invalid or truncated response, unavailable GitHub API or exhausted wait blocks deployment. Reruns are ordered by the current attempt's start time; equally recent attempts must all pass. Production rechecks both CI and staging on every polling round. This does not remove human staging acceptance.

For a behavior or infrastructure change, deploy that branch to staging and complete acceptance there before merging.

## Staging release

GitHub is the source of truth for code, environment configuration and release history. Publish through GitHub Actions; local Wrangler deployment is not the normal release path. A local test/build is useful for development, but only a successful GitHub deployment run confirms publication.

After the accepted multi-company cutover, staging and production both use multi-company authentication with preparation disabled. The current workflow no longer automatically publishes historical feature branches. Do not push release updates to old branches. `wrangler.jsonc` is the reviewed source of truth for the final production authentication mode: e-mail login enabled, multi-company enabled, preparation disabled, and the official `https://app.mesiva.com.br` origin.

The workflow checks that its commit is still the latest on its GitHub branch before any remote writes. It publishes `release.json` containing the commit and run URL, then verifies that exact commit and the multi-company authentication mode on staging. It deploys the already-tested build without rebuilding it after the release stamp. Changes to workflows take effect on the branch containing them; these rules reach master through the reviewed merge.

Secrets remain in GitHub environment/repository secrets or Cloudflare Worker secrets; secret values never belong in Git. Production remains a manual, master-only workflow and checks out the exact GitHub event commit.

Use the **Deploy staging** GitHub Actions workflow. It may write only to staging resources. The workflow validates the application, applies migrations to `amor-e-sabor-delivery-staging`, configures the staging-only credential, deploys `sistema-para-delivery-staging`, and performs a staging login smoke check.

On master, staging starts with the current push trigger and waits for that commit's CI approval; it does not run another full suite. The existing lightweight build/architecture/lint, local migration checks, remote migrations, release identity and post-deploy smokes remain in place.

If staging deployment, migration, or acceptance fails, the production release stops. Production is not used to diagnose unfinished branch changes.
No modo multi_company, o smoke automatizado atual verifica fronteiras anônimas, rejeições de login legado e identidade do release; ele não comprova o carregamento de uma sessão operacional autenticada. Antes de homologar, abrir o SHA publicado no navegador com conta fictícia de staging e confirmar que /api/bootstrap retorna 200, a operação aparece e a tela inicial não entra em ciclo de redescoberta de sessão. Registrar essa evidência junto ao SHA; HTTP 200 dos assets não substitui esse teste.

Staging pode conter migrations/grants aditivos de outra entrega em homologação. Capabilities desconhecidas continuam sem conceder acesso ao bundle anterior; a validação de estabilidade deve comparar o snapshot persistido completo, sem confundir filtragem de capabilities com mudança de sessão. Não remover grants ou histórico para fazer o bundle abrir.

For Spec B, record the exact staging SHA and the acceptance evidence in `docs/superpowers/qa/2026-09-15-spec-b-final-closure.md`. Physical printing acceptance by context remains a separate release gate documented in `docs/superpowers/qa/2026-09-12-spec-b-physical-printing-guide.md`.

## Migration review

Every PR containing a migration must document its production impact.

Prefer forward-compatible evolution:

1. add compatible schema;
2. deploy code capable of tolerating the transition when necessary;
3. backfill or transform data;
4. move reads/writes to the new structure;
5. remove obsolete structures only in a later release after confidence is established.

Routine production migrations run only inside **Deploy production**. Ordinary CI and staging must not write to production D1.

Destructive or data-transforming migrations require a reviewed restore strategy before authorization. Confirm the expected Cloudflare D1 recovery/backup path and schema compatibility before executing the destructive step.

Automatic down-migrations are not the default database rollback strategy.

### Migration 0052 — data efetiva dos recebimentos

Na branch `codex/received-date-tdd` da PR #120, staging é elegível somente por `workflow_dispatch`. O workflow executa `scripts/infra/effective-receipt-staging-preflight.mjs` antes de criar recursos R2 ou aplicar migrations remotas. O pré-flight detecta schema pré/pós-0052 e bloqueia datas impossíveis, divergências entre recibos/movimentos e timestamps não canônicos usados no fallback; preservar essa ordem e esses bloqueios.

Antes de acionar o workflow, revisar a distribuição histórica do D1 de destino, inclusive recibos sem movimentos ou com consenso ainda NULL, e registrar estratégia de restore D1 verificável e compatibilidade de bundle/schema. O bookmark automático de produção não comprova recuperação de staging; esse workflow não registra um bookmark específico desta feature automaticamente. Não forçar backfill para eliminar divergências.

Conferir também o [orçamento dos recebimentos efetivos](operations/operational-data-read-budget.md#recebimentos-efetivos--pr-120) e a [matriz da Task 11](superpowers/qa/2026-10-17-effective-receipt-task11.md). CI verde e testes locais não dispensam auditoria, restore, orçamento, impressão física pendente ou aceite do release de staging no SHA exato. Destino e testes usam somente dados fictícios; os bloqueios registrados precisam ser resolvidos antes da publicação.

### Spec B migrations 0024/0025

`0024_business_settings_policies.sql` persists typed settings/catalogs and their revisions. `0025_print_context_copies.sql` extends printing snapshots/policies by context. Before production:

- prove clean install and upgrade through `node scripts/infra/spec-b-d1-gate.mjs`;
- preserve existing print-history rows and references;
- preserve already-created jobs and their copy snapshot when defaults change;
- do not assume an older application version remains safe after users create custom settings or two-copy jobs.

## Production release

After the PR is merged and staging acceptance is complete, explicitly start **Deploy production** from `master`.

The workflow must:

1. check out `master`;
2. require successful master CI and staging deployment for the exact SHA, without rerunning the full suite;
3. run lint, architecture, build, local migrations, configuration checks and the production Worker dry-run;
4. record the mandatory D1 Time Travel restore bookmark before remote migrations;
5. list and apply production migrations through the controlled production script;
6. guard the authentication state, configure the production e-mail secret and deploy the Worker;
7. run the production multi-company authentication smoke check.

Do not run routine production migrations or Worker deployment directly from a feature branch.

For Spec B specifically, **do not authorize Deploy production while the physical printing-by-context matrix remains pending**. Existing physical validation of QZ/Windows infrastructure does not automatically prove the new 1/2-copy policy matrix for the current SHA.

## Production smoke test

After a successful release, verify read-only behavior first:

- login succeeds;
- products load;
- orders page loads;
- finance page loads;
- Settings home and the expected policies load;
- the expected production state remains visible.

Avoid creating fake production customers, orders, payments, movements, print jobs, or financial entries as a release test.

## Rollback

### Code rollback

Code rollback means redeploying the last known-good `master` commit/version **only after checking that the previous application version remains compatible with the current production schema and data**.

For Spec B this check is mandatory after `0024`/`0025`: custom catalogs/settings and jobs with context-specific copy snapshots may make an older application semantically incompatible even though the SQL schema is additive.

If the production smoke check fails, stop further changes and assess code rollback before touching production data. Prefer a forward fix when compatibility of the previous binary is uncertain.

### Database rollback

Database rollback normally uses a forward fix or restoration from the applicable Cloudflare D1 backup/recovery point. Do not improvise reverse SQL or automatic down-migrations after a failed release.

For destructive operations, the restoration procedure must be understood before the destructive step is authorized.

## Emergency rule

A production incident does not turn production into a development environment. Diagnose the failure, prepare the smallest safe fix on a branch, validate it, use staging whenever the incident permits, and release through the controlled production path. Any exceptional direct production operation requires explicit authorization and should be recorded in the incident/release notes.
