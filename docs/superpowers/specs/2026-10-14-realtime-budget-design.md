# Atualização por eventos dentro do orçamento do Mesiva

Data: 14/10/2026. Estado: desenho escrito para revisão humana; implementação ainda não iniciada.

## Objetivo e limites

O usuário autorizou reduzir as consultas periódicas usando WebSocket. Há um restaurante e até cinco dispositivos/abas simultâneos. O objetivo é operar dentro das franquias do Workers Paid já contratado, mantendo o valor base de US$ 5 por mês, sem comprometer pedidos, isolamento, auditoria ou impressão.

O ciclo 08/10–08/11 já ultrapassou 25 bilhões de leituras D1. Esta entrega não desfaz o excedente acumulado. A correção do incidente de impressão, PR #110, já foi publicada. A redução adicional será avaliada por consumo agregado da conta e projeção do ciclo, incluindo outras aplicações, e não somente pela quantidade de mensagens WebSocket.

Esta é uma mudança arquitetural: acrescenta um canal de avisos e muda a sincronização entre dispositivos. Não altera telas, regras de preço, pagamentos, permissões, QZ ou confirmação física.

## Evidências e alternativas

`src/app/runtime/data/useOperationalDataRuntime.js` combina bootstrap periódico de cinco segundos e pedidos de dois segundos. `worker/orderReadRepository.js` carrega todos os pedidos e itens da empresa em cada atualização. A TV também consulta a cada dois segundos; sua seleção de itens começa pelo histórico completo de itens da empresa. Atribuições de auditoria acompanham essas respostas.

A consulta de impressão que dominava as leituras foi corrigida separadamente. Nos planos de produção, as duas seleções passaram de 1.257.408 para oito linhas lidas, sem escritas. Esse resultado não é uma medição de redução de todo o sistema.

Alternativas consideradas:

1. **Avisos por WebSocket, leitura de pedidos alterados e reconciliação:** recomendada. Remove consultas frequentes sem mudança e evita reler todo o histórico em cada evento. Mantém HTTP e D1 como autoridade.
2. **Somente ampliar os intervalos atuais:** exige menos código, mas aumenta permanentemente a demora entre dispositivos e continua relendo o histórico.
3. **Journal durável de todas as alterações e API de deltas com cursor:** oferece recuperação detalhada de eventos, mas exige novas escritas transacionais e retenção. Não é necessário para cinco dispositivos quando a reconciliação consegue restaurar o estado completo.

A escolha é a primeira. Não haverá journal D1 de eventos nem migração de históricos.

## Canal e contrato

Um Durable Object com armazenamento SQLite por empresa e ambiente distribui avisos. Staging e produção usam namespaces próprios. O Worker deriva a empresa do contexto autenticado, nunca de um parâmetro escolhido pelo cliente. O objeto aceita sockets pela API de hibernação (`ctx.acceptWebSocket`), restaura attachments após despertar e não mantém intervalos ou tarefas permanentes que impeçam hibernação.

O canal humano usa a sessão atual; a TV usa sua credencial de pareamento atual. Não se passa token pela URL. O upgrade exige origem permitida, sessão válida e permissões correspondentes. Assinaturas e mensagens são filtradas pelo Worker e pelo tipo de cliente. O navegador não pode publicar eventos nem escolher outra empresa.

Cada aviso contém versão do protocolo, revisão monotônica persistida no objeto, tópicos e, quando aplicável, IDs de pedidos alterados. Não contém clientes, valores, pagamentos, conteúdo de impressão ou credenciais. Tópicos previstos: pedidos, mesas/reservas, catálogo/clientes/financeiro, configurações/TV e fila de impressão. IDs são fornecidos somente a assinantes autorizados ao tópico.

Avisos não concedem autoridade: todas as leituras e mutations continuam passando pelas capabilities e pelas verificações de contexto antes/depois da execução. A conexão é renovada por HTTP autenticado a cada minuto. Troca de empresa/sessão fecha a conexão, invalida leituras pendentes e cria uma nova geração. Revogação de acesso e despareamento fecham os sockets correspondentes; expiração impede novos avisos e leituras.

## Publicação de alterações

Os owners existentes executam e auditam as alterações. Depois da confirmação no banco, o Worker publica um aviso interno com os efeitos pertinentes. Um catálogo explícito associa operações e efeitos a tópicos/IDs; não se infere alteração por expressão regular sobre SQL ou por qualquer resposta HTTP bem-sucedida.

A cobertura inclui criação/status/cancelamento/pagamento de pedidos, efeitos em comandas e financeiro, catálogo/clientes, reservas, configurações, controles da TV e mudanças relevantes da fila. Heartbeats, consultas, claims vazios, renovações de sessão e atualizações de `last_seen_at` sem mudança operacional não geram avisos. Operações idempotentes repetidas não disparam releituras inúteis.

Se uma mutation gravar e a resposta for interrompida ou a validação final da sessão falhar, a alteração continua precisando de aviso aos demais usuários válidos. A publicação é associada ao efeito confirmado, sem tornar a conexão ou a resposta do autor condição de sucesso da gravação. Falha do distribuidor não transforma uma gravação confirmada em erro de negócio nem provoca reenvio da mutation. Registra-se apenas diagnóstico sem dados sensíveis; a reconciliação recupera o estado.

## Atualização dos clientes

O bootstrap completo continua na entrada, mudança de contexto e recuperação. Durante operação normal, o runtime agrupa avisos por 250 ms e mantém uma leitura por coleção em andamento. A mesma alteração não inicia simultaneamente bootstrap e consulta completa de pedidos.

Para pedidos, uma nova leitura autenticada busca somente IDs afetados, com limite de 100 IDs por chamada, índices por empresa/pedido e respectivos itens. Mantém os formatos, projeções e atribuições atuais. O runtime integra os pedidos completos retornados na coleção já existente, preservando histórico, ordenação e efeitos oficiais locais. Evento inválido, excesso de IDs ou ausência inesperada de um pedido conhecido solicita uma reconciliação; não apaga dados silenciosamente. Pedidos cancelados/concluídos permanecem no histórico.

Para outros tópicos, usam-se as leituras oficiais existentes e o bootstrap agrupado quando não houver endpoint de coleção adequado. Não se cria uma segunda propriedade de mutations ou cache financeiro. Respostas antigas não sobrescrevem mutations recentes; preservam-se os guards de coleção, geração e contexto. Um guard que rejeita uma atualização conserva a necessidade de releitura.

A TV recebe avisos restritos e recarrega sua projeção ativa. A seleção começa por pedidos ativos da empresa e consulta seus itens por índice, preservando estados finais, ocultações, agendamentos, controles e ordenação. O relógio local continua atualizando o tempo sem ler D1.

Com canal saudável, uma reconciliação HTTP completa ocorre a cada cinco minutos nas superfícies operacionais visíveis, além de reconexão, retomada de foco e retorno da rede. Ela é obrigatória mesmo se a revisão do objeto não mudou: um aviso pode ter falhado antes de chegar ao objeto. As reconciliações são escalonadas com jitter para evitar rajadas entre dispositivos.

Reconexão usa recuo progressivo de um a 30 segundos com jitter. Enquanto o canal estiver indisponível, consultas HTTP oficiais continuam a cada 30 segundos nas superfícies relevantes. Não se acumula uma fila ilimitada de eventos. Abas ocultas suspendem atualização visual e retomam com reconciliação; a estação responsável pela impressão mantém seu serviço operacional.

## Impressão e alterações dependentes do tempo

WebSocket pode atualizar a apresentação da fila, mas não ordena impressão, não confirma saída física e não substitui o claim atômico. Nesta entrega permanecem os tickers existentes de execução, heartbeat, spooler, expiração e recuperação. Seus custos entram no orçamento. Avisos de fila não iniciam um segundo executor, não reimprimem resultados desconhecidos e não alteram regras de vias.

A migração não remove verificações temporais que hoje executam regras do servidor. Pedidos agendados, reservas, expiração de tentativas e estados de estação devem continuar progredindo sem depender de um novo evento. Relógios de apresentação são locais. Qualquer substituição futura de ticker de impressão por alarms será uma entrega própria, com validação física pertinente.

## Orçamento e medição

Modelo conservador para validação: cinco dispositivos, 12 horas por dia, 31 dias e até 5.000 alterações operacionais por dia. Esses números de atividade são hipóteses de ensaio, não volume real informado pelo restaurante.

Nesse modelo, 155.000 publicações por mês, 111.600 renovações e até 5.000 conexões/reconexões resultam em aproximadamente 271.600 solicitações ao Durable Object. Mensagens enviadas pelo servidor não são cobradas como requests. Cada handler deverá terminar rapidamente e permitir hibernação. A duração efetiva será medida; o número de requests sozinho não demonstra custo zero.

Há aproximadamente 22.320 reconciliações mensais para cinco dispositivos. No fallback contínuo de 30 segundos, há 223.200 leituras de sincronização. Exemplo: 60.000 linhas por sincronização resultariam em 1,34 bilhão e 13,39 bilhões de linhas, respectivamente, antes de somar impressão, identidade e demais rotas. Essa conta demonstra por que também é necessário medir o tamanho das consultas e o cenário degradado.

Critérios para habilitar produção: projeção agregada abaixo das franquias de D1, Workers, Durable Objects e armazenamento, com alvo de pelo menos 20% de margem para operação normal. D1 inclui 25 bilhões de leituras e 50 milhões de escritas/mês; Workers inclui 10 milhões de requests e 30 milhões de ms de CPU; Durable Objects inclui um milhão de requests e 400.000 GB-s/mês. A validação deve contabilizar índices, reconciliação, impressão e autenticação, além do tráfego do novo canal. O armazenamento SQLite do objeto também deve ser contabilizado. Incluir logs (franquia atual de 20 milhões de eventos/mês), armazenamento e operações R2 já existentes; não acrescentar um log por heartbeat ou mensagem.

O ensaio mede `rows_read` no runtime D1 real, requests, CPU/duração e comportamento ocioso. Apresenta projeção para operação normal e indisponibilidade do canal, com histórico de 10.000 pedidos e respectivos itens. Se o modelo exceder franquias ou não houver evidência suficiente, a entrega continua em staging até ajustar as consultas. A franquia é compartilhada por serviços da conta; o plano pago não é um teto automático de cobrança. Não se bloqueia venda ou impressão automaticamente por orçamento.

## Validação

- Banco sem pedidos e com histórico volumoso: ociosidade não mantém os polls globais de dois/cinco segundos; busca por ID e TV não percorrem itens históricos alheios aos candidatos. Comparar `EXPLAIN QUERY PLAN` e `rows_read` antes/depois.
- Dois a cinco clientes: criação, status, cancelamento, recebimento e efeitos em mesas/financeiro aparecem sem refresh manual; histórico e atribuições permanecem corretos.
- Avisos duplicados, atrasados, perdidos, concorrentes e publicação indisponível: coalescência e guards evitam regressão; reconciliação restaura o estado sem reenviar mutations.
- Empresa/sessão/capabilities diferentes, troca de contexto, logout, expiração, revogação e TV despareada: conexão e HTTP mantêm isolamento e bloqueios atuais.
- Suspensão/retomada, foco, rede ausente, reinício/hibernação do objeto e cliente antigo: recuperação e fallback não interrompem o serviço.
- Fila vazia, tentativa pendente, resultado desconhecido, confirmação de spooler, segunda via e executores concorrentes: preservar os testes e gates de impressão existentes, sem claims/executores adicionais causados pelo canal.
- Avanço do relógio sem nova mutation: preservar agendamentos e verificações temporais atuais.
- Validar arquitetura, lint, build, suíte completa CI, migrations locais e gates D1/printing/profile afetados; não ajustar allowlists de schema de maneira genérica.

## Entrega e rollback

Desenvolvimento isolado em `codex/realtime-budget`, a partir da master que contém a correção D1. Configuração aditiva de Durable Object/namespace/migração de classe e somente índices D1 novos quando necessários. Não se removem migrations aplicadas, históricos, auditoria, filas ou dados.

Feature flag controlada no Worker permite habilitar staging e desativar o canal sem apagar o objeto. Clientes antigos permanecem compatíveis. O fallback usa endpoints existentes; a leitura de pedidos por ID é aditiva. A reversão conserva schema e estado, seguindo o runbook.

Entrega normal: PR/CI, staging com dados fictícios, medição e aceite humano do desenho implementado, merge, CI/staging da master para o SHA exato e publicação explícita pelo GitHub Actions. A autorização da publicação do incidente anterior não é reutilizada para publicar este novo subsistema. Produção não recebe lançamentos fictícios de teste.

Atualizar README e runbooks de operação/release com configuração, diagnóstico, orçamento e recuperação. Após publicação autorizada, verificar versão ativa e comparar métricas durante uso real. Preservar o acompanhamento do incidente já agendado para 15/10 às 10h de São Paulo; ele não pressupõe que WebSocket já estará publicado.

## Referências

- [Runbook de publicação](../../release-and-migration-runbook.md).
- [Incidente D1 de impressão](../../operations/printing-d1-read-incident.md).
- [Impressão Windows/QZ](../../operations/windows-qz-tray-printing.md).
- [Cloudflare Workers: preços](https://developers.cloudflare.com/workers/platform/pricing/).
- [Durable Objects: preços](https://developers.cloudflare.com/durable-objects/platform/pricing/).
- [WebSocket e hibernação](https://developers.cloudflare.com/durable-objects/best-practices/websockets/).
- [D1: preços](https://developers.cloudflare.com/d1/platform/pricing/).
