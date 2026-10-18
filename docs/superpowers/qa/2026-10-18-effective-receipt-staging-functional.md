# PR #120 — homologação autenticada em staging

**18/10/2026, America/Sao_Paulo. Release:** `68404745c7b47b2d2e4e31ece5f0812a1c3d3400`. **Resultado atualizado às 12:29 SP: cinco caminhos de recebimento PASS após a submissão de lote/comanda pelo usuário e conferência independente. Task 11 NÃO HOMOLOGADA.**

Continuação da [publicação controlada](2026-10-18-effective-receipt-staging-deploy.md). O usuário autorizou usar a senha salva e depois confirmou explicitamente que todos os dados de staging são fictícios, com liberdade para manipulá-los no QA. A credencial foi preenchida pelo navegador, sem leitura/publicação de senha ou cookie. Não houve criação de conta, reset de credencial, cópia de produção, merge ou deploy de produção.

## Release, sessão e evidências

**Continuação após os cinco caminhos PASS:** a [triagem visual e de orçamento](2026-10-18-effective-receipt-final-triage.md) confirmou a compressão preexistente dos métodos, validou o campo de data no harness em ambos os temas e confirmou plano/ciclo/acumulado no painel Cloudflare. Impressão física adiada pelo usuário nesta rodada, sem PASS. A investigação visual deixou de estar aberta; orçamento futuro integral e aceite seguem pendentes.

O login abriu **Conta Teste 1**. A aba havia sido aberta antes do deploy e ainda executava `index-CpKK1PnF.js`; o servidor já entregava `index-DQs4ZyWN.js` e o release correto. Foi descartado somente o rascunho de QA e recarregada a aba, antes de qualquer recebimento. O cliente fictício já salvo foi reutilizado; não foi duplicado. A sessão permaneceu válida na retomada por volta de 10:32 SP.

Foram observadas **137 respostas HTTP**, sem erro >=400 nem truncamento: `/api/auth/session`, `/api/bootstrap`, `/api/reporting/overview`, `/api/reporting/sales` e `/api/reporting/export-model` responderam **200**. A captura publica somente caminho/status, sem headers, cookies, payloads ou query strings. Essa amostra não mede frequência mensal, latência ou CPU por operação.

Resumo sanitizado e hashes dos nove anexos da primeira rodada: [`evidence/2026-10-18-effective-receipt-staging-functional.json`](evidence/2026-10-18-effective-receipt-staging-functional.json), preservado com seu estado histórico 3 PASS/2 BLOCKED. A [conferência posterior à submissão humana](evidence/2026-10-18-effective-receipt-staging-handoff.json) registra os dois caminhos adicionais PASS. A matriz anterior de [15 casos locais](2026-10-17-effective-receipt-task11-review.md#matriz-de-homologação-integral--15-casos) permanece **13 PASS / 2 BLOCKED**; não foi convertida em 15 PASS de staging nem integralmente repetida nesta rodada.

## Cinco caminhos de recebimento

| Caminho nesta rodada de staging | Resultado | Execução e conferência |
| --- | --- | --- |
| Checkout retroativo com split | **PASS** | #358, R$18, Pix R$10 + Dinheiro R$8, recebido em **17/10**, data comercial **18/10**. Um recibo, duas alocações/entradas. [Captura](evidence/task11-staging-checkout-split.png) |
| Complemento após salvar edição | **PASS** | #358 passou de R$18 para R$36. Novo recibo Pix de R$18 em **18/10**, original de 17/10 preservado e um `supplemental_payment`. Reimpressão opcional recusada. [Captura](evidence/task11-staging-supplement.png) |
| Avulso pela Cozinha | **PASS** | #359 salvo pendente e depois recebido em Pix, R$18 em **18/10**. Permaneceu em preparo. [Captura](evidence/task11-staging-order-payment.png) |
| Lote de cliente | **PASS — submissão pelo usuário** | #360/R$18 e #361/R$27, total R$45 Pix/17/10. Seletor sem campo de data; confirmação com campo único. Um recibo compartilhado, pedidos quitados e cliente sem saldo. [Resultado](evidence/task11-handoff-batch-paid.png); [formulário anterior](evidence/task11-staging-batch-ready.png) |
| Comanda | **PASS — submissão pelo usuário** | Mesa 7, comanda 59, #362/R$18 + #363/R$27. Um recibo de R$45 em **17/10**, Pix R$20 + Dinheiro R$25. Comanda `closed`, ambos quitados e mesa livre. [Resultado](evidence/task11-handoff-table-free.png); [formulário anterior](evidence/task11-staging-table-ready.png) |

Os seis pedidos são próprios da tarefa: cliente **QA Task11 Staging 18out** ou observação de item com esse prefixo na mesa 7. Pedidos/comandas anteriores não foram alterados. Os pedidos de mesa foram salvos pendentes e depois recebidos pelo usuário. Nenhuma confirmação bloqueada foi substituída por chamada de API ou escrita SQL.

Default **18/10** observado em checkout, avulso, complemento e comanda. Data futura **19/10** mostrou erro e desabilitou confirmar, sem gravar recibo ([captura](evidence/task11-staging-future.png)). Calendários impossíveis, virada UTC/DST, limite 100/101, RBAC negativo, timeout/replay/409 e troca de empresa mantêm a evidência local/automatizada anterior; não foram novamente simulados em staging nesta rodada. A base remota migrada não ficou com NULL legado para reproduzir DST ali.

## Reconciliação SQL e preservação histórica

Antes das duas confirmações pelo usuário, SELECTs restritos aos registros de QA conferiram o snapshot abaixo. O resultado atual está na seção de conferência após submissão humana.

- **Seis pedidos, R$144 em valor comercial**, todos em preparo. #358/R$36, #359/R$18, #360/R$18, #361/R$27, #362/R$18 e #363/R$27.
- **Três recibos, R$54**, quatro alocações e quatro entradas `order-payment`; somas e datas iguais ao recibo. R$18 em 17/10 e R$36 em 18/10. Dois pagamentos originais + um complemento; nenhum recibo duplicado.
- **R$90 pendentes nos registros de QA**: R$45 no lote e R$45 na comanda aberta 59. Os bloqueios da ferramenta não foram contados como recebimentos.
- Um job automático por pedido próprio, sem duplicação. Nenhuma reimpressão ou saída física foi solicitada pela tarefa.
- `PRAGMA foreign_key_check`: **zero violações**. A conferência final de dez statements leu 24.116 linhas/escreveu zero; inclui FKs e subconsultas de seleção diagnóstica, não é o custo de um endpoint da aplicação.

Os campos financeiros originais dos **195 recibos anteriores à migration** foram reconferidos por cutoff anterior aos testes e hashes ordenados. Continuam iguais à evidência pré-migration: 195 recibos/1.790.836 centavos; 287 pagamentos/1.777.436; 210 alocações/1.790.836; 222 movimentos/2.020.024. Esses escopos não são somas equivalentes entre tabelas. A conferência leu 1.218 linhas/escreveu zero. A nova coluna de data efetiva é intencionalmente excluída do hash dos campos originais.

Uma retomada da leitura recebeu recusa Cloudflare 7403; metadados/Time Travel e a repetição read-only passaram sem alterar permissões. O probe de comanda inicialmente usou `number` em vez de `tab_number`: a consulta foi corrigida após conferir a migration, e a execução válida passou. Essas falhas eram de acesso/probe, não regressões do produto; nenhuma evidência de execução falha foi apresentada como PASS.

## Relatórios e exportações

Snapshot de relatórios/exportações anterior à criação dos pedidos da comanda, aproximadamente 10:36–10:39 SP:

| Indicador da empresa fictícia, não somente QA | 18/10 | Comparativo de 17/10 |
| --- | ---: | ---: |
| Vendas comerciais | **R$144 / cinco pedidos** | R$257 / seis pedidos |
| Recebimentos por data efetiva | **R$36 / dois recibos** | **R$63 / dois recibos** |
| Entradas de movimentos | R$36 / duas entradas | R$63 / três entradas |

A visão geral e Vendas mostraram R$144 vendido e R$36 recebido hoje; mix de hoje Pix/R$36, sem incluir o split retroativo. O SQL agregado independente confirmou esses valores. A receber do período era R$90 e estornos do dia R$0 ([captura](evidence/task11-staging-report-today.png)). O relatório inclui registros fictícios anteriores de outros clientes; não atribuir todos os totais ao QA. A comanda foi criada depois desse snapshot, acrescentando R$45 comerciais/pendentes; isso não é divergência da exportação anterior.

- [CSV original](evidence/task11-staging-report.csv): baixado pelo navegador, coluna `Data(s) do recebimento`, quatro pedidos do cliente QA. #358 traz `2026-10-17 + 2026-10-18`, total/recebido R$36 e pendente zero; #359 recebido R$18 em 18/10; #360/#361 ainda pendentes. Bytes originais preservados pelas attributes.
- [PDF executivo](evidence/task11-staging-report.pdf): duas páginas, texto extraído e **ambas renderizadas/inspecionadas**, legíveis, sem corte; R$144 vendido/R$36 recebido/R$90 pendente. Não foi inferida correção visual apenas da extração de texto. A conclusão do download levou cerca de 51 s na chamada de automação; isso não isola latência do servidor nem CPU faturável.

Observação visual aberta: a captura de checkout em aproximadamente 1.045 px mostrou seletores de método estreitos/rótulos comprimidos na coluna lateral, embora data/valores fossem utilizáveis e o split tenha sido gravado corretamente. Não houve comparação visual equivalente com a baseline; não foi atribuída regressão a esta PR nem declarado aceite integral de responsividade. O diff de CSS da feature adiciona somente `.payment-received-date`; a limitação do layout compartilhado precisa de triagem própria. Tema/mobile completos não foram repetidos em staging. A inspeção visual do PDF passou independentemente disso.

## Métricas agregadas reais após a publicação

Cloudflare somente de leitura, janela **01:28:07–10:42:17 SP** em 18/10, exclusivamente recursos de staging:

| Dimensão | Observado |
| --- | ---: |
| D1 leituras / escritas | **659.361 / 2.309** |
| D1 queries de leitura / escrita | 9.005 / 1.473 |
| Requests Workers / erros | **306 / 0** |
| CPU Workers | **4.571,289 ms** (`cpuTimeUs / 1000`) |
| Invocações DO / erros agregados | 78 / 4 |
| Duração DO | **1,163735936 GB·s** |
| SQLite DO leituras / escritas | 48 / 24 |

Workers teve `sampleInterval≈1,0066`; demais métricas retornaram 1. A janela exclui os cinco minutos finais para reduzir efeito de ingestão. Inclui todo o tráfego de staging, outros acessos e auditorias D1 após a publicação, não exclusivamente esta sessão ou uma operação. Os quatro erros DO não foram diagnosticados como regressão da PR; não havia erros Workers nessa amostra. A captura HTTP e a janela de analytics têm limites/intervalos diferentes.

**Orçamento mensal continua BLOCKED / `monthlyReady=false`.** A amostra não demonstra CPU por operação sob carga equivalente, duração/storage em 31 dias, plano/ciclo/fatura/logs ou previsão de toda a conta. Não multiplicar a média agregada dessa janela pelos requests do modelo e declarar US$5 ou margem de 20% aprovados. A [parte 3](2026-10-18-effective-receipt-cloudflare-budget.md) mantém os limites do cenário concentrado. Nenhuma carga volumosa remota foi criada.

## Restrição da ferramenta e resolução pelo usuário

A revisão automática inicialmente rejeitou selecionar os dois pedidos e abrir “Receber selecionados”, classificando a ação como financeira. O código mostrou que essa etapa apenas prepara o formulário; sua abertura foi permitida depois da verificação, sem chamar o submit. **O clique final em “Confirmar recebimento” voltou a ser rejeitado**, mesmo após o usuário confirmar expressamente dados fictícios e autorizar a manipulação. Motivo informado: operação financeira persistente em staging exige que o usuário execute a submissão final.

Esse bloqueio vem da **revisão automática da ferramenta**, não da ausência de autorização do usuário nem de um defeito funcional constatado no lote. Não foi contornado trocando de ferramenta, chamando endpoints ou gravando recibos diretamente. A comanda foi preparada até a confirmação, sem tentar outra submissão equivalente rejeitada.

O usuário executou as duas submissões nas abas preservadas:

1. **Clientes:** lote #360/#361, R$45 Pix, data 17/10 — `Confirmar recebimento`.
2. **Comandas:** comanda 59/mesa 7, R$45 em Pix R$20 + Dinheiro R$25, data 17/10 — `Confirmar pagamento`.

### Conferência após submissão humana — 18/10, 12:27–12:29 SP

Na primeira retomada, apenas a comanda estava quitada; o lote ainda estava aberto na UI e ausente no D1. Isso foi informado ao usuário, que confirmou também o lote. Nenhum pagamento foi repetido pelo agente. A leitura final confirmou:

- **Comanda:** recibo único de R$45, `paid_at=2026-10-18T15:27:56.118Z`, `received_date=2026-10-17`, dois pagamentos de R$18/R$27 e duas alocações Pix/R$20 + Dinheiro/R$25. Comanda 59 `closed`, mesa 7 livre na UI.
- **Lote:** recibo único de R$45, `paid_at=2026-10-18T15:28:50.499Z`, `received_date=2026-10-17`, dois pagamentos de R$18/R$27 e uma alocação Pix. #360/#361 aparecem `Pago`, e o cliente está `Sem saldo`.
- **QA completo:** seis pedidos/R$144, cinco recibos/R$144, seis pagamentos originais + um complemento, sete alocações e sete entradas. **Saldo zero em cada pedido**; nenhum recibo duplicado e todos ainda `Em preparo`. Os três recibos e respectivos pagamentos/alocações/movimentos/complemento da primeira rodada foram comparados campo a campo e permaneceram iguais. FKs: zero violações.
- A leitura diagnóstica final de dez statements consumiu **24.179 linhas lidas/zero escritas**. O agregado financeiro independente consumiu **65/zero**; esses valores não são custo por rota da aplicação.
- **Relatório atualizado, empresa inteira:** vendas de 18/10 **R$189/sete pedidos**, recebido em 18/10 **R$36/dois recibos**, recebido em 17/10 **R$153/quatro recibos**; movimentos de entrada nos mesmos dias/valores. A UI mostrou esses totais e R$45 pendentes de outro pedido fictício, enquanto os seis do QA ficaram quitados. [Vendas](evidence/task11-handoff-report-today.png), [recebido/comparativo](evidence/task11-handoff-report-received.png). O CSV/PDF anterior é mantido como snapshot anterior à comanda; não foi reexportado nesta conferência.

Asserções de unicidade, vínculos, saldo, split, datas e preservação dos registros anteriores: **PASS**; [JSON e quatro hashes de capturas](evidence/2026-10-18-effective-receipt-staging-handoff.json). O CI documental anterior `db937498` também concluiu [SUCCESS #39133848777](https://github.com/vzaponi-dotcom/Mesiva/actions/runs/39133848777). Esta atualização não altera runtime/schema nem republica staging.

Os cinco caminhos de staging agora estão **5 PASS/0 BLOCKED de submissão**. A matriz histórica local continua 13 PASS/2 BLOCKED. Na continuação vinculada acima, triagem visual concluída com limitação preexistente registrada e impressão física adiada pelo usuário, sem PASS; orçamento futuro integral e aceite seguem pendentes. Não há aceitação da Task 11, merge ou produção.

## Validação documental

Asserções do resumo, reconciliação, CSV/PDF, hashes e captura de status HTTP passaram. O runtime, o schema e o workflow não foram alterados; não se repetiu a suíte de aplicação apenas para documentar esta rodada. O runbook foi melhorado para exigir atualização da aba e conferência do asset após deploy, evitando homologar com o frontend anterior. README/AGENTS/índice permanecem coerentes. Probes, renderizações e logs diagnósticos estão em `.wrangler/task11-*`, fora do Git.
