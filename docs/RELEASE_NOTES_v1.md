# Primeira release do Dinheirovisky — rascunho

**Versão e data a confirmar. Não publicado.** O código desta preparação usa 0.1.0.

Dinheirovisky. Seu bolso agradece.

Aplicativo desktop de finanças pessoais com armazenamento local, uso offline e sem login.

## Incluído

Contas, categorias, transações e transferências; cartões, parcelas e faturas; dashboard e relatórios; orçamento, recorrências e metas; busca, metadados e anexos; importação CSV/OFX com prévia; backup e restauração; temas e preferências regionais.

## Download e requisitos

Windows x64 com WebView2 Runtime. O asset previsto é o instalador NSIS `.exe`. O download e os hashes serão adicionados à [release oficial](https://github.com/DanielLinsAndrade/dinheirovisky/releases) após aprovação. Não há asset público anunciado neste rascunho.

## Dados e atualização

Os dados ficam no computador. O instalador mantém o identificador histórico do aplicativo. Faça backup antes de atualizar; guarde-o em local protegido. Banco e backups não são criptografados pelo aplicativo.

## Limitações conhecidas

- Distribuição validada em Windows x64; outros sistemas não foram homologados.
- Builds atuais sem assinatura de código: o Windows pode mostrar um aviso de editor desconhecido/SmartScreen.
- Não há sincronização em nuvem, integração automática com bancos nem uso multiusuário compartilhado.
- Testes automatizados de acessibilidade e desempenho não substituem avaliação com leitores de tela e homologação em outros equipamentos.
- Arraste de janela e rolagem com dispositivos físicos devem receber a revisão manual prevista no checklist antes da publicação estável.

Licença MIT. [Site oficial](https://dinheirovisky.app/) · [Checklist de publicação](RELEASE_CHECKLIST.md)
