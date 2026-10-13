# Mesiva — Mapa de módulos e responsabilidades

- **Tipo:** documentação viva de localização de código, ownership funcional e contratos de integração.
- **Versão:** v0.1 — 13/10/2026.
- **Baseline:** `master@e595f7ed2a801fde6ffab231194788430cc53316`, mesma referência do [PRD](../product/PRD.md), [Business Rules](../product/BUSINESS_RULES.md) e [Architecture](ARCHITECTURE.md).
- **Escopo verificado:** árvore do repositório, os **10 `src/domains/*/index.js` públicos**, adaptadores de API, composição da aplicação, testes de contratos selecionados e checker de imports.
- **Limite:** este é um mapa de **primeira leitura**, não uma lista completa de todos os exports/funções/rotas nem um grafo de dependências calculado sobre todos os arquivos. Os caminhos são da baseline indicada; uma nova branch precisa reconferi-los.

Use este documento para saber **onde começar e o que não mover**. A [arquitetura](ARCHITECTURE.md) explica o desenho geral e as fronteiras de confiança; o [PRD](../product/PRD.md) explica as capacidades; as [regras de negócio](../product/BUSINESS_RULES.md) registram invariantes; o [AGENTS.md](../../AGENTS.md) define o processo de desenvolvimento. Specs antigas são histórico, não ownership atual.

## 1. Busca rápida: tarefa → ponto de entrada

| Se precisa alterar… | Owner inicial no frontend | APIs e backend para conferir |
| --- | --- | --- |
| Login, conta, senhas, equipe, convites de acesso e histórico de atividades | [`access/`](../../src/domains/access/), [runtime de sessão](../../src/app/runtime/session/) | [`worker/access/`](../../worker/access/), [`worker/identity/`](../../worker/identity/) |
| Seleção de empresa e aceitação de convite multiempresa | [`companies/`](../../src/domains/companies/) | [`worker/tenancy/`](../../worker/tenancy/), [`worker/identity/`](../../worker/identity/) |
| Administração global Mesiva: cadastro/gestão de empresas e vínculos | [`platform/`](../../src/domains/platform/) | [`worker/platform/`](../../worker/platform/) |
| Novo pedido, cozinha, histórico, cancelamento e promessas | [`orders/`](../../src/domains/orders/) | [`worker/orderCheckout.js`](../../worker/orderCheckout.js), [`worker/orderCancellation.js`](../../worker/orderCancellation.js), [`worker/orderReadRepository.js`](../../worker/orderReadRepository.js) |
| Mesas, comandas, transferência, reservas e chegada | [`table-service/`](../../src/domains/table-service/) | [`worker/tableRepository.js`](../../worker/tableRepository.js), [`worker/tableReservationApi.js`](../../worker/tableReservationApi.js) |
| Clientes, busca, cadastro, duplicidade e relacionamento | [`customers/`](../../src/domains/customers/) | [`worker/repositories.js`](../../worker/repositories.js), [`worker/index.js`](../../worker/index.js) |
| Produtos, preço e apresentação no catálogo | [`catalog/`](../../src/domains/catalog/) | [`worker/repositories.js`](../../worker/repositories.js), [`shared/productCatalog.js`](../../shared/productCatalog.js) |
| A receber, movimentos, saldo inicial e configuração financeira | [`finance/`](../../src/domains/finance/) | [`worker/financeRepository.js`](../../worker/financeRepository.js), [`worker/paymentRepository.js`](../../worker/paymentRepository.js) |
| Indicadores, filtros, detalhe e exportações | [`reporting/`](../../src/domains/reporting/) | [`worker/reporting/`](../../worker/reporting/) |
| Fila, estação, vias, job, QZ, impressão e recuperação | [`printing/`](../../src/domains/printing/), [QZ](../../src/infrastructure/qz/) | [`worker/orderPrintingApi.js`](../../worker/orderPrintingApi.js), [`worker/orderPrintingRepository.js`](../../worker/orderPrintingRepository.js) |

**Áreas transversais que não pertencem a um único domínio:** [roteamento](../../src/app/navigation/registry.js), [App](../../src/App.jsx), [pagamentos](../../src/app/workflows/payments/), [estornos](../../src/app/workflows/refunds/), [configurações](../../src/app/surfaces/settings/), [TV independente](../../src/kitchen-display/) e [controle administrativo da TV](../../src/app/surfaces/kitchen-tv-control/).

## 2. Como usar o `index.js` público

Todo domínio listado abaixo possui **`src/domains/<nome>/index.js`**. Esse arquivo é o **contrato de consumo externo**: exports definidos ali podem ser importados pelo `src/App.jsx`, composição de `src/app/` e outros domínios permitidos; módulos privados em `domain/`, `application/`, `infrastructure/` e `ui/` não se tornam automaticamente API pública.

- **De fora de um domínio**, prefira o `index.js` do destino, sem import profundo. Se um símbolo necessário não está exportado, reavalie se pertence à API pública antes de ampliá-la.
- **Dentro do domínio**, imports relativos aos próprios arquivos são normais; regras de `domain/` não devem depender de React, browser, QZ, UI ou adaptadores HTTP.
- **`src/shared/`** é genérico do frontend; **`shared/` na raiz** contém contratos/políticas entre frontend e Worker. Não confundi-los.
- **Composição entre domínios** pertence à camada apropriada de `src/app/` quando a funcionalidade atravessa ownerships; não colocar workflows de recebimento dentro de Pedidos só porque são iniciados por um pedido.
- O verificador [`check-import-boundaries.mjs`](../../scripts/architecture/check-import-boundaries.mjs) proíbe deep imports, ciclos de domínio, alguns owners legados e dependências impróprias. Consulte a **regra efetiva no checker**, não um diagrama desatualizado.

O índice público não deve ser tratado como inventário completo de todas as funções internas. **Nenhum dos dez módulos é um microserviço independente.** No backend, o Worker ainda tem um dispatcher central e handlers/repositórios especializados; este mapa mostra a correspondência funcional, não um mapeamento 1:1 obrigatório.

## 3. Os dez domínios do frontend

### 3.1 `access` — identidade operacional, equipe e conta

**Responsabilidade:** superfícies de equipe e acessos, atividades, minha conta, aceitação de convite e recuperação de senha.

- **API pública:** [`src/domains/access/index.js`](../../src/domains/access/index.js), que expõe `AccessSurface`, `InvitationAccept`, `PasswordRecovery` e `createAccessApi`.
- **UI/contratos:** [`ui/AccessSurface.jsx`](../../src/domains/access/ui/AccessSurface.jsx) e [`infrastructure/accessApi.js`](../../src/domains/access/infrastructure/accessApi.js). O adaptador contém ações de equipe, senha e log de atividades.
- **Servidor:** [`worker/access/api.js`](../../worker/access/api.js), [`worker/access/emailAuthApi.js`](../../worker/access/emailAuthApi.js) e [`worker/identity/authApi.js`](../../worker/identity/authApi.js).
- **Fronteira:** a sessão global e a empresa ativa são coordenadas por [`useSessionRuntime.js`](../../src/app/runtime/session/useSessionRuntime.js) em `src/app/`, não pela tela de equipe. Não usar nomes de perfil em substituição a capabilities.

### 3.2 `companies` — escolha de contexto e convites de empresa

**Responsabilidade:** seleção de estabelecimento e recepção de convites na experiência multiempresa do usuário.

- **API pública:** [`src/domains/companies/index.js`](../../src/domains/companies/index.js): `CompanySelection`, `CompanyInvitationAccept` e `createCompaniesApi`.
- **UI/adaptador:** [`ui/CompanySelection.jsx`](../../src/domains/companies/ui/CompanySelection.jsx) e [`infrastructure/companiesApi.js`](../../src/domains/companies/infrastructure/companiesApi.js), que chama APIs `/api/auth/businesses`, `select-business`, `select-platform` e convites.
- **Servidor:** [`worker/tenancy/`](../../worker/tenancy/) e [`worker/identity/sessions.js`](../../worker/identity/sessions.js).
- **Fronteira:** selecionar empresa/plataforma é uma mudança **de contexto de sessão**, não um filtro de dados dentro do mesmo contexto. A troca deve invalidar dados operacionais antigos.

### 3.3 `platform` — administração global da Mesiva

**Responsabilidade:** console da plataforma para consultar, criar e administrar empresas, convites, vínculos e tentativas administrativas.

- **API pública:** [`src/domains/platform/index.js`](../../src/domains/platform/index.js): `PlatformRoutes`, `createPlatformApi`, `createProvisioningAttempts` e `createManagementAttempts`.
- **UI/adaptador:** [`ui/PlatformRoutes.jsx`](../../src/domains/platform/ui/PlatformRoutes.jsx) e [`infrastructure/platformApi.js`](../../src/domains/platform/infrastructure/platformApi.js). Operações administrativas usam rotas `/api/platform/businesses/*`, com proteção/idempotência específicas.
- **Servidor:** [`worker/platform/businessesApi.js`](../../worker/platform/businessesApi.js), [`worker/platform/managementCommands.js`](../../worker/platform/managementCommands.js) e [`worker/platform/managementRepository.js`](../../worker/platform/managementRepository.js).
- **Fronteira:** `platform` é **separado** da operação do restaurante; seu checker limita dependências com domínios operacionais. Permissão de plataforma não concede acesso automático a pedidos e financeiro.

### 3.4 `orders` — pedidos, preparo, histórico e ações de pedido

**Responsabilidade:** carrinho, novo pedido, cozinha, histórico, detalhes, cancelamento, reembolso exibido, elegibilidade de recebimento, agendamentos e chegada de pedidos operacionais.

- **API pública:** [`src/domains/orders/index.js`](../../src/domains/orders/index.js): `Orders`, `OrderHistory`, `OrderDetail`, `NewOrderRoute`, `useNewOrderDraft`, `useOrderCommands`, `ordersApi`, `createOrdersApi`, regras puras de status/itens/recebimento, políticas operacionais/cancelamento e contrato de cozinha.
- **UI:** [`ui/Orders.jsx`](../../src/domains/orders/ui/Orders.jsx), [`ui/NewOrder.jsx`](../../src/domains/orders/ui/NewOrder.jsx), [`ui/components/OrderDetail.jsx`](../../src/domains/orders/ui/components/OrderDetail.jsx) e [`ui/components/KitchenTicket.jsx`](../../src/domains/orders/ui/components/KitchenTicket.jsx).
- **Lógica/adaptador:** [`domain/orderCart.js`](../../src/domains/orders/domain/orderCart.js), [`domain/orderPaymentEligibility.js`](../../src/domains/orders/domain/orderPaymentEligibility.js), [`application/useOrderCommands.js`](../../src/domains/orders/application/useOrderCommands.js), [`infrastructure/ordersApi.js`](../../src/domains/orders/infrastructure/ordersApi.js).
- **Servidor:** [`worker/orderCheckout.js`](../../worker/orderCheckout.js), [`worker/orderReadRepository.js`](../../worker/orderReadRepository.js), [`worker/orderCancellation.js`](../../worker/orderCancellation.js) e [`worker/index.js`](../../worker/index.js).
- **Fronteira:** Pedidos pode consumir contratos públicos do **Catálogo** e de **Clientes**, mas não importa os workflows transversais de pagamento de `src/app/`. A validação de preços, gravação e capabilities ocorre no Worker, não apenas no carrinho.
- **Contrato com TV:** [`kitchenDisplayPublic.js`](../../src/domains/orders/kitchenDisplayPublic.js) expõe modelo de fila e detecção de chegadas sem carregar o app administrativo inteiro.

### 3.5 `table-service` — mesas, comandas, reservas e ocupação

**Responsabilidade:** cadastro/ocupação de mesas, comanda aberta, seleção e transferência, consulta e gestão de reservas e confirmação de chegada.

- **API pública:** [`src/domains/table-service/index.js`](../../src/domains/table-service/index.js): `Comandas`, `Tables`, `LocalTableSelector`, `resolveOpenComanda`, `getOpenComandaCount`, `useComandaSelection`, `useTableServiceCommands`, `tableReservationApi`, `createTableReservationApi`, `useTableReservationDetail`, `useTableReservationCommands` e `createTableServiceApi`.
- **Domínio/aplicação:** [`domain/comandaIdentity.js`](../../src/domains/table-service/domain/comandaIdentity.js), [`application/useTableServiceCommands.js`](../../src/domains/table-service/application/useTableServiceCommands.js) e [`application/useTableReservationCommands.js`](../../src/domains/table-service/application/useTableReservationCommands.js).
- **APIs:** [`infrastructure/tableServiceApi.js`](../../src/domains/table-service/infrastructure/tableServiceApi.js) e [`infrastructure/tableReservationApi.js`](../../src/domains/table-service/infrastructure/tableReservationApi.js).
- **Servidor:** [`worker/tableRepository.js`](../../worker/tableRepository.js), [`worker/tableTabDetailRepository.js`](../../worker/tableTabDetailRepository.js), [`worker/tableReservationApi.js`](../../worker/tableReservationApi.js) e [`worker/tableReservationArrival.js`](../../worker/tableReservationArrival.js).
- **Fronteira:** pagamento **integral** de uma comanda é coordenado no [workflow de pagamentos da aplicação](../../src/app/workflows/payments/table-tab/); reservar mesa não é, por si, abrir comanda ou registrar recebimento.

### 3.6 `customers` — clientes e relacionamento

**Responsabilidade:** cadastro, edição, exclusão, checagem de duplicidade, pesquisa e relação cliente–pedidos.

- **API pública:** [`src/domains/customers/index.js`](../../src/domains/customers/index.js): `CustomersWorkspace`, `ClientDuplicateModal`, `findClientDuplicates`, `useQuickCreateCustomerCommand` e `createCustomersApi`.
- **UI/aplicação:** [`ui/CustomersWorkspace.jsx`](../../src/domains/customers/ui/CustomersWorkspace.jsx), [`application/useCustomerCommands.js`](../../src/domains/customers/application/useCustomerCommands.js) e [`domain/clientDuplicates.js`](../../src/domains/customers/domain/clientDuplicates.js).
- **Servidor:** CRUD em [`worker/index.js`](../../worker/index.js) e [`worker/repositories.js`](../../worker/repositories.js); o frontend usa [`infrastructure/customersApi.js`](../../src/domains/customers/infrastructure/customersApi.js).
- **Fronteira:** o novo pedido reutiliza a **API pública** de Clientes para detecção de duplicidade/criação rápida. Receber vários pedidos de um cliente é um **workflow de pagamentos** da aplicação, não um efeito colateral de editar o cadastro do cliente.

### 3.7 `catalog` — produtos, preços e apresentação

**Responsabilidade:** cadastro e edição de produtos, categorias, apresentação comercial do item e comandos de catálogo.

- **API pública:** [`src/domains/catalog/index.js`](../../src/domains/catalog/index.js): `CatalogWorkspace`, `createCatalogApi`, `PRODUCT_CATEGORIES`, `formatProductPresentation`, `CATEGORY_ICON_NAMES` e `categoryForUi`.
- **UI/aplicação:** [`ui/CatalogWorkspace.jsx`](../../src/domains/catalog/ui/CatalogWorkspace.jsx), [`application/useCatalogCommands.js`](../../src/domains/catalog/application/useCatalogCommands.js) e [`domain/catalogPresentation.js`](../../src/domains/catalog/domain/catalogPresentation.js).
- **Contrato entre runtimes:** [`shared/productCatalog.js`](../../shared/productCatalog.js) contém validação/formatação de apresentação compartilhada, reexportada no domínio quando pertinente.
- **Servidor:** [`worker/repositories.js`](../../worker/repositories.js), [`worker/validation.js`](../../worker/validation.js) e rotas de produtos em [`worker/index.js`](../../worker/index.js).
- **Fronteira:** Pedidos utiliza o **contrato público** do Catálogo; cálculos persistidos de checkout dependem de valores autorizados no Worker, não do preço exibido na UI.

### 3.8 `finance` — a receber, movimentos e políticas financeiras

**Responsabilidade:** visualização e comandos financeiros, caixa/saldo, contas a receber, categorização e apresentação de formas de pagamento.

- **API pública:** [`src/domains/finance/index.js`](../../src/domains/finance/index.js): `FinanceWorkspace`, `Receivables`, `createFinanceApi`, `calculateReceivedToday`, formatação de resumo/pagamento misto e políticas/superfícies de métodos e categorias.
- **UI/aplicação:** [`ui/FinanceWorkspace.jsx`](../../src/domains/finance/ui/FinanceWorkspace.jsx), [`ui/Receivables.jsx`](../../src/domains/finance/ui/Receivables.jsx), [`application/useFinanceCommands.js`](../../src/domains/finance/application/useFinanceCommands.js).
- **Regras internas:** [`domain/receivables.js`](../../src/domains/finance/domain/receivables.js), [`domain/paymentMethods.js`](../../src/domains/finance/domain/paymentMethods.js), [`domain/paymentPresentation.js`](../../src/domains/finance/domain/paymentPresentation.js).
- **Servidor:** [`worker/financeRepository.js`](../../worker/financeRepository.js), [`worker/paymentRepository.js`](../../worker/paymentRepository.js), [`worker/paymentSettingsRepository.js`](../../worker/paymentSettingsRepository.js).
- **Fronteira:** o domínio Financeiro **não é o proprietário dos três workflows de quitação** (pedido, cliente em lote e comanda). Eles ficam em `src/app/workflows/payments/`. Movimentos gerados por operações são protegidos de edição manual no Worker.

### 3.9 `reporting` — métricas, consultas e exportação

**Responsabilidade:** experiência de relatórios, filtros, detalhe de pedido em contexto analítico e formatação/exportação em CSV, PDF e XLSX.

- **API pública:** [`src/domains/reporting/index.js`](../../src/domains/reporting/index.js): **`ReportingWorkspace`** e **`createReportingApi`**, intencionalmente enxutos.
- **Frontend:** [`ui/ReportingWorkspace.jsx`](../../src/domains/reporting/ui/ReportingWorkspace.jsx), [`infrastructure/reportingApi.js`](../../src/domains/reporting/infrastructure/reportingApi.js), [`export/csvExport.js`](../../src/domains/reporting/export/csvExport.js), [`export/pdfExport.js`](../../src/domains/reporting/export/pdfExport.js) e [`export/xlsxExport.js`](../../src/domains/reporting/export/xlsxExport.js).
- **Servidor:** [`worker/reporting/api.js`](../../worker/reporting/api.js), [`worker/reporting/service.js`](../../worker/reporting/service.js) e [`worker/reporting/repository.js`](../../worker/reporting/repository.js).
- **Fronteira:** o Worker é responsável pelos **valores oficiais das métricas**; a tela não deve recalculá-los a partir das coleções de Pedidos/Financeiro recebidas pelo App. Exportar é diferente de alterar os registros fonte.

### 3.10 `printing` — fila, política de vias e execução

**Responsabilidade:** UI da fila, status, estação principal, política de cópias, execução local elegível, segunda via, confirmação e recuperação.

- **API pública:** [`src/domains/printing/index.js`](../../src/domains/printing/index.js): `PrintQueue`, `PrintingOverlays`, `PrintingSettingsContent`, previews, `PrintStatusBadge`, `DEFAULT_PRINT_QUEUE_QUERY`, `usePrintingManager`, `createPrintingApi` e factories de políticas de impressão/estação.
- **Frontend:** [`application/usePrintingManager.js`](../../src/domains/printing/application/usePrintingManager.js), [`domain/secondCopy.js`](../../src/domains/printing/domain/secondCopy.js), [`domain/printRecovery.js`](../../src/domains/printing/domain/printRecovery.js), [`infrastructure/printingApi.js`](../../src/domains/printing/infrastructure/printingApi.js), [`ui/printingSurfaces.js`](../../src/domains/printing/ui/printingSurfaces.js).
- **Transporte físico:** [`src/infrastructure/qz/`](../../src/infrastructure/qz/) concentra os adaptadores QZ, separado das regras puras. O gerenciamento conecta o transporte no nível de aplicação.
- **Servidor:** [`worker/orderPrintingApi.js`](../../worker/orderPrintingApi.js), [`worker/orderPrintingRepository.js`](../../worker/orderPrintingRepository.js), [`worker/printAttemptRepository.js`](../../worker/printAttemptRepository.js).
- **Fronteira:** fila e tentativa persistidas **não equivalem** à via comprovadamente impressa. A estação Windows principal é executora; segunda via e resultados incertos exigem regras de estado. Consulte o [runbook físico](../operations/windows-qz-tray-printing.md) para operação/QA.

## 4. Owners transversais em `src/app/` e entradas especiais

| Owner | Conteúdo | Quando consultar |
| --- | --- | --- |
| [`src/App.jsx`](../../src/App.jsx) | Composição do runtime/superfícies/domínios e workflows | Integração de telas ou efeitos entre domínios; **não** reintroduzir regras internas aqui |
| [`src/app/navigation/registry.js`](../../src/app/navigation/registry.js) | Destinos, paths, grupos e capabilities de navegação | Adicionar/alterar menu, deep link ou acesso por tela |
| [`src/app/navigation/adminRouter.jsx`](../../src/app/navigation/adminRouter.jsx) | Roteador administrativo | Mudanças de navegação/Routing do admin |
| [`src/app/runtime/session/useSessionRuntime.js`](../../src/app/runtime/session/useSessionRuntime.js) | Descoberta/seleção de sessão e geração de contexto | Login, troca de empresa, perda de grants, invalidação |
| [`src/app/runtime/data/useOperationalDataRuntime.js`](../../src/app/runtime/data/useOperationalDataRuntime.js) | Bootstrap, collections, polling e aplicação protegida de efeitos | Refresh, dados obsoletos, sincronização, 401/409 |
| [`src/app/workflows/payments/`](../../src/app/workflows/payments/) | Recebimento de pedido, comanda, lote de cliente; editor/composição | Qualquer implementação de pagamento dividido/quitação |
| [`src/app/workflows/refunds/`](../../src/app/workflows/refunds/) | Coordenação de registro de estorno | Cancelamento pago e estorno posterior |
| [`src/app/surfaces/settings/`](../../src/app/surfaces/settings/) | Agrupamento de configurações operacionais e componentes de apresentação | Formulários, navegação, revisão e integrações de políticas |
| [`src/app/policy-editing/`](../../src/app/policy-editing/) | Orquestração de drafts, conflitos, salvamento e recuperação | Mudanças em políticas versionadas |
| [`src/app/surfaces/kitchen-tv-control/`](../../src/app/surfaces/kitchen-tv-control/) | Controle da TV **dentro do admin** | Filtrar/paginar/ocultar pedidos na TV |
| [`src/kitchen-display/`](../../src/kitchen-display/) | Aplicação da TV independente do admin | Pareamento, compatibilidade, renderização/alertas |
| [`src/infrastructure/api/`](../../src/infrastructure/api/) | HTTP com contexto, bootstrap e configuração efetiva | Adaptadores, cabeçalhos, erros, cancelamentos |
| [`src/infrastructure/qz/`](../../src/infrastructure/qz/) | Transporte da impressão física Windows/QZ | Conexão QZ e observação da impressora |
| [`src/shared/ui/`](../../src/shared/ui/) | Componentes genéricos reutilizáveis | Buttons, modais, badges, campos, layout |
| [`shared/`](../../shared/) | Contratos comuns entre UI e Worker | Modalidades, timing, políticas, formatos e estados comuns |

### 4.1 O pagamento entre três domínios

O [`paymentApi.js`](../../src/app/workflows/payments/paymentApi.js) contém **três endpoints distintos**:

| Uso | Workflow frontend | Endpoint no Worker |
| --- | --- | --- |
| Pedido avulso | [`order/useOrderPaymentWorkflow.js`](../../src/app/workflows/payments/order/useOrderPaymentWorkflow.js) | `POST /api/orders/:id/payment` |
| Lote de pedidos de cliente | [`client-orders/useClientOrdersPaymentWorkflow.js`](../../src/app/workflows/payments/client-orders/useClientOrdersPaymentWorkflow.js) | `POST /api/clients/:clientId/receivables/payment` |
| Comanda aberta | [`table-tab/useTableTabPaymentWorkflow.js`](../../src/app/workflows/payments/table-tab/useTableTabPaymentWorkflow.js) | `POST /api/table-tabs/:id/payment` |

As regras de elegibilidade de pedido pertencem a [`orders`](../../src/domains/orders/domain/orderPaymentEligibility.js); as opções/apresentação financeira, a [`finance`](../../src/domains/finance/domain/paymentMethods.js); a entidade comanda, a [`table-service`](../../src/domains/table-service/domain/comandaIdentity.js). A **coordenação de UX/reconciliação** fica em `src/app/workflows/payments/`; o [`paymentRepository.js`](../../worker/paymentRepository.js) é a autoridade transacional de recibos, alocações e movimentos.

**Não** criar uma função única que receba indistintamente pedido, lote e comanda sem preservar seus contratos e pré-condições separados. Consultar as regras [`RN-PAG-*`](../product/BUSINESS_RULES.md).

### 4.2 TV versus Cozinha no admin

[`src/main.jsx`](../../src/main.jsx) escolhe [`KitchenDisplayRoot.jsx`](../../src/kitchen-display/KitchenDisplayRoot.jsx) para `/cozinha-tv` e [`AdminBootstrap.jsx`](../../src/admin/AdminBootstrap.jsx) para a aplicação administrativa. A TV usa [`worker/kitchenTvApi.js`](../../worker/kitchenTvApi.js) e o modelo público de Pedidos em [`kitchenDisplayPublic.js`](../../src/domains/orders/kitchenDisplayPublic.js). **Não** importar `src/App.jsx`, as superfícies administrativas ou dependências pesadas de PDF/QZ na TV. O checker impõe restrições particulares à montagem da TV.

## 5. Backend: orientação por contrato (sem falsas equivalências)

O backend **não segue a mesma estrutura de diretórios** que `src/domains/`. Seu dispatcher [`worker/index.js`](../../worker/index.js) delega famílias de rotas e também implementa rotas operacionais diretamente.

| Responsabilidade do Worker | Ponto de partida |
| --- | --- |
| Entrada/runtime e classificação de rotas | [`worker/entry.js`](../../worker/entry.js), [`worker/index.js`](../../worker/index.js), [`worker/tenancy/routePolicy.js`](../../worker/tenancy/routePolicy.js) |
| Sessão, empresa, autorização e guardas de gravação | [`worker/identity/sessions.js`](../../worker/identity/sessions.js), [`worker/tenancy/businessContext.js`](../../worker/tenancy/businessContext.js), [`worker/tenancy/guardedBusinessDb.js`](../../worker/tenancy/guardedBusinessDb.js), [`worker/access/authorization.js`](../../worker/access/authorization.js) |
| Cadastro e gestão administrativa de empresas | [`worker/platform/`](../../worker/platform/) |
| Pedido, agendamento, cancelamento e leitura | [`worker/orderCheckout.js`](../../worker/orderCheckout.js), [`worker/orderCancellation.js`](../../worker/orderCancellation.js), [`worker/orderReadRepository.js`](../../worker/orderReadRepository.js) |
| Comanda e reserva | [`worker/tableRepository.js`](../../worker/tableRepository.js), [`worker/tableReservationApi.js`](../../worker/tableReservationApi.js), [`worker/tableReservationArrival.js`](../../worker/tableReservationArrival.js) |
| Pagamentos/financeiro | [`worker/paymentRepository.js`](../../worker/paymentRepository.js), [`worker/financeRepository.js`](../../worker/financeRepository.js) |
| Relatórios | [`worker/reporting/`](../../worker/reporting/) |
| Políticas versionadas/configuração efetiva | [`worker/settingsApi.js`](../../worker/settingsApi.js), [`worker/effectiveBusinessConfig.js`](../../worker/effectiveBusinessConfig.js) |
| Fila, estação e impressão | [`worker/orderPrintingApi.js`](../../worker/orderPrintingApi.js), [`worker/orderPrintingRepository.js`](../../worker/orderPrintingRepository.js), [`worker/printAttemptRepository.js`](../../worker/printAttemptRepository.js) |
| Pareamento/projeção/controle da TV | [`worker/kitchenTvApi.js`](../../worker/kitchenTvApi.js), [`worker/kitchenTvControlRepository.js`](../../worker/kitchenTvControlRepository.js) |
| Schema persistido | [`migrations/`](../../migrations/); recursos D1/R2 em [`wrangler.jsonc`](../../wrangler.jsonc) |

Regras de preço, pagamento, empresa, permissões e status persistidos são **validadas no Worker**. Testar apenas um hook/frontend não demonstra que o contrato HTTP e a persistência estejam corretos.

## 6. Mapa de testes e gates de entrada

A coluna de testes indica **pontos de partida existentes**, não que uma suíte tenha sido executada nesta atualização.

| Área | Testes/checagens de referência |
| --- | --- |
| Domínios e limites globais | [`scripts/architecture/check-import-boundaries.mjs`](../../scripts/architecture/check-import-boundaries.mjs), [`src/infrastructure/api/c10ApiOwnership.test.js`](../../src/infrastructure/api/c10ApiOwnership.test.js) |
| Pedidos | [`src/domains/orders/ordersPublicContract.test.js`](../../src/domains/orders/ordersPublicContract.test.js), [`worker/orderCheckout.test.js`](../../worker/orderCheckout.test.js) |
| Clientes | [`src/domains/customers/customersPublicContract.test.js`](../../src/domains/customers/customersPublicContract.test.js), [`worker/clientUniqueness.test.js`](../../worker/clientUniqueness.test.js) |
| Catálogo | [`src/domains/catalog/catalogPublicContract.test.js`](../../src/domains/catalog/catalogPublicContract.test.js), [`worker/productValidation.test.js`](../../worker/productValidation.test.js) |
| Comandas e reservas | [`src/domains/table-service/tableServicePublicContract.test.js`](../../src/domains/table-service/tableServicePublicContract.test.js), [`worker/tableRepository.test.js`](../../worker/tableRepository.test.js), [`worker/tableReservationArrival.test.js`](../../worker/tableReservationArrival.test.js) |
| Financeiro/pagamentos | [`src/domains/finance/financePublicContract.test.js`](../../src/domains/finance/financePublicContract.test.js), [`worker/paymentRepository.test.js`](../../worker/paymentRepository.test.js) |
| Relatórios | [`src/domains/reporting/reportingBoundary.test.js`](../../src/domains/reporting/reportingBoundary.test.js), [`worker/reporting/api.test.js`](../../worker/reporting/api.test.js) |
| Impressão | [`src/domains/printing/printingPublicContract.test.js`](../../src/domains/printing/printingPublicContract.test.js), [`worker/orderPrintingRepository.test.js`](../../worker/orderPrintingRepository.test.js) |
| Acesso, conta e plataforma | [`worker/identity/sessions.test.js`](../../worker/identity/sessions.test.js), [`worker/platform/businessesApi.test.js`](../../worker/platform/businessesApi.test.js), [`worker/tenancy/routePolicy.test.js`](../../worker/tenancy/routePolicy.test.js) |
| TV da Cozinha | [`worker/kitchenTvControlRepository.test.js`](../../worker/kitchenTvControlRepository.test.js), [`src/kitchen-display/`](../../src/kitchen-display/) |
| CI abrangente | [`.github/workflows/validate.yml`](../../.github/workflows/validate.yml): testes Node, arquitetura, lint, build, Worker dry-run e gates D1 |

**Validação física** de QZ/impressora e de compatibilidade da TV exige homologação no dispositivo; scripts Node/CI não a substituem. Consultar [`AGENTS.md`](../../AGENTS.md) e o [runbook de release](../release-and-migration-runbook.md).

## 7. Procedimento curto para agentes

1. **Localize o cenário** pela tabela da seção 1 e leia o `index.js` do domínio afetado.
2. **Siga do componente para a lógica e o contrato HTTP**: UI → aplicação → domínio/adaptador → dispatcher/handler Worker → repositório/migration. Nem toda alteração usa todas as camadas; não criar camadas vazias.
3. **Inspecione consumidores** do contrato público e o fluxo transversal. Se houver preço, pagamento, empresa, impressão ou reserva, revise [Business Rules](../product/BUSINESS_RULES.md).
4. **Altere o owner correto**, preserve fronteiras de imports e inclua testes da menor superfície que prove a mudança; amplie para contrato/integração quando necessário.
5. **Execute os gates** pertinentes (no mínimo testes afetados, checker, lint e build quando aplicáveis). Siga a matriz de QA para alterações com hardware.
6. **Atualize documentação viva afetada** no mesmo PR, sem alterar specs/planos históricos silenciosamente. Não efetue merge/deploy sem autorização.

### Itens fora deste mapa

Não representa inventário de **todas** as rotas, exports auxiliares, arquivos fonte, migrations/tabelas, dependências externas ou medidas de performance; não dá permissão para renomear domínios/bindings/bancos. Ao exigir detalhe, rastrear os imports e testes a partir do arquivo inicial indicado. Se o código divergir do documento, apontar o desvio e verificar o SHA, em vez de impor o texto como verdade absoluta.

**Manutenção:** preservar os nomes exatos do código, validar paths e exports antes de atualizar e registrar PR/SHA no histórico de revisão; remover/sinalizar referências antigas quando o owner mudar.
