# Leituras limitadas e orçamento D1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Buscar pedidos por IDs e itens da TV por candidatos ativos, demonstrando leituras limitadas com histórico volumoso antes de introduzir WebSocket.

**Architecture:** API HTTP aditiva e otimização dos repositórios existentes, usando os contratos de projeção/auditoria atuais. Índices novos preservam schema e dados existentes; um benchmark no runtime D1 real torna o orçamento verificável no CI.

**Tech Stack:** JavaScript ESM, Node.js 22, Worker/D1, Wrangler fixado pelos scripts do projeto, Miniflare associado à versão fixada, node:test.

**Spec:** [Desenho de eventos e orçamento](../specs/2026-10-14-realtime-budget-design.md), seções de leitura por IDs, TV, orçamento e validação. [Roteiro completo](2026-10-14-mesiva-scale-roadmap.md).

## Global Constraints

- Não haverá journal D1 de eventos nem migração de históricos.
- Não se removem migrations aplicadas, históricos, auditoria, filas ou dados.
- A leitura HTTP preserva capabilities, contexto, projeções, atribuições e guards de sessão.
- Respeitar o máximo D1 de 100 parâmetros: no máximo 99 IDs quando há um parâmetro de empresa; ajustar para menos se houver outros bindings.
- Desenvolvimento/staging usam dados fictícios; não copiar produção ou escrever dados de ensaio nela.
- Esta entrega não remove polls nem altera tickers de impressão, confirmação física, elegibilidade financeira ou retenção.
- Migrations/deploy remotos somente pelo GitHub Actions, respeitando SHA exato e runbook.

## Review Focus

- IDs duplicados, de outra empresa e inexistentes: respostas não vazam dados nem duplicam pedidos — tarefas 1/2.
- Pedido cancelado, finalizado, pago ou com reembolso: leitura pontual preserva todos os campos e atribuições — tarefas 1/2.
- Status desconhecido/NULL e pedido ocultado da TV: manter exatamente a semântica atual — tarefa 3.
- Sessão/role/contexto mudando durante leitura: rejeitar a resposta pelas proteções atuais — tarefa 2.
- Histórico cresce mantendo candidatos constantes: leituras pontuais/TV não crescem proporcionalmente — tarefa 4.

---

### Task 1: repositório de pedidos por IDs

**Files:** Modify `worker/orderReadRepository.js`; Create `worker/orderReadByIds.test.js`, `worker/test-support/operationalReadFixture.js`.

**Interfaces:** Consumes `ORDER_SELECT`, `ORDER_ITEM_SELECT`, `mapOrderRow`, `mapOrderItemRow`; produces `listOrdersByIds(db, businessId, ids) -> Promise<Order[]>`. IDs vazios retornam `[]` sem preparar SQL; IDs únicos são consultados em lotes compatíveis com bindings. Ordenar `createdAt DESC, id DESC` para empates sem depender da ordem do IN.

- [ ] **Step 1:** Criar fixture determinístico `seedOperationalReadFixture(db,{businessId,historicalOrders,activeOrders,itemsPerOrder}) -> {activeIds,historicalIds}` sobre o schema migrado atual. Criar testes `empty_ids_do_not_query`, `selected_orders_keep_complete_contract` e `foreign_ids_are_not_returned` com assertions `assert.equal(preparedCalls,0)`, `assert.deepEqual(selected, allOrders.filter(o=>selectedIds.includes(o.id)))` após ordenar ambos, e `assert.ok(result.every(o=>ownIds.includes(o.id)))`. Incluir duplicatas, inexistentes, cancelamento, pagamento, reembolso, comanda/reserva e igualdade de datas.
- [ ] **Step 2:** Executar `node --test worker/orderReadByIds.test.js`; esperar falha pela ausência da função, não por erro de fixture/schema.
- [ ] **Step 3:** Implementar a interface no repositório, com queries indexáveis por `(business_id,id)` e `(business_id,order_id)`; reutilizar mapeamento atual. Não filtrar estados finais na leitura por ID.
- [ ] **Step 4:** Executar `node --test worker/orderReadByIds.test.js worker/orderReadRepository.test.js`; esperar zero falhas e equivalência dos contratos.
- [ ] **Step 5:** Commit `feat: ler pedidos completos somente pelos IDs solicitados` com esses arquivos.

### Task 2: endpoint e adaptador HTTP aditivos

**Files:** Modify `worker/index.js`, `src/domains/orders/infrastructure/ordersApi.js`; Create `worker/orderReadByIdsHttp.test.js`; Modify `src/domains/orders/infrastructure/ordersApi.test.js`.

**Interfaces:** Produces `GET /api/orders/by-ids?ids=<JSON array codificado>` -> `{orders:Order[]}` e `ordersApi.getOrdersByIds(ids) -> Promise<{orders:Order[]}>`. Máximo 99 IDs únicos por request, strings não vazias com até 200 caracteres; malformed/limite excedido retorna 400 `INVALID_ORDER_IDS`. A rota aceita `orders.view` ou `orders.history`, como a lista atual. Não recebe businessId.

- [ ] **Step 1:** Testes `by_ids_projects_and_attributes_like_order_list`, `by_ids_denies_foreign_context`, `by_ids_rejects_100_unique_ids` e `context_change_during_read_is_rejected`: comparar projeções com `/api/orders`, confirmar actor oficial permitido, 400 para payload inválido e 409/401/403 correspondentes às condições atuais de sessão. Testar adapter com encoding e preservação dos headers de contexto do cliente HTTP canônico.
- [ ] **Step 2:** Executar `node --test worker/orderReadByIdsHttp.test.js src/domains/orders/infrastructure/ordersApi.test.js`; esperar falha por rota/método ausente.
- [ ] **Step 3:** Adicionar rota antes dos matches de pedido específico, usando `listOrdersByIds`, `projectOrderList` e pipeline atual de `attachOperationalAttributions`/validação final. Adicionar método ao adapter exportado pelo index do domínio já existente.
- [ ] **Step 4:** Reexecutar os testes; esperar zero falhas. Confirmar que a rota legada `/api/orders` permanece idêntica para clientes antigos.
- [ ] **Step 5:** Commit `feat: expor leitura autenticada de pedidos por IDs`.

### Task 3: TV lê candidatos ativos antes dos itens

**Files:** Modify `worker/kitchenTvReadRepository.js`, `worker/kitchenTvReadRepository.test.js`; Create `migrations/0043_operational_order_read_indexes.sql` e `worker/operationalOrderReadMigration.test.js`. Antes de executar, conferir o próximo número livre na master; se 0043 tiver sido ocupado, criar nova migration com o próximo número sem alterar a aplicada. Conferir consumidores de schema em `scripts/infra/print-context-snapshot.mjs` e `worker/settingsMigration.test.js`; ajustar somente os nomes/SQL exatos adicionados quando o gate exigir.

**Interfaces:** Preserves `loadKitchenTvState(db,businessId) -> {timing,control,orders}`. Adicionar `orders_business_active_created_idx` em `(business_id,created_at,id)` com predicate literal igual ao filtro ativo atual e `order_items_business_order_created_idx` em `(business_id,order_id,created_at,id)`. A ocultação continua em NOT EXISTS por empresa/pedido; não entra no predicate do índice parcial.

- [ ] **Step 1:** Testar `tv_reads_only_items_of_active_candidates` no SQLite com histórico fictício e capturar planos; provar mesmos pedidos/itens/ordem com estados finais, agendados, ocultados, status desconhecido e NULL. Testar upgrade preservando histórico e índices anteriores, com somente os dois índices novos.
- [ ] **Step 2:** Executar `node --test worker/kitchenTvReadRepository.test.js worker/operationalOrderReadMigration.test.js`; esperar falha no orçamento/plano ou índices ausentes, com equivalência funcional existente verde.
- [ ] **Step 3:** Criar migration aditiva. Reescrever seleção de itens iniciando nos pedidos ativos; fixar ordem de join somente se EXPLAIN no runtime real demonstrar necessidade. Preservar `NOT IN`/NULL, timestamps, ocultações e ordenação originais.
- [ ] **Step 4:** Reexecutar os testes e `node --test worker/kitchenTvSecurityRegression.test.js`; esperar zero falhas. O gate real da tarefa 4 decide se o otimizador D1 também escolheu o índice certo.
- [ ] **Step 5:** Commit `perf: limitar consultas da TV aos pedidos ativos`.

### Task 4: orçamento reproduzível no D1 real

**Files:** Create `scripts/infra/operational-read-d1-benchmark.mjs`, `scripts/infra/operational-read-d1-benchmark.test.js`; Modify `.github/workflows/validate.yml`, `docs/operations/printing-d1-read-incident.md`; referência de implementação `scripts/infra/print-recovery-d1-benchmark.mjs`, sem copiar/remover seu gate.

**Interfaces:** Script emite JSON `{schemaVersion,fixture,baseline,after,queryPlans,passed}` com rows_read/rows_written e candidatos por caso; execução não remota. Exportar `assertOperationalReadBudget(report)` no mesmo script com CLI protegida contra execução ao importar. Capturar SQL dos repositórios reais, não reproduzir a implementação em SQL manual de teste.

- [ ] **Step 1:** Criar testes do verificador que falhem para scan histórico, escrita em seleção e lote sem tenant. Casos positivos: leitura de um pedido com cinco itens <=200 rows_read; TV com 20 pedidos ativos/100 itens <=1.000; candidatos da TV vazia <=100, custo fixo de schema <=baseline vazia+16 e total TV <=1.000; crescimento de 1.000 para 10.000 históricos com candidatos iguais aumenta leitura no máximo `max(16, ceil(smaller*0.10))`. Esses tetos são critérios de implementação, não resultados já medidos.
- [ ] **Step 2:** Executar `node --test scripts/infra/operational-read-d1-benchmark.test.js`; esperar ausência do verificador.
- [ ] **Step 3:** Implementar fixtures/medição no Miniflare/D1 vinculado ao Wrangler fixado. Comparar TV antiga da master base e consultas atuais no mesmo dataset; registrar scan/plano, resultados completos, zero escritas em SELECT e número não vazio de consultas capturadas. Se o orçamento falhar, corrigir consulta/índice e repetir. Não relaxar o teto para aceitar um scan.
- [ ] **Step 4:** Executar testes do verificador e `node scripts/infra/operational-read-d1-benchmark.mjs`; esperar JSON `passed:true`. Integrar o script após migrations locais no validate, preservando todos os gates existentes. Documentar apenas evidência e operação reutilizável, sem afirmar redução global da fatura.
- [ ] **Step 5:** Commit `test: verificar orçamento de leituras operacionais no D1`.

### Task 5: revisão e publicação independente

**Files:** Modify `.github/workflows/deploy-staging.yml`, `docs/release-and-migration-runbook.md` apenas se necessários; registrar evidências no PR.

- [ ] **Step 1:** Executar `npm run test:architecture`, `npm run lint`, `npm run build`, dry-runs com Wrangler 4.128.0 para staging/produção, migrations locais em persistência isolada e os gates Spec B, printing recovery, operational read, operation profile e company management. Rodar testes pertinentes localmente; exigir todos os oito shards de `npm test` verdes no CI. Não interromper serviços/persistências existentes.
- [ ] **Step 2:** Fazer uma revisão independente da branch inteira e resolver achados. Criar PR com leituras medidas e riscos, anexá-lo ao chat. Incluir somente a branch exata de entrega na elegibilidade manual de staging, preservando os gates.
- [ ] **Step 3:** Publicar staging pelo Actions para o SHA exato; validar leitura/TV/contratos com dados fictícios e apresentar evidência para homologação humana.
- [ ] **Step 4:** Após aceite e autorização pertinentes, merge, master CI/staging e Deploy production explícito, sem atalhos locais. Preservar bookmark D1 automático. Verificar versão ativa, índices e leituras de queries seguras; acompanhar métricas durante uso real somente no período autorizado.
- [ ] **Step 5:** Registrar resultado, SHA/version, redução por consulta e limites da medição. Revisar README/AGENTS/docs da área; atualizar só instruções afetadas. Depois iniciar a entrega 2 em branch atualizada, preservando evidências ignoradas.
