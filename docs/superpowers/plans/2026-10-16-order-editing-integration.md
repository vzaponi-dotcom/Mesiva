# Integração da edição de pedidos — PR 108

**Autorização:** usuário aprovou em 16/10/2026 prosseguir com a revisão e as correções propostas na mesma PR. Após homologar em staging, autorizou merge e produção com impressão física não executada, conforme o [registro de aceite](../qa/2026-10-16-order-editing-integration.md#aceite-humano-e-autorização-de-publicação).
**Spec:** [edição de pedidos](../specs/2026-10-10-order-editing-design.md).
**Base:** PR `13cc1baa`, master `ecbcf908`.
**Abordagem:** reutilizar os writers/ledger e owners existentes; incorporar realtime e leituras por superfície sem restaurar bootstrap histórico integral. Não reescrever migrations aplicadas.

- [x] Integrar a master e resolver conflitos de App, financeiro, workflows e testes, preservando contratos das duas branches.
- [x] Reproduzir os achados em testes reais antes das correções.
- [x] Atualizar os candidatos e leitores financeiros por saldo, os efeitos realtime e o snapshot automático de impressão.
- [x] Receber lote misto de cliente com recibo único, somente saldos devidos e replay durável, preservando o pagamento original.
- [x] Verificar consumidores, concorrência, upgrades a partir dos dois históricos de migrations, limites D1, suíte completa e gates.
- [x] Revisão independente, documentação/PR consolidadas e CI do SHA homologado.
- [x] Publicação autorizada em staging pelo workflow, smoke e registro do aceite humano e da impressão física não executada.

## Decisões de implementação

- As migrations `0050` e `0051` são novas. A primeira reconstrói somente candidatos derivados; a segunda guarda replay do recibo compartilhado. Os arquivos `0042–0049` das duas branches são preservados, inclusive os que têm o mesmo prefixo numérico e nomes diferentes.
- O lote reaproveita `registerClientOrdersPayment`: pedidos sem recebimento usam `payments`, complementos usam `order_settlement_entries`; alocações e movimentos continuam únicos por recibo/forma.
- A identidade do cliente no comprovante de replay é histórica, para não bloquear a exclusão normal do cadastro. O recibo é protegido por FK composta da empresa; o writer valida cliente e pedidos dentro da guarda transacional.
- O badge financeiro usa contador autorizado do snapshot, incluindo devoluções de pedidos finalizados. Não depende da página de pedidos carregada.
- Publicação de staging passa a ser manual para esta branch; remover o marcador temporário de push mantém CI e gates de publicação existentes.

## Evidências e limites

Os testes focados e gates finais serão registrados no [QA da integração](../qa/2026-10-16-order-editing-integration.md). Aprovações anteriores permanecem históricas; não comprovam a árvore integrada. TV, QZ e impressão física exigem homologação específica do SHA final.
