# Mesiva — Guia oficial de identidade visual e histórico

**Status:** centralização de identidade visual no **GitHub aprovada em 17/10/2026**; **upload dos quatro binários pendente** nesta PR. Este índice não declara que os documentos já estão disponíveis para download.

## Fonte oficial e estrutura

A **v1.1** é a edição *editorialmente aprovada* do guia Mesiva, em PDF e Word (10 páginas). A **v1.0**, datada de 23/09/2026, é histórico (PDF com 9 páginas). A versão vigente só terá um **link definitivo no GitHub depois de os bytes serem enviados e os hashes verificados**.

| Destino dentro deste diretório | Papel | Estado |
| --- | --- | --- |
| `00_Mesiva_Guia_oficial_identidade_visual_v1.1.pdf` | Referência visual oficial vigente para leitura | **Pendente de upload** |
| `00_Mesiva_Guia_oficial_identidade_visual_v1.1.docx` | Fonte editável de manutenção do guia | **Pendente de upload** |
| `historico/00_Mesiva_Guia_oficial_identidade_visual_v1.0.pdf` | Registro histórico original, sem sobrescrever | **Pendente de upload** |
| `historico/00_Mesiva_Guia_oficial_identidade_visual_v1.0.docx` | Fonte editável histórica | **Pendente de upload** |

A subpasta [`historico/`](historico/README.md) mantém o registro original. Os logos e ícones **de produção** já estão em [`public/brand/`](../../../public/brand/); não duplicar ativos no guia nem reconstruir o vetor a partir de uma imagem.

## Integridade — arquivos originais e aprovados

As medidas abaixo são obtidas dos arquivos efetivos aprovados; `git blob SHA-1` é o identificador esperado em `git ls-tree`/GitHub Tree após upload. **Não confundir hash previsto com upload já realizado.**

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
- **Fonte oficial após a publicação dos bytes:** este diretório em GitHub, com PR, SHA e histórico. O Drive deixa de ser necessário para consumir ou atualizar a identidade visual.
- **Aplicação técnica:** consultar [Design System](../DESIGN_SYSTEM.md) e `public/brand/` antes de tocar em JSX/CSS.

## Fechamento da migração — PR #119

1. Fazer upload dos **quatro arquivos binários sem modificá-los** à branch `codex/docs-visual-guide-v1-1-approval-2026-10-17`, nos caminhos exatos da tabela; não enviar à `master` diretamente.
2. Comparar `size`, `SHA-256` e/ou `git blob SHA-1` da árvore da branch com a tabela. Parar se não corresponderem.
3. Substituir os nomes em código neste índice por **links relativos aos arquivos efetivamente existentes** e marcar os quatro uploads como verificados.
4. Atualizar [índice geral](../../README.md), [Design System](../DESIGN_SYSTEM.md) e PR #119, e verificar links/CI/diff antes de solicitar merge. O histórico v1.0 deve permanecer acessível e identificado como histórico.
5. **Sem autorização automática de merge ou deploy.** Mudanças documentais não implicam nova versão do software ou publicação remota.

> **Importante:** nenhum link para PDF/DOCX é emitido neste estado porque os arquivos ainda não constam da árvore Git. É proibido afirmar que o guia já está hospedado no GitHub.
