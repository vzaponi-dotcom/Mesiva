# Feedback de ações: botões com estados e toasts

**Status:** especificação aprovada pelo proprietário nesta conversa em 19/10/2026; implementação ainda não iniciada.

**Baseline inspecionada:** `e70a0ad7`, branch `codex/melhorias-visuais-2026-10-19`.

**Objetivo:** tornar a conclusão de ações perceptível no lugar adequado, usando os componentes visuais escolhidos pelo proprietário e reduzindo confirmações redundantes.

## 1. Decisões da conversa e referências

O proprietário aprovou a direção de botões com carregamento/check, toasts refinados quando o botão desaparece e avisos persistentes para condições que continuam exigindo atenção. Escolheu os seguintes exemplos e forneceu seus códigos:

- [Morph Button — Spectrum UI](https://21st.dev/@arihantcodes_1f7b8c4d/components/morph-button): spinner, transição de conteúdo e desenho do check; estados de repouso, carregamento, sucesso e erro.
- [Animated Toast — Shejan Mahamud](https://21st.dev/@dev.shejanmahamud/components/animated-toast): superfície com ícone, título/mensagem, indicador semântico e fechamento.

Referências são adaptadas à arquitetura e identidade do Mesiva. O texto genérico do exportador que recomenda `/components/ui`, Tailwind, TypeScript, fotos e novas bibliotecas não define requisitos do projeto. As regras locais e os comportamentos aprovados prevalecem.

## 2. Escopo

- Evoluir o `Button` compartilhado sem quebrar seus atributos HTML, variantes, ícones, eventos ou uso em formulários.
- Substituir a apresentação global de toast e de sucesso central por toasts com significado explícito.
- Integrar estados de envio às ações de pedidos, pagamentos, estornos, cadastros, movimentações e mesas/comandas já avaliadas.
- Aplicar o mesmo critério aos salvamentos de configurações que mantenham o botão visível. Estados de rascunho e de sincronização continuam distintos de persistência confirmada.
- Preservar `Modal`, `ConfirmationDialog`, regras de decisão, validações e avisos locais persistentes; não converter banners em mensagens temporárias.

Ficam fora: redesenho das telas, alterações do sino de novidades, mudança da TV de cozinha, novos endpoints/consultas, novos fluxos de desfazer, alteração de permissões, deploy e migrations.

## 3. Adaptação técnica

Usar React/JSX, CSS e tokens existentes. Componentes genéricos pertencem a `src/shared/ui/`; a coordenação global permanece em `src/app/runtime/feedback/` e `src/app/shell/AppRoot.jsx`.

Não introduzir Tailwind, TypeScript, shadcn, aliases novos, `cn`, Lucide ou dois pacotes de animação para esta mudança. Reutilizar `Icon` e implementar as transições necessárias com CSS/SVG e, quando estritamente necessário, APIs nativas do navegador. Não mudar a identidade visual para coincidir com as cores fixas dos exemplos.

Verificar licença e preservar atribuições exigidas antes de incorporar trechos de terceiros. A origem Spectrum informa Apache-2.0; a licença da fonte de toast deve ser conferida no momento da incorporação. A autorização visual não dispensa essa verificação.

## 4. Contrato do botão

Evoluir `src/shared/ui/Button.jsx` com estado visual controlado: `idle`, `loading`, `success` ou `error`; padrão `idle`. Rótulos específicos de ação são fornecidos pelo consumidor, em português.

- `idle`: conteúdo e variante atuais.
- `loading`: spinner e rótulo como “Salvando…”; `aria-busy`; bloqueio de novos acionamentos, inclusive teclado/submissão. Preservar os bloqueios existentes no owner da mutation.
- `success`: check desenhado e rótulo específico como “Salvo”; somente após confirmação oficial. Quando o botão continua visível, manter por 1.800 ms e retornar ao repouso; nova edição invalida a confirmação anterior imediatamente.
- `error`: ícone de erro e rótulo breve durante 1.800 ms, depois retorna ao repouso; a mensagem explicativa fora do botão permanece disponível. Novo acionamento continua sujeito ao workflow. Não representar resultado desconhecido como rejeição definitiva nem criar retry automático.

O botão não executa nem interpreta a Promise da mutation: a UI recebe o resultado do workflow existente. Vários commands retornam `false` em falhas ou perda de ownership; Promise resolvida não comprova sucesso. Respostas atrasadas de sessão/empresa anterior não atualizam a apresentação atual.

Não atrasar navegação, fechamento, atualização da coleção ou liberação de formulário para exibir o check. Não atrasar resultados rápidos para completar uma duração mínima de spinner. Manter a área de clique e os botões vizinhos estáveis entre estados; o movimento fica no conteúdo/ícone.

Usos comuns do `Button`, sem as novas props, continuam com o comportamento e a aparência atuais. Ações HTML `type="submit"`, `preventDefault`, `disabled`, `aria-*`, classes locais e estilos destrutivos continuam funcionando.

## 5. Contrato do toast

Um componente visual genérico apresenta tipo (`success`, `error`, `warning`, `info`), mensagem, título opcional e botão “Fechar aviso”. O runtime existente é o único owner da coleção e de seus temporizadores. A apresentação usa portal para `document.body` e a escala de camadas vigente.

- Superfície opaca neutra, borda/sombra contidas, ícone e acento semântico; texto essencial não depende só da cor.
- Posição global no topo central; em telas pequenas, margens laterais, safe-area e posição compatível com o cabeçalho atual. Largura máxima desktop de 420 px, sem largura mínima que cause overflow no mobile.
- Até três avisos visíveis em sequência vertical, sem sobrepor ou esconder o texto dos demais. Excedentes aguardam na fila; tempo começa quando ficam visíveis, sem descartar avisos apenas por chegar outro.
- Sucesso/informação: 4.000 ms; atenção: 6.000 ms; erro: sem fechamento automático. Todos permitem fechamento manual.
- Pausar contagem no hover, foco dentro do aviso e documento oculto; retomar apenas quando todas as condições de pausa cessarem. Re-render ou entrada de outro aviso não reinicia o prazo do primeiro.
- Mensagens iguais decorrentes de ações distintas continuam sendo novos eventos visíveis.
- Não inserir botões de mutation/desfazer nos toasts desta entrega. Decisões permanecem nos fluxos oficiais.
- Regiões de anúncio acessível já presentes antes da mensagem; sucesso/informação/atenção com anúncio educado, erros com anúncio apropriado à falha. Sem mover foco para um toast.
- Limpar coleção, fila, anúncios e timers ao mudar sessão/contexto/empresa ou sair. Não armazenar mensagens privadas no storage.

O runtime oferece envio tipado de feedback. Compatibilidade com callbacks de string pode existir durante a migração, mas cada chamada migrada precisa ter semântica explícita; não inferir tipo procurando palavras no texto. `showApiError` preserva os tratamentos atuais de expiração e mudança de acesso antes de emitir erro.

## 6. Matriz de apresentação

| Ação/condição | Resultado atual confirmado no código | Apresentação prevista |
| --- | --- | --- |
| Novo pedido, pedido anterior ou reserva | `onCommitted` volta ao destino em `App.jsx`; sucesso distingue preparo, histórico e recebimento | Botão carregando; toast no destino com resultado exato. |
| Criar/editar cliente ou produto | Editor fecha após retorno aceito | Carregamento no editor; toast depois do fechamento. |
| Pagamento de pedido/saldo e lote de cliente | Workflow aplica efeitos, fecha e emite sucesso | Carregamento; toast identificável após confirmação oficial. |
| Pagamento de comanda | Diálogo fecha; seleção é liberada após reconciliação da comanda | Preservar fase de sincronização; toast de recebimento no momento já autorizado pelo workflow. |
| Movimento, saldo inicial e estorno | Editor/revisão fecha após resultado aceito | Carregamento; toast de registro confirmado. |
| Finalização, cancelamento e exclusão | Item pode sair do filtro e confirmação fecha | Carregamento; toast identificando ação e alvo quando disponível. Não manter item antigo apenas para animar. |
| Transferência de comanda | Diálogo fecha e mesas são atualizadas | Toast informando origem/destino confirmados. |
| Edição com saldo/devolução ou oferta de reimpressão | Pode abrir imediatamente outra etapa | Próxima etapa identifica que o pedido foi salvo e o que ainda falta; evitar toast e popup de sucesso cobrindo o novo diálogo. |
| Edição salva sem próxima etapa | Retorna à origem | Toast de atualização. |
| Alteração apenas no rascunho de configurações | Editor de item fecha; salvamento posterior ainda necessário | “Adicionado ao rascunho” ou equivalente no contexto persistente; nunca “Salvo”. |
| Salvamento confirmado com botão persistente | Tela continua montada | Carregamento e check no botão; remover feedback de sucesso redundante daquela ação. |
| Validação, falha e resultado incerto | Nem todo erro confirma ausência de efeito no servidor | Mensagem contextual com possibilidade de revisão/reconciliação; toast de erro apenas quando não houver local adequado. |
| Desconexão/recuperação da impressão | Condição pode persistir e requerer decisão humana | Preservar banner/aviso e ações oficiais, com estilos coerentes. |

Impressão confirma envio à fila quando esse é o resultado recebido; nunca usar “Impresso” sem a confirmação oficial do spooler. Não mostrar conclusão financeira apenas porque a edição do pedido foi salva.

## 7. Movimento e acessibilidade

Usar movimento contido e funcional: pressão com escala até 0,97; troca de conteúdo de até 8 px/200 ms; check em 250 ms; spinner de 800 ms por volta; toast entra com até 12 px/220 ms e sai em 160 ms. Não usar glow ou animações decorativas contínuas.

Com `prefers-reduced-motion`, remover deslocamento, escala, shake e desenho progressivo; o indicador textual de carregamento continua presente sem depender de rotação. Preservar teclado, foco visível, alvos de toque e leitura em claro/escuro e Mesiva/Clássico.

Modal continua responsável pelo ciclo/restauração de foco, Escape e scroll. Não duplicar essa infraestrutura nos componentes de feedback. Um fechamento automático não pode deixar o foco em elemento removido nem ocultar o único relato de uma falha.

## 8. Arquivos e evidências a considerar no plano

- Núcleo: `src/shared/ui/Button.jsx`, `Icon.jsx`, novo componente de toast e estilos próximos dos componentes.
- Runtime/shell: `src/app/runtime/feedback/useFeedbackRuntime.js`, seus testes, `src/app/shell/AppRoot.jsx`, `src/App.jsx` e imports de estilo de `src/admin/AdminBootstrap.jsx`.
- Consumidores: commands/editors de catálogo e clientes; `useNewOrderDraft`, `useOrderCommands`; workflows de pagamentos/estornos; comandos/diálogos financeiros e de mesas/comandas; salvamentos de configurações.
- Regressões existentes: `src/successFeedbackRegression.test.js`, `src/mobileConsistencyRegression.test.js`, `src/mobileViewportRegression.test.js` e testes dos fluxos afetados.
- CSS substituído: rastrear consumidores de `.toast-success`, `.toast-icon` e `.success-confirmation-*` em `App.css`, `theme.css`, `mobile-interactions.css`, `domains/orders/ui/ui-polish.css` e `success-feedback.css` antes de remover regras/imports.
- Documentação viva afetada: Design System e, se os owners públicos mudarem, Module Map. README/AGENTS só mudam se suas instruções ficarem incorretas.

O plano de execução deve enumerar as chamadas concretas migradas por superfície e os casos em que o feedback existente permanece. Não aplicar substituição mecânica em todos os botões nem alterar o significado de mensagens operacionais.

## 9. Aceite e validação

- Testes comportamentais de clique repetido/submissão, retorno `false`, sucesso confirmado, falha, resultado incerto e resposta depois de unmount/troca de contexto.
- Testes do runtime para mensagens repetidas, fila, duração efetiva, hover/foco/aba oculta, fechamento e limpeza de contexto; sem reinício de timer por outros avisos.
- Regressão dos fluxos de fechamento/navegação e de comanda em reconciliação; apenas um retorno de sucesso por etapa e nenhum atraso artificial.
- Prévia/QA em desktop e mobile (incluindo 320 px), temas claro/escuro, teclado, foco e movimento reduzido. Usar dados fictícios; impressão física não é homologada por esta entrega.
- Executar testes específicos durante desenvolvimento; antes da entrega de código, `npm run test:architecture`, `npm run lint`, `npm run build` e a suíte pertinente. `npm test`/CI deve estar verde para integração/publicação.
- Recursos Cloudflare: sem impacto esperado em leituras/escritas/requests, pois a mudança é de apresentação e reaproveita exatamente as mutations/reconciliações atuais. Nenhum timer visual dispara rede. Comparar chamadas nos fluxos de QA para confirmar que não foram duplicadas; não alegar economia medida.

## 10. Próximo marco

A especificação foi aprovada pelo proprietário nesta conversa. O próximo marco é revisar o [plano de implementação](../plans/2026-10-19-action-feedback.md), com arquivos, contratos, testes e ordem de migração, e selecionar o método de execução. A aprovação não autoriza publicação.
