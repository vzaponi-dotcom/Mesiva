# Edição de pedidos e conciliação do saldo

Implementação da PR #108. A [homologação da integração](../superpowers/qa/2026-10-16-order-editing-integration.md) registra o que foi verificado; a presença do código não comprova publicação em produção.

Pedidos ativos podem ser editados pelos detalhes da Cozinha com `orders.edit`. O assistente conserva número, modalidade, cliente, mesa/comanda e data original. Linhas existentes conservam preço histórico, inclusive quando o produto foi inativado; novas linhas usam produto ativo e preço oficial. Finalizados/cancelados não podem ser editados.

O selo **Editado** permanece no pedido, na Cozinha e na TV. Detalhes e Controle da TV mostram **Últimas alterações**; não há confirmação manual de leitura. A TV mantém o layout original com a lista atual de produtos. Edição não é pedido novo e não deve disparar o alerta de nova chegada.

## Receber e devolver

- **Salvar alterações:** confirma o pedido; eventual diferença fica no saldo oficial.
- **Salvar e receber:** salva primeiro e oferece a composição de todo o saldo devido. Pedido de R$80 recebido e editado para R$95 cobra somente R$15. Fechar a composição ou falhar o recebimento mantém a edição salva e o saldo em A receber.
- Reduzir o total abaixo do recebido líquido gera **devolução pendente**. Somente registrar uma devolução efetivamente realizada, com `payments.refund`, cria a saída de caixa. Pode ser parcial e retomada pelo Financeiro, inclusive após finalizar o pedido. Não há Pix/estorno bancário automático.
- Pedidos de um cliente podem reunir saldo complementar e pedidos não pagos num recibo único. Seleção, composição, relatórios e movimentos usam o valor restante; o pagamento original não é substituído.
- Comanda aberta é recebida pela própria comanda. Uma diferença após sua quitação não reabre a mesa; o saldo complementar fica associado ao pedido.

Receber exige `payments.receive` e o acesso da superfície. Receber não finaliza o preparo. Finalizar impede nova edição, mas não elimina saldo nem devolução pendente. O cancelamento considera o líquido recebido ainda não devolvido.

## Concorrência, sincronização e impressão

Conflito de versão exige atualizar e conferir o pedido; o rascunho não deve ser mesclado silenciosamente. Após resposta incerta, consultar o estado oficial antes de repetir. Complementos, devoluções e lotes de cliente usam identificador de mutation para reproduzir a decisão sem duplicar dinheiro.

Avisos realtime só são publicados após commit. Leituras por superfície, fallback e reconciliação seguem o [guia realtime](realtime-sync.md). A receber e devoluções incluem pedidos finalizados e usam saldos do servidor, sem depender da página carregada.

Salvar uma edição não cria job automático. Um job automático ainda pendente, sem cópia impressa, pode ter seu snapshot completo atualizado com itens, total e situação de pagamento. Jobs processados/assumidos preservam a evidência anterior. A impressão manual opcional após salvar usa o documento atualizado; sua falha não desfaz o pedido ou o recebimento. A validação física segue o [runbook Windows/QZ](windows-qz-tray-printing.md).

As migrations adicionadas pela integração (`0050`/`0051`) atualizam candidatos derivados e registram replay do lote. Preservar os nomes e conteúdos das migrations `0042–0049` já aplicadas nas duas branches. Gates de upgrade cobrem os dois históricos; publicação e migrations remotas seguem o [runbook de release](../release-and-migration-runbook.md).
