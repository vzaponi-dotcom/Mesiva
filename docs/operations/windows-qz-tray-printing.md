# Runbook operacional — impressão Windows/QZ confirmada

## Arquitetura e responsabilidade

`Dispositivo solicitante → Cloudflare/fila → PC da cozinha → QZ Tray → fila Windows → USB → MPT-II`

Celular, tablet e demais dispositivos apenas solicitam ou acompanham jobs. Somente a estação principal Windows envia uma via física. A fila central preserva jobs, tentativas, vias e decisões operacionais; não existe impressão física direta no dispositivo solicitante.

## Pré-requisitos e configuração

- Use um PC Windows dedicado, autenticado, online e conectado ao sistema por HTTPS.
- Instale, abra e autorize o QZ Tray 2.2.6 para o ambiente configurado.
- Conecte a MPT-II, com papel térmico de 58 mm, pela porta USB correta.
- Configure a fila Windows `MPT-II` com o driver `Generic / Text Only` e valide uma impressão direta pelo Windows.
- Mantenha o certificado público e a chave privada QZ nos segredos apropriados. A chave privada nunca fica no navegador, D1, bundle, Git ou logs.

Em **Pedidos > Impressão**, atualize a lista de impressoras e selecione explicitamente `MPT-II`. A fila encontrada identifica a configuração salva; ela não demonstra que a impressora está ligada, conectada ou com papel.

A estação principal mantém o consumidor físico elegível mesmo se a aba ficar em segundo plano ou a janela for minimizada. O ciclo crítico de impressão (revalidação física, heartbeat e busca do próximo job) usa um **Web Worker dedicado** com cadência de 2 s, evitando depender dos timers da aba oculta; ambientes sem Worker usam o intervalo tradicional como fallback. O refresh visual da aplicação continua limitado à aba visível. A revalidação periódica do transporte consulta novamente o estado atual do QZ/impressora para sair de estados transitórios como `verifying` quando o equipamento voltar a responder `OK`.

## Verdade operacional observável

Os quatro sinais abaixo governam a operação:

```text
PRINTER OK -> pode iniciar uma via
PRINTER OFFLINE -> não fazer claim nem enviar nova via
JOB COMPLETE -> contar uma via
SPOOLING sem COMPLETE -> pode ainda imprimir; nunca reenviar automaticamente
```

`PRINTER OK` vem do estado físico observado pela estação principal e libera uma via por vez. A descoberta da fila e uma sessão QZ conectada são pré-requisitos técnicos, mas não são prontidão física. `PRINTER OFFLINE`, ausência de observação, papel/intervenção ou estado desconhecido bloqueiam claims e envios novos.

`JOB COMPLETE` correlacionado ao job é a confirmação operacional mais forte disponível: somente ele incrementa a contagem de cópias. É uma confirmação do spooler Winspool, não um sensor independente de papel nem uma prova absoluta de que a pessoa retirou o ticket.

A resolução de `qz.print()` apenas informa que a chamada de transporte terminou; ela não é sucesso final da via. Depois do início da submissão, aguarde o evento do spooler. Um evento `SPOOLING` sem `COMPLETE` pode anteceder uma impressão tardia e, por isso, não autoriza retry ou reenvio automático.

## Estados que exigem ação humana

- **Aguardando confirmação:** a via foi submetida e a estação aguarda `JOB COMPLETE`. Não crie outra via enquanto a confirmação não chegar.
- **Resultado desconhecido:** a observação foi perdida ou não foi possível correlacionar o resultado após a submissão. Eventos automáticos tardios não alteram esse estado. A pessoa responsável escolhe uma vez: **A via foi impressa** para contabilizar a via, ou **Não foi impressa — reenviar** depois de confirmar o risco de duplicidade para criar um reenvio explícito.
- **Requer atenção por falha conhecida:** use somente a ação explícita disponibilizada para o job. Não há retry silencioso.
- **Duas vias:** quando o job solicita duas vias, cada via continua exigindo sua própria confirmação `JOB COMPLETE`, mas a segunda é enviada automaticamente logo após a confirmação da primeira. Não há decisão humana entre 1ª e 2ª via no fluxo normal. Estados legados `awaiting_second_copy` continuam tratáveis pela fila para compatibilidade e recuperação.

Pedido Mesa/consumo local automático usa uma via. Delivery e Retirada seguem a regra central ou a quantidade expressa do job. Uma reimpressão manual de histórico pode escolher uma ou duas vias, inclusive para Mesa.

## Impressora offline e recuperação segura

Enquanto a impressora estiver offline, stale ou em verificação, o consumidor automático normal fica pausado: jobs permanecem na fila, sem claim paralelo e sem reenvio. Verifique energia, papel, cabo USB, driver, porta e uma impressão direta pelo Windows antes de prosseguir.

Quando uma transição real de `OFFLINE`/stale para `OK` encontra backlog seguro, o sistema abre uma recuperação pendente uma única vez. O operador decide:

1. **Imprimir agora** inicia a recuperação e reclama um trabalho seguro. Se ele possuir duas vias, as duas são enviadas em sequência, cada uma com confirmação própria do spooler.
2. Depois do resultado desse trabalho, **Imprimir próxima** processa somente o próximo trabalho seguro.
3. **Parar por agora** deixa a recuperação como adiada; atualizar, focar a página ou receber heartbeat não reabre nem dispara a recuperação.

Não use o retorno da conexão para despejar backlog. Jobs submetidos, em `SPOOLING`, aguardando confirmação ou com resultado desconhecido não são descartados nem reimpressos pela recuperação automática. Uma nova transição offline→OK pode criar um novo ciclo somente quando houver novo backlog seguro.

## Operação diária e troubleshooting

- **QZ desconectado:** abra o QZ, confirme certificado/confiança e recarregue. Não desative a segurança.
- **Fila não encontrada:** confira o nome, driver, porta USB e teste do Windows; depois atualize a descoberta. Isso ainda não torna a impressora pronta.
- **Impressora offline ou com atenção:** corrija o problema físico e espere `PRINTER OK`; não use claim, retry ou reenvio para testar.
- **Job em SPOOLING/aguardando confirmação:** aguarde o evento correlacionado. Se a observação se perder, resolva manualmente o resultado desconhecido; não reenvie automaticamente.
- **Job parado:** confira estação principal, conectividade, `availableAt`, estado de recuperação e a ação explícita correspondente. A Fila de impressão deve indicar o motivo operacional quando houver pendências, por exemplo QZ desconectado, impressora indisponível ou verificação em andamento.
- **Acentos/largura:** valide papel 58 mm, 384 pontos e caracteres portugueses.

## Retenção e histórico

Jobs terminais podem ser consultados pelos filtros **Impresso** e **Descartado** da tabela principal e são removidos com segurança após 30 dias. O pedido histórico permanece a fonte para reimpressão: se o job antigo já tiver sido removido, **Reimprimir** cria um novo job manual a partir do pedido; se existir, o novo job mantém o vínculo de auditoria com ele.

Este runbook não autoriza deploy de produção. A homologação física aprovada permanece o checkpoint operacional antes de qualquer liberação.

## Consumo D1 da manutenção da fila

Para diagnóstico de leituras, índices e medição de recuperação, consulte [o incidente de leituras D1](printing-d1-read-incident.md). A manutenção deve começar pelos estados/tentativas candidatos; não correlacione cada trabalho histórico com todas as tentativas da empresa.
