# Mesiva — Guia oficial de identidade visual e histórico

**Status:** centralização de identidade visual no **GitHub aprovada em 17/10/2026**; **quatro binários incorporados e verificados** na branch da PR #119. PDF e Word estão disponíveis nos links abaixo; merge e deploy não foram realizados.

## Fonte oficial e estrutura

A **v1.1** é a edição *editorialmente aprovada* do guia Mesiva, em PDF e Word (10 páginas). A **v1.0**, datada de 23/09/2026, é histórico (PDF com 9 páginas). Os quatro arquivos preservam os bytes aprovados, com tamanhos, SHA-256 e SHA-1 dos blobs Git conferidos contra o manifesto abaixo.

| Destino dentro deste diretório | Papel | Estado |
| --- | --- | --- |
| [00_Mesiva_Guia_oficial_identidade_visual_v1.1.pdf](00_Mesiva_Guia_oficial_identidade_visual_v1.1.pdf) | Referência visual oficial vigente para leitura | **Publicado na branch; verificado** |
| [00_Mesiva_Guia_oficial_identidade_visual_v1.1.docx](00_Mesiva_Guia_oficial_identidade_visual_v1.1.docx) | Fonte editável de manutenção do guia | **Publicado na branch; verificado** |
| [historico/00_Mesiva_Guia_oficial_identidade_visual_v1.0.pdf](historico/00_Mesiva_Guia_oficial_identidade_visual_v1.0.pdf) | Registro histórico original, sem sobrescrever | **Publicado na branch; verificado** |
| [historico/00_Mesiva_Guia_oficial_identidade_visual_v1.0.docx](historico/00_Mesiva_Guia_oficial_identidade_visual_v1.0.docx) | Fonte editável histórica | **Publicado na branch; verificado** |

A subpasta [`historico/`](historico/README.md) mantém o registro original. Os logos e ícones **de produção** já estão em [`public/brand/`](../../../public/brand/); não duplicar ativos no guia nem reconstruir o vetor a partir de uma imagem.

## Integridade — arquivos originais e aprovados

As medidas abaixo foram conferidas nos quatro arquivos importados do patch binário, sem alteração de bytes. `git blob SHA-1` identifica o conteúdo em `git ls-tree`/GitHub Tree.

| Arquivo | Bytes | SHA-256 | SHA-1 do blob Git |
| --- | ---: | --- | --- |
| v1.1 PDF | 580403 | `e973e8e11e04cae39f217fb3fba95a7c9d9a14fbddd57d8a0a8b1b98ebb2ae03` | `326ee9cf2d5c0b0020bc6dc37e133ebed37d5b1d` |
| v1.1 DOCX | 2165936 | `7b7659fd18d74ba3034c24953b6626a56028da8f534144712004aeb2699b5dcc` | `bd1ee319b3bb741458b426856c80306f650b35fc` |
| v1.0 PDF | 534141 | `c110e9b98b527468f2927374f68c8f170ca5682f2cab6d1c66c4874cc2aaa049` | `18fdde893b15419f41f68c7c277f78827ea564c9` |
| v1.0 DOCX | 2108518 | `afffd45800cf1aafabce839af9fcf7880c968e083de20905a9c5bc89b0f5b101` | `f66a0aad191e7724dbda77d1e44f5d923aaea9ef` |

## Aprovação, precedência e limites

- **23/09/2026:** edição v1.0 histórica, com algumas definições técnicas da marca ainda em aberto.
- **02/10/2026:** refinamento aprovado do SVG, versões clara/escura, ícones, lettering vetorizado e slogan **“Pessoas. Sabor. Evolução.”**. Fonte de contexto: [registro de refinamento](../../operations/2026-10-02-mesiva-logo-refinement.md).
- **17/10/2026:** edição v1.1 do guia Word/PDF **aprovada**; integra as decisões acima e diferencia a cor de referência da UI (`#14B8A6`) da cor do vetor aprovado (`#0F9F91`). Não implica recoloração, exclusão do tema Clássico nem testes de contraste em todas as telas.
- **Fonte oficial:** este diretório em GitHub, com PR, SHA e histórico. O Drive deixa de ser necessário para consumir ou atualizar a identidade visual.
- **Aplicação técnica:** consultar [Design System](../DESIGN_SYSTEM.md) e `public/brand/` antes de tocar em JSX/CSS.

## Fechamento da migração — PR #119

- [x] Quatro arquivos binários incorporados sem alteração à branch `codex/docs-visual-guide-v1-1-approval-2026-10-17`, nos caminhos exatos da tabela.
- [x] Tamanhos, SHA-256 e SHA-1 dos blobs Git conferidos: quatro correspondências com o manifesto.
- [x] Links relativos habilitados para os quatro arquivos verificados, preservando o histórico v1.0.
- [x] [Índice geral](../../README.md), [Design System](../DESIGN_SYSTEM.md), instruções dos agentes e índice histórico atualizados para refletir a importação.
- [x] Validação da importação em `8c223138`: 8/8 shards e job `validate` aprovados no [CI #39054383291](https://github.com/vzaponi-dotcom/Mesiva/actions/runs/39054383291); 151 links locais verificados (incluindo uma âncora), zero ausentes. Este registro documental posterior exige seu próprio CI antes de considerar a PR pronta.

**Sem autorização automática de merge ou deploy.** Mudanças documentais não implicam nova versão do software ou publicação remota.

> **Importante:** a incorporação dos arquivos à branch da PR #119 não representa merge na `master` nem publicação do software.
