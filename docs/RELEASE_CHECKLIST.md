# Checklist da primeira release — v1.0.0

Preparação autorizada em 26/09/2026: commit, push, tag anotada e GitHub Release **em draft**. A publicação final depende de revisão e autorização separada.

## Preparação

- [x] Versão 1.0.0 nos manifests, lockfiles e referências de testes. Sobre recebe a versão compilada do Rust.
- [x] Identificador, caminhos de dados, nomes internos e schema preservados.
- [x] Licença MIT e avisos de terceiros preservados.
- [x] Notas e changelog preparados com recursos existentes e aviso sobre assinatura.
- [x] Inspeção dos arquivos públicos antes do build: nenhum banco, backup, memória, relatório privado ou instalador selecionado; os dois e-mails sinalizados pelo scanner pertencem a avisos de terceiros.
- [x] Validação completa: dependências, TypeScript/Vite, frontend, lint/format, Rust/rustfmt/Clippy, SQLite e aceitação nativa isolada.
- [x] Build final normal com `npm run build:release`, remapeamento e verificação de caminhos locais.
- [x] Conferência de versão, identidade, ícone, arquitetura, tamanho, SHA-256 e Authenticode do instalador final.
- [ ] Revisão final do diff e commit de release.

## GitHub

- [ ] Push do commit de release e CI verde desse commit.
- [ ] Tag anotada `v1.0.0` apontando exatamente para o commit aprovado pela CI; push somente dessa tag.
- [ ] Draft `Dinheirovisky v1.0.0`, sem prerelease e sem publicação.
- [ ] Assets: somente `Dinheirovisky_1.0.0_x64-setup.exe` e `SHA256SUMS.txt`.
- [ ] Download dos assets do draft e conferência de tamanho e SHA-256.
- [ ] **PENDENTE — publicar release após autorização final e validar o download público.**

## Revisão antes da publicação

- [ ] Testar manualmente arraste da janela e rolagem com mouse/touchpad físico.
- [ ] Revisar resultados e limitações da plataforma de referência. Testes automatizados não substituem homologação em outros equipamentos ou avaliação com leitores de tela.
- [ ] Confirmar aceite da distribuição sem assinatura. Não foi criado ou utilizado certificado; o SmartScreen pode exibir aviso de editor desconhecido.

## Artefatos e evidências

Bundle: NSIS Windows x64, `src-tauri/target/release/bundle/nsis/Dinheirovisky_1.0.0_x64-setup.exe`. Não há MSI configurado. O executável interno continua `dinheirovisk.exe`.

Validação local em 26/09/2026: 119 testes frontend e 101 testes Rust aprovados (um benchmark ignorado pela configuração existente); lint, formatação, TypeScript e Clippy sem erros. Aceitação nativa aprovada com instalação/desinstalação isoladas, versão 1.0.0 no backend e em Sobre, schema 14, integridade SQLite, regras financeiras, importação, anexos, offline, backup/restauração e acessibilidade automatizada.

Desempenho na máquina de referência com a massa sintética documentada em `tests/README.md`: abertura 1,404 s; prévias de 2.000 linhas em 0,978 s (banco) e 1,232 s (cartão); RAM 377,59 MiB; CPU ociosa 0,20% de um núcleo lógico por 31 s. Todas as operações comuns ficaram dentro do limite de 500 ms.

Instalador final: **5.858.917 bytes**, ProductName/FileDescription `Dinheirovisky`, ProductVersion/FileVersion `1.0.0`, ícone oficial incorporado, Authenticode `NotSigned`. Payload Windows x64 (o bootstrap NSIS é um PE x86). Não foram encontrados os caminhos locais de perfil/workspace verificados no executável e no instalador.

SHA-256: `bc9910d9da556113f86e86ae848da8ae2bda217f0e63bdb35695a6c432ef8cac`, também registrado no arquivo público `SHA256SUMS.txt`, sem caminhos locais.

Os resultados finais de CI, commit, tag e draft serão registrados aqui após sua verificação. Binários entram somente nos assets selecionados da release; logs, bancos e capturas de teste permanecem locais e ignorados.

A CI valida código e build sem publicar releases ou instaladores. O comando de distribuição é `npm run build:release`; flags personalizadas devem usar `CARGO_ENCODED_RUSTFLAGS` para preservar o remapeamento dos caminhos de compilação.

## Dados para atualização posterior do site

O site não é alterado nesta fase. Após publicar:

- Versão: 1.0.0.
- Release: https://github.com/DanielLinsAndrade/dinheirovisky/releases/tag/v1.0.0
- Instalador: https://github.com/DanielLinsAndrade/dinheirovisky/releases/download/v1.0.0/Dinheirovisky_1.0.0_x64-setup.exe
- Tamanho: 5.858.917 bytes (aproximadamente 5,59 MiB).
- Data: registrar a data efetiva de publicação; a data do changelog é 26/09/2026.
- Status: draft em preparação; o download ainda não está disponível publicamente.
