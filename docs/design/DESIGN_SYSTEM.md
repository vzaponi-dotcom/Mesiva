# Mesiva — Design System e aplicação visual no produto

- **Tipo:** documentação viva da identidade aplicada ao produto, tokens, temas, componentes e critérios de revisão.
- **Versão:** v0.4 — feedback de ações aprovado em 19/10/2026; demais baselines de v0.3 preservadas.
- **Baselines de implementação:** inspeção original em `master@e595f7ed2a801fde6ffab231194788430cc53316`; temas, CSS, assets SVG e componentes de Cozinha/TV reconferidos em `master@9289523f9b3c6094ed8f27a66b05aa527f25d16d`. Não equivale à reauditoria visual de todas as telas.
- **Fontes de marca:** [governança GitHub dos guias v1.1 e v1.0](identidade-visual/README.md) (quatro binários incorporados e verificados na branch da PR #119), [refinamento aprovado de logo (02/10/2026)](../operations/2026-10-02-mesiva-logo-refinement.md), [atualização de ícones (02/10/2026)](../operations/2026-10-02-github-releases-and-mesiva-icons.md) e ativos em [`public/brand/`](../../public/brand/).
- **Escopo:** documentação da direção aprovada no guia, decisões posteriores registradas e **implementação observável no repositório**; não é redesign, auditoria WCAG completa ou homologação de dispositivos.
- **Situação normativa:** a **edição v1.1 foi aprovada** em 17/10/2026, conciliando editorialmente os ativos de 02/10 com o guia original. **Seus arquivos PDF/Word e os da v1.0 foram incorporados à branch da PR #119 com hashes verificados**; as cinco divergências abaixo permanecem como registro histórico e decisões distintas de implementação.

**Para agentes:** este arquivo responde **como apresentar** o produto, não substitui o [PRD](../product/PRD.md), as [regras de negócio](../product/BUSINESS_RULES.md), a [arquitetura](../architecture/ARCHITECTURE.md), o [mapa de módulos](../architecture/MODULE_MAP.md) ou as [instruções operacionais](../../AGENTS.md). **Não alterar** SVGs, paleta, comportamento, permissões, rotas ou produção apenas com base nesta consolidação.

Feedback de ações da seção 5.1 conferido em `abd74b0d`; evidências e limites na [QA](../superpowers/qa/2026-10-19-action-feedback.md). Demais baselines acima preservadas.

## 1. Fontes, cronologia e autoridade

| Fonte | O que ela de fato determina | Limitação / relação com as demais |
| --- | --- | --- |
| **Guia oficial Mesiva v1.1, aprovado em 17/10/2026** | Consolida editorialmente vetor, variantes, ícones, slogan português e duas cores com papéis diferentes; documento aprovado | [PDF aprovado](identidade-visual/00_Mesiva_Guia_oficial_identidade_visual_v1.1.pdf) e [Word aprovado](identidade-visual/00_Mesiva_Guia_oficial_identidade_visual_v1.1.docx) incorporados e verificados conforme o [manifesto de governança](identidade-visual/README.md) |
| **Guia oficial Mesiva v1.0, 23/09/2026** | Direção inicial, paleta, contrastes, linguagem, revisão e governança | **Versão histórica**; em sua emissão, fonte, vetor, variantes de logo/ícones e slogan final constavam pendentes. Arquivos originais preservados no [histórico verificado](identidade-visual/historico/README.md) |
| **Refinamento do logo de 02/10/2026** | Registra aprovação posterior do vetor com curvas ajustadas, variantes claro/escuro, lettering e slogan **“Pessoas. Sabor. Evolução.”** | Decisões posteriormente formalizadas na v1.1 aprovada; a cópia binária está incorporada e verificada na branch da PR #119 |
| **Ativos versionados em `public/brand/`** | São os arquivos **efetivamente disponíveis para uso na aplicação**; o código aponta para eles | A geometria/cor do SVG não deve ser alterada para “corrigir” divergências documentais sem revisão e autorização |
| **Tokens e componentes do repositório** | Revelam como a UI está implementada na baseline e o efeito dos modos de tema | Não significam certificação de contraste/acessibilidade nem tornam todo estilo legado normativo |
| **`docs/mesiva-kitchen-visual.md`** | Diretrizes datadas de Cozinha, Comandas, navegação e homologação | Complementa a implementação da área; não revoga regras de negócio nem é o catálogo universal de componentes |

**Regra de consulta em mudança visual:** a versão **v1.1 aprovada** é a referência editorial vigente; consultar também o registro do refinamento de outubro, os assets `public/brand/` e o Design System para aplicação em UI. Os arquivos aprovados estão acessíveis pelos links do manifesto. Diante de dúvida não resolvida, **escalar para aprovação do proprietário**. Ordem: guia aprovado vigente → ativos finais aprovados → documentação viva → histórico.

### 1.1 Registro de divergências e decisões pendentes

| ID | Divergência observada | Tratamento seguro até decisão formal |
| --- | --- | --- |
| **DV-01** | Guia v1.0: SVG mestre, variantes, ícones e família exata do logo pendentes. Repositório e registro de 02/10: arquivos vetoriais e ícones implementados e revisados. | **Usar os arquivos versionados já aprovados em outubro**, sem redesenhá-los. A v1.1 aprovada foi incorporada com hashes verificados, mantendo a v1.0 histórica. |
| **DV-02** | Guia v1.0 indica slogan definitivo em aberto; refinamento de 02/10 aprova **“Pessoas. Sabor. Evolução.”** e remove o slogan inglês dos ativos. | Usar o slogan em português nos contextos atuais; preservar a v1.0 como histórico, conforme a v1.1 aprovada. Não recuperar “People. Food. Progress.” de mockups. |
| **DV-03** | Verde-água **`#14B8A6`** consta no guia e em `--brand` do tema Mesiva. Os **paths dos SVGs finais** usam verde **`#0F9F91`**. | Distinguir **cor de referência da marca/tokens** da **cor usada no vetor final**. **Não recolorir** o SVG por paleta estimada. Uma eventual unificação requer aprovação de ativo e atualização do guia. |
| **DV-04** | `src/index.css` ainda contém cores vermelhas da variante **Clássico** e `src/brand.css` / `BrandLogo.jsx` preservam representações legadas. | Não tratá-las como nova marca Mesiva nem removê-las sem rastrear usos. O app suporta seleção **Clássico/Mesiva**; a marca Mesiva usa `public/brand/`. |
| **DV-05** | Guia v1.0 não define família exata do lettering do logo; registro de outubro descreve contornos vetorizados e geração do slogan. | **Não** recriar o lettering com uma fonte “parecida”, nem distribuir fontes. A tipografia da **interface** permanece a pilha funcional vigente, distinta do desenho do logotipo. |

**Atualização de governança (17/10/2026):** o proprietário aprovou a **edição documental v1.1** do guia em Word/PDF (10 páginas), que formaliza os vetores, variantes, ícones e slogan aprovados anteriormente. As DV-01–DV-05 descrevem diferenças **históricas** entre a edição v1.0 e os ativos de outubro; a edição v1.1 registra o histórico, sem autorizar recolorir ativos, apagar o tema Clássico, criar logo novo ou declarar certificação de acessibilidade. **Repositório GitHub é a fonte oficial; PDF/Word v1.1 e histórico v1.0 foram incorporados à branch da PR #119 com tamanhos e hashes verificados**. O Google Drive deixa de ser dependência operacional. Consulte o [manifesto de versões](identidade-visual/README.md).

## 2. Identidade da marca

**Nome em texto:** **Mesiva** (M maiúsculo, demais letras minúsculas). Tom acolhedor, claro, moderno e profissional, adequado à gestão operacional de restaurantes. Evitar aparência infantil, excessivamente decorativa ou corporativa fria.

**Símbolo:** “M” arredondado incorporando **garfo e colher em espaço negativo**, com detalhe amarelo acima. Não misturar geometrias de estudos, escalar deformando, rotacionar, reconstruir por CSS/fonte nem usar print de mockup como arquivo de produção.

**Assinaturas:** priorizar o logo horizontal em superfícies de acesso/apresentação; usar símbolo isolado nos ícones e áreas pequenas onde houver ativo próprio. O logo escuro é **um arquivo vetorial dedicado**, não resultado de `filter: invert()`.

**Slogan aprovado posteriormente:** **Pessoas. Sabor. Evolução.** Em interface operacional compacta, preferir a forma sem texto adicional/ícone apropriado **se houver asset aprovado para o caso de uso**; não encolher a assinatura a ponto de tornar slogan e talheres ilegíveis. “Gestão para restaurantes” funciona como descritor, não substituto automático do slogan.

### 2.1 Assets existentes e uso

| Ativo | Uso observado / recomendado na implementação | Fonte |
| --- | --- | --- |
| `/brand/mesiva-logo.svg` | Assinatura horizontal em fundo claro, inclusive sidebar e topo mobile | [SVG claro](../../public/brand/mesiva-logo.svg), [Sidebar.jsx](../../src/app/shell/Sidebar.jsx), [AppTopBar.jsx](../../src/app/shell/AppTopBar.jsx) |
| `/brand/mesiva-logo-dark.svg` | Assinatura horizontal em fundo escuro e tela de acesso escura | [SVG escuro](../../public/brand/mesiva-logo-dark.svg), [mesiva-shell.css](../../src/mesiva-shell.css), [AccessAuthLayout.jsx](../../src/shared/ui/AccessAuthLayout.jsx) |
| `/brand/mesiva-icon.svg` | Símbolo com fundo definido no próprio vetor, para ícone; não é logo horizontal transparente | [Ícone SVG](../../public/brand/mesiva-icon.svg) |
| `/brand/mesiva-favicon.svg`, `mesiva-favicon-32.png` | Favicons | [Favicon SVG](../../public/brand/mesiva-favicon.svg), [index.html](../../index.html) |
| `mesiva-icon-180.png`, `mesiva-icon-192.png`, `mesiva-icon-512.png` | Atalhos/iOS e PWA | [site.webmanifest](../../public/site.webmanifest), [index.html](../../index.html) |
| `mesiva-email-logo.png` | Assinatura raster nos e-mails e exportação de relatório executivo conforme registro de outubro | [Registro da aprovação](../operations/2026-10-02-mesiva-logo-refinement.md) |

**Proteção e redução:** o guia v1.0 propõe **provisoriamente** área livre de pelo menos **25% da altura do símbolo** em volta e solicita testes do símbolo em **16, 24, 32 e 48 px**. Tais medidas **não foram formalizadas como limites mínimos finais**. Não inventar minimum-size oficial; conferir a aplicação real em cada superfície.

**Marca da Mesiva ≠ logo do restaurante:** a operação pode ter identidade própria, obtida por API e R2. Usar [OperationLogo.jsx](../../src/app/shell/OperationLogo.jsx) para a imagem da empresa nos locais apropriados; não substituir indevidamente a marca da plataforma.

## 3. Cor: paleta, tokens e semântica

### 3.1 Paleta de referência do guia v1.0

| Cor | Hex | Papel no guia |
| --- | --- | --- |
| Verde-água Mesiva | **`#14B8A6`** | Identidade e destaques visuais |
| Azul-marinho | **`#0F2747`** | Assinatura, texto forte e ações com bom contraste |
| Menta | **`#DFF7F1`** | Superfície e destaque suave |
| Amarelo | **`#FBBF24`** | Acento pontual; **não** significa automaticamente alerta |
| Nuvem | **`#F8FAFC`** | Fundo neutro |
| Branco | **`#FFFFFF`** | Superfície e contraste complementar |

A lista acima reproduz **o guia de setembro**, não substitui os valores internos dos SVGs finais. Os arquivos de logo de outubro usam adicionalmente `#0F9F91`, e o texto/slogan têm cores específicas às variantes — não são um conjunto alternativo de tokens de UI.

### 3.2 Contraste calculado no guia

O guia apresenta os valores abaixo para cores opacas em sRGB:

| Texto / fundo | Contraste informado | Uso |
| --- | ---: | --- |
| Marinho / branco | **14,98:1** | Adequado |
| Marinho / verde-água | **6,02:1** | Adequado |
| Marinho / menta | **13,35:1** | Adequado |
| Marinho / amarelo | **8,98:1** | Adequado |
| Branco / verde-água | **2,49:1** | **Não usar para texto normal** |
| Branco / amarelo | **1,67:1** | **Não usar para texto normal** |

**Meta de revisão visual estabelecida pelo guia:** **4,5:1** para texto normal; **3:1** para texto grande; **3:1** para elementos não textuais essenciais de controles/estados. Em fundo mesclado, translucidez, hover, disabled ou gradiente, **recalcular**. Esses números **não são um atestado de acessibilidade da UI atual**.

**Cores de marca não são estados de negócio:** verde-água não equivale a sucesso; amarelo da marca não equivale a “atenção”. Estados usam tokens semânticos próprios e **texto + ícone + cor** para evitar que a cor seja o único sinal.

### 3.3 Tokens da interface — fonte de implementação

O arquivo canônico de **tokens base** da aplicação é [`src/index.css`](../../src/index.css). As regras adicionais de layout/navegação da identidade estão em [`src/mesiva-shell.css`](../../src/mesiva-shell.css). O tema pode sofrer sobrescritas locais de componentes; inspecionar a **cascata calculada** antes de criar uma regra.

| Intenção | Variáveis existentes | Orientação |
| --- | --- | --- |
| Fundos e superfícies | `--bg`, `--surface`, `--surface-soft`, `--surface-strong` | Manter legibilidade da hierarquia e equivalentes escuros |
| Conteúdo e bordas | `--text`, `--text-soft`, `--muted`, `--border`, `--border-strong` | Priorizar valores, nomes, labels e leitura |
| Marca e ação | `--brand`, `--primary`, `--primary-fill`, `--primary-contrast`, `--primary-hover`, `--primary-soft`, `--accent` | `--brand` **não** é automaticamente fundo seguro de botão com texto branco |
| Estados de negócio | `--success`, `--warning`, `--danger`, `--info` e versões `-soft` | Estados devem ser distinguíveis também por texto/ícone |
| Interação | `--focus-outline`, `--selection-bg`, `--primary-control-border`, `--primary-field-border` | Validar foco visível e contraste após aplicar transparências |
| Cozinha no admin | `--kitchen-*` | Usar cores de status e superfícies próprias da área; não substituir por cor da marca |
| Navegação Mesiva | `--navigation-accent`, `--navigation-active` | Definidas em [mesiva-shell.css](../../src/mesiva-shell.css); seleção discreta |
| Densidade e camadas | `--radius-*`, `--shadow-*`, `--mobile-touch-target`, `--layer-*` | Reutilizar a escala do produto antes de inventar novos valores |

**Valores concretos observados na baseline, não uma nova paleta proposta:**

| Contexto | Fundo | Superfície | Texto | Primária / preenchimento |
| --- | --- | --- | --- | --- |
| **Mesiva claro** (`data-visual-theme="mesiva"`) | Base `#F8FAFC`, com override de shell `#F5F7FA` | `#FFFFFF` | `#0F2747` | `--primary-fill: #0F2747`, texto branco |
| **Mesiva escuro** (`data-theme="dark"` + `data-visual-theme="mesiva"`) | `#071827` | `#0B2036` | `#F8FAFC` | `--primary: #14B8A6`, porém **`--primary-fill: #244A72`** com `--primary-contrast: #FFFFFF` |
| **Clássico claro** (`data-visual-theme="classic"`) | `#F6F3F1` | `#FFFFFF` | `#25211F` | `#B7192B` |
| **Clássico escuro** | `#151211` | `#211D1B` | `#F7F2EF` | `#E34B5D` |

**Importante:** a tabela mostra tokens selecionados, não todos os estados ou cores derivadas. O vermelho do **Clássico** é compatibilidade visual de tema; **não** é cor da marca Mesiva. No escuro Mesiva o token de identidade `--primary` pode ser teal, mas botões preenchidos devem usar o token **`--primary-fill`** e seu par de contraste, não supor que ambos têm o mesmo valor.

## 4. Tema, tipografia, formas e espaçamento

### 4.1 Dois eixos de preferência do usuário

A implementação de [`theme.js`](../../src/app/shell/theme/theme.js) e [`ThemeProvider.jsx`](../../src/app/shell/theme/ThemeProvider.jsx) armazena **separadamente**:

- **Identidade visual:** `mesiva` (padrão na ausência/invalidade da preferência) ou `classic`, armazenada em `delivery-visual-theme`, refletida em `data-visual-theme`.
- **Luminosidade:** `light`, `dark` ou `system` (**Automático** por padrão), armazenada em `delivery-theme`; resolve preferência do sistema e aplica `data-theme` e `color-scheme`.

A tela [`DevicePreferences.jsx`](../../src/app/surfaces/settings/local/DevicePreferences.jsx) permite selecionar **Mesiva/Clássico** e **Claro/Escuro/Automático**. O atalho no [AppTopBar.jsx](../../src/app/shell/AppTopBar.jsx) alterna claro/escuro explicitamente (respeitando a permissão `preferences.local`). Falhas ao salvar preferência devem ser informadas; não declarar a mudança salva se o storage recusar a escrita.

**Aplicação coerente:** lateral, topo, menus, modais, controles, popovers, tooltips, notificações e telas de configuração devem acompanhar o tema **efetivo**. As logos Mesiva clara/escura são trocadas com ativo adequado no shell, nunca invertidas com filtro CSS.

### 4.2 Tipografia, densidade e geometria

- **UI existente:** pilha `Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` declarada em [`src/index.css`](../../src/index.css). Não assumir que Inter é baixada pela aplicação ou que a fonte exata do lettering do logo foi formalizada no guia.
- **Logo:** lettering é **contorno no SVG**, não texto montado com CSS. Não distribuir fonte de terceiros nem reconstruir a marca digitada.
- **Hierarquia:** título de tela claro; subtítulo só quando informa; rótulos, valores e estados legíveis. Ajustar densidade de listas, cozinhas, pagamentos e impressão para uso operacional, sem excesso de ornamentos.
- **Raios existentes:** `--radius-sm: 10px`, `--radius-md: 14px`, `--radius-lg: 20px`, `--radius-xl: 26px`; badges `--badge-radius: 6px` e `--badge-font-weight: 400`. Componentes possuem exceções locais; **não** transformar esses valores em imposição cega a todos os elementos.
- **Espaçamento:** o guia recomenda composição em **múltiplos de 4 px**, respeitando os tokens existentes e a densidade da área. Evitar gradientes de campanha em painéis analíticos, sombras pesadas, bordas brilhantes ou “glow” em botão primário; preserve foco.
- **Interação por toque:** meta interna do guia de **44 × 44 CSS px** para ações principais (ex.: `--mobile-touch-target: 44px`). O guia diferencia essa recomendação do critério WCAG 2.5.8, cujo mínimo referido é 24 × 24 com exceções — não afirmar equivalência automática.
- **Semântica:** ações destrutivas exigem rótulo inequívoco, permissão, estado disabled/loading adequado e confirmação pertinente; não usar sucesso/atenção como cor meramente decorativa.

## 5. Componentes reutilizáveis do código

**Preferir `src/shared/ui/`** antes de criar novos controles. Os componentes listados são **interfaces existentes**, não uma biblioteca externa, nem garantia de suporte às mesmas props de outro framework.

| Componente | Arquivo | Contrato e diretriz |
| --- | --- | --- |
| **Button** | [Button.jsx](../../src/shared/ui/Button.jsx) | `variant` (padrão `primary`), `icon`, `children` e atributos nativos. Estado visual opcional `state="idle\|loading\|success\|error"`; rótulos `loadingLabel`, `successLabel`, `errorLabel`. O workflow determina o resultado; o botão não interpreta Promises. |
| **Icon** | [Icon.jsx](../../src/shared/ui/Icon.jsx) | Conjunto SVG interno nomeado. Reutilizar nomes existentes; ícone auxilia, não substitui rótulo acessível. |
| **PageHeader** | [PageHeader.jsx](../../src/shared/ui/PageHeader.jsx) | `eyebrow`, `title`, `description`, `actions`. Manter hierarquia de título e acesso às ações. |
| **StatusBadge** | [StatusBadge.jsx](../../src/shared/ui/StatusBadge.jsx) | Deriva classe de status e permite `label`; componentes da área determinam a semântica real. Respeitar `--badge-radius`/`--badge-font-weight`. |
| **Modal** | [Modal.jsx](../../src/shared/ui/Modal.jsx) | Portal, `role="dialog"`, `aria-modal`, Escape, foco inicial, ciclo de Tab, restauro de foco e trava de scroll. Não eliminar esse contrato ao redesenhar. |
| **ConfirmationDialog** | [ConfirmationDialog.jsx](../../src/shared/ui/ConfirmationDialog.jsx) | Confirmação com ação perigosa por padrão. `submitting`/`loadingLabel` distinguem envio de `disabled` por permissão; envio bloqueia fechamento e novo acionamento. |
| **ToastRegion** | [ToastRegion.jsx](../../src/shared/ui/ToastRegion.jsx) | Apresenta `toasts`, `onDismiss`, `onPause`; montado pelo shell fora dos formulários. Fila e timers pertencem ao runtime de feedback. |
| **BottomSheet** | [BottomSheet.jsx](../../src/shared/ui/BottomSheet.jsx) | Painel modal móvel com controle de foco/scroll; consultar comportamento de sobreposição no mobile. |
| **SystemSelect** | [SystemSelect.jsx](../../src/shared/ui/SystemSelect.jsx) | Seletor customizado: lista desktop, bottom sheet no mobile (até 820 px), teclado e seleção. Revisar labels e nomes longos. |
| **StatCard** | [StatCard.jsx](../../src/shared/ui/StatCard.jsx) | Resumos quantitativos; manter números e unidades legíveis e rótulos claros. |
| **PasswordField** | [PasswordField.jsx](../../src/shared/ui/PasswordField.jsx) | Campo de senha; reutilizar sem introduzir alternativas inconsistentes. |
| **AccessAuthLayout** | [AccessAuthLayout.jsx](../../src/shared/ui/AccessAuthLayout.jsx) | Layout de autenticação com marca aprovada e assinatura em português. |

Outros componentes internos dos domínios devem ser localizados no [Module Map](../architecture/MODULE_MAP.md). O documento **não** recomenda trocar toda a interface por uma biblioteca nova nem centralizar elementos específicos de negócio indiscriminadamente em `src/shared/ui/`.

**Foco e menus:** o CSS global inclui `:focus-visible`; controles não podem depender somente de mouse. O `Modal` e o `BottomSheet` devem manter Escape/foco; o `SystemSelect` precisa continuar acessível por teclado, fechar quando apropriado e não ficar encoberto por modais. Em menus de ações, fechar após escolha e indicar indisponibilidade com texto/estado, não apenas opacidade.

### 5.1 Feedback de ações

Quando o botão permanece, confirmar nele por **1.800 ms**, somente após sucesso oficial. Nova edição ou troca de recurso invalida o check anterior. Quando formulário/card desaparece, fechar normalmente e confirmar com toast no destino; não atrasar a operação para mostrar animação. Se outra etapa abre imediatamente, apresentar o resultado parcial nessa etapa sem duplicar confirmação global. Rascunho, conflito e resultado não confirmado preservam seus avisos próprios.

Em configurações, reconsulta oficialmente confirmada pode produzir o mesmo check: aguardar o controller apresentar `ready` para exibi-lo e iniciar sua duração, preservando a tentativa, o recurso e o rascunho correspondentes.

[`useFeedbackRuntime`](../../src/app/runtime/feedback/useFeedbackRuntime.js) é o owner único da fila: três avisos visíveis, excedentes FIFO sem timer até promoção. Sucesso/informação duram **4 s**, atenção **6 s**, erro exige fechamento manual. Hover, foco e documento oculto pausam o tempo restante de forma independente; rerender não reinicia duração. Reset de sessão/empresa limpa coleção, fila e timers. Mensagens não acionam requests nem retries.

Toasts usam texto, ícone e tokens semânticos, superfície opaca e fechamento acessível; desktop até **420 px**, mobile com margens/safe-area e área de fechar de **44 px**. Regiões `status`/`alert` anunciam sem mover foco. `Button` mantém largura pelos rótulos, `aria-busy` durante envio e impede acionamento desabilitado; o owner da mutation mantém também seu bloqueio síncrono. Movimento reduzido remove animações, preservando o texto de estado.

Referências visuais escolhidas: [Morph Button / Spectrum UI](https://www.spectrumhq.in/docs/morph-button) (Apache-2.0) e [Animated Toast / Joly UI](https://www.jolyui.dev/docs/components/feedback/animated-toast) ([MIT, Johuniq](https://github.com/Johuniq/jolyui/blob/main/LICENSE)). A implementação é uma adaptação nativa em JSX/CSS/SVG, sem novas bibliotecas. [Spec aprovada](../superpowers/specs/2026-10-19-action-feedback-design.md) e [QA por SHA](../superpowers/qa/2026-10-19-action-feedback.md). Conexão, validação, recuperação de impressão e confirmação humana/spooler continuam persistentes; envio de teste não significa impressão física concluída.

## 6. Superfícies e responsividade

### 6.1 Aplicação administrativa

- **Desktop:** navegação lateral Mesiva, cabeçalho da operação e conteúdo com largura útil; a implementação atual usa shell com coluna lateral de **236 px** (faixa intermediária de **206 px**) e cabeçalho de **80 px**, com ajustes em [`mesiva-shell.css`](../../src/mesiva-shell.css). Esses são **valores implementados**, não restrições de marca universais.
- **Mobile:** breakpoint observado em **820 px**; lateral ocultada, topo e navegação inferior mantidos, fundo da página e overlay respeitando safe-area. Consultar [`mobile-foundation.css`](../../src/mobile-foundation.css), [`AppTopBar.jsx`](../../src/app/shell/AppTopBar.jsx) e [`mobile-navigation.css`](../../src/mobile-navigation.css).
- **Cozinha no admin:** priorizar cartões de preparo, observações, agendamentos e indicadores. Atraso, agendamento e finalização usam estados funcionais separados de `--brand`. Layout adapta colunas conforme espaço; consultar [`kitchen-refined.css`](../../src/kitchen-refined.css) e [referência de Cozinha/Comandas](../mesiva-kitchen-visual.md).
- **Comandas, mesas, financeiro e configurações:** priorizar nomes, valores, meios de pagamento e menus **sem corte**. Reorganizar em telas pequenas; não esconder nome de método de pagamento nem desativar uma ação por falta de espaço.
- **Cozinha após PR #117:** filtros de situação e modalidade são independentes; seleção precisa ser percebida pelo estado do controle, não só pela cor. Não misturar esses filtros com o controle sincronizado da TV. Referência: [`Orders.jsx`](../../src/domains/orders/ui/Orders.jsx).
- **Pedido editado (PR #108):** o [`OrderEditedBadge`](../../src/shared/ui/OrderEditedBadge.jsx) usa ícone e texto **Editado**, enquanto [`OrderEditChanges`](../../src/domains/orders/ui/components/OrderEditChanges.jsx) revela **Últimas alterações** no detalhe. Preservar leitura, revisão e significado do estado sem confundi-lo com novo pedido, confirmação de impressão ou pagamento.
- **Estados globais:** loading, vazio, erro, desconexão/offline, desabilitado, atenção e confirmação devem ser **distinguíveis**. Não presumir que o uso da cor correta garante a mensagem correta.

### 6.2 TV da Cozinha: superfície visual própria

A TV em `/cozinha-tv` tem bootstrap e CSS independentes ([`src/kitchen-display/`](../../src/kitchen-display/), [`kitchen-display.css`](../../src/kitchen-display/kitchen-display.css)). Ela usa **tokens `--kds-*` próprios**, como `--kds-bg`, `--kds-text`, `--kds-muted`, `--kds-green`, `--kds-blue`, `--kds-amber` e `--kds-red`. **Não** assumir que mudar `--primary` do admin altera com segurança a TV.

- Prioridade: ler pedidos à distância, número/nome, modalidade, observações, horário, agendados, atrasados e conexão.
- Filtros e paginação pertencem ao controle sincronizado com a TV, não a um status novo de pedido.
- **Identidade contextual (PR #118):** o cabeçalho do pedido local com cliente identificado exibe **`Mesa · Cliente`** conforme a projeção oficial do Worker. Se não houver cliente, manter o nome da mesa. Não retirar a informação da mesa por economia de espaço nem tentar remediar o dado apenas em CSS/JSX.
- **Histórico de edição (PR #108):** selo **Editado** e indicações de alterações devem ser visualmente distinguíveis do alerta de pedido recém-chegado.
- Compatibilidade depende do navegador/firmware; a tela de erro de compatibilidade deve permanecer legível e utilizável.
- Revisões visuais da TV exigem QA em dispositivo real quando possível; não tratar screenshots do desktop como homologação de todas as Smart TVs.

## 7. Texto, microcopy, acessibilidade e estados

**Linguagem:** português brasileiro, curta, direta e familiar a restaurante. O guia diz expressamente que os textos ingleses presentes em mockups são ilustrativos. Para a TV, o controle pode mostrar **“Retira” e “Mesa”** como nomes de filtro, embora os valores internos sejam **`Retirada` e `Local`**; consultar [Business Rules](../product/BUSINESS_RULES.md).

**Padrões a preservar:** rótulos associados aos campos, informação completa em tooltip/título acessível quando houver reticências, números e moeda com hierarquia legível, foco visível, mensagens que expliquem a ação, feedback não enganoso após mutação, controles por teclado, menus que não escondam ações e confirmation dialogs em operações destrutivas.

**Não certificar acessibilidade sem ensaio:** verificar contraste computado, teclado, tamanho dos alvos, zoom, foco após fechar modal, scroll e leitores assistivos nas superfícies impactadas. Um `aria-label` ou o simples uso de `StatusBadge` não garante conformidade completa.

**Impressão:** estados de fila `pendente`, `requer atenção`, `aguardando segunda via`, `impresso` e `descartado` não podem parecer idênticos. Diferenciar envio, resultado incerto e confirmação física; preservar avisos e confirmações para descarte em lote. O [runbook QZ](../operations/windows-qz-tray-printing.md) continua a fonte operacional.

## 8. Checklist de revisão de interface (para PR e homologação)

A lista é derivada do checklist do guia v1.0 e dos contratos observados no código. **Cumprimento exige testes e evidências da mudança**, não apenas revisar Markdown.

| Verificação | Critério mínimo de revisão |
| --- | --- |
| **Marca** | Nome “Mesiva”, variante SVG apropriada ao fundo, proporções e slogan em português; sem redesenho/recoloração improvisada |
| **Identidade e tema** | Mesiva/Clássico, claro/escuro/automático conforme suporte; sidebar, topo, modais, menus, badges e notificações sem resíduos visuais |
| **Contraste** | Conferir texto normal, texto grande, valores, botões, ícones de estado e foco nos fundos reais; atenção ao branco sobre verde-água/amarelo |
| **Leitura** | Métodos de pagamento, clientes, números, quantias, observações e títulos sem truncamento crítico; no mobile reorganizar sem esconder |
| **Interação** | Teclado, Escape, clique externo, foco/restauração, alvos de toque e estados disabled/loading |
| **Semântica** | Cor não é único indicador; distinguir sucesso, falha, aviso, informação, atenção, agendado, atraso, offline e descartado |
| **Navegação** | Troca de abas inicia no topo apropriado; testar F5, deep link, menus/submenus e scroll dentro/fora dos modais |
| **Responsividade** | Desktop representativo e mobile em **320 e 390 px**, além de tamanhos intermediários; TV real quando a mudança a afeta |
| **Operação** | Cozinha, comandas, financeiro e impressão não perdem acesso a ações nem significado dos estados |
| **Evidência** | Capturas/roteiro de QA, tema/dispositivo/largura, SHA e resultados explícitos de testes e homologação |
| **Liberação** | Sem alteração de comportamento ou publicação presumida; staging e produção seguem [runbook](../release-and-migration-runbook.md) |

### Texto sugerido para o corpo de futuras PRs visuais

> Referência visual: Mesiva — guia oficial **v1.1 aprovado em 17/10/2026**, histórico v1.0 (23/09/2026), refinamento de logo/ativos (02/10/2026) e `docs/design/DESIGN_SYSTEM.md`. Superfícies afetadas: […]. Modos testados: Mesiva/Clássico, claro/escuro/automático conforme aplicável. Evidências e SHA: […]. Divergências aprovadas ou pendentes: […].

## 9. Governança, próximos passos e manutenção

1. **Não iniciar um redesign automático.** Este documento não autoriza mudar CSS/JSX/ativos. Em cada tarefa visual, abrir o componente e seguir seu proprietário pelo [Module Map](../architecture/MODULE_MAP.md), com testes/regressões proporcionais ao impacto.
2. **Guia v1.1 aprovado e incorporado:** consultar PDF e Word em [docs/design/identidade-visual/](identidade-visual/README.md), com tamanhos e hashes verificados, e preservar a v1.0 sob `historico/`. Manter o manifesto e os links atualizados em futuras edições. Não reutilizar links do Drive como referência obrigatória.
3. **Não apagar o legado por interpretação:** tema Clássico e eventuais arquivos de marca anteriores exigem rastreamento de consumidores e decisão específica antes de remoção.
4. **Ao alterar marca ou tokens:** registrar fonte/aprovação, CSS/asset, telas afetadas, evidências desktop/mobile/escuro e, se aplicável, TV e impressão. Revisar contrastes em combinações reais.
5. **Ao alterar estados operacionais:** consultar [Business Rules](../product/BUSINESS_RULES.md) e runbooks; Design System não redefine preparo, pagamento, permissões, reserva nem fila de impressão.
6. **Produção:** alterações visuais seguem PR/CI/staging/homologação; merge e deploy dependem de autorização separada.

**Referências:** [Índice documental](../README.md) · [PRD](../product/PRD.md) · [Arquitetura](../architecture/ARCHITECTURE.md) · [Mapa de módulos](../architecture/MODULE_MAP.md) · [Guias oficiais Mesiva — governança GitHub](identidade-visual/README.md) · [Refinamento de marca](../operations/2026-10-02-mesiva-logo-refinement.md) · [Identidade Cozinha/Comandas](../mesiva-kitchen-visual.md).

**Atualização:** documentar edição/PR/SHA sempre que tokens, componentes públicos, temas ou ativos aprovados mudarem. O Design System não substitui o guia v1.1 aprovado. **A v1.1 aprovada e a v1.0 histórica estão incorporadas e verificadas na branch da PR #119; isso não representa merge na `master`.** Esta atualização não executa deploy.
