# Conferência do Dia

Implementação da PR #124, independente do Caixa Operacional da PR #123. A homologação e a publicação seguem o [runbook de release](../release-and-migration-runbook.md). O [relatório técnico](../superpowers/qa/2026-10-23-day-conference-final-review.md) guarda a evidência desta entrega.

## Valores e datas

- Acessar **Financeiro → Conferência do dia** pela navegação da área financeira. O botão duplicado na Visão geral foi removido.
- A data é `movements.movement_date`, no calendário de São Paulo; pode ser hoje ou anterior. A data comercial do pedido e o horário técnico de registro não substituem o dia financeiro.
- **Bruto:** entradas `order-payment`, uma por alocação. Um recibo de comanda/lote não é multiplicado pelos pedidos que quitou. Complementos e recebimentos retroativos pertencem ao seu próprio dia financeiro.
- **Estornos:** saídas `order-refund` e `order-edit-refund`, no dia da devolução. **Líquido = bruto − estornos**. O valor externo aceita sinal negativo, inclusive em dias só com devoluções.
- A forma vem do próprio movimento; apenas para recebimentos sem rótulo, usar a alocação oficial e, por último, o pagamento legado. Estorno sem evidência própria fica em **Não informado**, mesmo que o pagamento original tenha uma forma conhecida.
- **Reconciliação com a Visão geral:** o mix mostra bruto; `Recebido hoje` deduz `order-refund`, mas preserva a regra existente de não deduzir `order-edit-refund`. A conferência mostra essa diferença explicitamente quando houver devoluções após edição. Não comparar essas três métricas como se fossem equivalentes.
- Dinheiro representa entradas registradas, sem afirmar saldo físico de gaveta. Cartões representam transações, sem afirmar repasse bancário líquido ou conciliação externa automática.

Todos os valores trafegam em centavos inteiros seguros. Detalhes são carregados somente ao abrir uma forma, em páginas de até 50 lançamentos; o total carregado é identificado como parcial enquanto houver páginas. **Exportar CSV do dia** percorre todas as formas e páginas da data, com a mesma versão da fonte, e valida contagem/bruto/estornos antes de gerar o arquivo. O CSV identifica data financeira, horário técnico em São Paulo, origem, IDs e valores com sinal em centavos; neutraliza fórmulas em identificadores/rótulos. Mudança da fonte, erro ou cancelamento impede o download parcial. O arquivo não representa fechamento de caixa.

## Concluir e revisar

Ler exige `finance.movements`; concluir exige também `finance.movements.manage`. A API deriva empresa e responsável do contexto autenticado, exige origem válida nas mutations e revalida a sessão/grants na transação. O frontend usa o cliente HTTP contextual oficial.

Cada forma precisa de valor externo válido e confirmação individual. Qualquer diferença exige observação, mesmo que PIX −R$ 100 e dinheiro +R$ 100 resultem em diferença geral zero. A conclusão grava um snapshot com os valores oficiais, valores conferidos, diferenças, nota, revisão, nome e ID do responsável. Ela não edita, bloqueia ou reprocessa pagamentos.

Alterações na fonte tornam o snapshot anterior desatualizado; seus valores históricos continuam preservados. Os detalhes exigem a mesma versão da abertura e recusam paginação sobre dados alterados. Atualizar recarrega valores e limpa os avisos anteriores de sucesso. Havendo valores ou observações ainda não registrados, Atualizar e a troca de data pedem confirmação antes de descartá-los; cancelar preserva o preenchimento e a data atuais, sem nova consulta. Conferências já concluídas não exigem descarte. A atualização para verificar um envio sem resposta continua disponível diretamente. Trocar de data cancela leituras antigas.

**Histórico** consulta até 30 revisões da data selecionada, com responsável, horário, observação e valores imutáveis. O resumo inicial reutiliza o último snapshot já carregado; **Ver revisões** faz uma única leitura delimitada a empresa/dia. A revisão mais recente abre seus valores por padrão e as anteriores ficam recolhidas. Cada método apresenta conferido, diferença, líquido Mesiva e bruto/estornos em linhas responsivas. A variação entre revisões é a **diferença entre a soma dos valores conferidos nos dois snapshots**, e não uma divergência da conferência com o extrato ou uma alteração necessariamente atribuível a uma forma específica. Revisões anteriores e fonte desatualizada mantêm identificação distinta. Expandir/recolher revisões não consulta D1 nem altera seus registros. Para pesquisar outro dia, altere a data e abra o histórico novamente. O detalhe mantém a origem da devolução após edição separada dos demais estornos. Na comparação externa, use o líquido dos estornos identificados; o dia financeiro pode diferir do dia do extrato.

Em falha de rede ou resposta desconhecida, a UI preserva a chave e o payload do envio. Pode-se atualizar para verificar o registro ou reenviar a mesma conferência. A API só reproduz sucesso para a mesma chave, payload e ator. Duas pessoas não criam dois snapshots da mesma versão da fonte.

## Divergências pendentes e resolvidas

- As abas **Conferência**, **Divergências pendentes** e **Resolvidas** pertencem à mesma tela. Alternar abas preserva o rascunho da conferência. A abertura padrão não consulta divergências; cada lista é carregada por ação, em páginas de 20, incluindo dias antigos. **Atualizar lista** busca alterações de outros dispositivos; não há polling nem contagem global adicional.
- Cada diferença individual de cada revisão gera uma pendência, mesmo quando diferenças se compensam no total. A migration aditiva `0056` recupera linhas divergentes de todas as revisões anteriores; o trigger mantém compatibilidade com bundles anteriores que concluem conferências. Dias/formas/revisões continuam identificados; nova revisão não encerra pendências automaticamente.
- **Analisar** consulta o detalhe e mostra valores, justificativa, responsável e horário originais. **Revisar lançamentos atuais** reutiliza o drawer de recebimentos/pedidos, com a data e a versão atuais daquela fonte em todas as páginas. Esses lançamentos podem ter mudado após a conferência; não representam seu snapshot histórico.
- **Registrar solução** exige `finance.movements` e `finance.movements.manage`, motivo, descrição não vazia (até 1.000 caracteres) e confirmação. Os motivos são **Erro no valor da conferência**, **Lançamento de origem corrigido** (referência obrigatória, até 200 caracteres) e **Diferença explicada e aceita**. Corrigir a origem é uma providência separada, pelo fluxo autorizado; informar referência não executa uma correção financeira.
- A solução registra autor/horário do servidor e não pode ser editada, excluída ou reaberta nesta entrega. O snapshot/justificativa original permanece intacto. A ação não cria despesa, estorno, cobrança, saldo a receber ou ajuste de relatório. **Resolvida** identifica o acompanhamento encerrado, não uma mudança do valor recebido.
- A atualização é condicional: a primeira solução vence. Reenvio idêntico pelo mesmo ator reproduz sucesso sem escrita; outro ator/conteúdo recebe conflito. Em resposta perdida, o formulário mantém o conteúdo da tentativa; **Verificar registro** consulta o resultado e o reenvio usa a mesma solução. Bloqueios de conexão/contexto e navegação durante gravação seguem o contrato `day-conference:` da aplicação.
- Cada pendência fica ligada à conferência/forma original. Não são criadas tarefas globais, notificações, responsáveis de investigação adicionais ou ajustes financeiros automáticos.

## Identificação dos pedidos no detalhamento

- Os campos para valores externos utilizam a máscara monetária BRL do Mesiva (`R$ 0,00`, com suporte a negativos). Campo vazio continua distinto de zero, e digitar não dispara leituras ou escritas D1.
- O vínculo de recibos compartilhados utiliza o índice parcial `payments_business_receipt_order_idx` de `0055` para evitar varrer todos os pagamentos da empresa. O índice aumenta marginalmente o custo de escrita de novos pagamentos e precisa de autorização antes de qualquer migração remota.
- O lançamento financeiro pertence a uma **alocação de recibo**, não necessariamente a um único pedido. Quando o movimento tem `order_id`, usa-se o vínculo direto. Para recibos compartilhados com `order_id=NULL`, a tela busca os vínculos reais em `payments` e `order_settlement_entries` por **uma consulta em lote, restrita aos recibos da página**, apenas para usuários com `orders.view` ou `orders.history`. Sem permissão, nomes de clientes e itens dos pedidos não são retornados.
- **Ver pedido** consulta **somente o pedido clicado** pela rota autenticada existente `/api/orders/by-ids`. Exibe cliente salvo, modalidade, itens com nomes-snapshot e total **atualmente armazenados**. Esses dados podem ser alterados por edições após o pagamento; **não são um snapshot imutável do momento do recebimento**. O histórico da conferência mantém seu próprio snapshot financeiro imutável.
- O drawer usa navegação progressiva **lançamentos → pedidos vinculados (apenas quando vários) → pedido**, com botão Voltar e preservação de posição de rolagem. A lista inicial mostra apenas o cliente quando identificável, o valor, o horário e quantos pedidos se relacionam ao recebimento.
- UUIDs e IDs internos de movimento/recibo/pedido **não são exibidos no painel de consulta**: permanecem no D1 e no CSV completo para auditoria. No detalhamento, **Data do recebimento** identifica o dia financeiro do lançamento, e **Registrado no sistema em** identifica quando ele foi lançado no Mesiva; no detalhe do pedido, aparece também **Data do pedido**. Em cartões, a data do recebimento não indica o repasse da operadora. Nenhum vínculo pedido↔recebimento é inferido sem evidência.

- Havendo vários pedidos no mesmo recibo, todos são listados, mas **não se atribui o valor inteiro do recibo a cada pedido**. A auditoria e a soma de receitas continuam baseadas exclusivamente nos movimentos/alocações.

## Integridade e persistência

As migrations `0053`, `0054` e `0055` são aditivas. `daily_receipt_conferences` guarda o histórico; `daily_receipt_source_revisions` guarda a revisão por empresa/dia. Triggers incrementam essa revisão em inserção, alteração, exclusão e restauração de movimentos financeiros, inclusive trocas com o mesmo total/quantidade. Mudança de data invalida os dois dias; alterações em recibos/alocações e fallbacks legados também invalidam os dias vinculados.

O INSERT do snapshot verifica a revisão e a integridade na própria escrita SQL. A comparação anterior em JavaScript não é sua única proteção. O histórico é lido por empresa e não possui endpoint de edição/exclusão.

A leitura compara movimentos com recibos/alocações oficiais, detectando ausências, duplicações, valores e datas conflitantes. Recibos legados `received_date=NULL` são procurados por limites UTC calculados com o calendário IANA de São Paulo e também por vínculo aos movimentos de cada dia, com deduplicação. Um recibo com alocações distribuídas em datas incompatíveis bloqueia todos os dias afetados. A tela mostra o problema e bloqueia a conclusão; **não corrige dados automaticamente**. Investigar a origem e usar procedimento de correção explicitamente autorizado.

## Custo e verificação

- Abertura: agregado diário + auditoria/revisão da fonte + último snapshot, em um batch de três SELECTs.
- Detalhe: revisão pontual + página, em um batch; usa o índice diário existente para impedir que o otimizador percorra o histórico pela ordenação de criação.
- Conclusão: cinco statements em três chamadas D1 no caminho sem conflito; reenvio confirmado usa uma leitura. Não há escrita por digitação nem polling da conferência.
- Exportação: apenas por solicitação explícita; reutiliza o detalhe paginado, com duas queries em um batch por página. Falha sem arquivo se algum limite da API ou alguma inconsistência impedir a leitura integral. Volumes diários extremos podem exigir exportação no servidor; não introduzir CSV parcial silencioso.
- A revisão da fonte acrescenta metadados escritos pelos fluxos financeiros. Isso preserva a integridade sem carregar todos os lançamentos para calcular um hash no Worker. Os índices financeiros existentes são reaproveitados; a tabela de revisões possui sua chave empresa/dia.

Reproduzir com `node scripts/infra/day-conference-d1-gate.mjs`, após disponibilizar o Wrangler **4.128.0** no cache. O script usa D1/workerd local, fixtures fictícias e `EXPLAIN QUERY PLAN`; não possui binding remoto. O CI executa esse gate além dos gates existentes. Números medidos, limites e oportunidades ficam no relatório técnico; tempo de IPC local e `meta.duration` de SQL não são CPU/duração do Worker em produção.


## Apresentação: Evolução da conferência (23/10/2026)

Referência visual: mockup HTML **Mesiva_Conferencia_Evolucao.html**, opção Evolução aprovada pelo proprietário. Fonte editorial: **Mesiva — Guia oficial de identidade visual v1.1**, Design System e componentes vigentes da aplicação. A tela mantém os tokens de tema do produto (Mesiva/Clássico, claro/escuro), sem importar estilos do mockup nem alterar a marca.

- A faixa de progresso exibe texto **X de Y formas verificadas** junto da barra, inclusive após revisão necessária. Cada linha mantém sua confirmação independente.
- Os indicadores de total permanecem **Registrado no Mesiva, Valor informado e Diferença**, sem ícones decorativos. Valor informado e Diferença só exibem totais depois de preencher todas as formas; o texto orienta a completar os campos. Campo de valor vazio não equivale a zero; diferenças por forma, mesmo que se compensem, exigem justificativa.
- A orientação operacional sobre gaveta, Pix, cartões, bruto e estornos fica em **O que exatamente estou conferindo?**, seção de ajuda recolhida por padrão e acessível por teclado. Alertas de integridade, estorno após edição e método não identificado continuam visíveis.
- Cada ação de detalhe apresenta a contagem de lançamentos daquela forma; o drawer oficial de lançamentos/pedidos e as permissões permanecem idênticos.
- Ações de data/CSV/atualização, confirmação, histórico, estados de rede e acessibilidade reutilizam a infraestrutura existente. As melhorias são de apresentação, sem endpoints, migrations ou escrita financeira nova.

Homologar em staging no **mesmo SHA** validado por CI: desktop e 320/375px, tema claro/escuro, campos vazios e negativos, confirmação das duas formas, divergências compensadas, abertura/retorno do drawer, CSV e histórico. Conferir contadores e se a ajuda recolhida não acrescenta leituras D1. A publicação em produção e o merge dependem de autorização separada.
