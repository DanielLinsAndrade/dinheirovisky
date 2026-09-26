# Checklist da primeira release

Este documento prepara uma publicação futura. Sua existência e a CI não autorizam publicar.

- [ ] Revisar o conteúdo do commit e confirmar que não há dados privados, segredos ou artefatos locais.
- [ ] Confirmar MIT e avisos de terceiros preservados na distribuição.
- [ ] Escolher a versão: manifests atuais em 0.1.0; avaliar 1.0.0 após homologação final ou 1.0.0-rc.1 para teste público inicial.
- [ ] Atualizar de forma consistente package.json, package-lock.json, Cargo.toml/Cargo.lock, tauri.conf.json e referências dos scripts de teste; conferir a versão exibida em Sobre.
- [ ] Executar `npm run validate` em Windows com sessão desktop desbloqueada e dados isolados.
- [ ] Testar manualmente arraste da janela e rolagem com mouse/touchpad físico.
- [ ] Revisar limitações e resultados, inclusive performance na máquina de referência.
- [ ] Gerar novamente o bundle normal com `npm run build:release` depois dos testes isolados.
- [ ] Conferir nome, ícone, versão, funcionamento offline, instalação e desinstalação em ambiente de teste.
- [ ] Decidir a política de assinatura Windows. Sem certificado, informar claramente o aviso possível do SmartScreen.
- [ ] Registrar tamanho e SHA-256 do instalador final e executável; preservar logs localmente.
- [ ] Conferir `git status`, `git diff --cached` e `git ls-files`; criar/revisar o commit final.
- [ ] Obter autorização explícita para push. Esta fase não autoriza envio.
- [ ] Após autorização, publicar o commit e conferir a CI.
- [ ] Criar a tag da versão somente com autorização da fase de publicação.
- [ ] Preparar draft release, notas revisadas e assets (instalador e arquivo de hashes), sem dados de teste.
- [ ] Baixar os assets do draft e conferir hashes, instalação e versão.
- [ ] Revisar links de download e site oficial https://dinheirovisky.app/.
- [ ] Autorizar e publicar a release; validar o download público.

## Artefatos

Bundle configurado: NSIS x64, `src-tauri/target/release/bundle/nsis/Dinheirovisky_<versão>_x64-setup.exe`. Não há MSI configurado. Binários, instaladores, logs, screenshots de teste e bancos não entram no Git; somente assets selecionados da release são publicados na fase apropriada.

## Automação

A CI valida código e build, sem criar tags/releases ou enviar instaladores. O fluxo oficial [tauri-apps/tauri-action](https://v2.tauri.app/distribute/pipelines/github/) pode ser avaliado na fase de publicação. Não adicionar permissões de escrita, tokens de release ou criação automática de releases nesta preparação.

O comando de distribuição é npm run build:release. Ele remapeia caminhos do perfil de compilação para nomes neutros; depois do build, confirme que o executável não contém o caminho do perfil local. Flags personalizadas devem usar CARGO_ENCODED_RUSTFLAGS.
