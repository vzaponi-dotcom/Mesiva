# PR #120 — decisão de aceite funcional com acompanhamento de consumo

**Data:** 18/10/2026. **Decisão expressa pelo usuário:** “vamos aceitar então e ir acompanhando nos próximos dias o uso, o principal por agora é estar funcionando a opção de dar baixa no pagamento podendo selecionar uma data anterior”.

## Escopo deste aceite

- **Aceite funcional e de negócio para a data de recebimento retroativa**, inclusive o default de hoje e seleção de data anterior nos fluxos de baixa já cobertos, com preservação de data comercial, instantâneo técnico e reconciliação financeira. Não é autorização para alterar a regra de validação de datas ou os vínculos financeiros.
- **Aceite consciente do risco residual de custo**, com acompanhamento da conta Cloudflare após a disponibilização aos usuários. O gate histórico `monthlyReady=false`, a ausência de margem integral demonstrada e a amplificação de leituras de `loadSales` **não passam a ser PASS**: ficam explicitamente **RISK ACCEPTED FOR THIS RELEASE / MONITORAMENTO PENDENTE**. O teto/modelo vigente não é alterado para futuras entregas.
- **Impressão física/QZ permanece NOT EXECUTED / DEFERRED**, sem conversão em PASS; histórico de integridade da fila e ausência de reimpressão duplicada continuam úteis, mas não provam papel impresso. Manter verificação física futura, sem atribuir teste não feito.
- Esta decisão reconhece as evidências da [homologação autenticada em staging](2026-10-18-effective-receipt-staging-functional.md) (cinco caminhos PASS), [triagem visual/financeira](2026-10-18-effective-receipt-final-triage.md) e [auditoria de preservação da migration 0052](2026-10-18-effective-receipt-staging-deploy.md). A matriz local histórica permanece **13 PASS/2 BLOCKED técnicos**, agora com os dois riscos explicitamente aceitos/adiados — não se reescreve a matriz retrospectivamente.
- **Staging publicado** no SHA `68404745`, workflow `39097117765` SUCCESS; migrations e reconciliação histórica do staging PASS. O código executável dos commits documentais posteriores permaneceu inalterado até `23d49289`, cujo Validate `39142595552` foi SUCCESS.
- **Nenhum merge, deploy de produção, migration remota em produção ou mudança de plano Cloudflare foi realizado por esta decisão.** Integração e publicação em produção são ações distintas e exigem autorização específica posterior, CI verde do SHA exato de cada workflow e o runbook de produção com bookmark D1/rollback. A auditoria de staging **não substitui** pré-flight do D1 de produção.

## Acompanhamento nos próximos dias após a publicação em produção

Acompanhar diariamente no período inicial de sete dias (e reavaliar ao final), separando **uso medido** de **projeção** e identificando consumo de recursos não relacionados à PR. Nenhuma série de produção sob a feature é alegada enquanto não houver release produtivo.

| Dimensão | Evidência diária e comparação |
| --- | --- |
| D1 | `rows_read`, `rows_written` e tendência diária por banco/rotas de vendas/exportação, comparando baseline anterior e dias similares |
| Workers | requests, CPU faturável agregada e, onde disponível, por operação/rota; erros 4xx/5xx e latências |
| Durable Objects / R2 | requests, duração/GB·s e armazenamento/operações relevantes; anotar falta de dados em vez de lançar zero |
| Financeiro de negócio | pagamento normal e retroativo em produção, consistência `received_date`/`movement_date`, saldos/relatórios sem duplicação, sem inspecionar dados pessoais sem necessidade |
| Faturamento | consumo cobrável da conta/ciclo, estimativa revisada e diferença para histórico não causado pela PR |

Baseline observada pelo Codex em 18/10: Workers Paid US$5/mês **mais uso**; ciclo 08/10–07/11; painel mostrava US$20,15 de D1 cobrável acumulado e projeção automática de US$56,78 para o ciclo corrente, **incluindo histórico de incidente anterior, não atribuível a esta PR**. Em modelagem da feature, `loadSales` teve amplificação canônica de ~20.002 para 40.002 leituras com 10 mil recibos; a projeção operacional com relatórios aprovados foi ~9,772 bilhões de leituras/mês normal e ~16,101 bilhões degradado, **sem prova completa de CPU/DO/storage futuro**. Referências: [budget local e HTTP](2026-10-18-effective-receipt-cloudflare-budget.md), [triagem e painel](2026-10-18-effective-receipt-final-triage.md).

**Ação diante de aumento anormal:** comparar período/fonte/rotas, identificar possível concentração de recibos, registrar evidência, reavaliar custo projetado e priorizar correção com testes RED → GREEN se houver regressão. Não mudar tarifas, grants, scripts, banco ou serviço por conta do monitoramento; não presumir que o gasto histórico da conta é causado por esta feature. Se não houver acesso a métricas autenticadas, informar falta de acesso e solicitar somente os agregados necessários; não inventar valores ou alertas.

## Critérios pós-publicação

1. Validar login e baixa com data passada numa conta operacional autorizada, respeitando dados reais; garantir que hoje continue o valor padrão, futuro/impossível continue bloqueado e que nenhum recibo seja duplicado.
2. Acompanhar diariamente os agregados Cloudflare no início da operação e registrar variação/causa provável. A reavaliação deve registrar medidas reais, nunca converter hipótese em fatura.
3. Concluir teste de impressão física assim que estação Windows/QZ estiver disponível. Essa pendência **não** se transforma em PASS por aceite de risco.
4. Documentar qualquer incidente/rollback e alinhar código + schema. Seguir o [runbook da migration 0052](../../release-and-migration-runbook.md#migration-0052--data-efetiva-dos-recebimentos).

**Decisão de release:** aceite **funcional condicionado a monitoramento**, com risco financeiro residual conhecido e impressão física adiada. **Produção ainda não executada ou autorizada separadamente.**
