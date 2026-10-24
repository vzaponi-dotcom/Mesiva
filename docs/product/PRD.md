# PRD — Mesiva | Visão do produto e escopo implementado

- **Tipo:** documento vivo de produto (Product Requirements Document).
- **Versão:** v0.3 — atualização focal em 17/10/2026 (consolidação inicial de 12–13/10/2026).
- **Baselines:** levantamento inicial `master@e595f7ed2a801fde6ffab231194788430cc53316`; mudanças desta revisão verificadas em `master@9289523f9b3c6094ed8f27a66b05aa527f25d16d` (PRs #108, #117, #118 e contratos operacionais/realtime atuais). **Não** representa reauditoria exaustiva dos demais módulos.
- **Status:** consolidação inicial baseada em [README](../../README.md), [AGENTS.md](../../AGENTS.md), navegação e módulos do repositório; não é homologação funcional completa de cada tela.
- **Idioma:** português do Brasil.

> **Como ler o status:** “Disponível na baseline” significa que o recurso foi identificado no código e/ou nas instruções atuais da `master`, não que um deploy de produção no mesmo SHA tenha sido verificado. Uma spec aprovada, isoladamente, não torna um recurso implementado. Confirmar diferenças entre `master`, staging e produção por release e evidências do ambiente.

## 1. Visão do produto

A **Mesiva** é uma aplicação web de apoio à operação de restaurantes. Reúne pedidos e cozinha, mesas/comandas, clientes, catálogo de produtos, financeiro, relatórios, configurações e impressão em um fluxo integrado, com acesso por contas e contexto da empresa.

O produto atende à necessidade de manter informações operacionais coerentes entre pessoas/dispositivos, com regras de acesso, registro financeiro e rastreabilidade. Seu objetivo funcional é facilitar a operação diária sem depender do navegador como fonte definitiva dos dados de negócio.

### Resultados funcionais que a aplicação procura entregar

- **Operação:** registrar e consultar o ciclo de pedidos, atendimentos locais e recebimentos nos fluxos autorizados, sem perder a ligação entre os registros.
- **Cozinha:** acompanhar filas e prioridades operacionais, inclusive em TV, sem confundir filtros de exibição com a situação oficial do pedido.
- **Gestão:** consultar informações financeiras e relatórios por meio dos dados oficiais do estabelecimento.
- **Administração Mesiva:** gerir empresas e acessos administrativos sem adquirir automaticamente permissão operacional sobre os restaurantes.

São objetivos funcionais inferidos dos módulos implementados e de seus fluxos, **não indicadores de sucesso validados com usuários**. Esta edição **não** estabelece posicionamento comercial, preços de assinatura, personas pesquisadas, metas numéricas, SLAs ou compromissos de roadmap; esses assuntos exigem decisões e evidências específicas.

## 2. Pessoas e contextos de uso

| Contexto | Necessidade principal | Limite relevante |
| --- | --- | --- |
| Operação do restaurante | Registrar e acompanhar pedidos, mesas, clientes, recebimentos e configurações permitidas | Acesso efetivo por capacidades (`capabilities`) no contexto da empresa |
| Cozinha | Acompanhar preparo, agendamentos e prioridades; usar painel TV e seu controle | Visibilidade na TV não equivale ao status oficial de um pedido |
| Gestão da empresa | Consultar indicadores, movimentações, relatórios, equipe e políticas | Permissões dependem de grants efetivos, não apenas do nome do perfil |
| Administração Mesiva (plataforma) | Gerenciar empresas, convites e vínculos e acompanhar situações administrativas | Contexto global separado dos dados operacionais de cada empresa |

Esses são **contextos funcionais**, não uma matriz de cargos/perfis ou permissão irrestrita. A matriz de capacidades tem como fontes `shared/settingsAccess.js`, `src/app/access.js`, `worker/access/authorization.js` e `worker/access/roles.js`.

## 3. Módulos disponíveis na baseline

| Módulo | Escopo identificado | Pontos de entrada de referência |
| --- | --- | --- |
| **Acesso, conta e empresas** | Login por e-mail/senha, recuperação de acesso, convites, vínculo e seleção de empresa; administração de equipe e registros de atividades | `src/domains/access/`, `src/domains/companies/`, `worker/access/`, `worker/identity/` |
| **Administração Mesiva** | Visualização e gestão de empresas; suspensão, retomada, exclusão recuperável/restauração e ações autorizadas sobre vínculos/convites | `src/domains/platform/`, `worker/platform/` |
| **Pedidos e cozinha** | Novo pedido, acompanhamento do preparo, histórico, agendamentos, detalhes, edição de pedidos ativos, cancelamentos e filtros independentes de situação/modalidade na Cozinha; pagamentos continuam distintos dos estados operacionais | `src/domains/orders/`, `src/app/navigation/registry.js` |
| **TV da Cozinha e controle** | Painel independente da TV, pareamento/compatibilidade, navegação por páginas e controle a partir do Gestor; filtros por modalidade e visibilidade específicos do painel | `src/kitchen-display/`, `src/app/surfaces/kitchen-tv-control/`, `worker/kitchenTvApi.js` |
| **Mesas, comandas e reservas** | Gestão de mesas, consumo por comanda, reservas e fluxos associados a pagamentos/transferências, conforme permissões | `src/domains/table-service/`, `src/app/workflows/payments/table-tab/` |
| **Clientes** | Cadastro, consulta e relacionamento; histórico e recebimento elegível de pedidos de clientes | `src/domains/customers/`, `src/app/workflows/payments/client-orders/` |
| **Produtos e preços** | Catálogo de produtos, apresentação e manutenção autorizada dos itens utilizados em pedidos | `src/domains/catalog/` |
| **Financeiro** | Visão geral, contas a receber, movimentações e formas de pagamento; recebimentos, conferência por dia/forma e acompanhamento de divergências com histórico de solução | `src/domains/finance/`, `src/app/workflows/payments/` |
| **Relatórios** | Consultas filtradas do desempenho/da operação, visualizações analíticas e exportação em CSV, PDF e XLSX | `src/domains/reporting/` |
| **Impressão** | Fila de jobs, configuração e execução centralizada na estação Windows com QZ Tray, controle de cópias, atenção e recuperação operacional | `src/domains/printing/`, `src/infrastructure/qz/`, `worker/orderPrintingApi.js` |
| **Configurações e preferências** | Políticas da operação, modalidades, pagamentos, cancelamentos, categorias, impressão, identidade da operação, preferências locais e aparência | `src/app/surfaces/settings/`, `docs/operations/spec-b-settings.md` |

**Rotas principais:** a navegação operacional e seus requisitos de capability estão em [`src/app/navigation/registry.js`](../../src/app/navigation/registry.js). Nem toda rota é visível a toda conta; o registro de navegação não substitui a autorização do Worker.

### 3.1 Modalidades e terminologia oficial

| Uso | Valor de negócio no código | Nome na interface do controle da TV |
| --- | --- | --- |
| Entrega | `Entrega` | **Entrega** |
| Retirada | `Retirada` | **Retira** |
| Consumo no local | `Local` | **Mesa** |

O domínio dos pedidos define essas modalidades em [`orderTypeOptions.js`](../../src/domains/orders/domain/orderTypeOptions.js); o filtro da TV mapeia seus rótulos em [`shared/kitchenTvModality.js`](../../shared/kitchenTvModality.js) e [`KitchenTvControlSurface.jsx`](../../src/app/surfaces/kitchen-tv-control/KitchenTvControlSurface.jsx). **Mesa** é o nome de exibição nesse filtro, não um quarto valor de `order.type`. Não presumir que qualquer pedido `Local` esteja necessariamente vinculado a uma comanda; o vínculo é verificado separadamente.

### 3.2 Pedidos, preparo e recebimento — distinções essenciais

- O checkout contempla múltiplos itens, quantidades, observações por item, taxa de entrega e ajustes. O Worker recalcula valores oficiais.
- **Salvar pedido** preserva o recebimento pendente; **Salvar e receber** registra pagamento conforme elegibilidade e permissão.
- Status de pagamento e status operacional/preparo são independentes: receber não finaliza automaticamente o preparo.
- Pedidos associados a comanda seguem o fluxo de recebimento da comanda. Regras de elegibilidade excluem pedidos já pagos ou cancelados dos fluxos inadequados.
- Na **Cozinha administrativa**, os filtros de situação (`Todos`/`Atrasados`) e modalidade (`Todas`/`Entrega`/`Retirada`/`Mesa`) são combináveis com a busca. `Mesa` corresponde a `Local`; o filtro modifica a lista visível e não cria outra modalidade no banco (PR #117).
- Em pedidos `Local` de comanda aberta, o cliente identificado no lançamento anterior é reutilizado quando o novo lançamento não escolhe outro cliente. A **TV** recebe `Mesa · Cliente` quando há mesa e cliente identificados, ou somente o nome da mesa quando não há cliente. A TV tem projeção própria; não confundir com o filtro de Cozinha (PR #118).
- Pedidos ativos elegíveis podem ser **editados** com revisão e autorização; itens já existentes preservam o preço histórico, enquanto novos itens usam preço válido do catálogo. Diferenças positivas/negativas são conciliadas pelo saldo ou devolução oficial, sem reabrir uma comanda quitada nem criar pedido novo (PR #108).
- A TV e seu controle podem mudar a **exibição** dos pedidos sem, por isso, cancelar ou finalizar o pedido oficial.

Este resumo não substitui o catálogo detalhado de [regras de negócio vigentes](BUSINESS_RULES.md), com fontes e condições de exceção. Antes de uma implementação, reconferir também código e testes da branch/SHA.

### 3.3 Administração multiempresa

O login compartilhado por PIN é legado e **não** representa a autenticação corrente. Contas Mesiva, associação a empresas e administração global são conceitos distintos. A operação multiempresa em produção e seu processo de recuperação encontram-se no [runbook corrente](../operations/multi-company-production.md).

A gestão administrativa de empresas foi identificada na `master` desta baseline. Sua presença no repositório **não certifica** implantação em produção na mesma versão; verificar releases e homologação antes de declarar status de publicação.

### 3.4 Impressão

O caminho operacional é **dispositivo solicitante → fila central → estação principal Windows → QZ Tray → spooler Windows → impressora USB**. Solicitar/imprimir no transporte não comprova entrega física: a confirmação e a recuperação seguem regras próprias. Não assumir reenvio automático seguro em falhas incertas.

Consulte o [runbook Windows/QZ](../operations/windows-qz-tray-printing.md) para configuração, estados, vias, falhas e aceitação física; não reintroduzir Web Serial/RawBT como arquitetura atual.

### 3.5 Requisitos funcionais de referência (baseline)

Estes requisitos expressam **capacidades já identificadas**, não novas solicitações nem critérios de homologação aprovados. A implementação específica e as exceções estão nos contratos e testes vinculados.

| ID | Capacidade exigida no fluxo atual | Evidência principal |
| --- | --- | --- |
| RF-01 | Restringir operações à conta, empresa e capacidades efetivas do contexto autenticado. | `worker/access/authorization.js`; `src/app/access.js` |
| RF-02 | Persistir pedidos e calcular valores oficiais no backend, sem depender do total calculado pelo navegador. | `worker/orderCheckout.js`; `src/domains/orders/` |
| RF-03 | Controlar os filtros/páginas da TV e a ocultação da exibição sem finalizar ou cancelar pedidos oficiais. | `shared/kitchenTvModality.js`; `worker/kitchenTvControlRepository.js` |
| RF-04 | Encaminhar recebimentos de pedidos vinculados à mesa/comanda pelo fluxo próprio da comanda, e não como recebimento avulso do pedido. | `worker/orderCheckout.js`; `src/domains/orders/domain/orderPaymentEligibility.js` |
| RF-05 | Respeitar permissões e elegibilidade ao compor ou registrar pagamentos; manter recebimento distinto do preparo. | `src/app/workflows/payments/paymentComposition.js`; `src/domains/orders/domain/orderPaymentEligibility.js` |
| RF-06 | Oferecer consulta de relatórios e exportação CSV/XLSX/PDF a quem possuir a capacidade correspondente. | `src/domains/reporting/ui/ReportingExportMenu.jsx` |
| RF-07 | Distinguir job de impressão confirmado, falho ou de resultado incerto, preservando tratamento de atenção. | `src/domains/printing/application/printJobRunner.js`; runbook Windows/QZ |
| RF-08 | Separar administração global Mesiva das capacidades concedidas nas empresas. | `src/domains/platform/ui/PlatformRoutes.jsx`; runbook multiempresa |
| RF-09 | Filtrar a Cozinha por situação e modalidade sem mutar o pedido nem transformar `Mesa` em quarta modalidade interna. | `src/domains/orders/ui/Orders.jsx`; `src/domains/orders/domain/kitchenQueue.test.js` (PR #117) |
| RF-10 | Manter cliente identificado entre pedidos da mesma comanda e exibir a identidade contextual `Mesa · Cliente` na TV, sem expor atributos adicionais no card. | `worker/repositories.js`; `worker/kitchenTvReadRepository.js`; testes correspondentes (PR #118) |
| RF-11 | Editar pedido elegível preservando preços históricos, revisão e conciliação oficial do saldo; recebimento ou devolução não altera automaticamente o estado de preparo. | `worker/orderEditValidation.js`; `worker/orderEditRepository.js`; `docs/operations/order-editing.md` (PR #108) |
| RF-12 | Quando os read models por superfície estiverem habilitados, carregar somente o escopo necessário e consultar histórico/financeiro por filtros/páginas, preservando totais oficiais e acesso a registros antigos. | `worker/readModels/snapshotRepository.js`; `src/infrastructure/realtime/useScopedQuery.js`; `docs/operations/realtime-sync.md` |

As restrições, exceções e invariantes ficam no [BUSINESS_RULES.md](BUSINESS_RULES.md). **Não** replicar integralmente essa lógica no PRD.

## 4. Jornadas principais

As jornadas abaixo conectam módulos existentes; **não** substituem testes de caso de uso nem descrevem todas as variantes:

1. **Acessar o negócio:** autenticar com e-mail/senha → resolver conta/vínculos → selecionar contexto de empresa quando aplicável → acessar apenas áreas permitidas.
2. **Registrar e preparar pedido:** criar pedido com itens e modalidade → persistir valores/itens oficiais no Worker → acompanhar a cozinha e, quando necessário, a TV → concluir o fluxo operacional conforme regras da modalidade.
3. **Operar mesas/comandas:** consultar mesa/reserva → registrar consumo → acompanhar comanda → realizar recebimento e fechamento pelo fluxo correto.
4. **Receber e acompanhar financeiro:** registrar recebimento elegível → refletir valores em movimentações/contas a receber → consultar relatórios com filtros.
5. **Imprimir:** gerar solicitação de impressão → processar job na estação principal autorizada → confirmar resultado pelo mecanismo previsto ou tratar exceção/atenção.
6. **Gerir empresas (plataforma):** autenticar em contexto administrativo → consultar empresas → executar apenas ações concedidas, preservando isolamento e histórico.

## 5. Requisitos transversais e limites confirmados

### 5.1 Fonte de dados e integridade

- A API roda em **Cloudflare Workers**. **D1** é a autoridade para dados de negócio; **R2** guarda ativos de negócio conforme configuração.
- Preferências locais podem permanecer no dispositivo; não usar `localStorage` como autoridade para autenticação, preços, pagamentos ou estados oficiais.
- Escritas de negócio não são enfileiradas offline. Uma interface offline não deve simular confirmação definitiva de gravação.
- O backend valida contexto da empresa, identidade, permissões e valores relevantes. Não confiar em botões ocultos como defesa única.

**Eficiência sem redução funcional:** leituras por superfície, candidatos ativos, consultas por IDs, paginação de histórico/financeiro e cache contextual podem reduzir carregamentos desnecessários. Os dados e totais oficiais continuam sendo calculados/revalidados no servidor; coleções parciais não autorizam inferir exclusão ou zerar pendências. A disponibilidade desses mecanismos depende das flags, da rota e do SHA implantado. Referências: [orçamento D1](../operations/operational-data-read-budget.md) e [sincronização e orçamento Cloudflare](../operations/realtime-sync.md). O impacto financeiro mensal **não** é dedutível apenas desses mecanismos ou de testes locais.

### 5.2 Interfaces e dispositivos

- Aplicação administrativa web com superfícies desktop e mobile; TV da Cozinha possui entrada própria em `/cozinha-tv`.
- Estados de loading, erro, desabilitado, foco, filtros e leitura operacional devem permanecer distinguíveis.
- Interfaces devem respeitar permissões efetivas e comportamentos de navegação/recarregamento.
- O repositório possui ativos Mesiva em `public/brand/`. O [Design System](../design/DESIGN_SYSTEM.md) documenta o [guia visual v1.0](https://drive.google.com/file/d/1YHj8qfsBMhGz7BQCCyTn69iQ8qtMOjKc/view) e o [refinamento aprovado em 02/10](../operations/2026-10-02-mesiva-logo-refinement.md), incluindo divergências cujo fechamento formal no guia do Drive ainda está pendente.

### 5.3 Segurança e publicação

- Ambientes local, staging e produção têm fronteiras próprias; staging usa dados fictícios e não recebe cópias de dados reais.
- Alterações passam por branch/PR, validação e homologação; **merge não autoriza produção**.
- Produção exige fluxo manual e evidências de CI/staging no SHA publicado. Detalhes no [runbook de release](../release-and-migration-runbook.md).

## 6. Fora do alcance deste PRD inicial

Este arquivo **não** aprova novas funcionalidades, alterações de código, regras de preço comercial, faturamento da plataforma, planos pagos, integrações futuras, nova arquitetura ou métricas de desempenho. Também não garante que todas as telas e permissões foram homologadas novamente nesta revisão documental.

Não classificar uma funcionalidade como “planejada” apenas por existir uma spec histórica. Para backlog e futuros compromissos, consultar as issues/PRs atuais e obter decisão específica do proprietário.

## 7. Evidências, pendências e evolução

### 7.1 Níveis de evidência

- **Identificado na baseline:** recurso confirmado na `master` pelas implementações e/ou documentação corrente citadas neste documento.
- **Validado em staging:** exige referência específica à homologação e ao SHA; este PRD não fornece essa garantia automaticamente.
- **Publicado em produção:** exige identificação do release implantado e evidência do ambiente, não apenas presença na `master`.
- **Proposto:** depende de especificação/decisão separada; não deve aparecer nas tabelas de funcionalidades atuais sem indicação explícita.

### 7.2 Pontos a aprofundar nas próximas etapas

- **Regras de negócio:** [consolidação inicial disponível](BUSINESS_RULES.md). Ampliar cobertura e validar exceções sempre que um domínio for alterado.
- **Arquitetura e ownership:** [Architecture](../architecture/ARCHITECTURE.md) e [Module Map](../architecture/MODULE_MAP.md) disponíveis, com responsabilidades por módulo, contratos públicos e integração entre domínios.
- **Design System:** [consolidação inicial disponível](../design/DESIGN_SYSTEM.md), com tokens/componentes, temas e checklist; **atualização normativa do guia oficial do Drive ainda pendente**.
- **Produto/negócio:** posicionamento, segmentos atendidos, indicadores de sucesso e roadmap, **somente após definição com o proprietário**.
- **Status de publicação:** relacionar capacidades a releases quando for necessária uma afirmação sobre produção, em vez de inferi-la da `master`.

## 8. Referências verificadas para esta edição

- [README vigente](../../README.md) e [instruções para agentes](../../AGENTS.md).
- [Registro de navegação](../../src/app/navigation/registry.js), [entrada do aplicativo](../../src/main.jsx) e [camada de composição](../../src/App.jsx).
- [Domínios de frontend](../../src/domains/), [workflows de pagamento](../../src/app/workflows/payments/) e [entrada da API](../../worker/entry.js).
- [Operação multiempresa](../operations/multi-company-production.md), [políticas de configuração](../operations/spec-b-settings.md) e [impressão física](../operations/windows-qz-tray-printing.md).
- [Edição de pedidos e saldo](../operations/order-editing.md), [orçamento D1](../operations/operational-data-read-budget.md) e [sincronização e custo Cloudflare](../operations/realtime-sync.md).
- [PR #117 — filtros de Cozinha](https://github.com/vzaponi-dotcom/Mesiva/pull/117) e [PR #118 — identidade Mesa/Cliente na TV](https://github.com/vzaponi-dotcom/Mesiva/pull/118).
- [Refinamento da marca](../operations/2026-10-02-mesiva-logo-refinement.md).
- [Arquitetura atual](../architecture/ARCHITECTURE.md) e [fluxo de release](../release-and-migration-runbook.md).

**Manutenção:** atualizar se uma entrega mudar o produto implementado; registrar PR/commit e rever a baseline. Em revisões posteriores, reconferir os vínculos entre requisitos RF, código, testes e operação. Não reescrever specs históricas como se fossem documentação viva. O índice de navegação fica em [`docs/README.md`](../README.md).
