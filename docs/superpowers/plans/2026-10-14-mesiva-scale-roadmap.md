# Roteiro de custo e escala do Mesiva

Data: 14/10/2026. Solicitado pelo usuário: planejar as melhorias discutidas; código e publicação não iniciados.

## Resultado esperado

Operar o restaurante atual, com até cinco dispositivos, dentro das franquias do plano Workers Paid de US$ 5. Demonstrar o custo por operação e por empresa, manter pedidos/recebimentos/impressão confiáveis e reduzir a dependência entre custo e tamanho do histórico. O excedente já acumulado no ciclo atual permanece.

[Desenho de referência](../specs/2026-10-14-realtime-budget-design.md). Este roteiro ordena entregas; os dois planos vinculados abaixo são os documentos executáveis iniciais. Nenhuma etapa autoriza publicação automaticamente.

## Ordem das entregas

| Entrega | Resultado independente | Evidência para avançar |
| --- | --- | --- |
| 1. Leituras limitadas | API por IDs e TV buscando somente candidatos ativos, com índices e orçamento D1 no CI | Plans/rows_read no D1 real; histórico preservado; PR/CI/staging aceitos |
| 2. Atualização por eventos | Remoção dos polls globais de 5s e pedidos/TV de 2s enquanto o canal estiver saudável | Até cinco clientes sincronizados, recuperação/fallback e orçamento agregado aprovados |
| 3. Operação separada do histórico | Bootstrap/reconciliação carregando somente o escopo de cada superfície; histórico e relatórios consultados sob demanda | Matriz de consumidores/regras aprovada, equivalência funcional e leituras estáveis com histórico 10x maior |
| Evolução de capacidade | Distribuir dados e trabalhos quando os indicadores justificarem | Teste de carga identifica o gargalo e a solução melhora o indicador sem quebrar consistência |

### Entrega 1: consultas e orçamento

Executar o [plano de leituras limitadas](2026-10-14-operational-read-budget.md). PR único com API aditiva, índices e otimização da TV. Não alterar sincronização, frequência da estação ou políticas de retenção nessa entrega. As mudanças podem ser publicadas e medidas antes do WebSocket.

### Entrega 2: canal de avisos

Executar o [plano de sincronização por eventos](2026-10-14-realtime-budget.md), depois da primeira entrega. Um Durable Object por empresa/ambiente, hibernação, preparação autenticada e ticket de conexão de uso único. Mudanças operacionais geram avisos após commit; consumidores buscam somente o necessário. D1 e HTTP permanecem a autoridade.

Preservar os tickers de execução/spooler/recuperação. Poll temporário de pareamento da TV e relógios locais também permanecem. O heartbeat de telemetria atual entra no orçamento, sem emitir um aviso operacional a cada heartbeat.

### Entrega 3: operação e histórico

Esta etapa altera contratos de dados consumidos por várias superfícies; precisa de especificação e plano próprios antes de implementação. O objetivo aprovado para planejamento é limitar dados carregados, preservando todas as funcionalidades e históricos. Não cortar por uma janela arbitrária de dias.

A primeira tarefa dessa etapa produz uma matriz verificável de consumidores, contendo campos lidos, elegibilidade, filtros, ordenação, totals, seleção de pagamentos, efeitos de mutations e política de atualização. Pontos de entrada obrigatórios:

| Consumidor | Entrada | Política a preservar |
| --- | --- | --- |
| Cozinha/novo pedido | `Orders.jsx`, `NewOrder.jsx`, runtime de dados | Pedidos ainda operacionalmente relevantes, futuros agendados e capacidades efetivas |
| Histórico/detalhe | `OrderHistory.jsx`, `OrderDetail.jsx` | Busca/filtros/paginação, consulta de qualquer pedido e consumidores compartilhados |
| Clientes | `CustomersWorkspace.jsx`, `ClientRelationshipPanel.jsx` | Relação completa e totais corretos, sem calcular só a página carregada |
| Financeiro/recebimentos | `FinanceWorkspace.jsx`, `Receivables.jsx`, `src/app/workflows/payments/` | Todas as pendências elegíveis, inclusive antigas; comanda usa seu owner; valores e datas oficiais |
| Mesas/comandas/reservas | `src/domains/table-service/ui/` | Comandas abertas, reservas relevantes e efeitos cruzados com pedidos/financeiro |
| Relatórios | `ReportingWorkspace.jsx`, reporting API | Consultas por período e totais no servidor; detalhe/PDF com contrato atual |

Após aprovação da matriz, definir endpoints de snapshot por superfície e consultas históricas com cursor estável `(data,id)`, limite de página e filtros indexáveis. Endpoints legados continuam até migrar todos os consumidores. A distinção entre coleção parcial e completa deve ser explícita: ausência em uma página nunca significa excluir entidade.

Implementar por domínio, com testes de equivalência dos totais e workflows. Depois migrar entrada/reconciliação/fallback para snapshots operacionais. Crescimento do histórico não deve aumentar leituras da operação quando o número de candidatos ativos for igual. Nenhum dado será apagado para atingir esse resultado.

## Medição e critérios comuns

- Baseline: registrar SHA, consulta/rota, plano, rows_read/rows_written, quantidade de candidatos, requests e tempos. Comparar o mesmo fixture e a mesma carga, não janelas de produção com tráfego diferente.
- Ensaios: banco vazio, 10.000 pedidos históricos/50.000 itens, conjunto ativo fixo, cinco dispositivos, publicação falhando, reconexões e canal indisponível. Usar somente dados fictícios em local/staging.
- Projetar um mês de 31 dias, 12h/dia, cinco dispositivos e 5.000 mudanças/dia; esses volumes são hipóteses de carga. Computar o custo de leitura por ID, snapshots, atribuições, impressão, identidade, renewals, logs e armazenamento.
- Meta normal: pelo menos 20% de margem em cada franquia aplicável. O cenário degradado também precisa ficar abaixo da franquia ou receber ajuste antes de habilitar o canal. Não somar franquias de serviços distintos nem presumir que existem só recursos Mesiva na conta.
- Métricas por rota/empresa com agregação e logs amostrados, sem payloads, cookies, tickets ou tokens. Medir atraso entre commit e atualização, falhas de publicação, frequência de fallback, conexões ativas e excesso de leituras por operação.
- Ociosidade deve eliminar as consultas globais de dois/cinco segundos depois da entrega 2, contabilizando separadamente verificações que continuam por segurança/execução.
- Alertas e revisão do orçamento antecipam excedentes; não interromper venda, recebimento ou impressão automaticamente.

## Capacidade futura: critérios de decisão

- Manter os módulos e owners atuais, com contratos claros entre domínios. Evitar nova infraestrutura sem um gargalo medido.
- Distribuição D1 por empresa/grupo: avaliar quando latência p95, sobrecarga, armazenamento ou concentração de consultas de uma empresa prejudicarem outras. Medir capacidade sustentável e manter pelo menos 20% de margem; número de restaurantes sozinho não é gatilho suficiente. Separar identidade global dos dados operacionais exige desenho próprio de roteamento, migrations, restore e isolamento.
- Réplicas de leitura: considerar para latência/throughput de leituras, depois de classificar as rotas e adaptar consistência com Sessions/bookmarks. Não supor que réplica elimina rows_read ou que rotas que escrevem assertions de sessão se tornam read-only automaticamente.
- Journal/outbox: acrescentar quando houver obrigação de entrega/reprocessamento de uma integração ou efeito assíncrono crítico. Avisos visuais continuam recuperáveis por snapshot; impressão física mantém a decisão humana para resultado desconhecido.
- Cache: começar por catálogo/configurações versionados por empresa e escopo de autorização, quando a medição justificar. Preservar validação no servidor e invalidação/revogação; não tornar cache autoridade de preços ou permissões.

## Publicação e revisão

Cada entrega: branch própria atualizada, PR com objetivo único, suíte CI completa, gates afetados, staging do SHA exato, aceite humano, merge, CI/staging da master e autorização explícita de Deploy production. Incluir branches exatas na elegibilidade de staging, sem permitir qualquer branch genericamente. Preservar o bookmark D1 automático antes de migrations.

Após uma publicação autorizada, confirmar versão ativa e acompanhar uso real comparável. O acompanhamento do incidente D1 já agendado para 15/10 às 10h de São Paulo continua separado; não afirma que a nova arquitetura estará publicada nessa data.

## Revisão do plano e execução

Recomendação: execução nativa nesta sessão, tarefa por tarefa, com uma revisão independente ao final de cada entrega. Essa opção reduz o custo de contextos e mantém interfaces dependentes sob um único implementador. A alternativa é implementação e revisão por agentes distintos a cada tarefa, com maior custo.

O usuário deve revisar os planos e escolher o método antes de iniciar código. Aprovar o plano não substitui homologação e autorização de produção para as entregas resultantes.
