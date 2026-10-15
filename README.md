# Mesiva — operação de restaurantes

Aplicação web para pedidos e cozinha, mesas/comandas, relacionamento com clientes, catálogo, financeiro, relatórios e impressão. O frontend usa React, React Router e Vite; a API roda em Cloudflare Workers, com dados persistidos no D1.

O acesso atual é por **e-mail e senha**, com contas Mesiva e vínculos por empresa. O login compartilhado por PIN e a impressão direta por Web Serial/RawBT pertencem a versões anteriores e não são o fluxo atual.

## Ambientes

| Ambiente | Acesso | Dados |
| --- | --- | --- |
| Desenvolvimento local | http://127.0.0.1:4173 | D1 local, com contas e dados fictícios |
| Staging | https://staging.mesiva.com.br | D1 e recursos exclusivos de homologação |
| Produção | https://app.mesiva.com.br | D1 e recursos com dados reais |

A sincronização por avisos WebSocket, fallback HTTP e os temporizadores preservados de impressão/TV estão descritos em [operação realtime e orçamento](docs/operations/realtime-sync.md). A ativação em produção depende da flag e dos gates de release/orçamento.

D1 é a fonte oficial de clientes, produtos, pedidos, pagamentos e movimentos. O navegador mantém preferências locais, mas não é a autoridade dos dados de negócio. Escritas não são enfileiradas offline.

## Requisitos

- Node.js 22 e npm.
- Git para branches, worktrees e PRs.
- Para operações remotas, acesso autorizado aos ambientes GitHub/Cloudflare.
- Para impressão física, estação Windows com QZ Tray e impressora configurada.

Use as versões de ferramentas declaradas no projeto. Atualmente, `dev:worker` fixa Wrangler 4.147.0 e os scripts de migrations/deploy fixam 4.128.0; não substitua por `latest` ou uma instalação global.

## Instalação

```bash
npm ci
npm run build
```

O build inicial cria `dist/`, usado pelo binding de assets do Worker. Não é necessário reconstruir o frontend a cada edição quando Vite está rodando.

## Desenvolvimento local: frontend e API

São dois processos. Vite usa a porta **4173** e encaminha `/api/*` para o Worker na porta **8787**, conforme `vite.config.js`.

### Escolher o banco local

Antes de iniciar ou aplicar migrations, confira o diretório de persistência já usado. Nesta instalação, os dados de teste existentes ficam em `.wrangler/local-orders-state`. Reutilize esse caminho para preservar contas, clientes e pedidos entre reinicializações.

Os exemplos abaixo usam explicitamente esse diretório. Para outro banco local, substitua o caminho **em ambos os comandos**. Não apague o estado existente para corrigir login ou falhas ao salvar.

Aplique migrations locais:

```bash
npm run d1:migrate:local -- --persist-to .wrangler/local-orders-state
```

### Terminal 1 — Worker/API

```bash
npm run dev:worker -- --local --ip 127.0.0.1 --port 8787 --persist-to .wrangler/local-orders-state
```

### Terminal 2 — frontend

```bash
npm run dev -- --host 127.0.0.1
```

Abra http://127.0.0.1:4173. Mantenha o mesmo hostname durante a sessão: `localhost` e `127.0.0.1` têm cookies e preferências separados.

Antes de criar novos processos, confira se as portas já estão em uso. Para testar worktrees em paralelo, use pares de portas diferentes, ajuste o proxy e mantenha o estado D1 adequado a cada tarefa.

### Login local

- Use uma conta fictícia previamente preparada **nesse banco local**.
- Contas de staging/produção não são automaticamente copiadas para o ambiente local.
- Migrations criam/evoluem o schema; não fornecem uma conta demo universal. Um banco novo exige preparação de contas fictícias.
- Não existe senha padrão no projeto. Não grave credenciais no README, em fixtures públicas ou no Git.
- O cadastro e a ativação de novas empresas em operação são feitos pelo painel Mesiva e pelo fluxo de convites. Os procedimentos administrativos remotos não são scripts de seed local.

Se o login ou a gravação falhar, verifique os dois servidores, a resposta de `/api/*`, o banco/persistência selecionado, as migrations e as permissões da conta. Não reative PIN como contorno.

### Preview do build

`npm run preview` serve o frontend compilado na porta 4173; **não inicia o Worker/API**. Para testar o sistema completo, mantenha a API disponível. Para servir SPA e API pelo próprio Worker local, gere o build e use o endereço informado pelo Wrangler.

## Autenticação e permissões

A configuração canônica em `wrangler.jsonc` mantém:

- autenticação por e-mail habilitada;
- autenticação multiempresa habilitada;
- modo de preparação desabilitado;
- origem oficial de produção `https://app.mesiva.com.br`.

Uma conta pode ter vínculos operacionais com empresas. A administração global Mesiva é separada desses vínculos; o contexto autenticado determina a empresa acessada.

O painel **Administração Mesiva → Empresas** permite buscar cadastros, acompanhar pessoas/convites e histórico e, conforme as capabilities de plataforma, suspender acesso, revogar vínculos e excluir empresas de forma recuperável. A restauração mantém a empresa suspensa até uma retomada explícita. Veja o [procedimento de gestão de empresas](docs/operations/multi-company-production.md#gestão-de-empresas).

Ações e dados são controlados por **capabilities**. O nome do perfil não substitui as permissões efetivamente concedidas. Recebimentos exigem `payments.receive`, além das permissões da superfície, e são autorizados no Worker.

Referências de implementação: `shared/settingsAccess.js`, `src/app/access.js`, `worker/access/authorization.js` e `worker/access/roles.js`.

O corte para produção multiempresa já foi concluído. Os workflows temporários de preparação/corte foram aposentados; consulte [a operação corrente](docs/operations/multi-company-production.md), sem repetir o procedimento antigo.

## Arquitetura e organização

```text
React / React Router / Vite
    ↓ /api/*, sessão e contexto de empresa
Cloudflare Worker
    ↓
D1 (dados) / R2 (assets de negócio)
```

| Diretório | Responsabilidade |
| --- | --- |
| `src/app/` | Shell, rotas, runtime, superfícies e workflows entre domínios |
| `src/domains/` | Acesso, empresas/plataforma, pedidos, mesas, clientes, catálogo, financeiro, relatórios e impressão |
| `src/shared/` | UI, hooks e utilitários genéricos do frontend |
| `src/infrastructure/` | HTTP, autenticação, armazenamento e transporte QZ |
| `shared/` | Contratos/regras compartilhados entre frontend e Worker |
| `worker/` | API, autorização, contexto de empresa e persistência |
| `migrations/` | Evolução do schema D1 |
| `scripts/` | Verificações de arquitetura e procedimentos de infraestrutura |
| `.github/workflows/` | Validação e publicação |

Dentro dos domínios, `domain/` contém regras puras, `application/` coordena fluxos, `infrastructure/` integra recursos e `ui/` apresenta a interface. Consumidores externos entram por `index.js`; regras de domínio não dependem de React, DOM ou HTTP.

As instruções para novas tarefas estão em [AGENTS.md](AGENTS.md). Os limites de imports são verificados por `npm run test:architecture`.

## Pedidos, clientes e recebimentos

O checkout permite vários produtos, quantidades, observações por item, taxa de entrega e ajustes. Os preços oficiais e o total são recalculados pelo Worker. Itens iguais com observações iguais são agrupados; observações diferentes mantêm linhas separadas.

**Salvar pedido** mantém pagamento pendente; **Salvar e receber** registra o recebimento no checkout, conforme as permissões. Pagamento e preparo são independentes: um pedido pago pode continuar em preparo.

A área de clientes oferece cadastro e relacionamento, com resumo, histórico de pedidos e recebimentos individuais/em lote elegíveis. Pedidos vinculados a comanda são recebidos pelo fluxo da comanda; pedidos pagos ou cancelados não entram no recebimento.

Valide essas regras com dados fictícios no ambiente local/staging, incluindo desktop, mobile, permissões e sincronização. Não crie lançamentos fictícios em produção como teste de release.

## Impressão atual: Windows e QZ Tray

```text
Dispositivo solicitante → fila central → estação principal Windows
    → QZ Tray → spooler Windows → USB → MPT-II
```

Celulares e outros dispositivos solicitam ou acompanham jobs; a impressão física é realizada pela estação principal Windows. O fluxo atual não envia diretamente pelo RawBT/Web Serial.

Na estação:

1. Instale e autorize QZ Tray 2.2.6.
2. Configure a impressora USB e a fila Windows conforme o runbook.
3. Em **Pedidos > Impressão**, selecione a impressora e confirme a configuração da estação.
4. Valide a saída física antes de manter impressão automática ativa.

A conclusão de `qz.print()` não confirma uma via. O sistema acompanha eventos do spooler; `JOB COMPLETE` correlacionado contabiliza a via. Resultado desconhecido exige decisão humana, sem reenvio automático que possa duplicar tickets.

Prévia e PDF usam o documento oficial do pedido. Os procedimentos de configuração, cópias e recuperação estão no [runbook Windows/QZ](docs/operations/windows-qz-tray-printing.md).

## Verificação

Durante o desenvolvimento, execute os testes da área alterada:

```bash
node --test caminho/do/arquivo.test.js
```

Verificações gerais:

```bash
npm run test:architecture
npm run lint
npm run build
npm test
```

O workflow **Validate application** (`.github/workflows/validate.yml`) roda a suíte completa em **oito shards**, seguida de arquitetura, lint, build, dry-runs do Worker, migrations locais e gates D1 de instalação limpa/upgrade.

Para conferir o bundle localmente, sem publicar:

```bash
npx --yes wrangler@4.128.0 deploy --dry-run
npx --yes wrangler@4.128.0 deploy --dry-run --env staging
```

Gates D1 usados no CI:

```bash
node scripts/infra/spec-b-d1-gate.mjs
node scripts/infra/operation-profile-d1-gate.mjs
node scripts/infra/print-recovery-d1-benchmark.mjs
node scripts/infra/operational-read-d1-benchmark.mjs
node scripts/infra/realtime-runtime-gate.mjs .wrangler/realtime-runtime-gate-report.json
```

A aprovação completa do CI é necessária para integração/publicação. Informe falhas, travamentos ou limitações de verificações locais; não substitua testes por uma declaração de sucesso. Mudanças somente de documentação requerem conferir links, comandos e coerência, sem repetir a suíte da aplicação desnecessariamente.

## Fluxo de publicação

```text
Branch de trabalho → PR e CI → staging/homologação
    → merge em master → CI e staging do commit integrado
    → Deploy production explícito → smoke pós-publicação
```

GitHub Actions é o caminho normal de publicação:

- **Deploy staging**: aplica migrations e publica apenas os recursos de staging, verificando identidade do release, autenticação e deep links. Confira as restrições de branches no workflow; qualquer nova branch não está automaticamente habilitada. Na `master`, o push inicia staging automaticamente.
- **Deploy production**: manual, restrito à `master`, exige CI e staging aprovados para o **mesmo SHA** que será publicado.
- Deploys aproveitam a suíte já aprovada e **não repetem `npm test`**. Mantêm build, verificações aplicáveis, migrations e smokes; esperam evidências pendentes por até dez minutos.
- Produção registra automaticamente um bookmark de restauração D1 antes das migrations. Não há checkbox manual de backup; falha no registro bloqueia a publicação.
- Merge é integração de código, não autorização para produção.

Os scripts `deploy:staging`, `deploy:production`, `d1:migrate:staging` e `d1:migrate:production` são operações remotas controladas, não comandos rotineiros de desenvolvimento. Não os execute para testar uma feature.

Staging usa `sistema-para-delivery-staging` e `amor-e-sabor-delivery-staging`; produção usa `sistema-para-delivery` e `amor-e-sabor-delivery`. Não copie dados reais de produção para desenvolvimento/staging.

Leia [o runbook de publicação e migrations](docs/release-and-migration-runbook.md) para aceitação, alterações de schema, smoke e rollback. Migrations destrutivas exigem estratégia de restauração revisada; não edite migrations já aplicadas nem improvise reversões de SQL.

## Secrets e dados

- Secrets ficam nos ambientes autorizados GitHub/Cloudflare ou em arquivos locais ignorados, quando necessários ao desenvolvimento.
- Não versione `.env`, `.dev.vars`, senhas, cookies, tokens, links de recuperação/ativação, certificados privados ou chaves QZ.
- A empresa e as permissões são verificadas no servidor a partir do contexto autenticado.
- Sessões são gerenciadas pelo backend; não use `localStorage` como atalho de autenticação.
- Preserve históricos de pedidos, pagamentos, movimentos e impressão ao evoluir schema ou procedimentos.

## Documentação operacional

- [Guia para agentes e novos chats](AGENTS.md)
- [Publicação, migrations e rollback](docs/release-and-migration-runbook.md)
- [Produção multiempresa e administração corrente](docs/operations/multi-company-production.md)
- [Impressão Windows/QZ e recuperação operacional](docs/operations/windows-qz-tray-printing.md)
- [Orçamento de leituras operacionais D1](docs/operations/operational-data-read-budget.md)
- [Políticas e configurações Spec B](docs/operations/spec-b-settings.md)

Documentos em `docs/superpowers/` e registros datados em `docs/operations/` preservam decisões e evidências históricas. Para a operação atual, confira também o código, os workflows e os runbooks correntes.
