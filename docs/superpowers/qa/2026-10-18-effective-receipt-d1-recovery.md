# PR #120 — recuperação D1 antes da migration 0052

**Execução:** 18/10/2026, 00:27–00:33 SP. **SHA:** `304240ba776240a8d4a34d59d445b2f52ae5a07e`. **Resultado da parte 2: método de recuperação VERIFICADO, com limites de compatibilidade documentados.**

Foram obtidos pontos de recuperação de staging, exercitados restore e undo em um D1 descartável da mesma conta e conferida a compatibilidade dos repositórios financeiros reais com snapshots locais fictícios. Não houve restore de staging, cópia de seu conteúdo, migration remota da aplicação, publicação ou acesso a produção. A Task 11 continua não homologada.

## Ponto de recuperação de staging

Destino: `amor-e-sabor-delivery-staging`, ID `73a1c0c1-142f-4247-8ffc-e858ab2ac400`, região ENAM. `d1 info` retornou a identidade esperada e Time Travel respondeu com sucesso. O JSON de metadados não informou o plano da conta; não se presume retenção de 30 dias.

| Verificação somente de leitura | Resultado |
| --- | --- |
| Bookmark atual, obtido em 18/10 às 00:27 SP | `00000548-00000000-00005108-34ca27c2c770c85bce16d29abfd03452` |
| Bookmark para a auditoria de 18/10 às 00:22:07 SP (`2026-10-18T03:22:07.870Z`) | `00000546-00000232-00005108-a431720c280bdeec29e88bdc3b95a6bf` |
| Bundle identificado em `https://staging.mesiva.com.br/release.json` | `f44e10da3e523d757dc0a9ceffe575d4331907e0`, `refs/heads/master` |
| Conferência de staging após o exercício | 195 recibos, 55 migrations aplicadas, zero registros da 0052 e índice novo ausente |
| Custo dessa conferência SQL final | 675 linhas lidas, zero escritas, `changes=0` |

Esses pontos são evidência datada, não um checkpoint permanente para publicação futura. A [Cloudflare documenta retenção de 7 dias no Free e 30 no Paid](https://developers.cloudflare.com/d1/platform/limits/). Obter novo bookmark imediatamente antes da migration, na janela autorizada, e registrar banco, SHA/bundle, schema e horário. Não reutilizar um ponto vencido ou presumir que ele inclui escritas posteriores.

## Restore e undo reais em D1 descartável

O [Time Travel restaura no próprio banco e ainda não clona para outro destino](https://developers.cloudflare.com/d1/reference/time-travel/). Por isso, foi criado exclusivamente para este exercício o D1 `mesiva-task11-restore-b1f8-16a40e2c`, ID `96bd9b49-e096-4e18-8fd6-231528681717`. Não recebeu dados de staging nem migrations da aplicação; somente uma tabela de prova e dois registros fictícios. Guards locais impediram operações de escrita/restore/delete contra IDs de staging ou produção.

| Etapa | Esperado e observado |
| --- | --- |
| Estado inicial + bookmark A | Uma linha `marker=before` |
| Alteração de prova + bookmark B | `marker=after` e segunda linha `new-row=after` |
| Restore para A | Uma linha `marker=before`; segunda linha ausente — PASS |
| Undo usando `previous_bookmark` retornado pelo restore | Duas linhas no estado `after` — PASS |
| Limpeza | Identidade conferida novamente e somente o D1 temporário excluído — PASS |

O exercício usou Wrangler `4.128.0`, durou aproximadamente 22 segundos incluindo criação/consultas/limpeza e executou seis statements SQL: cinco linhas lidas e oito escritas, todas no banco descartável. Isso não mede RTO sob carga, custo mensal nem disponibilidade da aplicação. Staging permaneceu sem escritas por esta tarefa; seu restore não foi executado.

A [API de restore retorna `previous_bookmark`](https://developers.cloudflare.com/api/resources/d1/subresources/database/subresources/time_travel/methods/restore/), usado efetivamente para o undo. Bookmarks pertencem ao banco correspondente: os do descartável não recuperam staging.

## Compatibilidade de código, schema e dados

Foram executados os repositórios financeiros do bundle publicado `f44e10da` e do candidato `304240ba`, com dependências extraídas do Git e hashes registrados. Fixture local: 195 recibos fictícios, duas empresas, alocações/movimentos coerentes; registro técnico em 17/10 e data financeira em 15/10.

| Código / schema | Resultado nos caminhos financeiros testados |
| --- | --- |
| Candidato / pós-0052 | PASS: reconhece data financeira 15/10, com isolamento por empresa |
| Publicado / pós-0052 | SQL compatível, mas semântica financeira anterior: 98 recibos da empresa A aparecem em 17/10; candidato os lê em 15/10 |
| Publicado / pré-0052 restaurado | PASS, conforme comportamento anterior |
| Candidato / pré-0052 restaurado | **Incompatível esperado:** `received_date` ausente; não liberar esse par |

O snapshot pré-0052 foi copiado para outro arquivo local e reaberto. Hashes lógicos de schema e dados coincidiram, cobrindo 74 tabelas e 631 linhas da fixture; `integrity_check=ok`, zero violações de FK e 195 recibos preservados. A aplicação da 0052 na fixture preservou valores e timestamps técnicos. Um recibo fictício criado depois do snapshot desapareceu ao restaurá-lo, comprovando o risco de perder transações posteriores ao ponto.

O ensaio cobre schema/dados e repositórios financeiros reais; não é homologação completa de um Worker/UI restaurado em staging. Os cinco testes automatizados de migration, upgrade populado e reconciliação foram repetidos: **5 PASS, zero falhas/skips**. Não houve mudança de código da aplicação nesta parte.

## Procedimento para eventual recuperação

Seguir o [runbook vigente](../../release-and-migration-runbook.md#recuperação-da-migration-0052). A estratégia precisa tratar código e banco como um par, manter escritas bloqueadas por procedimento autorizado e conciliar transações posteriores ao ponto antes da liberação. Depois de recebimentos com data efetiva, retornar somente ao código anterior pode recolocar valores no dia financeiro errado. Restaurar somente o schema pré-0052 com o candidato ativo causa falha de leitura. Preferir correção adiante quando perder transações for inaceitável; não improvisar down-migration.

Não foi alterado o workflow para publicar ou restaurar recursos. A parte técnica de recuperação foi verificada; a captura de um checkpoint fresco e sua conferência continuam obrigatórias na janela real. Aceite histórico dos 195 consensos, orçamento e impressão física permanecem pendentes, além da homologação do release futuro de staging.

## Evidência

[JSON sanitizado da recuperação](evidence/2026-10-18-effective-receipt-d1-recovery.json): bookmarks de staging, identidade do bundle, restore/undo e exclusão do descartável, hashes dos módulos publicados, fingerprints locais, metadados da conferência final e testes. Scripts e bancos fictícios do ensaio ficam em `.wrangler/task11-*`, fora do Git. Nenhuma credencial, cookie ou token está incluído.
