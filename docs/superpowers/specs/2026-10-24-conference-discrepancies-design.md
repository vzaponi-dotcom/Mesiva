# Tratamento de divergências da conferência

Direção aprovada pelo proprietário em 24/10/2026 após prévia HTML navegável. Implementação solicitada com Ponytail full. Complementa a conferência; não substitui recebimentos, caixa ou conciliação bancária.

- Na própria Conferência do Dia, abas Conferência, Divergências pendentes e Resolvidas. Abertura padrão continua na conferência, sem carregar listas adicionais.
- Cada linha divergente de cada revisão gera uma pendência. Datas antigas permanecem acessíveis por paginação; valores positivos e negativos não se compensam. Nova revisão não resolve silenciosamente pendências anteriores; data, forma e revisão identificam cada caso.
- Analisar apresenta valores e justificativa originais, responsável e horário. Revisar lançamentos atuais reutiliza o drawer oficial, incluindo permissões de pedidos e paginação; não representa uma fotografia dos pedidos no momento da conferência.
- Solução exige motivo, descrição não vazia e confirmação. Motivos: erro no valor da conferência, lançamento de origem corrigido (referência obrigatória), diferença explicada e aceita. Registra usuário e horário oficiais; preserva snapshot e justificativa originais.
- Financeiro somente leitura pode consultar; concluir/resolver exige `finance.movements.manage` além de `finance.movements`. Empresa vem do contexto, com proteção de origem e sessão existentes.
- Resolver altera somente acompanhamento. Não cria despesa, estorno, cobrança ou ajuste financeiro. Uma solução é final nesta entrega; sem edição/exclusão/reabertura. Reenvio idêntico pelo mesmo ator reproduz sucesso; concorrente ou conteúdo diferente recebe conflito e consulta o registro vencedor.
- Listas consultadas apenas por ação, com paginação por chave de 20 itens e sem polling. Atualizar explícito permite ver alterações de outros dispositivos. Abas não descartam o rascunho da conferência; sessão/empresa invalida leituras e mutations pendentes.

## Escolhas

Registro indexado por divergência evita varrer JSON de todo histórico a cada consulta. Migration aditiva cria pendências das revisões já existentes e trigger para novas conferências, inclusive quando gravadas por bundle anterior. Não modifica dados financeiros nem snapshots. Uma atualização condicional registra solução; lista/detalhe usam joins restritos por empresa, sem N+1.

Alternativas consideradas: apenas observações no histórico não fornecem acompanhamento; tela financeira separada dispersaria o fluxo. A própria tela, conforme prévia aprovada, mantém consulta e tratamento juntos. Sem novos serviços, dependências, grants por perfil ou notificações automáticas.

## Verificação e publicação

TDD para migração/backfill, filtros/paginação/isolamento, idempotência/concorrência e estados de UI. Gate D1 real mede leitura/escrita antes/depois sob histórico volumoso e verifica índices; documentar custo de trigger e migration. Gates gerais e suíte completa obrigatórios. Publicar junto das melhorias de rótulos e divisor pela PR #125, via CI/staging; sem autorização de merge/produção nesta entrega.
