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
| Administrar contas e empresas | [Operação multiempresa corrente](operations/multi-company-production.md) | Código de acesso, identidade e plataforma |
| Instalar/recuperar impressão física | [Runbook Windows/QZ](operations/windows-qz-tray-printing.md) | Domínio de impressão, Worker e testes |
| Entender políticas de configuração | [Operação das configurações (Spec B)](operations/spec-b-settings.md) | Código e configuração efetiva |
| Investigar como uma solução foi decidida | [Specs](superpowers/specs/) e [planos](superpowers/plans/) | [QA](superpowers/qa/), commits e PRs |

## Documentação viva

- **Produto:** [PRD](product/PRD.md) — o que a Mesiva oferece conforme a baseline identificada; não é roadmap comercial.
- **Regras de negócio consolidadas:** [Business Rules](product/BUSINESS_RULES.md) — invariantes funcionais com IDs estáveis, referências a código e pendências explícitas; verificar sempre a branch/SHA da tarefa.
- **Arquitetura geral:** `docs/architecture/ARCHITECTURE.md` — **a criar**. Ponto de partida atual: [README](../README.md#arquitetura-e-organização), [AGENTS.md](../AGENTS.md#arquitetura) e checker `scripts/architecture/check-import-boundaries.mjs`.
- **Mapa de módulos:** `docs/architecture/MODULE_MAP.md` — **a criar**. Ponto de partida: [localização rápida do AGENTS.md](../AGENTS.md#localização-rápida) e `src/app/navigation/registry.js`.
- **Design System da interface:** `docs/design/DESIGN_SYSTEM.md` — **a criar após conciliar as fontes visuais**. Consulte as referências abaixo.
- **Procedimentos em vigor:** os runbooks vinculados acima. São detalhamentos operacionais; o PRD não os substitui.

### Identidade visual: referências e conciliação pendente

- [Guia oficial de identidade visual Mesiva v1.0 (Drive, 23/09/2026)](https://drive.google.com/file/d/1YHj8qfsBMhGz7BQCCyTn69iQ8qtMOjKc/view) — direção da marca e regras de aplicação aprovadas naquela edição.
- [Refinamento do logo e slogan (02/10/2026)](operations/2026-10-02-mesiva-logo-refinement.md) — registra vetores, versões clara/escura, ícones e a assinatura em português adotados posteriormente.
- [Ícones e publicações](operations/2026-10-02-github-releases-and-mesiva-icons.md) e [referência visual de Cozinha/Comandas](mesiva-kitchen-visual.md) — mudanças e contexto adicionais.
- Ativos da aplicação: `public/brand/`. **Não** reconstruir/recolorir a marca por aproximação.

O guia v1.0 ainda registra ativos técnicos como pendentes, enquanto o repositório contém versões posteriores. Não declarar essas fontes reconciliadas nem alterar a marca sem revisão e aprovação. O futuro Design System deverá explicitar a edição vigente e registrar a conciliação.

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

Esta PR iniciou o índice e o [PRD](product/PRD.md) e foi ampliada, com autorização posterior, para incluir [regras de negócio consolidadas](product/BUSINESS_RULES.md). Arquitetura geral, mapa de módulos e Design System continuam em etapas futuras. Nenhuma mudança nos módulos, permissões, UI, bancos ou no processo de publicação é autorizada por esta documentação.
