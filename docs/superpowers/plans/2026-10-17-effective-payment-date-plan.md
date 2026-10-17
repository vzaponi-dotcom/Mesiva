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
| 1–11 | **PENDING** | Não marcar RED/GREEN/PASS antes de executar |

Atualizar a tabela com SHA, comando, saída relevante, status de teste e blockers à medida que as tarefas forem implementadas. Antes de alterar um arquivo, verificar o HEAD atual da branch e compatibilidade com PRs concorrentes.

## Referências de baseline

`AGENTS.md`; `docs/product/BUSINESS_RULES.md`; `docs/architecture/MODULE_MAP.md`; `docs/release-and-migration-runbook.md`; `docs/superpowers/specs/2026-09-25-reporting-center-design.md`; `worker/paymentRepository.js`; `worker/orderSupplementalPayment.js`; `worker/reporting/repository.js`; `worker/readModels/movementReads.js`; `migrations/0026_split_payments.sql`; `migrations/0043_order_settlement_ledger.sql`.
