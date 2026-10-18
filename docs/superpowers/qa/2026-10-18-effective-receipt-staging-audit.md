# PR #120 — auditoria histórica de staging, somente leitura

**Execução:** 18/10/2026, 00:22:07–00:22:16, America/Sao_Paulo. **SHA auditado:** `d7bb18808c82292f5163db00dadb74de8faa4adc`, branch `codex/received-date-tdd`.

**Resultado: sem bloqueadores técnicos encontrados; `REVIEW_REQUIRED` para o plano de transição de 195 recibos históricos.** Não houve migration, backfill, criação de tabela, alteração de dados ou deploy. Restore, orçamento e impressão física não fazem parte desta execução e continuam pendentes.

## Destino e schema

- D1 de staging `amor-e-sabor-delivery-staging`, ID `73a1c0c1-142f-4247-8ffc-e858ab2ac400`, conferido no binding `env.staging` de `wrangler.jsonc`. Nenhuma consulta em produção.
- **55 migrations registradas**, todas presentes na branch, até `0051_client_payment_mutation_receipts.sql`.
- **Única migration pendente:** `0052_effective_receipt_date.sql` (56 arquivos locais).
- Schema **pré-0052**, sem coluna `received_date` e sem índice `payment_receipts_business_received_date_idx`, como esperado. Tabelas de recibos, alocações, pagamentos, movimentos e controle de migrations presentes.

## Distribuição histórica

Executada a biblioteca `auditEffectiveReceipts` de `scripts/infra/effective-receipt-staging-preflight.mjs`, com consultas remotas aprovadas em um wrapper Node/Windows e Wrangler fixado em `4.128.0`. A consulta não referenciou `received_date` ausente. Foram retornados somente metadados, nomes de migrations e contagens agregadas, sem IDs de recibos, clientes, sessões ou credenciais; nenhum dado de produção foi copiado nem dado sintético inserido.

| Classificação | Recibos |
| --- | ---: |
| Total | **195** |
| Consenso legado de movimentos (`consensus_legacy`) | **195** |
| Legado sem movimentos | **0** |
| Canônicos com `received_date` | **0**, coluna ainda ausente |
| Movimentos com datas conflitantes | **0** |
| Datas de movimentos inválidas | **0** |
| Valor dos movimentos diferente do total do recibo | **0** |
| Timestamp legado inválido/não canônico para fallback | **0** |

As verificações de calendário/mismatch da coluna `received_date` ainda não se aplicam, pois ela não existe nesse schema. Não interpretar ausência da coluna como recibos pós-migration com data preenchida ou como validação do resultado de uma migration não executada.

Os 195 recibos têm consenso entre os movimentos automáticos de entrada e total compatível. Eles são candidatos ao backfill por consenso definido em 0052. A migration e o plano foram conferidos: a data financeira viria dos movimentos, sem recalcular arbitrariamente o dia a partir de UTC e sem alterar os horários técnicos. O contador `needsManualReview=195` permanece explícito para o aceite humano dessa transição; a auditoria não aplica nem autoriza o backfill.

## Custo observado e garantia de leitura

| Consulta remota | `rows_read` | `rows_written` |
| --- | ---: | ---: |
| Objetos relevantes em `sqlite_master` | 430 | 0 |
| `SELECT name FROM d1_migrations ORDER BY id` | 55 | 0 |
| `PRAGMA table_info(payment_receipts)` | 0 | 0 |
| Agregado de auditoria de recibos/movimentos | 1.186 | 0 |
| **Total: quatro consultas** | **1.671** | **0** |

Todas reportaram `changes=0`, sucesso e leitura na instância primária. O custo é da auditoria pontual; não aprova orçamento mensal nem substitui a medição das rotas da aplicação.

Não foi usado `wrangler d1 migrations list`: no código distribuído do Wrangler `4.128.0`, esse comando chama `initMigrationsTable`, que executa uma criação de tabela se necessário. Para garantir a ausência de DDL, a lista aplicada foi obtida por `SELECT` após confirmar a existência da tabela e comparada aos nomes dos arquivos locais.

## Evidência e pendências

[Resultado agregado em JSON](evidence/2026-10-18-effective-receipt-staging-audit.json), com horários, SHA, hashes das quatro queries, migrations e metadados D1. O wrapper local fica em `.wrangler/task11-audit-staging.mjs`; não contém credenciais. Os [resultados anteriores da homologação local](2026-10-17-effective-receipt-task11-review.md) continuam válidos para sua própria rodada.

A parte de leitura da auditoria histórica foi executada. Antes de publicar, faltam aceite do plano para os 195 consensos, restore D1 verificável, orçamento, impressão física e homologação do release de staging no SHA exato. Q11-12 permanece BLOCKED por plano histórico/restore/orçamento, e Q11-15 pela impressão física; a matriz local continua **13 PASS / 2 BLOCKED**. Este documento não autoriza migration, staging, merge ou produção.
