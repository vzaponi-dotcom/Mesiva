# PR 108 — integração e homologação de edição de pedidos

**Data:** 16/10/2026. **Estado:** validação local aprovada; CI/staging do commit final pendentes; sem merge/produção. [PR #108](https://github.com/vzaponi-dotcom/Mesiva/pull/108).
**Plano:** [integração](../plans/2026-10-16-order-editing-integration.md). **Operação:** [edição de pedidos](../../operations/order-editing.md).

## Escopo e evidências

Início na feature `13cc1baa`, incorporando a master `ecbcf908`. O usuário autorizou continuar a revisão/correção e a preparação de staging, preservando autorização separada para merge e produção. Histórico anterior de CI/deploy e aprovações permanece na PR; não equivale a homologação da árvore integrada.

| Verificação | Resultado nesta sessão |
| --- | --- |
| Reprodução dos quatro achados da revisão | RED comprovado; cinco testes iniciais falharam por saldo scoped, devolução scoped, snapshot, realtime e lote misto |
| Saldos scoped / cliente / Financeiro | PASS nos testes: due pelo líquido, finalizado com devolução, redução parcial e exclusão ao zerar |
| Lote misto e replay | PASS: um recibo/composição, preservação do payment original, payload divergente 409, resposta perdida e concorrência sem duplicação |
| Upgrade do histórico da master e da PR | PASS: valores históricos preservados, backfill e foreign_key_check |
| Revisão independente | Dois achados importantes corrigidos e cobertos: props financeiros do editor no App e elegibilidade do complemento em Clientes |
| App completo via harness Vite | PASS: R$30 recebido → total R$60 mostra R$30 de saldo e permite Salvar e receber |
| Clientes via interface | PASS: seleção conjunta de complemento R$30 e pedido R$20 mostra R$50 |
| Arquitetura / lint / build | PASS local; avisos preexistentes de lint e tamanho de chunks permanecem |
| D1 local / Spec B / perfil operacional / gestão de empresas | PASS local, sem acessar dados remotos |
| Gate D1 de edição desde 0041 | PASS: clean, upgrade, idempotência, FKs e imutabilidade |
| Orçamento operacional D1 / recuperação de impressão | PASS local |
| Runtime WebSocket/workerd/D1 | PASS local; relatório financeiro continua monthlyReady=false |
| Suíte completa final | PASS: 4.049/4.049, zero falhas; teste adicional de publicação/replay também aprovado no arquivo focado (9/9) |
| Validate do SHA final | PENDENTE; consultar checks da PR após push |
| Staging do SHA integrado | PENDENTE de CI e workflow; deploy histórico de 12/10 não comprova esta versão |
| TV/som/QZ/impressão física | PENDENTE de homologação humana/hardware |

O primeiro ensaio da suíte local foi interrompido: o sandbox Windows bloqueou a renomeação do cache temporário Vite. A execução com o acesso necessário revelou nove incompatibilidades: asserções antigas de contador/estado, fixture de permissão futura que passou a ser real (`orders.edit`), e finais CRLF no SQL. Foram corrigidas sem remover gates. `.gitattributes` conserva LF nas migrations; conteúdos das migrations aplicadas não foram reescritos no Git.

Comandos locais: `npm test -- --test-concurrency=4`, `npm run test:architecture`, `npm run lint`, `npm run build`, dry-runs Wrangler 4.128.0 de staging/produção, `npm run d1:migrate:local -- --persist-to .wrangler/pr108-d1-state` e os gates definidos em `.github/workflows/validate.yml`. O D1 desta tarefa é separado das persistências existentes. As confirmações CI/deploy do SHA final pertencem aos checks e à descrição atualizada da PR.

A revisão independente foi somente leitura. Seus dois achados geraram regressões RED→GREEN em testes de elegibilidade e no App completo, além da cobertura de seleção em Clientes. A seleção e o workflow compartilham a identificação do saldo complementar; a cobrança mantém o endpoint suplementar e as capabilities reais.

## Migrations e publicação

`0050_order_editing_read_candidates.sql` reconstrói somente dados derivados de candidatos e atualiza triggers para conteúdo, recebimentos e ledger. `0051_client_payment_mutation_receipts.sql` guarda replay imutável do recibo compartilhado, com FK composta para a empresa/recibo. Cliente é identidade histórica, preservando exclusão normal de cadastro. Não altera pagamentos, recibos, movimentos ou históricos já existentes.

Gates de upgrade simulam a master com índices/candidatos e a PR com ledger antes de aplicar os arquivos ausentes e as duas migrations novas. Não renumerar arquivos aplicados com prefixos repetidos e nomes diferentes. Migrations remotas somente pelo workflow de staging/produção, com os gates já existentes e bookmark D1 de produção preservado.

O mecanismo temporário de push por mensagem `staging-publish-PR108-phase-A` foi retirado. A branch desta PR é elegível a **Deploy staging** manual, com CI do SHA exato e PR aberta; produção continua manual e exclusiva da master.

## Aceite que permanece humano

Homologar o SHA integrado: avulso não pago/pago, +saldo e composição, redução/devolução parcial, cancelamento sobre líquido, lote misto, comanda aberta/fechada, item histórico inativo, agendamento/reserva, duas sessões e F5, troca de empresa/permissões, desktop/mobile, TV/filtros/ocultação/som, QZ offline e reimpressão opt-in. Impressão física só recebe PASS após saída real e conferência de cópias. Não marcar indisponibilidade de hardware como aprovado.

A exceção financeira da ativação realtime anterior é [histórica e específica daquela entrega](2026-10-16-realtime-financial-validation.md#decisão-de-liberação-desta-entrega). O relatório desta integração preserva dimensões desconhecidas e não comprova franquia/custo mensal; nenhum gate foi relaxado. Merge/produção desta funcionalidade ainda exigem decisão própria.
