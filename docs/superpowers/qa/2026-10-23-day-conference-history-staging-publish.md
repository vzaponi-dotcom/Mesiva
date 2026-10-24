# PR #124 — publicação em staging: redesign de histórico e título financeiro

**Data:** 2026-10-23
**Autorização do usuário:** publicar mudanças aprovadas em **staging** sem repetir pedido de confirmação; **merge e produção permanecem separados e exigem autorização**.

## Release candidata e escopo

- PR: https://github.com/vzaponi-dotcom/Mesiva/pull/124 — aberta e Draft antes do acionamento.
- SHA funcional validado: `428effc14b75827a6e8e6c7ab0c0895c96634afa`
- Validate application: https://github.com/vzaponi-dotcom/Mesiva/actions/runs/40041699960 — **SUCCESS**, 8/8 shards, arquitetura, lint, build, Worker, upgrades D1, orçamento de leitura/escrita da conferência e runtime.
- Redesign responsivo do Histórico: último snapshot em destaque, anteriores recolhidos, forma de pagamento com conferido/líquido/diferença/bruto/estornos, variação entre totais conferidos em revisões da mesma data e notas intactas. Estado de erro e retry.
- Remoção do CTA redundante “Conferir recebimentos” na Visão geral para eliminar sobreposição ao título em telas móveis.
- **Nenhum novo endpoint, migration, escrita financeira ou alteração de permissões**.

## Gate e escopo de publicação

Este commit documental com prefixo `ci(staging): authorize PR124 QA deploy` aciona exclusivamente o workflow oficial `deploy-staging.yml`; o pipeline exige CI **SUCCESS do novo SHA exato** antes de aplicar o processo de deploy. Confirmar migrations pendentes (esperado 0), SHA publicado, login, deep links e assets do staging. Nenhuma ação para merge ou ambiente production é autorizada.

## QA de staging

- [ ] Confirmar o mesmo SHA no CI e na release de staging.
- [ ] Abrir Histórico em 320px, 375px e desktop; revisão mais recente expandida, anteriores recolhidas.
- [ ] Conferir Pix/Dinheiro, centavos, diferenças e notas em cada revisão; comparar variação de totais e não a chamar de divergência financeira.
- [ ] Fechar e reabrir histórico, alternar data, confirmar ausência de truncamento em temas claro/escuro.
- [ ] Verificar que a Visão geral não mostra CTA “Conferir recebimentos” sobre o título e que a aba “Conferência do dia” segue acessível.
- [ ] Manter PR Open/Draft, sem merge e produção intacta.

A sessão de TinyFish, se utilizada, valida comportamento visual observado, mas não substitui o QA financeiro com extratos externos nem teste físico de smartphone.
