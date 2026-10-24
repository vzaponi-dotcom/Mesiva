# Tratamento de divergências — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Execução contínua nesta sessão, com revisão independente ao final.

**Goal:** acompanhar e resolver diferenças sem alterar o financeiro nem o histórico original.

**Architecture:** tabela indexada de pendências derivada dos snapshots, trigger/backfill aditivos e solução condicional. API contextual existente, componente próprio dentro da conferência e drawer oficial reutilizado.

**Tech Stack:** React, Worker, D1/SQLite; sem dependências novas.

**Spec:** `docs/superpowers/specs/2026-10-24-conference-discrepancies-design.md`.

## Global Constraints

- Preservar alterações locais de rótulos/divisor e o banco `.wrangler/local-orders-state`.
- Reutilizar branch/PR #125, que já contém a entrega financeira em homologação; sem checkout paralelo.
- Permissões reais, contexto por empresa, origem, concorrência e trilha imutável.
- Sem polling, N+1, cargas históricas globais ou ajuste financeiro automático.
- Entregar tudo junto para staging; merge e produção fora desta autorização.

## Review Focus

- Pendências anteriores e diferenças compensadas permanecem acessíveis, sem corte de histórico.
- Reenvio após resposta perdida não sobrescreve solução de outro usuário.
- Troca de empresa/sessão/aba invalida respostas antigas e bloqueia mutations indevidas.
- Revisar data antiga usa a data/versão próprias em todas as páginas do drawer.
- Migration mantém finanças/snapshots e suporta conclusão pelo bundle anterior.

### Task 1: Persistência e API

**Files:** `migrations/0056_daily_receipt_discrepancies.sql`, `worker/dayConferenceRepository.js`, `worker/dayConferenceApi.js`, testes de migration/repositório/API, `shared/dayConferenceDiscrepancies.js`.

**Interfaces:** GET `/api/finance/day-conference/discrepancies?status=pending|resolved&cursor=...` retorna `{items,nextCursor}` (20 itens); GET `/discrepancies/:id` retorna `{discrepancy}`; POST `/discrepancies/:id/resolve` recebe `{reason,note,reference,confirmed:true}` e retorna `{discrepancy}`. IDs, usuário e empresa são validados no servidor.

- [x] Escrever testes RED de backfill, snapshots intactos e pendências por forma/revisão.
- [x] Criar migration/trigger; testar clean install e upgrade.
- [x] Escrever testes RED para isolamento, keyset, entrada inválida, leitura, solução única e replay/conflito.
- [x] Implementar contrato e repositório/API mínimos; executar `node --test worker/dayConferenceMigration.test.js worker/dayConferenceRepository.test.js worker/dayConferenceApi.test.js` e testes novos.

### Task 2: Interface

**Files:** `src/domains/finance/ui/DayConferenceDiscrepancies.jsx`, teste correspondente, `DayConference.jsx`, `DayConference.test.js`, `day-conference.css`.

**Interfaces:** componente recebe `request`, `canResolve`, `writesBlocked`, `onReview`; lista e detalhe sob demanda, formulário preservado em erro. Drawer recebe data/versão próprias sem perder regras oficiais.

- [x] Escrever testes RED para carregamento sob demanda, páginas, consulta de resolução e sessão, permissões, falha de rede/retry e resultado concorrente.
- [x] Implementar abas e fluxo aprovado com componentes/tokens existentes, foco, loading/erro/vazio, cancelamento e prevenção de envio duplo.
- [x] Executar testes UI; conferir desktop/mobile e teclado no navegador.

### Task 3: Custo, revisão e entrega

**Files:** `scripts/infra/day-conference-d1-gate.mjs`, documentos vivos de conferência/produto/regras/arquitetura afetados e QA da entrega.

- [x] Medir D1/workerd: lista paginada, detalhe, solução/replay e trigger, antes/depois de histórico grande; asserts de índices, ausência de writes nas leituras e finanças preservadas.
- [x] Executar arquitetura, lint, build, suíte completa e gates pertinentes; registrar limitações concretas e correções.
- [x] Revisão independente da entrega e correção de achados materiais; atualizar documentos vivos sem duplicar runbook.
- [ ] Commit/push na PR #125, CI exato, staging pelo Actions e release.json; sem merge/produção.

## Registro de execução

- Escopo aprovado: protótipo navegável e pedido explícito de implementação. Executar sem pedir nova aprovação de decisões rotineiras.
- Ruling: pendência por revisão e método; revisões posteriores não encerram automaticamente a anterior — preserva rastreabilidade.
- Ruling: sem contagem global na abertura da conferência; badges indicam apenas registros carregados quando pertinente — evita consultas extras.

- Ruling: funções mantidas no repositório existente da conferência, sem segundo owner ou reexport — mesma fronteira de dados e contrato.
- Verificação local: suíte completa 4.191/4.191; 63 testes focados finais; arquitetura/lint/build/dry-run staging; gate D1 e QA real desktop/mobile aprovados. Detalhes no QA da entrega.
- Revisão independente: três achados materiais corrigidos e reconferidos (tipo do motivo, chave global de gravação e foco ao voltar); sem bloqueio material restante.
