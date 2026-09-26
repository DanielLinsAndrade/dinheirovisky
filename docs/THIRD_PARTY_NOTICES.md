# Avisos de terceiros

A licença MIT do Dinheirovisky não substitui as licenças de suas dependências. Os lockfiles registram as versões exatas usadas no build.

| Componente redistribuído | Licença / origem |
| --- | --- |
| React / React DOM | MIT; avisos Meta preservados em `public/licenses/react*.txt` |
| API Tauri | MIT ou Apache-2.0; ambos os textos em `public/licenses/tauri-api-*.txt` |
| PDF.js | Apache-2.0; `public/licenses/pdfjs.txt` |
| CMaps do PDF.js | Termos Adobe/BSD preservados em `public/licenses/pdfjs-cmaps.txt` |
| Fontes Foxit/PDFium do PDF.js | Avisos originais preservados em `public/licenses/pdfjs-fonts-foxit.txt` |
| Liberation fonts do PDF.js | GPLv2 com exceção de fontes, conforme texto integral em `public/licenses/pdfjs-fonts-liberation.txt` |
| Decodificadores WASM do PDF.js | Licenças originais JBIG2/OpenJPEG/QCMS e wrappers PDF.js em `public/licenses/pdfjs-wasm-*.txt` |

Esses textos são copiados dos pacotes instalados sem alteração e incorporados ao frontend distribuído. Recursos PDF são empacotados localmente para não depender de rede. Código-fonte e recursos originais do PDF.js: https://github.com/mozilla/pdf.js (versão 6.3.289 no package-lock.json).

O aplicativo usa fontes do sistema na interface; não redistribui Segoe UI. Os SVGs de identidade do Dinheirovisky e os ícones da aplicação pertencem ao projeto. A captura do README usa exclusivamente dados sintéticos.

O backend usa Tauri, Rusqlite/SQLite, Serde, SHA-2, Tempfile e plugins Tauri, com dependências transitivas registradas em `src-tauri/Cargo.lock`. SQLite é de domínio público. Uma distribuição deve preservar também os avisos aplicáveis a essas bibliotecas; a revisão de licenças deve ser repetida quando as dependências mudarem.

Os textos em `public/licenses/rust-dependencies.txt` cobrem os arquivos LICENSE/NOTICE/COPYING disponíveis nas 276 dependências do grafo Cargo Windows bloqueado (incluindo ferramentas de build). Avisos ausentes nos pacotes publicados foram obtidos dos repositórios oficiais nos commits registrados em `.cargo_vcs_info.json`, e estão nos arquivos `public/licenses/rust-*.txt` específicos de cada fornecedor. Os textos MPL-2.0 estão incluídos no conjunto; os fontes de `selectors` 0.36.1 estão disponíveis em https://github.com/servo/stylo/tree/635e1a19d02960588a00e189bd4bd5bdb150ec3d/selectors. Bibliotecas de terceiros não foram modificadas nesta preparação.
