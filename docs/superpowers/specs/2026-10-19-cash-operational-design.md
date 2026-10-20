# Spec — Caixa Operacional, Entregadores e Recebimentos da Mesiva

**Versão:** 0.1 — proposta para revisão funcional e técnica
**Data:** 19/10/2026
**Baseline de consulta:** master f3f4e8a7305f49bb81dbf1997a98a57ca330d266
**Status:** documentação em DRAFT; NÃO IMPLEMENTADO; sem autorização para migrations, staging, merge ou produção
**Escopo:** Caixa operacional para 1 ou N caixas físicos, intenções e prazos de pagamento, entregadores e reconciliação de numerário, fechamento e transição do Financeiro.

> Acordos desta conversa foram consolidados como requisitos; onde a discussão não resolveu sem ambiguidades um contrato, o item está explicitamente marcado como **decisão pendente**. Esta spec não descreve as telas como já implementadas.

## 1. Motivação e princípios

O Financeiro atual guarda movimentos, pagamentos e recibos e possui A receber, mas não existe uma sessão física aberta/fechada por gaveta. O novo módulo deverá responder: quanto entrou fisicamente, quanto saiu, quanto deveria existir, quanto foi contado e a diferença, por sessão e por empresa. Deve permitir que clientes paguem dias depois **sem transformar contas a receber em diferença ou saldo negativo de caixa**.

**Invariantes:** (I-1) previsão não é pagamento; (I-2) pagamento não prova que numerário está na gaveta; (I-3) custódia do entregador não é custódia do caixa; (I-4) sangria e suprimento não são automaticamente despesa e receita; (I-5) um recibo canônico jamais se duplica por repasse; (I-6) o fechamento imobiliza a apuração da sessão, não reescreve lançamentos originais; (I-7) pedidos, empresas, comandas e permissões permanecem isolados; (I-8) todo valor monetário é integral em centavos no Worker/D1.

## 2. Decisões explícitas do produto

| Tema | Decisão |
| --- | --- |
| Capacidade | Um ou vários caixas por estabelecimento; experiência simplificada com um caixa |
| Autorizações | Grants por funcionário e escopo de caixa; sangria e suprimento não exigem aprovação a cada ação quando o operador possui autorização |
| Entregador | Nenhum app do entregador é obrigatório; há atualmente um entregador na operação piloto |
| Cozinha | "Saiu para entrega" permanece pertencendo à Cozinha e **não ganha um segundo botão no Caixa** |
| Pedido sem pagamento | Operador deve informar intenção: Dinheiro, Pix, Cartão ou A definir; "A definir" permite seguir |
| Previsão | O pedido pode ser pago em outra data e permanece em A receber |
| Dinheiro do entregador | Não entra na gaveta antes de repasse físico confirmado |
| Fechamento | Apura numerário físico esperado versus contado; cobrança futura não cria diferença; justificativa exigida quando diverge |
| Interface | Desktop prioritário, no padrão Mesiva, focado no dia; sem "Novo pedido" ou ação de despacho na tela de Caixa |
| Movimentações | A rota atual não deve simplesmente ser apagada; estudar substituição gradual e realocação de despesas/estornos |

## 3. Vocabulário e estados independentes

1. **Caixa físico:** gaveta/ponto de numerário cadastrado na empresa.
2. **Sessão:** abertura até fechamento de um caixa, inclusive cruzando a meia-noite; só uma sessão aberta por caixa.
3. **Intenção:** forma informada pelo cliente para pagamento futuro; jamais comprovante de pagamento.
4. **Promessa:** data esperada, opcional, já disponível em orders.promised_payment_date no modelo atual.
5. **Recebimento real:** recibo canônico e alocações por método, gravados pelos workflows oficiais.
6. **Previsão de cobrança do entregador:** saldo do pedido ainda não quitado sob responsabilidade de cobrança; **não** é dinheiro em poder do entregador.
7. **Numerário confirmado com entregador:** dinheiro que o funcionário atestou que o entregador recebeu do cliente; continua fora da gaveta.
8. **Repasse físico:** transferência de custódia do entregador para um caixa aberto, sem registrar segunda venda.
9. **A receber:** dívida do cliente, inclusive pagamento adiado e vencido; não afeta o saldo físico.
10. **Diferença de caixa:** valor contado menos valor físico esperado, somente daquela sessão.

**Separações de estados:** status do pedido (Em preparo/Agendado/Finalizado/Cancelado); despacho/ocorrência logística; intenção de pagamento; dívida real; dinheiro com entregador; repasse ao caixa; caixa aberto/fechado. Não inferir "entregue ao cliente" de "Finalizado" da Cozinha.

## 4. Jornada do Novo Pedido e intenção

**IP-01:** Ao não receber no checkout, exigir explicitamente uma seleção de intenção em {Dinheiro, Pix, Cartão, A definir}. A opção A definir é válida; nenhuma alocação de pagamento ou movimentação é criada.

**IP-02:** Perguntar quando pretende pagar: na entrega/retirada, outra data, ainda não informado. Se for outra data, validar calendário e data não anterior ao dia do negócio. Proibir data futura como "data de recebimento real" até o recebimento existir; os conceitos são distintos.

**IP-03:** Persistir intenção e contexto de expectativa em campos/versionamento próprios e exibi-los em detalhe/histórico. Não reutilizar payment_allocations nem movimentos como registros de intenção.

**IP-04:** A intenção pode mudar enquanto houver saldo pendente, com auditoria e autorização. Ao receber, as alocações efetivas têm precedência. A intenção histórica permanece consultável e não deve ser reclassificada silenciosamente.

**IP-05:** Usar orders.promised_payment_date e as regras de A receber existentes, sem ledger duplicado. Ao criar o pedido, definir contrato de gravação atômica pedido+promessa; a mutação posterior já exige finance.promises.manage. Concessão de permissão para informar a previsão **no próprio checkout** deverá ser formalizada no plano técnico, sem abrir edição geral de promessas a qualquer operador.

**IP-06:** Para comanda/mesa, a intenção por pedido é informativa; quitação integral da comanda continua no workflow oficial, sem atalho para receber pedido avulso associado a comanda. Reserva futura também não equivale a pagamento.

**IP-07:** Não obrigar intenção de pagamento nos pedidos quitados imediatamente: a composição efetiva atual permanece a fonte da verdade.

## 5. Entregadores, despacho e prestação de contas

**EN-01:** Cadastrar entregadores ativos/inativos por empresa; permitir um padrão. Na operação com um único entregador ativo/padrão, atribuição sugerida/automática no despacho, com override autorizado e rastreio. Quando houver vários, exigir seleção ou registrar explicitamente "não atribuído" como pendência operacional, sem atribuir aleatoriamente.

**EN-02:** A ação de Cozinha "Saiu para entrega" deve continuar chamando o comando oficial de finalização do pedido. No código auditado, usa status Finalizado e mensagem da UI "Pedido saiu para entrega". Acrescentar identidade/instante de despacho em registro **separado**, atômico ou reconciliável com a finalização; não introduzir outro botão com essa ação na tela Caixa e não equiparar o despacho a entrega concluída.

**EN-03:** A visualização do entregador mostra pedidos despachados, intenção, promessa, valor ainda devido, cobrança prevista e incidentes. Valor com promessa para outra data não integra o total exigível na entrega, embora o pedido permaneça consultável. A atribuição não declara dinheiro recebido.

**EN-04:** Prestação de contas sem app do entregador: funcionário autorizado confere cada entrega: entregue/pago; entregue/não pago com promessa nova; não entregue/nova tentativa; não entregue/cancelamento por fluxo autorizado; paga em método diferente. Situação logística de entrega após despacho é um registro adicional, não sobrescrita indevida do estado da Cozinha.

**EN-05:** Ao mudar Dinheiro previsto para Pix/Cartão real, registrar exclusivamente a forma efetivamente confirmada no workflow oficial. Pix/cartão nunca aumentam caixa físico; não afirmar confirmação bancária automática sem integração externa. A data financeira oficial do recibo segue o contrato vigente.

**EN-06:** Se o cliente não paga e promete outra data, continuar no A receber, atualizar promessa com permissão, registrar ocorrência de cobrança e retirar a expectativa de numerário imediato. Não registrar "recebido com entregador" nem diferença na gaveta.

**EN-07:** Dinheiro em espécie efetivamente confirmado como cobrado pelo entregador deve ter custódia "entregador", com valor, pedido/recibo e identidade. Registrar recibo **uma única vez**. A posterior transferência ao caixa gera um evento de custódia, **nunca um segundo payment_receipt** nem nova receita.

**EN-08:** Repasse integral ou parcial precisa selecionar caixa aberto e autorizado; comparar valor entregue com custódia pendente. Repasse menor reduz somente o dinheiro sob responsabilidade do entregador; o restante permanece pendente para próximas prestações de contas, sem ser deficiência da gaveta. Proibir repasse superior ao saldo de custódia sem fonte comprovada.

**EN-09:** Se o funcionário só confirmar cobrança e repasse no retorno, pode haver uma ação de prestação de contas que crie, em uma única transação autoritativa, recibo/alocações canônicos + confirmação de custódia + repasse físico, mantendo a rastreabilidade dos fatos. Se a cobrança havia sido confirmada antes, repasse **somente transfere custódia**. Nunca duplicar os recibos.

**EN-10:** Troco entregue antecipadamente ao entregador é transferência de numerário à sua custódia, não despesa nem venda; preservar o fundo enviado, troco dado ao cliente e devolução. **Decisão pendente:** política de repasses com troco e se entra na primeira entrega ou versão posterior.

**EN-11:** Pagamento insuficiente/recebimento parcial arbitrário não poderá contornar regras atuais que exigem quitação autoritativa integral por recibo. Preservar ocorrência/pendência e encaminhar para resolução autorizada sem falsear pedido Pago. **Decisão pendente:** suporte financeiro a pagamento parcial genuíno como evolução posterior.

## 6. Cadastro, sessões e autorização de caixa

**CX-01:** Empresa pode manter 1..N caixas, com nome único por empresa, estado ativo/inativo e histórico imutável. Inativação não pode ocorrer com sessão aberta.

**CX-02:** Uma única sessão aberta por caixa (restrição efetiva no banco), vários caixas simultaneamente, sem abrir segunda sessão por clique duplo/concorrrência.

**CX-03:** Funcionários autorizados podem compartilhar sessão, sempre identificados individualmente em cada operação. Abrir solicita fundo inicial não negativo em centavos, responsável e instante. Abertura não constitui receita. Sessões podem atravessar dia civil; escolher data financeira pelo evento de pagamento, e custódia pela sessão física efetiva.

**CX-04:** Seleção automática quando existir um único caixa aberto e autorizado; com vários, o operador escolhe ou utiliza preferência contextual validada. Nunca lançar dinheiro em caixa arbitrário por default silencioso.

**CX-05:** Capabilities de projeto: cash.view, cash.open, cash.use, cash.withdraw, cash.supply, cash.transfer, cash.close, cash.correct, cash.history.view, cash.manage, em conjunto com vínculo de caixa. payments.receive continua obrigatório para registrar pagamento; cash.use controla a custódia física, não concede poderes gerais de Financeiro.

**CX-06:** Gestor poderá conceder individualmente sangria e suprimento; sem approval hop por transação para quem tiver grants efetivos. Bloqueios são validados no Worker, não só por botão oculto; revogação deve surtir efeito na próxima mutation. Papel "Operador" não recebe poderes por simples identidade do nome.

**CX-07:** Saldo físico esperado pode ser zero; sangria e transferência de saída são limitadas ao saldo esperado disponível, sob concorrência atômica. Valores devem ser inteiros positivos em centavos; em exceções operacionais, diferença física é registrada no fechamento, nunca suprida silenciosamente com "ajuste" automático.

## 7. Lançamentos físicos, regras de cálculo e correção

**OP-01:** Sangria: exige sessão aberta, cash.withdraw, valor positivo <= saldo, destino/motivo obrigatórios, usuário e hora factual. É movimento físico, não automaticamente despesa.

**OP-02:** Suprimento: exige sessão aberta, cash.supply, valor positivo e origem/motivo obrigatórios. É acréscimo de numerário, não automaticamente faturamento.

**OP-03:** Transferência: exige origem/destino distintos, abertos, autorizados, valor válido; saída+entrada na mesma transação, valor líquido consolidado zero.

**OP-04:** Despesa realmente paga com dinheiro de caixa: apenas um fato físico/financeiro, com vínculo único e sem dupla sangria. **Decisão pendente:** criar fluxo específico de despesa em numerário na v1 ou manter gestão de despesas fora do Caixa até módulo de contas/finanças separado.

**OP-05:** Estorno/devolução: apenas diminui gaveta quando saída em espécie efetivamente confirmada **nesta sessão**. Não confundir registrar estorno bancário/documental com saída física.

**OP-06:** Correção: nunca editar/excluir o evento original ligado ao caixa/fechamento; usar reversão compensatória auditável e referenciada, com cash.correct. Operações bancárias e recibos devem ser corrigidos pelo workflow financeiro apropriado, nunca por mutação física inventada.

**OP-07:** Cada comando financeiro exige chave de idempotência e verificação de revisão/estado; replay idêntico devolve resultado anterior e replay divergente gera conflito. Falha após gravação deve reconciliar no servidor antes de nova execução.

**OP-08:** Saldo esperado da sessão = fundo inicial + entradas físicas confirmadas + suprimentos + transferências recebidas - sangrias - transferências enviadas - devoluções/saídas físicas confirmadas. Não incluir recebimentos Pix/cartão, vendas não pagas, promessas, cobrança prevista ou dinheiro ainda com entregador.

**OP-09:** O saldo inicial global de finance_settings (fluxo financeiro por empresa, possivelmente negativo) é independente do fundo físico da sessão (>=0). Não migrar nem reutilizar o primeiro automaticamente como abertura de gaveta.

## 8. Fechamento, divergências e pagamentos futuros

**FC-01:** Fechamento exige cash.close, sessão aberta e contagem física >= 0. Registrar esperado, contado, diferença = contado - esperado, responsável, instante, justificativa se diferença != 0, composição e snapshot da sessão; encerrar de forma autoritativa.

**FC-02:** Valores de clientes ainda a receber (inclusive promessa de pagamento em dias futuros) ficam em painel informativo e **não alteram saldo esperado nem diferença**. Mesmo se o cliente originalmente pretendia pagar na entrega, adiar o pagamento não torna o caixa negativo nem o entregador devedor.

**FC-03:** Numerário realmente recebido pelo entregador e ainda não repassado continua na custódia do entregador, separado do caixa; não causa diferença da gaveta e não impede automaticamente fechar o caixa. Deve aparecer em alerta de pendência.

**FC-04:** Antes do fechamento, impedir operações físicas da sessão com resultado desconhecido/em voo; exigir reconciliação. Bloquear gravações posteriores na sessão encerrada. Uma cobrança futura/repasse posterior entra na sessão real futura, nunca altera a conferência encerrada.

**FC-05:** Fechamento com diferença é permitido com justificativa e indicador visível; não faz acerto financeiro automático. O gestor pode consultar/resolver por evento compensatório posterior, preservando o original.

**FC-06:** Fechamento não cancela pedidos, não registra recebimentos automáticos nem muda data comercial/financeira para "encaixar o dia". Registros oficiais de recebimento preservam received_date e paid_at/created_at factual.

## 9. Telas e navegação — desktop prioritário

**Tela Caixa do dia:** cabeçalho Financeiro / Caixa; seletor de caixa autorizado (ou único pré-selecionado); status Aberto/Fechado; cartões Saldo físico esperado, Dinheiro recebido em sessão, Cobranças na rota e Custódia de entregadores aguardando repasse. Painel central grande com composição do saldo + Sangria / Suprimento / Transferir / Fechar, e Abertura quando fechado. Lista apenas de pedidos **relevantes para recebimento/conferência operacional**, não catálogo geral; últimas operações auditáveis e separação explícita do A receber. Nunca incluir Novo pedido nem outro botão Saiu para entrega.

**Tela Prestação de contas do entregador:** responsável, pedidos atribuídos, intenção original e forma efetiva, status logístico, dívida/cobrança esperada, campos de conferência, dinheiro confirmado e saldo ainda em posse; seletor de caixa de destino; salvar pendências sem falsa quitação; confirmação transacional. Quando "outra data", oferecer ligação ao A receber.

**Tela Fechamento:** composição, campo dinheiro contado, diferença instantânea, justificativa condicional, repasses pendentes informativos, detalhes e confirmação. Ver distinção visual entre dinheiro faltando na gaveta e pagamento futuro.

**Telas auxiliares:** cadastro de caixas e entregadores; configurações de permissões; histórico paginado por sessão/caixa; detalhes dos eventos e estornos; A receber como owner da cobrança futura.

**Visual:** consultar [Design System](../../design/DESIGN_SYSTEM.md) e [guia Mesiva v1.1](../../design/identidade-visual/README.md), ambos vigentes no repositório; reutilizar componentes e temas claro/escuro, tokens e logos versionados, não copiar valores/legendas artificiais dos mockups. Meta: leitura rápida e densidade útil; desktop primeiro, responsividade e acessibilidade antes de produção.

## 10. Contratos lógicos de dados (a validar na fase de plano técnico)

| Entidade lógica | Identidade/relacionamento mínimo | Propósito |
| --- | --- | --- |
| cash_register | id + business_id, nome, active, created_at | Caixa físico |
| cash_register_grant | business_id + caixa + principal, abilities/scopes | Escopo por funcionário e caixa |
| cash_session | id + register_id + business_id, open/close, fundo, operador, snapshot | Ciclo físico |
| cash_operation | id + business_id + session_id, cents, kind, reference, user/time, reversal | Livro imutável de numerário |
| delivery_courier | id + business_id, nome, active/default | Cadastro de entregador |
| delivery_assignment | id + business_id + order_id, courier_id, dispatch instant, revision | Responsabilidade no despacho |
| delivery_outcome | id + business_id + assignment/order, status/observação/time | Resultado da entrega, sem alterar status da Cozinha |
| delivery_cash_custody | id + business_id + courier + order/receipt, cash cents, outstanding | Valor confirmado em posse do entregador |
| delivery_cash_remittance | id + business_id + courier, session + cents, source refs | Repasse físico, sem novo recibo de venda |
| order payment intent | ligado a orders, método/intenção, momento esperado, auditado | Expectativa sem efeito financeiro |

Esses são **nomes conceituais**, não migrations aprovadas. Definir chaves compostas e FKs por business_id, unicidade, serialização, revisões, auditoria, constraints e minimização de writes antes do DDL. Evitar duplicar a verdade de payments, payment_receipts, payment_allocations e movements. O fato físico pode referenciar o receipt/allocation oficial para conciliação.

## 11. Integrações e segurança

- **Cozinha:** chamada oficial updateOrderStatus('Finalizado') permanece owner de "Saiu para entrega" para Entrega. A atribuição logística deve acompanhar o evento sem falsear entrega ou pagamento.
- **Recebimentos:** reaproveitar workers/paymentRepository, novos recibos somente pelos métodos oficiais; respeitar split allocation, comanda integral, pagamentos por lote, complementos e estornos.
- **A receber:** aproveitar orders.promised_payment_date, filtros e permissionamento atual; evitar segundo ledger de dívida.
- **Financeiro:** nenhuma remoção imediata do recurso Movimentações; preservar categorias, saldo financeiro histórico, lançamento manual e estornos; descontinuar superfície só após migração funcional explicitamente aprovada e testes.
- **Multiempresa:** identidade da empresa derivada do contexto autenticado, FKs compostas e grants do Worker; nenhum ID de caixa ou entregador de outra empresa é aceito.
- **Reatividade:** Worker/D1 são autoridade; eventos apenas invalidam snapshots por superfície. Sem polling novo por card, sem N+1, sem carregar histórico inteiro; leituras paginadas e totais do servidor.
- **Compatibilidade:** ativação progressiva por empresa; caixa desativado não bloqueia recebimentos já existentes; nenhum dado histórico do financeiro presumido como "gaveta" nem backfill fictício.
- **Ações assíncronas:** conflito, offline, reconnect, replay idempotente, troca de empresa/permissões e sessão fechada devem dar erro explícito sem movimento duplicado.

## 12. Matriz de aceite/homologação (proposta)

| ID | Cenário | Resultado |
| --- | --- | --- |
| QA-01 | Pedido não pago, intenção Dinheiro | Criado sem receipt/movement; cobrança prevista |
| QA-02 | Pedido não pago, A definir | Pedido permitido e não quitado |
| QA-03 | Pagar em outra data | Promessa válida em A receber, sem caixa físico |
| QA-04 | Data prometida inválida ou anterior a hoje | Bloqueio no backend |
| QA-05 | Promessa vencida | Permanece A receber, não vira diferença física |
| QA-06 | Dinheiro prometido na entrega mas não recebido | Sem recibo e sem dívida do entregador |
| QA-07 | Dinheiro prometido hoje, paga Pix amanhã | Só recibo Pix na data efetiva, sem gaveta |
| QA-08 | Recibo dividido Dinheiro + Pix | Só parcela cash integra custódia física |
| QA-09 | Comanda paga integral | Uma quitação oficial, nenhum pagamento avulso duplicado |
| QA-10 | Despacho pela Cozinha | Único status oficial + atribuição logística; sem pagamento automático |
| QA-11 | Courier padrão único | Atribuição correta; não declara entregue |
| QA-12 | Vários couriers | Seleção/pendência auditada; sem atribuição aleatória |
| QA-13 | Pedido não entregue | Registro logístico separado; cobrança continua pendente |
| QA-14 | Cliente adia após despacho | Sai de cobrança imediata; permanece A receber |
| QA-15 | Confirmar cobrança com courier | Custódia muda; gaveta ainda zero |
| QA-16 | Repasse integral | Custódia courier reduz; gaveta sobe uma vez |
| QA-17 | Repasse parcial | Resto permanece com courier; gaveta só recebe o parcial |
| QA-18 | Replay de repasse após timeout | Não duplica receipt nem operação física |
| QA-19 | Mudar intenção Dinheiro para Cartão | Fluxo efetivo respeitado sem dinheiro físico |
| QA-20 | Abre um caixa com fundo zero | Sessão aberta; saldo zero |
| QA-21 | Dois usuários abrem o mesmo caixa | Uma sessão apenas; segundo recebe conflito |
| QA-22 | Abre dois caixas distintos | Sessões simultâneas autorizadas |
| QA-23 | Operador sem grant faz sangria | 403 no Worker |
| QA-24 | Usuário autorizado realiza sangria | Reduz apenas saldo físico |
| QA-25 | Sangria maior que saldo | Negada em concorrência |
| QA-26 | Suprimento | Aumenta saldo sem aumentar faturamento |
| QA-27 | Transferência entre caixas | Débito/crédito atômico, líquido zero na empresa |
| QA-28 | Despesa física + sangria redundante | Não desconta duas vezes |
| QA-29 | Devolução em Pix/cartão | Não retira numerário da gaveta |
| QA-30 | Devolução efetiva em espécie | Retira uma vez da sessão responsável |
| QA-31 | Fundo inicial x finance_settings | Sem confusão/migração automática |
| QA-32 | Fechamento contado = esperado | Diferença zero |
| QA-33 | Fechamento divergente | Justificativa obrigatória e histórico imutável |
| QA-34 | Fechar com contas a receber futuras | Permitido sem diferença física |
| QA-35 | Fechar com courier ainda devendo repasse | Permitido com alerta de custódia |
| QA-36 | Operação com resultado desconhecido | Fechamento bloqueado até reconciliação |
| QA-37 | Gravar em sessão já fechada | Bloqueio, sem movimentação |
| QA-38 | Revogar grant no meio do fluxo | Nova mutation recusada |
| QA-39 | Alternar empresa/dispositivo/offline | Não mistura dados ou confirma indevidamente |
| QA-40 | Legacy histórico Financeiro | Sem perda de registros/estornos/categorias/CSV |
| QA-41 | Caixa opt-out | Recebimento atual permanece funcional |
| QA-42 | F5, deep links, tema, teclado, foco | UI íntegra em desktop e mobile ao lançar |
| QA-43 | 10k pedidos + várias sessões | Queries indexáveis, sem N+1 nem histórico global |
| QA-44 | Concorrência fechamento vs pagamento | Nunca grava em sessão fechada ou perde crédito |
| QA-45 | Recibo retroativo posterior | Não altera caixa já fechado; datas oficiais preservadas |

## 13. Fases candidatas — sem implementação autorizada

1. Modelo e UI de intenção de pagamento e reuso da promessa em pedido/A receber.
2. Cadastro de entregadores e associação ao despacho oficial da Cozinha.
3. Cadastro e abertura de caixas, escopos/grants por usuário.
4. Livro físico, integrações com recebimentos, sangria, suprimento e transferências.
5. Prestação de contas do entregador, custódia, repasses e ocorrências.
6. Conferência, fechamento e histórico; migração gradual de navegação Financeiro.

Cada fase exige planejamento separado com riscos, migrations aditivas, rollback, testes backend/frontend/realtime, custo D1, CI, staging e homologação humana. Publicação remota, merge e produção dependem de autorização explícita.

## 14. Pendências para revisão antes do plano técnico

**PD-01 — Escopo da primeira entrega:** incluir ou adiar controle formal do troco em posse do entregador.

**PD-02 — Gastos/Movimentações:** preservar despesas manuais em área financeira própria provisoriamente ou criar nova superfície de "Despesas" já nesta iniciativa. A exclusão da rota atual não está aprovada.

**PD-03 — Recebimento parcial genuíno:** manter como pendência e não falsear quitação, ou ampliar o fluxo financeiro em iniciativa independente.

**PD-04 — Data de promessa no checkout:** regra de autorização para operador de pedido sem conceder edição retroativa geral; definir e homologar.

**PD-05 — Confirmação de cobrança pelo entregador:** na v1 só pela prestação de contas no restaurante; se houver confirmação de cobrança antes de repasse, definir qual operador e quais provas são exigidas.

**PD-06 — Caixa físico habilitado sem sessão aberta:** precisar mecanismo de transição para não bloquear o checkout legado durante implantação; decidir comportamento de bloqueio do dinheiro físico após opt-in.

**PD-07 — Consultas gerenciais:** políticas de fechamento cego, acesso ao valor esperado e limitação de visibilidade por grant.

**PD-08 — Evidências de protótipos:** capturas anteriores foram exploratórias e não constituem UI implementada; validar coerência dos estados e campos com esta spec antes de aprovar a tela final.

## 15. Referências normativas e evidências

- [Business Rules](../../product/BUSINESS_RULES.md): RN-AC, RN-TEM-06, RN-PAG, RN-MES e RN-FIN.
- [Module Map](../../architecture/MODULE_MAP.md): owners do domínio.
- [Design System](../../design/DESIGN_SYSTEM.md) e [Guia Mesiva v1.1](../../design/identidade-visual/README.md).
- [Regras de promessa](../../../worker/orderPaymentPromise.js) e [UI A receber](../../../src/domains/finance/ui/Receivables.jsx).
- [Comando atual da Cozinha](../../../src/domains/orders/application/useOrderCommands.js).
- [Composição de pagamentos](../../../worker/paymentRepository.js).
- [Movimentações](../../../worker/financeRepository.js) e [Finance UI](../../../src/domains/finance/ui/Finance.jsx).
- [Autorização](../../../shared/settingsAccess.js) e [perfis](../../../worker/access/roles.js).
- [Auditoria técnica desta proposta](2026-10-19-cash-operational-technical-audit.md).

**Gate:** esta versão é documental e necessita revisão/aceite do usuário. Nenhum item pendente será tratado silenciosamente como aprovado.
