# Separação do portal administrativo — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Disponibilizar `admin.mesiva.com.br` e `admin-staging.mesiva.com.br`, com a mesma conta Mesiva e sessões independentes, separando a gestão do app sem perder confirmações de operações anteriores.

**Architecture:** Um Worker por ambiente resolve o portal por origem configurada, aplica a matriz de APIs e entrega o HTML correspondente. Famílias de sessão e challenges persistem audiência app/admin; o frontend administrativo compõe somente conta e platform. A implantação distingue prepare e enforced, com ponte restrita de receipts para sessões anteriores ao corte.

**Tech Stack:** React/React Router/Vite atuais, Worker/D1/R2, Node.js 22, `node:test`, harness React e SQLite/D1 do repositório. Wrangler `4.128.0` para migrations/deploy/gates e `4.147.0` para desenvolvimento; sem dependências novas.

**Spec:** [Especificação aprovada em 06/10/2026](../specs/2026-10-06-admin-portal-separation-design.md).

Estado: plano proposto para revisão; execução ainda não iniciada. Branch local `codex/portal-administracao`, base de produto `e595f7ed`. O método preservado é implementação sequencial por este agente, com uma revisão independente ao final, como na primeira entrega. Aprovar este plano não autoriza DNS, push, staging, merge ou produção automaticamente.

## Global Constraints

- Mesma conta, credenciais/grants/vínculos preservados; sessões independentes. Capabilities reais e assertions atuais continuam sendo autoridade.
- Produção: app `https://app.mesiva.com.br`, admin `https://admin.mesiva.com.br`, Worker `sistema-para-delivery`, D1 `amor-e-sabor-delivery`, R2 `mesiva-business-assets`.
- Staging: app `https://staging.mesiva.com.br`, admin `https://admin-staging.mesiva.com.br`, Worker `sistema-para-delivery-staging`, D1 `amor-e-sabor-delivery-staging`, R2 `mesiva-business-assets-staging`.
- Local: app `http://127.0.0.1:4173`, admin `http://localhost:4174`, Worker 8787. Portas distintas no mesmo host não isolam cookies. Preservar bancos/servidores existentes e usar somente contas/provider fictícios.
- `AUTH_PUBLIC_ORIGIN` permanece operacional; `AUTH_ADMIN_ORIGIN` é próprio do admin. `ADMIN_PORTAL_PHASE` aceita `prepare` ou `enforced`; não é `AUTH_MULTI_COMPANY_PREPARE_ENABLED`, que permanece `false`, com e-mail/multiempresa `true` nos ambientes publicados.
- Cookie `mesiva_session`: HttpOnly, Secure, SameSite=Strict, Path=/, sem Domain compartilhado; 12 horas shared e 7 dias personal. Logout por família; senha/recovery continua global.
- Não transportar senha, cookie, token, motivo ou payload entre hosts; não usar CORS credenciado, postMessage ou storage compartilhado como SSO. Não imprimir esses valores em testes/logs.
- Admin não monta App, SettingsSurface completo, cozinha, financeiro, QZ ou TV. Reutilizar exports públicos dos domínios, ContextApi/clientes imutáveis, componentes/temas e guards existentes.
- Não renomear o bootstrap operacional histórico `src/admin/AdminBootstrap.jsx`. Não alterar fluxo de impressão/pagamentos, grants delegados, dados de negócio ou migrations aplicadas.
- Política nova cobre o runtime multiempresa canônico. Fixtures HTTP devem declarar origens e fase; não criar um bypass de host/autorização para os testes. Caminhos históricos legacy/preparation não são ativados nos novos ambientes publicados.
- Conferir branch/status, base e número livre da migration antes de executar. `0042` está livre nesta base; se houver evolução, registrar a adaptação de numeração/base, sem editar migration aplicada.
- Cada tarefa faz RED→GREEN e um commit. Gates completos ao final; repetir quando uma alteração invalidar a evidência. Registrar decisões/limitações em QA e no ledger do método escolhido.

## Review Focus

1. Resposta perdida de criação durante o corte: um cliente antigo não cria outra empresa nem envia outro convite; receipt ausente continua incerta — Tasks 5 e 8.
2. Mesma conta possui grants nos dois portais e copia manualmente o cookie/contexto: a audiência ainda impede acesso ao outro host e sobrevive à rotação/commit — Tasks 3 e 6.
3. ASSETS responde index operacional como fallback de admin.html ausente: falhar fechado, sem montar operação/TV nem iniciar bootstrap empresarial — Tasks 6 e 7.
4. Recovery no host errado ou grant removido após emissão: não consumir no host errado; recuperar a própria credencial válida não recria grant/admin login — Task 4.
5. Proxy/local, fragmento herdado em redirect e configuração staging: cookies/origens ficam separados, fragmento é descartado e nenhum recurso/URL migra de staging para produção — Tasks 1, 6, 9 e 10.

## Mapa de arquivos e dependências

| Unidade | Arquivos / responsabilidade |
| --- | --- |
| Contratos e perfil | `shared/portalContracts.js`; `worker/portals/profile.js`: enums, bootstrap público, origem exata e aliases de páginas |
| Persistência | `migrations/0042_admin_portal_audiences.sql`; `worker/identity/sessions.js`, `challenges.js`: audiência persistida, snapshots e challenge |
| Auth e e-mail | `worker/identity/authApi.js`, `emailMessages.js`, `worker/access/emailDelivery.js`: login/projeção por portal e link pelo fato persistido |
| Receipts | `worker/platform/provisioningContract.js`, `provisioningReceipts.js`, `legacyReceiptBridge.js`: normalização compartilhada e reconciliação sem mutation |
| Gateway | `worker/portals/policy.js`, `pages.js`, `worker/index.js`: gate antes dos handlers e ASSETS, HTML e redirects |
| Admin frontend | `admin.html`, `src/admin-main.jsx`, `src/app/portals/`: bootstrap/router/runtime/composição independente |
| Conta e platform | `src/domains/access/index.js`, `MyAccount.jsx`; `src/domains/platform/`: exports/paths e owners existentes |
| App/upgrade | `src/App.jsx`, `AppShell.jsx`, `CompanySelection.jsx`, `PortalTransitionStatus.jsx`: prepare preservado e enforced sem gestão, com receipts pendentes |
| Build/dev | `vite.config.js`, `package.json`, `scripts/build/portalBundleBoundary.mjs`: duas entradas, limite de módulos e duas origens locais |
| Operação/gates | `wrangler.jsonc`, workflows, `scripts/infra/portal-config-gate.mjs`, `admin-portal-d1-gate.mjs`, `portal-auth-smoke.mjs`: ambientes e evidência |

Sequência: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10. Contratos, schema, auth, bridge e frontend são consumidores encadeados; não editar este checkout em paralelo.

## Task 1: Contrato puro e resolução do portal

**Files:** criar `shared/portalContracts.js`, `shared/portalContracts.test.js`, `worker/portals/profile.js`, `profile.test.js`.

**Interfaces:** `PORTAL_AUDIENCES = ['app','admin']`; `ADMIN_PORTAL_PHASES = ['prepare','enforced']`; `validatePortalBootstrap(value) → {audience,phase,appOrigin,adminOrigin}` frozen; `legacyAdminTarget(pathname, config) → string|null`; `readPortalConfig(env) → {appOrigin,adminOrigin,phase,localMode}`; `resolvePortalProfile(request,env) → {audience,phase,appOrigin,adminOrigin}`. Config inválida: 503 `PORTAL_CONFIG_UNAVAILABLE`; origem desconhecida: 404 `PORTAL_HOST_NOT_ALLOWED`.

- [ ] **1. Escrever testes** de dois HTTPS distintos e canônicos, fase inválida/ausente, origem com path/query/fragmento/credenciais, wildcard, forwarded host, porta/scheme divergentes, workers.dev e origem desconhecida. `PORTAL_LOCAL_MODE='true'` aceita somente os dois URLs locais definidos; modo local publicado não é admitido pelo gate de deploy da Task 9. Bootstrap só contém quatro campos públicos.

```js
test('forwarded host never selects admin on an unknown origin', () => {
  const env = { AUTH_PUBLIC_ORIGIN:'https://app.example.test', AUTH_ADMIN_ORIGIN:'https://admin.example.test', ADMIN_PORTAL_PHASE:'prepare' }
  assert.throws(() => resolvePortalProfile(new Request('https://unknown.example.test/api/auth/session', {headers:{'X-Forwarded-Host':'admin.example.test'}}),env), {status:404,code:'PORTAL_HOST_NOT_ALLOWED'})
})
```

- [ ] **2. Confirmar RED:** `node --test shared/portalContracts.test.js worker/portals/profile.test.js`. Expected: falta do contrato/resolução exigidos, não fixture ou sintaxe inválida.
- [ ] **3. Implementar** os exports acima sem React/DB no contrato puro. Comparar `new URL(request.url).origin` com a configuração validada, ignorando headers de encaminhamento. Alias antigo aceita somente `/mesiva`, `/mesiva/empresas`, `/nova` e um ID codificado; constrói destino no admin do mesmo ambiente, descarta query e termina com fragmento vazio explícito para não herdar o fragmento do navegador. Não fabricar destino para outra rota.
- [ ] **4. Verificar GREEN** pelo mesmo comando; expected: zero falhas, origens/configs normalizadas e nenhum efeito externo.
- [ ] **5. Commit:** `feat: definir contratos e perfis dos portais`.

## Task 2: Migration de audiência com upgrade preservado

**Files:** criar `migrations/0042_admin_portal_audiences.sql`, `worker/identity/portalMigration.test.js`, `worker/test-support/portalSchemaDb.js`.

**Interfaces:** família e challenge recebem `audience TEXT NOT NULL DEFAULT 'app' CHECK(audience IN ('app','admin'))`. Helper de testes `createPortalSchemaDb(t,{throughMigration=42}) → {sqlite,db,applyAudienceMigration(),snapshotIdentity()}`; aplica migrations reais, sem editar/reimportar arquivos de teste.

- [ ] **1. Escrever testes** de clean install e upgrade de 0041 com contas, grants, credenciais, famílias/sessões e challenges não consumidos. Exigir default app, rejeição de audiência inválida, FKs íntegras e conservação de dados/expirações. Snapshot de identidade compara somente campos anteriores à migration, sem imprimir valores sensíveis.

```js
test('upgrade keeps old families and challenges on app without rewriting identity', async t => {
  const f = await createPortalSchemaDb(t,{throughMigration:41})
  const before = JSON.stringify(f.snapshotIdentity())
  f.applyAudienceMigration()
  assert.equal(JSON.stringify(f.snapshotIdentity())===before,true,'identity changed during upgrade')
  assert.equal(f.sqlite.prepare("SELECT count(*) n FROM identity_session_families WHERE audience!='app'").get().n,0)
  assert.equal(f.sqlite.prepare('PRAGMA foreign_key_check').all().length,0)
})
```

- [ ] **2. Confirmar RED:** `node --test worker/identity/portalMigration.test.js`; expected: audiência/upgrade ausentes.
- [ ] **3. Implementar** apenas a migration nova e o helper test-only. Não revogar famílias, consumir links, alterar senha/grants ou apagar receipts. Número/arquivo precisam corresponder à base conferida.
- [ ] **4. Verificar GREEN:** comando anterior e `node --test worker/platform/managementMigration.test.js`; expected: ambas as suites verdes, sem mudança em 0041 ou migrations anteriores.
- [ ] **5. Commit:** `feat: persistir audiência de sessão e recuperação`.

## Task 3: Sessão, login e conta ligados à audiência

**Files:** modificar `worker/identity/sessions.js`, `authApi.js`, `challenges.js` (somente sucessor da troca de senha), `worker/tenancy/scopeSelection.js`, `routePolicy.js`; criar `worker/test-support/portalEnv.js`, `portalDb.js`, `worker/identity/portalSessions.test.js`; ajustar fixtures HTTP multiempresa e testes de sessão/auth/escopo/senha afetados.

**Interfaces:** `prepareAccountSession(db,{...existing,audience='app',allowPlatformOnApp=false})` preserva o resultado preparado atual; rotação conserva audience/family/expiry. `authenticateAccountRequest(request,env,now)` resolve perfil da Task 1 e exige a audiência persistida. `loadAccountSessionRow` retorna `audience`; snapshot compara esse campo. `selectAccountScope` (em scopeSelection) e `changeAccountPassword` (em challenges) recebem a opção `allowPlatformOnApp=false` após `now`, preservando o `monotonicNow` existente de scopeSelection; caller HTTP calcula o valor da fase/profile, nunca do body. Contexto/projeção autenticados expõem `audience`.

Helper `createPortalEnv(db,{phase='prepare',appOrigin='https://app.example.test',adminOrigin='https://admin.example.test'}) → env`. `createPortalFixture(t,{phase='prepare'}) → f` reutiliza a fixture empresarial real e fornece `db,sqlite,now,accounts,env`, `login(audience,accountId=accounts.admin,{deviceMode='shared'}) → {response,view,cookie}`, `request(audience,path,{method='GET',cookie,contextId,body,headers}={}) → Response` e `interceptNextBatch(fn)`. Helpers mantêm handlers/SQL reais e não logam cookies/passwords.

- [ ] **1. Escrever testes** de duas famílias da mesma conta, logout independente, cópia manual de cookie/contexto, TTL 12h/7d, rotação sem extensão, snapshot de audiência alterada antes do commit e senha global. Admin força platform, mesmo sem destination no body, e exige grant real. App em prepare preserva seleção anterior; enforced rejeita destination/select-platform e nunca auto-escolhe platform para conta sem empresas. Admin não enumera vínculos/retorna grants empresariais. Anônimo conserva o DTO atual.

```js
test('same account can log in independently without cookie replay across portals', async t => {
  const f=await createPortalFixture(t,{phase:'enforced'})
  const app=await f.login('app'), admin=await f.login('admin')
  assert.equal(app.response.status,200); assert.equal(admin.view.scope,'platform')
  assert.equal(app.cookie===admin.cookie,false,'families must be independent')
  const replay=await f.request('admin','/api/auth/session',{cookie:app.cookie})
  assert.equal((await replay.json()).authenticated,false)
})
```

- [ ] **2. Confirmar RED:** `node --test worker/identity/portalSessions.test.js worker/identity/sessions.test.js worker/identity/authApi.test.js`; expected: realm/replay/login independentes ainda não garantidos.
- [ ] **3. Implementar** o carregamento com audiência antes da aceitação do contexto. Para admin, scope platform e audiência admin; para app, identity/business, permitindo app-platform apenas em prepare. Revalidar grants na emissão e no commit. Atualizar callsites de rotação/senha e fixtures com origens explícitas; não reduzir a cobertura de auth antiga para fazer testes passarem.
- [ ] **4. Verificar GREEN:** comando anterior mais `worker/identity/challenges.test.js`, `worker/tenancy/isolationApi.test.js`, `worker/platform/managementTransactions.test.js`. Expected: cópia de token falha, alteração de audience/grant no commit não cria mutation/receipt de sucesso, senha continua invalidando outras famílias.
- [ ] **5. Commit:** `feat: isolar sessões e login por portal`.

## Task 4: Recuperação no portal de origem e convites no app

**Files:** modificar `worker/identity/challenges.js`, `authApi.js`, `emailMessages.js`, `worker/access/emailDelivery.js`; criar `worker/identity/portalRecovery.test.js`; adaptar `challenges.test.js`, `emailMessages.test.js` e `worker/tenancy/companyInvitations.test.js` nos casos pertinentes.

**Interfaces:** `prepareIdentityChallenge(db,{...existing,audience='app'})`; inspeção/conclusão aceitam `{token,...,expectedAudience='app'}` e validam essa audiência também na assertion de consumo. Admin só emite password_reset, não activation. `identityMessageOrigin(env,{purpose,audience}) → string` usa a origem validada: company_invitation/activation no app; password_reset no portal persistido. Delivery de identity recarrega o fato do challenge pelo subjectId, em vez de confiar em campo transitório.

- [ ] **1. Escrever testes** de links antigos default app, recuperação admin/app, emissão genérica sem grant e grant removido após emissão. Host errado não consome o link. Um admin challenge válido ainda troca a própria senha após revogação do grant, mas login admin segue negado. Verificar origins de mensagens com provider fictício, inclusive alteração deliberada do campo transitório de audience e convites emitidos por admin para restaurantes.

```js
test('wrong portal cannot consume a valid recovery challenge', async t => {
  const f=await createPortalFixture(t)
  const challenge=await prepareIdentityChallenge(f.db,{accountId:f.accounts.admin,purpose:'password_reset',expectedRevision:1,audience:'admin',now:f.now})
  await commitIdentityStatements(f.db,challenge.statements)
  await assert.rejects(completeIdentityChallenge(f.db,{token:challenge.value.token,password:'Synthetic recovery password!',expectedAudience:'app',now:f.now}),{code:'INVALID_EMAIL_CHALLENGE'})
  assert.equal(f.sqlite.prepare('SELECT consumed_at FROM identity_challenges WHERE id=?').get(challenge.value.id).consumed_at,null)
})
```

- [ ] **2. Confirmar RED:** `node --test worker/identity/portalRecovery.test.js`; expected: campo de audience/origem/consumo não aplicado.
- [ ] **3. Implementar** quota/cooldown e resposta genérica existentes, origem a partir do fato persistido e consumo sem login automático. Grants não são restaurados por recovery. Não trocar AUTH_PUBLIC_ORIGIN nem o destino de convites de primeiro gerente/equipe. Uma mudança de senha continua global, preservando o contrato da Task 3.
- [ ] **4. Verificar GREEN:** `node --test worker/identity/portalRecovery.test.js worker/identity/challenges.test.js worker/identity/emailMessages.test.js worker/tenancy/companyInvitations.test.js worker/platform/invitationManagement.test.js`. Expected: zero falhas e nenhum envio externo.
- [ ] **5. Commit:** `feat: direcionar recuperação ao portal de emissão`.

## Task 5: Receipts de cadastro e ponte sem efeitos

**Files:** criar `worker/platform/provisioningContract.js`, `provisioningReceipts.js`, `legacyReceiptBridge.js`, `provisioningReceipts.test.js`, `legacyReceiptBridge.test.js`; modificar `businessProvisioning.js`, `businessesApi.js`, `worker/tenancy/routePolicy.js`, `src/domains/platform/infrastructure/platformApi.js` e testes correspondentes.

**Interfaces:** `normalizeProvisioningInput(input) → {name,managerName,managerEmail}`, `hashProvisioningInput(input) → Promise<string>` reutilizam exatamente normalização/hash existentes; `readProvisioningAttempt(db,context,key,{now}) → {status:'confirmed',result:ProvisioningResult}` (404 se ausente, view/create antes e depois). `readProvisioningReplay(db,context,input,key,{now}) → ProvisioningResult` retorna `created:false`, 409 ADMIN_PORTAL_REQUIRED sem receipt, 409 PROVISIONING_KEY_REUSED em hash divergente. `handleLegacyReceiptBridge(request,env,context,options) → Response|null` só atende as três operações restritas da spec. Cliente ganha `getProvisioningAttempt(key,options={})`.

`ProvisioningResult` é a projeção existente `{businessId,firstManagerId,invitationId,created,deliveryStatus,expiresAt}`, sem mudar nomes/semântica. Helpers locais em provisioningReceipts.test.js: `seedProvisioningReceipt(f) → {context,input,key,businessId}` cria uma vez pelo handler real em prepare com provider fictício; `snapshotProvisioningEffects(f) → object` retorna contagens de empresas, convites, reservas de envio, audits e receipts, além do contador de chamadas do provider, sem segredos.

- [ ] **1. Escrever testes** de GET scoped ao author/ambiente, key inválida, grant revogado na leitura, criação antiga com mesma chave/hash após quota cheia e receipt ausente durante um commit ainda em andamento. Ponte exige audience app + scope platform, não habilita família business/identity e não chama preparador, reserva de envio ou provider.

```js
test('legacy create replay reads one receipt without writing or sending', async t => {
  const f=await createPortalFixture(t)
  const seeded=await seedProvisioningReceipt(f) // helper local do teste; cria pelo fluxo real antes do corte
  const before=JSON.stringify(snapshotProvisioningEffects(f))
  const result=await readProvisioningReplay(f.db,seeded.context,seeded.input,seeded.key,{now:f.now})
  assert.equal(result.businessId,seeded.businessId); assert.equal(result.created,false)
  assert.equal(JSON.stringify(snapshotProvisioningEffects(f))===before,true,'replay changed persisted effects')
})
```

- [ ] **2. Confirmar RED:** `node --test worker/platform/provisioningReceipts.test.js worker/platform/legacyReceiptBridge.test.js`; expected: leitura/replay restritos ainda ausentes.
- [ ] **3. Implementar** normalização no contrato compartilhado pelos dois caminhos; não chamar createBusiness pela ponte, mesmo depois de consultar a receipt. Incluir GET `/api/platform/provisioning-attempts/:key` no classificador/handler platform, com no-store. Manter o contrato de GET management-attempt e a capability correspondente à operação. Nenhuma receipt/auditoria é apagada.
- [ ] **4. Verificar GREEN:** comando anterior mais `worker/platform/businessProvisioning.test.js`, `businessesApi.test.js`, `managementRepository.test.js`, `src/domains/platform/infrastructure/platformApi.test.js`. Expected: chave/hash/autoria estáveis, ausência não confirmada e replay sem novo estado/delivery.
- [ ] **5. Commit:** `feat: reconciliar cadastros e receipts sem novas ações`.

## Task 6: Gate de API e entrega de páginas por host

**Files:** criar `worker/portals/policy.js`, `pages.js`, `policy.test.js`, `pages.test.js`, `worker/portalRouting.test.js`; modificar `worker/index.js` no runtime multiempresa, `worker/tenancy/routePolicy.js` nos contextos pertinentes e fixtures HTTP afetadas.

**Interfaces:** `classifyPortalRequest(request,profile) → {kind,...}` com kind `allow-api`, `deny`, `legacy-receipt`, `redirect`, `page`, `asset`; deny conhecido 403 PORTAL_ROUTE_NOT_ALLOWED, API desconhecida 404, método incompatível em rota admitida 405. `handlePortalPage(request,env,profile) → Promise<Response>` serve index/admin conforme host, com bootstrap `{audience,phase,appOrigin,adminOrigin}` público no elemento JSON `#mesiva-portal`. `handleLegacyReceiptBridge` é da Task 5; validação de contexto usa a Task 3.

- [ ] **1. Escrever testes** da matriz inteira prepare/enforced antes de dispatch: admin não alcança empresa/TV/QZ; app bloqueia gestão após corte e permite somente receipts antigos autenticados. Assets/HTML em host desconhecido não são chamados. POST de página não redireciona. Retornar HTML operacional como fallback de admin.html é falha 503, sem montar operação. Redirect deve remover query e usar fragmento vazio explícito.

```js
test('missing admin entry cannot fall back to the operational shell', async t => {
  const f=await createPortalFixture(t,{phase:'enforced'})
  f.env.ASSETS={fetch:async()=>new Response('<html data-mesiva-entry="app"><body>operation</body></html>',{headers:{'content-type':'text/html'}})}
  const response=await f.request('admin','/empresas')
  assert.equal(response.status,503)
  assert.equal((await response.text()).includes('operation'),false)
})
```

- [ ] **2. Confirmar RED:** `node --test worker/portals/policy.test.js worker/portals/pages.test.js worker/portalRouting.test.js`.
- [ ] **3. Implementar** o gate antes dos handlers públicos, platform, business/TV e ASSETS. Ponte só após loader/grants corretos; demais rotas recusadas não chamam handlers de negócio. Buscar HTML pelo binding ASSETS, nunca por fetch público; validar o marcador de entrada e impedir fallback errado antes de responder. Marcador estático: `data-mesiva-entry="app"` em index e `"admin"` em admin. Serializar apenas o bootstrap validado, escapando `<`; sem incluir env, IDs de banco ou sessão.
- [ ] **4. Verificar GREEN:** comandos anteriores mais `worker/identity/authApi.test.js`, `worker/tenancy/isolationApi.test.js`, `worker/platform/companyManagementFlow.test.js`, `worker/orderPrintingHttp.test.js` e testes TV pertinentes. Expected: nenhum efeito em route denial; cópia manual de cookie também falha em API protegida, mesmo com grants nos dois lados.
- [ ] **5. Commit:** `feat: separar superfícies e páginas no Worker`.

## Task 7: Frontend administrativo independente

**Files:** criar `admin.html`, `src/admin-main.jsx`, `src/app/portals/AdminPortalBootstrap.jsx`, `AdminPortalApplication.jsx`, `adminPortalRouter.js`, `bootstrapConfig.js`, `usePlatformPortalRuntime.js` e respectivos testes; modificar `index.html`, `vite.config.js`, `src/domains/platform/ui/PlatformRoutes.jsx`, `PlatformShell.jsx`, `CompanyList.jsx`, `NewCompany.jsx`, `CompanyDetail.jsx`, `src/domains/access/index.js`, `MyAccount.jsx`. Criar `scripts/build/portalBundleBoundary.mjs` e `portalBundleBoundary.test.js`.

**Interfaces:** `readPortalBootstrap(document,{expectedAudience}) → PortalBootstrap`, sem fallback em ausência/discordância de marcador. `createAdminPortalBrowserRouter({rootComponent})` e `createAdminPortalMemoryRouter({rootComponent,initialEntries=['/']})` mantêm a composição raiz viva nas páginas. `AdminPortalApplication({config,sessionApi?,api?})` usa owners por autor acima das folhas; `usePlatformPortalRuntime({config,sessionApi?})` compõe `useSessionRuntime`, ContextApi e guards, sem bootstrap empresarial. `PlatformRoutes`/páginas recebem `basePath='/mesiva/empresas'` para preservar prepare; admin passa `/empresas`. `PlatformShell` recebe `appHref` opcional para Abrir aplicativo. Access index passa a exportar MyAccount.

Build: `vite.config.js` usa `build.rolldownOptions.input` para index/admin (opção confirmada nos tipos da versão instalada). Em portalBundleBoundary.mjs, `validatePortalBundles(bundle,{adminEntry:'admin.html'}) → void` percorre imports/dynamicImports/módulos do output Rolldown; `adminPortalBundleBoundaryPlugin() → VitePlugin` chama esse validador em generateBundle e recusa runtime App, bootstrap operacional, domínios operacionais, QZ/TV no grafo JS administrativo. CSS/foundations compartilhados podem permanecer; não gerar um mapa privado de módulos dentro dos assets públicos.

- [ ] **1. Escrever testes** de login admin, grants, empresa/lista/abas, Minha conta e recovery, dados de conta platform com aviso de senha global, falta de grants, offline/erro/loading e resposta tardia de outro autor. Confirmar navegação `/empresas` sem mudar API paths. Admin não chama `/api/bootstrap`, businesses/select-business/TV nem inicia polling de operação. Antes de mount, bootstrap errado/ausente falha fechado. Testar grafo com import dinâmico operacional transitivo.

```js
test('admin bundle rejects an operational runtime hidden behind a dynamic import', () => {
  const bundle={
    'admin.js':{type:'chunk',isEntry:true,facadeModuleId:'admin.html',imports:[],dynamicImports:['operation.js'],modules:{}},
    'operation.js':{type:'chunk',imports:[],dynamicImports:[],modules:{'/repo/src/App.jsx':{}}},
  }
  assert.throws(()=>validatePortalBundles(bundle,{adminEntry:'admin.html'}),/operational/i)
})
```

- [ ] **2. Confirmar RED:** `node --test src/app/portals/AdminPortalApplication.test.js src/app/portals/bootstrapConfig.test.js scripts/build/portalBundleBoundary.test.js`.
- [ ] **3. Implementar** composição/root/router, login e conta pelo domínio access e seus exports; usar APIs same-origin e clientes imutáveis. MyAccount identifica scope platform como Administração Mesiva e explica que a senha atinge empresas e administração; texto não concede permissão. Recuperação reutiliza a UI/contratos da Task 4. Reutilizar `useNewOrderUnloadGuard` de `src/app/navigation` (é um hook genérico de beforeunload, sem imports de domínio) para pending/uncertain, sem duplicá-lo ou renomear consumidores. Componentes operacionais não entram na nova composição.
- [ ] **4. Verificar GREEN:** comandos anteriores mais testes de PlatformRoutes/List/Detail/Management, MyAccount, PasswordRecovery, useSessionRuntime, sessionApi e guards. `npm run build` deve gerar os dois HTML/manifest e passar o limite de módulos. Expected: sem bootstrap/polling operacional e owners preservados ao navegar/desmontar folhas.
- [ ] **5. Commit:** `feat: criar aplicação administrativa independente`.

## Task 8: Retirada da gestão do app e continuidade das tentativas

**Files:** modificar `src/App.jsx`, `src/admin/AdminBootstrap.jsx`, `src/app/shell/AppShell.jsx`, `src/domains/companies/ui/CompanySelection.jsx`, `src/app/navigation/routes.js`, `src/infrastructure/auth/sessionApi.js`, `src/domains/platform/application/provisioningAttempts.js`; criar `src/app/portals/PortalTransitionStatus.jsx`, `PortalTransitionStatus.test.js`, `src/domains/platform/application/provisioningAttempts.test.js`, `src/AppPortalBoundary.test.js`; ajustar testes/harness que compõem App e sessão multiempresa.

**Interfaces:** bootstrap operacional entrega config da Task 1 e verifica entrada app. `createSessionApi({request,json,expectedAudience=null})` valida audience quando esperado; os novos bootstraps sempre passam app/admin, fixtures multiempresa explicitam o campo. Owner de provisioning mantém `run/subscribe/getSnapshot/isBlocking/hasUnresolved/acknowledge` e ganha `reconcile(accountId,api) → ProvisioningResult|null`, sem POST; mantém chave/input em pending/uncertain. `PortalTransitionStatus({config,session,attempts,managementAttempts,api,onResolved,onLogout})` oferece somente verificação de resultado e saída quando liberada.

- [ ] **1. Escrever testes** prepare/enforced: app prepare conserva superfície antiga; app enforced remove entradas de shell/seleção/configuração, não monta PlatformRoutes nem promove root sem empresa a platform. Navegação cliente para alias antigo não contorna o gate. Resposta perdida anterior mantém owners; GET receipt ausente não libera/repete POST; conta/contexto diferentes não conciliam nem publicam sucesso tardio; estado confirmado libera navegação e não exige detalhes gerais bloqueados.

```js
test('provisioning reconciliation never retries POST when the receipt is absent', async () => {
  const attempts=createProvisioningAttempts(), accountId='synthetic-admin'
  await attempts.run(accountId,{createBusiness:async()=>{throw new Error('lost response')}},{name:'Synthetic',managerName:'Synthetic Manager',managerEmail:'manager@example.test'},()=>crypto.randomUUID())
  const key=attempts.getSnapshot(accountId).key
  await attempts.reconcile(accountId,{getProvisioningAttempt:async()=>{throw Object.assign(new Error('not found'),{status:404})},createBusiness:()=>assert.fail('reconcile posted')})
  assert.equal(attempts.getSnapshot(accountId).key,key)
  assert.equal(attempts.isBlocking(accountId),true)
})
```

- [ ] **2. Confirmar RED:** `node --test src/domains/platform/application/provisioningAttempts.test.js src/app/portals/PortalTransitionStatus.test.js src/AppPortalBoundary.test.js`.
- [ ] **3. Implementar** a troca pela fase validada do bootstrap, não por papel, query ou preferência local. No client enforced, receipt é lida por GET; não oferecer retry de mutation no app. Guardar intent acima da navegação, incluindo provisioning e management. Não redirecionar/logout com intent pendente. Confirmada a receipt, permitir seguir ao login admin; sem transportar payload/segredo. Preservar App/TV/QZ e o uso operacional de Minha conta.
- [ ] **4. Verificar GREEN:** comandos anteriores e `src/AppSessionAccess.test.js`, suites de sessão/contexto/exit/credential mutation e os testes de menus/seleção afetados. Expected: app não monta gestão em enforced, não perde draft/owner em prepare e não cancela/refaz operações de pagamentos/impressão.
- [ ] **5. Commit:** `feat: retirar gestão do app com transição de receipts`.

## Task 9: Configuração, desenvolvimento e pipelines dos dois hosts

**Files:** modificar `wrangler.jsonc`, `vite.config.js` (somente dev), `package.json`, `.github/workflows/validate.yml`, `deploy-staging.yml`, `deploy-production.yml`, smokes atuais e testes de safety/R2/deep links; criar `scripts/infra/portal-config-gate.mjs`, `portal-config-gate.test.js`, `portal-auth-smoke.mjs`, `portal-auth-smoke.test.js`.

**Interfaces:** `validatePortalDeploymentConfig(config,{environment}) → {appOrigin,adminOrigin,phase}` rejeita domínio/binding/flag cruzados e localMode publicado. `verifyPortalRelease({appOrigin,adminOrigin,phase,expectedCommit,fetchImpl=fetch,attempts=6,requestTimeoutMs=10000,sleep,log}) → {ok:true,phase,appOrigin,adminOrigin}` verifica modo multiempresa, entry marker e bootstrap por host, roots/deep links, aliases/denials e assets; não faz login/gravação real. attempts aceita inteiros de 1 a 20, espera 5000 ms entre tentativas pelo sleep injetável e limita cada request por AbortSignal.timeout; log só descreve status/check, nunca corpo/token. expectedCommit é opcional e valida release.json de staging; produção identifica SHA pelo workflow, como hoje. Dev script `dev:admin` usa Vite com audience admin/porta 4174; `dev` continua app/4173. Transform de HTML/dev fallback usa o mesmo contrato de bootstrap/entry da Task 7, sem import de código Worker no browser.

- [ ] **1. Escrever testes** para configuração real + versões deliberadamente trocadas: dois Custom Domains por ambiente, app/admin corretos, DB/R2 não compartilhados entre ambientes, PIN/preparation desativados, workers.dev/preview fechados, localMode rejeitado em produção/staging. Executar o parser/gate, não apenas buscar strings. Smoke fake cobre admin caindo em HTML app, redirects/fragmento, erro de assets e retry limitado. Testar expressão real do job admitindo manualmente somente `codex/portal-administracao` e exigindo PR/CI/head.

```js
test('staging configuration cannot redirect administration to production', () => {
  const bad=structuredClone(JSON.parse(readFileSync('wrangler.jsonc','utf8')))
  bad.env.staging.vars.AUTH_ADMIN_ORIGIN='https://admin.mesiva.com.br'
  assert.throws(()=>validatePortalDeploymentConfig(bad,{environment:'staging'}),/origin|domain/i)
})
```

- [ ] **2. Confirmar RED:** `node --test scripts/infra/portal-config-gate.test.js scripts/infra/portal-auth-smoke.test.js scripts/infra/stagingDeepLinkRegression.test.js`; expected: configuração/matriz ainda com um host.
- [ ] **3. Implementar** duas rotas por ambiente, ambas fases inicialmente prepare, `assets.run_worker_first:true`, origins/adminPhase e aliases canônicos, mantendo bindings atuais. Adicionar gates de configuração e smoke de ambos os hosts aos workflows; não repetir npm test no deploy, remover aprovação SHA, restore point ou guard de autenticação. Usar esquema de options/retries/timeout existente dos smokes. Dev expõe app via 127.0.0.1 e admin via localhost, proxy mantendo host/origin; não carregar secrets remotos ou chamar provider real para preparar testes.
- [ ] **4. Verificar GREEN:** testes anteriores + productionSafetyRegression, operationProfileR2Regression, smokes auth atuais e deploy-validation-gate. `npm run test:architecture`, `npm run lint`, `npm run build`, dry-runs fixados dos dois ambientes e leitura do manifest. Expected: gates verdes; domínios novos são apenas declarados localmente, sem deploy/DNS nesta tarefa.
- [ ] **5. Commit:** `ci: validar e homologar os dois portais por ambiente`.

## Task 10: D1 real, integração, QA e documentação de rollout

**Files:** criar `scripts/infra/admin-portal-d1-gate.mjs`, `admin-portal-wrangler.jsonc`, `worker/test-support/portalProbeWorker.js`, `worker/portalIntegration.test.js`, `docs/superpowers/qa/2026-10-06-admin-portal-separation.md`; adicionar o gate D1 ao validate; atualizar README, AGENTS apenas no mapa se necessário, `docs/operations/multi-company-production.md`, `docs/release-and-migration-runbook.md`.

**Interfaces:** o gate usa `createProbeProcessManager` existente, Wrangler 4.128.0, config/estado temporários exclusivos e sem herdar secrets/contas de Cloudflare. O probe chama handlers reais com DB D1 local e URLs internas dos perfis, retornando somente `{ok:true,checks:{...},migrations:42,local:true}`; nunca cookie/token/password ou dados privados. Testa clean install/upgrade de 0041 e cenários prepare/enforced. Não substitui Worker/D1 por mocks SQL.

- [ ] **1. Escrever integração** da mesma conta em dois portais: operações admin apenas no admin, dados/credenciais/grants preservados, sessões antigas app, challenge pré-upgrade, senha global, receipt ausente em chamada ainda em andamento e replay posterior. Alterar audience/grant na interceptação antes de batch deve impedir todos os efeitos de negócio/receipt de sucesso. No D1 real, incluir constraints/default/expiry e ponte de provisioning sem quota/delivery novos; verificar foreign keys.

```js
test('audience change before administrative commit prevents the mutation', async t => {
  const f=await createPortalFixture(t,{phase:'enforced'}), admin=await f.login('admin')
  f.interceptNextBatch(()=>f.sqlite.prepare("UPDATE identity_session_families SET audience='app' WHERE id=(SELECT family_id FROM identity_sessions WHERE context_id=?)").run(admin.view.contextId))
  const response=await f.request('admin','/api/platform/businesses/company-A/suspend',{method:'POST',cookie:admin.cookie,contextId:admin.view.contextId,headers:{'Idempotency-Key':crypto.randomUUID()},body:{reason:'Synthetic maintenance',expectedRevision:0}})
  assert.equal(response.ok,false)
  assert.equal(f.sqlite.prepare('SELECT lifecycle_status FROM businesses WHERE id=?').get('company-A').lifecycle_status,'enabled')
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM platform_management_receipts').get().n,0)
})
```

- [ ] **2. Confirmar RED:** `node --test worker/portalIntegration.test.js` e `node scripts/infra/admin-portal-d1-gate.mjs`; expected: invariantes/gate ainda não demonstrados. Diagnosticar falha de infraestrutura; não declarar aprovação de um runner sem resultado.
- [ ] **3. Implementar** probe/gate conforme o supervisor/cleanup existentes, com sentinela runId, portas exclusivas, tempo limitado e remoção só de temporários próprios. Não copiar banco real nem fazer seed de produção. Documentar fases e comandos efetivamente verificados, audiences/password/logout e ponte de até 7 dias; templates/nomes anteriores ficam históricos onde aplicável, sem eliminar compatibilidade necessária.
- [ ] **4. Verificar local:** testes de integração, gate D1 novo, gates Spec B/company/profile ainda pertinentes; arquitetura/lint/build, dry-runs e `npm test` completo. Para Windows, `npm test -- --test-concurrency=4` percorre toda a suíte, mantendo os oito shards no CI. Expected: zero falhas/cancelamentos/skips e gates reais aprovados. Browser desktop/mobile e teclado: dois logins independentes, foco/modal/scroll, pending guards, temas, root/sem grants, redirects sem fragmento e sem QZ/TV/negócio no admin. Registrar limitação de provider/print físico; não ampliá-los sem necessidade.
- [ ] **5. Conferir final:** spec coverage por tarefa, diff/links, módulos sem consumidores e estado Git; revisão independente da branch inteira pelo método preservado, incluindo Review Focus. Correções seguem TDD e repetem gates invalidados; não remover validações ou pedir confirmação de escolhas rotineiras já aprovadas.
- [ ] **6. Commit:** `test: validar separação e documentar corte dos portais`.

## Publicações e critérios de término

O plano de código termina com comportamento dos dois modos validado localmente e evidência de QA. Não cria automaticamente DNS ou sessões em produção. Os dois cortes de configuração precisam de SHAs e aceites próprios:

1. **Staging prepare:** PR aberto/CI aprovado, inventário de DNS por leitura e pipeline oficial para os dois hosts. Conferir cookies independentes, app preservado e admin isolado com dados fictícios.
2. **Staging enforced:** depois do aceite de prepare, commit revisado altera apenas a fase de staging para enforced; repetir CI/deploy do novo SHA e matriz de corte/receipts. Produção permanece prepare na configuração candidata. Sem promover falha de homologação.
3. **Produção prepare:** depois de merge, CI/staging da master e autorização explícita de produção para esse SHA, pipeline cria o novo host e oferece o portal enquanto o acesso anterior funciona. Confirmar leitura/identidade e login humano no admin; não testar com negócios fictícios em produção.
4. **Produção enforced:** após aceite do novo portal em produção, pequena entrega de configuração altera ADMIN_PORTAL_PHASE de produção para enforced, mantendo staging enforced. Novo PR/CI/staging da master e nova autorização explícita do SHA antes de produção. Não ativar fase via parâmetro de request, secret improvisado ou Wrangler local.
5. **Fim da transição:** novas ações Mesiva somente no admin; compatibilidade de receipts antigos só enquanto as famílias existentes forem válidas, sem extensão (máximo 7 dias). Limpeza posterior exige prova de expiração e preserva receipts/auditoria/migrations. Rollback só para bundle compatível com audiência, hosts e fase; preferir correção adiante.

## Cobertura e execução

Spec 1–3: Tasks 1, 9, 10; spec 4: Tasks 6–8; spec 5–6: Tasks 3, 5, 6; spec 7: Task 4; spec 8: Tasks 5, 8, 10; spec 9–10: Tasks 9–10 e os critérios de publicação acima. Review Focus está fixado nos testes das tarefas indicadas.

Plano revisado pelo autor quanto a contratos, defaults/legados, interfaces, dependências, efeitos de ponte, audiences, entry fallback, DNS e fases de publicação. Método recomendado/preservado: execução inline/sequencial neste chat, por compartilharem os mesmos contratos de auth, Worker e frontend, seguida de uma revisão independente ao final. Aguardando revisão/aprovação do usuário antes de implementar.
