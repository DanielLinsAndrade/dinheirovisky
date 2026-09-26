# Validação integral no Windows

O pacote não depende de `.validation/browser-test`, scripts pessoais, Python ou do Codex. As ferramentas de teste são dependências de desenvolvimento fixadas no `package-lock.json`. Dados financeiros são sintéticos; não se copiam dados do banco pessoal.

## Pré-requisitos

Windows x64 com sessão desktop desbloqueada, PowerShell 5.1+, Node.js 22.16+ para o teste SQLite nativo, npm, Rust estável MSVC, Microsoft C++ Build Tools/Windows SDK e WebView2 Runtime instalado. Primeira obtenção de dependências/NSIS pode precisar de rede; o aplicativo instalado funciona offline. A porta CDP local é escolhida dinamicamente entre portas livres. Execute uma suíte nativa por vez.

## Comando completo em uma cópia nova do projeto

Na raiz:

```powershell
npm run validate
```

O script ajusta o PATH do Rust instalado em `%USERPROFILE%/.cargo/bin`, executa `npm ci`, build/TypeScript, a suíte frontend completa, lint/formatação, testes Rust, rustfmt/Clippy, build e instalação isolada, testes nativos e desinstalação. Ao passar, recompila o instalador normal de produção. Falhas encerram com código diferente de zero; não são convertidas em sucesso. Logs ficam em `.validation/checks/<data-hora>` e `.validation/acceptance/<data-hora>`.

Para desenvolvimento rápido, com as dependências já instaladas:

```powershell
npm run typecheck
npm test
npm run lint
npm run test:rust
npm run test:native
```

`npm run test:native` compila o instalador isolado antes de testá-lo. Após essa execução avulsa, `src-tauri/target/release/dinheirovisk.exe` tem a identidade de teste; execute `npm run build:release` antes de distribuir/usar o executável normal. `npm run validate` faz essa recompilação final automaticamente quando as verificações passam.

Para repetir a suíte nativa sem reconstruir o **mesmo build isolado**:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tests/native/run.ps1 -SkipBuild
```

Não use SkipBuild depois de recompilar o produto normal: a checagem de identidade binária deve recusar a mistura. O NSIS modifica somente o marcador oficial `__TAURI_BUNDLE_TYPE_VAR_UNK` para `NSS`; o verificador exige igualdade de todos os outros bytes.

## Isolamento e artefatos

- Produto de teste: **Dinheirovisky Acceptance**, identifier `com.dinheirovisk.validation.acceptance`, instalação sob `.validation/acceptance/<data-hora>/installed`.
- Banco de teste: `%LOCALAPPDATA%/com.dinheirovisk.validation.acceptance`. Se existir de execução anterior, a pasta é arquivada no diretório da nova execução; dados do identificador normal `com.dinheirovisk.desktop` nunca são alvo.
- O script interrompe somente o processo que criou e desinstala somente o executável isolado conhecido. Bancos, backups e resultados de teste são preservados para diagnóstico. Em máquinas com repositório e AppData em volumes diferentes, a movimentação de arquivos de teste deve usar um repositório no mesmo volume do AppData.
- Use `result.json`, `installation.txt`, `accessibility.json`, `performance.json` e imagens para avaliar o resultado. Uma saída incompleta/arquivo ausente não significa aprovação.
- A configuração Tauri de testes muda nome/identificador/título; não acrescenta comandos, permissões, portas, dados ou dependências de produção. CDP é ativado somente no processo de teste por variável de ambiente.

## Cobertura

1. Instalação limpa, schema 14, primeira conta via formulário, transferência exata via formulário, saldos, Dashboard, orçamento, metas/contribuições, recorrências sem duplicar, vencimentos e relatório por IPC real.
2. Arquivo CSV escolhido pela interface, interpretação, prévia, confirmação antes da gravação e detecção de duplicata.
3. Seletor nativo de backup: cancelar, exportar, recusar inválido, prévia, cancelar substituição, confirmação, restauração e cópia de recuperação.
4. WebView2 sem rede: recarregar assets empacotados, consultar, gravar e excluir lançamento fictício; confirmar os saldos.
5. Axe nas 13 telas e na paleta em claro/escuro/sistema (42 verificações), com link de salto focado nas telas; teclado, filtro sem acentos, restauração de foco, bloqueio da paleta durante edição, sidebar recolhível, editor não modal, movimento reduzido e layout estreito. Não substitui certificação WCAG ou testes com leitor de tela.
6. Banco inválido construído somente na pasta de teste: retry, recuperação pelo backup e comprovação de preservação byte a byte do arquivo inválido anterior.
7. SQLite: integrity_check, foreign_key_check e comparação do texto das 14 migrações oficiais.
8. Fixture de 50 mil transações extremas/100 contas: valores exatos, startup, IPC, RAM da árvore WebView2 e CPU ociosa por ao menos 30 segundos.
9. Desinstalação isolada e ausência do executável instalado.
10. metadados opcionais em transações, reuso de nomes, filtros, renomeação/arquivamento, saldos invariantes e preservação em backup/restauração. Duas verificações axe adicionais nos novos formulários. Evidências em `metadata-result.json` e `metadata-*.png`.
11. CRUD e arquivamento/reativação de cartões, limite exato, calendário de mês curto, confirmação de exclusão, saldos/movimentos invariantes e preservação no backup. Duas verificações axe adicionais no formulário e calendário. Evidências em `cards-result.json` e `cards-*.png`.
12. compra parcelada, edição exata, calendário da fatura, cancelamento confirmado, consumo reconhecido uma vez, ausência de impacto bancário e histórico preservado no backup. Duas verificações axe adicionais. Evidências em `purchases-result.json`, `purchase-*.png` e `purchases-list.png`.
13. pagamento parcial, edição, quitação com múltiplos pagamentos, estorno e crédito após quitação, anulação confirmada, separação caixa/consumo e preservação em backup. Duas verificações axe adicionais (50 no total); `invoice-events-result.json` e `invoice-*.png`. A largura do texto introdutório do Dashboard é verificada nos três temas.

Os testes Rust complementam o percurso nativo com OFX XML/SGML, duplicatas/FITID, arquivos adversariais, calendários, rollback, constraints, backups antigos e casos extremos. Os testes frontend cobrem falhas/retry/foco/edição e estados vazios. Não se afirma que toda combinação foi exercitada por UI.

A cobertura inclui horizontes de compromissos por teclado,
comparação das linhas exibidas com o backend, foco no atalho de compromissos,
tabela exata do gráfico e prévia de recorrências expandidas durante axe.
`query_due_payments` também participa da medição de operações com 50 mil registros.
`performance.json` preserva as árvores de processos antes e depois do intervalo
ocioso para permitir diagnóstico sem mudar os limites de aceite.

## Critérios de performance aprovados

Nesta máquina, release, 50.000 movimentos e 100 contas: abertura ≤ 5.000 ms; cada uma de dez amostras de consultas comuns ≤ 500 ms; revisão de 2.000 linhas ≤ 2.000 ms; working set somado da árvore ≤ 512 MiB; CPU idle ≤ 1% de um núcleo lógico por ao menos 30 s. O teste falha se um limite for excedido. Limites para outro equipamento devem ser acordados explicitamente, sem relaxar valores silenciosamente.

## Entrega normal

```powershell
npm run build:release
& '.\src-tauri\target\release\dinheirovisk.exe'
```

Instalador: `src-tauri/target/release/bundle/nsis/Dinheirovisky_1.0.0_x64-setup.exe`. Builds não têm assinatura digital. O teste de instalação não implica certificação do Windows, simulação de queda de energia ou reinstalação do sistema operacional. As primeiras instalações exigem os pré-requisitos acima; dados de usuário novos e dependências npm reinstaladas são a definição de ambiente limpo exercitada aqui.

## Cobertura adicional

- Busca global real em cinco domínios, FTS5, paginação e destinos por identidade.
- Imagens/PDF incorporados e visualizados offline; remoção da origem, hashes, backup v2, restauração e compatibilidade legada.
- Planejamento fixo/sazonal no motor existente, horizontes e cinco origens de alertas.
- Análises consumo/caixa/parcelas reconciliadas com dashboard e relatório histórico; filtros/grupos e axe em três temas.
- CSV com metadados opcionais e compras no cartão; OFX com confirmação explícita; FITID, repetição de confirmação e duplicatas.
- Fixture ampliada: 100 cartões, 5.000 compras, 15.000 parcelas, 3.800 faturas e 800 eventos além das 50.000 transações/100 contas. Revisão de 2.000 compras além das 2.000 linhas bancárias.
- `volume-ui.cjs`: axe em quatro telas com dados extremos nos três temas, foco/rolagem de tabela, dashboard 600 px e exportação/prévia validada do backup de volume.

Resultados e medições de cada execução ficam nos artefatos locais. A abertura atual espera os dados do Dashboard; milestones preservam também o tempo até o shell. Não comparar esse endpoint diretamente ao tempo histórico sem a ressalva.

## Limitações da automação de janela

A suíte verifica minimizar, maximizar, restaurar, redimensionar, duplo clique, fechamento e escopo das regiões de arraste. Deslocamento por arraste com mouse físico e gestos reais de touchpad precisam de revisão manual; a automação não os certifica.

## Teste opcional de compatibilidade histórica

`tests/native/branding.ps1` é um teste separado de atualização da antiga marca. Ele exige um instalador legado **de teste**, fornecido pelo mantenedor; esse binário não é incluído no repositório. Não faz parte de `npm run validate` e não deve receber um instalador pessoal/de produção. A suíte padrão gera todos os seus dados e não depende desse artefato histórico.
