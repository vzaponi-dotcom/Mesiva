# Mesiva — Plano TDD — Edição de pedidos e reconciliação financeira

**Data:** 2026-10-10
**Status:** PLANO DE EXECUÇÃO HISTÓRICO — Tasks 1–16 implementadas na PR #108; Task 17 parcialmente homologada e Task 18 pendente. A integração atual é acompanhada no [plano de 16/10](2026-10-16-order-editing-integration.md) e no [QA](../qa/2026-10-16-order-editing-integration.md).
**Spec:** docs/superpowers/specs/2026-10-10-order-editing-design.md, AUTORREVISADA.
**Master inspecionada:** e595f7ed2a801fde6ffab231194788430cc53316.
**Branch documental:** docs/order-editing-design-2026-10-10.
**Branch de implementação:** feature/order-editing-and-financial-reconciliation.
**PR:** [#108](https://github.com/vzaponi-dotcom/Mesiva/pull/108), Draft; sem merge/produção nesta etapa.
**Produção:** nenhuma ação sem autorização explícita separada.

> Executar task por task, RED válido → GREEN comprovado, commits pequenos, CI por SHA exato. Branch master nunca usada para desenvolvimento. Não criar runtime paralelo, refazer módulos da Spec C nem habilitar financeiro parcialmente migrado.

## 1. Regras de negócio não negociáveis

1. Editar até finalização, incluindo durante preparo, mantendo ID/número, modalidade, vínculos de comanda/reserva e data original. Bloquear Finalizado e Cancelado.
2. Preservar preço e identidade de cada item preexistente mesmo que produto tenha sido inativado; itens novos exigem produto ativo/preço oficial. Histórico mostra diferenças reais.
3. Atualizar o mesmo card na Cozinha/TV com selo Editado; diferenças em Detalhes/Controle, sem ciência manual (decisão posterior de UX). TV segue somente leitura e mantém seu layout original.
4. Nenhum novo print job na edição. Atualizar somente snapshot automático pendente elegível, sem alterar jobs processados; prompt após salvar para impressão manual do documento oficial completo.
5. Salvar mantém diferença positiva em A receber; Salvar e receber cobra só a diferença oficial; redução gera devolução pendente e só após confirmação manual cria saída de caixa.
6. Preservar payments/receipts/allocations/movements originais; quitação de cada cobrança exige a soma integral do saldo cobrado, inclusive em várias formas. Estado parcial decorre de edição posterior, não de baixa parcial arbitrária.
7. Comanda aberta continua recebida pela comanda, não pelo pedido individual. Comanda encerrada não é reaberta automaticamente.
8. Autorização orders.edit e demais capabilities, tenant guard, revision/metadata de edição, mutationId/idempotência e atomicidade backend.
9. Fase A operacional e Fase B financeira homologadas juntas antes de qualquer publicação completa. Nenhuma produção por autorização implícita.

## 2. Preflight inicial (histórico; execução e evidências na PR)

- Reconsultar HEAD atual da master e as migrations existentes; comparar divergências com o commit acima e interromper se houver conflito não resolvido.
- Confirmar próxima numeração de migration (0042 após 0041, somente se continuar livre). Migration já publicada nunca é renumerada/reescrita.
- Só depois de aprovar o plano: criar branch de feature e PR draft únicas, registrar base, SHA e histórico de Validate. Evitar PR duplicada.
- Registrar baseline de npm test, npm run lint, npm run build, npm run test:architecture, npm run d1:migrate:local e Worker dry-run, com status real e SHA.
- Criar fixtures representativas de pedidos pagos individualmente, com pagamento dividido, recibo compartilhado de cliente/comanda, agendados, reservas e QZ.
- Se baseline já estiver vermelho, investigar antes do RED planejado.

## 3. Fases e bloqueios

**Fase A — Tasks 1–7:** edição operacional segura com histórico e cozinha/TV/impressão. Até existir backend financeiro completo, pedido previamente pago só pode ser editado se o total resultante permanecer igual ao líquido efetivamente recebido; casos de variação de total são recusados atomicamente. Nenhum lançamento financeiro adicional.

**Fase B — Tasks 8–15:** ledger financeiro imutável e adicional, read model canônico de saldo, cobrança complementar, devoluções, cancelamentos, comanda, A receber e relatórios. Ativar valores variáveis de pedidos pagos apenas depois de leitores, escritores e guards estarem íntegros.

**Fechamento — Tasks 16–18:** gates, staging, homologação, documentação e preparação de PR. Nada será liberado em produção automaticamente. Flag temporária, se necessária, deve isolar recurso incompleto.

## 4. Tarefas de implementação RED → GREEN

### Task 1 — Migration e contratos de revisão, histórico e capabilities

**RED:** testes de migration clean/upgrade/rollback/foreign_key_check, autorização orders.edit, guard por business_id, registro de diferenças e ciência por revisão. Falharão por ausência real de esquema.
**GREEN:** criar migration aditiva para content_revision e last_edited_at, histórico imutável de edições, tabela/identidade de ciência de cozinha, idempotência de mutationId e capability orders.edit. Atualizar seeds de gestor e operador conforme Spec; perfis customizados apenas com concessão explícita. Não mexer no registro de pagamentos.
**Testes indicativos:** worker/orderEditingMigration.test.js, worker/access/authorization.test.js ou equivalentes reais. Executar comando node --test para suítes específicas e migrations D1 clean/upgrade.
**Aceite:** nenhuma referência cruzada entre empresas; schema legada preservada; novas permissões não vazam.

### Task 2 — Domínio de edição, preços e diferenças

**RED:** itens antigos/inativos com preço snapshot mantido; novos itens precificados pelo servidor; IDs de linha imutáveis; quantidade/nota; validação de desconto; no-op; rejeição de IDs alheios, valor negativo, finalizado/cancelado.
**GREEN:** validador isolado e delta determinístico por item, preservando IDs antigos, snapshot, subtotal, taxas e ajuste. Reuso das regras de totais em worker/orderCheckout.js, sem reaproveitar indevidamente cotação da edição de reservas. Sem mudança de modalidade/mesa/data.
**Testes indicativos:** worker/orderEditValidation.test.js e src/domains/orders/domain/orderCart.test.js.
**Aceite:** no-op não gera revisão nem auditoria falsa.

### Task 3 — API e writer transacional da Fase A

**RED:** revisão stale 409, mutationId repetida retorna mesmo resultado, payload divergente com mesma key rejeitado, autorização inválida, rollback íntegro, corrida edit×finalize/cancel/reserva e tenant access negado.
**GREEN:** novo comando no owner worker de edição e PATCH /api/orders/:id validando expectedContentRevision, mutationId, status e guarda de empresa dentro da transação. Salvar pedido, itens, totais, revisão, diff e audit event sem duplicar order.id/number. Na Fase A bloquear variações monetárias se já houver recebimento.
**Testes indicativos:** worker/orderEditRepository.test.js e worker/orderEditHttp.test.js.
**Aceite:** alteração completa ou nenhuma alteração; nenhuma impressão ou cobrança criada pelo PATCH.

### Task 4 — UI de edição com o fluxo Nova venda

**RED:** abrir de Cozinha e Histórico, preencher rascunho oficial, preservar IDs/valores, bloquear campos fora do escopo, retorno de navegação, alterações não salvas, permissão, conflito preservando draft, responsive.
**GREEN:** adicionar edit-order no controller de draft e UI de src/domains/orders; reutilizar NewOrder, seu carrinho e etapas, preservando edit-reservation. App.jsx apenas compõe owners e navegação, sem negócio financeiro.
**Testes indicativos:** NewOrder.test.js, useNewOrderDraft.test.js, OrdersMultiItem.test.js e novos testes de integração.
**Aceite:** edição desktop e mobile com dados corretos, sem criar pedido duplicado.

### Task 5 — Cozinha, TV e Controle da TV

**Contrato atualizado:** revisão do mesmo ID conserva o selo Editado, sem NOVO PEDIDO; filtro Entrega/Retirada/Mesa, paginação, ocultação e TV passiva preservados. Diferenças aparecem em Detalhes/Controle; não há botão de confirmação. Tabelas de ciência antigas continuam compatíveis.
**Integração:** projeção segura em worker/kitchenTvReadRepository.js e runtime realtime oficial; fallback/temporizadores seguem o guia de operação atual. Nenhuma escrita pela sessão restrita da TV nem alteração do transporte QZ.
**Testes indicativos:** KitchenDisplayApp.test.js, KitchenDisplayCard.test.js, KitchenTvControlSurface.test.js e testes do Worker.
**Aceite:** sem alertas retroativos de pedidos novos e sem repetição a cada poll.

### Task 6 — Impressão sem enfileirar após edição

**RED:** save sem job novo; job automático pending atualiza só snapshot elegível e guarda claim; processing/printed/discarded/resultado físico incerto intocados. Recusar prompt deixa fila igual; aceitar cria somente job manual atualizado; falha de imprimir não reverte edição.
**GREEN:** estender writer de edição com proteção de snapshot pendente e reusar loadOrderPrintDocument/endpoint de impressão manual, mais confirmação na UI depois de salvar. Respeitar printing.execute e configuração de cópias.
**Testes indicativos:** worker/orderPrintingReprint.test.js, worker/tableReservationUpdate.test.js, OrderDetailPrinting.test.js e novos testes.
**Aceite:** nenhum job novo causado automaticamente pelo PATCH.

### Task 7 — Gate operacional da Fase A

**RED/GREEN:** integração de pedido imediato/agendado, reserva aberta/convertida, comanda, produto inativo, preço estável, TV, impressão e auditoria; teste pago com total alterado obrigatoriamente rejeitado até Fase B.
**Verificação:** npm test, npm run lint, npm run test:architecture, npm run build, D1 local e Validate no SHA exato, sem declarar pass antes da execução.
**Aceite:** gate A green e nenhuma exposição prematura de pagamentos parciais.

### Task 8 — Migration aditiva de recebimentos complementares e devoluções

**RED:** dados legados preservados, pedido já pago recebendo complemento por outro receipt, receita única por allocation, receipt compartilhado entre pedidos, múltiplas devoluções, idempotência e isolamento por empresa. Validar clean/upgrade e FK.
**GREEN:** migration seguinte (0043 apenas se livre) com ledger de atos financeiros adicionais imutáveis por pedido: kind/amountCents, business_id, order_id, receipt_id para complemento, movement_id para devolução, mutationId e audit actor. Preservar payments.order_id UNIQUE e valores antigos; não criar 2º payments para mesmo pedido. Mapping de shared receipts por pedido sem duplicar receipt.total.
**Testes indicativos:** worker/orderSettlementMigration.test.js e migration D1 clean/upgrade.
**Aceite:** pagamentos antigos não são reescritos nem perdidos.

### Task 9 — Fonte única de saldo financeiro e projeções

**RED:** R$80/80 pago, 95/80 due15, 65/80 refundDue15, 65/80 com devolução10 refundDue5, dois estornos não geram duas linhas de pedido; receipt de comanda/cliente não multiplica valores.
**GREEN:** centralizar grossReceived, refunded, netReceived, due e refundDue em centavos. Atualizar worker/orderPaymentReadModel.js, worker/orderReadSql.js e projeções oficiais, inclusive fallback histórico. Distinguir identidade de pagamento original de status de quitação derivada.
**Testes indicativos:** worker/orderReadRepository.test.js, worker/orderPaymentReadModel.test.js e fixtures financeiros.
**Aceite:** o saldo oficial não depende apenas de payments.id.

### Task 10 — Writer de cobrança complementar

**RED:** complemento de R$15 em Pix, dinheiro ou composição, uma cobrança completa do saldo; mutationId repetida não cria segunda entrada; conflito se edição/revisão alterou saldo; avulso nunca pago segue fluxo integral antigo.
**GREEN:** comando financeiro adicional, validado no Worker por revisão financeira/operacional atual, receipt+allocations+movements coerentes e registro em ledger, sem segunda linha payments.order_id. Guardar estado antes do commit e reconciliar resposta incerta sem repetir cobrança.
**Testes indicativos:** worker/orderSupplementalPayment.test.js, worker/paymentRepository.test.js e paymentApi.test.js.
**Aceite:** receita real uma única vez; saldo remanescente zero após cobrança aceita.

### Task 11 — Devolução parcial e cancelamento

**RED:** pedido 80→65 com R$15 a devolver; confirmar devolução R$10+R$5; sem movimento ao apenas salvar; bloquear estorno maior do que o devido; cancelamento após 80+15 recebidos devolve 95 líquidos, e após redução e devolução prévia de 15 devolve só 80 remanescentes.
**GREEN:** novo writer de devolução confirmada em ledger/movimento de saída com payments.refund, sem integração bancária. Adaptar worker/orderCancellation.js: cancelamento deve considerar líquido recebido menos devoluções já registradas, não apenas payments.amount_cents. Evitar JOIN de movimentos de refund que multiplique pedidos; manter estornos antigos.
**Testes indicativos:** worker/orderCancellation.test.js, worker/orderPartialRefund.test.js.
**Aceite:** nenhuma devolução duplicada, saldo e cancelamento reconciliados.

### Task 12 — Comanda aberta/fechada e recebimento agrupado por cliente

**RED:** editar pedido em comanda aberta atualiza saldo da comanda e impede cobrança individual; fechar/receber simultaneamente falha com conflito esperado; comanda paga não reabre ao editar; recibo compartilhado de cliente quita saldos por pedido sem copiar receita.
**GREEN:** atualizar worker/tableTabDetailRepository.js e worker/paymentRepository.js, fluxo de baixa de comanda e lote de cliente com guardas por revisão de todos os pedidos envolvidos. Pedido finalizado continua parte da conta mas não editável. Ajuste financeiro de comanda fechada vinculado ao pedido/recebimento original sem nova ocupação.
**Testes indicativos:** worker/tableTabPayment.test.js ou testes existentes equivalentes; src/domains/table-service/application/useTableServiceCommands.test.js.
**Aceite:** saldo agregado sempre correto e nenhuma alteração de ocupação por ajuste financeiro.

### Task 13 — A receber, Financeiro, relatórios, Dashboard e ticket

**RED:** pedido pago com novo due aparece em A receber só pelo saldo; badge parcialmente pago; devolução pendente; grupos cliente por saldo; previsão/relatório por método; PDF/ticket não exibem Pago indevidamente; caixa mostra entradas/saídas reais.
**GREEN:** migrar consumidores, especialmente src/domains/orders/domain/orderPaymentEligibility.js, src/domains/finance/domain/receivables.js, src/app/workflows/payments/order/useOrderPaymentWorkflow.js, worker/reporting/financialAnalytics.js, worker/reporting/repository.js e worker/orderPrintDocumentRepository.js; nenhuma conta derivada pelo total inteiro de receipt compartilhado para cada pedido.
**Testes indicativos:** receivables.test.js, reporting tests, worker/orderPrintDocumentRepository.test.js, payment workflow tests.
**Aceite:** dashboard, históricos, A receber e movimento não divergem.

### Task 14 — UX final de Salvar, Salvar e receber e devolução

**RED:** alterações +15 mostram Salvar e Salvar e receber só com capability; composição cobra exatamente R$15; recusar/fechar modal mantém edição salva e due no A receber; reduzir total mostra Registrar devolução só se autorizado; nenhuma saída automática; mobile sem truncamento.
**GREEN:** integrar o fluxo de edição aos owners atuais src/app/workflows/payments e refunds. Save confirma primeiro e abre cobrança do saldo oficial; caso falhe, não promete quitação. Apenas depois exibir pergunta opcional de reimpressão.
**Testes indicativos:** useOrderPaymentWorkflow.test.js, NewOrderWizard.test.js, PaymentCompositionEditor.test.js e testes de render.
**Aceite:** operador usa fluxo semelhante a Nova venda, com atualização monetária correta.

### Task 15 — Matriz de concorrência e hardening transversal

**RED:** duas sessões simultâneas; edição×finalização, cancelamento, conversão de reserva, pagamento avulso/comanda/cliente, complemento, devolução e claim de print. Troca de empresa, concessões revogadas, perda de resposta e replay.
**GREEN:** guardas de estado/lifecycle/finance nas duas direções, inclusive writers antigos que ainda usam p.id IS NULL ou estado Pago pela existência do payment. Usar atomicidade de D1 e mutationId, sem merges silenciosos. Revisar fronteiras arquiteturais e permissões; nenhuma 2ª cobrança ou refund possível.
**Testes indicativos:** novos worker/orderEditConcurrency.test.js, integration tests financeiros e architecture.
**Aceite:** proteção de dinheiro/status cobrindo todos os caminhos existentes, sem bypass.

### Task 16 — Gates finais de qualidade da feature

- Rodar npm test; npm run lint; npm run test:architecture; npm run build; npm run d1:migrate:local; dry-runs Worker staging/production e Validate completo.
- Verificar D1 clean install e upgrade desde 0041 com fixtures financeiras, PRAGMA foreign_key_check, migração idempotente e compatibilidade de objetos legados. Incluir novo gate de upgrade no CI se necessário.
- Auditoria de todas as superfícies (cozinha, TV, impressão, comanda, cliente, relatórios, pagamentos, sessões, autorização) + revisão independente de diffs.
- Registrar resultados, SHA e run IDs reais; corrigir por TDD antes de staging. Não confundir baseline verde com evidência da feature.

### Task 17 — Staging e homologação manual

- Staging somente após CI green no SHA exato. Aplicar migrations de staging por workflow aprovado; nenhum deploy de produção.
- Matriz de homologação: avulso não pago, pago igual, pago +15 (saldo/cobrança), pago -15 (devolução efetiva/parcial), cancelamento após complemento, receipt compartilhado, split payment, comanda aberta e fechada, recebimento por cliente, produto desativado, agendamento e reserva convertida, TV/controle/cozinha, paginação/filtro/ocultação, som, QZ offline, reimpressão opt-in, F5, mobile e desktop, duas sessões e conflitos.
- Impressão física: PASS somente após teste real; se indisponível registrar BLOCKED. Falhas voltam ao owner com RED/GREEN, novo Validate e nova homologação da área afetada.

### Task 18 — Encerramento documental e gate de merge

- Atualizar QA, evidências, PR body, ledger de execução e matriz de aceitação com status reais (PASS/FAIL/BLOCKED), SHA e run IDs.
- Revisar questões pendentes e migrations finais. Não executar merge nem produção sem autorização explícita separada. Não renomear BLOCKED relevante como PASS.
- Ao terminar, solicitar autorização de merge. Se a produção for desejada posteriormente, haverá decisão de deploy separada.

## 5. Matriz mínima de saldos a comprovar por teste

| Cenário | Total atual | Recebido bruto | Já devolvido | A receber | Devolver |
| --- | ---: | ---: | ---: | ---: | ---: |
| Novo não pago | R$80 | R$0 | R$0 | R$80 | R$0 |
| Pago inalterado | R$80 | R$80 | R$0 | R$0 | R$0 |
| Pago + bebida | R$95 | R$80 | R$0 | R$15 | R$0 |
| Após complemento quitado | R$95 | R$95 | R$0 | R$0 | R$0 |
| Pago - item | R$65 | R$80 | R$0 | R$0 | R$15 |
| Devolveu R$10 | R$65 | R$80 | R$10 | R$0 | R$5 |
| Devolveu R$15 | R$65 | R$80 | R$15 | R$0 | R$0 |

Para pedidos cancelados, considerar obrigação de devolver o líquido não devolvido. Este quadro é desenho de domínio, não evidência de implementação.

## 6. Critérios explícitos de parada

Parar a task e investigar se:
- master mudou de forma incompatível, nova migration alterou números ou branch divergiu;
- RED falhar por parser/harness em vez de regra pretendida;
- save tiver resultado incerto sem reconciliação por mutationId;
- pagamento, estorno, ordem ou recibo tiver inconsistência de centavos ou duplicated receipt;
- snapshot de job processado for sobrescrito;
- TV ganhar escrita ou alerta novo duplicado;
- CI, D1 upgrade, arquitetura, staging ou caso financeiro crítico estiver FAIL/BLOCKED;
- falta autorização para merge ou deploy de produção.

**Estado atual:** Tasks 1–16 implementadas e previamente validadas na branch; Tasks 17–18 ainda dependem da integração atual e do aceite do SHA final. Registros da PR preservam RED/GREEN e aprovações parciais; não são homologação completa da árvore integrada.
