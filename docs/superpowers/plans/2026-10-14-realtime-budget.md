# Sincronização por eventos e orçamento Cloudflare — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remover o polling global de cinco segundos e pedidos/TV de dois segundos quando o canal estiver saudável, mantendo recuperação e o orçamento do restaurante atual.

**Architecture:** Um Durable Object hibernável por empresa/ambiente distribui avisos depois de commits. Clientes HTTP existentes preparam a conexão; um ticket de uso único protege o upgrade que não possui headers personalizados. O frontend busca entidades afetadas e reconcilia periodicamente, preservando D1, auth e owners atuais.

**Tech Stack:** JavaScript ESM, React, WebSocket nativo, Worker/D1/Durable Objects SQLite, Node.js 22/node:test, Wrangler e Miniflare fixados no projeto.

**Spec:** [Desenho](../specs/2026-10-14-realtime-budget-design.md). Pré-requisito: [entrega de leituras limitadas](2026-10-14-operational-read-budget.md) integrada e verde. [Roteiro](2026-10-14-mesiva-scale-roadmap.md).

## Global Constraints

- Avisos não contêm clientes, valores, pagamentos, conteúdo de impressão ou credenciais; IDs somente para assinantes autorizados.
- Um Durable Object por empresa e ambiente; origem, contexto, sessão/capabilities e pareamento são revalidados. Nunca permitir empresa escolhida pelo navegador.
- Ticket de uso único válido por 60 segundos, pelo subprotocolo, nunca pela URL/logs. Conexão renovada por HTTP autenticado a cada minuto.
- Agrupar avisos por 250 ms, uma leitura por coleção em andamento; leitura por IDs respeita o teto de parâmetros D1.
- Reconciliação de cinco minutos, mesmo se a revisão não mudou. Fallback HTTP a cada 30 segundos; reconexão de um a 30 segundos com jitter.
- Abas ocultas suspendem atualização visual; estação de impressão mantém o serviço operacional. Sem alteração de ticker, claim, spooler, recuperação ou resultado desconhecido.
- Não haverá journal D1 de eventos nem migração de históricos. Cliente antigo permanece compatível.
- Ensaiar cinco dispositivos, 12h/dia, 31 dias e 5.000 mudanças/dia; meta normal de pelo menos 20% de margem em cada franquia aplicável.
- Código/publicação não começam antes da revisão deste plano e escolha de execução; release segue PR/CI/staging/aceite/master/produção explícita.

## Review Focus

- Upgrade chega sem `X-Mesiva-Context` ou header legado TV: preparar via HTTP sem enfraquecer a autenticação — tarefa 2.
- Commit seguido de resposta interrompida/erro final de auth: avisar outros usuários válidos sem repetir mutation — tarefa 3.
- Evento perdido antes de chegar ao hub: revisão inalterada não pode dispensar reconciliação — tarefas 4/5.
- Resposta antiga rejeitada pelo guard durante uma mutation: conservar a necessidade de atualização — tarefa 5.
- Cliente antigo, flag desligada e restart/hibernação: recuperar por HTTP sem parar o executor de impressão — tarefas 1/4/6/7.

---

### Task 1: contrato e distribuidor hibernável

**Files:** Create `shared/realtimeProtocol.js`, `shared/realtimeProtocol.test.js`, `worker/realtime/businessRealtimeHub.js`, `worker/realtime/businessRealtimeHub.test.js`; Modify `worker/entry.js`, `wrangler.jsonc`.

**Interfaces:** Protocolo v1: mensagens `ready`, `invalidate`, `resync_required`, `access_changed`; `{version:1,type,revision,topics,orderIds}` sem payload de entidades. `ready` também retorna `connectionId` e `expiresAt`; a revisão é uma string decimal para evitar overflow de Number. Exportar `parseRealtimeMessage(input)->message|null` com validação do envelope. Topics: `orders`, `tables`, `reservations`, `clients`, `catalog`, `finance`, `settings`, `kitchen-tv`, `printing`. `BusinessRealtimeHub` expõe `issueTicket(descriptor)->{ticket,expiresAt}`, `consumeTicket(ticket)->descriptor|null`, `renew(connectionId,descriptor)->void`, `publish({topics,orderIds})->revision` e `invalidate({scope,id})->void`; `scope` é `session`, `principal` ou `business`. `fetch(request)` aceita apenas upgrade interno com descriptor validado pelo Worker, usando `ctx.acceptWebSocket`.

**Limits:** Configuráveis: 25 conexões/empresa, cinco/principal; ticket pending <=25/empresa. Ticket armazenado por hash, cleanup expirado limitado; lease dura 75s e renova em 60s. Envelope <=16 KiB e <=99 IDs únicos; overflow vira `resync_required`. Entrada arbitrária do cliente nunca publica alterações. Sem intervalos, I/O permanente ou sockets outbound no hub. Persistir revisão e attachments; ticket replay falha atomicamente.

- [ ] **Step 1:** Testes `ticket_is_consumed_once_even_concurrently`, `expired_ticket_is_rejected`, `hibernation_restores_revision_and_subscriptions`, `expired_lease_receives_no_ids`, `foreign_topics_are_filtered`, `overflow_requests_resync` e `slow_socket_is_closed_without_blocking_peers`. Assertions: segunda chamada de consumo é null; expirado em 60s é null; revisão após restart é maior; socket não autorizado recebe zero IDs; peers continuam recebendo com um socket quebrado.
- [ ] **Step 2:** Executar `node --test shared/realtimeProtocol.test.js worker/realtime/businessRealtimeHub.test.js`; esperar ausência das interfaces.
- [ ] **Step 3:** Implementar contrato/validação/hub. Exportar a classe no entry. Adicionar binding `BUSINESS_REALTIME` e migration de classe SQLite `realtime-v1` para `BusinessRealtimeHub`, com namespaces distintos em staging/produção. Flag `REALTIME_ENABLED` inicialmente `false`; nenhum secret de aplicação novo para tickets opacos.
- [ ] **Step 4:** Reexecutar testes e dry-runs `npx --yes wrangler@4.128.0 deploy --dry-run` / `--env staging`; esperar testes verdes e classe/binding válidos. Confirmar ausência de timer permanente no ensaio real da tarefa 7.
- [ ] **Step 5:** Commit `feat: adicionar distribuidor hibernavel por empresa`.

### Task 2: preparação, upgrade e renovação autenticados

**Files:** Create `worker/realtime/api.js`, `worker/realtime/api.test.js`, `src/infrastructure/realtime/realtimeApi.js`, `src/infrastructure/realtime/realtimeApi.test.js`; Modify `worker/index.js`, `worker/kitchenTvApi.js`, `worker/tenancy/routePolicy.js`, `worker/tenancy/routePolicy.test.js`.

**Interfaces:** Humanos: `POST /api/realtime/prepare`, `POST /api/realtime/renew`; TV: `POST /api/kitchen-tv/realtime/prepare`, `POST /api/kitchen-tv/realtime/renew`. Prepare retorna `{enabled,ticket,expiresAt,socketPath:'/api/realtime/socket',protocol:'mesiva.realtime.v1'}`; renew recebe `{connectionId}` e retorna `{expiresAt}`. `GET /api/realtime/socket` aceita protocolos `mesiva.realtime.v1` e `ticket.<nonce>`; responde somente com `mesiva.realtime.v1`. A rota não é uma API business sem contexto: consome ticket e revalida descriptor antes de abrir. Helpers frontend `createRealtimeApi({request})->{prepare,renew}` usam request canônico injetado; adapter TV mantém cookie/header legado para prepare/renew.

- [ ] **Step 1:** Testes `prepare_requires_current_context_and_origin`, `upgrade_revalidates_after_prepare`, `ticket_cannot_cross_business_or_principal`, `tv_uses_paired_access_not_human_session`, `renew_rejects_changed_role`, `renew_cannot_extend_another_principal`, `ticket_is_not_in_url_or_reflected_protocol`. Cobrir logout/contexto/password/role/membership/business suspensa entre prepare e upgrade, replay concorrente, Origem externa e TV despareada. Comparar 401/403/409 com contratos existentes.
- [ ] **Step 2:** Executar `node --test worker/realtime/api.test.js worker/tenancy/routePolicy.test.js src/infrastructure/realtime/realtimeApi.test.js`; esperar rotas/helpers ausentes.
- [ ] **Step 3:** Implementar rotas com contextos humanos existentes e reaproveitar `authenticatedTv` como helper interno validado, sem duplicar regras. Para humanos, cookie do upgrade deve corresponder ao principal/contexto do ticket; para TV legado sem cookie, revalidar sessão pelo hash autenticado que o prepare vinculou ao descriptor. Nenhum token real fica no descriptor. Resolver namespace por businessId validado e env, filtrar topics por capabilities; renew só pode estender connectionId do mesmo principal/empresa/contexto; retornar disabled quando flag estiver off. Não flexibilizar `requireBusinessContext` globalmente.
- [ ] **Step 4:** Reexecutar testes e `node --test worker/kitchenTvSecurityRegression.test.js worker/kitchenTvAuth.test.js`; zero falhas. Validar headers/contexto via `contextHttpClient` e ausência de credenciais nos diagnósticos.
- [ ] **Step 5:** Commit `feat: proteger conexoes realtime com contexto e ticket unico`.

### Task 3: avisos somente de efeitos confirmados

**Files:** Create `worker/realtime/committedEffects.js`, `worker/realtime/effectCatalog.js`, `worker/realtime/committedEffects.test.js`, `worker/realtime/effectCatalog.test.js`; Modify `worker/access/audit.js`, `worker/index.js`, `worker/kitchenTvApi.js`, `worker/access/api.js`, `worker/identity/authApi.js`, `worker/platform/businessesApi.js` nos limites de integração. Owners de alterações sem audit helper recebem marcador explícito no limite de gravação correspondente; registrar cada caminho no catálogo, sem refatoração ampla.

**Interfaces:** `registerCommittedEffect(statement,effect)` associa metadata por WeakMap; `withCommittedEffects(db,{onCommitted})` preserva prepare/batch/auditContext e resultados; chama `onCommitted(effect)` somente depois de run/all/batch resolvido e `meta.changes>0` na statement marcada. `topicsForCommittedEvent({action,resourceType,resourceId})->{topics,orderIds}` é catálogo explícito de ações atuais. `publishCommittedEffect(env,businessId,effect,executionContext)` agenda publicação com waitUntil e captura falha sem alterar resultado da mutation. Metadados sobre statements de auditoria só valem quando sua escrita comprova um efeito; marcar a statement de negócio nos casos sem essa garantia.

- [ ] **Step 1:** Testes `failed_batch_emits_nothing`, `committed_batch_preserves_changes_and_result_order`, `idempotent_retry_does_not_emit`, `commit_then_final_auth_failure_still_notifies_valid_peers`, `publisher_failure_does_not_retry_mutation`. Cobrir pagamento em lote/comanda, cancelamento com reembolso, criação com printJob, alterações de TV e bulk printing. Asserts: batch rollback gera zero avisos; commit gera um conjunto agrupável; resultado/meta e histórico audit permanecem iguais.
- [ ] **Step 2:** Executar `node --test worker/realtime/committedEffects.test.js worker/realtime/effectCatalog.test.js`; esperar ausência dos componentes.
- [ ] **Step 3:** Implementar metadata sem analisar SQL, sem inserir statements ou mudar posição de `changes()`/assertions. Preservar metadata ao bind/ao criar facades. Ações order/payment invalidam pedidos e tópicos dos efeitos reais; printing invalida fila; configurações/TV invalidam sua projeção. Cobrir actions existentes com tabela de cobertura verificada em teste. Excluir security audit, identity assertions, heartbeat/telemetria e claims sem changes. OnCommitted ocorre antes da validação final de resposta. Passar executionContext desde handleRequest para authenticatedApi e handlers que publicam, sem mutar o env global; manter facade nova por request. Integrar revogação/contexto/despareamento/suspensão ao `invalidate`; se envio falhar, lease de 75s limita avisos e todas as leituras continuam revalidando auth.
- [ ] **Step 4:** Reexecutar testes e `node --test worker/access/audit.test.js worker/tenancy/guardedBusinessDb.test.js worker/orderPrintingRecovery.test.js worker/orderPrintingAttention.test.js`; zero falhas. Estender testes de mutation HTTP afetados para provar commit e efeitos existentes intactos.
- [ ] **Step 5:** Commit `feat: publicar avisos a partir de efeitos confirmados`.

### Task 4: transporte e agendador frontend

**Files:** Create `src/infrastructure/realtime/realtimeClient.js`, `src/infrastructure/realtime/realtimeClient.test.js`; Create `src/app/runtime/realtime/useRealtimeRuntime.js`, `src/app/runtime/realtime/useRealtimeRuntime.test.js`; Modify `src/App.jsx` para composição por sessão. Shared não importa domínios.

**Interfaces:** `createRealtimeClient({api,createSocket,clock,random,onUnauthorized})->{start,stop,subscribeInvalidations,subscribeState}`; `useRealtimeRuntime({accessContextId,enabled,api,visible,operational})->{state,subscribeInvalidations}`. State: connecting/live/fallback/suspended/stopped. Subscription entrega `{topics,orderIds,requiresFullRefresh}` agrupado. Stop cancela timers e callbacks da geração anterior. Socket só abre depois de prepare pelo cliente contextual capturado.

- [ ] **Step 1:** Testes com clock/socket injetados: `burst_coalesces_at_250ms`, `reconnect_backs_off_1_to_30_seconds`, `lease_renews_at_60_seconds`, `hidden_tab_suspends_and_focus_resyncs`, `old_generation_cannot_apply`, `missed_publish_reconciles_even_at_same_revision`, `flag_off_and_404_use_http_fallback`. Asserts: sem leitura de dois/cinco segundos no modo live; um aviso agrupado por janela; snapshot devido em 300.000ms e fallback em 30.000ms; old generation chama zero consumers.
- [ ] **Step 2:** Executar `node --test src/infrastructure/realtime/realtimeClient.test.js src/app/runtime/realtime/useRealtimeRuntime.test.js`; esperar interfaces ausentes.
- [ ] **Step 3:** Implementar cliente sem fila ilimitada: IDs acumulados <=99; overflow exige snapshot. Recuo base 1/2/4/8/16/30s com jitter até 20%; reconciliation 300s com jitter ±10%. Coalescer foco/reconexão; apenas uma reconciliação em andamento. Renewal 60s e close local ao fim do lease se não renovou. Erro definitivo passa pelo owner de sessão atual; erro transitório inicia fallback. Não logar ticket/protocolos completos. Uma instância por contexto da aplicação; não criar bus global entre empresas.
- [ ] **Step 4:** Reexecutar testes e arquitetura; zero falhas. Confirmar que suspensão visual não encerra tickers/owners de impressão.
- [ ] **Step 5:** Commit `feat: coordenar canal realtime e recuperacao no frontend`.

### Task 5: runtime operacional busca entidades alteradas

**Files:** Modify `src/app/runtime/data/useOperationalDataRuntime.js`, seu `.test.js`, `src/app/runtime/data/dataSync.js`, seu `.test.js`, `src/App.jsx`; API da entrega 1 já está disponível.

**Interfaces:** Adicionar input `realtime` ao hook existente. Produce `refreshOrdersByIds(ids)->Promise<boolean>` e preserve `refreshBootstrap`, `refreshOrders`, `applyOfficialEffects`. Integrar `upsertManyById`, ordenação e guards existentes; não criar um novo owner de mutations. Para outros tópicos sem endpoint adequado, usar bootstrap agrupado, não a lista completa em paralelo.

- [ ] **Step 1:** Testes `changed_order_upserts_without_dropping_history`, `payment_during_read_is_not_overwritten`, `rejected_read_remains_dirty`, `missing_known_id_requires_snapshot`, `live_mode_removes_legacy_intervals`, `settings_burst_runs_one_bootstrap`. Asserts: 10.000 pedidos antigos permanecem; uma mudança chama getOrdersByIds com um ID; callback velho não altera valores; guard rejeitado provoca releitura; bootstrap não disputa com leitura completa de pedidos no mesmo evento.
- [ ] **Step 2:** Executar `node --test src/app/runtime/data/useOperationalDataRuntime.test.js src/app/runtime/data/dataSync.test.js`; esperar casos novos falhando por comportamento atual.
- [ ] **Step 3:** Implementar integração e manejo de dirty com revisão/generation. No live, substituir subscriptions de 5s/2s por eventos e reconciliação; no fallback, 30s apenas conforme habilitação da superfície. Datas/valores/projeções continuam oficiais. Inicialização, troca de contexto, ready/reconnect e revisão perdida pedem snapshot consistente; ausência em leitura parcial nunca exclui entidade.
- [ ] **Step 4:** Reexecutar testes e regressões dos workflows de pagamentos/mutationOwner afetados; zero falhas. Não modificar elegibilidade para receber ou finalizar preparo.
- [ ] **Step 5:** Commit `feat: atualizar dados operacionais a partir dos pedidos alterados`.

### Task 6: TV, controle e apresentação da impressão

**Files:** Modify `src/kitchen-display/KitchenDisplayApp.jsx`, seu `.test.js`, `src/kitchen-display/kitchenDisplayApi.js`, seu `.test.js`, `src/app/surfaces/kitchen-tv-control/KitchenTvControlSurface.jsx`, seu `.test.js`; Modify `src/domains/printing/ui/PrintQueue.jsx`/testes pertinentes e composição em `src/App.jsx` somente para subscription de apresentação.

**Interfaces:** TV cria transporte isolado usando seu adapter; control surface recebe o realtime humano existente. Invalidations kitchen-tv/orders acionam `refresh`/`loadControl` oficiais. Printing invalida apresentação da fila e agrupa com refresh existente; `usePrintingManager`, `printExecutionTicker` e worker de execução continuam com os owners atuais.

- [ ] **Step 1:** Testar `paired_tv_updates_without_2s_poll`, `control_updates_from_other_device`, `legacy_tv_header_prepares_socket`, `revoked_tv_cannot_resume`, `clock_and_scheduled_orders_progress_without_messages`, `printing_notification_never_creates_second_executor`. Assertions: tela atualiza por aviso, relógio permanece local, pareamento temporário segue seu poll; QZ/claim não recebe uma segunda chamada causada pelo aviso e unknown não gera reenvio.
- [ ] **Step 2:** Executar `node --test src/kitchen-display/KitchenDisplayApp.test.js src/kitchen-display/kitchenDisplayApi.test.js src/app/surfaces/kitchen-tv-control/KitchenTvControlSurface.test.js`; esperar comportamento novo ausente.
- [ ] **Step 3:** Remover polls de 2s da projeção TV/controle no live; usar reconciliation/fallback comuns. Preservar telemetria heartbeat, pareamento, clock, controles, layout e áudio atuais. Avisos de impressão atualizam UI por seus refreshes oficiais, sem tocar timers necessários à saúde/aging/claim/recovery. Não remover o poll de apresentação que tenha efeito de recuperação sem identificar e preservar esse efeito.
- [ ] **Step 4:** Reexecutar testes e regressões printing executor/segunda via/unknown; zero falhas. Validar cinco clientes e TV em staging, inclusive estação com aba visual oculta, sem criar dados fictícios em produção.
- [ ] **Step 5:** Commit `feat: atualizar TV e apresentacao operacional por avisos`.

### Task 7: medição agregada, homologação e release

**Files:** Create `scripts/infra/realtime-runtime-gate.mjs`, `scripts/infra/realtime-runtime-gate.test.js`, `scripts/infra/realtime-budget-report.mjs`, `scripts/infra/realtime-budget-report.test.js`, `docs/operations/realtime-sync.md`; Modify `.github/workflows/validate.yml`, `.github/workflows/deploy-staging.yml`, README e runbook onde mudarem instruções.

**Interfaces:** Gate real instancia Worker/DO/D1 isolados usando versões fixadas; report `{workload,operations,rowsRead,rowsWritten,workerRequests,workerCpuMs,durableRequests,durableDurationGbS,storage,logs,assumptions,unknownDimensions,passed}`. O relatório distingue medição de projeção, limitações locais de CPU/duração e tráfego da conta fora do ensaio. `assertMonthlyBudget(report)` falha se dimensão obrigatória estiver desconhecida na evidência final de staging ou exceder 80% da franquia no normal/100% no degradado. Inputs de métricas são agregados sem credenciais/payloads.

- [ ] **Step 1:** Testes `idle_runtime_has_no_legacy_global_polls`, `restart_recovers_connections`, `five_clients_converge_after_lost_event`, `no_change_heartbeat_does_not_broadcast`, `projection_counts_auth_printing_and_fallback`, `unknown_dimensions_cannot_be_claimed_free`. Asserts: sem polling legado no live; clientes convergem em até um ciclo de reconciliação após perda; publication failure não repete mutation; relatório não conta só os avisos.
- [ ] **Step 2:** Executar `node --test scripts/infra/realtime-runtime-gate.test.js scripts/infra/realtime-budget-report.test.js`; esperar helpers ausentes.
- [ ] **Step 3:** Implementar gate real com fixtures da entrega 1, sessões fictícias e cenários vazios/históricos/concorrentes. Medir por operação e simular contagens mensais sem esperar 12h reais. Amostrar latência commit→tela em staging; alvo p95 <=2s com canal saudável, considerando indisponibilidade separadamente. Levantar CPU/duração reais e orçamento agregado da conta por consulta read-only autorizada; nenhuma limitação local vira medição de faturamento. Incluir impressão e telemetria preservadas.
- [ ] **Step 4:** Executar gate/relatório, arquitetura/lint/build, dry-runs, migrations/gates existentes e CI completo. Adicionar branch exata na elegibilidade de staging; habilitar flag apenas em staging pelo Actions. Revisão independente da branch, cinco clientes, revogação, fallback, reconnect, sem perda de histórico. Apresentar SHA, relatório de orçamento, limitações e UI para aceite. Flag de produção continua desligada até autorização e evidência suficientes.
- [ ] **Step 5:** Após aceite e autorização de merge/produção, master CI/staging do SHA exato e Deploy production explícito. Habilitar por configuração revisada no release, verificar versão/namespace e comparar métricas durante uso real. Rollback desabilita canal e preserva schema/DO/D1; APIs antigas e fallback continuam disponíveis. Documentar operação, diagnósticos, limites e recuperação; não prometer US$5 para qualquer volume futuro.

## Handoff

Execução recomendada: nativa nesta sessão, tarefas sequenciais e revisão independente da entrega completa. Manter um objetivo por PR e começar na branch isolada adequada a partir da master atualizada; preservar alterações do checkout principal e evidências do incidente. Revisar este plano e escolher o método antes de iniciar implementação.
