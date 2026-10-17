# Base de conhecimento da Mesiva

**Status:** índice vigente da documentação do projeto.  
**Primeira edição:** 12/10/2026.  
**Baseline da primeira edição:** `master@e595f7ed2a801fde6ffab231194788430cc53316`.

Este índice orienta pessoas e agentes de IA a encontrar a **fonte pertinente** sem ler todas as specs, planos e homologações. A documentação viva explica o estado atual; registros históricos preservam contexto, decisões e evidências. Não use uma proposta antiga como prova de que a funcionalidade existe ou está publicada.

## Comece conforme o objetivo

| Necessidade | Primeira leitura | Depois, se necessário |
| --- | --- | --- |
| Entender o produto e suas funcionalidades | [PRD — produto atual](product/PRD.md) | Código da área e testes |
| Executar uma tarefa como agente | [AGENTS.md](../AGENTS.md) | Arquivos da área indicada e contratos |
| Instalar, executar ou conhecer o stack | [README do repositório](../README.md) | Configurações, scripts e workflows |
| Implantar, migrar ou recuperar | [Runbook de release e migrations](release-and-migration-runbook.md) | GitHub Actions, `wrangler.jsonc` e scripts |
| Otimizar consultas, sincronização e custo Cloudflare | [Regra de economia no AGENTS](../AGENTS.md#economia-de-recursos-cloudflare--regra-para-futuras-melhorias) | [Orçamento D1](operations/operational-data-read-budget.md), [realtime](operations/realtime-sync.md) e benchmarks |
| Administrar contas e empresas | [Operação multiempresa corrente](operations/multi-company-production.md) | Código de acesso, identidade e plataforma |
| Instalar/recuperar impressão física | [Runbook Windows/QZ](operations/windows-qz-tray-printing.md) | Domínio de impressão, Worker e testes |
| Entender políticas de configuração | [Operação das configurações (Spec B)](operations/spec-b-settings.md) | Código e configuração efetiva |
| Investigar como uma solução foi decidida | [Specs](superpowers/specs/) e [planos](superpowers/plans/) | [QA](superpowers/qa/), commits e PRs |

## Documentação viva

- **Produto:** [PRD](product/PRD.md) — o que a Mesiva oferece conforme a baseline identificada; não é roadmap comercial.
- **Regras de negócio consolidadas:** [Business Rules](product/BUSINESS_RULES.md) — invariantes funcionais com IDs estáveis, referências a código e pendências explícitas; verificar sempre a branch/SHA da tarefa.
- **Arquitetura geral:** [Architecture](architecture/ARCHITECTURE.md) — visão atual de camadas, fluxos, limites de confiança, ambientes e CI; conferir a baseline e os contratos de código citados.
- **Mapa de módulos:** [Module Map](architecture/MODULE_MAP.md) — dez domínios, contratos públicos, workflows transversais, correspondências do Worker e testes para começar pela área certa.
- **Design System da interface:** [Design System](design/DESIGN_SYSTEM.md) — identidade aplicada, fontes cronológicas, tokens, temas e componentes; [governança dos guias oficiais](design/identidade-visual/README.md) define versões, aprovação, integridade e publicação dos binários no GitHub.
- **Economia operacional e escalabilidade:** [orçamento de leituras D1](operations/operational-data-read-budget.md), [realtime e orçamento Cloudflare](operations/realtime-sync.md), [incidente de impressão](operations/printing-d1-read-incident.md) e [roteiro de custo e escala](superpowers/plans/2026-10-14-mesiva-scale-roadmap.md) — fontes para medir mudanças em queries, índices, temporizadores, caches e requests; resultados históricos têm baseline própria.
- **Procedimentos em vigor:** os runbooks vinculados acima. São detalhamentos operacionais; o PRD não os substitui.

### Identidade visual: GitHub como fonte oficial

**Decisão de 17/10/2026:** a Mesiva adotou o **próprio repositório GitHub** como fonte canônica da documentação de identidade visual, sem depender de sincronização com Google Drive. A edição **v1.1 foi aprovada** pelo proprietário; os quatro arquivos binários (PDF e Word da v1.1 e da v1.0 histórica) **ainda precisam ser incorporados à PR #119**. A aprovação editorial não é evidência de que os arquivos estejam publicados no repositório.

- [Governança, arquivos esperados e hashes de integridade](design/identidade-visual/README.md) — versão vigente, histórico v1.0, checklists e como realizar upload na branch da PR #119.
- [Design System](design/DESIGN_SYSTEM.md) — aplicação em CSS/JSX, tokens, temas, componentes, exemplos e cinco diferenças **históricas** entre o guia v1.0 e ativos aprovados em outubro.
- [Refinamento do logo e slogan (02/10/2026)](operations/2026-10-02-mesiva-logo-refinement.md) — registros originais da aprovação do vetor, ícones e assinatura “Pessoas. Sabor. Evolução.”
- [Ícones e publicações](operations/2026-10-02-github-releases-and-mesiva-icons.md) e [referência visual de Cozinha/Comandas](mesiva-kitchen-visual.md) — decisões complementares.
- **Ativos efetivos de aplicação:** `public/brand/` (SVGS e ícones já versionados). Não reconstruir nem recolorir a marca por aproximação.

**Até o upload verificado:** consultar a [governança](design/identidade-visual/README.md), o Design System e os assets do repositório; os arquivos aprovados ainda não podem ser acessados por links GitHub. Não inventar caminhos clicáveis nem alterar marca, código ou produção para compensar essa pendência.

## Documentação histórica e evidências

| Local | Papel |
| --- | --- |
| [`docs/superpowers/specs/`](superpowers/specs/) | Requisitos e decisões no momento da proposta/aprovação |
| [`docs/superpowers/plans/`](superpowers/plans/) | Sequência de implementação e decisões de execução |
| [`docs/superpowers/qa/`](superpowers/qa/) | Evidências, homologação, bloqueios e status por entrega |
| [`docs/releases/`](releases/) | Pacotes e notas específicos de publicação |
| [`docs/operations/`](operations/) | Mistura de runbooks correntes e registros datados; consultar status e data de cada arquivo |
| [`docs/architecture/performance-and-scaling-notes.md`](architecture/performance-and-scaling-notes.md) | Estudo de performance com baseline própria, **não** descrição automaticamente atualizada |

**Não excluir specs/planos/QA ao concluir uma entrega.** Registrar seu status e links para o PR, commit e evidências quando pertinente. Uma limpeza de duplicatas requer revisão separada de valor histórico, links e rastreabilidade.

## Regra de interpretação e atualização

1. **Comportamento implementado:** conferir código, contratos, migrations, testes e workflows na branch/SHA em questão. O PRD é o resumo humano do que foi verificado, não substituto da inspeção da implementação.
2. **Operação e publicação:** seguir os runbooks correntes e a configuração do ambiente. Código presente na `master` **não** comprova, por si, deploy em produção.
3. **Requisitos e intenção vigentes:** consultar PRD, regras de negócio, arquitetura e design **quando existentes e validados**. Se divergirem do código, investigar e registrar a diferença, sem reconciliar silenciosamente.
4. **Histórico:** abrir specs, planos e QA sob demanda para entender a decisão e as condições de aceite. Status antigos valem para a entrega e o SHA que documentam.
5. **Ao mudar comportamento:** atualizar, na **mesma PR**, somente a documentação viva afetada; preservar o histórico original. Usar links relativos para arquivos do repositório e indicar limitações/pendências concretas.
6. **Segurança e fluxo de release:** nenhuma alteração documental autoriza merge, migrations remotas ou produção; seguir [AGENTS.md](../AGENTS.md) e o [runbook](release-and-migration-runbook.md).

## Escopo desta primeira entrega

Esta PR reúne o índice, o [PRD](product/PRD.md), as [regras de negócio](product/BUSINESS_RULES.md), a [arquitetura](architecture/ARCHITECTURE.md), o [mapa de módulos](architecture/MODULE_MAP.md), o [Design System](design/DESIGN_SYSTEM.md) e a integração da consulta seletiva ao [AGENTS.md](../AGENTS.md), criados em entregas sequenciais. A edição v1.1 do guia visual já foi **aprovada**; permanece **pendente a inclusão verificável dos arquivos oficiais e históricos no GitHub**, como registrado na [governança](design/identidade-visual/README.md). Nenhuma mudança nos módulos, permissões, UI, bancos ou no processo de publicação é autorizada por esta documentação.
