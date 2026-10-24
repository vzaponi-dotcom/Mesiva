# PR #124 — alinhamento UX/UI ao protótipo aprovado

Data: 23/10/2026. Referências fornecidas pelo usuário: `mesiva_conferencia_do_dia_revisada.html`, `mesiva_conferencia_revisada_desktop.png`, `mesiva_conferencia_revisada_mobile.png`, `mesiva_conferencia_do_dia_plano_revisado.md`.

## Problema identificado
A versão React entregue pelo MVP preservava o conteúdo financeiro, mas sua hierarquia visual não correspondia ao protótipo **aprovado em 9,2/10**:
- Indicadores no topo eram **bruto / estornos / líquido**, em vez de **registrado no Mesiva / valor informado / diferença**.
- Não havia a faixa compacta de progresso da conferência.
- No desktop, cada forma ocupava um cartão grande com quatro subtotais; o protótipo usa **uma tabela compacta** com comparação lado a lado.
- O histórico era oculto até clicar em um botão, em vez de ter sua própria seção sempre visível.
- O detalhe aparecia como painel inline, em vez de **drawer lateral**.
- As formas não tinham a ordenação familiar de Pix, dinheiro, débito e crédito.

## Correções realizadas
1. Reorganização visual sem modificar APIs, cálculos oficiais, banco, migrations, autenticidade de usuário ou autorização.
2. Resumo com três KPIs financeiros comparáveis; valor em branco é diferente de zero. Bruto e estornos continuam apresentados na orientação do quadro e nas linhas com ajuste.
3. Faixa de progresso com data, estado, contagem de formas verificadas, revisão/responsável se houver; sem buscar histórico adicional.
4. Tabela financeira compacta em tela larga. Em viewport de até 1080px, linhas viram cartões de duas colunas, mantendo inputs, estados, foco, detalhamento e botão de conferência acessíveis.
5. Histórico como cartão permanente: mostra última revisão recebida na resposta já existente; carregar até 30 revisões requer clique explícito, evitando leitura D1 extra na abertura.
6. Detalhes renderizados no componente oficial `Modal` com variante CSS de drawer, preservando o trap de foco, Escape, scroll lock, dados originais, paginação e controle de versão.
7. Ordenação amigável apenas no frontend (Pix → dinheiro → débito → crédito → demais), sem alterar fonte canônica ou cálculos.
8. Uso do `Icon`, `Button`, `PageHeader`, tokens de tema, shell e `AreaNavigation` oficiais, sem copiar HTML do mockup, logo ou estilos de navegação de demonstração.
9. CSS legado sem uso removido. Nenhuma biblioteca ou dependência adicionada.

## Verificação e critérios para homologação visual em staging
- [ ] 1440px claro/escuro: três indicadores lado a lado, tabela compacta alinhada, nenhum overflow.
- [ ] 1024px: cartões responsivos devido à sidebar; nenhuma coluna cortada.
- [ ] 768, 375, 320px claro/escuro: cartões legíveis, botões tocáveis e histórico após a conferência.
- [ ] Conferência com valores não preenchidos: KPI valor informado/diferença exibe travessão; não soma como zero.
- [ ] Com Pix −100 e dinheiro +100, diferenças individuais seguem visíveis e exigem ressalva; valor total zero não encerra sem justificativa.
- [ ] Entrada de valor desmarca verificação anterior; foco/teclado funcionam.
- [ ] Abrir, paginar e fechar o drawer; Escape e retorno de foco preservados.
- [ ] Histórico mostra revisão atual sem query extra; só consulta lista quando aberta.
- [ ] Data, CSV, erros, integridade, revisão e permissões continuam corretos.
- [ ] Antes de testar, conferir `/release.json` no staging: deve refletir SHA exato autorizado e CI verde.

## Limites
Revisão feita a partir dos **artefatos aprovados** e do **código React vigente**, sem login de staging disponível em perfil de browser externo. Não é certificação de paridade visual pixel a pixel, acessibilidade WCAG nem QA autenticado após esta alteração. A homologação humana permanece necessária.

**Publicação:** somente em staging com workflow oficial e CI verde do commit exato; PR #124 segue Draft, sem merge ou produção.
