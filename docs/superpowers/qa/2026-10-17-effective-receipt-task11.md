# Task 11 — Plano executável de QA e repasse ao Codex

**Data:** 17/10/2026
**PR:** #120 — https://github.com/vzaponi-dotcom/Mesiva/pull/120
**Branch:** codex/received-date-tdd
**Estado:** REVISÃO E QA LOCAL EXECUTADOS: 13 PASS / 2 BLOCKED; TASK 11 NÃO HOMOLOGADA
**Baseline funcional Task 10:** c5e28d820f923eaca6f454e7d28ce97a05140100 (Validate #39069565814). **Task 11 gate de preparação GREEN:** 26a418acc0dbfdcac4eabb596c9fcdc202d32080 — [Validate application #39071153674](https://github.com/vzaponi-dotcom/Mesiva/actions/runs/39071153674) **SUCCESS** (8 shards + gates). Histórico de preparação; resultados posteriores estão no relatório da rodada abaixo.
**Deploy staging:** NOT EXECUTED. **Migration remota:** NOT EXECUTED. **Merge/produção:** NOT AUTHORIZED.

**Rodada Codex de 17/10:** [relatório e evidências](2026-10-17-effective-receipt-task11-review.md). Correções do pré-flight via RED → GREEN em `d94f1d10` e `ef1d9ae7`; 4.116 testes PASS e [CI do código final SUCCESS](https://github.com/vzaponi-dotcom/Mesiva/actions/runs/39073109702). Após reinício documentado dos servidores, os cinco caminhos foram executados no navegador. Matriz local: **13 PASS / 0 FAIL remanescente / 2 BLOCKED / 0 PENDING**, com limites automatizados discriminados no relatório. Q11-12: auditoria histórica/restore/orçamento do destino; Q11-15: impressão física. Staging e aceite integral permanecem bloqueados.

**Fechamento em 18/10:** código e evidências publicados na PR. Pacote `36e47798` com [CI SUCCESS #39092051011](https://github.com/vzaponi-dotcom/Mesiva/actions/runs/39092051011), oito shards e `validate`; 20 hashes de artefatos conferidos contra o Git. Atualizações posteriores de documentação mantêm o código executável; CI anterior não dispensa validar o SHA exato de eventual publicação.

## Objetivo e responsabilidade

A Task 11 inclui publicação controlada em staging e aceite humano. Nesta entrega, preparar o fluxo seguro e todas as evidências a preencher; a auditoria completa de código e homologação de navegador ficam delegadas ao Codex pelo usuário. **Nenhum PASS manual é permitido sem execução real.** O CI só comprova os testes automatizados no SHA executado, não a homologação humana.

O escopo é **Data do recebimento** nos cinco caminhos (checkout pago, pedido avulso, comanda, lote por cliente, complemento pós-edição), registros e leituras de recibos, movimentos, Financeiro, Dashboard, A Receber e Centro de Relatórios. Saldo inicial, estorno, troca de sessão, impressão, realtime e pedidos sem pagamento são regressões.

## 1. Pré-flight obrigatório, antes de qualquer escrita remota

1. Conferir branch, SHA exato, worktree limpo ou mudanças próprias, PR #120 ainda aberta, configuração multiempresa, ambientes D1/R2, migration 0052, e o resultado **SUCCESS** do Validate application no mesmo SHA.
2. **Staging usa exclusivamente dados fictícios.** Não copiar produção para staging; não usar clientes, valores, endereços, tokens, e-mails pessoais nem backup real nos testes.
3. O workflow Deploy staging, para esta branch, fica habilitado **apenas por workflow_dispatch**, nunca por push. Antes de Ensure staging R2 bucket e Apply staging migrations, executa scripts/infra/effective-receipt-staging-preflight.mjs: auditoria remota read-only, detecta schema pré ou pós-0052 sem consultar coluna ausente. Havendo conflito de datas/valores, dia inválido ou mismatch entre received_date/movimento, falha **antes de qualquer escrita remota**. Não contornar esse bloqueio por edição manual do workflow.
4. Guardar resumo agregado do pré-flight (quantidades por classificação, presença de 0052, execução, SHA). A aprovação automática da auditoria não é aceite de dados históricos: recibos **sem movimentos** ou com consenso anterior ainda exigem revisão do plano de transição/fallback de São Paulo por operador autorizado. Caso o procedimento exija esclarecimento de recibos contraditórios, marcar BLOCKED até decisão humana; não backfillar forçadamente.
   O calendário precisa ser válido; para recibos que dependem de fallback, `paid_at` deve estar no formato UTC canônico gerado por `toISOString()`, com hora 00–23. Offsets/formato SQL exigem revisão antes do cutover: os leitores filtram timestamps textualmente por limites UTC. Não normalizar esses dados automaticamente.
5. Conferir lista de migrations pendentes e restauração D1 Time Travel/bookmark ou equivalente aprovado **antes** de aplicar a migration em staging. O workflow atual de staging não registra automaticamente um bookmark específico desta feature: Codex precisa verificar o método disponível e registrar a estratégia de restore previamente. Sem restauração verificável, **não acionar o deploy**.
6. Executar Deploy staging via GitHub Actions manualmente na branch e SHA exatos, somente após liberação dos itens anteriores. Registrar workflow run, environment, release.json, confirmação multi_company, autenticação real com conta fictícia, bootstrap 200, deeplinks e dados preservados. Se o workflow estiver impedido por permissionamento/conta, registrar BLOCKED, não substituí-lo por deploy local improvisado.
7. Se a revisão optar por **somente QA local nesta rodada**, registrar STAGING BLOCKED/NOT EXECUTED; não declarar Task 11 COMPLETE.

### Critérios mínimos de dados e queries

- Somente uma financial date por recibo, inclusive split e lotes; entradas order-payment no mesmo movement_date.
- Datas recebidas aceitam hoje/passado e não futuro; horário técnico paid_at/created_at original.
- Relatórios financeiros pelo received_date e movement_date; métricas de venda comercial por order_date. Recibo compartilhado nunca multiplicado.
- Permissões payments.receive + superfície, isolamento de empresa, conflitos 409/idempotência e reentrada.
- Fallback de NULL conforme America/Sao_Paulo histórico, inclusive DST. Sem assumir UTC-3 fixo.
- rows_read/rows_written e requests por rota na base fictícia de staging; comparar com baseline sintética documentada na QA Task 10, sem extrapolar custo para produção. Conferir cenário de NULL concentrados no período filtrado (não medido no gate da Task 10).

## 2. Preparar a homologação local (Codex)

Usar Node 22 e o README do SHA. Validar portas antes de iniciar novas instâncias. O ambiente local completo usa Worker/API em 127.0.0.1:8787 e Vite em 127.0.0.1:4173, com o mesmo diretório de persistência para as migrations e o Worker; não apagar o banco de testes existente. Nenhuma senha padrão no repositório: usar **conta fictícia**, previamente provisionada. Não reutilizar credenciais ou conteúdo de produção.

Repetir a validação no SHA final: npm test, npm run test:architecture, npm run lint, npm run build, npm run d1:migrate:local, dry-run Worker e os gates de migração/D1/workerd/realtime. Registrar comandos executados, contagem real de testes e evidência. Para navegador, usar ambiente local e, **se necessário e autorizado**, navegador remoto do Codex. Não confundir HTTP 200 do shell SPA com autenticação e bootstrap de empresa efetivos.

## 3. Matriz obrigatória — 15 casos (13 PASS locais / 2 BLOCKED; evidências no relatório)

Cada caso deve registrar PASS, FAIL, BLOCKED ou PENDING; ambiente (local/staging), navegador/dispositivo/tema, business_id fictício (sem dados pessoais), pedidos/recibos fictícios, URL/captura ou referência ao log/trace, SQL ou evento de conferência quando cabível e SHA/release.

| ID | Cenário e passos | Critério objetivo de PASS | Estado |
| --- | --- | --- | --- |
| Q11-01 | Checkout: novo pedido pago com data padrão de hoje | Um campo único, default hoje SP, recibo e entradas no mesmo dia, sem modificar data comercial nem paid_at | PASS |
| Q11-02 | Checkout retroativo com duas formas (Pix e Dinheiro) | Data anterior válida, total em centavos confere, 1 recibo/2 alocações/2 entradas, zero duplicidades | PASS |
| Q11-03 | Recebimento avulso via Cozinha/Histórico/A Receber | Mesmo seletor no passo de confirmar; pedido deixa pendentes, Financeiro reflete data escolhida; nenhuma data no seletor prévio de pedidos | PASS |
| Q11-04 | Comanda de mesa: várias contas/pedidos e split | Uma data do recibo, quitação integral e encerramento oficial da comanda; não multiplica dinheiro por número de pedidos | PASS |
| Q11-05 | Cliente: recebimento agrupado de 2 pedidos e limite de 100 | Mesmo recibo/data/total autoritativo, método dividido soma exata, lote inválido não grava; sem campo no seletor | PASS |
| Q11-06 | Edição com saldo complementar (modal do pedido e pós-salvamento) | Data independente da original, recibo complementar novo, saldos e histórico corretos, origem preservada | PASS |
| Q11-07 | Validação e reabertura: ontem, hoje, amanhã, 30/02, vazio, data/hora | Hoje/ontem aceitos, futuro/impossível/vazio bloqueados na UI e Worker; retry mantém escolha; reabrir reseta ao hoje de SP | PASS |
| Q11-08 | Virada UTC/São Paulo e legado 2018 com horário de verão | Data da operação usa America/Sao_Paulo mesmo próximo da meia-noite UTC; NULL legado tem fallback histórico correto | PASS |
| Q11-09 | Dashboard, A Receber e Movimentações por data | Entradas brutas e líquido recebido hoje separados corretamente de estornos, sem somar movimentos manuais indevidos | PASS |
| Q11-10 | Relatórios: visão geral, vendas, séries, método e exportação | Gráficos/mix e CSV/PDF refletem data financeira; order_date não altera; cada recibo complementar aparece no detalhe | PASS |
| Q11-11 | Estorno e saldo inicial | Estorno continua saída real em sua movement_date, saldo inicial preservado, sem duplicação/retroação involuntária | PASS |
| Q11-12 | Migration 0052 e histórico populado com duas empresas | Clean+upgrade, valores/timestamps/FKs mantidos; consenso migra; conflito sem correção arbitrária; uso de índice e custo D1 verificados | BLOCKED |
| Q11-13 | RBAC e isolamento multiempresa: operador/gestor, alternância de empresa | Usuário sem payments.receive não grava; 403/erros com feedback; dados de empresa A ausentes na B, inclusive histórico e relatórios | PASS |
| Q11-14 | Resiliência: timeout/retry, mutationId, 409, F5, 2 sessões, WebSocket/fallback | Mesmo intento não duplica recibos/movimentos; 409 seguro; refresh e sincronização consistente; sem sessão antiga aplicar retorno tardio | PASS |
| Q11-15 | Interface desktop/mobile, tema claro/escuro, teclado, impressão e fechamento | Campo visível e acessível sem overflow; foco/labels/erro; impressão e fila não duplicadas; cancelar/não receber mantém estado anterior | BLOCKED |

### Evidências a anexar por caso

Formato: ID | resultado | data/hora SP | SHA | contexto fictício | PASS esperado x observado | URL/captura/trace | queries/rows_read/rows_written se relevante | defeito/issue/commit de correção | reteste. Antes da execução, iniciar em PENDING. Nesta rodada, os resultados e as limitações por caso estão registrados no relatório; fronteiras automatizadas não são descritas como ações manuais. Falha funcional demanda teste RED, fix mínimo, CI exato GREEN e nova QA no SHA corrigido.

## 4. Revisão total do Codex antes do aceite

Revisar todo o diff da PR #120 comparado ao master relevante, sem limitar a testes que passaram. Foco: migrators/DDL/FKs/triggers, persistência e semântica histórica, transações e rollback, hash de idempotência/virada de dia, API/payload, paths de edição/checkout, isolamento de tenant/RBAC, projeções/lista vs relatório/export, realtime/impressão, acessibilidade e impacto nas leituras D1. Confirmar se há divergência entre regra aprovada, código, documentação e apresentação; não marcar PASS se apenas a suíte atesta comportamento sem teste manual.

Não alterar fluxos financeiros em produção nem migrar staging/produção como efeito colateral da inspeção. Evitar usar staging se houver outra entrega simultânea ou dados incompatíveis. Confirmar o estado atual do Workflow Deploy staging e gates exigidos antes de disparar.

## 5. Checklist de aceite final

- [x] Código corrigido `ef1d9ae7`: CI SUCCESS (8/8 + gates), run #39073109702; pacote de evidências `36e47798`: SUCCESS, run #39092051011. Atualização posterior deve manter CI do HEAD exato antes de publicação.
- [ ] Auditoria staging executada, distribuição histórica avaliada e resolução de blockers documentada.
- [ ] Plano de restore D1 anterior à migration registrado, migrations aplicadas exclusivamente em staging pelo workflow oficial.
- [ ] Release staging SHA exato verificado em release.json, autenticação real e bootstrap com conta fictícia.
- [ ] QA dos 15 casos concluído com evidências; 0 FAIL e 0 PENDING. BLOCKED restante exige decisão explícita.
- [ ] Métricas D1 de staging e eventuais regressões de fallback revisadas.
- [ ] Revisão total do diff pelo Codex concluída; PR review threads resolvidas, riscos residuais registrados.
- [ ] Usuário aprovou merge explicitamente depois de visualizar evidências. Produção exige decisão e workflow separados.

**Situação atual:** revisão integral, correções do pré-flight, testes e navegador locais registrados no relatório. Matriz local: 13 PASS e 2 BLOCKED; impressão física e pré-requisitos de staging pendentes. NÃO marcar Task 11 aceita/concluída sem resolver os bloqueios e validar o release de staging no SHA exato.

## 6. Fontes vivas e handoff

- Spec: docs/superpowers/specs/2026-10-17-effective-payment-date-design.md
- Plano: docs/superpowers/plans/2026-10-17-effective-payment-date-plan.md
- Resultado Task 10: docs/superpowers/qa/2026-10-17-effective-receipt-task10.md
- Runbook de release: docs/release-and-migration-runbook.md
- Regras de negócio: docs/product/BUSINESS_RULES.md
- Pré-flight: scripts/infra/effective-receipt-staging-preflight.mjs
- Workflow: .github/workflows/deploy-staging.yml
- Gates de segurança: scripts/infra/productionSafetyRegression.test.js e scripts/infra/effectiveReceiptStagingPreflight.test.js

**Prompt recomendado ao Codex:** "Continue a Task 11 da PR #120 a partir desta matriz. Leia o relatório da rodada de 17/10 e preserve suas evidências. Confira mudanças posteriores e CI do SHA atual; resolva Q11-12 (auditoria histórica, restore, orçamento) e Q11-15 (impressão física), repetindo as validações afetadas com dados fictícios. Não use dados de produção. Não faça merge/deploy de produção. Não acione Deploy staging antes de read-only preflight, bookmark/rollback e autorização, e não confunda um CI verde com homologação manual. Corrija falhas via RED → GREEN, publique staging pelo workflow permitido somente após gates, registre run/SHA e traga relatório de PASS/FAIL/BLOCKED/PENDING com recomendação final, sem merge."
