# Task 10 — Reconciliação de recebimentos, D1/workerd e gates de release

**Data:** 17/10/2026  
**PR:** [#120](https://github.com/vzaponi-dotcom/Mesiva/pull/120) · `codex/received-date-tdd`  
**Status:** **GREEN em testes integrados e D1/workerd local**; **NO STAGING / NO DEPLOY / NO MERGE**. Uma auditoria dos recibos legados efetivamente existentes e QA humano continuam pendentes.  
**SHA funcional aferido:** `c5e28d820f923eaca6f454e7d28ce97a05140100` · [Validate application #39069565814](https://github.com/vzaponi-dotcom/Mesiva/actions/runs/39069565814) — **SUCCESS** (8/8 shards, arquitetura, lint, build, Worker prod/staging dry-run, migrations D1 local, gates de upgrades, budgets e runtime/WebSocket).

## 1. Reconciliação e cobertura verificada

As verificações SQL usam `worker/effectiveReceiptReconciliation.test.js`, `worker/effectiveReceiptUpgrade.test.js`, testes existentes de pagamentos/checkout/comanda/lote/complemento, `worker/reporting/repository.test.js`, `worker/reporting/service.test.js`, `worker/readModels/financeReadRepository.test.js` e os gates do workflow.

- Um recibo compartilhado por dois pedidos e dividido em Pix/Dinheiro conta **uma vez** nos totais; `payment_allocations` preservam o mix, sem cruzar 2 pedidos × 2 métodos.
- Em 15/10, o recibo original retroativo registrado em 17/10 aparece com R$ 80,00 brutos; um estorno de R$ 10,00 no mesmo dia resulta em R$ 70,00 na métrica líquida `receivedToday`. A série de recebimentos mantém R$ 80,00, e a série de estorno mantém R$ 10,00 separadamente.
- Em 17/10, os dois pedidos mantêm vendas comerciais de R$ 95,00, enquanto apenas o complemento de R$ 15,00 entra na série financeira de recebimentos daquele dia. O saldo a receber remanescente após o estorno é R$ 10,00; totais do fluxo de caixa: entradas R$ 95,00, saídas R$ 10,00, saldo R$ 85,00, excluído saldo inicial configurado.
- Recebimento avulso, checkout, comanda, lote de cliente e suplemento mantêm o contrato `received_date`/`movement_date`; regras de permissões, 409, retries/incerteza, idempotência, guard de sessão e impressão são cobertas pelos testes existentes executados nas 8 shards, **não** por validação física.
- Duas empresas no fixture são isoladas nas consultas, e `finance.movements` é necessário para exibir `receivedToday`.
- Migration 0052: instalação limpa coberta pelo D1 local; upgrade populado (antes de 0052) testa consenso de movimentos, datas divergentes, ausência de movimentos, duas empresas, FK e data de horário de verão de 2018. Movimentos concordantes são backfilled; recibos conflitantes e sem movimento continuam `NULL`, auditáveis e elegíveis ao fallback sem UTC fixo.

**Semânticas diferentes são intencionais:** `orders.order_date` representa venda comercial; `received_date` representa recebimento bruto, `movements.movement_date` representa entradas/saídas, e `paid_at`/created_at registram o instante técnico. `receivedToday` subtrai `order-refund`, mas não movimentos manuais nem `order-edit-refund`; relatórios apresentam estornos próprios separadamente. Não exigir igualdade entre métricas brutas e líquidas sem esses ajustes.

## 2. Medição comparativa no D1/workerd real (local)

Comando versionado e obrigatório no CI: `node scripts/infra/effective-receipt-date-d1-gate.mjs`, executado em Miniflare/D1 workerd, Wrangler **4.128.0**, com schema pós-0052 e **dados exclusivamente fictícios**. A origem dos valores é `D1Result.meta.rows_read`/`rows_written`, não estimativa SQLite. A consulta anterior por `paid_at` **não é semanticamente equivalente** à nova para uma data retroativa: por isso o retorno esperado no dia 15 difere.

| Query/dados | Antes: rows_read | Depois: rows_read | Escritas de SELECT | SQL requests | Retorno |
| --- | ---: | ---: | ---: | ---: | --- |
| Período 15/10, 1.000 históricos | 2 | 5 | 0 | 1 antes / 1 depois | Antes não acha o retroativo; depois acha |
| Período 15/10, 10.000 históricos | 2 | 5 | 0 | 1 antes / 1 depois | Mesmo resultado correto depois |
| Fallback `NULL` em 01/12/2018, 1.000 → 10.000 históricos | — | 5 → 5 | 0 | 1 | Recibo do dia segundo DST São Paulo |
| Índice adicional `payment_receipts_business_received_date_idx`, criado sobre 1.000 históricos | — | 1.518 leituras e 504 escritas **de DDL** | Não é SELECT | 1 | Índice criado sem apagar recibos |
| Inserção equivalente de **1.000 históricos**, metade `received_date NULL`, antes/depois de criar o índice | — | 2.001 → 2.001 linhas lidas | 4.000 → 4.500 **rows_written** | 1 antes / 1 depois | **+500 escritas** na amostra, devido ao índice |

Os planos `EXPLAIN QUERY PLAN` mostram busca por `payment_receipts_business_received_date_idx` na metade com data e por `payment_receipts_business_paid_idx` na metade histórica `NULL`; sem full scan da tabela de recibos. O teste também verifica recebimento atual, retroativo, legado e de outra empresa. O gate rejeita novo `SELECT` com escrita, retirada do escopo de empresa, aumento de número de queries e crescimento desproporcional de leituras entre 1k e 10k históricos.

**Limites do ensaio:** a população de histórico do benchmark usa **50% `received_date NULL`** e horários históricos afastados do período consultado. Os novos recibos são todos datados; portanto **+500 por 1.000 não é uma taxa universal de write amplification** para novos pagamentos. Um fallback degradado com milhares de recibos `NULL` **dentro do mesmo intervalo solicitado** pode demandar leitura proporcional ao período; ele **não** foi medido aqui. O teste captura a consulta de recibos isolada, não todo o custo do endpoint, de exportações, de autenticação, armazenamento, Worker CPU, múltiplos dispositivos ou impressão.

## 3. Cenários de custo — somente hipóteses, não projeção da conta

A [tabela oficial de preços D1](https://developers.cloudflare.com/d1/platform/pricing/) indica, para Workers Paid, primeiras 25 bilhões de linhas lidas/mês e 50 milhões escritas/mês incluídas, depois US$ 0,001 por milhão de linhas lidas e US$ 1,00 por milhão escrito, além de armazenamento; Workers e outros serviços são cobrados à parte. Verificar o plano e preços vigentes ao homologar.

- **100.000 consultas mensais desse período**, com o mesmo perfil da fixture: a nova consulta adicionaria `(5 - 2) × 100.000 = 300.000` linhas lidas/mês, sem aumentar o número de requisições. Em cenário **já acima da franquia paga**: US$ 0,0003 de adicional por D1 read, apenas para esta query.
- **100.000 inserções de histórico com 50% de recibos datados**, seguindo a mesma composição do benchmark: diferença ilustrativa de `500 × 100 = 50.000` linhas escritas; se todas fossem cobradas acima da franquia paga: US$ 0,05. **Não** aplicar essa taxa diretamente aos novos recibos 100% datados.
- **Migração/DDL**: custo pontual de 1.518 reads e 504 writes em 1.000 registros fictícios, não linearidade ou custo total de uma base real. Índice também aumenta armazenamento. Para o cenário degradado (`NULL` concentrados no intervalo), medir rows_read no próprio D1 com a amostra de staging antes da publicação.

Não há acesso/medição do tráfego agregado real, do plano contratado, de preços efetivos da conta, da distribuição dos valores históricos, do número de lojas/dispositivos ou da ocupação de armazenamento. **Não é possível afirmar custo total mensal, economia ou folga de 20%** apenas com este gate. Coletar por rota e por período comparável `rowsRead`, `rowsWritten`, queries, Worker CPU/requests, DO e demais serviços no ambiente autorizado.

## 4. Auditoria obrigatória do legado antes do staging

**NÃO executar backfill automático para casos divergentes.** No ambiente autorizado, após preparar snapshot/bookmark e revisão da migration, executar esta consulta **read-only**, por empresa, para dimensionar pendências. Não usar offset fixo para derivar `America/Sao_Paulo`:

```sql
WITH receipt_movements AS (
  SELECT business_id, receipt_id, COUNT(*) AS movement_count,
    MIN(movement_date) AS min_day, MAX(movement_date) AS max_day
  FROM movements
  WHERE deleted_at IS NULL AND source = 'order-payment' AND type = 'entrada'
    AND receipt_id IS NOT NULL
  GROUP BY business_id, receipt_id
), audit AS (
  SELECT r.business_id, r.id,
    CASE
      WHEN r.received_date IS NOT NULL THEN 'canonical'
      WHEN COALESCE(m.movement_count, 0) = 0 THEN 'fallback_paid_at_no_movements'
      WHEN m.min_day <> m.max_day THEN 'BLOCKED_conflicting_movements'
      ELSE 'review_consensus_still_null'
    END AS classification
  FROM payment_receipts r
  LEFT JOIN receipt_movements m ON m.business_id = r.business_id AND m.receipt_id = r.id
)
SELECT business_id, classification, COUNT(*) AS receipts
FROM audit
GROUP BY business_id, classification
ORDER BY business_id, classification;
```

Se houver `BLOCKED_conflicting_movements`, a data do dinheiro deve ser esclarecida com evidência e decisão humana; movimento/dia de registro não pode ser reinterpretado arbitrariamente. Se houver `review_consensus_still_null`, investigar integridade e migration antes de corrigir. Para `fallback_paid_at_no_movements`, inspecionar timestamps inválidos e conversão por runtime IANA; manter fallback até plano de backfill auditado. Confirmar preservação de timestamps técnicos, valores, alocações, idempotência, tenant e rollback. **Nenhuma consulta remota foi executada nesta tarefa.**

## 5. Gate de passagem para Task 11

| Critério | Situação no SHA `c5e28d8` |
| --- | --- |
| Testes integrados, migration populada, migração local, arquitetura/lint/build, Workers dry-run e runtime | **PASS** — [Validate #39069565814](https://github.com/vzaponi-dotcom/Mesiva/actions/runs/39069565814) |
| D1/workerd local e regressão 1k→10k, requests, `rows_read`, `rows_written`, índices | **PASS** — gate adicionado ao workflow |
| Auditoria dos `received_date NULL` e conflitos **no banco que irá para staging** | **PENDING / BLOCKED** — não há medição remota nesta tarefa |
| Custo por rota em staging, fallback concentrado, carga concorrente/dispositivos | **PENDING** — requer ambiente implantado/homologação |
| Homologação manual dos 15 cenários, desktop/mobile, temas, 409, F5, impressão e perfis | **PENDING** — Task 11 |
| Merge, produção, migration remota | **NOT AUTHORIZED / NOT EXECUTED** |

**Decisão:** Task 10 tem implementação/testes/medição local concluídos e verdes. Isso **não** é aceite para staging automático nem liberação de produção. Antes de aplicar 0052 remotamente, resolver a auditoria do legado no contexto autorizado; a Task 11 exige autorização própria de publicação e execução de QA.
