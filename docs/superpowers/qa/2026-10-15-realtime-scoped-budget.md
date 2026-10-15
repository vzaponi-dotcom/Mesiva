# Validação da sincronização e leituras scoped —15/10/2026

Entrega vinculada à issue75. Esta evidência local não comprova publicação nem cobrança da Cloudflare. PR110/111 já publicados continuam sendo a referência de produção até confirmação de um novo release.

## Implementação e preservação

Snapshots por superfície, histórico/cliente/financeiro paginados e totais autoritativos substituem a dependência do histórico global. Seleção mantém IDs explícitos entre páginas, até100, e prepara leituras canônicas antes do owner oficial de recebimento. Mesas/reservas consultam seus detalhes existentes; impressão consulta documento oficial e preserva claim, heartbeat, spooler, segunda via e decisão humana para unknown. Leitura de fila recupera número do pedido do documento persistido quando o pedido não está no cache.

Migrations0044..0049 são aditivas.0047 mantém chaves derivadas unpaid/refund com FK composta e triggers atômicos, revalidadas pela fonte oficial na leitura. Não reescreve pedidos, pagamentos, movimentos, auditoria ou jobs existentes. Rollback de código considera manter essas estruturas compatíveis; não remover migrations nem dados para desativar flags.

## Medição real local

Runtime workerd do Wrangler4.128.0;5clientes de transporte incluindo TV;10.000pedidos históricos com5itens cada, vinculados a cliente fictício registrado;10.000eventos de auditoria;3.000impressões terminais do dia. HTTP inclui auth, guards e atribuição. Cada leitura abaixo registrou2escritas auxiliares; não são escritas de dados de negócio.

| Consulta | rows_read |
| --- | ---: |
| Bootstrap integral de comparação |215251|
| Maior bootstrap scoped entre as superfícies testadas |4790|
| Cozinha scoped antes/depois do histórico |4738/4758|
| Pedido por ID antes/depois do histórico |388/388|
| Recebíveis com candidatos fixos antes/depois |1120/1141|
| Grupos / pedidos do grupo / busca rápida |575/1141/1141|
| Lista de clientes com contagens completas |30414|
| Relacionamento com favoritos completos do cliente volumoso |164381|
| Dashboard30dias / histórico fora do período |132138/2141|
| Movimentos vazios / contador cozinha |616/374|
| Página histórica50 / busca histórica global |32110/171357|

O relacionamento volumoso e os agregados históricos têm custo proporcional ao universo consultado. Não tratar a paginação como prova de custo constante. A fixture SQLite adicional com100mil históricos cobre seleção operacional e plano indexado; o gate HTTP acima usa10mil.

O gate funcional real passou: zero polling global antigo,5clientes reconectados após reinício, hibernação preservada, publicação perdida convergindo nos5clientes em264s, uma mutation confirmada, um vencedor de claim e nenhum reenvio de unknown. Tráfego de cenários scoped foi medido separadamente; isso não substitui cinco telas autenticadas num navegador nem saída física em impressora.

## Projeção de regime estável

Mix explícito: uma cozinha, um perfil de cliente aberto, A Receber com grupo/busca rápida abertos, um fluxo de caixa e uma TV;12h/dia por31dias.5.000mudanças/dia distribuídas10%criação,10%finalização,10%pagamento e70%impressão;20mudanças administrativas adicionais/dia. Cada owner recebe eventos relevantes conforme effectCatalog: printing não publica orders/finance. Inclui reconciliação300s ou fallback30s, consultas de usuário, leitura canônica para ações, claim2s,heartbeat15s,aging5s/30s,telemetria/controle5s,renovação60s e ACKs20:1.

| Dimensão modelada, sem baseline externo | Normal | Degradado |
| --- | ---: | ---: |
| D1 rows_read |18959965486|13939638910|
| D1 rows_written |28068940|18681860|
| Worker requests |5263772|3463500|
| Durable Object requests |518100|319000|
| Logs (limite conservador) |14508744|7565000|

São hipóteses de dimensionamento, não volume observado do restaurante. Outro mix, mais histórico consultado ou outra frequência pode ultrapassar a franquia. CPU Worker, duração DO, armazenamento atual/crescimento e baseline dos demais serviços são desconhecidos. `monthlyProjection.passed` permanecefalse; não garante US$5, não autoriza produção e não estorna excedente acumulado no ciclo atual.

## Revisão e entrega

Revisão independente única do código integrado identificou doisP2. Ambos cobertos por RED/GREEN: erro503 na revalidação mantém seleção/sessão;409REALTIME_CONNECTION_EXPIRED reconecta com fallback sem interpretar como revogação.401/403/SESSION_CONTEXT_CHANGED continuam encerrando o canal e revalidando acesso. Foram21testes focados aprovados após correção.

Arquitetura, lint, build, dry-runs, suíte completa, preservação D1 e CI são registrados no PR para o SHA exato. Staging terá flagsrealtime/scopedtrue; produção conserva flagsfalse até conclusão financeira e homologação. Pipeline obrigatório: PR/CI→Actions staging→aceite humano→merge→CI/staging master→Deploy production manual→confirmar versão ativa e métricas.

Validação local final:3.884testes aprovados, zero falhas; arquitetura/lint/build aprovados (avisos de lint e chunk existentes registrados nos logs). Dry-runs dos dois ambientes passaram. Migrations locais até0049 e gate SpecB real passaram com preservação de linhas/referências e clean install; gates de recuperação de impressão, leituras operacionais (schema49), perfis operacionais e administração de empresas também passaram. CI do PR, staging autenticado e métricas externas permanecem pendentes até evidência específica do SHA publicado.

## Carregamento por superfície

O teste de navegação com bootstrap pendente reproduziu a desmontagem do shell antes da correção. Após o ajuste, o mesmo shell permanece montado, o conteúdo aguarda o snapshot, e a navegação executa um bootstrap e uma consulta dedicada de clientes, sem chamadas adicionais do skeleton. Falha de superfície e retry mantêm a navegação; verificação de sessão/bootstrap inicial continuam cobertos pelos testes de AppRoot. Suíte local: 3.886 testes aprovados, arquitetura/lint/build aprovados, com os avisos preexistentes. A revisão estática do ajuste não encontrou pendências. Conferência visual e CI/staging continuam vinculados ao SHA da publicação.
