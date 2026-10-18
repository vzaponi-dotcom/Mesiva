# Orçamento de leituras operacionais D1

## Consultas e compatibilidade

`GET /api/orders/by-ids?ids=<array JSON codificado>` busca pedidos completos somente pelos IDs solicitados. A empresa vem da sessão/contexto; a rota mantém `orders.view`/`orders.history`, projeção por estado e atribuições oficiais. Aceita até 99 IDs únicos, strings não vazias com até 200 caracteres; parâmetros inválidos retornam `INVALID_ORDER_IDS`. Pedidos de outra empresa e inexistentes não são retornados. ID ausente não é um sinal de exclusão, pois pode estar fora da projeção autorizada.

O adapter `ordersApi.getOrdersByIds(ids)` usa o cliente HTTP contextual atual. A API legada de lista completa permanece compatível. Leituras de pedidos completos desempatarão itens com o mesmo created_at pela ordem persistida (rowid), preservando posição, primeiro produto e quantidade entre lista, bootstrap e respostas de mutations mesmo após o índice novo. Esta entrega prepara a sincronização por eventos; não remove os polls de dois/cinco segundos nem afirma que WebSocket já está publicado.

A TV lê somente pedidos que satisfazem seu filtro atual: estados diferentes de Finalizado/Cancelado/Entregue/Despachado, sem finished_at/cancelled_at e sem ocultação da TV. Pedidos futuros agendados e estados desconhecidos mantêm a semântica anterior. O schema continua rejeitando status NULL. A seleção de itens usa os candidatos ativos como loop externo: mesmo com índices novos, INNER JOIN permitiu ao otimizador D1 começar pelo histórico de itens; CROSS JOIN limita essa ordem.

Migration 0043 acrescenta `orders_business_active_created_idx`, parcial pelo filtro ativo, e `order_items_business_order_created_idx`, por empresa/pedido/data/ID. Não remove índices ou altera dados, políticas, históricos, auditoria e fila. A criação e manutenção dos índices têm custo de leitura/escrita e armazenamento; contabilizar isso no orçamento agregado. Bundle anterior permanece compatível.

## Ensaio obrigatório

Após migrations locais e disponibilizar Wrangler 4.128.0 no cache:

```bash
node scripts/infra/operational-read-d1-benchmark.mjs
```

O gate usa D1/workerd efêmero com schema migrado e dados fictícios, sem binding remoto. Mede `meta.rows_read`/`rows_written`, incluindo índices. Compara a TV publicada em 7bfd0665 com a versão atual no mesmo conjunto de candidatos; o snapshot de SQL foi capturado executando aquele repositório e registra revisão/hash de origem em `scripts/infra/fixtures/operational-read-baseline.json`. Isso permite reproduzir a baseline em CI shallow.

Cenários: vazio; 20 pedidos ativos com cinco itens cada; histórico de 1.000 e 10.000 pedidos; busca pontual com um ID próprio e um estrangeiro. Asserções verificam igualdade das linhas retornadas da TV, contrato do pedido, isolamento, zero escritas nas seleções e consultas efetivamente capturadas. IDs vazios não executam SQL no repositório.

Tetos: seleções de candidatos da TV vazia <=100 linhas; chamada completa da TV <=1.000; pedido pontual <=200. A verificação existente de configurações/schema lê sqlite_master e tem custo fixo: seu overhead é reportado separadamente e pode crescer no máximo 16 linhas sobre a baseline vazia. Esse custo continua incluído no total e não foi removido para satisfazer o teto inicialmente estimado. Histórico 10x maior, com os mesmos candidatos, pode acrescentar no máximo `max(16, ceil(leituraMenor*0.10))` linhas à consulta otimizada. O gate também rejeita planos que voltam ao índice de itens somente por empresa.

Esses números são limites de regressão, não uma promessa sobre tráfego ilimitado. O relatório mede os repositórios e não inclui autenticação HTTP, todos os serviços da conta ou efeitos físicos de impressão. Comparar consumo real por execução e janela comparável depois de publicar; não atribuir o acumulado de todo o ciclo à versão nova.

### Medição no D1/workerd local, 14/10/2026

| Cenário | Antes | Depois | Escritas das seleções |
| --- | ---: | ---: | ---: |
| TV sem pedidos | 353 | 354 | 0 |
| TV: 1.000 históricos + 20 ativos / 100 itens ativos | 22.912 | 615 | 0 |
| TV: 10.000 históricos + os mesmos ativos | 220.912 | 615 | 0 |
| Lista completa: 10.020 pedidos e 50.100 itens versus um pedido solicitado | 120.242 | 17 | 0 |

A última linha compara escopos diferentes intencionalmente: a API pontual prepara a sincronização incremental, enquanto a lista legada permanece completa e compatível. A TV mantém o mesmo resultado antes/depois. Na TV vazia, 353 linhas vêm da leitura existente de configurações/guards e uma das seleções de candidatos. Histórico 10x maior não aumentou as 615 linhas da TV nem as 17 da busca pontual. O benchmark prepara a carga em SQL em lote para evitar dezenas de milhares de round-trips de bindings do proxy Miniflare; o volume de dados é verificado separadamente.

## Recebimentos efetivos — PR #120

A [revisão da Task 11](../superpowers/qa/2026-10-17-effective-receipt-task11-review.md#performance-banco-e-segurança), código `ef1d9ae7` e pacote de evidências `36e47798`, registra medições locais com dados fictícios para a migration 0052. O gate `node scripts/infra/effective-receipt-date-d1-gate.mjs` mediu 2 → 5 `rows_read` na query isolada, estáveis com histórico fora do período crescendo de 1.000 para 10.000 recibos; zero escritas nas seleções.

Essa estabilidade não cobre candidatos concentrados no dia consultado. O `loadSales` real executou cinco queries, zero escritas e **2.004 → 20.004 `rows_read`** com 1.000 → 10.000 candidatos, tanto para NULL legados quanto para recibos canônicos cujo `paid_at` está no período e `received_date` está fora dele. O braço legado ainda percorre candidatos do índice `paid_at` antes de descartar os não NULL. As cinco queries são chamadas SQL, não uma medição de requests HTTP por dispositivo.

Essas medidas não aprovam o orçamento mensal: faltam baseline da conta, custo da rota completa/autenticação/exportações, CPU/duração, frequência de acesso e degradação no destino. O gate realtime retornou `monthlyReady=false`. Para liberar esta entrega, revisar esses custos agregados e o cenário concentrado junto aos [pré-requisitos de staging](../superpowers/qa/2026-10-17-effective-receipt-task11-review.md#bloqueios-antes-de-staging). Não extrapolar a medição isolada para margem mensal de 20% ou economia já demonstrada.

## Release e investigação

Seguir [o runbook de publicação](../release-and-migration-runbook.md), com bookmark D1 automático antes da migration, staging e aprovação do SHA exato. Não usar dados fictícios em produção para demonstrar economia. Em regressão, conferir planos e candidates antes de alterar índices; não executar scans antigos caros repetidamente em produção.

A iniciativa integra a [issue #75](https://github.com/vzaponi-dotcom/Mesiva/issues/75). A correção anterior de recuperação de impressão possui [evidência separada](printing-d1-read-incident.md); ganhos dessas consultas não representam a redução de toda a conta.
