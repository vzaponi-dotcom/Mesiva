# PR #124 — publicação autorizada do ajuste mobile em staging

Data: 2026-10-23.
Escopo autorizado expressamente pelo usuário: **publicar somente em staging** a correção de CSS mobile da Conferência do Dia; sem merge e sem produção.

## Base validada

- PR #124: https://github.com/vzaponi-dotcom/Mesiva/pull/124 — OPEN / DRAFT.
- SHA funcional da correção mobile: `35d4c7220e7157255a3bb686d481d6f547b35984`.
- CI do SHA: https://github.com/vzaponi-dotcom/Mesiva/actions/runs/40033086759 — SUCCESS, 8/8 grupos e gates consolidados.
- O diff funcional corrige o seletor CSS em <=380px e aumenta para 16px o tamanho da fonte em input de data, valor e observações (e touch targets de navegação em <=550px); não modifica lógica de pagamentos, APIs, migrations ou D1.
- TinyFish: https://agent.tinyfish.ai/runs/e8481642-4ac6-4ac4-82a6-3befccf1dd02 — teste não destrutivo com zoom aproximando 375px; **não é device emulation** e 320px **não foi confirmado**.

## Gate de publicação

Este commit documental contém o marcador já admitido pelo workflow `deploy-staging.yml`. O workflow deve validar novamente seu SHA exato antes de qualquer deploy e auditar migrations pendentes no D1 de staging. Não há migration nova a aplicar, mas o workflow oficial preserva a etapa de verificação do D1.

Após conclusão, confirmar:
- CI SUCCESS do SHA exato deste commit;
- workflow Deploy staging SUCCESS, login e deep links de staging;
- release.json / log `Staging published commit verified` no mesmo SHA;
- PR #124 ainda OPEN / DRAFT; produção intacta.

## Homologação restante

QA móvel real em 375/320px, confirmação financeira com extratos/comprovantes e fechamento/manual QA da PR. A elegibilidade temporária da branch no workflow staging deve ser retirada antes do merge.
