# Anexos e backup completo v2

Em Transações ou Compras e faturas, use **Anexos de…** para incorporar um
comprovante, recibo, nota fiscal ou outro documento. Tipos aceitos: PNG, JPEG,
WebP e PDF; até 10 MiB por arquivo e 64 MiB/1000 anexos no conjunto. O aplicativo
valida extensão e assinatura básica do conteúdo. Essa validação não equivale
a uma análise antivírus ou validação completa do formato.

Os bytes são copiados para uma tabela SQLite gerenciada. Mover ou apagar o
original não interfere no anexo. Nome original, nome interno, tipo, MIME,
tamanho, SHA-256, vínculo e timestamps acompanham o conteúdo. A leitura verifica
novamente hash e tipo. Conteúdo idêntico no mesmo registro é reutilizado.

Remover um anexo exige confirmação e não modifica o arquivo original. Excluir
uma transação remove seus anexos na mesma operação SQLite. Cancelar uma compra
preserva seu histórico e anexos; a exclusão física de uma compra com anexos é
protegida pela chave estrangeira.

**Salvar backup** gera um arquivo `.dvbackup`: cabeçalho versionado, manifesto
JSON e snapshot SQLite com todos os anexos. O snapshot e cada anexo possuem hash.
O manifesto não fornece caminhos para extração: o restaurador materializa
somente um nome fixo em diretório temporário isolado. Backups SQLite legados
continuam aceitos. Arquivos de destino existentes não são sobrescritos.

A restauração confere limites, tamanho, hash, manifesto, migrações, integridade
SQLite, chaves estrangeiras e regras financeiras antes da confirmação. O banco
e os anexos são restaurados juntos pela operação de backup do SQLite; não há
um diretório de arquivos externo que possa ficar incompatível com o banco.
Uma cópia de recuperação preserva o estado anterior. O formato não é cifrado:
guarde backups em local sob seu controle.

Testes Rust: `cargo test --manifest-path src-tauri/Cargo.toml --locked attachments`.
PDFs são renderizados localmente pelo PDF.js, com navegação de páginas e texto
extraído acessível. Não são ativados scripts, formulários ou links do documento.
O leitor é carregado sob demanda; fontes e recursos são empacotados para uso
offline. PDFs protegidos por senha apresentam erro explícito, preservando o
conteúdo. Referência técnica: https://mozilla.github.io/pdf.js/examples/.

Testes UI: `npm test -- src/features/attachments/Attachments.test.tsx`.
Validação desktop isolada: `npm run test:native`.
