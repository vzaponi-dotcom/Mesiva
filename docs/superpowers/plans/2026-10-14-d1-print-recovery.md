# Correção do consumo D1 na recuperação de impressão

> Execução nesta sessão com investigação sistemática, TDD e revisão independente ao final.

Objetivo: limitar as leituras da manutenção da fila aos estados candidatos, preservando transações, auditoria, isolamento e decisão humana após envio.

1. Reproduzir o plano publicado e medir rows_read das seleções sem executar mutations em produção.
2. Criar regressão com schema real e histórico volumoso: o plano não pode procurar todas as tentativas da empresa para cada trabalho.
3. Separar candidatos seguros por status e candidatos incertos por tentativas expiradas/unknown; adicionar migration somente de índices, sem remover índices ou dados.
4. Verificar vazia, histórico, envio recente/expirado, unknown/resolvido, segunda via, replay/concorrência e rollback da auditoria.
5. Executar arquitetura, lint, build, suíte completa, migrations e dry-runs; medir D1 local antes/depois.
6. PR/CI, staging da branch explicitamente elegível com PR aberto, aceitação, merge, CI/staging master, Deploy production e métricas.

Restrições: sem cópia de dados reais, limpeza de banco, reenvio de tentativa incerta ou deploy/migration remota local. A migration cria índices e é compatível com o bundle anterior; bookmark automático permanece obrigatório. O custo único de criação de índices será registrado no deploy.
