# PR #120 — revisão e homologação local da Task 11

**17/10/2026, America/Sao_Paulo. Recomendação: NÃO LIBERAR staging; Task 11 NÃO HOMOLOGADA.**

**Continuação autenticada em 18/10:** [sessão/bootstrap, checkout split, avulso, complemento e relatórios/exportações PASS](2026-10-18-effective-receipt-staging-functional.md) no release `68404745`. Lote de cliente e comanda preparados, mas a revisão automática da ferramenta exige a submissão final pelo usuário mesmo após sua autorização explícita para dados fictícios. Isso supera a pendência de login citada no registro de publicação abaixo; orçamento integral/impressão física e aceite da Task 11 seguem pendentes.

**Atualização posterior em 18/10:** o usuário autorizou a [publicação controlada em staging](2026-10-18-effective-receipt-staging-deploy.md), SHA `68404745`, workflow #39097117765 SUCCESS. A 0052 datou 195/195 recibos, preservou os campos financeiros originais e passou em FKs/índice. A recomendação de não publicar registrada em 17/10 descreve aquela rodada; staging agora está publicado. Homologação autenticada aguarda acesso; orçamento integral e impressão física seguem pendentes, sem aceite da Task 11 ou liberação de produção.

PR [#120](https://github.com/vzaponi-dotcom/Mesiva/pull/120), branch `codex/received-date-tdd`.
Baseline do diff: `f44e10da3e523d757dc0a9ceffe575d4331907e0`; HEAD recebido: `cd0e2291f65fa1850c53877411f177229a1c0f4c`.
Correções de código: `d94f1d101618ba9de4467e55aef20e110f40a472` e `ef1d9ae720aaccc4b6a86a16e297776bc08fbdff`.
O commit que acrescenta este relatório altera somente documentação/evidências. O resultado do CI deve corresponder ao HEAD da PR; um run de um SHA anterior não autoriza publicação.

**Fechamento documental em 18/10/2026:** correções, matriz e 20 artefatos de evidência enviados ao GitHub. Pacote `36e477987d19cdb602d5b08709e2aba04aac7fab` aprovado em [Validate #39092051011](https://github.com/vzaponi-dotcom/Mesiva/actions/runs/39092051011), com oito shards e `validate` SUCCESS. Os 20 hashes SHA-256 foram conferidos contra os bytes versionados, incluindo CSV original e PDF. Atualizações documentais posteriores não alteram o código `ef1d9ae7`; qualquer publicação futura continua exigindo CI do HEAD exato e resolução dos bloqueios abaixo.

**Matriz local dos 15 casos: 13 PASS, 0 FAIL remanescente, 2 BLOCKED, 0 PENDING.** Os cinco caminhos foram exercitados no navegador, com fronteiras adicionais automatizadas discriminadas abaixo. Q11-12 continua bloqueado pelos pré-requisitos remotos e Q11-15 pela impressão física. Não houve migration remota, staging, merge ou produção; o aceite integral da Task 11 permanece pendente.

**Atualização de 18/10:** [auditoria histórica remota somente de leitura executada](2026-10-18-effective-receipt-staging-audit.md): 195 recibos com consenso, zero bloqueadores técnicos, apenas 0052 pendente; 1.671 linhas lidas e zero escritas. O plano de transição dos 195 consensos ainda requer aceite humano. Restore, orçamento e impressão física continuam pendentes. O JSON da rodada local preserva o estado anterior a essa auditoria; a nova evidência remota está no documento vinculado.

**Parte 2 em 18/10:** [recuperação verificada](2026-10-18-effective-receipt-d1-recovery.md), com bookmark de staging obtido, restore e undo reais em D1 descartável e exclusão desse banco. Snapshots fictícios e repositórios financeiros reais confirmaram os pares de código/schema compatíveis e os limites de rollback. Staging não foi restaurado nem migrado. Exigir checkpoint fresco na janela real; orçamento, aceite do plano histórico e impressão física seguem pendentes.

## Escopo e ambiente

Revisado o diff completo de 72 arquivos, incluindo testes, documentos e workflows, com segunda revisão independente somente leitura. Acompanhados os consumidores dos cinco caminhos de recebimento, projeções, fechamento da comanda, edição/complemento, movimentos, relatórios e exportação. As duas correções acrescentadas foram revisadas novamente.

Windows, Node `22.23.2`, npm `10.9.8`, dependências do lockfile via `npm ci`; nenhuma dependência atualizada. Vite em `http://127.0.0.1:4173`, Worker em `http://127.0.0.1:8787`, D1 isolado em `.wrangler/task11-state`. Foram aplicados **56 arquivos de migration, até 0052**, sem apagar/recriar estado existente. Fixture derivada de `worker/test-support/tenancyDb.js`, com duas empresas fictícias `company-A` e `company-B`, produto de R$25 e cliente fictício. Credenciais e sessões não fazem parte das evidências publicadas.

## Defeitos encontrados e correções

| Achado | Reprodução RED | Correção e GREEN |
| --- | --- | --- |
| Pré-flight aceitava data financeira impossível por verificar apenas `GLOB`, inclusive `2026-02-30` e mês 13 | `Missing expected rejection: impossible` em SQLite real | Roundtrip de calendário SQL para `received_date` e `movement_date`; nova classificação `BLOCKED_invalid_received_date` |
| Pré-flight aceitava timestamp sem horário válido; fallback também aceitava offset/formato SQL que o filtro textual UTC do relatório não interpreta corretamente | `Missing expected rejection: offset`; probe: `2026-10-17T00:30:00-03:00` entra no dia 16 e não no 17 | Exigir o formato UTC canônico gerado por `toISOString()` nos recibos que dependem de fallback; formato diferente bloqueia revisão histórica, sem reescrever dados |
| SQLite preserva `24:30`, mas `new Date` é inválido e a série financeira pode lançar `RangeError` | `Missing expected rejection: hour` | Hora limitada a `00`–`23` |
| Recibo pós-0052 ainda NULL com consenso de movimentos escapava à validação de timestamp | `Missing expected rejection` com recibo/allocação/movimento reais | Validar também consenso ainda NULL; data financeira já canônica dispensa esse fallback |

Os seis testes de pré-flight ficaram GREEN, incluindo compatibilidade de schema imediatamente antes/depois de 0052. A preparação inicial de uma fixture sem alocação foi corretamente rejeitada pelo trigger `SPLIT_PAYMENT_MOVEMENT_REQUIRED`; a fixture foi corrigida antes de registrar o RED de comportamento. Não houve enfraquecimento de triggers, FKs, permissões ou gates.

**Limite deliberado:** os leitores não passaram a aceitar formatos legados arbitrários. O pré-flight agora exige revisão desses formatos antes do cutover. Qualquer normalização/backfill de dados históricos exige procedimento próprio, restauração verificável e decisão autorizada.

## Verificações automatizadas

| Comando/gate | Evidência |
| --- | --- |
| CI do HEAD recebido `cd0e2291` | [Validate #39071489063](https://github.com/vzaponi-dotcom/Mesiva/actions/runs/39071489063): SUCCESS, 8/8 shards e validate |
| CI do código corrigido `ef1d9ae7` | [Validate #39073109702](https://github.com/vzaponi-dotcom/Mesiva/actions/runs/39073109702): SUCCESS, 8/8 shards e validate |
| CI do pacote de evidências `36e47798` | [Validate #39092051011](https://github.com/vzaponi-dotcom/Mesiva/actions/runs/39092051011): SUCCESS, 8/8 shards e validate; mesmo código executável |
| `npm test -- --test-reporter=spec --test-concurrency=4` | **4.116 PASS**, zero falhas, cancelamentos ou skips em **273,2 s**, no commit de código final `ef1d9ae7` |
| `node --test` pré-flight + production safety + validação de data + migration/upgrade/reconciliação | **32 PASS**, zero falhas/skips no código final; pré-flight isolado: **6 PASS** |
| `npm run test:architecture` | PASS |
| `npm run lint` | Exit 0, com avisos existentes; não significa ausência de warnings |
| `npm run build` | PASS; aviso existente de chunks >500 kB, `AdminBootstrap` ~1,59 MB antes de gzip |
| `npm run d1:migrate:local -- --persist-to .wrangler/task11-state` | PASS; 56 migrations, até 0052 |
| Wrangler `4.128.0 deploy --dry-run`, padrão e `--env staging` | PASS; sem publicação |
| `node scripts/infra/spec-b-d1-gate.mjs` | PASS; clean/upgrade, concorrência, rollback, histórico e preservação da impressão |
| `node scripts/infra/print-recovery-d1-benchmark.mjs` | PASS |
| `node scripts/infra/operational-read-d1-benchmark.mjs` | PASS |
| `node scripts/infra/effective-receipt-date-d1-gate.mjs` | PASS; métricas abaixo |
| `node scripts/infra/operation-profile-d1-gate.mjs` | PASS; clean/upgrade e FKs |
| `node scripts/infra/company-management-d1-gate.mjs` | PASS; 2 testes |
| `node scripts/infra/order-editing-d1-gate.mjs` | PASS; upgrade de 0041, clean, idempotência, FKs e imutabilidade |
| `node scripts/infra/realtime-runtime-gate.mjs` | PASS funcional; orçamento mensal continua `monthlyReady=false` |
| `git diff --check` | PASS |

A primeira execução de `npm test` na sandbox travou depois de falhas de timeout nos testes que iniciam Vite. Foi interrompida e repetida fora da sandbox, com concorrência 4: 4.115 PASS em 256,4 s. Uma repetição no SHA intermediário foi interrompida por ter sido superada pelo ajuste de hora/consenso; não é evidência de aprovação. Logs completos ficam em `.wrangler/task11-evidence/`, fora do Git. As alterações de código finais afetam somente o pré-flight; frontend, Worker, schema e queries são os mesmos usados nos gates e probes HTTP/D1 desta rodada.

## Evidências funcionais locais

Requests HTTP autenticados contra o Worker real, com origem/contexto/cookie oficiais, comprovaram login e bootstrap 200, além dos cinco caminhos de pagamento. Os asserts do probe conferiram default do dia SP, data comercial preservada, split, comanda fechada, saldo complementar zero, replays com mesma identidade de recibo e conflitos por data diferente. Não são testes de interação visual.

Na execução final do probe HTTP:

- Checkout split: pedido `e863baa1-0f23-4ebd-bbde-e6a5441f8909`; recibo `4a68ea1f-2717-45fd-a663-d59d49ea4f35`, data `2026-10-16`, Pix 1.500 + Dinheiro 1.000 centavos; `paid_at=2026-10-17T21:53:30.456Z` preservado.
- Complemento desse pedido: recibo `d075e00e-8b82-4586-9f99-b461e6571694`, data `2026-10-17`, 2.500 centavos; ambas as datas constam no detalhe e no modelo de exportação (`2026-10-16 + 2026-10-17`).
- Comanda `22a8d493-6197-4883-9611-323af40655d1`, dois pedidos: recibo `acd33e3c-ea96-44f8-be2e-f786e781cc85`, 5.000 centavos, data `2026-10-16`, encerramento oficial `closed`.
- Operador da B sem grant persistido `payments.receive`: POST de pagamento **403**. Relatórios sem `reports.view`: **403**. Gestor da B consultando pedido da A: **404**; recebimentos da B: zero.
- Datas futura, impossível, vazia e com hora: **400**. Reentrada de pagamento avulso: **409**. Lote e complemento repetidos mantêm recibo; mesmo `mutationId` com data alterada: **409**. Lote com 101 IDs: **400**.

As tentativas sucessivas do probe criaram pedidos novos com chaves diferentes, sem reset do banco. O snapshot **anterior à rodada visual** era de 20 recibos e 65.000 centavos: 50.000 recebidos em 16/10, 15.000 em 17/10 e estorno `order-refund` de 2.500 em 17/10. Auditoria nessa etapa: `canonical=20`.

Saldo inicial fictício de R$100 em 17/10: `currentBalance=225`, `receivedToday=125`, histórico global `entries=650`, `exits=25`, `balance=625`. Os R$500 retroativos permanecem no histórico e ficam fora do saldo após abertura. Evidência temporal do probe de saldo: 17/10 às 18:57:29 SP.

### Rodada real de navegador

Após reiniciar as instâncias próprias conforme o README, o navegador integrado alcançou a aplicação. O timeout inicial e a interrupção do Computer Use Windows deixaram de impedir o trabalho; o teste foi realizado no navegador integrado, sem contornar o bloqueio do Chrome Windows. Todos os pagamentos abaixo usam o código `ef1d9ae7`, empresas fictícias A/B e a persistência isolada existente. A operação dos pagamentos e exportações ocorreu aproximadamente entre 19:04 e 19:18 SP; a conferência final das leituras ocorreu às 23:50–23:55 SP de 17/10.

- A#25: checkout pago com default 17/10. A#26: checkout retroativo em 16/10, Pix R$15 + Dinheiro R$10. Um campo por recibo, total R$25, preparo independente.
- A#27: Cozinha, timeout injetado antes da resposta, escolha 16/10 mantida, retry confirmado. A#28: Histórico após finalizar preparo. A#29: A Receber. Todos quitados pelo diálogo oficial.
- Comanda 3, A#34/#35: split Pix R$30 + Dinheiro R$20, data 16/10, total R$50; comanda encerrada e mesa livre. Cliente A#30/#31: seleção de dois pedidos sem campo de data, confirmação com um campo, mesmo split e total, ambos quitados.
- A#32: edição de R$25 para R$50, salvar e receber complemento no modal. A#33: salvar edição, escolher Agora não e receber posteriormente pelo detalhe. Cada complemento R$25 em 17/10, original preservado em 16/10. Drawer do relatório mostra ambas as datas e saldo zero.
- Amanhã 18/10 e vazio bloquearam confirmação; ontem foi aceito. Cancelar/reabrir voltou ao default 17/10. Datas impossíveis/datetime são cobertas no Worker e no workflow; o controle nativo de data não permite digitar livremente um calendário impossível.
- A#25 foi cancelado pela UI com devolução Pix de R$25 em 17/10. A tela de saldo inicial manteve R$100/data 17/10; a abertura desse diálogo foi cancelada sem alteração.
- Duas sessões independentes: A#36 aberto para pagamento em ambas; ao confirmar em uma, a outra fechou o diálogo sem reload e F5 manteve o pedido pago. Para WebSocket real foi usado o SPA servido pelo Worker em `http://localhost:8787/pedidos`, opção documentada no README. O proxy Vite não encaminha upgrade WebSocket; não se atribui a ele a convergência imediata observada.
- A#37: resposta HTTP 201 foi retida por interceptação de rede após commit; a sessão foi trocada para B em outra aba do mesmo contexto. Liberada a resposta, a UI permaneceu na B, somente com B#1, sem aplicar o retorno da A. A interceptação foi removida ao encerrar o teste.
- B operador sem `payments.receive`: detalhe de B#1 sem ação de recebimento; tentativa HTTP 403. Relatórios sem grant redirecionaram com aviso de acesso negado. Ao alternar, dados da A não apareceram na B; gestor B consultando pedido A recebeu 404.
- Desktop 1280×900, mobile 390×844, claro/escuro, label/erro, foco visível, teclado/Escape e cancelamento conferidos. Mobile: largura útil/scrollWidth 375/375, sem overflow horizontal. Preferência escura e viewport normal restaurados. Reimpressões opcionais foram recusadas; não houve teste de saída física.

Legado DST: fixture `task11-dst-receipt`, NULL e sem movimento de propósito, `paid_at=2018-12-01T02:30:00.000Z`, R$1. Em `/relatorios?view=sales&period=custom&from=2018-12-01&to=2018-12-01`, a UI mostrou vendas R$0 e recebimentos R$1; a data comercial é 30/11. A Receber/quitados mostrou 01/12/2018. Esse instante corresponde ao horário de verão de São Paulo (UTC−2), não a UTC−3 fixo. A virada UTC/SP para o default foi validada por testes determinísticos, sem alterar o relógio do sistema.

Exportação efetiva às 19:12: [CSV](evidence/task11-report.csv) contém a coluna `Data(s) do recebimento` e `2026-10-16 + 2026-10-17`. [PDF](evidence/task11-report.pdf) foi baixado, extraído e renderizado: duas páginas inspecionadas visualmente, sem corte, recebido R$225. Nesse momento vendas eram R$925; depois foram criados #36/#37 e as vendas passaram a R$975. São snapshots sucessivos, não divergência de total.

### Reconciliação final após navegador

SQL D1 final: **34 recibos, 102.600 centavos**, sendo 33 canônicos e um legado NULL intencional de R$1 sem movimento. Entradas modernas: **R$800 em 16/10 + R$225 em 17/10 = R$1.025**; saídas `order-refund`: **R$50 em 17/10**. Dashboard mostrou recebido líquido hoje **R$175**; Movimentações mostrou entradas **R$1.025**, saídas **R$50**, saldo **R$975**. O R$1 legado aparece no relatório de 2018 e não foi inventado um movimento retroativo para ele.

SQL conferiu **zero** divergências entre recibo/alocações, datas/valores dos movimentos existentes, pagamentos duplicados por pedido, jobs automáticos duplicados e violações de FK. Empresa B permaneceu sem recebimentos. A primeira tentativa de leitura pelo Wrangler com o Worker ativo falhou internamente; pausando somente o Worker desta tarefa, a mesma consulta passou. O Worker foi reiniciado com a mesma persistência, sem reset, e bootstrap/leituras voltaram a 200.

## Matriz de homologação integral — 15 casos

**PASS é local e não autoriza staging ou aceite humano. BLOCKED significa que faltam critérios do caso completo.** Ambiente: Windows, navegador integrado, HTTP/D1/workerd local, empresas fictícias A/B; desktop/mobile simulado, temas claro/escuro. Todos os testes visuais usam `ef1d9ae7`. Fronteiras que não foram repetidas manualmente são identificadas expressamente.

| ID | Resultado integral | Executado / evidência técnica | Critério ainda bloqueado |
| --- | --- | --- | --- |
| Q11-01 | PASS | A#25, campo único/default 17/10 e confirmação; [checkout](evidence/task11-checkout-default.png), HTTP e SQL | — |
| Q11-02 | PASS | A#26, 16/10, Pix 1.500 + Dinheiro 1.000 centavos, um recibo; [split](evidence/task11-checkout-retro-split.png) | — |
| Q11-03 | PASS | A#27 Cozinha, #28 Histórico, #29 A Receber; confirmação retroativa, quitados e 409 na reentrada; [timeout/retry](evidence/task11-payment-timeout.png), [quitados](evidence/task11-paid-list.png) | — |
| Q11-04 | PASS | Comanda 3/#34/#35, split/data única, quitação R$50 e mesa livre; [comanda](evidence/task11-table-split.png), SQL | — |
| Q11-05 | PASS | A#30/#31 via UI; seleção sem campo, split R$50; [lote](evidence/task11-client-batch.png). Limite exato 100 em SQLite real automatizado (`worker/clientReceivablesPayment.test.js:408`), 101 HTTP 400; replay/data divergente 409. Não houve seleção manual de 100 | — |
| Q11-06 | PASS | A#32 modal e #33 após salvar, complemento R$25 em 17/10/original 16/10; [complemento](evidence/task11-supplement.png), [drawer](evidence/task11-report-drawer.png), SQL | — |
| Q11-07 | PASS | Futuro/vazio bloqueados na UI, ontem/hoje aceitos, erro mantém escolha e reabertura reseta; [erro mobile](evidence/task11-mobile-dark-invalid.png). Impossível/datetime no Worker e teste de workflow | — |
| Q11-08 | PASS | Legado DST real na UI com recebido R$1 em 01/12/2018; [DST](evidence/task11-dst-legacy.png), quitados. Default próximo da virada UTC/SP por testes determinísticos; relógio físico não alterado | — |
| Q11-09 | PASS | Dashboard líquido R$175, quitados com data 16/10/registro 17/10, movimentos entradas R$1.025/saídas R$50; [dashboard](evidence/task11-finance-final.png), [movimentos](evidence/task11-movements-final.png), SQL | — |
| Q11-10 | PASS | Séries/mix de vendas e financeiro conferidos, drawer por recibo, [CSV](evidence/task11-report.csv) e [PDF](evidence/task11-report.pdf) baixados/renderizados | — |
| Q11-11 | PASS | A#25 cancelado com estorno Pix real R$25 em 17/10, saldo inicial R$100 preservado, exclusão do retroativo na leitura após abertura; movimentos e SQL | — |
| Q11-12 | BLOCKED | Clean/upgrade/FKs/índice/custo local PASS; staging auditado: 195 consensos sem bloqueadores técnicos; recuperação verificada em descartável, com compatibilidade local e bookmark de staging | Aceite do plano histórico e orçamento; checkpoint fresco obrigatório antes da migration real |
| Q11-13 | PASS | Alternância UI A→B, B#1 sem receber, reports com aviso de acesso negado, dados da A ausentes; HTTP 403/404; [contexto B](evidence/task11-late-context.png) | — |
| Q11-14 | PASS | #27 timeout/retry, #36 duas sessões/WebSocket/F5, #37 resposta 201 tardia após troca de empresa descartada; [contexto](evidence/task11-late-context.png). Replay/409 e fallback nos probes/testes/gate | — |
| Q11-15 | BLOCKED | Desktop/mobile, claro/escuro, label/erro/foco/teclado/Escape/cancelamento e ausência de jobs duplicados PASS; [escuro](evidence/task11-mobile-dark-invalid.png), [claro](evidence/task11-mobile-light.png) | Impressora/QZ/spooler/saída física não disponíveis nesta rodada |

As capturas e snapshots textuais do navegador estão em `evidence/task11-*`. Os IDs completos e a reconciliação agregada estão no JSON sanitizado. Não foram publicados cookies, senhas, tokens, headers de sessão ou dados de produção.

## Performance, banco e segurança

O índice parcial `(business_id, received_date, id)` foi confirmado no plano D1; o braço legado usa `(business_id, paid_at)`. O gate oficial repetiu **2 → 5 rows_read** na query isolada antes/depois, estável de 1k para 10k históricos fora do período; fallback DST também **5 → 5**, sempre 1 query/zero escritas. Índice sobre 1k registros: DDL **1.518 reads/504 writes**; inserção sintética de 1k históricos, 50% NULL: **4.000 → 4.500 writes**. Não aplicar essa taxa a recibos novos 100% datados.

Foi medido também o cenário ausente da Task 10, usando o `loadSales` real e D1/workerd:

| Perfil sintético no período | Recibos | Resultado financeiro | SQL requests | rows_read | rows_written |
| --- | ---: | ---: | ---: | ---: | ---: |
| NULL concentrados no dia consultado | 1.000 | 1.000 recibos | 5 | 2.004 | 0 |
| NULL concentrados no dia consultado | 10.000 | 10.000 recibos | 5 | 20.004 | 0 |
| Canônicos: `paid_at` no dia consultado, `received_date` no dia anterior | 1.000 | 0 recibos | 5 | 2.004 | 0 |
| Mesmo perfil canônico | 10.000 | 0 recibos | 5 | 20.004 | 0 |

O segundo braço ainda lê candidatos do índice `paid_at` antes de descartar os não NULL. Não há N+1 novo, mas há crescimento linear dentro do período, inclusive quando nenhum recibo é financeiramente elegível. **Orçamento de liberação não demonstrado**: não há limite aprovado para esse perfil, métricas do endpoint completo/autenticação/exportações em staging, CPU/duração, armazenamento ou baseline da conta. O gate de realtime confirma comportamento, mas retorna `monthlyReady=false`. Não há projeção de custo mensal ou folga financeira nesta evidência.

Revisão não encontrou regressão nova de tenant/RBAC, confiança em preços do cliente, transações, replays, timestamp técnico ou multiplicação de recibos compartilhados. A migração é aditiva; divergência de movimentos permanece NULL e exige revisão explícita. Não foi modificada migration aplicada. O escopo não inclui auditoria global do repositório nem certificação de segurança.

`npm audit` registrou **4 avisos preexistentes**, com lockfile inalterado: `source-map-js` high (via Vite/PostCSS, tooling de build), `uuid`/`exceljs` moderate, `dompurify` low (via jsPDF). Isso requer triagem própria; não foi aplicado `npm audit fix` ou upgrade fora do escopo. O lint também contém avisos existentes de React/hooks e unused vars.

## Bloqueios antes de staging

| Pré-requisito | Estado nesta rodada |
| --- | --- |
| Dados fictícios na homologação local | Confirmado; nenhuma cópia de produção |
| Auditoria agregada histórica **do D1 de staging** pré/pós-0052 | **PASS técnico** em 18/10: 195 consensos antes e 195 canônicos depois, zero conflitos/datas inválidas/valores divergentes, hashes financeiros preservados |
| Recibos contraditórios, sem movimentos ou consenso ainda NULL | Zero contraditórios/sem movimentos; backfill dos 195 consensos executado pela 0052 na publicação autorizada; zero NULL restante |
| Lista de migrations pendentes no D1 remoto | **EXECUTED** por SELECT: 56 aplicadas após o workflow, nenhuma pendente |
| Restore D1 Time Travel/bookmark e compatibilidade do bundle/schema | **MÉTODO VERIFICADO COM LIMITES** em 18/10: bookmarks de staging, restore/undo em descartável e compatibilidade financeira local. Staging não restaurado; checkpoint fresco obrigatório na janela real; workflow não o registra automaticamente |
| Orçamento por rota e cenário concentrado em staging | **BLOCKED**; [parte 3 em 18/10](2026-10-18-effective-receipt-cloudflare-budget.md) mediu conta, A/B e HTTP/exportações locais; projeção D1 9,701/16,029 bilhões. CPU/plano/ciclo/logs e limites representativos incompletos; candidata não publicada |
| QA local de 15 casos | **13 PASS / 2 BLOCKED**, conforme matriz; impressão física e destino ainda pendentes |
| Deploy staging, release.json, autenticação/deeplinks do release | **SUCCESS** em `68404745`; identidade/multi_company/deeplinks e sessão/bootstrap autenticados PASS; três caminhos pagos e exportações PASS, lote/comanda bloqueados pela ferramenta |

O workflow autoriza esta branch somente por `workflow_dispatch`; o pré-flight precede R2/migrations remotos. A publicação posterior autorizada consta no relatório de 18/10 vinculado acima. A auditoria automática tem condição específica da branch: uma futura publicação da master e cada banco de destino ainda exigem a revisão histórica própria do runbook. Não extrapolar uma auditoria de staging para produção. Merge e produção continuam fora da autorização.

## Evidências e próximo passo

Resumo sanitizado persistido em [`evidence/2026-10-17-effective-receipt-task11-local.json`](evidence/2026-10-17-effective-receipt-task11-local.json): HTTP/status, IDs fictícios, datas, rodadas de navegador, SQL de reconciliação, D1/budget, saldo inicial e resultados dos comandos. Logs completos e probes locais preservados em `.wrangler/task11-evidence/` e `.wrangler/task11-*.mjs`, fora do Git. Capturas, snapshots e exportações fictícias estão anexados no mesmo diretório de evidências versionadas.

README, AGENTS, índice documental, Business Rules, Architecture e Module Map pertinentes foram conferidos: comandos, regras de datas e ownerships continuam coerentes. Foi atualizado o roteiro da Task 11 para apontar este resultado e exigir revisão de formatos UTC legados e do cenário de carga concentrada; não foram acrescentadas regras de produto ou dispensados gates. A melhoria documental registra o diagnóstico e a recuperação do ambiente local, as evidências reais de navegador e os limites das medições.

O [orçamento D1 vigente](../../operations/operational-data-read-budget.md#recebimentos-efetivos--pr-120) referencia o cenário concentrado desta revisão; o [runbook de release](../../release-and-migration-runbook.md#migration-0052--data-efetiva-dos-recebimentos) explicita os pré-requisitos da migration 0052. README e AGENTS não precisaram de alteração adicional. Bancos locais, credenciais, caches e logs brutos permanecem fora do Git; as evidências publicadas são sanitizadas e usam somente dados fictícios.

Os próximos passos são o usuário confirmar lote/comanda preparados em staging e conferir seus efeitos, revisar orçamento incluindo CPU/conta/degradação, triar a observação visual e validar impressão física pelo runbook. Migration/195 originais, login/bootstrap, três caminhos pagos e relatórios/exportações passaram. Não repetir pagamentos já concluídos nem publicar novamente apenas por documentação. **Recomendação atual: manter a PR aberta e a Task 11 não homologada até resolver os bloqueios e registrar aceite do release.** Os servidores locais foram deixados ativos em 4173/8787 com a persistência fictícia preservada na rodada local.
