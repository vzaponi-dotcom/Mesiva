# Auditoria técnica — Caixa Operacional, Entregadores e Recebimentos

**Data:** 19/10/2026
**Baseline auditada:** master f3f4e8a7305f49bb81dbf1997a98a57ca330d266 (consulta de arquivos via GitHub; sem execução local)
**Status:** auditoria estática documental; não houve alteração de código, migração, consulta a dados privados, deploy ou testes funcionais no ambiente real.
**Spec vinculada:** [2026-10-19-cash-operational-design.md](2026-10-19-cash-operational-design.md) — v0.5, PD-01 a PD-07 aprovados funcionalmente em 20/10/2026; PD-08 ainda pendente

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

**Recomendação de implementação:** migrations aditivas e separação de owner (Financeiro/Caixa e Entregadores). A organização **aprovada** prevê Visão geral com aba Extrato, Caixa, A receber, Despesas e Relatórios. Preservar todos os recibos/movimentos históricos, introduzir UI de Caixa independente e não remover /financeiro/movimentacoes na primeira rodada. A ativação física é opt-in por empresa, com configuração anterior ao corte.

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

**Encaminhamento (PD-04 APROVADO FUNCIONALMENTE):** adicionar intenção e momento esperado no checkout sem duplicar promise. Quem tiver permissão de criar pedido (`orders.create`) poderá definir intenção/previsão no próprio ato, **sem receber autorização para editar promessas existentes**; gravação atômica e validação no Worker são obrigatórias. Alteração posterior de `promised_payment_date` continua exigindo `finance.promises.manage` no endpoint atual; atualização posterior da intenção/momento requer grant específico a definir tecnicamente. Informar intenção não concede `payments.receive` e não altera receipt, relatório nem gaveta.

### C. Recibo de venda versus custódia física

A base de split payment (migrations/0026_split_payments.sql) cria payment_receipts e payment_allocations. Business Rules RN-PAG-03/04 descrevem 1 recibo com múltiplas alocações e entradas automáticas por método. paymentRepository registra receipt/movements; refunds existem em fluxos próprios.

**Encaminhamento (PD-05 APROVADO FUNCIONALMENTE):** ao receber em dinheiro direto na gaveta, 1 entrada física vinculada à allocation cash e à sessão. **A cobrança em dinheiro pelo entregador só será confirmada pelo funcionário na prestação de contas, no retorno**; despacho da Cozinha não é comprovação. No retorno, efetivar 1 recibo oficial + custódia com entregador, e repasse ao caixa como transferência de custódia, nunca como novo pagamento. Conferência e repasse no mesmo ato exigem transação consistente e idempotente; dinheiro não entregue continua custódia do entregador, não da gaveta. Pix/cartão podem ser recebidos antes por usuário habilitado no fluxo oficial e **não devem ser reprocessados na prestação de contas**; não movimentam cash_operation.

**Atenção:** pagamento por lote de cliente pode compartilhar receipt entre vários pedidos; nunca atribuir o total do receipt novamente por pedido. Reembolsos e complementos precisam de rastreabilidade da parcela efetivamente entregue/retirada.

### D. Saldo inicial e despesas do Financeiro não são caixa da gaveta

migrations/0009_finance_cash_flow.sql contém finance_settings com opening_balance_cents/opening_date por empresa. worker/financeRepository.js oferece movimentações manuais por tipo, categoria, data e método. O formulário na Finance UI mantém Novo movimento, Saldo inicial, edição/exclusão lógica, estornos pendentes e lista financeira com entradas e saídas.

**Encaminhamento (PD-02 APROVADO FUNCIONALMENTE):** navegação alvo **Financeiro > Visão geral (aba Extrato), Caixa, A receber, Despesas e Relatórios**; Despesas é o ponto de registro de custos/fornecedores independentemente de meio de pagamento, separado de sangrias/suprimentos. Uma despesa bancária não altera gaveta; pagamento físico em espécie por gaveta deverá lançar uma única saída vinculada, nunca nova sangria pelo mesmo fato. **Não** desativar /financeiro/movimentacoes nem seu CRUD manual agora: os consumidores, estornos, saldo inicial global, categorias, histórico e operações alternativas ainda precisam de inventário/migração/homologação antes de retirada. A organização do menu está aprovada, não o detalhamento de migração ou prazo de exclusão.

### E. Sessão física vs recebimento retroativo

A migration 0052 introduziu payment_receipts.received_date separado dos horários paid_at/created_at; o Financeiro pode contabilizar em data anterior conforme regra. Isso não significa que numerário estava na gaveta de uma sessão histórica. A exibição pode ter duas dimensões: data financeira efetiva e timestamp/sessão da entrada física real.

**Encaminhamento:** registrar cash_session_id no instante real de ingresso físico, não derivado de received_date. Sessões fechadas são imutáveis. Quando um operador selecionar recebimento retroativo, exigir associação/reconciliação de custódia correta e não criar evento na sessão antiga automaticamente.

### F. Permissões por caixa ainda não existem

worker/access/roles.js define templates manager/operator. worker/index.js requer finance.movements.manage para POST/PATCH/DELETE de movimentos manuais; esta capability é ampla. shared/settingsAccess.js lista capabilities conhecidas, e o auth valida no Worker.

**Encaminhamento:** novas capabilities cash.* e vínculos por register_id; exigir ambos no backend. Não conceder movimentações financeiras gerais via cash.withdraw/supply. Planos de migração dos grants devem evitar escalonamento silencioso de operadores existentes.

### G. Ativação gradual por restaurante (PD-06 APROVADO FUNCIONALMENTE)

**Fluxo aprovado:** preparar caixas, permissões e eventual entregador padrão por empresa sem cortar os pagamentos existentes; primeira abertura com numerário contado como fundo real; ativar o controle obrigatório de ingressos/saídas físicos após esse marco. Antes do opt-in, manter compatibilidade. Depois, pagamentos com numerário diretamente na gaveta exigem sessão aberta e grants; sem sessão, a confirmação financeira em dinheiro não pode ser marcada como concluída. Pix/cartão e pedidos para pagamento futuro permanecem disponíveis. Entradas/saídas de troco, repasses e despesas efetivamente pagos pela gaveta também precisam de sessão. Não fazer backfill de pagamentos históricos nem usar finance_settings.opening_balance_cents como fundo de gaveta. Não desativar com sessão aberta; conservar custódia/histórico ao trocar configuração.

**Contratos técnicos ainda necessários:** flag por empresa, transição entre preparação/ativação, autorização de abertura, consistência de split payments, comportamento com troco/entregador em trânsito, recuperação de comandos/timeout, logs/auditoria de opt-in e exceções de rollback. A aprovação funcional não autoriza implementar migrations.

### H. Realtime, custo e layout

A documentação de realtime afirma que Worker/D1 são autoritativos, aviso WebSocket invalida leituras, e fallback HTTP existe. Novas telas por caixa/entregador precisam de snapshots segmentados, agregados feitos no backend, paginação e invalidação com grants. Evitar N+1 de pedidos/custódia e polling adicional por card.

A base visual normativa atual é **Mesiva v1.1**, aprovada em 17/10/2026, não o PDF v1.0 previamente anexado. Os ativos versionados em public/brand devem ser preservados, inclusive o verde de SVG distinto do token da UI; ver Design System. Os mockups anteriores têm função de direção, não prova de contrato.

### I. Contagem cega e projeções de fechamento (PD-07 APROVADO FUNCIONALMENTE)

O operador que não possui grant gerencial **não pode receber o saldo esperado ou sua composição numérica antes de efetuar a primeira contagem física**. O controle deverá existir no Worker e nas projeções scoped, não apenas na UI. `cash.close` não implica acesso ao esperado. O grant gerencial e escopo de caixa determinam se a pessoa pode consultar o esperado; roles nominais não bastam. Após a primeira contagem registrada, o sistema apresenta o resultado de conferência/diferença, exige justificativa se houver divergência e preserva trilha de auditoria. Há inferência indireta do esperado a partir da diferença, portanto a finalidade da contagem cega é **evitar enviesar a contagem inicial**, não criar confidencialidade matemática absoluta após a conferência.

**Contratos técnicos ainda pendentes:** campo/capability exato de permissão, política de recálculo e recontagem, snapshots de caixa e valor esperado sob sincronização/fallback, filtragem do backend (inclusive agregados, event payloads e caches) e concorrência fechamento vs recebimentos. Nenhum desses detalhes é uma aprovação implícita de um endpoint ou migration.

### I. Parcial insuficiente fora da primeira versão (PD-03 APROVADO FUNCIONALMENTE)

Os workflows de pagamento verificados exigem alocações completas para a quitação autoritativa. A aprovação adia o suporte integral a receber R$ 60 de um pedido de R$ 100 e deixar saldo de R$ 40, sem confundir com um pagamento dividido que some o total. O Caixa v1 deve identificar ocorrência de pagamento insuficiente e manter o pedido pendente, sem recibo parcial improvisado, estado Pago ou suprimento financeiro indevido. **Lacuna técnica ainda aberta:** se o restaurante tomar posse de numerário parcial, exigir uma política explícita de custódia, identificação, reconciliação e devolução; não supor que registrar ocorrência já contabiliza fisicamente esse dinheiro. Não inserir, na implementação da v1, um caminho incompleto que permita recebimento parcial sem esse contrato.

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

Antes de um plano de implementação executável, tratar os itens a seguir. **PD-01 a PD-07 estão resolvidos no âmbito funcional**. PD-08, PD-09 e PD-10, além de detalhes técnicos de autorização/contagem, exceções de pagamento parcial, migração e OP-04, permanecem pendentes:
1. **PD-01 — RESOLVIDO FUNCIONALMENTE:** o usuário aprovou controle de troco do entregador na primeira versão. A Spec v0.4, EN-10 a EN-10d e QA-46 a QA-50 formalizam fundo enviado, troco pago, retorno, repasse parcial e impossibilidade de reabrir sessão antiga. Permanece obrigatória a validação técnica de eventos/recibos antes do DDL;
2. **PD-02 — APROVADO FUNCIONALMENTE:** nova organização de Financeiro com Visão geral (Extrato), Caixa, A receber, Despesas e Relatórios; Movimentações legadas preservadas até migração segura. **Pendente tecnicamente:** inventário de despesas manuais, estornos, edições/ajustes e histórico, integração da despesa paga em espécie (OP-04) e retirada futura da rota (PD-10);
3. **PD-03 — APROVADO FUNCIONALMENTE:** suporte completo a pagamento parcial genuíno adiado para evolução independente; v1 identificará ocorrência de pagamento insuficiente/saldo não quitado sem registrar recibo de quitação, fingir pagamento, nem usar suprimento para ocultar valor de cliente. **Pendente tecnicamente:** protocolo seguro quando numerário parcial foi fisicamente aceito; não habilitar sua aceitação sem modelo de custódia/reconciliação e testes;
4. **PD-04 — APROVADO FUNCIONALMENTE:** `orders.create` permite informar intenção e previsão durante criação, com validação atômica e sem conceder edição geral; alterações posteriores exigem grant específico, sendo `finance.promises.manage` já exigida para a data prometida. **Pendente tecnicamente:** autorização granular da edição posterior de intenção e revisão da mutation de checkout;
5. **PD-05 — APROVADO FUNCIONALMENTE:** cobrança em dinheiro pelo entregador confirmada no retorno por funcionário autorizado na prestação de contas; Pix/cartão podem ser confirmados independentemente via fluxo oficial, sem duplicação. **Pendente tecnicamente:** grants de reconciliação, consistência receipt/custódia/repasse e erros de rede;
6. **PD-06 — APROVADO FUNCIONALMENTE:** ativação gradual por empresa com preparação e fundo contado na primeira abertura; após ativação numerário físico exige sessão aberta e permissões, sem bloquear Pix/cartão/promessas ou operações legadas de empresas não ativadas. **Pendente tecnicamente:** flag, implantação por etapas, erro/reconciliação e rollback controlado;
7. **PD-07 — APROVADO FUNCIONALMENTE:** fechamento com contagem cega por operador, sem saldo esperado e composição numérica antes da primeira contagem; permissão gerencial efetiva controla acesso ao esperado. O backend deve redigir/bloquear campos em consultas, e primeira contagem/recontagens devem ser rastreáveis. **Pendente tecnicamente:** grants exatos, apresentação pós-contagem, política de recontagem e consistência sob concorrência;
8. **PD-08:** testes/protótipos finais coerentes com o guia visual v1.1;
9. **PD-09:** identificar eventos de cancelamento/devolução que podem surgir após despacho ou fechamento;
10. **PD-10 — PENDENTE:** apesar da direção aprovada de **Extrato em Visão geral**, mapear quais ações/estornos/lançamentos/histórico financeiro precisam continuar acessíveis em Despesas, Extrato, Relatórios ou eventual compatibilidade antes de remover Movimentações. Não interpretar a escolha de navegação como autorização de migração destrutiva.

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
