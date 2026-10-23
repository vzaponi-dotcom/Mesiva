# PR #124 — publicação autorizada de drawer progressivo em staging

**Autorização expressa do usuário:** publicação apenas em staging, seguida de homologação visual (desktop/mobile), sem merge nem produção. Data: 2026-10-23.

## Release candidata

- PR #124 OPEN/DRAFT: https://github.com/vzaponi-dotcom/Mesiva/pull/124
- SHA funcional validado: `31a05006b93fae3bd167c597087ff64fa869c5ac`
- CI validado: https://github.com/vzaponi-dotcom/Mesiva/actions/runs/40023578729 — SUCCESS, 8/8 shards e todos os gates consolidados.

## Escopo visual autorizado

- Drawer em 3 níveis progressivos: lista de recebimentos → pedidos ligados a um recibo compartilhado → detalhe do pedido; PIX com um pedido abre diretamente.
- Cliente, valor, horário e contagem de pedidos nos cards compactos, sem repetição de nomes nos recibos compartilhados.
- Datas financeiras/de registro e data do pedido, sem UUIDs/identificadores técnicos na UI (preservados nos dados internos e no CSV de auditoria).
- Botões Voltar, contexto visual distinto para valor do recibo versus total do pedido, preservação de scroll, acessibilidade e controle de permissão.
- Sem alteração de APIs, D1, migration ou cálculos financeiros neste refinamento.

## Gate de publicação

A branch da PR #124 tem elegibilidade **temporária** no `deploy-staging.yml` apenas para pushes com o marcador `ci(staging): authorize PR124 QA deploy`. O pipeline valida o **novo SHA exato** por CI e garante PR aberta antes de aplicar qualquer mudança em D1 ou Worker. Em staging, sem migration nova, confirmar ausência de migrations pendentes, SHA publicado no `release.json` e smoke de login/deep links.

## Checklist obrigatório pós-deploy

- [ ] Confirmar CI GREEN e staging SUCCESS no SHA do commit de autorização.
- [ ] Confirmar `release.json` e rota `/financeiro/conferencia-do-dia` em staging.
- [ ] Navegar sessão autenticada: PIX único, PIX com vários pedidos, detalhe, Voltar, scroll.
- [ ] Conferir os horários e as datas corretas; UUIDs não devem aparecer no drawer.
- [ ] Conferir temas claro/escuro e mobile em 375/320px quando a ferramenta permitir.
- [ ] Conferir ausência de N+1 D1: dados de pedidos somente sob demanda.
- [ ] Manter PR OPEN/DRAFT, sem merge ou deploy de produção. Remover elegibilidade temporária antes de eventual merge.

**Limite:** smoke HTTP não comprova UX autenticada nem paridade pixel a pixel. QA visual posterior necessária.
