# Guia de trabalho do Mesiva

## Contexto e fontes
- Mesiva opera restaurantes: pedidos/cozinha, mesas/comandas, clientes, catálogo, financeiro, relatórios e impressão. Converse e documente em português, preservando os nomes do código.
- Estado atual: React/React Router/Vite, Worker/D1/R2, login por e-mail e senha multiempresa e impressão central Windows/QZ. PIN, Web Serial e RawBT não são os fluxos atuais.
- Comece pelo [índice da base de conhecimento](docs/README.md) e selecione somente as fontes pertinentes. [README](README.md) cobre instalação e comandos; [release](docs/release-and-migration-runbook.md) cobre deploy/migrations; [produção multiempresa](docs/operations/multi-company-production.md) cobre acesso/administração; [Windows/QZ](docs/operations/windows-qz-tray-printing.md) cobre impressão. Registros datados podem ser históricos.

## Consulta seletiva à documentação viva
Os documentos abaixo **orientam a leitura**, mas não dispensam confirmar código, testes, migrations e configurações na **branch/SHA efetivamente trabalhada**. Não carregue todos por padrão.

| Necessidade | Documento inicial | Complemento quando necessário |
| --- | --- | --- |
| Entender o produto, jornadas e escopo existente | [PRD](docs/product/PRD.md) | Código do módulo e decisões aprovadas |
| Conferir regras, exceções, permissões ou impactos entre fluxos | [Business Rules](docs/product/BUSINESS_RULES.md) | Testes, contratos e implementação do Worker |
| Entender camadas, dados, isolamento multiempresa e deploy | [Architecture](docs/architecture/ARCHITECTURE.md) | Configuração e runbook operacional pertinente |
| Descobrir owner, `index.js` público, fluxo ou teste a editar | [Module Map](docs/architecture/MODULE_MAP.md) | Imports, consumidores, checker e testes afetados |
| Alterar tela, tema, tokens, componentes ou marca | [Design System](docs/design/DESIGN_SYSTEM.md) | Guia oficial e registros de aprovação citados no documento |
| Saber qual fonte é atual, qual é histórica e o que falta documentar | [Índice documental](docs/README.md) | Spec, plano ou QA específico **somente quando o contexto exigir** |

- **Conflitos e evidências:** documento vivo registra a baseline que foi auditada, **não** prova comportamento de qualquer branch posterior nem deploy em produção. Diante de divergência entre documentação, implementação e intenção aprovada, investigar, registrar e pedir decisão quando necessário; não corrigir silenciosamente regras de negócio para combinar com uma spec antiga.
- **Identidade visual:** o Design System explica as divergências ainda abertas entre o guia v1.0 e os vetores aprovados depois. Não recolorir/recriar logos nem apresentar a atualização formal do guia no Drive como concluída.
- **Histórico:** specs, planos, QA e releases preservam decisões e evidências de seus próprios SHAs; consultar pontualmente. Mudança funcional/visual deve atualizar **somente os documentos vivos afetados**, na mesma PR, com fonte verificável. Nenhum desses documentos autoriza merge, migration remota ou produção.

## Localização rápida
Pontos de entrada, não lista completa. Depois, siga imports, regras, adaptadores e testes da área; confirme os consumidores antes de mudar um componente compartilhado.

| Assunto | Comece por |
| --- | --- |
| Rotas, menus e capabilities de navegação | `src/app/navigation/registry.js` |
| Cozinha / card de pedido | `src/domains/orders/ui/Orders.jsx`; `src/domains/orders/ui/components/KitchenTicket.jsx` |
| Novo pedido | `src/domains/orders/ui/NewOrder.jsx` |
| Edição de pedido / saldo complementar | `worker/orderEditRepository.js`; `worker/orderPaymentReadModel.js`; `worker/paymentRepository.js`; `src/app/workflows/payments/` |
| Histórico de pedidos | `src/domains/orders/ui/OrderHistory.jsx` |
| Detalhes compartilhados de pedido | `src/domains/orders/ui/components/OrderDetail.jsx` |
| Clientes / relacionamento | `src/domains/customers/ui/CustomersWorkspace.jsx`; `src/domains/customers/ui/ClientRelationshipPanel.jsx` |
| Relatórios / drawer | `src/domains/reporting/ui/ReportingWorkspace.jsx`; `src/domains/reporting/ui/detail/ReportingOrderDrawer.jsx` |
| Produtos e preços | `src/domains/catalog/ui/CatalogWorkspace.jsx` |
| Mesas e comandas | `src/domains/table-service/ui/` |
| Financeiro / a receber | `src/domains/finance/ui/FinanceWorkspace.jsx`; `src/domains/finance/ui/Receivables.jsx` |
| Recebimentos: pedido, comanda, lote de clientes | `src/app/workflows/payments/` |
| Sincronização / WebSocket e fallback | `src/infrastructure/realtime/`; `src/app/runtime/data/useOperationalDataRuntime.js`; `worker/realtime/`; [operação](docs/operations/realtime-sync.md) |
| Snapshots / histórico e financeiro paginados | `worker/readModels/`; `shared/scopedReads.js`; `src/infrastructure/realtime/useScopedQuery.js`; `src/infrastructure/api/scopedReadsApi.js` |
| Fila de impressão / transporte QZ | `src/domains/printing/ui/PrintQueue.jsx`; `src/infrastructure/qz/` |
| Configurações / conta e equipe | `src/app/surfaces/settings/SettingsSurface.jsx`; `src/domains/access/ui/AccessSurface.jsx` |
| Administração Mesiva / empresas e convites | `src/domains/platform/ui/PlatformRoutes.jsx`; `worker/platform/businessesApi.js` |
| Botões, ícones, modais, selects e badges | `src/shared/ui/` |
| Bootstrap por superfície / consultas históricas | `worker/readModels/`; contratos em `shared/scopedReads.js`; runtime em `src/app/runtime/data/` |
| API / contexto e autorização | `worker/entry.js`; `worker/index.js`; `worker/access/authorization.js` |

## Arquitetura
- `src/app/` compõe shell, rotas, runtime, superfícies e workflows. `src/domains/<domínio>/` separa `domain/` (regras puras), `application/` (coordenação), `infrastructure/` (adaptadores) e `ui/`.
- Consumidores externos entram pelo `index.js` de cada domínio, sem imports profundos. Regras de domínio não dependem de React, DOM, HTTP ou infraestrutura.
- `src/shared/` é genérico do frontend e não importa domínios; `shared/` na raiz contém contratos/regras entre frontend e Worker. `src/infrastructure/` concentra HTTP/auth/storage/QZ.
- Preserve os clientes HTTP/contexto, a propriedade das mutations e os bloqueios ao trocar sessão/empresa ou perder conexão. D1/Worker são a autoridade de dados e preços.
- Não recrie owners legados em `src/pages`, `src/components`, `src/api`, `src/hooks`, `src/utils` ou `src/printing`. Não enfraqueça o checker de arquitetura.

## Trabalho e economia de contexto
- Confira branch e `git status`; preserve alterações de outros chats/usuário. Para nova entrega independente, prefira worktree e branch `codex/<tarefa>` da `master` remota atualizada; reutilize um ambiente adequado existente.
- Mantenha um objetivo por PR e o escopo solicitado. Não edite o mesmo checkout em paralelo; separe portas e persistência para testes simultâneos.
- Ao procurar o owner de uma tarefa, comece pelo [Module Map](docs/architecture/MODULE_MAP.md) e por buscas específicas com `rg --files`/`rg -n`, limitadas à área. No PowerShell, passe globs de arquivos por `-g` (ex.: `rg -n texto scripts/infra -g '*gate*'`), sem usar um caminho literal com `*`. Leia trechos relevantes antes de arquivos inteiros; siga dependências e amplie a busca quando a evidência exigir.
- Consulte apenas documentos pertinentes; não carregue todos os runbooks, planos ou arquivos do repositório para uma tarefa localizada. Evite reler conteúdo já compreendido sem mudança ou dúvida.
- Filtre saídas extensas para os erros, trechos e resumos necessários, mantendo contexto suficiente para diagnóstico. Não imprima bundles, lockfiles, base64 ou logs completos sem necessidade.
- Agrupe leituras/buscas independentes; mantenha edições e operações dependentes em sequência. Não repita comandos ou verificações aprovados no mesmo estado sem mudança relevante, falha ou dúvida nova.
- Economia não autoriza pular instruções aplicáveis, análise de impacto, testes ou gates. Informe limitações; não trate contagem de linhas/bytes como medição exata de tokens ou de custo.
- Execute o trabalho autorizado sem reconfirmar decisões rotineiras. Implementação, staging, merge e produção têm o alcance da autorização recebida. Para mudanças visuais relevantes, apresente prévia, salvo desenho já aprovado ou pedido de implementação direta.

## Ambiente local
- Node.js 22, `npm ci` e versões de Wrangler fixadas nos scripts. Não use `latest` nem dependa de instalação global.
- Vite: `npm run dev -- --host 127.0.0.1` (4173, proxy `/api` para 8787). Worker: `npm run dev:worker -- --local --ip 127.0.0.1 --port 8787`; gere `dist/` com `npm run build` antes da primeira execução. `npm run preview` não inicia API.
- Confira processos e persistência antes de iniciar/reiniciar. Com estado em `.wrangler/local-orders-state`, use `--persist-to .wrangler/local-orders-state` no Worker e em `npm run d1:migrate:local`; exemplos no README.
- Não apague/recrie D1 local para resolver login ou gravação: investigue API, sessão, migrations e permissões. Use contas/dados fictícios; não há credencial universal nem cópia automática das contas remotas.
- Preserve servidores/bancos existentes. Ao encerrar testes, termine somente processos criados pela tarefa.

## Interface, permissões e operação
- Reutilize `src/shared/ui/` e os componentes dos domínios. Para alterações visuais, consulte o [Design System](docs/design/DESIGN_SYSTEM.md) e as referências da marca; use tokens/temas existentes; badges seguem `--badge-radius`/`--badge-font-weight`. Preserve peso de títulos/valores e hierarquia aprovada; sem glow nos botões, com foco visível.
- Confira desktop/mobile, teclado, foco/scroll de modais e estados vazios/loading/erro. Seleções devem ficar acessíveis; menus fecham ao clicar fora e por Escape. Atalhos executam a ação anunciada.
- Alterações em `OrderDetail` exigem conferir consumidores da cozinha, histórico e clientes, além do drawer de relatórios.
- Configuração auth canônica em `wrangler.jsonc`: e-mail e multiempresa ativos, preparação desativada. Preserve a separação entre administração Mesiva e vínculos operacionais.
- Autorize por capabilities reais da sessão/contexto, nunca pelo nome do perfil. Referências: `shared/settingsAccess.js`, `src/app/access.js`, `worker/access/authorization.js`; defaults em `worker/access/roles.js` não substituem grants persistidos.
- Recebimentos exigem `payments.receive` e permissões da superfície; esconder botão não substitui autorização no Worker. Derive a empresa do contexto autenticado e preserve isolamento entre empresas em dados, relatórios e ações.
- Receber não finaliza preparo. Reutilize os workflows e saldos oficiais; quitados/cancelados não entram em recebimento. Pedido já recebido com saldo de edição usa complemento, preservando o payment original; lotes de cliente cobram somente os saldos, com recibo único. Comanda aberta usa seu fluxo; ajuste após comanda quitada não reabre ocupação. Preserve efeitos oficiais e regras de valores/datas/fuso em `shared/finance.js`.
- Impressão: fila central → estação principal Windows → QZ/spooler → USB. `qz.print()` não confirma saída física; preserve histórico de vias, confirmação do spooler e decisão humana para resultado desconhecido, sem reenvio automático. Mudanças de hardware exigem validação física pelo runbook.
- Nunca exponha senhas, cookies, tokens, links de ativação/recuperação ou valores de secrets em Git, documentos, logs ou mensagens.

## Verificação e entrega
- Reproduza bugs e cubra comportamentos/casos relevantes, sem testes que apenas copiam a implementação. Use `node --test <arquivo.test.js>` durante o desenvolvimento.
- Antes de entregar código: `npm run test:architecture`, `npm run lint`, `npm run build` e gates pertinentes. A suíte `npm test` roda em oito shards no CI e deve estar verde para integrar/publicar; não elimine validações para economizar tokens.
- Worker/schema/printing/configurações podem exigir dry-runs e gates D1; consulte o runbook e `.github/workflows/validate.yml`. Repita verificações quando mudanças relevantes invalidarem a evidência anterior.
- Somente documentação: confira links, comandos, coerência e `git diff --check`, sem builds/suíte da aplicação desnecessários. Informe verificações executadas, falhas/travamentos e limitações; sucesso exige evidência.
- Entregue resumo conciso do resultado, validação e riscos materiais; indique documentos e legados revisados quando pertinente.

## Documentação e aprendizado contínuo
- Ao concluir cada tarefa, confira [README](README.md), AGENTS e os **documentos vivos afetados** listados no [índice](docs/README.md). Atualize na mesma entrega/PR quando a mudança tornar instruções incorretas/incompletas; não altere apenas para registrar atividade.
- README descreve instalação, funcionalidades e operação atual; AGENTS registra regras duradouras e caminhos de consulta; PRD, Business Rules, Architecture, Module Map e Design System registram detalhes por assunto. Runbooks preservam procedimentos; PRs/issues/QA preservam histórico e evidências. Evite duplicar instruções entre documentos.
- Durante o uso, identifique atritos: buscas repetidas, entrada de código difícil de localizar, comando incorreto, verificação redundante ou procedimento confuso. Quando a melhoria estiver comprovada pelo código, execução ou decisão do usuário, atualize diretamente este guia ou o documento responsável, sem exigir um pedido separado para essa manutenção.
- Registre apenas aprendizados reutilizáveis, com instrução concreta e curta. Consolide/corrija regras existentes antes de acrescentar novas; mantenha os caminhos do mapa atualizados e detalhes específicos na área correspondente.
- Hipóteses e preferências não aprovadas devem ser apresentadas como sugestões, não convertidas em regras. Melhorar o guia não autoriza mudar produto, workflows, permissões, gates ou ampliar escopo; essas alterações seguem a autorização da tarefa.
- Informe a melhoria documental e sua razão na entrega/PR. Isso é orientação para as próximas tarefas, não uma automação ou garantia de autoatualização fora de uma sessão de trabalho.

## Limpeza
- Remova sobras relacionadas à tarefa (código substituído sem consumidores, imports, duplicações, temporários). Limpezas amplas têm escopo próprio.
- Antes de excluir código/CSS/assets/scripts/workflows/dependências, confira referências, imports dinâmicos, entrypoints, npm, CI e procedimentos; uma busca sem resultado não prova desuso. Remoção de dependência inclui lockfile pelo gerenciador e verificação dos consumidores.
- Preserve compatibilidade/upgrade/recuperação ainda necessários e os testes desses cenários. Documentos operacionais obsoletos devem ser atualizados, consolidados ou removidos; retire links correntes e aponte substitutos.
- Specs/planos/QA/releases com valor histórico ficam identificados como históricos/substituídos, com referência atual. Não mantenha vários guias vigentes do mesmo assunto.
- Não remova migrations aplicadas, evidências de recuperação/auditoria, dados persistidos, secrets locais ou anexos do usuário. `.wrangler/` contém também bancos/configurações; não é inteiramente descartável.
- Builds/logs/temporários ficam fora do versionamento. Evite exclusões em massa; atualize referências após mover/remover e confira o diff.

## Publicação e migrations
- Siga o runbook: PR/CI → staging/homologação → merge → CI/staging da master → produção explícita. Confira restrições em `.github/workflows/deploy-staging.yml`; nova branch `codex/` não é automaticamente elegível.
- Publicação normal é GitHub Actions, sem atalhos locais de deploy/migrations remotas. Merge não autoriza produção; `Deploy production` é manual, master-only, com CI/staging verdes para o SHA exato.
- Preserve o reaproveitamento da suíte aprovada, demais gates e bookmark automático D1 antes das migrations; não reintroduza checkbox manual de backup.
- Desenvolvimento/staging usam dados fictícios: não copie produção nem crie lançamentos fictícios nela para testar.
- Preserve históricos/compatibilidade. Crie migrations novas, não edite/remova as aplicadas. Transformações destrutivas exigem impacto e estratégia de restauração revisados; rollback considera bundle, schema e dados.
