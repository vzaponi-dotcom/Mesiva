# PR #120 — publicação controlada e conferência de staging

**Execução:** 18/10/2026, 01:24–01:28 SP. **SHA publicado:** `68404745c7b47b2d2e4e31ece5f0812a1c3d3400`. **Deploy e migration: PASS. Homologação funcional autenticada: aguardando acesso. Task 11 não homologada.**

Após esclarecer a diferença entre auditoria histórica pré-migration e validação funcional posterior ao deploy, o usuário autorizou prosseguir com a publicação controlada em staging e os testes seguintes. Essa autorização não é aceite definitivo do orçamento, da impressão física ou da produção. Não houve merge, deploy de produção ou consulta de suas linhas de negócio. O banco de staging permanece separado e destinado a dados fictícios.

## Gates e publicação

| Verificação | Evidência |
| --- | --- |
| Branch/SHA remoto e PR aberta | `codex/received-date-tdd`, PR #120, HEAD `68404745` |
| CI do SHA exato | [Validate application #39095784721 — SUCCESS](https://github.com/vzaponi-dotcom/Mesiva/actions/runs/39095784721) |
| Auditoria read-only renovada | 195 recibos em consenso, zero bloqueadores técnicos; 55 migrations aplicadas, somente 0052 pendente; 1.671 leituras/zero escritas |
| Recuperação | Método da [parte 2](2026-10-18-effective-receipt-d1-recovery.md) verificado; bookmark fresco abaixo |
| Publicação pelo workflow oficial | [Deploy staging #39097117765 — SUCCESS](https://github.com/vzaponi-dotcom/Mesiva/actions/runs/39097117765), `workflow_dispatch`; nenhuma publicação local alternativa |
| Pré-flight no próprio workflow | Antes das escritas: `schema pre-0052; receipts 195; canonical 0; consensus 195; legacy_no_movement 0; blockers 0` |
| Migration | Somente `0052_effective_receipt_date.sql` aplicada; quatro comandos reportados em 11,47 ms; o log não expõe `rows_read/rows_written` da migration |
| Identidade publicada | `release.json`: ambiente `staging`, SHA `68404745`, ref `refs/heads/codex/received-date-tdd`, run #39097117765 |
| Smoke do workflow | `multi_company` pronto na primeira tentativa; autenticação anônima e deep links/assets PASS |

A primeira consulta da auditoria renovada recebeu recusa Cloudflare 7403. Metadados/Time Travel e um `SELECT 1` posterior passaram; a repetição integral da auditoria passou sem alterar código, permissões ou dados. O evento transitório foi registrado, sem contornar o pré-flight.

Bookmark pré-migration: **`0000054d-00000000-00005108-2e88208415938c0de4edc73c73e36334`**, obtido em `2026-10-18T04:26:37.172Z`, antes do início do job (`04:26:54Z`), para D1 `73a1c0c1-142f-4247-8ffc-e858ab2ac400`. Nenhum restore foi executado. Em eventual recuperação, seguir o runbook, guardar também o checkpoint corrente e avaliar as escritas posteriores; esse bookmark não autoriza perda de novos recebimentos.

## Preservação dos recibos históricos

Foram calculados hashes SHA-256 antes e depois da migration, ordenando por empresa/ID e selecionando os campos financeiros originais. Os dados retornados ficaram somente em memória; a evidência publica contagens, somas e hashes. A nova coluna `received_date`, intencionalmente preenchida, não faz parte do hash original.

| Tabela | Quantidade antes/depois | Soma do campo monetário antes/depois, centavos | Hash dos campos originais |
| --- | ---: | ---: | --- |
| `payment_receipts` | 195 | 1.790.836 | Igual |
| `payments` | 287 | 1.777.436 | Igual |
| `payment_allocations` | 210 | 1.790.836 | Igual |
| `movements` | 222 | 2.020.024 | Igual |

As somas são por tabela e escopo, não uma afirmação de equivalência entre todos os pagamentos, recibos e movimentos. Os hashes conferem IDs, vínculos, valores, métodos e timestamps selecionados; em movimentos também conferem exclusão/data financeira. Descrições e dados pessoais não foram consultados para essa comparação. Cada snapshot financeiro leu 1.201 linhas/escreveu zero.

Conferência pós-migration:

- **195/195 recibos canônicos**, nenhum restante NULL ou em revisão; zero conflitos, datas inválidas, divergências de valor ou de data com movimentos existentes.
- **56 migrations aplicadas**, nenhuma pendente; coluna e índice da 0052 presentes.
- **Zero violações de FK**. `EXPLAIN QUERY PLAN` confirmou `SEARCH payment_receipts USING COVERING INDEX payment_receipts_business_received_date_idx` por empresa/faixa de datas.
- Auditoria posterior: 1.674 leituras/zero escritas. FK/contagem/EXPLAIN: 5.417 leituras/zero escritas. Não confundir essas consultas de conferência com custo da migration ou custo mensal.

## Homologação e orçamento ainda pendentes

O smoke do workflow verifica fronteiras anônimas e identidade do release; ele não comprova login operacional, bootstrap autenticado ou recebimentos pelo navegador. A aba de [staging](https://staging.mesiva.com.br) foi aberta e está aguardando o usuário concluir o login com conta de homologação; não foi solicitada senha pelo chat, criada conta paralela ou emitida recuperação. Nenhuma credencial/captura de formulário foi incorporada à evidência.

| Critério | Estado ao registrar esta evidência |
| --- | --- |
| Aplicação da 0052/preservação histórica no destino | **PASS técnico**, conforme hashes/auditoria |
| Bootstrap autenticado e cinco caminhos de recebimento em staging | **BLOCKED — acesso autenticado pendente**, sem PASS presumido |
| Datas, relatórios/CSV/PDF, permissões e realtime do release no navegador | **BLOCKED — mesma dependência de acesso**; execução local anterior preservada |
| Orçamento mensal integral e margem de 20% | **BLOCKED — não demonstrados**, conforme [parte 3](2026-10-18-effective-receipt-cloudflare-budget.md) |
| Q11-12 integral | **BLOCKED**, embora a migration histórica no destino tenha passado; orçamento/aceite integral pendentes |
| Q11-15 integral | **BLOCKED**, impressão física/QZ/spooler sem evidência nesta rodada |
| Matriz local anterior | **13 PASS / 2 BLOCKED**, sem converter execução local em homologação de staging |
| Merge/produção | **Não executados / não autorizados** |

A publicação foi um avanço autorizado de homologação, não uma declaração de que US$5/mês ou o orçamento global foi aprovado. Não houve carga sintética volumosa remota para preencher essa lacuna. O próximo passo é concluir login, validar os cinco caminhos com poucos registros fictícios e conferir SQL/relatórios no SHA publicado. A candidata já está disponível para o teste funcional que depende do deploy; esse teste não é uma condição retroativa para a publicação inicial.

## Evidência e verificação

Resumo sanitizado: [`evidence/2026-10-18-effective-receipt-staging-deploy.json`](evidence/2026-10-18-effective-receipt-staging-deploy.json). Inclui status/etapas do workflow, identidade do release, bookmark, distribuições pré/pós, hashes/somas e plano D1. Asserções do probe conferiram o SHA exato, CI/deploy registrados, ordem do checkpoint, igualdade dos campos originais, migração de todos os consensos, zero pendências e FKs PASS.

Probes/logs locais estão em `.wrangler/task11-staging-preservation.mjs`, `task11-staging-postchecks.mjs`, `task11-staging-deploy-summary.mjs` e `.wrangler/task11-evidence/staging-*`, fora do Git. Não remover persistência, histórico ou evidências anteriores.

Esta rodada não altera runtime, migrations ou workflow. O workflow executou arquitetura, lint, build, migrations locais, dry-run e smokes; reutilizou o CI aprovado do SHA. A documentação distingue pré-flight e homologação posterior e atualiza o estado da matriz. O aceite humano, o teste físico e a comprovação financeira permanecem explícitos.

Verificação documental: oito documentos/57 links e âncoras PASS; 20 anexos anteriores com hashes preservados; asserções do resumo de publicação PASS; `git diff --check` PASS. README/AGENTS/índice permanecem coerentes. O commit posterior de documentação não altera o bundle já publicado nem exige nova publicação apenas para registrar evidências.
