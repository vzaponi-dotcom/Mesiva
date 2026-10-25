# Spec — Caixa Operacional, Entregadores e Recebimentos da Mesiva

**Versão:** 0.5 — decisões funcionais PD-01 a PD-07 aprovadas; PD-08 e contratos técnicos permanecem pendentes
**Atualização:** 20/10/2026 (PD-07: contagem cega do operador com visibilidade gerencial; PD-01 a PD-06 preservadas)
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
| Troco antecipado ao entregador | **Aprovado para a primeira versão**: fundo de troco transferido à custódia do entregador, reconciliado no retorno, sem despesa/receita fictícia |
| Fechamento | Apura numerário físico esperado versus contado; cobrança futura não cria diferença; justificativa exigida quando diverge |
| Contagem cega (PD-07) | **Aprovado:** operador preenche primeira contagem sem consultar saldo esperado; acesso prévio ao esperado depende de permissão gerencial efetiva, verificada no Worker |
| Interface | Desktop prioritário, no padrão Mesiva, focado no dia; sem "Novo pedido" ou ação de despacho na tela de Caixa |
| Organização do Financeiro | **Aprovado:** Visão geral (com aba Extrato), Caixa, A receber, Despesas e Relatórios; despesas financeiras separadas do caixa físico |
| Movimentações legadas | A migração funcional será gradual; **não** remover rota, histórico, lançamentos manuais, estornos ou recursos existentes antes de substituição e homologação |
| Ativação gradual | **Aprovado:** opt-in por restaurante, configuração prévia, primeira abertura com valor físico contado e exigência de caixa aberto/autorizado para dinheiro físico após ativação |
| Pagamentos parciais | **PD-03 aprovada:** suporte completo adiado para evolução futura; identificar exceção/pendência sem quitação fictícia, recibo parcial improvisado ou suprimento indevido |
| Permissão da promessa | **PD-04 aprovada:** operador autorizado a criar pedido informa intenção/previsão na criação; alterações posteriores exigem capability específica |
| Conferência do entregador | **PD-05 aprovada:** cobrança em espécie é confirmada pelo funcionário na prestação de contas quando o entregador retorna; Pix/cartão podem ser confirmados separadamente pelo workflow oficial |

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

**IP-04 (PD-04 aprovada):** A intenção pode mudar enquanto houver saldo pendente, com auditoria e autorização **específica para edição posterior**, não derivada apenas de orders.create. Ao receber, as alocações efetivas têm precedência. A intenção histórica permanece consultável e não deve ser reclassificada silenciosamente.

**IP-05 (PD-04 aprovada):** Usar orders.promised_payment_date e as regras de A receber existentes, sem ledger duplicado. **Na criação do pedido**, o funcionário autorizado a criar pedidos (`orders.create`) pode informar intenção, momento esperado e promessa sem permissão adicional de gestão de promessas; o Worker valida os campos e grava o pedido+expectativa atomicamente. **Após a criação**, alterar promessa existente exige a capability específica já vigente `finance.promises.manage`; editar intenção/momento posteriormente também requer autorização específica do Worker (reutilizar a capability pertinente ou definir outra granularidade no plano técnico), sem conceder esse poder automaticamente a `orders.create`. O contrato de validação, autoria e efeitos deve ser formalizado no plano técnico; usuário sem capacidade de receber pagamentos não adquire `payments.receive` por informar intenção.

**IP-06:** Para comanda/mesa, a intenção por pedido é informativa; quitação integral da comanda continua no workflow oficial, sem atalho para receber pedido avulso associado a comanda. Reserva futura também não equivale a pagamento.

**IP-07:** Não obrigar intenção de pagamento nos pedidos quitados imediatamente: a composição efetiva atual permanece a fonte da verdade.

## 5. Entregadores, despacho e prestação de contas

**EN-01:** Cadastrar entregadores ativos/inativos por empresa; permitir um padrão. Na operação com um único entregador ativo/padrão, atribuição sugerida/automática no despacho, com override autorizado e rastreio. Quando houver vários, exigir seleção ou registrar explicitamente "não atribuído" como pendência operacional, sem atribuir aleatoriamente.

**EN-02:** A ação de Cozinha "Saiu para entrega" deve continuar chamando o comando oficial de finalização do pedido. No código auditado, usa status Finalizado e mensagem da UI "Pedido saiu para entrega". Acrescentar identidade/instante de despacho em registro **separado**, atômico ou reconciliável com a finalização; não introduzir outro botão com essa ação na tela Caixa e não equiparar o despacho a entrega concluída.

**EN-03:** A visualização do entregador mostra pedidos despachados, intenção, promessa, valor ainda devido, cobrança prevista e incidentes. Valor com promessa para outra data não integra o total exigível na entrega, embora o pedido permaneça consultável. A atribuição não declara dinheiro recebido.

**EN-04:** Prestação de contas sem app do entregador: funcionário autorizado confere cada entrega: entregue/pago; entregue/não pago com promessa nova; não entregue/nova tentativa; não entregue/cancelamento por fluxo autorizado; paga em método diferente. Situação logística de entrega após despacho é um registro adicional, não sobrescrita indevida do estado da Cozinha.

**EN-05 (PD-05 aprovada):** Ao mudar Dinheiro previsto para Pix/Cartão real, registrar exclusivamente a forma efetivamente confirmada no workflow oficial. A confirmação de Pix/cartão pode ocorrer independentemente da volta do entregador, por usuário habilitado no fluxo oficial de recebimento, com verificação aplicável; não criar dependência artificial da prestação de contas. Pix/cartão nunca aumentam caixa físico; não afirmar confirmação bancária automática sem integração externa. A data financeira oficial do recibo segue o contrato vigente.

**EN-06:** Se o cliente não paga e promete outra data, continuar no A receber, atualizar promessa com permissão, registrar ocorrência de cobrança e retirar a expectativa de numerário imediato. Não registrar "recebido com entregador" nem diferença na gaveta.

**EN-07 (PD-05 aprovada):** Sem app do entregador nem confirmação automática no despacho, a cobrança em espécie feita pelo entregador **só será confirmada pelo funcionário autorizado na prestação de contas, no retorno**. Até essa conferência, a intenção e a saída da Cozinha não geram recibo de dinheiro cobrado nem custódia confirmada de venda. Depois da conferência, dinheiro efetivamente confirmado como cobrado fica com custódia "entregador", com valor, pedido/recibo, responsável pela confirmação e identidade do entregador. Registrar o recibo oficial **uma única vez**. A posterior transferência ao caixa gera evento de custódia, **nunca um segundo payment_receipt** nem nova receita.

**EN-08:** Repasse integral ou parcial precisa selecionar caixa aberto e autorizado; comparar valor entregue com custódia pendente. Repasse menor reduz somente o dinheiro sob responsabilidade do entregador; o restante permanece pendente para próximas prestações de contas, sem ser deficiência da gaveta. Proibir repasse superior ao saldo de custódia sem fonte comprovada.

**EN-09 (PD-05 aprovada):** No retorno, a prestação de contas conduzida por funcionário autorizado é o momento de confirmar cobrança em **dinheiro** do entregador e apurar custódia/repasse, em uma operação autoritativa e idempotente conforme o contrato técnico. Se cobrança e repasse ocorrerem no mesmo ato, criar, de modo consistente, recibo/alocações canônicos + confirmação de custódia + repasse físico, com rastreabilidade e **sem dupla venda**. Se Pix/cartão já foram confirmados antes pelo fluxo oficial, a prestação de contas apenas consulta esses recebimentos e não os repete. Se o dinheiro confirmado ainda não foi fisicamente entregue, manter custódia pendente com o entregador. Nunca duplicar recibos.

**EN-10 — Troco do entregador (APROVADO PARA V1):** A Mesiva deve permitir retirar um fundo de troco de uma sessão física aberta, sob autorização e saldo disponível, e vinculá-lo à custódia de um entregador e à saída da rota. Não criar despesa, receita ou recibo de venda para esse adiantamento.

**EN-10a:** Quando o cliente pagar em dinheiro, registrar: valor bruto recebido, valor efetivamente devolvido ao cliente como troco, valor líquido da venda, identificação do pedido e responsável pela conferência. Uma venda de R$ 65,00 paga com R$ 100,00 e troco de R$ 35,00 vale R$ 65,00 de receita, ainda que o entregador tenha recebido fisicamente R$ 100,00.

**EN-10b:** Saldo físico do entregador = fundo de troco recebido + dinheiro bruto recebido de clientes - troco pago a clientes - repasses confirmados - devoluções/transferências autorizadas. Todos os fatos em centavos, vinculados a eventos, com validação de saldo e proteção contra concorrência. Troco insuficiente ou divergente deve gerar ocorrência e não acerto silencioso.

**EN-10c:** No retorno, conferir separadamente (i) valor de vendas em dinheiro e (ii) fundo de troco/adiantamento que retorna. Exemplo: fundo de R$ 50,00, venda de R$ 65,00, cliente entrega R$ 100,00 e recebe R$ 35,00; entregador deve trazer R$ 115,00, sendo R$ 50,00 de fundo e R$ 65,00 de venda. O repasse aumenta a gaveta fisicamente em R$ 115,00; o saldo consolidado do restaurante cresce R$ 65,00 considerando a saída prévia do fundo. Criar **um único** recibo canônico pela venda, nunca outro pelo fundo ou pelo repasse.

**EN-10d:** Permitir repasses parciais do valor que o entregador deve, mantendo diferença como custódia pendente, com justificativa e visibilidade, mesmo se a sessão que enviou o fundo já tiver sido fechada. O repasse é registrado na sessão realmente aberta que receber o dinheiro; nunca voltar a modificar uma sessão encerrada. Proibir repasse acima da custódia comprovada sem operação específica autorizada.

**EN-11 (PD-03 aprovada):** **Suporte financeiro completo a pagamentos parciais fica fora da primeira versão** do Caixa e será objeto de evolução independente. Pedido de R$ 100 com pagamento real de R$ 60 e saldo de R$ 40 não é equivalente ao split R$ 60 Pix + R$ 40 dinheiro quitado no mesmo recebimento. A primeira versão deve permitir **identificar ocorrência/pagamento insuficiente informado e saldo ainda em aberto**, para tratamento autorizado, sem alterar o status para Pago, emitir recibo de quitação parcial improvisado, apagar dívida, nem classificar dinheiro de cliente como suprimento ou receita fictícia. Caso exista dinheiro parcialmente recebido fisicamente, **não fingir que o valor inexiste nem lançar em gaveta sem reconciliação**: o contrato específico de tratamento e custódia da exceção requer resolução técnica e operacional antes de habilitar essa aceitação em produção. A interface não deve incentivar receber parcialmente na v1 sem fluxo consistente.

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

**OP-04:** Despesa realmente paga com dinheiro de caixa: apenas um fato físico/financeiro, com vínculo único e sem dupla sangria. O **local funcional aprovado** para registrar despesas é Financeiro > Despesas, independente do Caixa. Se a despesa for efetivamente paga com numerário de gaveta, seu efeito físico deve ocorrer uma única vez, associado a uma sessão aberta/autorizada, sem sangria duplicada; despesas por Pix, cartão ou transferência não alteram a gaveta. **Permanece pendente:** contrato técnico, tratamento das despesas manuais legadas e sequência de disponibilização da operação integrada de despesa em dinheiro na v1.

**OP-05:** Estorno/devolução: apenas diminui gaveta quando saída em espécie efetivamente confirmada **nesta sessão**. Não confundir registrar estorno bancário/documental com saída física.

**OP-06:** Correção: nunca editar/excluir o evento original ligado ao caixa/fechamento; usar reversão compensatória auditável e referenciada, com cash.correct. Operações bancárias e recibos devem ser corrigidos pelo workflow financeiro apropriado, nunca por mutação física inventada.

**OP-07:** Cada comando financeiro exige chave de idempotência e verificação de revisão/estado; replay idêntico devolve resultado anterior e replay divergente gera conflito. Falha após gravação deve reconciliar no servidor antes de nova execução.

**OP-08:** Saldo esperado da sessão = fundo inicial + entradas físicas confirmadas (inclusive repasses de entregador) + suprimentos + transferências recebidas - sangrias - transferências enviadas - fundos de troco enviados ao entregador - devoluções/saídas físicas confirmadas. Não incluir recebimentos Pix/cartão, vendas não pagas, promessas, cobrança prevista ou dinheiro ainda com entregador. No repasse, valor do fundo que retorna aumenta fisicamente a gaveta, mas não gera faturamento.

**OP-09:** O saldo inicial global de finance_settings (fluxo financeiro por empresa, possivelmente negativo) é independente do fundo físico da sessão (>=0). Não migrar nem reutilizar o primeiro automaticamente como abertura de gaveta.

## 8. Fechamento, divergências e pagamentos futuros

**FC-01:** Fechamento exige cash.close, sessão aberta e contagem física >= 0. Registrar esperado, contado, diferença = contado - esperado, responsável, instante, justificativa se diferença != 0, composição e snapshot da sessão; encerrar de forma autoritativa.

**FC-02:** Valores de clientes ainda a receber (inclusive promessa de pagamento em dias futuros) ficam em painel informativo e **não alteram saldo esperado nem diferença**. Mesmo se o cliente originalmente pretendia pagar na entrega, adiar o pagamento não torna o caixa negativo nem o entregador devedor.

**FC-03:** Numerário realmente recebido pelo entregador e ainda não repassado continua na custódia do entregador, separado do caixa; não causa diferença da gaveta e não impede automaticamente fechar o caixa. Deve aparecer em alerta de pendência.

**FC-04:** Antes do fechamento, impedir operações físicas da sessão com resultado desconhecido/em voo; exigir reconciliação. Bloquear gravações posteriores na sessão encerrada. Uma cobrança futura/repasse posterior entra na sessão real futura, nunca altera a conferência encerrada.

**FC-05:** Fechamento com diferença é permitido com justificativa e indicador visível; não faz acerto financeiro automático. O gestor pode consultar/resolver por evento compensatório posterior, preservando o original.

**FC-06:** Fechamento não cancela pedidos, não registra recebimentos automáticos nem muda data comercial/financeira para "encaixar o dia". Registros oficiais de recebimento preservam received_date e paid_at/created_at factual.

**FC-07 — Contagem cega (PD-07 APROVADO):** no procedimento de fechamento realizado por operador sem permissão gerencial de visualização, o sistema **não exibe nem entrega previamente** o saldo físico esperado ou sua composição numérica. O operador informa a contagem do numerário físico sem conhecer o valor calculado. O Worker deve aplicar a mesma restrição aos read models/endpoints, inclusive respostas em segundo plano; ocultar apenas por CSS não é controle de acesso. A contagem é efetivada com revalidação de sessão e grants antes de comparação ou fechamento.

**FC-08 — Visibilidade gerencial (PD-07 APROVADO):** o saldo esperado e a composição podem ser consultados por usuário com **permissão gerencial efetiva correspondente**, independentemente do título do perfil exibido na UI; permissões persistidas, escopo do caixa e contexto da empresa são a autoridade. Ter `cash.close` não concede automaticamente acesso gerencial ao saldo esperado. O plano técnico definirá o identificador exato da capability e a projeção/redação de campos; não presumir que todo gerente já tem o grant nas bases existentes.

**FC-09 — Resultado da conferência (PD-07 APROVADO):** após o operador registrar sua contagem, a interface deverá permitir revisar o resultado da conferência/diferença e exigir justificativa quando houver divergência, sem permitir acertos automáticos. A primeira contagem e eventuais recontagens/correções devem ser rastreáveis. **Detalhes ainda técnicos:** momento de revelação do valor esperado após envio, política de recontagem, arredondamento/apresentação e eventual validação adicional de divergências. A contagem cega busca reduzir viés de conferência, não promete segredo matemático permanente do esperado.

### 8.1 Ativação gradual por restaurante (PD-06 — APROVADO)

**AT-01 — Configuração sem corte imediato:** habilitação é individual por empresa. Enquanto não ativada, a Mesiva preserva todos os fluxos existentes de recebimento; a preparação pode cadastrar caixas, permissões e entregador padrão sem criar fundo fictício ou bloquear venda.

**AT-02 — Primeiro marco físico:** gerente/usuário autorizado define o início do controle e abre a primeira sessão contando o valor real na gaveta (fundo inicial >= 0). O saldo financeiro geral já existente em finance_settings e os pagamentos anteriores não são convertidos automaticamente em fundo de caixa nem recriados como operações físicas. Cada nova empresa/caixa tem sua própria sessão.

**AT-03 — Operação pós-ativação:** após opt-in, qualquer recebimento de **dinheiro físico que entra diretamente no restaurante** deve identificar uma sessão aberta e autorizada; o mesmo vale para sangria, suprimento, transferência, pagamento de despesa em espécie por gaveta e entrega/retorno de fundo de troco. Se há um único caixa elegível, o sistema pode pré-selecioná-lo; com vários, segue CX-04.

**AT-04 — Sem caixa aberto:** não criar evento físico nem registrar como recebido em dinheiro um pagamento sem sessão válida. Exibir bloqueio claro e permitir que um usuário autorizado abra caixa; pagamentos por Pix/cartão e criação de pedidos não pagos/prometidos continuam possíveis. Em pagamento dividido, validação da parte em dinheiro e confirmação oficial devem ser consistentes/atômicas: nunca deixar pagamento parcialmente confirmado apenas por uma falha de caixa.

**AT-05 — Custódia do entregador:** pagamento em dinheiro que o entregador realmente recebeu pode ser reconhecido no fluxo autorizado de prestação de contas, vinculado à sua custódia; o dinheiro **só entra na gaveta** quando houver repasse confirmado para uma sessão aberta. Não exigir caixa do balcão para marcar pedido como ainda não pago ou mudar sua promessa de pagamento.

**AT-06 — Continuidade, isolamento e corte:** não migrar recibos/lançamentos históricos para sessões antigas, não reabrir sessões fechadas e não afetar outras empresas que ainda não ativaram a funcionalidade. A migração técnica deve prever flag por empresa e caminho seguro de retomada após falha de rede, sem duplo registro de pagamento.

**AT-07 — Desativação controlada:** não permitir desativação normal com sessão aberta. Se houver numerário em custódia de entregadores ou pendências de reconciliação, manter rastreabilidade e exigir procedimento específico antes de desligar controles; o contrato de exceção/rollback será definido no plano técnico. Desativação não pode apagar livros físicos ou produzir lançamento retroativo.

## 9. Telas e navegação — desktop prioritário

**Mapa alvo de navegação (PD-02 — APROVADO):** Financeiro inclui **Visão geral** (indicadores consolidados e aba **Extrato** para histórico de movimentos financeiros), **Caixa** (sessões e numerário físico), **A receber** (dívidas e promessas), **Despesas** (custos/fornecedores, quaisquer meios de pagamento) e **Relatórios** (análises). "Extrato" é uma aba de Visão geral, não novo item principal de menu. A página "Movimentações" atual é preservada enquanto seus recursos e usuários ainda dependerem dela; a sua retirada posterior requer inventário, migração funcional, testes e autorização próprios. Não converter toda movimentação financeira em evento de caixa.

**Tela Caixa do dia:** cabeçalho Financeiro / Caixa; seletor de caixa autorizado (ou único pré-selecionado); status Aberto/Fechado; cartões Saldo físico esperado, Dinheiro recebido em sessão, Cobranças na rota e Custódia de entregadores aguardando repasse. Painel central grande com composição do saldo + Sangria / Suprimento / Transferir / Fechar, e Abertura quando fechado. Lista apenas de pedidos **relevantes para recebimento/conferência operacional**, não catálogo geral; últimas operações auditáveis e separação explícita do A receber. Nunca incluir Novo pedido nem outro botão Saiu para entrega.

**Tela Prestação de contas do entregador:** responsável, pedidos atribuídos, intenção original e forma efetiva, status logístico, dívida/cobrança esperada, campos de conferência, dinheiro confirmado e saldo ainda em posse; seletor de caixa de destino; salvar pendências sem falsa quitação; confirmação transacional. Quando "outra data", oferecer ligação ao A receber.

**Tela Fechamento (PD-07 aprovada):** operador primeiro vê campo de dinheiro contado, instruções de conferência e pendências apenas informativas; **saldo esperado e composição numérica ficam ocultos antes da submissão da contagem para quem não possui grant gerencial**. Após o registro, permite conferência da divergência, justificativa condicional e encerramento com auditoria; responsável autorizado gerencial pode consultar composição/esperado via permissão efetiva. Manter em áreas visualmente distintas dinheiro faltando na gaveta versus pagamento futuro/repasse em trânsito.

**Telas auxiliares:** cadastro de caixas e entregadores; configurações de permissões; histórico paginado por sessão/caixa; detalhes dos eventos e estornos; A receber como owner da cobrança futura. **Visão geral > Extrato** mostra o histórico financeiro sem se confundir com o histórico imutável de sessões do Caixa. **Financeiro > Despesas** registra despesas, inclusive pagamentos não realizados com numerário físico.

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
- **Financeiro (PD-02 aprovado):** estrutura-alvo Visão geral (aba Extrato), Caixa, A receber, Despesas e Relatórios. Despesas são financeiras e podem não envolver o caixa físico; somente uma despesa efetivamente paga em dinheiro por gaveta gera um único efeito físico vinculado. Nenhuma remoção imediata do recurso Movimentações; preservar categorias, saldo financeiro histórico, lançamentos manuais, estornos e consumidores até migração funcional explícita e testes.
- **Multiempresa:** identidade da empresa derivada do contexto autenticado, FKs compostas e grants do Worker; nenhum ID de caixa ou entregador de outra empresa é aceito.
- **Reatividade:** Worker/D1 são autoridade; eventos apenas invalidam snapshots por superfície. Sem polling novo por card, sem N+1, sem carregar histórico inteiro; leituras paginadas e totais do servidor.
- **Compatibilidade (PD-06 aprovado):** ativação progressiva por empresa com configuração prévia e primeira abertura com fundo fisicamente contado; restaurante não ativado conserva fluxos existentes. Após opt-in, ingresso/saída física de dinheiro requer sessão aberta e permissão, sem bloquear Pix/cartão nem promessa futura; nenhum dado financeiro histórico presumido como gaveta nem backfill fictício.
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
| QA-46 | Enviar R$ 50 de troco ao entregador | Gaveta reduz R$ 50; custódia aumenta R$ 50; receita/despesa não muda |
| QA-47 | Cliente paga R$ 100 com R$ 35 de troco por venda de R$ 65 | Venda oficial R$ 65; custódia calculada corretamente; sem recibo de R$ 100 |
| QA-48 | Repasse de R$ 115 (R$ 50 fundo + R$ 65 venda) | Gaveta +R$ 115 após prévia saída de R$ 50; variação consolidada +R$ 65; sem duplicação |
| QA-49 | Repasse parcial e troca de turno | Saldo remanescente em custódia; recebimento na sessão futura sem reabrir caixa antigo |
| QA-50 | Fundo de troco sem pedido/entrega concluída | Troco permanece em custódia até retorno/ajuste autorizado, sem despesa fictícia |
| QA-51 | Restaurante ainda não ativou Caixa | Checkout e pagamentos existentes seguem disponíveis, sem sessão artificial |
| QA-52 | Configurar caixa e permissões antes da ativação | Não migra movimentos históricos nem bloqueia vendas |
| QA-53 | Primeira abertura com R$ 180 e saldo financeiro histórico de R$ 3.000 | Fundo físico = R$ 180; histórico permanece intacto |
| QA-54 | Caixa ativo, receber em dinheiro sem sessão aberta | Bloqueio sem recibo falsamente confirmado; abertura oferecida ao autorizado |
| QA-55 | Caixa ativo, Pix/cartão ou promessa sem sessão aberta | Permitidos, sem lançamentos físicos |
| QA-56 | Caixa ativo, pagamento dividido com parcela cash sem sessão | Operação não gera quitação parcial acidental ou cobrança duplicada |
| QA-57 | Despesa em Pix/transferência | Registro financeiro sem alterar saldo da gaveta |
| QA-58 | Despesa paga em dinheiro de caixa | Um registro financeiro + uma única saída física vinculada, sem sangria duplicada |
| QA-59 | Navegação alvo do Financeiro | Visão geral com aba Extrato; Caixa/A receber/Despesas/Relatórios distinguíveis |
| QA-60 | Retirada futura de Movimentações | Só após migração das ações/estornos/histórico, sem perda ou dupla exposição de comandos |
| QA-61 | Tentar desativar controle com sessão aberta | Bloqueio e preservação de histórico/custódia |
| QA-62 | Pagamento parcialmente informado em pedido de R$ 100 (R$ 60 recebidos, R$ 40 pendentes) | Não marcar Pago nem simular recibo integral; sinalizar ocorrência e encaminhar à resolução autorizada |
| QA-63 | Tentar usar suprimento para contabilizar parcial de cliente | Impedir falsa classificação de recebimento como suprimento |
| QA-64 | Criar pedido sem recebimento, com intenção e promessa pelo operador com orders.create | Gravação atômica, sem exigir finance.promises.manage no checkout nem registrar pagamento |
| QA-65 | Operador só com orders.create tenta editar promessa depois | Acesso negado no Worker, sem alterar vencimento |
| QA-66 | Usuário com grant específico edita promessa e intenção pendente | Validação/auditoria e nenhuma movimentação financeira |
| QA-67 | Pedido sai para entrega com dinheiro previsto | Sem recibo nem custódia confirmada ao despachar |
| QA-68 | Entregador retorna e operador confirma cobrança em dinheiro e repasse | Um só recibo canônico e transferência de custódia rastreável |
| QA-69 | Pix/cartão foi confirmado antes da volta do entregador | Prestação de contas consulta quitação oficial e não duplica recibo |
| QA-70 | Entregador retorna com dinheiro recebido mas não repassado | Custódia permanece pendente; gaveta não aumenta |
| QA-71 | Operador inicia fechamento cego | Saldo esperado e composição numérica não aparecem antes da primeira contagem |
| QA-72 | Operador sem grant gerencial tenta obter saldo esperado por endpoint/read model | Worker bloqueia/redige dados; não basta ocultar no frontend |
| QA-73 | Gerente com permissão efetiva e escopo do caixa consulta esperado | Acesso autorizado à composição e ao valor esperado; perfil isolado não basta |
| QA-74 | Operador conclui primeira contagem e existe divergência | Resultado apresentado no fluxo posterior, justificativa exigida, primeira contagem auditada e sem ajuste automático |

## 13. Fases candidatas — sem implementação autorizada

1. Modelo e UI de intenção de pagamento e reuso da promessa em pedido/A receber.
2. Cadastro de entregadores e associação ao despacho oficial da Cozinha.
3. Cadastro e abertura de caixas, escopos/grants por usuário.
4. Livro físico, integrações com recebimentos, sangria, suprimento e transferências.
5. Prestação de contas do entregador, custódia, repasses e ocorrências.
6. Conferência, fechamento e histórico; migração gradual de navegação Financeiro.

Cada fase exige planejamento separado com riscos, migrations aditivas, rollback, testes backend/frontend/realtime, custo D1, CI, staging e homologação humana. Publicação remota, merge e produção dependem de autorização explícita.

## 14. Pendências para revisão antes do plano técnico

**PD-01 — RESOLVIDO / APROVADO:** o controle formal do troco em posse do entregador entra na primeira versão. Regras definidas em EN-10 a EN-10d; exigirá validação técnica da granularidade dos eventos e de recibos.

**PD-02 — RESOLVIDO / APROVADO FUNCIONALMENTE:** Financeiro terá Visão geral (com Extrato interno), Caixa, A receber, Despesas e Relatórios. Despesa é operação financeira e só repercute no caixa quando houver pagamento físico em dinheiro. A tela Movimentações existente permanece operacional até substituição segura. **Pendente de detalhamento técnico, não de direção funcional:** migração de registros/ações/estornos e eventual retirada da rota legada, registrada em PD-10 e OP-04. Nenhuma exclusão ou data de remoção foi aprovada.

**PD-03 — RESOLVIDO / APROVADO FUNCIONALMENTE:** suporte completo a recebimento parcial genuíno fica para evolução futura. Na v1, distinguir pagamento insuficiente de pagamento dividido quitado, identificar e preservar a pendência de cliente sem falsa quitação, recibo parcial ou suprimento fictício. Procedimento de dinheiro parcial fisicamente aceito permanece **risco técnico/operacional a resolver antes de habilitar**, sem presumir que a v1 já suportará recebê-lo.

**PD-04 — RESOLVIDO / APROVADO FUNCIONALMENTE:** quem pode criar pedidos informa intenção e previsão na criação, sem permissão adicional; o Worker valida e persiste atomicamente. Alterar posteriormente exige capability específica, preservando `finance.promises.manage` para mudança de promessa já existente e estabelecendo autorização específica para edição posterior da intenção no plano técnico. `orders.create` não concede direito geral de alterar promessas ou confirmar pagamentos.

**PD-05 — RESOLVIDO / APROVADO FUNCIONALMENTE:** a cobrança em dinheiro pelo entregador é confirmada por funcionário autorizado **na prestação de contas do retorno**, sem app de entregador e sem presumir pagamento na saída da Cozinha. A confirmação real de Pix/cartão pode ocorrer independentemente pelo recebimento oficial, evitando confirmações duplicadas na prestação de contas. O nível específico de permissão, registro de conferência e atomicidade serão detalhados no plano técnico.

**PD-06 — RESOLVIDO / APROVADO FUNCIONALMENTE:** ativação por restaurante em três etapas (configuração, primeira abertura com contagem do fundo, controle ativo). Antes da ativação, manter recebimentos legados. Depois, operações que ingressem ou retirem numerário físico do restaurante exigem caixa/sessão abertos e autorização; sem sessão válida, não confirmar recebimento em dinheiro como concluído. Pix/cartão e promessas continuam disponíveis. Contratos técnicos de implantação, reversibilidade e tratamento de sessões em trânsito devem ser definidos no plano de implementação.

**PD-07 — RESOLVIDO / APROVADO FUNCIONALMENTE:** opção A de **contagem cega para operador**, com acesso ao saldo esperado e sua composição condicionado à **permissão gerencial efetiva**. Não enviar dados do esperado a operador não autorizado antes da contagem; a conferência e a divergência são tratadas após registro auditável. O desenho exato de grants, resultados pós-contagem e recontagem continua pendente tecnicamente, sem desfazer a decisão funcional.

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

**Gate:** esta versão é documental. **Aprovados funcionalmente:** PD-01 (troco do entregador), PD-02 (organização do Financeiro), PD-03 (postergar suporte completo a pagamentos parciais com pendências explícitas), PD-04 (criação de intenção/promessa por autor de pedido e edição posterior com grant específico), PD-05 (confirmação da cobrança em dinheiro no retorno do entregador e Pix/cartão pelo fluxo oficial), PD-06 (ativação gradual) e **PD-07 (contagem cega do operador, valor esperado sujeito a grant gerencial)**. **Permanece pendente de aprovação visual:** PD-08. Continuam em aberto análises técnicas/operacionais de exceções, OP-04/PD-10 e demais contratos não detalhados. Nenhuma aprovação de implementação, migration, staging, merge ou produção é inferida.
