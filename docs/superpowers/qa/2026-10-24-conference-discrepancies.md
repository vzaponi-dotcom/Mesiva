# QA — acompanhamento de divergências

**Código verificado:** `6cc3369c6e7e5a015cab5fb47a93ccd7b1d4af4a`, sobre `74f77d4035f0891e07ad8f55ffbc781051baf93a`. PR #125. Dados exclusivamente fictícios, sem acesso a produção. Este registro descreve a implementação testada; CI e publicação do SHA final são acompanhados na PR.

## Resultado funcional

- Abas na própria Conferência do Dia, listas por situação e paginação por chave de 20 itens; sem consulta de divergências na abertura padrão e sem polling.
- Pendências por revisão/forma, incluindo revisões antigas e diferenças compensadas. Migration `0056` aditiva com backfill/trigger; upgrade/clean install e preservação dos snapshots/financeiro cobertos.
- API autentica empresa/ator, valida capabilities de leitura/gestão, origem, motivo, descrição, referência e confirmação. Concorrência: primeira solução vence; replay idêntico pelo mesmo ator não escreve; tentativa distinta conflita.
- Drawer oficial consulta a data e a versão próprias de uma pendência antiga, inclusive na segunda página. Permissões de pedido e regras existentes permanecem.
- Formulário conserva payload após resposta desconhecida; verificar consulta a solução e reenviar mantém o conteúdo. Troca de contexto cancela respostas antigas. Chave global `day-conference:` bloqueia navegação/gravações durante o envio e libera somente a própria operação.
- QA real no navegador local (1440 e 320 px): abrir pendência, revisar recebimentos, Escape/foco do drawer, SystemSelect, solução persistida, bloqueio durante resposta controlada, retorno com foco na lista e consulta em Resolvidas. Sem overflow horizontal ou erro JS.
- As duas pendências da revisão fictícia de 23/10 foram tratadas com observações de QA. O script comparou resumo/fonte e histórico antes/depois do fluxo completo: idênticos. Nenhum pedido, pagamento, movimento, estorno ou snapshot foi editado pelo tratamento. Evidências locais ignoradas em `.wrangler/discrepancies-browser-qa.json` e screenshots `discrepancies-*-qa.png`; não contêm dados de produção.
- Inclui os rótulos aprovados **Data do recebimento** / **Registrado no sistema em**, além da retirada da borda duplicada abaixo da última forma de pagamento.

## Verificação

- Suíte completa local: **4.191 aprovados**, zero falhas/cancelamentos. Depois dos testes adicionais de concorrência e bloqueio global, **63 testes focados finais aprovados**. O CI final executa novamente a suíte completa no SHA enviado.
- Arquitetura, lint, build, `git diff --check` e Wrangler `4.128.0` dry-run staging aprovados. Warnings existentes de bundle/React permanecem; o novo componente também usa efeito para sincronizar seu estado com a API/contexto, sinalizado pelo lint sem erro.
- A primeira suíte identificou um select nativo; substituído pelo `SystemSelect` e validado pelo gate de migração de selects. Revisão independente apontou tipo do motivo, bloqueio global e foco ao voltar; corrigidos e reconferidos, sem achado material restante.
- Gate real D1/workerd: `node scripts/infra/day-conference-d1-gate.mjs`; relatório local `.wrangler/discrepancies-d1-gate.json`.

## Custo medido e limites

Comparação com carga equivalente no D1 real local, SQL do repositório. Abertura/detalhe da conferência existentes continuam sob os asserts de 120 recibos no dia e histórico de 1.000 → 10.000 recebimentos. Sem endpoint, timer ou escrita adicional na abertura padrão.

| Ação nova | Candidatos | Statements / chamadas D1 | `rows_read` | `rows_written` |
| --- | ---: | ---: | ---: | ---: |
| GET lista pendente, 20 itens | 40 | 1 / 1 | 42 | 0 |
| GET mesma lista, 20 itens | 10.000 | 1 / 1 | 42 | 0 |
| Próxima página | 40 | 1 / 1 | 42 | 0 |
| GET detalhe | 1 | 1 / 1 | 2 | 0 |
| POST resolver | 1 | 3 / 3 | 6 | 2 |
| Reenvio confirmado | 1 | 1 / 1 | 2 | 0 |
| GET resolvidas | 1 | 1 / 1 | 2 | 0 |
| INSERT sintético de conferência sem linha divergente | 1 | 1 / 1 | 1 | 6 |
| INSERT equivalente com uma linha divergente | 1 | 1 / 1 | 1 | 10 |

O trigger acrescenta **4 linhas escritas por pendência** nessa carga, incluindo manutenção dos índices; isso não significa custo zero para a migration. O seed de 9.960 conferências divergentes escreveu 99.600 linhas (conferência, pendência e índices). A migration inicial examina o histórico de conferências e seus JSONs uma vez; não percorre movimentos para recriar divergências. Não remove nem transforma lançamentos financeiros. Bundle anterior continua compatível, incluindo novas conferências após rollback de código; não apagar a migration/tabela para reverter a UI.

`EXPLAIN` real usa `daily_receipt_discrepancies_status_idx` e a PK da conferência, sem scan completo ou N+1 na lista. A resolução escreve uma vez por pendência; leituras e replay não escrevem. HTTP: uma chamada por abertura de lista/página/detalhe, resolução ou verificação; revisar lançamentos faz duas chamadas (resumo atual da data + primeira página), mais uma por página solicitada, e pedidos continuam sob demanda.

Planejamento SQL mensal **incremental**, sem promessa de economia/franquia: para L listas cheias, D detalhes, S soluções e R verificações/replays, a amostra é `42L + 2D + 6S + 2R` leituras e `2S + 4P` escritas adicionais, sendo P pendências geradas. Exemplo fictício: 30 empresas × 3 dispositivos × 2 listas/dia × 30 dias = 5.400 listas; 600 detalhes/soluções e 100 replays somam 231.800 leituras SQL; 600 soluções/pendências somam 3.600 escritas adicionais. Em degradação com cinco atualizações explícitas para cada abertura, as listas passam a 27.000 e acrescentam 907.200 leituras nessa mesma amostra. Não há reconciliação/polling duplicado por dispositivo.

Esses números **excluem autenticação/guardas de sessão, requests HTTP externos, CPU total do Worker, WebSocket/DO, R2, armazenamento, logs e retries de infraestrutura**. Os mesmos guardas existentes permanecem; ausência de medição dessas parcelas não representa custo zero. Não foi aferida margem financeira de 20% da conta nem orçamento total mensal. Não foi criado serviço/cache novo para perseguir economia não medida.

## Publicação e pendências

Publicação segue CI completo → staging pelo Actions → homologação humana. A aprovação da direção e da implementação não equivale a homologação desta candidata, merge ou produção. Evidências do SHA final/run/release ficam na descrição da PR #125. Sem validação de hardware nesta entrega; impressão não foi alterada.
