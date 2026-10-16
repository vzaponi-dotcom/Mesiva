# Snapshots operacionais e consultas por superfície — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Execução nativa já escolhida; uma revisão independente da entrega integrada ao final. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retirar histórico integral do bootstrap/reconciliação/fallback, preservando funcionalidades e aprovando o orçamento de cinco dispositivos da issue #75.

**Architecture:** Manter `/api/bootstrap` e APIs de mutations compatíveis. Um parâmetro aditivo `surface` permite bootstrap com coleções completas apenas em seu escopo; histórico, clientes e financeiro recebem consultas próprias com totais autoritativos e paginação. Reutilizar o owner de dados/guards para mutations e um owner por consulta histórica, compondo com o canal realtime já implementado.

**Tech Stack:** React/React Router/Vite, Worker/D1/SQLite, Durable Objects/WebSocket existentes; Node 22, Wrangler fixado nos scripts, sem dependências novas.

**Spec:** [Matriz aprovada em 15/10/2026](../specs/2026-10-15-operational-snapshots-matrix.md). Complementa [realtime](2026-10-14-realtime-budget.md), cuja tarefa 7 permanece pendente do orçamento integrado. Base desta extensão: `d67b3260`.

## Global Constraints

- Cinco dispositivos, 12h/dia, 31 dias, 5.000 alterações/dia; normal com 20% de margem e degradado dentro das franquias. CPU/DO/conta desconhecidos impedem aprovação final.
- Sem janela arbitrária de dias para pendências; sem apagar histórico; migrations novas e aditivas. Produção com realtime desativado até gate, homologação e autorização próprios.
- Capacidades reais por recurso/status, empresa da sessão; totais/contagens não podem revelar registros que a projeção atual oculta. `payments.receive` não concede leitura nem finaliza preparo.
- Centavos, datas/fuso, cancelamento/reembolso, reservas/comandas e seleção de 2..100 pedidos do mesmo cliente preservados. Ausência em página não exclui entidade.
- Impressão mantém claim2s/heartbeat15s/aging5s ou30s, confirmação do spooler e decisão humana para unknown. Aviso não executa impressão.
- Plano e execução desta matriz foram autorizados explicitamente pelo usuário; manter método nativo, sem repetir pedido de confirmação de decisões rotineiras. Homologação de produção permanece separada.

## Review Focus

1. Perfil financeiro/clientes sem `orders.history`: nenhum total/detalhe pode ampliar a leitura atual; teste nas tarefas 2 e 3.
2. Pedido finaliza, é recebido ou muda de comanda entre seleção e leitura: snapshot não reinclui registro inelegível e mutation não é sobrescrita; tarefas 1, 3 e 4.
3. Mesmo timestamp, múltiplas páginas e seleção fora da página: cursor estável, nenhum descarte silencioso; tarefas 2, 3 e 5.
4. Inicialização em deep link e navegação durante leitura: loading termina, callbacks do contexto/consulta anteriores não aplicam; tarefa 4 e testes reais App.
5. Estação com aba oculta e histórico não carregado: documento/segunda via/recovery continuam oficiais; tarefa 6.

## Mapa e contratos comuns

- `worker/readModels/query.js`: valida `limit` (50 padrão, máximo100), cursor opaco JSON base64url com versão/consulta/ordem, filtros e superfície. Cursor inválido ou de outra consulta retorna400, nunca altera autorização. SQL usa binds; empresa nunca vem do cursor.
- `worker/readModels/snapshotRepository.js`: shell/coleções relevantes; `listActiveOrders` reutiliza `orderReadRepository` e mapeadores oficiais, consultando candidatos por índice parcial de status ativo e itens por99IDs.
- `worker/readModels/api.js`: rotas aditivas `/api/reads/*`; autenticação, capabilities, projeções e attribution atuais. Chamado no business handler depois dos guards. Bootstrap com `surface` usa o mesmo serviço quando `OPERATIONAL_READ_MODELS_ENABLED=true`; ausente/desativado conserva contrato legado.
- `shared/scopedReads.js`: contrato puro de scopes/coleções/páginas. Bootstrap scoped mantém chaves oficiais existentes e adiciona `readModel:{version:1,surface,completeCollections,orderScope,counters}`. `completeCollections` enumera somente coleções presentes; `orderScope` é `active` ou `open-tabs`, nunca `all` implícito. Counters `{orders,comandas}` alimentam badges independentemente da tela.
- Páginas mantêm chaves reconhecidas (`orders`, `clients`, `movements`, `entries`) e retornam `nextCursor`, `summary`, `completeWithinScope:false`, `queryKey`. Attribution percorre somente registros autorizados retornados. Detalhe continua `/api/orders/by-ids` (99 IDs/batch), sem duplicar API.
- `src/infrastructure/api/scopedReadsApi.js`: `createScopedReadsApi({request})` produz `getActiveOrders`, `getHistory`, `getCustomers`, `getCustomerRelationship`, `getReceivables`, `getFinanceOverview`, `getMovements`, `getClosedTableTabs`. Query usa URLSearchParams e AbortSignal, cliente HTTP contextual existente.
- `src/infrastructure/realtime/useScopedQuery.js`: owner genérico por consulta, contexto e guard de coleção injetados; sem import de domínio. Retorna `{data,status,error,reload,loadNext,hasMore}`; singleflight/dirty, descarte de callback antigo, hint/foco/reconciliation300s/fallback30s pelo transporte. Recebe `officialRevision` para invalidar após efeitos locais, sem novo owner de mutation.

### Task 1: bootstrap scoped e seleção operacional

**Files:** Create `shared/scopedReads.js`, `.test.js`, `worker/readModels/query.js`, `snapshotRepository.js`, `api.js` e testes; Modify `worker/orderReadRepository.js`, `worker/index.js`, `worker/tenancy/routePolicy.js` e `.test.js`, `src/infrastructure/api/bootstrapApi.js`, testes HTTP pertinentes, `wrangler.jsonc`.

**Interfaces:** `listActiveOrders(db,businessId)` retorna pedidos completos ativos atuais; `loadSurfaceSnapshot(db,businessId,{surface,granted,effectiveBusinessConfig})` retorna bootstrap scoped. `parseReadSurface(value)` aceita IDs do registry atual e `shell`; desconhecido400. Mapeamento: cozinha→active; novo pedido→catálogo/clientes/mesas/comandas abertas; mesas/comandas→respectivas coleções e pedidos pertinentes; catálogo→produtos; histórico/clientes/financeiro/relatórios/settings→shell, consultas dedicadas das próximas tarefas. Shell inclui empresa/configuração e counters autorizados. `getBootstrap(version,{surface,signal}={})` é aditivo.

- [ ] **Step 1:** Testes `empty_scoped_bootstrap`, `active_reads_ignore_100k_terminal_history`, `future_schedule_and_old_active_remain`, `active_status_with_legacy_finished_timestamp_remains`, `open_tab_keeps_old_orders`, `capability_projection_before_attribution`, `finalized_between_candidate_and_payload`, `disabled_or_no_surface_keeps_legacy_contract`. Medir plano e candidatos com histórico10k/100k; proibido SELECT global de itens em escopo operacional.
- [ ] **Step 2:** Rodar `node --test shared/scopedReads.test.js worker/readModels/snapshotRepository.test.js worker/readModels/api.test.js`; esperar interfaces ausentes.
- [ ] **Step 3:** Implementar rotas/seleções por índice, reuse mapper/IDs e revalidar status após leitura. `completeCollections` explícito; não preencher coleções ausentes com listas vazias. Configflag nova false em produção/staging até migração dos consumidores. Garantir auth final e raw-grants snapshot.
- [ ] **Step 4:** Reexecutar testes e `node --test worker/orderReadByIds.test.js worker/orderReadByIdsHttp.test.js worker/tenancy/capabilityCompatibility.test.js`; zero falhas. Registrar rows_read por escopo e equivalência dos candidatos.
- [ ] **Step 5:** Commit `feat: adicionar snapshots operacionais por superficie`.

### Task 2: histórico paginado e detalhe independente

**Files:** Create `worker/readModels/orderHistoryRepository.js`/testes, `src/infrastructure/api/scopedReadsApi.js`/testes; Modify query/api, `src/domains/orders/ui/OrderHistory.jsx`, `src/domains/orders/domain/historyQuery.js` apenas extração pura se necessária, e testes.

**Interfaces:** `readOrderHistory(db,businessId,{granted,period,filter,search,startDate,endDate,cursor,limit,now})` retorna `{orders,summary:{all,finalized,cancelled},nextCursor,queryKey,completeWithinScope:false}`. GET `/api/reads/orders/history`; active GET `/api/reads/orders/active`. Ordem: timestamp canônico DESC, id DESC. Período `all` continua sem corte. Busca preserva normalização atual e inclui itens; contar universo filtrado antes do statusfilter, como `getHistoryView`. Índices novos na migration0045 sobre status ativo e expressão canônica do histórico/tenant; não alterar0043/0044. O índice0043 da TV exclui finished_at/cancelled_at e não substitui a elegibilidade por status da cozinha.

- [ ] **Step 1:** Testar contagens e resultados contra `getHistoryView` para período/filtro/busca/acento/itens/fuso; empates50+50, cursor inválido/outra consulta, ID fora da página, histórico sem `orders.view`, operação sem `orders.history`403.
- [ ] **Step 2:** `node --test worker/readModels/orderHistoryRepository.test.js src/infrastructure/api/scopedReadsApi.test.js`; RED antes de implementar.
- [ ] **Step 3:** Implementar consulta por candidatos/página e totais completos separados; `listOrdersByIds` só para a página. Manter modo legado de `OrderHistory` quando não receber readModel, UI de paginação e detalhe por ID no modo novo, sem alterar opções atuais.
- [ ] **Step 4:** Testes de histórico/detalhe/impressão dos consumidores existentes; sem perda de menu/foco/mobile. Capturar EXPLAIN/rows_read, incluindo custo real de busca em todo o período.
- [ ] **Step 5:** Commit `feat: consultar historico de pedidos sob demanda`.

### Task 3: clientes e financeiro com totais completos

**Files:** Create `worker/readModels/customerReadRepository.js`, `financeReadRepository.js`, `orderHeaders.js`, `financialCandidates.js` e testes; Create `migrations/0047_financial_read_candidates.sql` e `worker/readModels/financialCandidatesMigration.test.js`; Extend query/api/scopedReadsApi. Regras puras compartilhadas necessárias ficam em `shared/receivableReadRules.js` e `shared/customerReadRules.js`, com testes; wrappers de domínio preservam exports/imports externos atuais, sem importar código frontend no Worker. Modify índices novos se EXPLAIN justificar.

**Interfaces:** `/api/reads/customers` retorna `{clients,summary,nextCursor,queryKey}`; `/api/reads/customers/:id/relationship` retorna `{client,profile,orders,nextCursor,queryKey}`, profile preserva indicadores de relacionamento e `completeHistory` conforme grants. `/api/reads/finance/receivables` retorna `{entries,orders,summary,forecast,receivedToday,groups,nextCursor,queryKey}`; summary/forecast/entries equivalentes às funções atuais de receivables, total/grupo sobre universo autorizado. `/api/reads/finance/overview` retorna `{totals:{entries,exits,balance},currentBalance,financeSettings,receivablesSummary,pendingRefundOrders}` somente campos autorizados. `/api/reads/finance/movements` retorna `{movements,totals,currentBalance,nextCursor,queryKey}`. Filtros/ordens atuais são whitelists; limite50/max100. Dados de paid/client-history vêm por páginas, pendências antigas entram por elegibilidade, não idade.

- [ ] **Step 1:** Fixtures pagas/canceladas/reembolso/reserva/comanda, clientes com mais100 pedidos e movimentos anteriores ao saldo inicial. Comparar totals/forecast/group/profile com regras atuais sobre o universo completo autorizado; página não altera totals. Perfis finance/client sem history não ganham contagens ocultas; outrotenant não aparece.
- [ ] **Step 2:** `node --test worker/readModels/customerReadRepository.test.js worker/readModels/financeReadRepository.test.js`; RED interfaces ausentes.
- [ ] **Step 3:** Implementar seleção/aggregates autoritativos. A projeção privada `order_financial_candidates` contém somente `(business_id,order_id,kind)`, FK composta e índice de kind; view canônica e triggers transacionais mantêm unpaid/refund sem alterar pedidos/pagamentos/movimentos/audit. Leitura revalida a view fonte, nunca trata cache como autoridade de valores. Testar backfill, rollback, idempotência, `changes()` e dados legados/tenant. Não materializar itens históricos inteiros para totais; carregar detalhe/itens apenas de candidatos necessários (busca inclui itens por EXISTS). Reusar regras puras e centavos atuais; `shared/` não importa React/domínios. APIs de pagamento e limites2..100 permanecem intactos.
- [ ] **Step 4:** Equivalência e planos com10k/100k histórico, pendências antigas/futuras e concurrent payment; `node --test worker/paymentRepository.test.js worker/paymentValidation.test.js` e regressões de recebíveis/clientes pertinentes.
- [ ] **Step 5:** Commit `feat: servir totais completos e consultas financeiras por escopo`.

### Task 4: runtime e owner de consulta scoped

**Files:** Create `src/infrastructure/realtime/useScopedQuery.js`/testes; Modify `useOperationalDataRuntime.js`/testes, `dataSync.js` se necessário, `src/App.jsx`, `bootstrapApi.js`/testes, `shared/scopedReads.js`, wrappers puros de contagem operacional e os dois workflows de pagamento somente para o getter opcional do snapshot oficial; `OrderHistory` cobre cancelamento de preparação assíncrona.

**Interfaces:** Runtime recebe `surface` (activeTab), retorna `readModelEnabled`, `operationalCounters`, métodos atuais e `getSyncGuard/getOfficialRevision`. `applyBootstrapCollections` só substitui completeCollections presentes no modo scoped; legado conserva todas as coleções. `refreshOrders` usa getActiveOrders quando scoped, jamais GETorders integral. Bootstrap de outra superfície não limpa caches de coleções não declaradas. `useScopedQuery({accessContextId,queryKey,load,realtime,topics,guard,collections,officialRevision,enabled})` usa token oficial e guarda query atual; concatena páginas por ID sem duplicar, nunca interpreta ausência como delete.

- [ ] **Step 1:** Deep link para cada área, mudança de superfície/contexto durante read, pagamento durante snapshot/query, dirty rejeitado/erro30s, duas páginas empatadas, saída de active sem apagar detalhe, badge igual em qualquer área, legacy sem descriptor. Assert nenhum fallback/ready chama bootstrap integral no modo scoped.
- [ ] **Step 2:** Rodar testes runtime/hook/App focados; RED para novo contrato.
- [ ] **Step 3:** Integrar API contextual, propagar AbortSignal, uma consulta por queryKey/coleção, invalidar na mudança de filtros/capabilities/contexto. Não criar intervalos adicionais quando realtime já agenda fallback/reconcile; efeitos locais invalidam consultas por officialRevision, sem repetir mutation.
- [ ] **Step 4:** `node --test src/app/runtime/data/useOperationalDataRuntime.test.js src/infrastructure/realtime/useScopedQuery.test.js`; regressões reais App/session/guards e arquitetura/lint/build.
- [ ] **Step 5:** Commit `feat: reconciliar somente os escopos ativos da operacao`.

### Task 5: migrar consumidores de clientes e financeiro

**Files:** Modify `CustomersWorkspace.jsx`, `Clients.jsx`, `ClientRelationshipPanel.jsx`, surfaces de clientes/financeiro, `FinanceWorkspace.jsx`, `Receivables.jsx`, dashboard e testes; Create `src/domains/customers/application/useCustomerReadModel.js`, `src/domains/finance/application/useFinanceReadModel.js` e testes; Modify seus public index exports, `src/app/surfaces/customers/CustomersSurface.jsx`, `src/app/surfaces/finance/ReceivablesSurface.jsx` e `src/app/surfaces/dashboard/DashboardSurface.jsx`.

**Interfaces:** Composição App passa readApi/realtime/accessContextId/officialRevision/guard e mantém callbacks de comandos atuais. Props opcionais de readModel em componentes preservam embedding legado. UI recebe serverSummary/profile e página; não calcula indicador global usando só página. Seleção é conjunto explícito de IDs elegíveis, persiste entre páginas/filtros quando permitido e revalida2..100 antes de abrir owner existente; detalhe fora da página obtido por ID.

- [ ] **Step 1:** Testar equivalência visual/valores com mais de uma página, recebível antigo, client totals semhistorygrant, seleção2..100 entre páginas, concorrência no pagamento e troca empresa. Verificar ações atuais, foco/Escape/mobile/loading/erro e retry sem duplicar ação.
- [ ] **Step 2:** Rodar suites focadas desses componentes/hooks antes da migração; casos novos RED.
- [ ] **Step 3:** Migrar uma área por vez, renderizar totais autoritativos e páginas. Preservar workflows de pagamento/comanda/refund e permissions da superfície; compatibilidade legada permanece até App migrado.
- [ ] **Step 4:** Suites domínios/workflows e App, arquitetura/lint/build. Nenhuma leitura antiga de arrays globais para indicador total no modo scoped.
- [ ] **Step 5:** Commit `feat: carregar relacionamento e financeiro por consulta ativa`.

### Task 6: mesas, reservas e impressão sem histórico global

**Files:** Modify `src/domains/table-service/application/useTableTabDetail.js`, `useTableReservationDetail.js`, `ui/Comandas.jsx`, `ui/ComandaDetail.jsx`, `ui/Tables.jsx`, `index.js` e respectivos testes, `src/App.jsx`, `usePrintingManager.js`/testes somente onde depender do conjunto global de pedidos; Extend backend para histórico fechado `/api/reads/table-tabs/history` caso o consumidor atual o exija.

**Interfaces:** Snapshot de mesas/comandas fornece todos os pedidos pertinentes à comanda aberta e reservas atuais/futuras autorizadas. Histórico fechado/detalhe sob demanda, nunca preencher total a partir de página. Impressão usa documento/job oficial e leitura por ID quando precisar de pedido ausente; nenhum novo executor/ticker.

- [ ] **Step 1:** Comanda antiga aberta, parcialmente recebida, reserva futura/editada, transferência concorrente, fechamento e consulta histórica; impressão/segunda via com pedido não presente no cache, aba oculta e unknown sem retry.
- [ ] **Step 2:** Rodar testes desses fluxos e adicionar RED antes da integração.
- [ ] **Step 3:** Migrar consumidores remanescentes e preservar efeitos oficiais/autorização. Reports conserva API/owner atuais, novos snapshots só shell. Ativar flag scoped apenas em staging depois de todos os consumidores migrados.
- [ ] **Step 4:** Regressões table/reservations/printing/App e checker de arquitetura; zero falhas. Revisar todos os consumidores de OrderDetail e leituras de orders/movements/tableTabs globais.
- [ ] **Step 5:** Commit `feat: preservar comandas e impressao com dados operacionais limitados`.

### Task 7: orçamento integrado, documentação e entrega

**Files:** Modify gates realtime/budget/fixtures e documentação operacional/runbook/README/AGENTS quando necessário; migrations/gates exatos de preservação atualizados sem afrouxar asserts.

- [ ] **Step 1:** Ampliar gate com superfície por dispositivo, shell/active/history/cliente/financeiro,10k/100k histórico mesmo ativo. Cobrir fallback sem canal, auth/guards/atribuições, perda de aviso, concorrência e isolamento. Comparar mesma fixture antes/depois; incluir custo de páginas/aggregates e índices nas escritas.
- [ ] **Step 2:** Testes de modelo RED para esquecer query/ticker/dimensão; implementar novos counts/projeção e executar gate real. Normal<=80% e degradado<=100% de cada franquia, baseline/CPU/DO/storage reais obrigatórios antes de aprovação.
- [ ] **Step 3:** Arquitetura/lint/build, suíte completa/CI oito shards, dry-runs, clean install/upgrade/preservação e gates D1 existentes. Revisão independente única da branch integrada usando requesting-code-review (gpt-6-astra, contexto limpo); resolver findings materiais com RED/GREEN.
- [ ] **Step 4:** PR vinculado `Refs #75`; CI→staging Actions no SHA exato, bootstrap autenticado e UI cinco clientes/latência/revogações/foco/fallback. Produção continua desativada até apresentar evidência e obter homologação/autorização específica. Atualizar título/corpo do PR para escopo final.
- [ ] **Step 5:** Com aceite: merge→CI/staging master exatos→Deploy production manual; conferir release/versionamento/namespace, monitorar no horário solicitado e publicar redução medida/limitações. Só encerrar issue75 quando seu escopo entregue estiver efetivamente aceito.

## Autorrevisão e execução

Matriz coberta: cozinha/novo pedido tarefa1/4, histórico2/4, clientes/financeiro3/5, mesas/impressão6, relatórios sem owner novo4/6, orçamento/entrega7. Interfaces de snapshot/página/queryKey são compartilhadas; nenhuma tarefa pode tratar página parcial como coleção completa. Novas decisões locais e desvios ficam no ledger antes da execução. Usuário aprovou a matriz e pediu implementação; prosseguir nativamente, sem nova confirmação de método/plano de rotina.
