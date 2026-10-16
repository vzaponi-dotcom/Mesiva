# Mesiva — Edição de pedidos até a finalização, cozinha e reconciliação financeira

**Data:** 2026-10-10
**Status:** IMPLEMENTADA NA PR #108, em integração/homologação. Atualizada em 16/10/2026 com as decisões posteriores de UX e os contratos realtime/scoped. [QA atual](../qa/2026-10-16-order-editing-integration.md); não representa liberação em produção.
**Branch documental:** docs/order-editing-design-2026-10-10
**Base técnica inspecionada:** master @ e595f7ed2a801fde6ffab231194788430cc53316 (merge PR #107, 2026-10-06).
**Produção:** proibido deploy sem implementação, staging, homologação e autorização separada.

## 1. Objetivo e experiência aprovada

Permitir corrigir pedidos existentes enquanto ainda não foram finalizados, inclusive durante o preparo, preservando ID/número, histórico operacional e financeiro, coerência da cozinha e da TV e integridade de impressão/comandas.

Decisões de negócio já aprovadas na conversa:
1. Edição permitida até a finalização; pedidos finalizados ou cancelados não são editáveis.
2. Cozinha e TV mostram os dados atuais e o selo permanente **Editado**; diferenças estruturadas ficam em Detalhes/Controle da TV, sem exigir confirmação de leitura. A TV mantém altura, densidade e paginação originais, sem painel de diferenças no card.
3. Cada edição mantém histórico de alterações.
4. Editar nunca cria automaticamente um novo job de impressão. Depois de salvar, oferecer opção de imprimir/reimprimir manualmente a via completa e atualizada.
5. Reutilizar os caminhos familiares **Salvar pedido** e **Salvar e receber**: quando existe diferença positiva a receber, permitir cobrá-la imediatamente ou deixá-la em A receber.
6. Valores anteriormente recebidos são preservados. Um pedido editado para valor maior pode ficar com saldo pendente; para valor menor deve registrar obrigação de devolução até eventual estorno parcial.
7. Pedidos de mesa ligados a comanda aberta são recebidos pela comanda; não liberar pagamento individual do pedido nessa condição.
8. Implementar e homologar em fases, isolando a evolução mais arriscada de pagamentos adicionais e estornos parciais.

As decisões posteriores de UX registradas na PR em 10–12/10 substituem a proposta inicial de confirmação manual. As evidências iniciais abaixo descrevem a base histórica, não o estado atual da master.

## 2. Baseline comprovado e contratos existentes

Evidências observadas na master de referência:

- Frontend modular de Orders: src/domains/orders (NewOrder.jsx, orderCart.js, newOrderDraft.js, useOrderCommands.js, ordersApi.js, OrderDetail.jsx). Não há API geral de edição em ordersApi nem PATCH geral de pedidos no worker/index.js.
- O checkout persiste orders, order_items, total e efeitos em worker/repositories.js e usa validateCheckoutInput/calculateCheckoutTotals em worker/orderCheckout.js.
- Reserva Local futura já tem edição transacional com revision, atualização de itens e eventual snapshot do job automático pendente em worker/tableReservationUpdate.js. Ela atualmente recota itens pelo catálogo, comportamento que NÃO deve ser transplantado sem decisão ao editar pedidos comuns.
- A TV lê orders/order_items no worker/kitchenTvReadRepository.js e faz polling de aproximadamente 2s em src/kitchen-display/KitchenDisplayApp.jsx. O destaque atual usa chegada de IDs novos, não revisão de pedido. A TV é leitura; comando de TV e ocultação possuem contratos separados.
- A impressão manual de pedido carrega a versão atual via worker/orderPrintDocumentRepository.js e worker/orderPrintingApi.js; reimpressão gera outro job explícito via worker/orderPrintingRepository.js. Jobs retêm snapshot_json, não devem ser sobrescritos após processamento.
- O recebimento atual de pedido usa payments.order_id UNIQUE, payment_receipts, payment_allocations e movements. A presença de payments.id é usada como estado Pago/Pendente em worker/orderPaymentReadModel.js; o A receber e as baixas de comanda/cliente assumem sobretudo quitação integral. Não existe ainda saldo parcial geral.
- Há trilha de auditoria por ação em worker/access/audit.js e capability checks em shared/settingsAccess.js / worker/access/authorization.js. Não existe capability orders.edit.
- O banco já possui isolamento multiempresa e guardas de referências, particularmente na migration 0039_tenant_reference_guards.sql. Qualquer nova tabela e leitura deve preservar business_id e os mesmos guardas.
- As validações existentes na referência estão verdes; isso não comprova a funcionalidade nova e não substitui TDD e homologação.

## 3. Escopo editável e regras de lifecycle

### 3.1 Elegibilidade

- Edição possível para pedidos operacionais com status real Em preparo, mesmo já impressos, em preparo ou com pagamento registrado.
- Pedidos agendados de Entrega/Retirada também podem editar itens antes de entrar em preparo e, depois da entrada, enquanto não finalizados; preservar validações de agendamento. Data/horário permanecem imutáveis pelo editor geral da V1.
- Reservas Local ainda em estado reserved mantêm guardas próprios para troca de mesa/data/horário. Após entrar na janela operacional, permitir editar **itens e observações** do pedido enquanto ele permanecer ativo, sem contornar regras de reserva/chegada. Não duplicar o fluxo da reserva existente.
- Rejeitar no Worker pedidos Finalizado, Cancelado e estados terminais derivados; impedir reabertura silenciosa. Pedido histórico já criado finalizado não ganha edição.
- Permitir salvar a edição de pedido já pago mesmo com novo saldo, observadas as fases e as regras financeiras abaixo.

### 3.2 Campos propostos para V1

- Adicionar/remover produto, ajustar quantidade, observação/adicionais já representados pelo modelo de itens; manter pelo menos um item.
- Alterar taxa de entrega quando modalidade Entrega e ajustes de desconto/acréscimo, sujeitos à capability apropriada.
- Corrigir identificação/contato do cliente para pedido avulso com validação oficial; registrar snapshots. Não alterar cadastro global do cliente por efeito colateral.
- Manter modalidade, vínculo de mesa/comanda, order ID, número, data original e histórico de impressão estáveis na V1. Conversões entre Entrega/Retirada/Local e transferência de mesa são fluxos próprios, fora desta Spec.
- Mudança de agendamento/mesa de reserva segue o módulo de reservas existente; não criar segundo controle concorrente.
- Produtos existentes preservam ID de linha, valor unitário e snapshot histórico (inclusive se o produto foi desativado/excluído ou mudou de nome/preço no catálogo). Alterar quantidade/nota dessa linha não exige reativar o cadastro; novas linhas/substituições exigem produto ativo validado e precificado pelo Worker. Não recotar silenciosamente itens antigos. O servidor não deve aceitar IDs de linha pertencentes a outro pedido/empresa, nem confiar em valores monetários fornecidos pela UI. Preço manual exige contrato/capability específico fora da V1.

### 3.3 Identidade de linha e alterações reais

- O rascunho recebe ID estável dos itens existentes; manter IDs das linhas não removidas.
- Alterar quantidade, nota ou item gera delta com antes/depois. Linhas removidas permanecem no histórico imutável; novos itens ganham IDs novos.
- Não contar reordenação ou alterações equivalentes normalizadas como mudança; salvar sem mudanças não aumenta revisão, não cria aviso na TV e não dispara pedido de reimpressão.
- Validações do cliente são UX; backend recalcula em centavos inteiros e é autoridade em preços, quantidades, permissões e totais.

## 4. UX e estados de pagamento

### 4.1 Entrada, formulário e salvamento

- Acrescentar Editar pedido em detalhes de pedidos elegíveis, Cozinha e Histórico quando houver permissão. Reusar o wizard de Nova venda, incluindo desktop/mobile, alterações não salvas, navegação, conferência e acessibilidade.
- Cabeçalho indica Editar pedido #N, status, total anterior, total atualizado, recebido líquido, saldo a receber ou devolução pendente.
- **Salvar pedido:** grava primeiro a edição; valor positivo não recebido passa a A receber; não cria pagamento e não inicia impressão.
- **Salvar e receber:** somente se houver saldo positivo e permissão payments.receive; grava a edição e abre o fluxo atual de composição das formas de pagamento para a **diferença oficial**, nunca para o total histórico. Pode receber em uma ou mais formas, somando exatamente o saldo em centavos.
- Se o operador cancelar/fechar o recebimento ou a cobrança falhar, a edição permanece salva e o saldo continua a receber. A UI deve deixar explícito que salvar e receber são etapas distinguíveis; não informar quitação quando só a edição concluiu.
- Sem diferença financeira, exibir Salvar alterações, sem botão de receber saldo zero.
- Se redução gerar excedente recebido, Salvar registra devolução pendente. Oferecer ação subsequente Registrar devolução se houver permissão payments.refund. Não estornar automaticamente nem simular devolução.
- Foco, feedback, erros, bloqueio de envio duplicado e retorno à página de origem seguem componentes/owners de sessão já existentes.

### 4.2 Matriz de decisões

| Situação após edição | Salvar | Salvar e receber | Estado financeiro |
| --- | --- | --- | --- |
| Antes não pago, novo total > 0 | pendência total | recebe total | pendente ou pago |
| Pago, total igual ao líquido recebido | salva | não aplicável | pago |
| Pago, total aumentado | mantém entrada antiga, abre diferença | recebe somente diferença | parcialmente pago ou pago |
| Pago, total reduzido | mantém entrada antiga | não aplicável | devolução pendente |
| Excedente devolvido parcialmente | salva sem inventar entrada | não aplicável | devolução pendente pelo residual |
| Pedido de comanda aberta | atualiza total da comanda | proibido para pedido isolado | comanda a receber |
| Pedido vinculado a comanda quitada/fechada mas ainda operacional | edição conserva comanda fechada | ajuste de diferença via fluxo financeiro vinculado à operação original, sem reabrir a mesa | a receber ou devolução pendente |

Os termos parcialmente pago/devolução pendente são novos estados derivados, não substituição automática de todos os status persistidos existentes.

### 4.3 Reimpressão

- Após sucesso do salvamento (e após encerrar a eventual etapa de receber), perguntar: “Deseja imprimir/reimprimir o pedido atualizado?”.
- Não gerar job na operação de edição. “Não” não gera fila nem altera jobs antigos.
- “Sim” usa endpoint de impressão manual já existente, carregando no servidor todos os itens e valores correntes, e respeitando permissões/cópias configuradas; não depende de job anterior elegível para reprint. Garantir proteção de clique repetido/idempotência do comando.
- Se houver job automático ainda pending, atualizar **somente seu snapshot pendente e sua disponibilidade quando aplicável**, na mesma transação da edição, sem criar novo job, sem mudar trigger/cópias e sem ressuscitar job descartado. Não alterar jobs processing, printed, discarded, de segunda via pendente ou com resultado físico incerto; preservar evidência histórica. Em corrida com claim de impressão, usar guarda de status, evitando imprimir snapshot parcialmente editado.
- Falha/desconexão/negação de impressão nunca faz rollback do pedido nem do pagamento; exibir ação manual posterior. Operador sem printing.execute não recebe botão acionável e vê aviso apropriado.
- Preservar QZ, recuperação, segunda via e políticas de cópias, sem novos caminhos automáticos.

## 5. Reconciliação financeira — modelo normativo proposto

### 5.1 Fonte de verdade monetária

Definir para cada pedido:
- totalCents = total oficial dos itens/taxa/ajustes atuais.
- grossReceivedCents = soma de todos recebimentos efetivamente confirmados atribuídos ao pedido, inclusive os existentes.
- refundedCents = soma de todas devoluções/estornos parciais efetivamente registrados para o pedido.
- netReceivedCents = grossReceivedCents - refundedCents.
- dueCents = max(totalCents - netReceivedCents, 0).
- refundDueCents = max(netReceivedCents - totalCents, 0).

Invariantes: nenhum valor negativo/float; dueCents e refundDueCents não podem ser positivos ao mesmo tempo; o estado Pago significa due=0 e refundDue=0 (ou sem obrigação de estorno), e não apenas existência de um payment. Uma mudança de valor não modifica retroativamente pagamentos, recibos, alocações ou movimentos passados.

### 5.1.1 Compatibilidade com a Spec de pagamento dividido

A Spec de pagamento dividido proíbe **pagamento parcial arbitrário na operação de cobrança**. Este novo fluxo preserva tal regra: cada cobrança confirmada recebe **todo o saldo devido nessa cobrança**, com uma ou várias formas. O estado "Parcialmente pago" surge apenas quando o valor de um pedido anteriormente quitado aumenta por edição posterior, e desaparece quando o saldo adicional é integralmente recebido.

Um receipt pode representar vários pedidos de um cliente ou de uma comanda. O valor já recebido **por pedido** vem de payments.amount_cents por pedido + lançamentos complementares efetivamente vinculados, não de repetir receipt.total_cents por cada pedido. Receipts, allocations e movimentos de um pagamento conjunto continuam representando um único dinheiro real, sem dupla contagem.

Finalizar pedido **não** quita eventual saldo pendente; o pedido continua em A receber mesmo que já esteja finalizado. A finalização só impede novas edições.

### 5.2 Evolução aditiva da persistência

- Preservar IDs, receipts, payment_allocations, payments.order_id UNIQUE e movimentos históricos. Nunca alterar pagamentos anteriores para adequá-los ao novo total, nem retirar a UNIQUE sem migração/prova de compatibilidade.
- Introduzir lançamentos adicionais imutáveis de liquidação/estorno por pedido, vinculados ao business_id, order_id, receipt_id quando recebimento, movimento de saída quando devolução, amount_cents, ID único, mutationId/idempotência, horário e operador. Recibos compartilhados devem possuir alocação atribuível a cada pedido sem replicar receita. Preservar o root payments.order_id UNIQUE, compatibilidade e dados legados; não introduzir remapeamento destrutivo. Nomes e constraints devem ser validados no plano e em integração D1.
- Novos recebimentos usam payment_receipts e payment_allocations reais e refletem em movimentos financeiros de entrada; devoluções registradas usam movimento de saída, sem criar entrada fictícia nem mexer no recibo anterior.
- Consultas de quitação, A receber, detalhe, agrupamento por cliente, relatórios, Dashboard, baixa da comanda e estorno precisam migrar para o saldo derivado, não para p.id IS NULL. Isso inclui explicitamente worker/orderPaymentReadModel.js, worker/orderReadSql.js, worker/orderPrintDocumentRepository.js, src/domains/orders/domain/orderPaymentEligibility.js, src/domains/finance/domain/receivables.js, src/app/workflows/payments/order/useOrderPaymentWorkflow.js, worker/reporting/financialAnalytics.js e worker/reporting/repository.js, entre outros consumidores. O comprovante atualizado não pode indicar 'Pago' só porque existe um receipt original se há saldo complementar.
- Uma baixa complementar só quita o saldo consultado/validado no servidor. O pagamento tradicional integral de pedido sem recebimentos continua compatível; recebimentos complementares passam pelo novo caminho, não por um segundo payment violando UNIQUE.
- Requerer baixa integral do **saldo da transação** (inclusive em múltiplos métodos) — não habilitar recebimentos arbitrariamente parciais por caixa. O estado parcialmente pago nasce somente de uma edição que aumentou o total já recebido.
- Permitir devoluções parciais reais até o limite de refundDueCents, com método registrado, autorização payments.refund e trilha de auditoria. Salvar um novo total menor **não** cria automaticamente movimento de saída; apenas a confirmação manual de devolução efetiva cria o movimento. Não criar integração bancária/Pix/cartão nem afirmar que o provedor devolveu dinheiro.
- Atualizar o cancelamento/estorno de pedidos com complementos ou devoluções parciais: ao cancelar, o estorno devido deve ser o **montante líquido recebido ainda não devolvido**, nunca somente payments.amount_cents. worker/orderCancellation.js hoje estorna a quantia do pagamento original, então precisa evoluir junto com a Fase B. Preservar cancelamentos e estornos legados e impedir devolução cumulativa maior que o valor recebido.
- As leituras worker/orderReadSql.js e worker/orderCancellation.js hoje fazem LEFT JOIN com movimentos de source='order-refund'; múltiplos estornos parciais não podem multiplicar registros de pedidos nem serem confundidos com um único refund_movement_id. Usar agregação/cardinalidade estável e diferenciar claramente estorno de edição de estorno de cancelamento, incluindo os relatórios.
- As alocações das novas receitas preservam a composição por forma, e o agrupamento por cliente/comanda não inventa vínculo de uma forma de pagamento específica a um pedido quando o recibo abrange vários pedidos.

### 5.3 A receber, recebimentos e comanda

- A receber lista um pedido se dueCents > 0, por valor restante, mesmo que haja payment anterior. A consulta por cliente deve agregar somente valores pendentes e não duplicar a venda.
- Uma baixa agrupada de vários pedidos só deve contabilizar o saldo agregado, validado em transação com revisão/snapshot de cada pedido afetado.
- Comanda aberta: pedidos de mesa continuam sem pagamento individual; edição altera somente pedidos ainda ativos e o saldo total oficial da comanda. Pedidos já finalizados continuam inelegíveis à edição, mas seus valores entram na quitação da comanda. O recebimento da comanda precisa validar o saldo agregado com guardas contra edição concorrente de qualquer pedido envolvido.
- Comanda já paga e fechada: não reabrir automaticamente a mesa, alterar receipt histórico nem criar ocupação. Edição do pedido ainda ativo gera saldo ou devolução vinculado ao pedido/recebimento original e é tratada por fluxo próprio, não por reabertura.
- Se um pedido foi pago/estornado ou contém movimentação de cancelamento, aplicar as regras de elegibilidade do lifecycle; não permitir editar pedido cancelado como atalho a estorno.
- Financeiro, fluxo de caixa, A receber, relatórios e Dashboard devem distinguir valor de venda atualizado de dinheiro efetivamente recebido/estornado para impedir dupla contagem.

### 5.4 Corridas e idempotência

- Toda edição de **conteúdo** do pedido exige expectedContentRevision e mutationId única e vinculada ao contexto da empresa; persistir content_revision e edited_at e rejeitar 409 quando a versão mudou. Pagamentos, cancelamento, finalização, recebimento por cliente/comanda e conversão de reserva também precisam participar de proteção concorrente bidirecional no commit, por versão/guardas de estado financeiro e lifecycle. Pode haver versão geral de coordenação, mas a **revisão de conteúdo divulgada na TV só muda por alteração operacional real**, nunca apenas por pagamento.
- Edição, finalização, cancelamento, conversão de reserva, baixa do pedido, baixa da comanda, baixa agrupada de cliente, geração de complemento e devolução precisam compartilhar guardas transacionais para que mudanças concorrentes não salvem versões incompatíveis.
- Repetir mesma mutationId deve retornar a mesma decisão/efeitos sem duplicar revisão, recebimento, devolução, impressão ou auditoria; replay com payload diferente é conflito.
- Após timeout/incerteza, consultar estado/recibo antes de repetir. Em conflito, preservar rascunho e pedir recarregamento/conferência; não fazer merge silencioso de edições simultâneas.
- Aplicar validação de sessão e empresa na mesma transação que a gravação; nenhuma leitura/ação pode acessar recursos de outro business_id.

## 6. Histórico, auditoria e permissão

- Propor migration aditiva que registre cada revisão de pedido e delta durável: autor (userId/actorName quando permitido), momento UTC, número de revisão, totais antes/depois e itens adicionados/removidos/modificados (quantidade, nota, preço), ajustes e identificação do cliente quando mudou.
- O log operacional é por pedido e legível nos detalhes/histórico; não usar texto livre do cliente como metadata ampla de segurança nem expor contatos sem autorização.
- Registrar em audit_events a ação de edição e seus IDs/revisões; não contar uma leitura/abertura de editor como edição.
- Adicionar capability orders.edit; gestor recebe por contrato canônico, operador integrado recebe explicitamente via migration controlada, perfis customizados só quando concedida. Capabilities orders.discount, payments.receive e payments.refund continuam exigidas nas respectivas ações.
- A TV só lê projeção operacional autorizada, sem API de alteração do pedido pelo pareamento restrito.

## 7. Cozinha, TV e controle remoto

- Mesma identidade do pedido: alterações atualizam card existente, não criam “novo pedido” nem reordenam toda fila sem necessidade operacional.
- Expor contentRevision, lastEditedAt e resumo operacional de delta (adicionado/removido/quantidade/nota) por leitura; evitar retransmitir snapshots financeiros/contatos ao token da TV. Uma baixa financeira não modifica contentRevision nem soa como edição na TV.
- Cozinha, TV e detalhes usam o selo **Editado**, com rótulo legível além da cor. Detalhes e Controle da TV exibem **Últimas alterações** com adição/remoção e antes/depois de quantidade/nota. A TV mostra somente os produtos atuais e o selo, preservando o layout original.
- Não há botão de ciência ou confirmação de leitura. ACKs antigos permanecem por compatibilidade/auditoria, sem condicionar o selo. Revisão não é pedido novo e não produz som retroativo.
- Usar o runtime realtime oficial da master, com eventos de edição/liquidação após commit e leituras autorizadas por superfície. Preservar fallback/reconciliação e temporizadores documentados em [realtime](../../operations/realtime-sync.md); não criar outro runtime.
- Preservar filtro Entrega/Retirada/Mesa, paginação, ocultação manual e layout adaptativo. Uma alteração não pode tornar pedido oculto visível à força nem quebrar posição/controle por página.
- TV aberta após alterações passadas conserva o selo sem tocar alerta retroativo.

## 8. Regras de fase e gates

### Fase A — Edição operacional segura

- Migração de revision/histórico/capability e comando transacional de edição.
- Edição de pedidos ainda não pagos e de pedidos já pagos **somente quando o novo total continuar igual ao recebido líquido**, sem habilitar saldo parcial.
- Pedidos de comanda aberta ainda não paga editáveis, com atualização oficial do total da comanda.
- UI desktop/mobile, diferenciais de preço e snapshots, aviso de TV/Cozinha, reimpressão opcional; sem nova impressão automática.
- Gate: nenhum caso pago com diferença é gravado antes da Fase B; recusa explícita sem persistir parte do rascunho.

### Fase B — Reconciliação financeira completa

- Evolução persistente de lançamentos complementares/devoluções parciais.
- Derivação de saldo no read model e todos os consumidores; edição com aumento/redução; Salvar/Salvar e receber; A receber; pagamentos avulsos/comanda quitada; devolução pendente e registro de devolução.
- Gating de concorrência com cobrança, baixa de comanda e recebimento por cliente. Migrações aditivas com dados legados de pagamento e quitação.
- Gate: só liberar edição com variação de total pago em staging depois de passar a matriz de testes financeiros, recibos compartilhados e cancelamento depois de complementos/estornos parciais; produção requer aprovação separada.

As fases A/B descrevem a execução histórica. A implementação atual inclui ambas; a integração de 16/10 migra também os novos leitores scoped e o lote misto de clientes. Fluxo financeiro incompleto continua bloqueando merge/release.

## 9. Critérios mínimos de aceite automatizado e manual

1. Editar item/nota/quantidade de pedido em preparo conserva ID, número, origem, ordem e permissões.
2. Item antigo conserva valor histórico ao mudar preço do catálogo; item novo usa preço atual validado.
3. No-op não cria revisão, impressão, recebimento ou alerta.
4. Pedido finalizado/cancelado/histórico rejeita edição; disputa edição × finalização/cancelamento não gera estado parcial.
5. Revisão stale, token de outra empresa, usuário sem orders.edit e mutation duplicada não alteram dados indevidamente.
6. Cozinha/TV exibem itens atuais e selo; Detalhes/Controle da TV exibem diferenças. Paginação, filtros e ocultação permanecem preservados.
7. Alertas de pedido novo e alterado não se confundem nem se repetem a cada polling; ocultação voluntária permanece.
8. Ao salvar, nenhum job novo; recusar reimpressão não faz nada; aceitar gera somente job manual com snapshot completo atual.
9. Job automático pending recebe atualização protegida do snapshot sem alterar jobs processando/impresso/descartado.
10. Editar pedido não pago e salvar mantém total correto em A receber; salvar e receber baixa somente saldo.
11. Pedido antes pago R$80 alterado para R$95 preserva os R$80 e gera R$15 a receber; complementar R$15 em múltiplas formas quita exatamente uma vez.
12. Pedido antes pago R$80 alterado para R$65 gera R$15 de devolução pendente; registrar devolução atualiza caixa sem apagar pagamentos.
13. Corridas pagamento × edição, devolução × edição, baixar comanda × edição e receber cliente × edição abortam/reconciliam sem duplicar movimento.
14. Comanda aberta reflete novo saldo; comanda fechada não reabre nem ganha pagamento individual indevido.
15. Dashboard, A receber, relatórios, histórico, recibos e movimentos permanecem coerentes; nenhuma receita duplicada, inclusive com recibos compartilhados de cliente/comanda.
15a. Pedido recebido R$80, depois acrescido em R$15: ao cancelar após complemento recebido, estorna R$95 no total; após devolução prévia de R$15, estorna somente R$80 remanescentes, sem duplicar.
15b. Dois ou mais estornos de edição não multiplicam linha de pedido, receita e movimentação.
15c. Ticket manual de pedido com saldo pendente não exibe 'Pago' apenas pela existência do primeiro recebimento.
16. Se Salvar e receber falhar depois de Salvar, pedido fica editado, saldo fica em aberto e operador recebe feedback correto.
17. Diferenças de pagamento e estorno são auditáveis, inclusive autor e revisão, sem vazamento interempresa.
18. Desktop/mobile, agendados, reservas antes/durante preparo, TV com paginação, QZ desconectado, segundo job e reconexão homologados em staging.
19. Regressões de impressão, pagamento dividido, recebimento agrupado por cliente, reservas/comandas, estornos, faturamento e permissões cobertas por testes existentes e novos.
20. Validar migração D1 em base limpa e upgrade, lint, build, testes automatizados, Validate e staging; homologação manual; **sem produção** antes de autorização.

## 10. Superfícies impactadas e ownership

- Backend: migrations/0042+ (a confirmar no plano), worker/repositories.js (ou novo owner isolado), worker/index.js, worker/orderCheckout.js, worker/orderReadSql.js, worker/orderPaymentReadModel.js, worker/paymentRepository.js, worker/orderCancellation.js, worker/tableTabDetailRepository.js, worker/orderPrintDocumentRepository.js, worker/orderPrintingRepository.js, worker/kitchenTvReadRepository.js, worker/access/*, worker/reporting/*.
- Frontend: src/domains/orders/*, src/app/workflows/payments/*, src/domains/finance/*, src/domains/table-service/*, src/domains/printing/* (reuso do caminho manual), src/kitchen-display/*, src/app/surfaces/kitchen-tv-control/*; App.jsx somente composição.
- Contratos compartilhados: shared/settingsAccess.js, shared/orderPrintDocument.js, helpers de dinheiro, identidade, timing e impressão existentes.
- Não criar runtime global paralelo, usar internal imports atravessando domínios, reimplementar receipt/alocação no módulo de Orders ou retornar a bridge legado de pagamentos.
- Não editar diretamente a master; criar branch de implementação somente após aprovação + plano.

## 11. Autorrevisão inicial — histórico de 10/10, anterior às decisões de UX da seção 7

**Risco alto identificado:** o modelo atual payments.order_id UNIQUE e os consumidores baseados em payment_id requerem evolução consistente antes de habilitar edição de pago com diferença; “corrigir somente A receber” seria insuficiente.

**Risco alto identificado:** concorrência entre edição e recebimento integral ou baixa de comanda; proteção por orderRevision deve entrar nos dois sentidos e cobrir recebimentos agrupados.

**Risco médio identificado:** histórico de uma linha deve distinguir produto/nota/quantidade sem perder preço original; usar IDs estáveis.

**Risco médio identificado:** impressão usa snapshot_json; edição de job pending é diferente de reimprimir; nunca alterar prova de documento já processado.

**Pontos propostos para ratificação:** (a) manter modalidade, mesa e data do pedido imutáveis na V1, enquanto a edição de reservas segue seu fluxo próprio; (b) ciência persistente do aviso à cozinha, separada da TV passiva; (c) devolução manual real pode ser parcial por uma forma por transação, sem integração bancária e sem reabertura de comanda.

### Achados corrigidos na revisão final

1. Compatibilidade da cobrança integral com o saldo residual criado por edição posterior.
2. Tratamento de receipts compartilhados sem duplicação de receita por pedido.
3. Estornos de cancelamento corrigidos pelo montante líquido efetivamente recebido, inclusive após complementos/devoluções.
4. Consultas financeiras por saldo derivado e prevenção de duplicação de pedidos por múltiplos JOINs de devolução.
5. Guardas atômicas recíprocas entre edição, baixa, cancelamento, finalização, reserva e comanda.
6. Preservação de snapshots antigos mesmo com produtos inativos e separação de revisão operacional e financeira.
7. Revisão e ciência da TV em projeção de leitura, sem conceder escrita à TV.

**Resultado histórico:** spec autorrevisada em 10/10, seguida de aprovação e implementação na PR #108. O acompanhamento vigente está no QA da integração; merge e produção continuam sujeitos aos gates e autorizações próprios.
