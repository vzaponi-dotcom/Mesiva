# PR #124 — autorização de publicação em staging da migration 0055

**Data:** 2026-10-23
**Escopo autorizado pelo usuário:** somente staging. Aplicar a migration `0055_payments_business_receipt_order_idx.sql` e publicar as melhorias da Conferência do Dia pelo workflow oficial, condicionadas a CI verde, **sem merge, sem produção**.

## Pré-validação do commit funcional

- PR: https://github.com/vzaponi-dotcom/Mesiva/pull/124 — OPEN / DRAFT.
- SHA funcional validado: `b178695bd8f17acec9336fcabefae2f4df42ca56`.
- CI completo: https://github.com/vzaponi-dotcom/Mesiva/actions/runs/40020479526 — SUCCESS.
- A `0055` é aditiva e cria o índice parcial `payments_business_receipt_order_idx` por empresa, recibo e pedido; não modifica dados de pagamentos.
- Não foram alterados nem autorizados os fluxos de production / merge / PR #123.

## Mecanismo de publicação

A autorização é registrada em commit documental com marcador de staging. O `deploy-staging.yml` existente só prossegue se **o novo SHA deste commit** tiver seu próprio Validate application em SUCCESS, se a PR continuar aberta e se o SHA continuar sendo o head exato da branch.

O workflow mostra migrations pendentes antes de aplicá-las, executa `npm run d1:migrate:staging`, publica o Worker do mesmo SHA e verifica login e deep links. Após o deploy, confirmar logs da migration `0055`, sucesso do workflow e hash publicado em `release.json`.

## Checklist de homologação humana

- [ ] Abrir Conferência do Dia em staging com contexto de empresa válido.
- [ ] Digitar valores com máscara `R$ 0,00` e negativo; editar não grava automaticamente.
- [ ] Ver estados e orientação para finalizar sem conferir valores.
- [ ] Abrir Pix; identificar recibos com múltiplos pedidos sem contar o valor em duplicidade.
- [ ] Clicar em `Ver pedido`; confirmar cliente, número, itens e total do pedido; verificar permissão de leitura.
- [ ] Confirmar que dados de pedido são a versão atual do registro, **não** um snapshot histórico imutável.
- [ ] Validar layout desktop/mobile (inclusive 375px), tema claro/escuro e acessibilidade básica.
- [ ] PR permanece Draft e sem merge; produção intocada.

A liberação de staging não dispensa QA manual nem autoriza produção.
