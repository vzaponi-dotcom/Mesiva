# Auditoria técnica — Caixa Operacional, Entregadores e Recebimentos

**Data:** 19/10/2026
**Baseline auditada:** master f3f4e8a7305f49bb81dbf1997a98a57ca330d266 (consulta de arquivos via GitHub; sem execução local)
**Status:** auditoria estática documental; não houve alteração de código, migração, consulta a dados privados, deploy ou testes funcionais no ambiente real.
**Spec vinculada:** [2026-10-19-cash-operational-design.md](2026-10-19-cash-operational-design.md)

## 1. Resultado executivo

A Mesiva **não possui** hoje caixa físico modelado por sessões, somatório de gaveta por caixa, entregadores cadastrados/vinculados aos pedidos nem livro de repasses. Já possui:
- pagamentos com receipt único e alocações por método, inclusive composição;
- movimentações financeiras automáticas e manuais;
- saldo inicial geral de fluxo financeiro por empresa;
- data efetiva de recebimento por receipt;
- data prometida para recebível;
- capabilities de acesso e auditoria;
- action da Cozinha que mostra "Pedido saiu para entrega" ao colocar o pedido em Finalizado;
- leituras operacionais scoped e avisos realtime de invalidação.

**Achado crítico:** o caixa físico deve ser um ledger de custódia ligado às operações oficiais existentes, não novo motor paralelo de pagamentos ou espelho da tela Movimentações.

**Recomendação de implementação:** migrations aditivas e separação de owner (Financeiro/Caixa e Entregadores), preservar todos os recibos/movimentos históricos, introduzir UI de caixa como superfície independente, não remover /financeiro/movimentacoes na primeira rodada.

## 2. Matriz de evidências e lacunas

| Área | Evidência verificada no código | Lacuna de produto | Risco se implementado ingenuamente |
| --- | --- | --- | --- |
| Finanças manuais | worker/financeRepository.js createManualMovement/updateManualMovement/softDeleteManualMovement; source=manual | Não há cash_session_id nem custódia de gaveta | Uma "despesa" ou sangria duplicar débito |
| Saldo financeiro | migrations/0009_finance_cash_flow.sql finance_settings.opening_balance_cents/opening_date | É saldo por empresa, não fundo por sessão | Converter saldo contábil em troco físico |
| Recebimentos | worker/paymentRepository.js registerOrderPayment e payment_receipts/payment_allocations | Não há register destino/custódia | Repasse virar segundo receipt |
| Data efetiva | migrations/0052_effective_receipt_date.sql + worker/paymentRepository.js | Data financeira não identifica gaveta física | Reabrir saldo de sessão antiga ao retroagir pagamento |
| A receber | worker/orderPaymentPromise.js + src/domains/finance/ui/Receivables.jsx | Intenção/momento de pagamento não fazem parte do novo pedido | Previsão confundida com pagamento/cobrança à vista |
| Cozinha | src/domains/orders/application/useOrderCommands.js finaliza pedido e mostra "Pedido saiu para entrega" | Não identifica entregador nem confirmação real de entrega | Duplicar ação de despacho ou assumir cliente recebeu |
| Comandas | worker/paymentRepository.js registerTableTabPayment; Business Rules RN-PAG-06 | Caixa não recebe crédito físico fracionado da forma dinheiro | Recebimento avulso proibido/duplicação por item |
| Autorização | shared/settingsAccess.js, worker/access/roles.js | Não há grants cash.* nem escopo por gaveta | finance.movements.manage conceder poder excessivo |
| Navegação | src/app/navigation/registry.js rota financeira /financeiro/movimentacoes | Nova rota de Caixa | Apagar links/recursos usados por outros fluxos |
| Realtime | docs/operations/realtime-sync.md, worker/realtime/effectCatalog.js | Tópicos/effects de caixas e repasses | Polling repetido e carga D1 desnecessária |
| Design | docs/design/DESIGN_SYSTEM.md + identidade-visual/README.md | Novo fluxo desktop/tema/estados | Seguir guia histórico v1.0 em vez da v1.1 |

**Tipo de evidência:** inspeção do conteúdo da branch padrão e da documentação viva; a ausência de resultados de busca por cash_session, deliverer/courier e equivalentes não comprova ausência absoluta de toda lógica possível. Exigir busca completa por código/migrations no plano técnico antes de declarar ausência definitiva.

## 3. Detalhamento dos conflitos funcionais

### A. "Saiu para entrega" não equivale a "Entregue"

Em src/domains/orders/application/useOrderCommands.js, finalizeOrder envia updateOrderStatus(orderId,'Finalizado') e exibe texto "Pedido saiu para entrega" para Entrega. A documentação Business Rules RN-TEM-06 confirma que não há novo status oficial criado pelo texto da UI. Criar um botão de "sair" também no Caixa geraria dois owners potencialmente divergentes.

**Encaminhamento:** Cozinha continua owner; nova atribuição de entregador e eventos logísticos devem acompanhar a transição oficial e estar disponíveis ao Caixa. A prestação de contas registra pagamento/custódia, não status Cozinha; status de entrega concluída é evento distinto.

### B. A receber já tem promessa de pagamento

worker/orderPaymentPromise.js valida ISO real, bloqueia data anterior ao dia do negócio, impede alterar promessa de pedido cancelado/quitado e a audita. worker/index.js protege PATCH /api/orders/:id/payment-promise com finance.promises.manage. Receivables usa promisedPaymentDate e timing.

**Encaminhamento:** adicionar intenção e momento esperado no checkout sem duplicar promise; preservar capacidade de atualizar posteriormente por grants existentes. Resolver permissão no checkout explicitamente. Mudança de intenção não altera receipt, relatório nem gaveta.

### C. Recibo de venda versus custódia física

A base de split payment (migrations/0026_split_payments.sql) cria payment_receipts e payment_allocations. Business Rules RN-PAG-03/04 descrevem 1 recibo com múltiplas alocações e entradas automáticas por método. paymentRepository registra receipt/movements; refunds existem em fluxos próprios.

**Encaminhamento:** ao receber em dinheiro direto na gaveta, 1 entrada física vinculada à allocation cash e à sessão. Ao confirmar dinheiro com entregador, 1 recibo oficial + custódia com entregador; repasse ao caixa é transferência de custódia, não novo pagamento. Se a confirmação de entrega e repasse ocorrerem no mesmo ato, transação unificada com idempotência. Métodos Pix/cartão não movimentam cash_operation.

**Atenção:** pagamento por lote de cliente pode compartilhar receipt entre vários pedidos; nunca atribuir o total do receipt novamente por pedido. Reembolsos e complementos precisam de rastreabilidade da parcela efetivamente entregue/retirada.

### D. Saldo inicial e despesas do Financeiro não são caixa da gaveta

migrations/0009_finance_cash_flow.sql contém finance_settings com opening_balance_cents/opening_date por empresa. worker/financeRepository.js oferece movimentações manuais por tipo, categoria, data e método. O formulário na Finance UI mantém Novo movimento, Saldo inicial, edição/exclusão lógica, estornos pendentes e lista financeira com entradas e saídas.

**Encaminhamento:** **não** desativar a rota ou o CRUD manual agora. A solução futura precisa mapear origem e destino de cada tipo de registro. Uma despesa operacional pode ser bancária (sem alterar gaveta) ou paga com dinheiro em espécie (altera uma gaveta identificada). Sangria para cofre não é despesa. Uma despesa paga pela gaveta não pode ser novamente lançada como sangria.

### E. Sessão física vs recebimento retroativo

A migration 0052 introduziu payment_receipts.received_date separado dos horários paid_at/created_at; o Financeiro pode contabilizar em data anterior conforme regra. Isso não significa que numerário estava na gaveta de uma sessão histórica. A exibição pode ter duas dimensões: data financeira efetiva e timestamp/sessão da entrada física real.

**Encaminhamento:** registrar cash_session_id no instante real de ingresso físico, não derivado de received_date. Sessões fechadas são imutáveis. Quando um operador selecionar recebimento retroativo, exigir associação/reconciliação de custódia correta e não criar evento na sessão antiga automaticamente.

### F. Permissões por caixa ainda não existem

worker/access/roles.js define templates manager/operator. worker/index.js requer finance.movements.manage para POST/PATCH/DELETE de movimentos manuais; esta capability é ampla. shared/settingsAccess.js lista capabilities conhecidas, e o auth valida no Worker.

**Encaminhamento:** novas capabilities cash.* e vínculos por register_id; exigir ambos no backend. Não conceder movimentações financeiras gerais via cash.withdraw/supply. Planos de migração dos grants devem evitar escalonamento silencioso de operadores existentes.

### G. Realtime, custo e layout

A documentação de realtime afirma que Worker/D1 são autoritativos, aviso WebSocket invalida leituras, e fallback HTTP existe. Novas telas por caixa/entregador precisam de snapshots segmentados, agregados feitos no backend, paginação e invalidação com grants. Evitar N+1 de pedidos/custódia e polling adicional por card.

A base visual normativa atual é **Mesiva v1.1**, aprovada em 17/10/2026, não o PDF v1.0 previamente anexado. Os ativos versionados em public/brand devem ser preservados, inclusive o verde de SVG distinto do token da UI; ver Design System. Os mockups anteriores têm função de direção, não prova de contrato.

## 4. Classificação de riscos

| Risco | Severidade | Mitigação obrigatória |
| --- | --- | --- |
| R-01 Duplo recebimento quando entregador repassa | **Crítico** | Referência única receipt/allocation + remittance; idempotência e transação |
| R-02 Fechamento contando promessa não recebida | **Crítico** | Ledger físico separado e fórmulas testadas |
| R-03 Numerário lançado em caixa fechado/incorreto | **Crítico** | Constraints, revisão, validação atômica e escopo |
| R-04 Criar ação de despacho duplicada | **Alto** | Owner Cozinha + estado logístico próprio |
| R-05 Desabilitar Movimentações e perder estornos/despesas | **Alto** | Inventário de consumidores + migração com aceite |
| R-06 Reaproveitar finance.movements.manage para caixa | **Alto** | Grants cash.* e escopo físico |
| R-07 Recebimento retroativo alterar sessão passada | **Alto** | Separar received_date de custody_at/session |
| R-08 Operação concorrente/timeout gerar duplicação | **Alto** | Idempotency token por command e reconciliação |
| R-09 Sem conexão o operador acha que recebeu | **Alto** | Não otimista; erro/retomada explícitos |
| R-10 Histórico volumoso causar aumento D1 | **Médio/alto** | Snapshot/candidatos, índices e medição |
| R-11 Novos estados inconsistentes entre Cozinha/A receber/Caixa | **Alto** | Contrato único, testes transversais |
| R-12 Vazamento entre empresas/usuários | **Crítico** | business_id derivado do contexto e RBAC no Worker |

## 5. Alterações prováveis e responsáveis — não executadas

| Camada | Pontos de entrada | Natureza prevista |
| --- | --- | --- |
| Checkout/UI | src/domains/orders/ui/NewOrder.jsx, src/domains/orders/application/useNewOrderDraft.js, src/app/workflows/payments/ | Campos informativos e envio de dados |
| Cozinha | src/domains/orders/application/useOrderCommands.js, src/domains/orders/ui/Orders.jsx | Associação ao despacho e projeção sem botão novo |
| Financeiro UI | src/domains/finance/ui/FinanceWorkspace.jsx, Finance.jsx, Receivables.jsx | Novo workspace Caixa; coexistência temporária |
| Shell/Navegação | src/app/navigation/registry.js, src/App.jsx | Rota e grants do Caixa |
| Worker/APIs | worker/index.js, worker/orderCheckout.js, worker/paymentRepository.js, worker/orderPaymentPromise.js | Contratos transacionais, idempotência, autorização |
| Permissões | shared/settingsAccess.js, worker/access/roles.js, src/domains/access/ui/ | Capabilities e escopos |
| Banco/migrations | migrations/ novas e versionadas | Entidades físicas, FKs, índices, invariantes |
| Real-time/leitura | worker/readModels/, worker/realtime/effectCatalog.js, shared/scopedReads.js | Snapshots/tópicos e paginação |
| Relatórios | worker/reporting/, src/domains/reporting/ | Diferenciação faturamento/recebido/custódia |
| Design | src/shared/ui/, src/index.css e tokens existentes | Aplicação do guia v1.1, tema claro/escuro |

Essa matriz é o **ponto de partida** para leitura de callers, testes e migrations; não dispensa diff/grep completo antes de editar qualquer arquivo.

## 6. Contratos não resolvidos e gates

Antes de um plano de implementação executável, discutir:
1. **PD-01:** política completa de troco em posse do entregador e sequência de eventos;
2. **PD-02:** para onde mover despesas manuais e estornos se Movimentações for removida;
3. **PD-03:** tratamento de recebimento parcial genuíno, sem violar quitação integral atual;
4. **PD-04:** permissão para criar promessa de pagamento no checkout;
5. **PD-05:** momento exato de confirmação de dinheiro com entregador (na volta, ou antecipado por operador);
6. **PD-06:** regra opt-in para exigir caixa aberto nos pagamentos em espécie;
7. **PD-07:** fechamento cego ou não por grants;
8. **PD-08:** testes/protótipos finais coerentes com o guia visual v1.1;
9. **PD-09:** identificar eventos de cancelamento/devolução que podem surgir após despacho ou fechamento;
10. **PD-10:** quais partes do histórico Financeiro podem continuar disponíveis somente em Relatórios sem perder ações existentes.

**Sequência de gates exigida:** Spec aprovada -> plano técnico -> inspeção de chamadas/esquema/tests -> migrations aditivas com plano reversível -> testes focados e completos -> métricas D1/Cloudflare -> CI verde por SHA -> staging com dados fictícios -> QA do usuário -> autorização explícita de merge -> autorização de produção separada. Não executar migrations remotas nem inferir autorização do aceite documental.

## 7. Testes e evidências desta auditoria

- **Executado:** leitura estática de código/documentação do repositório GitHub, links do código citados nesta auditoria, e conferência do SHA base da master.
- **Não executado:** clone local, npm test, architecture/lint/build, D1 local ou remoto, perfilagem, CI, smoke staging, comparação de telas geradas com build, testes físicos.
- **Consequência:** conclusões são de viabilidade/risco e **não** alegação de que uma implementação esteja pronta ou de que a produção atual corresponda exatamente ao master auditado.

## 8. Referências específicas verificadas

- [AGENTS.md](../../../AGENTS.md), [PRD](../../product/PRD.md), [Business Rules](../../product/BUSINESS_RULES.md), [Module Map](../../architecture/MODULE_MAP.md).
- [Finance UI](../../../src/domains/finance/ui/Finance.jsx), [FinanceWorkspace](../../../src/domains/finance/ui/FinanceWorkspace.jsx), [Finance Repository](../../../worker/financeRepository.js), [Finance Validation](../../../worker/financeValidation.js).
- [finance_cash_flow migration](../../../migrations/0009_finance_cash_flow.sql), [split_payments migration](../../../migrations/0026_split_payments.sql), [effective_receipt_date migration](../../../migrations/0052_effective_receipt_date.sql).
- [Payment Repository](../../../worker/paymentRepository.js), [A receber](../../../src/domains/finance/ui/Receivables.jsx), [Payment promise](../../../worker/orderPaymentPromise.js).
- [Comando de finalização](../../../src/domains/orders/application/useOrderCommands.js), [Business Rules RN-TEM-06](../../product/BUSINESS_RULES.md).
- [Navigation registry](../../../src/app/navigation/registry.js), [roles](../../../worker/access/roles.js), [capabilities](../../../shared/settingsAccess.js), [Worker routes](../../../worker/index.js).
- [Realtime operational](../../operations/realtime-sync.md), [Design System](../../design/DESIGN_SYSTEM.md), [guia de identidade v1.1](../../design/identidade-visual/README.md).

**Parecer:** proposta funcionalmente viável sob migração incremental, mas estruturalmente transversal e **não elegível a implementação sem resolver contratos abertos**. Priorizar ledger de custódia e nunca desmontar finance/reports/receivables/settlement existentes.
