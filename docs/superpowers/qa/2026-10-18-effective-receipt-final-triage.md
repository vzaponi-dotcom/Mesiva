# PR #120 — triagem visual e orçamento após homologação funcional

**18/10/2026, America/Sao_Paulo. Código analisado: `759c55b2`; release de staging: `68404745`.** Os cinco caminhos de recebimento já passaram na [conferência funcional](2026-10-18-effective-receipt-staging-functional.md). Esta continuação não altera runtime, schema, plano Cloudflare ou dados financeiros. **Task 11 ainda sem aceite integral; orçamento mensal não aprovado.**

## Impressão física: decisão do usuário

O usuário informou: “a impressao fisica nao vamos conseguir testar, pode seguir com as proximas”. Resultado **NOT EXECUTED — adiada por decisão do usuário nesta rodada**, sem convertê-la em PASS. Isso permite continuar as demais verificações; não comprova saída física, não muda o runbook Windows/QZ e não autoriza produção. Permanecem válidas as evidências anteriores de integridade/fila, que não equivalem à confirmação de papel impresso.

## Triagem visual concluída

Foi reproduzido o `PaymentCompositionEditor` real da baseline `f44e10da` e da candidata em um harness Vite local, sem Worker/API e sem salvar pedidos/recibos. As importações relativas da cópia da baseline foram resolvidas para os mesmos componentes compartilhados; sua folha de composição foi obtida por `git show`. O editor recebeu duas alocações fictícias, Pix/R$10 e Dinheiro/R$8, total R$18. Foram reutilizadas as folhas `index.css`, `new-order.css`, `new-order-refined.css` e `system-select.css`, com tema visual Mesiva. O wrapper de checkout segue os mesmos breakpoints do produto; não é uma homologação de toda a aplicação.

**12 combinações reais:** duas versões × temas claro/escuro × larguras 390, 1.045 e 1.440 px. Em cada par, geometria dos métodos igual, sem overflow horizontal da página; o campo de data adicional coube no checkout. O viewport foi conferido no DOM, não inferido pelo tamanho da captura, e restaurado ao terminar.

| Largura | Método baseline / candidata, ambos os temas | Campo de data da candidata | Resultado |
| --- | --- | --- | --- |
| 390 px | 271 / 271 px | 301 × 44 px | Campo legível, métodos empilhados |
| 1.045 px | **55 / 55 px** | 239 × 44 px | Métodos comprimidos nas duas versões; data coube |
| 1.440 px | 98 / 98 px | 260 × 44 px | Geometria compartilhada preservada |

**Causa da observação anterior:** a coluna de checkout de 285 px, com padding e cards internos, combina-se à grade preexistente `minmax(0, 1.2fr) minmax(140px, .8fr)`. O método fica com 55 px e rótulos/seleção são comprimidos. O prefixo completo do CSS anterior é idêntico ao da candidata; a PR acrescenta regras de `.payment-received-date`. Wrapper, estilos base e `SystemSelect` também não mudaram. Portanto, **limitação visual preexistente reproduzida; não regressão causada por esta PR**. Não foi declarada aprovação desse layout nem feita alteração de CSS compartilhado nesta rodada.

Capturas: [baseline 1.045](evidence/task11-triage-baseline-1045-dark.png), [candidata 1.045](evidence/task11-triage-candidate-1045-dark.png), [mobile claro](evidence/task11-triage-candidate-390-light.png), [mobile escuro](evidence/task11-triage-candidate-390-dark.png).

**Teclado/validação no componente:** foco da data com contorno sólido de 2 px; navegação Tab alcançou os controles seguintes com foco visível; Enter abriu o seletor mobile e Escape fechou, devolvendo foco à `Forma de pagamento`. Uma edição nativa para data futura mostrou `aria-invalid=true`, `validity.rangeOverflow=true` e mensagem de erro, sem submit ([captura](evidence/task11-triage-mobile-date-error.png)). Recarregar o harness restaurou o valor válido. O `fill` programático isolado inicialmente mudou o valor DOM antes do evento nativo de alteração; a evidência de erro usa a edição por teclado efetivamente propagada ao React.

Houve timeout inicial do Vite iniciado na sandbox; o processo próprio foi encerrado e o Vite documentado foi iniciado fora dela. Capturas desktop finais usam viewport simples, com medidas conferidas antes/depois; uma captura exploratória `fullPage` inconsistente foi substituída. Somente os servidores/abas de harness criados pela tarefa foram encerrados. Não se apagou D1 ou servidor de outro chat. Harness/logs ficam em `.wrangler/`, fora do Git.

## Plano, ciclo e acumulado confirmados no painel

O usuário deixou o painel Cloudflare autenticado para consulta. Foram lidos Assinaturas, Uso faturável, Workers e Pages e Planos do Workers, sem editar plano, alertas, forma de pagamento, endereço ou permissões. A evidência conserva somente agregados e hash da conta `748b0258b295`; não publica tela de cobrança, e-mail, dados de pagamento, endereço ou documento de fatura.

| Dado observado no painel em 18/10 | Resultado |
| --- | --- |
| Workers | **Paid, US$5/mês + uso**, plano atual |
| R2 | Paid; renovação em 08/11/2026 |
| Ciclo aberto | **08/10 a 07/11**, renovação em **08/11**; rótulo de cobrança “Nov 2026” |
| Janela observada do painel | 08–18/10, 11 de 31 dias |
| D1 leituras no ciclo, arredondadas | **45,15 bilhões**, dos quais **20,15 bilhões faturáveis** |
| Uso cobrável acumulado | **US$20,15**, exclusivamente D1 na tabela observada |
| Projeção automática de uso do ciclo | **US$56,78**; extrapolação do painel, não fatura final nem projeção da candidata |
| Outras dimensões do uso faturável | D1 escritas 4,39 milhões; CPU Workers 8,68 milhões ms; requests 488,15 mil, sem excedente dessas dimensões |
| Workers e Pages, leitura posterior | requests 489,16 mil, CPU 8,69 milhões ms, **zero eventos de Observability**, zero minutos de build, US$0 de uso Workers |

Os valores mudam entre leituras e são arredondados pela interface; não são contadores exatos sincronizados. A soma dos componentes conhecidos base US$5 + uso acumulado US$20,15 é US$25,15 antes de ajustes/tributos, **não uma fatura fechada**. A meta de US$5 já não descreve este ciclo aberto. O período inclui o incidente de leituras anterior: não atribuir o acumulado à PR nem somá-lo ao modelo futuro como se fosse consumo adicional da candidata.

Metadados de produção/staging, somente configuração: `usage_model=standard`, `logpush=false`, zero tail consumers e `observability=null`. Isso não foi convertido em prova de custo futuro zero; o contador de eventos zero é a observação atual do painel, não previsão. Nenhuma linha de negócio de produção foi consultada. A API de assinaturas continua limitada por 403; a leitura autenticada resolveu a lacuna de plano/ciclo sem criar token ou ampliar acesso.

## Premissa de relatórios aprovada e modelo atualizado

O usuário aprovou **20 consultas de vendas + 10 CSV + cinco PDF por dia, até 10 mil recibos candidatos**. São acessos adicionais ao modelo operacional, que não tinha owners de relatórios/exportação. Reutilizando as medições autenticadas da [parte 3](2026-10-18-effective-receipt-cloudflare-budget.md), acrescentam **49.995.560 leituras, 16.120 escritas e 1.085 requests em 31 dias**, antes de CPU.

| Dimensão conhecida, operação + relatórios + baseline provisória de outros recursos | Normal | Degradado |
| --- | ---: | ---: |
| D1 leituras | **9.772.396.369,3** | **16.100.608.413,3** |
| D1 escritas | 16.274.624,3 | 16.837.180,3 |
| Requests Workers | 2.444.863 | 2.641.115 |

As frações vêm da extrapolação provisória de 30 para 31 dias de outros serviços; não representam fração de request/linha medido. Essas três dimensões conhecidas cabem nos limites Paid de 80% normal/100% degradado. **Isso não aprova o orçamento integral:** CPU faturável por operação da candidata, duração DO/crescimento de storage e previsão futura completa de staging/outros serviços continuam sem medição equivalente. O limiar médio ponderado de CPU da candidata seria aproximadamente **9,694 ms/request normal** para 20% de margem e **11,251 ms degradado** para a franquia inteira, descontada somente a baseline provisória de outros serviços. Esses são tetos calculados, não CPU observada. Não usar p50, tempo de download ou a média do painel como substitutos.

**`monthlyReady=false` permanece correto.** Plano, ciclo, acumulado, eventos de logs atuais e frequência de relatórios deixaram de ser incógnitas; o modelo futuro e a meta de custo não receberam dispensa. O teto mensal não foi alterado. Não foi consultado documento de fatura final; o painel mostra um ciclo ainda aberto. Um ensaio remoto com carga equivalente ainda precisa de plano limitado e autorização próprios; não publicar instrumentação nem gerar pagamentos para preencher essas lacunas por improviso.

Preços reconferidos em 18/10 nas fontes oficiais de [Workers/Logs](https://developers.cloudflare.com/workers/platform/pricing/), [D1](https://developers.cloudflare.com/d1/platform/pricing/), [DO](https://developers.cloudflare.com/durable-objects/platform/pricing/) e [R2](https://developers.cloudflare.com/r2/pricing/). A mudança de preço de logs anunciada para 01/12/2026 não pertence ao ciclo atual; projeções posteriores precisarão ser atualizadas.

## Resultado e verificações

[JSON sanitizado, métricas e cinco hashes](evidence/2026-10-18-effective-receipt-final-triage.json). Asserções de comparação visual, teclado, datas, somas e limites conhecidos: **PASS**. CI de `759c55b2`: [SUCCESS #39140999318](https://github.com/vzaponi-dotcom/Mesiva/actions/runs/39140999318). Nenhuma alteração funcional demanda novo RED → GREEN nesta rodada documental; a suíte de aplicação não foi repetida apenas para anexar evidências.

**Recomendação:** manter a PR aberta; recebimentos 5/5 PASS em staging e triagem da observação visual concluída, com limitação preexistente registrada. Impressão física não executada por decisão do usuário; orçamento integral e aceite final pendentes. A matriz histórica permanece 13 PASS/2 BLOCKED, com seus próprios ambientes/limites; não foi reclassificada como 15 PASS nem como certificação de dispositivos. Sem merge, nova migration, novo deploy ou produção.
