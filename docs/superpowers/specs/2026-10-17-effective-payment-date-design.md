# Data efetiva do recebimento — Design aprovado para implementação

**Data:** 17/10/2026  
**Status:** especificação formalizada; implementação e homologação pendentes  
**Baseline:** `master@f44e10da3e523d757dc0a9ceffe575d4331907e0`  
**Escopo:** recebimentos do Mesiva; sem fechamento de caixa, sem alteração de pagamento já quitado e sem deploy automático.

## 1. Problema e resultado esperado

Hoje, pagamentos confirmados no Mesiva assumem a data do registro. Se um Pix ocorreu em 15/10 e o operador só conferir em 17/10, o Financeiro e as análises não devem atribuir o valor ao dia 17. Ao confirmar um **novo recebimento**, o operador poderá informar **Data do recebimento**, preenchida automaticamente com o dia atual. O Worker permite hoje ou data passada, mas nunca data futura.

Critério principal: um mesmo valor, recebido no dia escolhido, deve aparecer nesse dia em Fluxo de Caixa, recebimentos do Dashboard, A Receber e Centro de Relatórios, sem alterar a data comercial do pedido ou apagar o instante de registro.

## 2. Decisões funcionais

1. **Uma data civil por recibo** de pagamento, inclusive com várias formas ou vários pedidos. Não haverá data diferente por alocação na mesma composição.
2. O campo na UI chama-se **Data do recebimento**; default é hoje na abertura da confirmação; pode ser retroativo, sem limite arbitrário de dias; futuras são proibidas.
3. O operador já autorizado a receber continua exigindo `payments.receive` e as capabilities adicionais do fluxo; `orders.backdate` refere-se à data do pedido e não será reutilizada para retroagir um pagamento.
4. Data do pedido, data efetiva do dinheiro e momento de lançamento no Mesiva são conceitos distintos. O dia do pedido pode ser anterior/posterior ao recebimento.
5. Data do registro e identidade da transação permanecem auditáveis. Nenhuma retroação reabre ou modifica um pagamento já quitado.
6. Movimentações manuais e estornos não mudam de contrato nesta entrega.
7. Não implementar fechamento diário de caixa, conciliação bancária, pagamentos parciais arbitrários, múltiplos recibos por método ou edição retroativa de recebimentos já registrados.

## 3. Modelo e significado dos campos

- `payment_receipts.received_date`: **origem canônica da data efetiva** por recibo, em `YYYY-MM-DD`, calendário `America/Sao_Paulo`.
- `payment_receipts.paid_at`: timestamp técnico legado do registro, **preservado**; não converter artificialmente a meia-noite retroativa em um horário que ninguém informou.
- `payment_receipts.created_at`, `payments.created_at`, `payment_allocations.created_at`, `order_settlement_entries.created_at` e trilha de auditoria: instante factual de persistência; jamais retroagir.
- `payments.paid_at`: manter valor/contrato legado para compatibilidade, sem usá-lo como fonte da data efetiva nos relatórios novos.
- `movements.movement_date`: data financeira das entradas `order-payment`, **espelhando o `received_date` do recibo**; para outros tipos permanece própria da movimentação.
- `orders.order_date`: data comercial; nunca substitui a data do recebimento.

Uma redundância de `received_date` no recibo e `movement_date` nos movimentos é deliberada para manter a separação de fatos e os consumidores existentes. Todos os efeitos de um recebimento devem ser gravados na mesma transação.

## 4. Contrato e validação

Campo público sugerido `receivedDate` em todos os comandos que criam recibo, opcional por compatibilidade com cliente anterior. Se omitido, o Worker determina **hoje** usando `getBusinessDate(now)`; se presente, exigir `YYYY-MM-DD` real, sem espaços/datas impossíveis e `receivedDate <= getBusinessDate(now)`, com erro de validação identificando o campo. O backend é autoridade; max da UI é apenas proteção de usabilidade.

Para requisição idempotente, a data informada faz parte da identidade semântica do pagamento. Mesmo `mutationId` + data diferente deve resultar em conflito, sem segundo débito/recibo; repetição idêntica devolve o recibo original. Na omissão legada, não inserir o dia calculado no hash de modo que retry após meia-noite produza conflito inesperado. O checkout usa chave de idempotência de pedido: replay retorna o original, inclusive sua data, nunca reescreve o recibo.

Permissões, empresa autenticada, proteção contra duplicate/late effects e verificações de estado/preço/valor em centavos permanecem intactas.

## 5. Fluxos abrangidos

| Fluxo | Confirmação visual | Gravação |
| --- | --- | --- |
| Pedido pago no checkout | `CheckoutPaymentComposition.jsx` via `NewOrder.jsx` | `worker/orderCheckout.js` + `worker/repositories.js` |
| Recebimento posterior de pedido | `OrderPaymentDialog.jsx` | `registerOrderPayment` em `worker/paymentRepository.js` |
| Quitação de comanda | `TableTabPaymentDialog.jsx` | `registerTableTabPayment` |
| Recibo agrupado de cliente | Diálogo do workflow de `client-orders` | `registerClientOrdersPayment` |
| Recebimento complementar | `OrderPaymentDialog.jsx` | `worker/orderSupplementalPayment.js` |

A data aparece **somente na etapa de confirmar recebimento**, e não em cada atalho/tela de seleção de pedidos. O campo deve manter valor editado durante erros transitórios e impedir envio de futuro/inválido. Reutilizar controles, tema e padrões existentes do Mesiva; desktop/mobile e acessibilidade (label, foco, teclado, erro inline).

## 6. Leitores e relatórios

- **Financeiro/Movimentações:** manter os cálculos e filtros por `movement_date`, agora corretamente gerado.
- **Centro de Relatórios:** para recebimentos totais, série e mix de métodos, filtrar/agrupar por `payment_receipts.received_date`, não `paid_at`. Recibo compartilhado é contado uma vez; o mix soma alocações do recibo e nunca multiplica por pedidos.
- **Dashboard e A Receber / Recebido hoje:** considerar a data financeira das entradas; preservar explicitamente a regra atual de abatimento de estornos `order-refund` conforme seu próprio `movement_date`, sem acrescentar `order-edit-refund` incidentalmente.
- **Pedidos quitados e detalhes:** expor `receivedDate`; em exibição financeira informar o dia efetivo, e se diferente, esclarecer o dia/hora em que o lançamento foi registrado. Preservar `paidAt` técnico e ordenação operacional de timelines quando apropriado.
- **Histórico comercial:** pedidos continuam agrupados por seus próprios marcos operacionais, não pela data do Pix.
- **Exportações CSV/PDF/XLSX:** verificar, testar e ajustar **somente** as que exibem data de pagamento/recebimento; preservar colunas comerciais e semântica da exportação atual.
- **Saldo inicial:** um recebimento com dia anterior à data de abertura permanece no histórico, mas não compõe saldo atual (regra existente). Quando a UI permitir, avisar que a data está antes da abertura, sem alterar saldo silenciosamente.

## 7. Compatibilidade e migração

Migração D1/SQLite **aditiva**, versionada, sem reescrever valores, IDs, alocações, timestamps, estornos ou pedidos existentes:

1. Criar `received_date` na tabela `payment_receipts` sem `NOT NULL` enganoso durante transição; adicionar índice somente após medir os planos de consulta e custo de escrita.
2. Auditar `movement_date` de movimentos vinculados ao recibo: havendo uma data única e confiável, essa é a prioridade de backfill. Quando falta vínculo/movimento, derivar a data de `paid_at` com calendário `America/Sao_Paulo`, inclusive históricos sujeitos à regra de horário de verão, sem subtrair sempre três horas nem simplesmente usar a substring UTC.
3. Não supor que SQLite D1 conhece timezone IANA em SQL: **definir procedimento verificável para fallback via Worker/script em lotes**; se não for possível garantir backfill integral, impedir cutover de readers sem fallback correto.
4. Dados novos sempre recebem a data oficial; clientes antigos que omitem o campo recebem hoje no Worker. Queries durante o período de transição devem continuar completas para legados.
5. Inspecionar e tratar divergências, `legacy-receipt:*`, várias empresas e recibos com múltiplas alocações. Corrigir inconsistências encontradas por processo explícito, nunca por reset de dados.
6. Nenhum write remoto sem runbook, backup/bookmark e autorização compatível. Staging usa exclusivamente dados fictícios.

## 8. Invariantes técnicos

- `SUM(payment_allocations.amount_cents) = payment_receipts.total_cents`, sem novas linhas ou valores duplicados.
- Todos os `movements` automáticos do mesmo recibo e tipo `order-payment` têm `movement_date = received_date`.
- Cada recibo compartilhado por comanda/cliente conta uma vez em relatórios; pagamentos por pedido continuam vinculados corretamente.
- `paid_at`/`created_at` nunca são falsificados com o dia informado.
- Replays e erros de rede não geram novo recibo, não alteram a data inicial e não executam novo movimento.
- Mutações usam transação autoritativa, `business_id` e capabilities; mudanças de política/estado causam conflito seguro.
- Consultas por período continuam indexáveis, sem varreduras globais e sem N+1.
- Quando o operador mantém o default, o comportamento financeiro deve continuar equivalente ao atual.

## 9. Aceite / bloqueios

Aceite exige RED → GREEN → REFACTOR por tarefa; scripts/CI, migração em banco vazio e populado, testes de fronteiras de São Paulo, reconciliação entre telas e homologação manual desktop/mobile. Registrar impacto de `rows_read`, `rows_written`, novas queries/índices e regressão de histórico volumoso antes/depois.

**Gate:** sem código verde não publicar staging; sem homologação humana não integrar; sem autorização explícita não efetuar merge nem deploy de produção.

## 10. Evidências e referências

Origem: auditoria técnica de 17/10/2026, `master@f44e10da3e523d757dc0a9ceffe575d4331907e0`; módulos: `worker/paymentRepository.js`, `worker/repositories.js`, `worker/orderSupplementalPayment.js`, `worker/readModels/movementReads.js`, `worker/reporting/repository.js`, `worker/reporting/service.js`, `shared/cashFlowReadRules.js`, `migrations/0026_split_payments.sql`, `migrations/0043_order_settlement_ledger.sql`.

Consultar `AGENTS.md`, `docs/product/BUSINESS_RULES.md`, `docs/architecture/MODULE_MAP.md`, `docs/release-and-migration-runbook.md` antes da implementação.
