# Plano de implementação — Data efetiva de recebimentos (TDD)

**Data:** 17/10/2026  
**Status:** planejado; sem homologação, merge ou deploy  
**Branch de trabalho:** `codex/received-date-tdd` (base `master@f44e10da3e523d757dc0a9ceffe575d4331907e0`)  
**Spec:** [design aprovado](../specs/2026-10-17-effective-payment-date-design.md)

## Contrato obrigatório de execução

**Toda mudança de comportamento usa TDD estrito por tarefa:**
1. **RED:** escrever teste comportamental que falhe pelo comportamento ausente, executar e registrar erro esperado, comando, SHA e resultado.
2. **GREEN:** implementar apenas o necessário, executar o teste focal até passar.
3. **REFACTOR:** simplificar sem alterar contratos; repetir teste focal e regressões diretamente afetadas.
4. Final de tarefa: evidências, commit/SHA, arquivos tocados, regressões, próxima tarefa. **Não chamar teste de PASS sem executá-lo ou ter CI vinculado ao SHA exato**.
5. Alterações de schema precisam de testes de instalação limpa e upgrade em D1/SQLite; os testes apenas com mock não são suficientes.

**Restrições globais:** preservar RBAC, empresa, transações, preço/saldo autoritativo, idempotência, efeitos oficiais, sincronização, impressão, histórico e dados antigos. Nenhum deploy de produção ou merge sem autorização explícita. Staging apenas depois de GREEN completo e controle de migrations.

## Sequência de tarefas

### Task 0 — Baseline, especificação e QA
- Criar spec e plano, inventário e matriz de regressões.
- Conferir HEAD, branches/PRs conflitantes e estado de migrações; registrar baseline imutável.
- Registrar risco de `receivedToday` atualmente baseado em criação e de relatório atualmente baseado em `paid_at`.
- **Done:** documentos revisáveis no GitHub e nenhum comportamento alterado.

### Task 1 — Contrato de data no Worker (RED → GREEN)
**Arquivos prováveis:** `worker/paymentValidation.js`, testes focais; `shared/finance.js` somente se reuso justificar.
- RED: omissão retorna data de hoje do negócio; hoje e dias anteriores válidos; amanhã, dia impossível, horário/timestamp, whitespace, null explícito e tipo diferente rejeitados.
- RED: comportamento na virada do dia São Paulo (não UTC), incluindo data em horário de verão histórico para leitura/migração.
- GREEN: pequena função reutilizável de validação/resolução que distingue **campo ausente** de **campo fornecido inválido**.
- REFACTOR e testar `node --test worker/paymentValidation.test.js` e teste focal novo.
- **Done:** função e testes verificáveis, sem alteração de contrato público dos pagamentos existentes.

### Task 2 — Schema e estratégia de backfill (RED → GREEN)
**Arquivos prováveis:** migration seguinte à maior versão existente; `worker/*Migration.test.js`; scripts D1/fixtures.
- RED: schema novo aceita `received_date`; instalação limpa e upgrade preservam recibos legados, valores, alocações, pagamentos e timestamps.
- GREEN: migration aditiva, `received_date` inicialmente nullable; backfill seguro e auditável.
- Estratégia de precedência: `movements.movement_date` se uma única data canônica associada ao recibo; divergência não é normalizada cegamente; sem movimento, converter `paid_at` para `America/Sao_Paulo` por rotina suportada, sem offset UTC fixo. Não concluir migração sem plano executável para todo legado.
- Validar índice por `(business_id,received_date)` conforme `EXPLAIN` e benchmark de D1; custos de escritura/leitura documentados.
- **Done:** clean+upgrade D1 com dados reais **fictícios**, backfill determinístico ou fallback seguro explicitamente comprovado; sem SQL destrutivo nem correção arbitrária de histórico.

### Task 3 — Pagamento avulso e API (RED → GREEN)
**Arquivos:** `worker/index.js`, `worker/paymentRepository.js`, `src/app/workflows/payments/paymentApi.js`, testes.
- RED: data informada persiste no recibo e em todas as alocações de movimento; timestamp técnico permanece agora; sem data usa hoje; data futura gera 400 e zero gravações.
- RED: duas formas de pagamento, políticas concorrentes, ausência de saldo, duplicate e sessão sem capability.
- GREEN: inserir `receivedDate` no endpoint e writer, persistindo dados e eventos atomically.
- **Done:** sem quebra de cliente legado; rollback/isolamento/valor em centavos preservados.

### Task 4 — Comanda e recebimento agrupado por cliente (RED → GREEN)
**Arquivos:** `paymentRepository.js`, `worker/index.js`, `paymentApi.js`, workflows/testes.
- RED: comanda com N pedidos e um recibo preserva a mesma data; lote de 2 e de 100 pedidos, pagamento dividido, soma sem multiplicar.
- RED: mesmo `mutationId` e mesma data retorna mesmo recibo após resultado incerto; data diferente devolve conflito; replay legado sem data não muda com troca de dia.
- GREEN: propagação do atributo, hash de idempotência calculado da intenção literal, sem duplicar vencimentos/movimentos.
- **Done:** todo lote/método pertence a exatamente um recibo datado.

### Task 5 — Checkout com pagamento imediato (RED → GREEN)
**Arquivos:** `worker/orderCheckout.js`, `worker/repositories.js`, form/checkouts, testes.
- RED: `orders.order_date` não contamina `payment_receipts.received_date`; mesmo pedido pode ter data comercial distinta; sem pagamento não gera recibo.
- RED: checkout idempotente não reescreve recibo, não cria outra impressão e não duplica entrada; rejeitar data sem recebimento se for enviado indevidamente.
- GREEN: incluir `receivedDate` na composição e no payload condicional e aplicar a data ao novo recibo.
- **Done:** manter cálculo de preço, agendamentos/reservas e efeitos de impressão existentes.

### Task 6 — Complemento por edição de pedido (RED → GREEN)
**Arquivos:** `worker/orderSupplementalPayment.js`, contrato/API/workflow, testes.
- RED: após editar de R$80 para R$95, novo recibo de R$15 na data escolhida, original intocado; mixed methods; future/invalid/duplicate; replay e hash com data.
- GREEN: ampliar allowlist de payload, derivar a mesma data validada, preservar ledger imutável e guardas de revisão.
- **Done:** nenhum segundo pagamento legado, nenhuma reabertura indevida da comanda e nenhuma duplicação de dinheiro.

### Task 7 — Leitores financeiros e Centro de Relatórios (RED → GREEN)
**Arquivos:** `worker/reporting/repository.js`, `worker/reporting/service.js`, `worker/readModels/movementReads.js`, `shared/cashFlowReadRules.js`, testes.
- RED: um Pix no dia 15 registrado dia 17 entra só no dia 15 em recibos, formas e séries; `Recebido hoje` não o conta no dia 17.
- RED: série de vendas permanece `orders.order_date`; manual e estorno mantêm `movement_date` e política líquida existente; recibos de 100 pedidos não inflacionam.
- GREEN: filtrar/group `received_date` no recibo e `movement_date` nos movimentos; preservar fallback legado até upgrade comprovado.
- REFACTOR: conferir `EXPLAIN QUERY PLAN`, `rows_read`, `rows_written`, regressão de 10k históricos e paginação de recibos divididos.
- **Done:** números reconciliados por dia/empresa em todos os endpoints e desempenho dentro dos limites acordados.

### Task 8 — Projeções, timeline, quitados e exportações (RED → GREEN)
**Arquivos:** `worker/orderPaymentReadModel.js`, `worker/orderReadSql.js`, `worker/readModels/orderHeaders.js`, `worker/reporting/repository.js`, `src/domains/finance/ui/Receivables.jsx`, `src/domains/reporting/ui/detail/ReportingOrderDrawer.jsx`, exports e testes.
- RED: `receivedDate` exposto sem romper `paidAt`, após pagamento compartilhado/complementar; linhas do tempo diferenciam dia efetivo e instante de registro.
- GREEN: mapear/consultar somente campos necessários, evitar N+1 e manter histórico operacional ordenado por eventos técnicos.
- Checar exportações e acrescentar coluna de data financeira **somente quando existir semântica de recebimento**.
- **Done:** usuário vê corretamente por que um Pix recebido em 15/10 foi cadastrado em 17/10.

### Task 9 — Interface única de escolha de data nos cinco fluxos (RED → GREEN)
**Arquivos:** `CheckoutPaymentComposition.jsx`, `OrderPaymentDialog.jsx`, `TableTabPaymentDialog.jsx`, diálogo `client-orders`, respectivos workflows, CSS/tests.
- RED: abre em hoje, aceita anterior, não aceita amanhã, mantém escolha em erro/retentativa, reseta em nova abertura, bloqueia submit inválido.
- GREEN: campo pequeno, acessível e coerente com tema claro/escuro e layout mobile; sem adicionar campo a seletores de pedido.
- Validar o fuso de negócio no default e no `max` (não `toISOString().slice(0,10)`).
- **Done:** composição/submit com data em todos os caminhos e sem duplicação de controles.

### Task 10 — Integração, gates, orçamento e regressões
- Provar reconciliação diária: recibos, movimentos, Dashboard, A Receber, Centro de Relatórios, consulta por método, saldos e métricas comerciais.
- Verificar virada de dia, recibo legado, migration vazia e populada, dois estabelecimentos, permissões, 409, resultado incerto, impressão e reentrada.
- Executar `npm test`, `npm run test:architecture`, `npm run lint`, `npm run build`, migração D1 local, dry-run Worker, scripts de benchmarking e gates de realtime/finance pertinentes.
- Comparar `rows_read`/`rows_written` e requests antes/depois; não chamar teste não executado de PASS.
- **Done:** CI `Validate application` verde no SHA final, sem regressões ou hard blockers.

### Task 11 — Staging e homologação humana
- Deploy apenas em staging pelo workflow oficial, **somente após CI verde do SHA exato**, com migração controlada e sem dados reais de produção.
- Homologar 15 cenários da auditoria: pagamento normal/retroativo, divisão, lote, comanda, complemento, relatórios, timezone, estorno, saldo inicial, histórico, F5/realtime, operador/gestor, desktop/mobile e temas.
- Registrar QA por caso (PASS/FAIL/BLOCKED), screenshot/evidência quando aplicável, SHA, run de staging e impactos de dados.
- Corrigir qualquer falha em novo ciclo RED/GREEN, com nova publicação/QA do SHA corrigido.
- **Done:** aceite registrado. Sem merge automático; produção só após decisão posterior explícita.

## Gates de decisão e cautelas

- **Bloqueio de Task 2/7:** não assumir que `paid_at` UTC pode ser convertido em dia de São Paulo no SQL de migration; demonstrar fallback seguro em D1 com dados antes do horário de verão e histórico irregular.
- **Bloqueio de Task 4/6:** hash/replay precisa respeitar a intenção enviada e a primeira data efetivamente persistida; não introduzir conflito na virada do dia.
- **Bloqueio de Task 7:** sem equivalência de totais e performance de histórico, não avançar para staging.
- **Bloqueio de release:** cada SHA de comportamento alterado exige novo gate/aceite pertinente; migration remota, merge e produção não se inferem da autorização para planejamento/código.

## Diário de execução

| Task | Estado inicial | Evidência |
| --- | --- | --- |
| 0 | **COMPLETE — documentação** | Spec e plano na branch, commit(s) registrados no PR |
| 1 | **COMPLETE / GREEN** | RED: `d4cfb3c`, Validate `39060351817` (shard 8: 3 falhas esperadas, 498 PASS). GREEN: `2f89147`, Validate `39060453305` — SUCCESS (8 shards e validate). |
| 2 | **SCHEMA GREEN / compatibilidade legada pendente** | RED: `96b4681`, Validate `39060880038` (2 falhas esperadas). GREEN: migration `4beeda0` + correção no teste `15bf6dd`, Validate `39061309279` SUCCESS. Fallback para recibos legados sem evidência continua obrigatório na Task 7. |
| 3 | **COMPLETE / GREEN** | RED: `f18d60c`, Validate [39061962227](https://github.com/vzaponi-dotcom/Mesiva/actions/runs/39061962227) — falhas esperadas em API, HTTP e repository. GREEN: `940b075`, Validate [39062122024](https://github.com/vzaponi-dotcom/Mesiva/actions/runs/39062122024) **SUCCESS** (8 shards e job validate). Gravação individual, data opcional para cliente legado, tempo real preservado, autorização e não gravação em data inválida. |
| 4 | **COMPLETE / GREEN** | RED: `4ad5d10`, [Validate 39062633422](https://github.com/vzaponi-dotcom/Mesiva/actions/runs/39062633422) FAILED esperado; comanda, lote, data futura, replay e API. GREEN: implementação `6b2eef0`, ajuste de teste de wiring `ae47021`, [Validate 39062880763](https://github.com/vzaponi-dotcom/Mesiva/actions/runs/39062880763) **SUCCESS**, 8 shards + gates de arquitetura, lint, build, D1 e realtime. |
| 5 | **COMPLETE / GREEN** | RED: testes em `worker/orderCheckout.test.js`, `worker/paidCheckoutSplit.test.js`, `worker/access/projections.test.js`, `src/domains/orders/domain/orderCart.test.js`; [Validate 39063552195](https://github.com/vzaponi-dotcom/Mesiva/actions/runs/39063552195) FAILED esperado. GREEN: checkout `8dc2d5c`, ajuste teste de fixtures `72c70a9`, [Validate 39063738449](https://github.com/vzaponi-dotcom/Mesiva/actions/runs/39063738449) **SUCCESS** (8 shards e validate). |
| 6 | **COMPLETE / GREEN** | RED: `a4a134b`, [39064428928](https://github.com/vzaponi-dotcom/Mesiva/actions/runs/39064428928) **FAILED esperado** (novos testes do complemento); GREEN: `8bdb19e`, [39064541761](https://github.com/vzaponi-dotcom/Mesiva/actions/runs/39064541761) **SUCCESS** (8 shards + arquitetura, lint, build, D1 e realtime). |
| 7 | **GREEN — funcional / métricas D1 reais pendentes Task 10** | RED: `659ef595`, Validate [39065478005](https://github.com/vzaponi-dotcom/Mesiva/actions/runs/39065478005) **FAILED esperado** após corrigir fixtures de teste; GREEN: `63f3d6f`, Validate [39065630406](https://github.com/vzaponi-dotcom/Mesiva/actions/runs/39065630406) **SUCCESS** (8 shards, arquitetura, lint, build, migrations locais D1, realtime). Teste 10k histórico/EXPLAIN indexável. |
| 8 | **COMPLETE / GREEN** | RED: `b3f5d7c`, [39066249654](https://github.com/vzaponi-dotcom/Mesiva/actions/runs/39066249654) FAILED esperado (nova coluna e datas na UI). GREEN: `bf386118`, [39066542428](https://github.com/vzaponi-dotcom/Mesiva/actions/runs/39066542428) SUCCESS — 8 shards + arquitetura, lint, build, D1 local e runtime. |
| 9–11 | **PENDING** | Não marcar RED/GREEN/PASS antes de executar |

Atualizar a tabela com SHA, comando, saída relevante, status de teste e blockers à medida que as tarefas forem implementadas.

**Task 8:** Leitores `orderReadSql.js`, `repositories.js`, `orderHeaders.js` e `orderPaymentReadModel.js` expõem `receivedDate` do recibo inicial com lookup escopado via índice e fallback histórico `getBusinessDate(paidAt)`, preservando `paidAt` técnico. Em `ReportingOrderDrawer`, cada recibo inicial/complementar aparece com sua própria `received_date` nas alocações, agrupado pelo ID do recibo e ordenado pelo instante de registro: a data financeira não reordena eventos operacionais. Os quitados em `Receivables.jsx` e `ReceivableDetail.jsx` mostram data efetiva e, quando divergente, o horário técnico de registro. Exportações aceitam a coluna `payment_received_dates` **Data(s) do recebimento**, preenchida com datas distintas dos recibos (inclusive suplementos) sem contaminar `order_date`; a subconsulta correlacionada `payment_receipts_dates_json` é solicitada apenas em `listDetail` para exportações que incluem a coluna, sem consulta nova por pedido no frontend ou nas listas usuais, e com fallback IANA para legados. Testes: `worker/orderPaymentReadModel.test.js` (lista/header/detail, NULL histórico, suplementar), `worker/reporting/repository.test.js` (original+complemento, isolamento por empresa, datas distintas e custo de consulta limitado ao export), `src/domains/reporting/ui/detail/ReportingOrderDrawer.render.test.js` (duas datas, momento do registro e ordem técnica), `worker/reporting/exportModel.test.js` (coluna financeira versus comercial, não pagos). Após RED inicial, fixtures foram corrigidas para escopo RBAC, `actor_name` obrigatório e ordenação determinística de alocações, **sem alterar regras de produção**. RED: `b3f5d7c`, [39066249654](https://github.com/vzaponi-dotcom/Mesiva/actions/runs/39066249654) FAILED esperado; GREEN: `bf386118`, [39066542428](https://github.com/vzaponi-dotcom/Mesiva/actions/runs/39066542428) SUCCESS (8/8 e todos os gates). Sem alteração de schema, endpoints, frequência de requests, `paid_at` ou valor de pagamentos; novo lookup escopado do recibo nas projeções e subconsulta adicional **somente nas exportações financeiras**, exigindo medição comparativa D1 real (`rows_read`/`rows_written`) e estimativa de custo na Task 10. Recibos históricos ambíguos continuam exigindo auditoria/backfill na Task 2 antes de staging. Nenhuma migration remota, publicação, merge ou produção.

**Task 7:** Centro de Relatórios passou a selecionar recibos pela data financeira `payment_receipts.received_date`, sem alterar filtros comerciais por `orders.order_date`; consultas de recibos/forma usam CTE `UNION ALL` com ramo por índice parcial `(business_id,received_date,id)` e ramo para recibos legados com `received_date IS NULL` filtrado por `paid_at` e limites UTC determinados com `America/Sao_Paulo` (inclusive horário de verão histórico). Esse fallback **somente lê** o legado e não corrige recibos ambíguos; backfill/auditoria de divergências permanece pendente no fechamento da Task 2 e antes do cutover. `worker/reporting/service.js` agrupa `receivedSeries` pela data efetiva, com fallback compatível em linhas históricas NULL. `readReceivedToday` em `worker/readModels/movementReads.js` deixou de filtrar `created_at` e varrer linhas legadas, fazendo uma consulta indexável por `movement_date` e preservando somente entradas `order-payment` menos saídas `order-refund`; `order-edit-refund`, movimentos manuais e exclusões não entram. `shared/cashFlowReadRules.js` mantém a mesma semântica para consumidores do frontend. Testes RED incluem data de recebimento 15/10 registrada em 17/10, forma Pix/Dinheiro dividida, empresa distinta, 100 pedidos sob um recibo, fallback 2018 no DST, período de estorno, regra pura de hoje e Worker, além de 10.000 recibos históricos com `EXPLAIN QUERY PLAN` comprovando índices existentes sem `SCAN payment_receipts`. RED [39065478005](https://github.com/vzaponi-dotcom/Mesiva/actions/runs/39065478005) (**FAILED esperado**, data financeira ignorada); GREEN [39065630406](https://github.com/vzaponi-dotcom/Mesiva/actions/runs/39065630406) (**SUCCESS**, 8 shards e gates). A mudança não altera schema, nem quantidade de movimentos/pagamentos; `readReceivedToday` reduz duas estratégias de leitura a uma consulta; os relatórios preservam quantidade de chamadas, com subconsultas periodizadas por dois índices. **Não foram medidos valores reais comparáveis de `rows_read` / `rows_written` para esses relatórios no ambiente Cloudflare nem estimativa mensal de custo; exigência permanece na Task 10, antes de staging.** Nenhum deploy ou migration remota, merge ou produção.

**Task 6:** `worker/orderSupplementalPayment.js` passa a aceitar `receivedDate` opcional no payload complementar e validá-lo com `resolveReceivedDate` antes de criar registros. Preserva o contrato legado quando omitido: o hash de `mutationId` **não** inclui o dia calculado, mantendo replay após meia-noite. Quando explicitamente enviado, o dia participa do hash; a mesma mutação com data divergente resulta em 409, sem novos lançamentos. Grava `payment_receipts.received_date` e o dia correspondente em todas as entradas `movements.movement_date` da cobrança adicional; `paid_at`/`created_at` permanecem factuais. O replay retorna `receipt.receivedDate` persistido, sem alterar recibo/pagamento original, criar segundo `payments`, reabrir pedido/comanda ou duplicar efeitos. O endpoint existente recebe o payload intacto; seletor de UI é Task 9. `worker/orderSupplementalPayment.test.js`: data retroativa, Pix/dinheiro dividido, imutabilidade original, erro 400 com `receivedDate` inválido/futuro, default de São Paulo, replay explícito com conflito em data diferente e replay legado sem data após virada do dia/resposta incerta. RED [39064428928](https://github.com/vzaponi-dotcom/Mesiva/actions/runs/39064428928) (**FAILED esperado**, grupo 4/8); GREEN [39064541761](https://github.com/vzaponi-dotcom/Mesiva/actions/runs/39064541761) (**SUCCESS**, 8 shards, arquitetura, lint, build, D1 local, runtime). Mudança de custo esperada: zero queries novas, mesma quantidade de inserts/movimentos, uma coluna adicional na escrita de recibo e leitura de replay. **Métricas comparativas reais de D1/volume seguem Task 10; não foram medidas nesta task.** Nenhum deploy/migration remota/merge.

**Task 5:** checkout de pagamento imediato propagou `receivedDate` sem alterar `orders.order_date`, `created_at` operacional ou impressão. Em `worker/orderCheckout.js`, `validateCheckoutInput` valida datas explícitas e rejeita o campo em pedidos sem pagamento; omissão permanece omitida para replay. Em `worker/repositories.js`, validação também ocorre no writer antes da alocação da sequência; recibos pagos recebem `received_date` e seus movimentos o mesmo `movement_date`, enquanto `paid_at`/`created_at` dos pagamentos permanecem no momento do registro. `src/domains/orders/domain/orderCart.js` aceita data opcional no builder de payload, a ser conectada ao seletor de UI na Task 9. Testes de checkout/Pix split, tentativa inválida sem novos efeitos, HTTP e idempotência com único print job. RED [39063552195](https://github.com/vzaponi-dotcom/Mesiva/actions/runs/39063552195), GREEN [39063738449](https://github.com/vzaponi-dotcom/Mesiva/actions/runs/39063738449). O primeiro GREEN provisório detectou um teste com contagem absoluta de prints (fixture já possuía impressões); o teste passou a exigir nenhum efeito **novo** em vez de zero absoluto, sem alteração adicional de comportamento. Nenhuma migration remota, merge ou deploy.

**Task 4:** `worker/paymentRepository.js` valida `receivedDate` uma vez por recibo de cliente/comanda, persiste o dia em `payment_receipts.received_date` e em todos os `movements.movement_date` do recibo. No lote, hash de `mutationId` inclui somente a data **explicitamente enviada**, preservando replay legado sem data mesmo após meia-noite; data divergente gera `CLIENT_RECEIVABLES_PAYMENT_CONFLICT`, sem segunda escrita. Comanda fechada mantém rejeição segura a nova tentativa, sem criar pagamento. `worker/index.js` e `paymentApi.js` transportam campo opcional com autorização original. Testes: `worker/clientReceivablesPayment.test.js`, `worker/tableTabPayment.test.js`, `worker/access/projections.test.js`, `src/app/workflows/payments/paymentApi.test.js`; `src/tableTabsAppWiring.test.js` passou a verificar o contrato HTTP real em lugar da assinatura textual frágil. RED [39062633422](https://github.com/vzaponi-dotcom/Mesiva/actions/runs/39062633422); GREEN [39062880763](https://github.com/vzaponi-dotcom/Mesiva/actions/runs/39062880763). Nenhum deploy ou migration remota. Mudança de interface fica para Task 9.

**Task 3:** `worker/paymentRepository.js` aplica `resolveReceivedDate` no fluxo de pedido avulso, grava `received_date` no recibo e o mesmo dia em todos os movimentos, mantém `paid_at`/`created_at` como timestamps factuais e expõe `receivedDate` na resposta do recibo. `worker/index.js` e `src/app/workflows/payments/paymentApi.js` aceitam `receivedDate` opcional; sem data, a regra atual continua válida. Regressões: `worker/paymentRepository.test.js`, `worker/access/projections.test.js`, `src/app/workflows/payments/paymentApi.test.js` — [RED 39061962227](https://github.com/vzaponi-dotcom/Mesiva/actions/runs/39061962227), [GREEN 39062122024](https://github.com/vzaponi-dotcom/Mesiva/actions/runs/39062122024). **Sem mudança de tela nesta etapa**: seleção visual fica para Task 9. Nenhuma escrita D1 remota.

**Task 2:** `migrations/0052_effective_receipt_date.sql` adiciona coluna nullable, backfill somente com `movement_date` unânime e índice parcial de recibos; `worker/effectiveReceiptDateMigration.test.js` prova clean/upgrade e preservação das linhas. [CI GREEN 39061309279](https://github.com/vzaponi-dotcom/Mesiva/actions/runs/39061309279). Não houve migração remota. Tratamento timezone para legado sem movimento, custo D1 e leitores de compatibilidade permanecem pendentes, não declarar Task 2 inteiramente fechada antes dessas evidências.

**Task 1:** `worker/receivedDateValidation.test.js` cobre default, passado, futuro, datas inválidas e virada do dia em São Paulo. `resolveReceivedDate` foi implementado em `worker/paymentValidation.js`. CI GREEN: [run 39060453305](https://github.com/vzaponi-dotcom/Mesiva/actions/runs/39060453305), finalizado com sucesso. Escritas de pagamentos ainda não utilizam esse campo; nenhuma migration foi aplicada remotamente. Antes de alterar um arquivo, verificar o HEAD atual da branch e compatibilidade com PRs concorrentes.

## Referências de baseline

`AGENTS.md`; `docs/product/BUSINESS_RULES.md`; `docs/architecture/MODULE_MAP.md`; `docs/release-and-migration-runbook.md`; `docs/superpowers/specs/2026-09-25-reporting-center-design.md`; `worker/paymentRepository.js`; `worker/orderSupplementalPayment.js`; `worker/reporting/repository.js`; `worker/readModels/movementReads.js`; `migrations/0026_split_payments.sql`; `migrations/0043_order_settlement_ledger.sql`.
