# Validação financeira do realtime — 16/10/2026

Continuação da [medição do refresh de impressão](2026-10-16-printing-state-budget.md), vinculada à issue #75. **Validação financeira incompleta; ativação de produção não aprovada.** Esta entrega altera somente cálculo, testes e documentação; não muda consultas, timers, fila, dados ou flags do aplicativo.

## Publicação e escopo

O aplicativo já foi publicado pelo Deploy production 38845349415: master `63d1f148e612c879d412ee815acfd51de9c30046`, versão `996a542a-f01a-4c60-991b-fd1cc43a07d4`, 100%, em 16/10 às 03:25 UTC. Os bindings dessa versão mantêm `REALTIME_ENABLED=false` e `OPERATIONAL_READ_MODELS_ENABLED=false`. Código integrado/publicado não significa canal ou snapshots ativos.

Staging medido: mesmo SHA, versão `d23cfb05-abf8-4562-a590-969b9862b3e3`, flags habilitadas, empresa fictícia. A verificação horária foi removida a pedido do usuário; a coleta abaixo foi manual e temporária. Nenhuma gravação de negócio ou impressão de teste foi enviada à produção.

## Correção do dimensionamento

O modelo não incluía `GET /api/auth/session` nem `POST /api/auth/login`. O runtime consulta a sessão na montagem e após login/contexto/alteração de credencial; o coordenador pode rediscoverir a sessão em outras abas. Isso é diferente da renovação de autorização do WebSocket, já contabilizada.

Acrescentamos uma tentativa de login e duas consultas de sessão por conexão humana, mais uma redescoberta por mudança administrativa/dispositivo humano, em ambos os cenários. Trata-se de limite conservador: reconexões normais do socket reaproveitam a sessão. Conexões da TV não viram logins humanos. Não mudamos a frequência real do aplicativo. Falhas de autenticação repetidas ou alternâncias extraordinárias de contexto exigem outro perfil de carga.

O gate HTTP real agora exige ambas as operações, incluindo D1/auth/guards. A fixture local isolada mediu sessão com 76 leituras/1 escrita auxiliar e login com 44 leituras/22 escritas auxiliares. Nenhum secret real integra a fixture. Inputs antigos sem essas operações passam a produzir dimensões desconhecidas em vez de um orçamento aprovado.

## Projeção D1, antes dos outros serviços da conta

Volume informado: até cinco dispositivos e 51–150 pedidos/dia. Ensaio usa o teto de 150 criações/1.500 alterações diárias, mix de superfícies `orders:1, clients:1, receivables:1, finance:1`, mais uma TV; 12h/dia, 31 dias e 5.000 conexões/reconexões mensais são hipóteses, não uso observado.

| Cenário | Leituras/mês | Escritas/mês | Requests Worker/mês |
| --- | ---: | ---: | ---: |
| Normal | 9.225.240.904 | 15.974.834 | 2.427.068 |
| Degradado | 15.048.151.120 | 16.537.390 | 2.623.320 |

O gate funcional passou novamente: cinco clientes, 10 mil pedidos históricos, 50 mil itens, 10 mil auditorias, 3 mil jobs terminais; hibernação/reinício, publicação perdida convergindo em 264 segundos, claim com um vencedor e resultado desconhecido sem reenvio. Isso não mede CPU faturada nem latência commit→tela em cinco navegadores. A projeção pressupõe as flags ativas; não descreve o comportamento atual de produção com flags false.

## CPU amostrada na Cloudflare

Coleta por `wrangler tail` temporário, somente metadados sanitizados: operação, método, status, outcome, horário, CPU/wall e versão. Não persistiu URL, valores de query, IDs de negócio, headers, cookies, corpos ou mensagens de log. Para a tabela usamos somente respostas de sucesso com status conhecido; a primeira fase sem status foi excluída. Resposta de TV sem pareamento não representa TV autenticada. Navegação confirmou clientes, recebíveis, financeiro e histórico na empresa fictícia; nenhum pagamento foi confirmado.

| Operação | Amostras | CPU média (ms) | Máximo (ms) |
| --- | ---: | ---: | ---: |
| `printState` | 66 | 22.3485 | 32 |
| `bootstrap` | 13 | 34.6154 | 53 |
| `authSession` | 1 | 3 | 3 |
| `renewHuman` | 29 | 5 | 9 |
| `byIds` | 1 | 8 | 8 |
| `receivablesGroups` | 1 | 14 | 14 |
| `receivablesGroupOrders` | 1 | 17 | 17 |
| `receivablesQuick` | 1 | 30 | 30 |
| `financeMovements` | 2 | 21 | 22 |
| `financeOverview` | 2 | 35.5 | 40 |
| `historyPage` | 2 | 32 | 50 |
| `historySearch` | 1 | 48 | 48 |

As médias são de amostras pequenas e não ponderadas, dependentes do histórico/configuração desta empresa. Só as operações cobertas projetam aproximadamente 17,61 milhões de ms no normal e 24,66 milhões no degradado; esses **subtotais incompletos não aprovam o orçamento**. Faltam, entre outras, claim/heartbeat da estação, TV pareada, mutations e login. Não preencher lacunas com zero nem substituir CPU Cloudflare pelo wall time local.

## Conta e limites da evidência

O painel de cobrança consultado em 16/10 mostrava 45,09 bilhões de leituras D1 e US$20,10 de excedente já acumulado, 437,19 mil requests Worker e 8,13 milhões de ms CPU. São valores arredondados de um ciclo parcial, sujeitos a atraso, contendo Mesiva anterior, staging e outros serviços. Não são um baseline independente que possa ser somado integralmente à projeção nova.

Outro Worker (`mazinho-agendamento-staging`) mostrou 9.390 invocações nos últimos 30 dias, zero erros e CPU p50 de 34,415 ms. O painel retornou percentis, sem soma de CPU: não usar p50 como média nem multiplicá-lo para declarar consumo total. Ausência de amostras no tail curto de produção não significa custo zero.

Faltam baseline separado dos outros serviços, CPU das operações ausentes, duração/armazenamento do DO, crescimento de armazenamento D1 e latência real em cinco telas. A estação Windows/QZ com fila vazia e a autorização de pareamento da TV foram solicitadas ao usuário; não enviar impressão física para obter essas amostras. O canal e os read models ficam desabilitados em produção até completar as dimensões, manter 20% de margem no normal/100% da franquia no degradado e obter autorização própria de ativação.

Fontes primárias de franquias: [Workers](https://developers.cloudflare.com/workers/platform/pricing/), [D1](https://developers.cloudflare.com/d1/platform/pricing/), [Durable Objects](https://developers.cloudflare.com/durable-objects/platform/pricing/) e [R2](https://developers.cloudflare.com/r2/pricing/). A mensalidade não é um teto automático; a redução futura não estorna o excedente acumulado.

## Verificação desta entrega

- Testes focados: duas falhas reproduziram a omissão; correção passou 27/27.
- Gate workerd/D1/WebSocket completo: passou, dimensões financeiras externas continuam desconhecidas.
- Arquitetura, lint e build passaram; lint mantém avisos preexistentes.
- Suíte completa e CI: resultado será registrado antes da integração. Esta alteração não publica nem ativa flags.
