# Conferência do Dia — MVP independente do Caixa Operacional

> **Histórico da implementação inicial.** As estimativas e pendências abaixo descrevem o handoff anterior à revisão. Substituídos pelo [guia operacional vigente](../../operations/day-conference.md) e pelo [relatório da revisão técnica](../qa/2026-10-23-day-conference-final-review.md). A PR continua Draft; nenhuma autorização de publicação é concedida por esses documentos.

**Início:** 23/10/2026 · **Branch:** `feature/finance-daily-reconciliation-mvp` · **Status:** desenvolvimento, sem homologação.

## Produto
- Nova tela `Financeiro → Conferência do dia`, acessível pela Visão Geral.
- Filtra pela data **financeira** `movements.movement_date` (São Paulo), nunca por `orders.order_date`.
- Mostra bruto de recebimentos (`source='order-payment'`), devoluções por forma (`order-refund`, `order-edit-refund`) e líquido, mantendo a composição separada.
- O detalhe paginado mostra apenas os lançamentos daquela data e forma. Valores divididos são linhas separadas; recibos compartilhados não são multiplicados por pedido.
- Usuário informa total externo, verifica cada forma e registra ressalva obrigatória para qualquer divergência individual, mesmo que as diferenças se compensem.
- Um registro imutável guarda usuário, dia, valores originais e conferidos, estado e observação. Alterações financeiras posteriores sinalizam resultado antigo como desatualizado; nova revisão pode ser registrada.
- Dinheiro = recebimentos registrados no dia, **não o saldo da gaveta**. Cartão = transações, **não repasse bancário líquido**.
- **Fora do escopo:** abertura de caixa, custódia, entregadores, transferências, fundos/sangrias/suprimentos, integração bancária e mudanças em pagamentos.

## Owner e permissões
- Novo módulo `worker/dayConferenceRepository.js` faz leituras e gravação persistida; `worker/dayConferenceApi.js` aplica a autorização, sessão e verificação de origem dentro do dispatcher existente.
- Ler requer `finance.movements`; concluir requer `finance.movements.manage`, reutilizando grants existentes (sem seed de novos papéis).
- Todas as queries usam `business_id`, no Worker já condicionado ao contexto de empresa autenticada; nenhuma gravação altera `payments`, `payment_receipts`, `payment_allocations` ou `movements`.
- Migração aditiva `0053_daily_receipt_conferences.sql` cria tabela de histórico independente; não executar em staging ou produção sem autorização.

## Cloudflare/D1: orçamento por operação (estimativa estrutural, **não medição**)
| Ação | Consultas D1 explícitas | Estratégia |
| --- | --- | --- |
| Abrir data | 2 SELECT | 1 GROUP BY do dia usando índice `movements_business_date_active_idx` + 1 último snapshot `LIMIT 1` em índice `daily_receipt_conferences_history_idx` |
| Abrir detalhe | 1 SELECT | Paginação de 50 registros, `LIMIT 51`, detalhe sob demanda, sem N+1 por pedido |
| Carregar mais | 1 SELECT/página | Somente por ação do usuário |
| Consultar histórico | 1 SELECT | No máximo 30 snapshots, sob demanda |
| Concluir | 1 SELECT idempotência + 1 SELECT resumo + 1 INSERT | Apenas ao confirmar; sem polling de fundo; conflitos fazem leitura adicional |
| Reabrir após concluir | 2 SELECT | Atualização explícita da interface |

**Custo real** de linhas lidas, operações escritas, CPU e RTT **depende do plano D1/Workers e dos índices e dados reais**, e deve ser instrumentado pelo Codex em SQLite/D1/staging. Autenticação e contexto financeiro adicionam consultas existentes não contabilizadas na tabela. D1 cobra linhas avaliadas na execução, não apenas o número de registros no resultado. Validar `EXPLAIN QUERY PLAN` no banco compatível, evitar `SCAN` global, e medir leituras da resposta e `meta.rows_read / rows_written` quando disponíveis; não afirmar redução financeira sem medição.

## Riscos e verificações pendentes do Codex
1. **P0:** executar teste de migração e SQL real; verificar validade de `INSERT OR IGNORE` com SQLite D1, índice de `business_id/date`, idempotência e concorrência de duas conclusões simultâneas.
2. **P0:** reconciliação centavo a centavo entre `getPaymentMix`, `movements` e `payment_receipts/payment_allocations` em histórico legado e pagamentos repartidos/complementares. A fonte inicial da tela é `movements`, exatamente como a Visão Geral. Investigar qualquer discrepância entre movimentos e recibos, **sem corrigir dados automaticamente**.
3. **P0:** confirmar as atribuições de devoluções a formas em casos de estorno dividido, estorno parcial, edição de pedido e devolução retroativa. Mostrar aviso de método indeterminado quando não houver prova da atribuição.
4. **P0:** medir se alterações do conjunto de lançamentos com mesmo total/quantidade, timestamps máximos e IDs máximos podem escapar ao fingerprint agregado; reforçar controle transacional/freshness no momento da gravação.
5. **P1:** simular datas anteriores, recebimento em data posterior ao pedido, recibos compartilhados, encerramento do dia com resultado desatualizado e duas empresas concorrentes.
6. **P1:** validar permissões por perfil e escopo de empresa, CSRF, a evolução `readModel` para nova rota e `SurfaceContent` sem loop de loading.
7. **P1:** revisar UX mobile 320–1440px, claro/escuro, teclado, foco de confirmação, inputs inválidos, zero vs campo vazio, erros offline e navegação com solicitação ainda em andamento.
8. **P1:** executar `node --test worker/dayConferenceRepository.test.js`, suíte completa, checker arquitetural, lint, build, migrações locais, benchmarks de leitura Cloudflare e revisão independente. Guardar SHA e resultados na PR.
9. **P2:** exportar relatório completo filtrado (não somente a página visível) após confirmar a consulta e os limites de volume; nenhum CSV parcial deve ser apresentado como total.
10. **P2:** deixar histórico mais explicativo para fontes legadas e mostrar detalhes de conferência por revisão. Revisar data/hora por fuso do negócio.

**Gate:** esta PR deve continuar **DRAFT**; nada de merge, migrations remotas, staging ou produção antes de revisão e autorização explícita.
