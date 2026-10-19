# Feedback de ações — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** integrar o visual aprovado de botões com estados e toasts, confirmando cada ação no contexto que permanece visível.

**Architecture:** evoluir os componentes genéricos em `src/shared/ui/`, mantendo os workflows como autoridade sobre resultados. O runtime de feedback existente controla coleção, fila e temporizadores; o shell apresenta os avisos. Migrar os consumidores por fluxo, sem atrasar navegação ou duplicar mutations.

**Tech Stack:** React 19/JSX, CSS/SVG, Node.js 22, testes `node --test` e harness Vite existente. Sem novas dependências de produto.

**Spec:** [especificação aprovada em 19/10/2026](../specs/2026-10-19-action-feedback-design.md).

**Status:** aprovado e executado nesta conversa, com implementação própria e revisão independente final em andamento. Baseline: `bbd925a8`, branch `codex/melhorias-visuais-2026-10-19`.

## Global Constraints

- Usar React/JSX, CSS e tokens existentes. Componentes genéricos pertencem a `src/shared/ui/`; a coordenação global permanece em `src/app/runtime/feedback/` e `src/app/shell/AppRoot.jsx`.
- Não introduzir Tailwind, TypeScript, shadcn, aliases novos, `cn`, Lucide ou dois pacotes de animação para esta mudança.
- O botão não executa nem interpreta a Promise da mutation: a UI recebe o resultado do workflow existente.
- Não atrasar navegação, fechamento, atualização da coleção ou liberação de formulário para exibir o check.
- Botão: `idle`, `loading`, `success`, `error`; sucesso/erro por 1.800 ms quando continua montado. Nova edição invalida confirmação anterior.
- Toast: até três visíveis; excedentes aguardam sem timer; sucesso/informação: 4.000 ms; atenção: 6.000 ms; erro: sem fechamento automático; largura máxima desktop de 420 px.
- Pressão até 0,97; conteúdo até 8 px/200 ms; check 250 ms; spinner 800 ms/volta; toast entra até 12 px/220 ms e sai em 160 ms. Movimento reduzido remove deslocamento, escala, shake e desenho progressivo.
- Preservar sessões/empresa/capabilities, reconciliação e confirmação do spooler. Nenhum timer visual dispara rede.
- Verificar licenças antes de incorporar código externo; preservar atribuições exigidas. Fontes escolhidas: Morph Button/Spectrum UI e Animated Toast/Shejan Mahamud, vinculadas na spec.
- Sem deploy, migrations, mudanças de Worker, TV, sino de novidades, APIs ou dados reais.

## Review Focus

1. Enter e clique rápido antes do próximo render não podem duplicar uma mutation; `false` não pode virar check — tarefas 1 e 4.
2. Troca de contexto, unmount e reaparecimento de formulário não podem mostrar sucesso antigo ou mensagem de outra empresa — tarefas 2, 3 e 4.
3. Mais de três avisos, foco e hover simultâneos e aba oculta não podem consumir o tempo de um aviso ainda não visto — tarefa 2.
4. Edição durante salvamento/reconciliação de configurações não pode confirmar como salvo um rascunho novo — tarefa 5.
5. Rodapé mobile, modal com outro modal, zoom, mensagem longa e movimento reduzido não podem ocultar ação, aviso ou foco — tarefas 1 e 6.

## Mapa da migração

| Área / chamadas | Arquivos concretos | Retorno previsto |
| --- | --- | --- |
| Toast/sucesso globais; erro API; preferência local; alvo obsoleto; atenção de impressão | `src/App.jsx`; `src/app/shell/AppRoot.jsx` | Tipos explícitos por origem: erro API/storage, atenção para alvo alterado/impressão, sucesso para commit confirmado. Preservar 401/403/contexto antes de notificar. |
| Salvar pedido/reserva; salvar e receber/devolver; retorno ao histórico/cozinha/comanda | `src/domains/orders/ui/NewOrder.jsx`; `src/domains/orders/ui/components/OrderCheckoutSummary.jsx`; `src/domains/orders/application/useNewOrderDraft.js`; `src/App.jsx` | `loading` no envio; toast no destino, salvo se outra etapa abre imediatamente. |
| Finalizar/cancelar pedido | `src/domains/orders/ui/Orders.jsx`; `OrderHistory.jsx`; `components/CancelOrderDialog.jsx`; `src/shared/ui/ConfirmationDialog.jsx` | Carregamento na confirmação; toast do resultado, sem manter card artificialmente. |
| Pedido/saldo; lote; comanda; estorno; edição financeira | `src/app/workflows/payments/order/OrderPaymentDialog.jsx`; `OrderEditSettlementDialog.jsx`; `client-orders/ClientOrdersPaymentDialog.jsx`; `table-tab/TableTabPaymentDialog.jsx`; `src/app/workflows/refunds/RegisterRefundDialog.jsx`; workflows correspondentes; `src/App.jsx` | Carregamento; sucesso somente no momento oficial atual. Próxima etapa mostra estado parcial sem toast duplicado. |
| Criar/editar/excluir produto e cliente, inclusive confirmação de duplicidade | `src/domains/catalog/application/useProductEditor.js`; `ui/ProductEditorDialog.jsx`; `ui/Products.jsx`; `src/domains/customers/application/useCustomerEditor.js`; `ui/CustomersWorkspace.jsx`; `CustomerEditorDialog.jsx`; `ClientDuplicateModal.jsx`; `Clients.jsx` | Latch no owner de envio quando necessário, carregamento e toast após fechamento; `false` preserva editor. |
| Movimento, saldo inicial e exclusão | `src/domains/finance/ui/MovementDialog.jsx`; `OpeningBalanceDialog.jsx`; `Finance.jsx`; `application/useFinanceCommands.js` | Carregamento e toast após efeito oficial; manter revisão e erros. |
| Criar/renomear/desativar mesa, transferir comanda, ações de reserva | `src/domains/table-service/ui/Tables.jsx`; `TableTransferDialog.jsx`; `TableReservationDetail.jsx`; `application/useTableServiceCommands.js`; `useTableReservationCommands.js` | Carregamento nas mutations; toast identificável, incluindo origem/destino da transferência. |
| Salvar operação, perfil da empresa, pagamentos, motivos e categorias | `src/app/surfaces/settings/components/SettingsEditorShell.jsx`, consumido por `OperationSettings.jsx`, `business-profile/BusinessProfileSettings.jsx`, `CancellationSettings.jsx`, `src/domains/finance/ui/settings/PaymentSettings.jsx` e `FinanceCategorySettings.jsx` | Check no botão persistente somente após resultado oficial. Preservar avisos de rascunho/conflito/incerteza e estados do controller. |
| Políticas/estação/impressora, atualização de lista e envio de teste | `src/domains/printing/ui/PrintingSettingsContent.jsx` | Estado do botão nas gravações confirmadas; se editor fecha, mensagem permanece fora dele. “Enviado” não significa “Impresso”; avisos de recuperação permanecem. |
| Rascunho de motivo/categoria | `src/app/surfaces/settings/components/SettingsItemDialog.jsx`; telas consumidoras acima | Fechar editor sem check de persistência; indicar rascunho pendente no contexto existente. |
| Conteúdo próprio preservado | `ConnectionBanner.jsx`, `PrintingOverlays.jsx`, `ReleaseNotesModal.jsx`, `NotificationCenter.jsx`, avisos de validação/erro locais e modais administrativos | Preservar funções e conteúdo; feedback global usado por essas áreas passa pelo novo runtime. Não migrar botões de navegação/abertura/seleção para loading. |

## Task 1: apresentação compartilhada dos botões

**Files:** modificar `src/shared/ui/Button.jsx`, `Icon.jsx`, `ConfirmationDialog.jsx`; criar `src/shared/ui/button-feedback.css` e `Button.test.js`. Consumir o `workspaceHarness` de `src/test-support/renderWorkspace.js`.

**Interfaces:** `Button({ state = 'idle', loadingLabel, successLabel = 'Concluído', errorLabel = 'Falhou', ...existingProps })`. Não recebe `onAction`. `ConfirmationDialog` ganha `submitting = false` e `loadingLabel = 'Confirmando…'`, distintos de `disabled`; encaminha ao botão principal. Ícones novos somente se não houver equivalente adequado.

- [x] Escrever testes RED de `Button`: estados controlados, atributos HTML/`type="submit"`/`onClick`/`preventDefault`, ícone existente, conteúdo JSX, disabled externo e carregamento que impede clique/Enter; não executar nenhuma mutation por conta própria. Usar assertions `assert.equal(button.props['aria-busy'], true)`, `assert.equal(button.props.disabled, true)`, `assert.equal(calls, 0)` durante loading e `assert.equal(submits, 1)` para acionamento válido. Testar também que atualização para `idle` preserva o handler original.
- [x] Rodar `node --test src/shared/ui/Button.test.js`; confirmar falha pelas props/comportamentos ainda ausentes.
- [x] Conferir as licenças nas fontes oficiais e registrar atribuição antes de copiar trechos. Implementar o contrato visual e CSS da spec; manter área estável pela composição dos rótulos, não por largura rígida. O caller controla o resultado e os 1.800 ms, não o `Button`. Preservar peso/tamanho/variantes existentes e foco visível.
- [x] Rodar o teste novamente; todos passam. Conferir botão comum e botão com rótulo longo no preview antes de migrar consumidores.
- [x] Commit local somente dos arquivos desta tarefa: `feat(ui): adicionar estados visuais aos botões`.

## Task 2: coleção e ciclo de vida dos toasts

**Files:** modificar `src/app/runtime/feedback/useFeedbackRuntime.js` e `.test.js`; criar `src/shared/ui/ToastRegion.jsx`, `toast-feedback.css` e `ToastRegion.test.js`.

**Interfaces:** `useFeedbackRuntime()` oferece `toasts`, `showToast({ type, title?, message }) -> id`, `dismissToast(id)`, `setToastPaused(id, reason, paused)` e `clearFeedback()`. Cada item expõe `id`, conteúdo tipado e fase `visible|exiting`; a fila excedente é interna. `reason` é `hover|focus|document`. `ToastRegion({ toasts, onDismiss, onPause })` apresenta a coleção e mantém regiões de anúncio educado/erro montadas antes das mensagens; pausa por documento oculto é controlada pelo runtime. Suporte temporário às saídas antigas até a tarefa 3.

- [x] Escrever testes RED com timers/Date falsos: `assert.equal(visible.length, 3)` após quatro eventos, quarto aviso só inicia os 4.000 ms após promoção; duas mensagens iguais têm IDs distintos; erro continua visível após 60.000 ms; atenção só expira em 6.000 ms. Testar pausa hover+foco+documento (remover uma razão não retoma enquanto outra existir), re-render sem reset, fechamento durante pausa, ordem FIFO e `clearFeedback()` cancelando timers/fila/anúncios. Testar unmount sem atualização tardia.
- [x] Rodar `node --test src/app/runtime/feedback/useFeedbackRuntime.test.js src/shared/ui/ToastRegion.test.js`; observar RED.
- [x] Implementar no runtime existente: IDs locais monotônicos, até três visíveis, promoção após saída de 160 ms; restantes aguardam sem timer. Timer estável por ID usa tempo restante e cancela no cleanup. Sem polling/intervalo, storage, HTTP ou provider duplicado. Regiões acessíveis e botão de fechar com nome; CSS/SVG seguem spec e variantes semânticas.
- [x] Repetir o comando de testes; todos passam. `ToastRegion` testa mensagens/fechamento/anúncios/eventos de pausa, sem testes que apenas espelhem classes.
- [x] Commit: `feat(ui): centralizar fila e apresentação de toasts`.

## Task 3: integração global e retirada das apresentações antigas

**Files:** modificar `src/App.jsx`, `src/app/shell/AppRoot.jsx`, `src/admin/AdminBootstrap.jsx`, `src/successFeedbackRegression.test.js`, `mobileConsistencyRegression.test.js`, `mobileViewportRegression.test.js`; criar `src/app/shell/AppRoot.feedback.test.js`. Remover somente as regras substituídas em `src/App.css`, `theme.css`, `mobile-interactions.css`, `src/domains/orders/ui/ui-polish.css`; remover `src/success-feedback.css` depois da busca de consumidores, imports, testes e entrypoints.

**Interfaces:** `AppRoot({ toasts, onDismissToast, onPauseToast, ...existingProps })` monta `ToastRegion` fora das superfícies que podem fechar. Em `App.jsx`, adapters estáveis para `onSuccess(message)` e os callbacks de erro/atenção/info enviam `showToast` tipado; `clearFeedback()` roda no reset de sessão/contexto, também antes de renderizar dados da nova empresa. Não trocar owners das mutations.

- [x] Escrever RED no harness do shell: toast sobrevive ao fechamento de modal/navegação permitida, nova empresa e logout removem os avisos antes de exibir o novo contexto, auth/bootstrap continuam corretos. Assertions: `assert.equal(successOverlays.length, 0)`, `assert.equal(toastsForNewContext.length, 0)` e cada evento oficial gera exatamente uma mensagem. Migrar os testes estáticos antigos para o contrato aprovado sem eliminar as proteções de camadas/mobile/privacidade.
- [x] Rodar `node --test src/app/shell/AppRoot.feedback.test.js src/successFeedbackRegression.test.js src/mobileConsistencyRegression.test.js src/mobileViewportRegression.test.js`; confirmar RED.
- [x] Substituir `Toast`/`Success` inline; migrar todas as chamadas `setToastMessage`, `setSuccessMessage`, `toastMessage`, `successMessage` da aplicação, removendo os adapters legados do runtime quando não houver consumidores. Onde uma prop externa ainda se chamar `onToast(message)`, manter o contrato com adapter tipado explícito pela origem, sem heurística textual. Preservar 401/403, guards, banners e notificações.
- [x] Repetir os testes e `rg -n 'toast-success|toast-icon|success-confirmation|success-feedback.css' src -g '*.jsx' -g '*.js' -g '*.css'`; nenhuma dependência ativa das apresentações removidas. Referências históricas em documentação não são código morto a excluir.
- [x] Commit: `refactor(ui): substituir feedback global por toasts tipados`.

## Task 4: mutations que fecham ou removem o botão

**Files:** consumidores das linhas operacionais do mapa; testes existentes em `src/domains/catalog/application/useProductEditor.test.js`, `src/domains/customers/application/useCustomerEditor.test.js`, `src/operationalPayment.test.js`, `src/domains/orders/ui/OrderEditing.test.js`, `src/app/workflows/payments/table-tab/tableTabPaymentReconciliation.test.js`; criar `src/actionFeedbackFlows.test.js` para os cenários de interface que ainda não tenham cobertura.

**Interfaces:** preservar callbacks e retornos atuais (`false`/objeto/`true`) dos commands/workflows. Derivar `state='loading'` de `submitting`, `busy`, `actionKey`, `pendingAction` ou do estado de edição já proprietário. Editor sem latch de envio ganha ref local e `submitting`, expostos pelo próprio hook e limpos no finally/owner correto; não criar um executor genérico de Promise. No checkout, passar `submitting={newOrderDraft.checkoutPending}` de `App.jsx` a `NewOrder` e ao `OrderCheckoutSummary`, separado de `disabled`; `pendingIntent='save'|'receive'|'refund'|null`, local ao formulário, identifica o botão acionado. Desabilitar os demais sem fazê-los parecer envios independentes; aplicar ao controle mobile correspondente. Limpar a intenção no finally/unmount e não aproveitar estado de formulário anterior.

- [x] Escrever RED para as famílias do mapa: entrada rápida duplicada chama API uma vez; `false` mantém formulário sem check; retorno oficial fecha sem espera artificial e mostra um toast; sessão/edição trocada durante resposta não fecha nem confirma a tela nova. Na comanda, `assert.equal(successCount, 0)` até a reconciliação oficial e `assert.equal(successCount, 1)` depois. Na edição com próxima etapa, `assert.equal(globalSuccessCount, 0)` enquanto o próximo diálogo mostra pedido salvo e pendência financeira/reimpressão.
- [x] Rodar `node --test src/actionFeedbackFlows.test.js src/domains/catalog/application/useProductEditor.test.js src/domains/customers/application/useCustomerEditor.test.js src/operationalPayment.test.js src/domains/orders/ui/OrderEditing.test.js src/app/workflows/payments/table-tab/tableTabPaymentReconciliation.test.js`; confirmar o RED do comportamento novo, sem alterar expectativas financeiras existentes.
- [x] Integrar loading em todas as mutations enumeradas no mapa, incluindo ações mobile do checkout e confirmações de exclusão/duplicidade. Ajustar `App.jsx` para não emitir sucesso redundante quando abre settlement/reimpressão; usar a mensagem na etapa seguinte. Informar origem/destino na transferência quando disponíveis oficialmente; não montar check em card que já saiu do filtro. Manter erros locais e reconciliação.
- [x] Repetir o comando; rodar também os testes dos commands/workflows modificados por caminho explícito. Confirmar no harness uma chamada por ação, nenhum atraso mínimo e nenhuma leitura adicional criada pelo feedback.
- [x] Commit: `feat(ui): integrar feedback aos fluxos operacionais`.

## Task 5: confirmação no botão persistente e rascunhos

**Files:** modificar `src/app/surfaces/settings/components/SettingsEditorShell.jsx`, `SettingsItemDialog.jsx`, `src/domains/printing/ui/PrintingSettingsContent.jsx` e seus testes; criar `src/app/surfaces/settings/components/SettingsEditorShell.feedback.test.js`. Preservar o controller em `src/app/policy-editing/` sem alterar a semântica de persistência/reconciliação. Ajustar consumidores do mapa apenas para repassar identidade/estado que falte ao shell.

**Interfaces:** shell continua recebendo `state`, `onSave`, `onReconcile`, `onReload` e `onDiscard`; acrescentar `feedbackScopeKey` quando o componente puder sobreviver à troca de recurso. Estado visual transitório local é invalidado por recurso/contexto, mudança do rascunho ou unmount. `onSave`/`onReconcile` com `true` oficial podem confirmar; `false`, carga inicial ou simples `status='ready'` não podem. `busyKeys` e resultado confirmado já existentes continuam donos da configuração de impressão.

- [x] Escrever RED: sucesso oficial mostra “Salvo” por 1.800 ms; editar novamente retorna imediatamente a “Salvar alterações”; `false`, sem mudanças, conflito, `unconfirmed`, load/reload e resposta de scope anterior não mostram sucesso. Rascunho alterado durante envio não mostra check para a versão nova. Reconciliação confirmada do mesmo envio pode mostrar check, sem novo write. Salvar impressora que fecha editor mantém feedback visível fora dele; envio de teste nunca diz “Impresso”.
- [x] Rodar `node --test src/app/surfaces/settings/components/SettingsEditorShell.feedback.test.js src/app/surfaces/settings/components/SettingsPrimitives.test.js src/settingsPrintingPolicy.test.js src/components/PrintingSettings.test.js src/components/PrintingConflictRecovery.test.js`; confirmar RED dos novos casos.
- [x] Implementar estado/timer estritamente visual no shell; representar saving/error confirmados pelo owner, limpar quando rascunho muda e não sobrescrever conflito/incerteza por timer. Manter feedback de “Não há alterações” separado de sucesso. Reutilizar mensagens locais para rascunhos; evitar toast duplicado de confirmação. Aplicar critério equivalente aos botões persistentes de impressão, sem mudar QZ/recovery/retries.
- [x] Repetir os testes; rodar `node --test src/app/policy-editing/policyEditingController.test.js src/app/policy-editing/PolicyEditingProvider.test.js` e testes das configurações tocadas. Confirmar que reconciliar só usa as consultas já previstas, sem novos requests por animação.
- [x] Commit: `feat(ui): confirmar salvamentos persistentes nos botões`.

## Task 6: QA integrada, documentação e revisão

**Files:** atualizar `docs/design/DESIGN_SYSTEM.md`; `docs/architecture/MODULE_MAP.md` somente para owners novos/movidos; criar `docs/superpowers/qa/2026-10-19-action-feedback.md` com evidências e limitações por SHA. Rever README/AGENTS, sem editar se continuarem corretos. Atualizar status desta spec/plano ao concluir.

**Interfaces:** nenhuma interface nova; validar a integração final dos contratos anteriores e a matriz da spec.

- [ ] Rodar os testes das tarefas anteriores no estado final; executar `npm run test:architecture`, `npm run lint`, `npm run build`, `npm test` e `git diff --check`. Exigir códigos de saída zero, sem eliminar gates nem interpretar saída truncada como sucesso. Confrontar eventual falha com baseline, sem escondê-la.
- [ ] No ambiente local existente, usar dados fictícios para QA em 320 px e desktop, Mesiva/Clássico e claro/escuro; conferir teclado, foco após modal fechar, zoom, quatro mensagens simultâneas, mensagem longa, hover/foco/aba oculta e movimento reduzido. Conferir loading imediato e ausência de duplo feedback. Registrar screenshot dos estados relevantes e limitações reais.
- [ ] Comparar no harness/network as chamadas das mesmas ações antes/depois no SHA apropriado: writes idênticos e leituras/reconciliações sem acréscimo. Registrar rotas e contagens; `rows_read`/`rows_written`: sem alteração de SQL/endpoints esperada, sem medição D1 adicional nesta mudança de apresentação. Não declarar economia ou validação física de impressão.
- [ ] Registrar no Design System props/owners, uso por contexto, duração, fila, pausa e movimento reduzido; preservar avisos de impressão e referência aos originais/licenças verificadas. Revisar todo o diff, consumidores, recursos sem referências e nenhum dado/secret em evidências. Remover apenas resíduos substituídos comprovados.
- [ ] Revisão independente do diff completo conforme o método de execução escolhido; corrigir achados e repetir apenas os checks invalidados. Commit: `docs(ui): documentar e validar feedback de ações`. Entregar resumo, verificações e riscos; não fazer push/merge/deploy sem alcance de autorização correspondente.

## Handoff

Recomendação: **execução própria nesta conversa**, seguida de revisão independente ao final. As tarefas compartilham o runtime e os mesmos consumidores; executar sequencialmente evita edições concorrentes e mantém o contexto. Alternativa: execução com subagentes e revisão por tarefa, com maior custo de coordenação.

Método aprovado: implementação própria nesta conversa, seguida de uma revisão independente do diff completo. Continuar no worktree/branch atual, preservando servidores, banco e alterações alheias. Commits locais são marcos de implementação, não autorização de publicação.
