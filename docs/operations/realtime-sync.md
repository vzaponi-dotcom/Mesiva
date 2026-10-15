# Sincronização operacional e orçamento Cloudflare

O canal WebSocket distribui avisos de alterações confirmadas. HTTP/D1 continuam sendo a autoridade para ler dados, autorizar ações e executar mutations. O canal não recebe comandos de impressão nem confirma saída física.

## Configuração e publicação

`REALTIME_ENABLED` controla prepare/upgrade/renew e publicação. O binding `BUSINESS_REALTIME` usa `BusinessRealtimeHub`, classe SQLite criada pela migration de Durable Objects `realtime-v1`. Isso não é uma migration D1. Cada empresa usa um objeto; os Workers de staging e produção têm namespaces separados.

A configuração de produção permanece desabilitada durante homologação. Habilitar staging pelo workflow **Deploy staging** na branch elegível `codex/realtime-budget`. A ativação em produção depende de CI, staging, orçamento completo, aceite humano e autorização explícita pelo [runbook de release](../release-and-migration-runbook.md). Ativar a configuração revisada e conferir CI/staging do SHA efetivamente publicado. Merge sozinho não publica.

Desabilitar a flag é o caminho de rollback do canal. O cliente passa ao fallback HTTP de 30s; dados, fila, auditoria e objetos persistidos são preservados. Não remover migrations ou namespaces para desligar o recurso.

## Segurança e protocolo

- Humanos preparam/renovam pela API contextual: `POST /api/realtime/prepare` e `POST /api/realtime/renew`. TV usa `/api/kitchen-tv/realtime/prepare` e `/renew`, com o pareamento atual, cookie ou header legado.
- O prepare deriva empresa, principal, sessão, contexto e tópicos das permissões atuais. O navegador não escolhe uma empresa para o hub.
- O ticket opaco dura60s, é consumido uma única vez e é enviado como subprotocolo em `GET /api/realtime/socket`; não vai na URL. O upgrade revalida a autorização e responde somente com `mesiva.realtime.v1`.
- Lease75s, renovação autenticada60s. Mudanças de contexto, acesso, senha, despareamento ou suspensão invalidam conexões; todas as leituras HTTP continuam revalidando auth. Uma invalidação da empresa pode exigir reautenticação de peers ainda válidos.
- Avisos v1: `ready`, `invalidate`, `resync_required`, `access_changed`. Contêm revisão decimal, tópicos e até99 IDs de pedidos; não contêm clientes, valores, pagamentos ou documentos de impressão.
- Limites do hub:25 conexões/empresa,5/principal,25 tickets pendentes. O cliente confirma receipt de aviso validado/enfileirado com ACK da revisão; isso não confirma aplicação dos dados. Após32 avisos sem ACK, o hub fecha o peer lento.
- O hub usa WebSocket Hibernation, attachments e revisão persistida; não usa intervalos permanentes nem journal D1 de eventos.

Não registrar cookies, credenciais, tickets ou a lista completa de subprotocolos. Diagnósticos de publicação são estáticos e sem payload. Avisos são publicados depois do commit, inclusive quando a resposta final do autor falha. Falha de publicação não transforma uma gravação confirmada em erro nem reenvia a mutation.

## Carregamento na navegação

A abertura do Mesiva permanece reservada à verificação de sessão e ao bootstrap inicial do contexto autenticado. Com leituras por superfície habilitadas, a troca de tela mantém o shell e a navegação montados; somente o conteúdo aguarda o snapshot da superfície. Ações e dados da tela anterior não são apresentados enquanto esse snapshot estiver pendente. Falhas mostram uma tentativa explícita no conteúdo, preservando a navegação.

O skeleton compartilhado acompanha os estados das requisições existentes: não executa HTTP, polling ou timers de dados, nem impõe espera artificial. Clientes, histórico e financeiro também o utilizam no primeiro carregamento das consultas específicas. Atualizações em segundo plano preservam dados já disponíveis para a mesma consulta/contexto. O shimmer usa os tokens do tema e respeita `prefers-reduced-motion`; a mudança de sessão/empresa continua invalidando as projeções anteriores.

## Leituras e temporizadores

| Rotina | Canal saudável | Recuperação/compatibilidade |
| --- | --- | --- |
| Dados operacionais | Avisos agrupados250ms; pedidos por IDs; outras coleções por bootstrap agrupado | Reconciliação300s com jitter±10%, mesmo revisão igual; fallback30s |
| Projeção da TV | Avisos de pedidos/TV; relógio local1s mantém janela de agendamento e alertas | Mesmo transporte/reconciliação/fallback; poll2s permanece apenas no pareamento temporário e componente legado sem canal |
| Controle da TV | Avisos atualizam comandos/projeção; verificação de presença5s apenas nessa superfície montada | A validade da telemetria continua15s; heartbeat idêntico não publica |
| Apresentação da fila | Avisos acionam refreshes oficiais; painel retira o poll10s quando integrado ao canal | Reconciliação/fallback; queries e ações manuais continuam disponíveis |
| Estado/aging de impressão | Estação QZ principal mantém5s, inclusive oculta; outros dispositivos30s | `GET jobs` também faz aging/expiração; não eliminar o dono temporal |
| Execução física | Claim/ticker2s, heartbeat15s e monitoramento QZ existentes | Independem da atualização visual; resultado desconhecido exige decisão humana |
| Telemetria da TV | Heartbeat5s preservado | Só mudança efetiva da projeção publica aviso; comparação usa um SELECT indexado adicional |

Abas ocultas suspendem releituras visuais e retomam com reconciliação. A estação de impressão mantém sua operação. Navegadores sem as APIs necessárias para WebSocket seguro usam HTTP30s. Reconexão tem recuo1/2/4/8/16/30s com jitter20%; preparação expira localmente em10s e cancela HTTP pendente.

Uma resposta parcial de pedidos preserva todo o histórico carregado e sua ordenação. ID ausente solicita snapshot; não remove entidade silenciosamente. Guards que rejeitam resposta concorrente mantêm dirty para releitura. Uma coleção tem uma leitura em andamento; bootstrap e lista completa de pedidos não disputam o mesmo aviso.

Os fontes canônicos são `src/infrastructure/realtime/`, `src/app/runtime/data/` e `worker/realtime/`. A TV não importa o runtime administrativo. O catálogo `effectCatalog.js` registra ações, witnesses sem auditoria e exclusões; novos owners precisam atualizar cobertura/testes.

## Gate real e relatório

Com Node22 e dependências instaladas, usar a versão de Wrangler já fixada no projeto:

```bash
npx --yes wrangler@4.128.0 --version
node --test scripts/infra/realtime-runtime-gate.test.js scripts/infra/realtime-budget-report.test.js
node scripts/infra/realtime-runtime-gate.mjs .wrangler/realtime-runtime-gate-report.json
```

O gate cria recursos locais isolados no workerd/Miniflare da versão fixada, usa contas/empresas fictícias e histórico de10.000 pedidos, cinco itens/pedido e3.000 jobs terminais. Exercita cinco clientes (incluindo TV), upgrade101, hibernação/reinício reais, perda de publicação, reconciliação, heartbeat sem alteração, concorrência de claim e resultado desconhecido. Não envia dados a impressoras ou a produção.

`rowsRead`/`rowsWritten` do relatório vêm de `D1Result.meta` das rotas reais, incluindo autenticação, guards e auditoria. Dados de fixture e EXPLAIN ficam fora da contagem de requests operacionais. Temporizadores do cliente são comprimidos; timestamps do lease são mapeados ao relógio virtual, enquanto autorização e hibernação continuam reais. Tempo local de resposta não é CPU ou duração faturada na Cloudflare.

O validador mensal recebe operações medidas, mix de dispositivos, métricas reais de staging e baseline agregado dos outros serviços da conta:

```bash
node scripts/infra/realtime-budget-report.mjs .wrangler/realtime-budget-input.json .wrangler/realtime-budget-report.json --require-complete
```

O input deve conter `operations`, `workload`, `stageMetrics` e `accountBaseline`. CPU por operação, duração do DO, crescimento/armazenamento e consumo da conta precisam de evidência agregada sem credenciais. Ausência de dados é desconhecida, nunca zero. Guardar janela de coleta, SHA, origem e limitações junto ao relatório para revisão.

O modelo padrão usa cinco dispositivos totais: uma TV, uma estação e uma tela de controle;12h/dia,31dias,5.000 alterações/dia e5.000 conexões/reconexões/mês. O mix de dimensionamento é10%criações,10%finalizações,10%pagamentos e70%transições de impressão. São hipóteses de ensaio, não vendas observadas. Outras composições/volumes precisam de nova projeção.

Somar D1, Workers/CPU, RPCs do DO, ACKs de entrada20:1, duração, SQLite do DO, logs, R2 e armazenamento. Mensagens de saída não têm cobrança de requests, mas isso não torna toda a infraestrutura gratuita. O modelo reserva margem20% no normal e exige ficar dentro de todas as franquias no degradado. Consultas de histórico/bootstrap grandes podem impedir aprovação mesmo com WebSocket funcionando.

A franquia é compartilhada pela conta; US$5 é mensalidade com excedentes, não teto automático. A redução futura não estorna leituras já acumuladas no ciclo. Se uma dimensão estiver desconhecida ou exceder o orçamento, manter o canal em staging e otimizar as leituras antes de habilitar produção; não bloquear vendas/impressões como contenção automática.

Fontes de preços: [Workers](https://developers.cloudflare.com/workers/platform/pricing/), [D1](https://developers.cloudflare.com/d1/platform/pricing/), [Durable Objects](https://developers.cloudflare.com/durable-objects/platform/pricing/) e [R2](https://developers.cloudflare.com/r2/pricing/). Conferir preços/franquias novamente ao rever o modelo.

## Homologação e acompanhamento

Conferir SHA e `/release.json`, bootstrap autenticado200, cinco conexões, mudança refletida em outro dispositivo, retomada de foco/rede, revogação e fallback. No DevTools, uma conexão WS e requests temporais documentados são esperados; as recargas gerais de pedidos2s e bootstrap5s devem desaparecer no cliente integrado. Não interpretar o filtro Fetch/XHR como lista completa do canal WS.

Amostras de latência commit→tela em staging têm alvo p95≤2s com canal saudável. CPU/duração/uso agregado devem vir da Cloudflare, distinguindo amostragem/atraso de ingestão. Após release, comparar taxas de leituras por hora durante uso real e projeção para o ciclo; manter o acompanhamento solicitado para15/10 a partir das10h de São Paulo. Não afirmar redução faturada com sistema ocioso.


## Estado da validação em 15/10/2026

O gate local em workerd passou com cinco clientes, 10 mil pedidos históricos, 50 mil itens, 10 mil eventos de auditoria e 3 mil impressões terminais. Publicação perdida convergiu em 264 segundos, hibernação e reinício recuperaram as conexões, houve um vencedor na disputa por claim e nenhum reenvio automático de resultado desconhecido. Isso não substitui homologação em navegador nem métricas faturadas da Cloudflare.

No mesmo cenário, o ajuste do índice de autoria reduziu a requisição por ID de 10.391 para 388 linhas lidas; a seleção de auditoria isolada caiu de 10.005 para 2. Índices aditivos da migration0044 reduziram listagem de impressão de 6.890 para 3.889 e resumo de 6.374 para 3.373 leituras. As 3 mil impressões da fixture são do dia corrente e continuam contadas. Totais de mesa passaram a consultar comandas abertas da empresa e seus pedidos/itens, sem corte por idade; a fixture sem mesas não mede ganho dessa alteração.

Consultas SELECT guardadas compartilham o mesmo predicado de autorização em seu batch transacional, sem inserir/remover assertions auxiliares. Mutations, SQL não classificado e batches mistos mantêm o CHECK com rollback; a validação final da sessão permanece. Escritas HTTP medidas: bootstrap53→2, leitura por ID8→2, listagem de impressão20→11 e resumo8→5. Esses números incluem autenticação e operações auxiliares.

A medição anterior à integração scoped projetava24,326bilhões de leituras no normal e39,489bilhões no degradado, com bootstrap integral. Foi substituída pelo [registro de validação da extensão](../superpowers/qa/2026-10-15-realtime-scoped-budget.md):18,960bilhões e13,940bilhões respectivamente para o mix declarado, antes do baseline dos demais serviços. **O orçamento agregado ainda não foi aprovado:** CPU, duração, armazenamento e baseline da conta permanecem pendentes. Produção conserva ambas as flagsfalse; gate funcional verde não é aprovação financeira.

O CI executa o runtime real uma vez no job `validate`, após os dry-runs com Wrangler fixado; os oito shards executam os testes unitários do validador. O artifact `realtime-runtime-report` contém medidas/invariantes sanitizadas e marca dimensões desconhecidas, sem cookies, tickets ou tokens.


## Extensão aprovada: snapshots por superfície

A [matriz de consumidores](../superpowers/specs/2026-10-15-operational-snapshots-matrix.md) foi aprovada em15/10, com execução pelo [plano de read models](../superpowers/plans/2026-10-15-operational-read-models.md). A primeira etapa adiciona `surface` ao bootstrap e `/api/reads/orders/active`, sob `OPERATIONAL_READ_MODELS_ENABLED`. A flag permanecefalse em produção e staging até migrar os consumidores; requisições semsurface ou comflag desativada preservam o contrato integral.

No gate real local, bootstrap da cozinha com20pedidos ativos leu4.590linhas antes e4.610 após inserir10mil pedidos/50mil itens/10mil eventos históricos; o bootstrap integral leu195.117linhas no mesmo cenário. Todas as leituras incluem auth/guards/atribuição e duas escritas auxiliares HTTP. O teste de plano com100mil pedidos históricos manteve os três candidatos ativos, incluindo agendado futuro e registro antigo com timestamp legado de finalização. A migration0045 adiciona índice de status ativo sem alterar a elegibilidade mais restrita da TV.

O ganho medido (97,6% para a consulta da cozinha) não representa uma publicação nem orçamento mensal já aprovado: consumidores, outros read models, CPU/duração/conta e homologação seguem pendentes.


O histórico recebe `/api/reads/orders/history`, com limite50 (máximo100), cursor vinculado à consulta/empresa e contagens completas por filtro/dia. Detalhes continuam na API oficial por IDs; a tela aceita um readModel controlado e mantém compatibilidade com o modo legado. A composição do novo owner com App segue para a etapa de migração do runtime.

A migration0046 adiciona índices de linha do tempo e subconjunto de timestamps legados, sem reescrever registros. Datas normalizadas usam faixas temporais; datas antigas/inválidas mantêm `Date.parse` em um fluxo separado. A busca conserva NFD/acentos, substring e conteúdo/notas dos itens: processa128candidatos por bloco e mantém somente a página selecionada em memória. Essa busca pode examinar todo o período solicitado e deve entrar no orçamento.

Medição real local com10mil históricos: página de50pedidos32010leituras; busca em todo o período171257leituras (duas escritas HTTP em ambos). A primeira implementação da busca lia535598linhas; separar as faixas de horário empatado/IDs e limitar cada braço antes da ordenação eliminou a repetição do prefixo. O gate rejeita regressão desse custo. O teste de revogação durante a busca retorna409 sem expor registros; respostas de detalhe de contexto anterior são descartadas. Nenhuma dessas mudanças foi publicada nesta etapa.


As consultas de clientes e financeiro ficam em `/api/reads/customers`, `/api/reads/customers/:id/relationship` e `/api/reads/finance/{receivables,overview,movements}`. Totais, previsão e indicadores abrangem o universo autorizado, independentemente da página. O relacionamento só declara histórico completo com `orders.view` e `orders.history`; nenhum grant financeiro concede leitura de pedidos por si só. Grupos retornam metadados completos e a consulta por `groupKey` pagina seus pedidos, preservando o owner oficial de recebimento em lote.

A migration0047 cria uma projeção derivada apenas de chaves de pendências (`unpaid`/`refund`), mantida por triggers na mesma transação de pedidos, pagamentos e estornos. A fonte e os valores continuam nos registros oficiais; a leitura revalida elegibilidade e empresa. Backfill não altera dados originais, histórico, auditoria ou fila. Testes cobrem rollback, idempotência, `changes()`, IDs legados, troca de referência e FK composta. A migration0048 adiciona índices de movimentos para paginação, composição completa dos recibos e timestamps legados, sem reescrever datas.

No gate D1 local com cinco clientes e10mil vendas históricas pagas, recebíveis com os mesmos candidatos passaram de1120para1141leituras, com duas escritas auxiliares HTTP. Dashboard com histórico retido fora do período passou de2136para2141leituras; com10mil pedidos dentro dos30dias, leu132138linhas para agregados e gráficos completos. Esse custo do período é real e deve entrar no dimensionamento. Movimentos sem registros leram616linhas. Grupos de recibo permanecem completos mesmo com limite1; o limite conta grupos, incluindo suas partes relacionadas na resposta.

Essas medidas validam o backend da extensão. A integração dos owners/telas foi concluída nas seções seguintes; orçamento agregado, CI e homologação permanecem gates de entrega. As flags de produção continuam desativadas até o aceite do SHA e aprovação financeira.


O runtime reconhece `completeCollections` e substitui somente as coleções declaradas pelo snapshot da superfície atual. Uma resposta atrasada de outra superfície/empresa é descartada; loading com erro permite nova tentativa. O histórico já usa seu owner de consulta paginada no App. As demais telas serão migradas antes de ativar a flag scoped.

`useScopedQuery` mantém singleflight/dirty por consulta e usa os avisos/foco/reconciliação/fallback do transporte, sem outro intervalo de polling. Tokens de consulta protegem contra mutations locais sem fazer consultas independentes invalidarem umas às outras. Mudança de cursor por concorrência recarrega a primeira página; mudança de acesso limpa o estado privado. Callbacks da empresa/consulta anterior não aplicam resultados.

O shell inclui apenas IDs/status/horários dos candidatos ativos e IDs de comandas abertas para badges consistentes em qualquer tela. O badge da cozinha reutiliza a regra oficial de início do preparo, não conta agendados que ainda aguardam e avança com o relógio local, sem HTTP. A fila completa, clientes e itens não entram nesses metadados.

Ações sobre pedidos fora do cache operacional preparam até100IDs em lotes de99 na API canônica antes de abrir os workflows de pagamento existentes. O snapshot síncrono continua pertencendo ao runtime; valores, elegibilidade, contexto e limites continuam revalidados pelos owners/Worker. Fechar o detalhe ou trocar de tela/empresa durante essa leitura impede a abertura tardia do pagamento. Essa preparação é leitura; não repete mutations.

### Integração de clientes e financeiro

Clientes, relacionamento, A Receber, fluxo de caixa e dashboard usam owners de consulta por contexto quando o bootstrap anuncia o modo scoped. Totais, favoritos, contagens de filtros e saldo vêm do universo autorizado no servidor; páginas só fornecem as linhas exibidas. Recebimentos por cliente preservam IDs explícitos entre páginas, até100, e revalidam os selecionados por leitura canônica antes do owner de pagamento existente. Ausência numa página não remove uma seleção.

A verificação de duplicidade de nome/telefone consulta identidades da empresa ao salvar; não depende da página de clientes carregada e não lê pedidos. Fechar o editor, trocar empresa ou perder permissão invalida a preparação pendente. As consultas não adicionam polling: recebem invalidações, reconciliação e fallback do transporte contextual. Loading, erro e retry não exibem totais parciais como globais. Flags de produção continuam desativadas até conclusão dos consumidores remanescentes, orçamento e homologação.

### Consumidores operacionais sem histórico global

Comandas/mesas continuam obtendo detalhes oficiais por ID; o snapshot inclui comandas abertas antigas e as reservas da consulta canônica de mesas. A interface atual não possui listagem de comandas fechadas: o histórico permanece preservado no banco e nos fluxos oficiais existentes, sem criar um endpoint sem consumidor.

“Finalizados hoje” usa `/api/reads/orders/kitchen-summary`: status Finalizado, finished_at e dia de São Paulo, incluindo compatibilidade Date.parse de timestamps antigos. Mantém a visibilidade histórica da sessão; orders.view sozinho não ganha contagens de histórico. Os índices0049 limitam a contagem à data e ao subconjunto legado. A mesma invalidação/reconciliação do transporte atualiza esse indicador; o relógio local renova a consulta na mudança de dia.

Atividades abre o pedido autorizado por ID e descarta respostas de contexto anterior. A fila obtém número e identidade do documento persistido no job quando o pedido não está no cache. Documento, segunda via, confirmação do spooler e decisão humana para impressão desconhecida continuam usando os serviços oficiais, sem depender do histórico global.
