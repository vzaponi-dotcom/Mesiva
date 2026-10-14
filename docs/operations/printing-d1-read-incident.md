# Incidente de leituras D1 na recuperação de impressão — 14/10/2026

## Causa e versão

Produção confirmada pela implantação d36a44ea-6af6-463c-88c4-de0c62ce05ae, versão 0260c3dd-8143-41fb-bf45-830f38b64305 (100%), publicada em 06/10/2026 pelo [deploy de e595f7ed](https://github.com/vzaponi-dotcom/Mesiva/actions/runs/37500850255).

Em `worker/orderPrintingRepository.js`, `agePrintJobs` é executado por `listPrintJobs` e pelo consumidor automático legado `claimNextAutomaticPrintJob`. A rota GET /api/printing/jobs chama a listagem. O manager global consulta jobs a cada 5 segundos (usePrintingManager); o painel PrintQueue consulta a cada 10 segundos enquanto aberto, além das atualizações após ações. O claim central atual usa outro repositório; seu polling de 2 segundos não executa agePrintJobs. Não há cron responsável por esta seleção. Abas/sessões multiplicam chamadas.

O EXPLAIN em produção confirmou `SEARCH print_jobs USING INDEX print_jobs_parent_history_idx (business_id=?)` e subconsultas correlacionadas `SEARCH a USING INDEX print_job_attempts_business_idx (business_id=?)`. O índice de tentativas por empresa/data não limita job_id: o otimizador varria tentativas da empresa para cada trabalho histórico, custo próximo de jobs × attempts. SELECT sem candidatos continua pagando as leituras; INSERT ... SELECT com zero linhas escritas não significa zero leituras.

Evidência fornecida pelo usuário para 08–14/10: INSERT 37.473 execuções/43,34 bilhões de leituras (96%); UPDATE relacionado 2,19 bilhões. Os totais de períodos/telas diferentes não devem ser somados. Em diagnóstico atual, as duas seleções completas, sem executar mutations, somaram 1.257.408 rows_read e 0 rows_written. O EXPLAIN isolado é somente leitura. `wrangler --file` agrega resultados via import; para planos/resultados por statement use `--command` com SQL em uma linha.

## Correção

Separar os candidatos seguros em dois ramos indexáveis por empresa/status. Buscar timeout primeiro nas tentativas expiradas ou unknown sem resolução, reunir com UNION ALL e deduplicar o resultado externo com DISTINCT. CROSS JOIN mantém os candidatos antes da busca do job por chave primária. UNION simples fazia o runtime D1 priorizar ordenação por job_id e escolher novamente um índice somente por empresa; o benchmark cobre essa regressão.

Migration 0042 cria somente `print_job_attempts_unresolved_status_idx` (empresa/status/data/job, parcial resolution IS NULL) e `print_job_attempts_job_lookup_idx` (empresa/job/número da tentativa). Não altera nem remove dados, índices existentes ou migrations anteriores. Criação tem custo único de leitura/escrita de índices; alterações futuras nas tentativas mantêm os dois índices. O bundle anterior continua compatível. Deploy aplica migration antes do novo bundle, pelo workflow e com bookmark automático D1.

Preservados: auditoria e mutations em um batch transacional, validação da estação na empresa, recuperação sem envio, segunda via, decisão humana após envio incerto, confirmação física, histórico e estados terminais. Nenhum reenvio automático de resultado desconhecido foi introduzido. O gate de upgrade aceita apenas os dois índices adicionais com SQL igual à migration revisada, preservando comparação exata do schema anterior e dos dados.

## Medição e validação

Reproduzir com `node scripts/infra/print-recovery-d1-benchmark.mjs` após disponibilizar Wrangler 4.128.0 no cache. O script usa D1/workerd efêmero, schema real e dados fictícios; não usa bindings/credenciais remotos. Valores são meta.rows_read, incluindo índices, e não estimativas de tempo ou tokens.

| Cenário | Antes | Depois | Escritas da seleção |
| --- | ---: | ---: | ---: |
| Fila sem histórico | 0 | 4 | 0 |
| 1.000 trabalhos e 1.000 tentativas completos, nenhum candidato | 1.002.000 | 8 | 0 |

Redução do segundo cenário: 99,9992%, 125.250 vezes menos leituras. Mede as duas seleções auditadas de recuperação, não o custo total de toda a API. Listagem, resumo e retenção continuam tendo seus próprios custos.

Regressões: fila vazia; histórico volumoso preservado; múltiplas tentativas expiradas deduplicadas; envio recente; unknown pendente/resolvido; prepared sem envio; segunda via; empresa estrangeira; tentativa expirada vinculada a terminal (auditoria mantida); polling concorrente/repetido; rollback de falha de auditoria e mutation. Os testes existentes verificam estações/recuperação/confirmação e HTTP. A suíte local revelou fixtures de sessões, reservas e retenção com datas já expiradas em 14/10; corrigidos somente seus relógios/expiração de teste. Um teste de UI travou na primeira execução concorrente e passou isoladamente. CI completo permanece gate obrigatório.

## Publicação e acompanhamento

Registro da preparação: correção na branch codex/d1-print-recovery, com produção em e595f7ed. O estado atual da publicação e os runs de CI/staging/produção constam no [PR #110](https://github.com/vzaponi-dotcom/Mesiva/pull/110). Não afirmar redução efetiva em produção antes de publicar e medir.

Seguir PR/CI → staging da branch com PR aberto → aceitação humana → merge → CI/staging do SHA master → Deploy production manual. Conferir versão ativa via deployments/versions e workflow, e repetir EXPLAIN/seleção somente leitura. Observar Insights/metrics por janela anterior/posterior ao deploy e por execução; não usar apenas o acumulado do ciclo, que inclui a carga antiga e tem atraso. Não criar dados fictícios em produção.

Painel do incidente: [D1 produção](https://dash.cloudflare.com/a1680026dac037c5e1bc997fbf3b48bb/workers/d1/databases/baa83769-4637-43f6-bf77-711f4f2ed069/metrics).
