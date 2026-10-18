# PR #120 — orçamento Cloudflare antes de staging

**Parte 3, 18/10/2026. SHA analisado:** `c7ef7100ab8050216ea2fbfaf7d8c88ca16a1df0`. **Resultado: análise executada; orçamento de liberação BLOCKED.** O [CI desse SHA está SUCCESS](https://github.com/vzaponi-dotcom/Mesiva/actions/runs/39094287317). Não houve alteração do código da aplicação nesta rodada.

A medição identifica consumo da conta, separa outros serviços e recalcula o cenário normal/degradado com o gate HTTP atual. Não demonstra ainda margem integral de 20% nem gasto total de US$5/mês. Nenhuma migration remota da aplicação, publicação de staging, merge ou deploy de produção foi executado. Os ensaios usam dados fictícios locais; a consulta remota acessou somente metadados e métricas agregadas de recursos, sem linhas de negócio de produção.

**Atualização posterior:** após esclarecer pré-flight versus homologação pós-deploy, o usuário autorizou a [publicação controlada em staging do SHA `68404745`](2026-10-18-effective-receipt-staging-deploy.md), executada com sucesso em 18/10. A migration preservou os campos financeiros originais dos 195 recibos. Essa autorização permite avançar a homologação; **não é aprovação do orçamento mensal**, que permanece incompleto. Os registros “sem publicação” e a recomendação ao final deste relatório descrevem o encerramento da parte 3, anterior à autorização posterior.

## Método e limites

**Continuação autenticada em 18/10:** o usuário abriu o painel e aprovou a premissa de 20 consultas de vendas/10 CSV/5 PDF por dia, até 10 mil recibos. A [triagem final](2026-10-18-effective-receipt-final-triage.md) confirmou Workers Paid, ciclo 08/10–07/11, US$20,15 de uso D1 acumulado e zero eventos atuais de Observability. O modelo parcial atualizado soma 9,772/16,101 bilhões de leituras normais/degradadas. Isso supera as lacunas de login/plano/ciclo/frequência descritas nesta rodada histórica; CPU por operação e duração/storage/conta futuros representativos continuam incompletos, `monthlyReady=false`. O acumulado do ciclo inclui versões/incidentes anteriores e não é atribuído à PR. Impressão física foi adiada pelo usuário, sem PASS.

Evidência sanitizada: [`evidence/2026-10-18-effective-receipt-cloudflare-budget.json`](evidence/2026-10-18-effective-receipt-cloudflare-budget.json). Conta identificada pelo D1 de staging configurado, representada pelo hash `748b0258b295`. Recursos alheios ao Mesiva são pseudonimizados. Credenciais ficaram somente em memória; não foram publicados tokens, e-mails, cookies, identificadores de clientes, objetos R2 ou payloads de requests.

Foram consultados nove datasets GraphQL de uso/armazenamento de D1, Workers, Durable Objects e R2. Todos estavam habilitados, sem truncamento; a janela comum contém **30 dias UTC completos, de 18/09 a 17/10**, terminando em `2026-10-18T00:00:00Z`. Introspecção confirmou unidades: CPU Workers em microssegundos, duração DO em GB·s. Workers usa amostragem adaptativa; suas somas são estimativas agregadas, não uma fatura. O dataset adicional `workersInvocationsByOwnerAndScriptGroups` retornou zero grupos: isso não comprova consumo zero.

A API de assinaturas retornou **403 / código 10000** com a credencial OAuth existente. Metadados Workers informaram `default_usage_model=standard`, sem confirmar assinatura ou ciclo. A tentativa de leitura pelo Chrome chegou à tela de login; não foi selecionada uma conta salva. **Plano, renovação, fatura e consumo de logs do ciclo permanecem não confirmados.** Não foi criada credencial nem ampliado acesso. A janela móvel não pode ser tratada como ciclo de cobrança.

## Consumo observado da conta

| Métrica, 30 dias completos | Mesiva produção | Mesiva staging | Outros recursos | Total observado |
| --- | ---: | ---: | ---: | ---: |
| D1 `rows_read` | 69.636.582.013 | 561.483.007 | 20.886.129 | **70.218.951.149** |
| D1 `rows_written` | 6.187.911 | 585.839 | 8.139 | **6.781.889** |
| Requests Workers | 1.248.770 | 230.230 | 9.900 | **1.488.900** |
| CPU Workers, ms | 16.602.000,94 | 2.227.218,18 | 386.019,05 | **19.215.238,17** |

O acumulado D1 contém o período do [incidente anterior de impressão](../../operations/printing-d1-read-incident.md). Não foi atribuído à PR #120, que ainda não foi publicada. A diferença entre a janela observada e a franquia condicional de 25 bilhões seria 45,219 bilhões de leituras; **isso não é um cálculo de cobrança do ciclo atual** e não estorna excedentes já acumulados.

| Janela UTC recente, todos os recursos | D1 leituras | D1 escritas | Requests Workers | CPU Workers, ms |
| --- | ---: | ---: | ---: | ---: |
| 7 dias, 11–17/10 | 19.152.995.431 | 2.370.757 | 271.390 | 4.478.778,08 |
| 3 dias, 15–17/10 | 173.325.649 | 709.033 | 92.490 | 1.354.077,58 |
| 1 dia, 17/10 | 15.795.570 | 161.434 | 27.210 | 189.288,62 |

A queda de leituras é observada, mas as janelas não representam cargas equivalentes controladas. Um dia não comprova regime estável de um mês. CPU média agregada varia de aproximadamente 6,96 ms/request no último dia a 14,64 nos últimos três e 12,91 nos 30 dias. Não foi usada como CPU por operação da candidata nem como p50 disfarçado de média.

Outras dimensões observadas:

- DO: 3.885 invocações estimadas, 132 erros, **343,887847424 GB·s**, 1.376 linhas lidas e 744 escritas SQLite; atividade aparece somente nos três últimos dias. Não é um ensaio de 31 dias com cinco dispositivos. Os erros agregados não identificam causa ou regressão da PR; não foram convertidos em diagnóstico funcional.
- Envelope superior de picos de armazenamento por recurso na janela: D1 **22.061.056 bytes** em quatro bancos; DO SQLite **24.576 bytes** em dois namespaces; R2 payload+metadados **297.015 bytes** em quatro buckets com observações. Somar picos não simultâneos não mede armazenamento atual nem GB-mês faturados. Não se presume crescimento futuro zero ou inexistência de recurso sem observação.
- R2: **49 operações classe A, 1.247 classe B e duas gratuitas**, conforme os tipos retornados; zero tipos não classificados. Não foram lidas chaves ou conteúdo dos objetos. O uso observado é pequeno, mas não substitui projeção de uploads/exportações/builds e outros serviços.

## Projeção mensal com o código atual

Reutilizado `projectMonthlyBudget` de `scripts/infra/realtime-budget-report.mjs`, com operações HTTP medidas no gate realtime do código final. A aplicação não mudou desde `ef1d9ae7`; os commits posteriores documentam evidências. Esta projeção atualiza as medições históricas de 16/10, sem alterar aquele registro.

Premissas: **150 pedidos/dia, 1.500 mudanças/dia, cinco dispositivos totais**, sendo uma TV e quatro humanos distribuídos em pedidos/clientes/recebíveis/financeiro; uma estação e um controle. Doze horas/dia, 31 dias, 5.000 conexões/mês. O modelo usa 10% criação, 10% finalização, 10% pagamento e 70% transições de impressão. Inclui autenticação/guards HTTP, claim 2 s, heartbeat 15 s, presença/controle 5 s, renovação 60 s, reconciliação 300 s normal e 30 s degradada, detalhes e consultas históricas conforme o script. São hipóteses de dimensionamento, não vendas observadas. Degradação supõe o mês inteiro no fallback.

| Dimensão modelada do Mesiva | Normal | Degradado | Critério condicional Paid: normal / degradado |
| --- | ---: | ---: | ---: |
| D1 leituras | **9.700.818.476** | **16.029.030.520** | 20 bilhões / 25 bilhões |
| D1 escritas | **16.250.094** | **16.812.650** | 40 milhões / 50 milhões |
| Requests Workers | **2.433.548** | **2.629.800** | 8 milhões / 10 milhões |
| Requests DO, com ACK 20:1 | 246.850 | 102.000 | 800 mil / 1 milhão |
| Linhas SQLite DO, por dimensão leitura/escrita | 14.775.400 | 6.528.000 | limites conservadores do modelo, não billing medido |
| Eventos de logs estimados | 6.244.296 | 5.463.600 | 16 milhões / 20 milhões |
| CPU Workers / duração DO / crescimento do storage | **DESCONHECIDOS** | **DESCONHECIDOS** | obrigatórios para aprovação |

As três primeiras dimensões cabem nos critérios, **isoladamente**. A baseline independente dos outros serviços, se extrapolada de 30 para 31 dias, acrescentaria 21.582.333,3 leituras D1, 8.410,3 escritas, 10.230 requests Workers e 398.886,35 ms de CPU. Essa hipótese preserva a diferença entre outros serviços e Mesiva; **não soma novamente toda a atividade histórica do Mesiva** à projeção. Ela não comprova a atividade futura de outros serviços ou custos adicionais de staging. Normal+essa baseline teria 9,722 bilhões de leituras; degradado, 16,051 bilhões.

`monthlyReady=false` continua correto. R2 zero no subtotal do script significa que seu workload não contém operações R2; não significa custo zero da conta. Logs são uma estimativa do modelo e seu consumo real não foi coletado. CPU e duração locais não são CPU/duração faturáveis Cloudflare.

### Sensibilidade de CPU, sem presumir aprovação

Com a baseline independente acima, a média ponderada de CPU do workload Mesiva teria de ficar em aproximadamente **9,70 ms/request** para preservar 20% de margem no normal; no degradado, **11,26 ms/request** para caber na franquia inteira. Isso é um limite calculado, não uma medição da candidata.

| Hipótese de CPU ponderada | CPU normal / degradada, milhões de ms | Excedente de CPU normal / degradado, US$ |
| --- | ---: | ---: |
| 5 ms/request | 12,567 / 13,548 | 0 / 0 |
| 10 ms/request | 24,734 / 26,697 | 0 / 0; normal perde a margem de 20% |
| 15 ms/request | 36,902 / 39,846 | 0,138 / 0,197 |
| 25 ms/request | 61,238 / 66,144 | 0,625 / 0,723 |

Valores usam franquia condicional de 30 milhões de ms e US$0,02/milhão excedente. São somente o componente CPU, sem impostos/arredondamentos/outros produtos/acumulado do ciclo; não são previsão de fatura nem teto de cobrança. A meta US$5 exige demonstrar todas as dimensões da conta.

## Recibos concentrados: comparação antes/depois

Comparação dos repositórios reais de `f44e10da` e `c7ef7100` no mesmo D1/workerd efêmero, schema pós-0052 compatível, mesma empresa e fixtures. Mede o efeito do bundle sobre leituras; não mede o custo de aplicar a migration. Cada `loadSales` faz **cinco statements, zero escritas**.

| Perfil | Candidatos | Antes: leituras / recibos | Depois: leituras / recibos |
| --- | ---: | ---: | ---: |
| Legados NULL no dia | 1.000 | 2.002 / 1.000 | 2.004 / 1.000 |
| Legados NULL no dia | 10.000 | 20.002 / 10.000 | 20.004 / 10.000 |
| Canônicos: data efetiva e `paid_at` no dia | 1.000 | 2.002 / 1.000 | **4.002 / 1.000** |
| Mesmo perfil canônico | 10.000 | 20.002 / 10.000 | **40.002 / 10.000** |
| Canônicos: `paid_at` no dia, data efetiva anterior | 1.000 | 2.002 / 1.000 | 2.004 / 0 |
| Mesmo perfil deslocado | 10.000 | 20.002 / 10.000 | 20.004 / 0 |

No perfil deslocado, resultados distintos são a regra financeira intencional. No perfil canônico com resultado igual, o custo aproximadamente dobra: as duas consultas de recibos/alocações visitam candidatos do índice efetivo e do braço legado por `paid_at`, que descarta não NULL. Isso não é N+1, mas é uma amplificação medida e ainda sem limite operacional aprovado. Não foi adicionado índice/serviço ou alterado fallback histórico nesta rodada.

O gate anterior também mediu uma query isolada estável **2 → 5 leituras** quando somente o histórico fora do período cresce; isso não contradiz o crescimento por candidatos dentro do período. DDL do índice: 1.518 leituras/504 escritas sobre 1.000 fixtures; inserção de 1.000 recibos com 50% NULL: 4.000 → 4.500 escritas. Esses custos não devem ser extrapolados como taxa de recibos novos 100% datados ou medição da migration remota com 195 recibos.

### Rotas autenticadas e exportações locais

Foram executadas **18 requisições HTTP 200** no Worker real em workerd, reutilizando entrada instrumentada, schema e criação de sessão do gate oficial. Dois volumes (1.000/10.000), três perfis acima e três operações, com mais 10.000 recibos de outra empresa mantidos no banco. Asserções da resposta de vendas conferiram contagem própria e exclusão da outra empresa. Não há pedidos/alocações associados às fixtures de recibos deste ensaio; ele isola concentração de recibos e não representa um histórico comercial completo.

| Operação na candidata | Leituras NULL: 1k → 10k | Leituras canônicas: 1k → 10k | Escritas / statements por HTTP |
| --- | ---: | ---: | ---: |
| `GET /api/reporting/sales`, dia consultado + comparação | 3.382 → 21.382 | **5.382 → 41.382** | 14 / 38 |
| `POST /api/reporting/export-model`, modelo para CSV | 3.757 → 21.757 | **5.757 → 41.757** | 14 / 47 |
| Mesmo endpoint, `format=pdf`, modelo executivo | 7.510 → 43.510 | **10.510 → 73.510** | 20 / 91 |

Os dois perfis canônicos tiveram os mesmos custos completos: quando a data efetiva fica no dia anterior, a comparação lê aquele período. Isso explica por que a rota não custa apenas as cinco queries de um `loadSales`. O modelo PDF também calcula overview/operação/produtos. A quantidade de statements permaneceu fixa com volume 10x maior. O tempo local observado, aproximadamente 59–196 ms, não foi usado como CPU faturável. Estes POSTs geram modelos em memória, sem gravar arquivo R2; a renderização/baixamento real de CSV/PDF no navegador tem evidência própria na rodada de 17/10.

As escritas acima pertencem ao caminho HTTP completo e não às cinco seleções de `loadSales`; não foram omitidas da avaliação. Um trace adicional de vendas/PDF identificou somente atualização de `identity_sessions.last_seen_at` e inserção/exclusão das asserções transacionais `identity_tx_assertions`, sem gravar recibos ou movimentos. A soma do trace reproduziu 14/20 escritas; os valores de sessão não foram registrados. Essas verificações de concorrência não foram removidas para reduzir custo.

Como sensibilidade adicional, **20 consultas de vendas + 10 modelos CSV + cinco PDF por dia**, sempre no perfil canônico com 10 mil candidatos, acrescentariam **49.995.560 leituras, 16.120 escritas e 1.085 requests em 31 dias**, antes de CPU/logs. Essa frequência não foi aprovada nem embutida silenciosamente na projeção operacional; adicionar somente quando esses acessos forem realmente adicionais aos owners modelados. O teste não prova um limite para qualquer período/histórico ou combinação de filtros.

## Pendências e decisão

1. Confirmar assinatura, data de renovação, consumo/acumulado do ciclo e logs, por painel autenticado ou acesso somente de leitura apropriado. Nenhuma mudança de plano/permissão está incluída nesta tarefa.
2. Obter CPU faturável por operação e duração DO representativas da carga equivalente normal/degradada; incorporar storage, R2, logs, outros serviços e overhead de staging. Não preencher ausências com zero ou substituir por média histórica/p50.
3. Aprovar frequência/volume de relatórios e exportações, incluindo concentração canônica e período comparativo, e confrontar o custo total com margem de 20%. Se o limite for excedido, otimizar o caminho medido com RED → GREEN e repetir os gates no SHA corrigido; alternativamente, uma mudança de orçamento exige decisão explícita do usuário.
4. Preservar a restrição de publicação: **não implantar a candidata apenas para preencher métricas pendentes**. Um eventual ensaio remoto precisa de plano e autorização próprios, com dados fictícios e limite de gasto; a exceção financeira histórica da entrega realtime não libera automaticamente a PR #120.

Resultado da parte 3: evidência substancial coletada e lacunas delimitadas; **gate financeiro não aprovado**. Q11-12 segue BLOCKED por aceite histórico e orçamento. Q11-15 segue BLOCKED por impressão física. Método de recuperação da [parte 2](2026-10-18-effective-receipt-d1-recovery.md) continua válido com checkpoint fresco obrigatório na janela autorizada. Task 11 não homologada; manter PR aberta e staging sem publicação.

## Fontes e verificações

Preços conferidos em 18/10 nas fontes oficiais: [D1](https://developers.cloudflare.com/d1/platform/pricing/), [Workers](https://developers.cloudflare.com/workers/platform/pricing/), [Durable Objects](https://developers.cloudflare.com/durable-objects/platform/pricing/) e [R2](https://developers.cloudflare.com/r2/pricing/). As franquias são compartilhadas pela conta e dependem do plano; a tarifa base Paid não é um limite rígido de gasto.

Probes locais preservados fora do Git em `.wrangler/task11-account-analytics.mjs`, `task11-budget-ab.mjs`, `task11-budget-http.mjs`, `task11-budget-write-trace.mjs` e `task11-budget-summary.mjs`; dados sanitizados e resultados estão no JSON vinculado. Asserções conferem somas, cenários, zero escritas nas seleções de repositório, cinco statements, 18 HTTP 200, contagens próprias/estrangeiras, origem/soma das escritas HTTP, sanitização e `passed=false` do modelo incompleto. Falhas de conexão loopback do sandbox, caminho de import e formatação do resumo SQL do probe foram corrigidas antes da evidência válida; não eram falhas do produto.

Esta entrega altera documentação/evidências. Verificações: asserções do resumo PASS; sete documentos/49 links e âncoras PASS; integridade dos 20 anexos anteriores PASS; `git diff --check` PASS. Build/suíte da aplicação não foram repetidos, pois o runtime não mudou; os 4.116 testes e CI anteriores permanecem evidência do código, não homologação desta pendência financeira. README, AGENTS e índice documental continuam coerentes; foram atualizados o orçamento vivo e a matriz/relatório da Task 11, preservando registros históricos.
