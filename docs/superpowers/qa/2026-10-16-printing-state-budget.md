# Leitura unificada de impressão e orçamento — 16/10/2026

Extensão da issue75 após o PR112, baseada na master58b87421. Em validação; não comprova ativação em produção nem redução de cobrança acumulada. A meta permanece até cinco dispositivos, com20%de margem no cenário normal e dimensões completas da conta.

## Diagnóstico e mudança

Amostragem temporária em staging com quatro interfaces humanas visíveis, sem gravações de negócio, registrou CPU por invocação da versãof1767d71. Na fase aquecida: estações16amostras/média10,75ms, jobs14/média20,286ms, resumo16/média14,062ms. No mix de dimensionamento anterior (500pedidos criados/5.000mudanças por dia), somente esses três grupos projetavam40,71milhões de ms/mês, antes das outras operações e do baseline. A franquia Workers inclui30milhões; o limite com20%de margem é24milhões. São hipóteses e amostras de staging, não vendas reais nem previsão garantida de fatura.

O refresh do manager passa de três HTTPs para `GET /api/printing/state`. A composição exige as duas capabilities de leitura, reutiliza serviços/projeções oficiais e mantém contratos separados para filtros/paginação. Guards do frontend, contextos, timers, claim, confirmação e tratamento de unknown são preservados. Não adiciona dependências, schema, cache persistente ou executor.

## D1 real local

Mesmo gate workerd/Miniflare Wrangler4.128.0:10mil pedidos/50mil itens/10mil auditorias e3mil jobs terminais do dia, cinco clientes de transporte incluindo TV. Leituras incluem auth, guards, auditoria e atribuição. Preparação de fixture fica fora da medição.

| Atualização | HTTP | rows_read | rows_written auxiliares | SQL |
| --- | ---: | ---: | ---: | ---: |
| Estações + jobs + resumo separados |3|8013|18|50|
| Leitura unificada |1|7258|14|39|

A comparação mantém funções de retenção/recuperação e total completo do dia, sem apagar dados para reduzir contagem. O gate funcional real passou: cinco clientes após reinício, hibernação, publicação perdida convergindo em264s, um vencedor de claim e nenhum reenvio de resultado desconhecido. O validador exige medir a nova rota e não aumentar leituras/escritas/SQL em relação às três anteriores.

O usuário informou51–150pedidos/dia e até cinco dispositivos. O alvo usa150criações e1.500alterações/dia,12h/dia e31dias, com quatro sessões humanas distribuídas entre cozinha, clientes, recebíveis e financeiro, mais uma TV. O modelo inclui montagem e primeira reconciliação de cada owner, reconciliações periódicas, timer independente do manager, mudanças administrativas e leituras próprias do painel de fila. Não presume coalescência entre fontes independentes.

| Cenário mensal, antes do baseline externo | rows_read | rows_written | Requests Workers |
| --- | ---: | ---: | ---: |
| Alvo150pedidos/dia, normal |9.224.268.424|15.876.354|2.412.588|
| Alvo150pedidos/dia, fallback contínuo |15.047.178.640|16.438.910|2.608.840|
| Stress500pedidos/dia, normal |18.674.911.374|24.827.604|3.497.588|
| Stress500pedidos/dia, fallback contínuo |15.177.454.590|19.639.660|2.847.540|

O stress preserva5.000alterações/dia como avaliação separada. A comparação mensal não isola somente a composição HTTP porque também corrige a cobertura dos owners no modelo. CPU da nova versão, duração DO, armazenamento e baseline ainda precisam de evidência; o gate financeiro permanece pendente. Não há garantia de franquia/custo a partir da projeção local.

O painel da conta observado em16/10 mostra45,09bilhões de leituras D1 acumuladas eUS$20,10de uso faturável. Inclui o incidente anterior e não representa o consumo futuro dos demais serviços. Durable Objects no período atual mostra553solicitações e24,3GB-s; a listagem contém apenas o namespace de staging, com30erros agregados e armazenamento exibido como0B. Esse arredondamento/atraso e o período agregado não comprovam armazenamento zero nem duração por operação. Essas dimensões não foram preenchidas com zero no gate.

## Preservação e gates

Testes cobrem negação quando falta qualquer uma das duas permissões, isolamento de empresa e equivalência das projeções de documentos; refresh único, unknown sem retry/claim, erro ou resposta tardia após troca de sessão. A whitelist de staging acrescenta somente a branchcodex/printing-state-budget, preservando PRaberto/latestSHA/CIexato e os limites de ambiente.

Validação local:3.908testes passaram sem falhas, arquitetura/lint/build e dry-runs dos dois ambientes passaram. A revisão independente final não encontrou problemas adicionais. O primeiro ensaio paralelo de catálogo encontrou colisão do cache Vite; ambos os arquivos passaram isoladamente e a suíte completa repetida com concorrência4passou, sem alteração no catálogo. O gate real D1/runtime também passou. CI e staging precisam confirmar o SHA publicado; não habilitar produção com dimensões desconhecidas ou com projeção acima das franquias.
