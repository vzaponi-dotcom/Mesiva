# Separação do portal administrativo Mesiva

Data: 06/10/2026. Branch local: `codex/portal-administracao`. Base publicada: `e595f7ed` (PR #107).

Estado: especificação aprovada pelo usuário em 06/10/2026, incluindo **a mesma conta Mesiva, com sessões independentes**. O [plano de implementação](../plans/2026-10-06-admin-portal-separation.md) detalha a execução e aguarda revisão do usuário. Nenhum código de produto, migration, DNS ou ambiente publicado foi alterado nesta etapa.

## 1. Resultado esperado

A administração de empresas abre em `https://admin.mesiva.com.br`, com login, navegação e sessão próprios. `https://app.mesiva.com.br` continua atendendo os restaurantes. A administração de homologação abre em `https://admin-staging.mesiva.com.br` e usa somente os recursos de staging.

O layout de empresas aprovado na [primeira entrega](2026-10-05-platform-company-management-design.md) permanece: lista, visão geral, pessoas/convites, histórico e ações administrativas. Esta entrega separa os portais; não amplia grants, altera perfis operacionais, copia dados, troca o modelo de impressão ou recria contas.

Critérios de sucesso: o app dos restaurantes não oferece gestão Mesiva; suas APIs não executam ações administrativas após o corte; o portal administrativo não abre a operação de restaurantes; cookies de um portal não autenticam o outro; staging não acessa dados de produção. A mesma conta conserva seus vínculos, senha e grants reais.

## 2. Alternativas e recomendação

| Alternativa | Benefício | Custo/limite |
| --- | --- | --- |
| **Um Worker por ambiente, dois portais por host — recomendado** | Reutiliza os recursos, a pipeline e a autorização atuais; publica um conjunto coerente de código por ambiente | Exige política explícita de host, sessão e API; mudanças dos portais compartilham uma implantação |
| Workers separados para app e administração | Permite implantações independentes e separação de artefatos | Acrescenta configuração, secrets, deploys e coordenação de versões/migrations; a identidade e os dados empresariais continuam compartilhados dentro do ambiente |
| Apenas acrescentar um domínio ao app atual | Configuração inicial pequena | Não atende à separação de navegação, APIs e sessões requerida |

A recomendação é a primeira alternativa, com entradas de frontend distintas e autorização no Worker. A separação cobre endereço, interface, família de sessão e superfície de API, preservando a base de dados de cada ambiente. Cloudflare permite vários Custom Domains no mesmo Worker; essa capacidade não substitui a política de acesso implementada pelo Mesiva.

## 3. Ambientes e configuração

| Ambiente | Aplicativo | Administração | Worker / recursos |
| --- | --- | --- | --- |
| Produção | `app.mesiva.com.br` | `admin.mesiva.com.br` | `sistema-para-delivery`; D1 `amor-e-sabor-delivery`; R2 `mesiva-business-assets` |
| Staging | `staging.mesiva.com.br` | `admin-staging.mesiva.com.br` | `sistema-para-delivery-staging`; D1 `amor-e-sabor-delivery-staging`; R2 `mesiva-business-assets-staging` |
| Local | `http://127.0.0.1:4173` | `http://localhost:4174` | Worker local em 8787; dados fictícios e persistência explicitamente escolhida |

O endereço administrativo de staging integra a especificação aprovada. Hosts locais distintos evitam colisão do cookie; cookies não são isolados pela porta. Nenhuma edição do arquivo hosts do Windows é necessária. O proxy mantém o host/origin do portal, como o `changeOrigin: false` atual.

`wrangler.jsonc` mantém os bindings e `AUTH_PUBLIC_ORIGIN` operacional existentes. Acrescenta `AUTH_ADMIN_ORIGIN` e `ADMIN_PORTAL_PHASE`, com valores `prepare` ou `enforced`. As duas origens canônicas são validadas: HTTPS em ambientes publicados, sem credenciais, caminhos, query ou fragmento. Desenvolvimento usa configuração local explícita; ela não fica habilitada em staging/produção.

As rotas Custom Domain de cada ambiente incluem seus dois hosts exatos. `workers_dev` e previews que escapem dessa matriz ficam desabilitados. Não aceitar wildcard de subdomínio, origem derivada de parâmetro, `X-Forwarded-Host` ou fallback de staging para produção. Host desconhecido é rejeitado antes de autenticação, acesso ao banco ou assets.

Os registros DNS existentes dos novos nomes precisam ser inventariados por leitura antes da publicação. A criação dos Custom Domains ocorre pela pipeline, na etapa autorizada de implantação, depois da revisão de bindings e domínios. Esta especificação não executa nem autoriza isoladamente alterações remotas.

## 4. Frontend e rotas

O build entrega `index.html` operacional e `admin.html` administrativo, com bootstraps distintos. O segundo monta uma composição em `src/app/` usando o domínio `platform` pelo seu `index.js`. Não importa `App.jsx`, `SettingsSurface` completo ou runtimes de pedidos, financeiro, TV e QZ. Reutiliza tema, componentes genéricos, clientes/contexto HTTP e partes de conta que não dependam da operação.

`src/main.jsx` e `src/admin/AdminBootstrap.jsx` atuais são o bootstrap operacional, apesar do nome histórico `admin`. A implementação não deve confundi-los com o novo portal nem renomeá-los por conveniência fora do escopo.

| Host administrativo | Comportamento |
| --- | --- |
| `/` ou `/login` | Login administrativo; autenticado, direciona para `/empresas` |
| `/empresas`, `/empresas/nova`, `/empresas/:id` | Superfícies existentes de gestão, respeitando capabilities |
| `/minha-conta` | Dados da conta e troca de senha global, sem configurações empresariais |
| `/recuperar-senha`, `/redefinir-senha` | Recuperação da conta iniciada neste portal |
| `/pedidos`, `/financeiro/*`, `/cozinha-tv` e outras rotas operacionais | Não montam o app operacional; página indisponível |

O cabeçalho mantém marca, conta, Minha conta e Sair. **Abrir aplicativo** pode levar ao host operacional, sem trocar escopo, transportar sessão ou presumir login naquele host. Navegação/saída continuam sujeitas aos owners de tentativas e aos guards existentes.

O app remove as entradas administrativas de shell, seleção de empresas e configurações. Uma conta sem vínculos operacionais recebe a informação de que não possui empresas disponíveis no aplicativo; não ganha uma sessão platform automaticamente. A administração permanece acessível pelo seu endereço próprio.

No estado `enforced`, links antigos GET/HEAD de `/mesiva` e `/mesiva/empresas/*` levam à rota correspondente do host administrativo do mesmo ambiente. O destino é construído a partir da configuração validada, sem transportar query ou fragmento. Redirects não são permanentes e não ficam em cache. Não redirecionar POST, credentials, cookies, tokens ou dados de confirmação entre hosts.

`assets.run_worker_first` precisa cobrir a resolução do portal também para HTML. A proposta usa `true`: o Worker valida o host e serve o HTML adequado pelo binding ASSETS, sem fetch público recursivo. Assets estáticos compartilhados continuam acessíveis; o segredo da autorização não está no código frontend. Deep links administrativos não podem cair no fallback `index.html` operacional. A conferência de performance registra o efeito dessa passagem adicional pelo Worker antes de publicação.

## 5. Matriz de APIs e autorização

A política da superfície é resolvida antes de `handleGlobalAuthApi`, dos handlers empresariais e do fallback de assets. Ela complementa `classifyApiRoute` e as capabilities atuais; não as substitui.

| API | App em `enforced` | Administração |
| --- | --- | --- |
| Login, sessão e logout | Família app; login identity/business | Família admin; login platform com `platform.businesses.view` |
| Recuperação/inspeção/conclusão de senha | Fluxo originado no app | Fluxo originado na administração |
| `/api/access/me/password` | Conta atual, autorização global existente | Conta atual, autorização global existente |
| Selecionar empresa, listar empresas elegíveis e logo privado | Fluxo operacional existente | Bloqueados |
| Selecionar plataforma | Bloqueado; não cria sessão administrativa | Bloqueado: o login administrativo já seleciona platform |
| `/api/platform/businesses/*` | Bloqueados, salvo a ponte restrita de receipts da seção 8 | Capabilities e transações atuais |
| `/api/platform/provisioning-attempts/:key` | Somente ponte de leitura para família platform app anterior ao corte | Leitura da receipt do próprio autor, com view/create |
| Pedidos, clientes, financeiro, catálogo, configurações empresariais, impressão e TV | Fluxo atual | Bloqueados, inclusive endpoints públicos de TV |
| Aceitação de convites empresariais | Fluxo atual | Não aceita convites de restaurante |

O host administrativo força a finalidade administrativa no servidor; o body do login não escolhe sua audiência. O app rejeita `destination=platform` após o corte. Uma conta com vínculo empresarial e grant platform pode entrar nos dois portais, em famílias independentes. Conta sem grant real de visualização não entra na administração, independentemente do nome do perfil.

Sem cookie válido, permanece a resposta de autenticação existente. Para um host conhecido que não oferece determinada API, retornar 403 com código estável `PORTAL_ROUTE_NOT_ALLOWED`; não despachar a operação, servir HTML ou usar redirect. API desconhecida continua 404. Em uma API oferecida pelo portal, método incompatível continua 405. Páginas/redirects oferecem somente GET/HEAD. Mutations continuam exigindo Origin exato e marcador de contexto. Não introduzir CORS com credenciais entre os portais.

A projeção de sessão administrativa expõe conta, escopo, contexto e grants platform necessários; não inicia bootstrap empresarial ou enumeração de vínculos operacionais. A projeção app em `enforced` não oferece navegação administrativa para novas sessões. A descoberta anônima conserva `{ authenticated: false, authMode: 'multi_company' }`, compatível com os smokes atuais.

## 6. Sessões e migration

A identidade global é mantida. `scope` continua `identity`, `business` ou `platform`. Uma nova coluna `audience` na família de sessão registra `app` ou `admin`, uma dimensão distinta do escopo.

Uma migration nova, numerada após 0041, adiciona `identity_session_families.audience` com CHECK e default `app`. As famílias anteriores permanecem app; contas, credenciais, grants, sessões empresariais e receipts não são removidos. Novas famílias administrativas são emitidas explicitamente como admin. Rotação preserva a audiência e a expiração original; não move a família de um portal para outro.

O resolver passa a audiência esperada aos loaders de sessão. Um token válido de família app, mesmo copiado manualmente, não autentica admin, e vice-versa. A audiência persistida integra a snapshot/assertion transacional usada por gestão, mutations empresariais, trocas de escopo e senha. Campo ou header enviado pelo cliente não altera essa autoridade.

Mantêm-se `mesiva_session`, HttpOnly, Secure, SameSite=Strict, Path=/ e ausência de Domain compartilhado. Cada host recebe o próprio cookie e uma família diferente. Não transportar tokens em URLs, localStorage, postMessage, service binding de frontend ou redirect. Persistem 12 horas para dispositivo compartilhado e 7 dias para pessoal.

Logout revoga somente a família daquele portal. Revogação de vínculo/suspensão empresarial mantém o alcance da primeira entrega. Troca ou recuperação de senha continua uma ação da **conta global**: incrementa a revisão de credencial e invalida as sessões correspondentes em ambos os portais, conforme o comportamento existente. A tela informa esse alcance antes da confirmação.

## 7. Convites e recuperação

Convites de primeiro gerente/equipe emitidos na administração continuam apontando para `AUTH_PUBLIC_ORIGIN` do aplicativo, no ambiente correto. O destinatário recebe/aceita o acesso ao restaurante; não passa pelo portal administrativo e não recebe grants platform.

Recuperação solicitada no admin aponta para `AUTH_ADMIN_ORIGIN`. Acrescentar audiência app/admin em `identity_challenges`, default app para links anteriores. A audiência é derivada do host validado e persistida; emissão/delivery usam esse fato, não um return URL fornecido pelo cliente. Inspeção/consumo em host incorreto não consome o challenge e retorna o erro genérico de link inválido. Conclusão continua retornando sucesso de recuperação, sem login automático.

No admin, a solicitação tem a resposta genérica atual; só emite mensagem para conta verificada/ativa e com o grant administrativo exigido. Um challenge válido já emitido permite recuperar a própria credencial mesmo que o grant seja removido depois; não restaura o grant nem libera login administrativo. Links anteriores app continuam válidos no app até expiração. Quotas, cooldown, hashing, expiração, auditoria sanitizada e resultados accepted/rejected/uncertain são preservados.

Testes de e-mail usam destinatários e provider fictícios. Nunca copiar secrets, credenciais ou dados de produção para preparar homologação/local.

## 8. Transição e tentativas sem resposta

O corte tem duas fases verificáveis, usando o mesmo código de contrato de audiência:

1. **Prepare:** aplicar schema e publicar suporte aos novos hosts/portal. O app mantém temporariamente o fluxo administrativo anterior. Admin só aceita audiência admin; app só aceita app. Confirmar domínios, login independente, rotas, recuperação e matriz de APIs em staging, depois repetir a ativação autorizada em produção.
2. **Enforced:** após aceite do portal, fechar novos logins/seleções platform no app, remover suas entradas de UI e habilitar redirects antigos. Novas ações administrativas existem apenas no admin. Os endpoints operacionais e a estação QZ/TV continuam no app.

Chamadas autorizadas antes da troca podem concluir; não tratá-las como não executadas porque a resposta foi perdida. A mudança de domínio não gera retry automático, troca de chave ou duplicação de envio. Owners de provisioning e management continuam acima das páginas, por autor, com aviso de saída enquanto pending/uncertain.

Famílias app antigas cujo escopo atual seja platform conservam somente sessão/logout e uma ponte de leitura de receipts, sempre com grants atuais e autor/ambiente originais:

- GET de management-attempt já existente, sob a empresa e chave.
- Novo GET `/api/platform/provisioning-attempts/:key`, scoped ao account_id da receipt e a view/create, retornando apenas a projeção sanitizada do cadastro confirmado. Ausência de receipt é 404 e não prova que uma chamada anterior falhou.
- Para clientes anteriores ao prepare, o POST antigo de criação pode atender **somente replay de receipt já existente**, com autor/chave/hash de input correspondentes. Esse adaptador não chama o caminho de criação, reserva quotas, muda state ou envia e-mail. Sem receipt, responde 409 `ADMIN_PORTAL_REQUIRED`, mantendo a tentativa incerta; payload divergente não é replay.

Não permitir listagem, detalhes gerais, novos cadastros, reenvios, gestão de vínculos ou ciclo por essa ponte. Não emitir/estender famílias app platform em `enforced`. A ponte expira com as famílias existentes, no máximo 7 dias após o último login anterior ao corte; pode ser retirada em limpeza posterior à comprovação de expiração. Não remover receipts/auditoria.

O cliente atualizado consulta receipts sem POST; não redireciona uma aba com tentativa ainda pendente. Confirmado o resultado, permite seguir ao novo login. Replays no admin usam a mesma autoria/contrato persistido. Não transferir payload de motivo, credencial ou token ao outro host.

## 9. Publicação, recuperação e verificação

Manter GitHub Actions e `wrangler.jsonc` como autoridade. O PR da segunda entrega deve ser admitido explicitamente para staging manual, preservando PR aberto, head atual e CI do SHA exato. Os workflows validam duas origens por ambiente e continuam usando somente seus bindings. Produção permanece manual, master-only, com CI/staging aprovados para o mesmo SHA e restore point D1 antes de migrations.

Em staging: matriz completa com contas/empresas fictícias, domínios e provider simulado quando possível; envio real controlado somente quando autorizado. Em produção: smoke de leitura de modo de autenticação, disponibilidade e identidade do workflow, seguido de login humano autorizado. Não criar pedidos, pagamentos, convites reais ou impressões físicas como smoke automático.

Não fazer rollback para um bundle que ignore audiência/política dos portais depois de emitir sessões admin. Preferir correção adiante ou voltar somente a uma versão prepare que já respeite audiência e os hosts corretos. Desabilitar o novo domínio enquanto o app continua enforced bloquearia a administração; restaurar o caminho de acesso e a política em conjunto, sem down-migration improvisada ou perda de dados.

| Verificação | Evidência exigida no plano |
| --- | --- |
| Hosts/configuração | Matriz prod/staging/local, hosts desconhecidos, forwarded host, workers.dev, origens malformadas; nenhum binding cruzado |
| HTML/bootstraps | Admin entrega admin.html em root/deep links; não monta App/QZ/TV nem chama bootstrap empresarial; operação preservada |
| Sessão | Mesma conta com dois cookies/famílias; logout independente; replay manual no outro host rejeitado; snapshots de audiência; senha global |
| APIs | App não cria/seleciona platform em enforced; admin não acessa negócio/TV; Origin/contexto/capabilities revalidados; nenhum efeito em rota bloqueada |
| Links | Convite sempre no app correto; recuperação no portal de emissão; challenge no host errado não consumido; redirects sem query/fragmento/segredo |
| Upgrade/receipts | Schema limpo e upgrade de 0041; sessões e links antigos; pending/uncertain na troca; provisioning replay somente leitura, chave/hash/autor e nenhuma entrega duplicada |
| UX | Desktop/mobile, temas, foco/teclado, estados vazios/erro/offline, guards de saída, conta sem vínculos e conta sem grants |
| Gates | Suíte completa, arquitetura, lint, build com entradas distintas, Worker dry-runs, D1 real e smokes dos dois hosts por ambiente |

## 10. Áreas de implementação e documentação

Começar por `src/main.jsx`, a nova composição em `src/app/`, `src/domains/platform/ui/PlatformRoutes.jsx`, `PlatformShell.jsx` e seus owners/API. Componentes de conta necessários entram por exports do domínio access, sem importar o shell completo de configurações. Alterações em App/AppShell/CompanySelection ficam restritas à retirada/transição administrativa; não alterar workflows de pagamentos ou impressão.

Worker: resolver de portais em módulo próprio, aplicado na entrada; `worker/identity/authApi.js`, `sessions.js`, `challenges.js`, `emailMessages.js`; rotas de platform e projeções de receipts. Reutilizar contratos puros em `shared/` para paths/audiências, sem importar domínios em shared. Vite, wrangler e smokes recebem a matriz revisada. Migrations existentes não são editadas.

Na entrega de código, atualizar README, operação multiempresa e runbook para endereços, logins, comandos locais, fases de publicação e rollback. Ajustar testes que hoje fixam apenas um domínio por ambiente sem retirar suas garantias de isolamento. Preservar planos/specs/QA anteriores como história da primeira entrega.

## Referências

- [Gestão administrativa publicada — spec anterior](2026-10-05-platform-company-management-design.md).
- [Operação multiempresa](../../operations/multi-company-production.md) e [runbook de publicação](../../release-and-migration-runbook.md).
- [Cloudflare: Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/) — múltiplos domínios por Worker e configuração pelo Wrangler.
- [Cloudflare: Worker antes de static assets](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/) — controle do encaminhamento de HTML/assets.
- [RFC 6265, seção 8.5](https://www.rfc-editor.org/rfc/rfc6265#section-8.5) — cookies não oferecem isolamento por porta.

## Revisão desta etapa

Contexto e consumidores de auth, cookies, famílias, challenges, receipts, bootstrap, bindings e smokes foram inspecionados. O usuário aprovou a arquitetura, a transição e os limites deste documento. O método preservado é implementação sequencial neste chat, com revisão independente ao final; falta revisar/aprovar o plano escrito antes da implementação. Esta etapa altera somente documentação, mantendo a base e os servidores/bancos existentes.
