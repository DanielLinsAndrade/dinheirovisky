use super::{migrations, Database};
use rusqlite::{
    backup::{Backup, StepResult},
    Connection,
};
use serde::Serialize;
use std::{
    fs::{self, File},
    io::{Read, Seek, Write},
    path::Path,
};
use tempfile::TempDir;
mod package;
mod validation;

const MAX_BACKUP: u64 = 128 * 1024 * 1024;
pub(super) struct PendingRestore {
    connection: Connection,
    _directory: TempDir,
    token: String,
    changes: u64,
    data_version: i64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupPreview {
    pub token: String,
    pub original_version: usize,
    pub accounts: i64,
    pub transactions: i64,
    pub attachments: i64,
    pub currency: String,
}
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
fn schema(c: &Connection) -> Result<Vec<(String, String, String, String)>, String> {
    // GLOB trata '_' literalmente; LIKE também esconderia objetos sqliteX... .
    c.prepare("SELECT type,name,tbl_name,COALESCE(sql,'') FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY type,name").map_err(err)?
        .query_map([],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).map_err(err)?.collect::<Result<_,_>>().map_err(err)
}
fn integrity(c: &Connection) -> Result<(), String> {
    let results: Vec<String> = c
        .prepare("PRAGMA integrity_check")
        .map_err(err)?
        .query_map([], |r| r.get(0))
        .map_err(err)?
        .collect::<Result<_, _>>()
        .map_err(err)?;
    if results != ["ok"]
        || c.prepare("PRAGMA foreign_key_check")
            .map_err(err)?
            .exists([])
            .map_err(err)?
    {
        return Err(
            "O backup falhou na verificação de integridade. O banco atual foi preservado.".into(),
        );
    }
    Ok(())
}
fn validate(c: &mut Connection) -> Result<usize, String> {
    c.execute_batch("PRAGMA trusted_schema=OFF; PRAGMA foreign_keys=ON;")
        .map_err(err)?;
    // Compare estrutura e histórico antes de executar migrações ou consultar dados.
    let mut expected = Connection::open_in_memory().map_err(err)?;
    migrations::migrate(&mut expected, &migrations::MIGRATIONS[..1]).map_err(err)?;
    let expected_history = schema(&expected)?
        .into_iter()
        .find(|row| row.1 == "schema_migrations");
    if schema(c)?
        .into_iter()
        .find(|row| row.1 == "schema_migrations")
        != expected_history
    {
        return Err("Arquivo não é um backup reconhecido do Dinheirovisky.".into());
    }
    let history: Vec<(i64, String)> = c
        .prepare("SELECT version,source FROM schema_migrations ORDER BY version")
        .map_err(|_| "Arquivo não é um backup reconhecido do Dinheirovisky.".to_string())?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(err)?
        .collect::<Result<_, _>>()
        .map_err(err)?;
    if history.is_empty()
        || history.len() > migrations::MIGRATIONS.len()
        || history
            .iter()
            .enumerate()
            .any(|(i, (v, s))| *v != (i + 1) as i64 || s != migrations::MIGRATIONS[i])
    {
        return Err("Backup de versão incompatível ou histórico alterado.".into());
    }
    migrations::migrate(&mut expected, &migrations::MIGRATIONS[..history.len()]).map_err(err)?;
    if schema(c)? != schema(&expected)? {
        return Err("Estrutura do backup diferente da estrutura oficial.".into());
    }
    integrity(c)?;
    migrations::migrate(c, migrations::MIGRATIONS).map_err(err)?;
    integrity(c)?;
    validation::domain(c)?;
    c.execute(
        "INSERT INTO transaction_search(transaction_search,rank) VALUES('integrity-check',1)",
        [],
    )
    .map_err(err)?;
    let settings: (String,String,String,String,i64)=c.query_row("SELECT currency,locale,date_format,theme,financial_month_start FROM app_settings WHERE id=1",[],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?))).map_err(err)?;
    super::settings::Settings {
        currency: settings.0,
        locale: settings.1,
        date_format: settings.2,
        theme: settings.3,
        financial_month_start: settings.4,
    }
    .validate()?;
    for query in [
        "SELECT 1 FROM transactions t JOIN categories c ON c.id=t.category_id WHERE t.type!=c.type LIMIT 1",
        "SELECT 1 FROM budgets b JOIN categories c ON c.id=b.category_id WHERE c.type!='expense' LIMIT 1",
        "SELECT 1 FROM categories c JOIN categories p ON p.id=c.parent_id WHERE c.type!=p.type LIMIT 1",
        "SELECT 1 FROM recurrence_templates t JOIN categories c ON c.id=t.category_id WHERE t.type!=c.type LIMIT 1",
        "SELECT 1 FROM goals WHERE completed != (current_amount>=target_amount) LIMIT 1",
        "SELECT 1 FROM import_batches b WHERE b.imported_count!=(SELECT count(*) FROM import_entries e WHERE e.batch_id=b.request_id)+(SELECT count(*) FROM card_import_entries e WHERE e.batch_id=b.request_id) LIMIT 1",
    ] { if c.prepare(query).map_err(err)?.exists([]).map_err(err)? { return Err("Backup com regras financeiras inconsistentes.".into()); } }
    let parents: std::collections::HashMap<i64, Option<i64>> = c
        .prepare("SELECT id,parent_id FROM categories")
        .map_err(err)?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(err)?
        .collect::<Result<_, _>>()
        .map_err(err)?;
    for &id in parents.keys() {
        let mut seen = std::collections::HashSet::new();
        let mut current = Some(id);
        while let Some(node) = current {
            if !seen.insert(node) {
                return Err("Backup com ciclo nas categorias.".into());
            }
            current = parents.get(&node).copied().flatten();
        }
    }
    let goals: Vec<(i64, i64)> = c
        .prepare("SELECT id,current_amount FROM goals")
        .map_err(err)?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(err)?
        .collect::<Result<_, _>>()
        .map_err(err)?;
    for (id, amount) in goals {
        let values: Vec<i64> = c
            .prepare("SELECT amount FROM goal_contributions WHERE goal_id=?1")
            .map_err(err)?
            .query_map([id], |r| r.get(0))
            .map_err(err)?
            .collect::<Result<_, _>>()
            .map_err(err)?;
        if values.iter().map(|n| i128::from(*n)).sum::<i128>() != i128::from(amount) {
            return Err("Backup com contribuições de metas inconsistentes.".into());
        }
    }
    Ok(history.len())
}
fn copy_database(source: &Connection, destination: &mut Connection) -> Result<(), String> {
    let backup = Backup::new(source, destination).map_err(err)?;
    match backup.step(-1).map_err(err)? {
        StepResult::Done=>Ok(()),
        _=>Err("Banco ocupado. Feche outras operações e tente novamente; a cópia incompleta foi revertida.".into()),
    }
}
fn publish(source: &Connection, path: &Path) -> Result<(), String> {
    let bytes: i64 = source
        .query_row(
            "SELECT page_count*page_size FROM pragma_page_count(),pragma_page_size()",
            [],
            |r| r.get(0),
        )
        .map_err(err)?;
    if bytes > MAX_BACKUP as i64 {
        return Err("Backup excede o limite de 128 MB desta versão.".into());
    }
    if path.exists() {
        return Err("Escolha um nome novo. Arquivos existentes não são sobrescritos.".into());
    }
    let parent = path
        .parent()
        .filter(|p| p.is_dir())
        .ok_or("Pasta de destino inexistente.")?;
    let temporary = tempfile::NamedTempFile::new_in(parent).map_err(err)?;
    {
        let mut destination = Connection::open(temporary.path()).map_err(err)?;
        destination
            .execute_batch("PRAGMA synchronous=FULL;")
            .map_err(err)?;
        copy_database(source, &mut destination)?;
        destination
            .execute_batch("PRAGMA journal_mode=DELETE;")
            .map_err(err)?;
        validate(&mut destination)?;
    }
    temporary.as_file().sync_all().map_err(err)?;
    temporary.persist_noclobber(path).map_err(err)?;
    Ok(())
}
impl Database {
    pub fn export_backup_v2(&self, path: &Path) -> Result<(), String> {
        package::export(&self.connection, path)
    }
    pub fn export_backup(&self, path: &Path) -> Result<(), String> {
        publish(&self.connection, path)
    }
    pub fn prepare_restore(&mut self, path: &Path) -> Result<BackupPreview, String> {
        self.pending_restore = None;
        let package = package::unpack(path)?;
        let snapshot = package
            .as_ref()
            .map(|(directory, _)| directory.path().join("snapshot.sqlite3"));
        let path = snapshot.as_deref().unwrap_or(path);
        let mut input = File::open(path).map_err(err)?;
        if !input.metadata().map_err(err)?.is_file()
            || input.metadata().map_err(err)?.len() > MAX_BACKUP
        {
            return Err("Use um backup SQLite de até 128 MB.".into());
        }
        let mut header = [0_u8; 20];
        input
            .read_exact(&mut header)
            .map_err(|_| "Arquivo de backup inválido.".to_string())?;
        if &header[..16] != b"SQLite format 3\0" || header[18] != 1 || header[19] != 1 {
            return Err("Selecione um backup independente gerado por Salvar backup, não o banco ativo ou uma cópia que depende de arquivos WAL.".into());
        }
        input.rewind().map_err(err)?;
        let directory = tempfile::tempdir().map_err(err)?;
        let mut temporary = File::create(directory.path().join("restore.sqlite3")).map_err(err)?;
        let copied = std::io::copy(&mut input.take(MAX_BACKUP + 1), &mut temporary).map_err(err)?;
        if !(100..=MAX_BACKUP).contains(&copied) {
            return Err("Arquivo de backup inválido ou muito grande.".into());
        }
        temporary.sync_all().map_err(err)?;
        drop(temporary);
        let mut candidate =
            Connection::open(directory.path().join("restore.sqlite3")).map_err(err)?;
        let version = validate(&mut candidate)?;
        if let Some((_, manifest)) = &package {
            package::validate_manifest(&candidate, version, manifest)?;
        }
        let page_size: i64 = candidate
            .query_row("PRAGMA page_size", [], |r| r.get(0))
            .map_err(err)?;
        let current_size: i64 = self
            .connection
            .query_row("PRAGMA page_size", [], |r| r.get(0))
            .map_err(err)?;
        if page_size != current_size {
            return Err("Tamanho de página SQLite incompatível.".into());
        }
        let token = directory
            .path()
            .file_name()
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let preview = BackupPreview {
            token: token.clone(),
            original_version: version,
            accounts: candidate
                .query_row("SELECT count(*) FROM accounts", [], |r| r.get(0))
                .map_err(err)?,
            transactions: candidate
                .query_row("SELECT count(*) FROM transactions", [], |r| r.get(0))
                .map_err(err)?,
            attachments: candidate
                .query_row("SELECT count(*) FROM attachments", [], |r| r.get(0))
                .map_err(err)?,
            currency: candidate
                .query_row("SELECT currency FROM app_settings", [], |r| r.get(0))
                .map_err(err)?,
        };
        self.pending_restore = Some(PendingRestore {
            connection: candidate,
            _directory: directory,
            token,
            changes: self.connection.total_changes(),
            data_version: self
                .connection
                .query_row("PRAGMA data_version", [], |r| r.get(0))
                .map_err(err)?,
        });
        Ok(preview)
    }
    pub fn cancel_restore(&mut self) {
        self.pending_restore = None;
    }
    pub fn confirm_restore(&mut self, token: &str, confirmed: bool) -> Result<String, String> {
        let pending = self
            .pending_restore
            .as_ref()
            .ok_or("Selecione e valide um backup primeiro.")?;
        if !confirmed || pending.token != token {
            return Err("Confirmação de restauração inválida.".into());
        }
        let version: i64 = self
            .connection
            .query_row("PRAGMA data_version", [], |r| r.get(0))
            .map_err(err)?;
        if pending.changes != self.connection.total_changes() || pending.data_version != version {
            return Err("Os dados atuais mudaram. Selecione e revise o backup novamente.".into());
        }
        let recovery_dir = self
            .path
            .parent()
            .ok_or("Pasta do banco inválida.")?
            .join("backups");
        fs::create_dir_all(&recovery_dir).map_err(err)?;
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(err)?
            .as_nanos();
        let recovery = recovery_dir.join(format!("antes-restauracao-{stamp}.sqlite3"));
        publish(&self.connection, &recovery)?;
        copy_database(&pending.connection, &mut self.connection)?;
        self.pending_restore = None;
        Ok(recovery.display().to_string())
    }
    pub fn export_transactions(&self, path: &Path) -> Result<usize, String> {
        if path.exists() {
            return Err("Escolha um nome novo. Arquivos existentes não são sobrescritos.".into());
        }
        let parent = path
            .parent()
            .filter(|p| p.is_dir())
            .ok_or("Pasta de destino inexistente.")?;
        let mut file = tempfile::NamedTempFile::new_in(parent).map_err(err)?;
        let accounts = self.list_accounts()?;
        let categories = self.list_categories()?;
        let currency = self.settings()?.currency;
        let movements = self.list_transactions()?;
        writeln!(file,"\u{feff}id;data;descricao;valor;tipo;conta;destino;categoria;situacao;observacoes;moeda\r").map_err(err)?;
        for m in &movements {
            let text = |id: Option<i64>| {
                accounts
                    .iter()
                    .find(|a| Some(a.id) == id)
                    .map(|a| a.name.clone())
                    .unwrap_or_default()
            };
            let value = crate::domain::money::decimal_cents(
                i128::from(m.amount) * if m.kind == "expense" { -1 } else { 1 },
            );
            let fields = [
                m.id.unwrap_or_default().to_string(),
                m.date.clone(),
                m.description.clone(),
                value,
                m.kind.clone(),
                text(Some(m.account_id)),
                text(m.destination_account_id),
                categories
                    .iter()
                    .find(|c| Some(c.id) == m.category_id)
                    .map(|c| c.name.clone())
                    .unwrap_or_default(),
                m.status.clone(),
                m.notes.clone().unwrap_or_default(),
                currency.clone(),
            ];
            let row = fields
                .iter()
                .enumerate()
                .map(|(i, s)| csv_cell(s, i != 0 && i != 3))
                .collect::<Vec<_>>()
                .join(";");
            writeln!(file, "{row}\r").map_err(err)?;
        }
        file.as_file().sync_all().map_err(err)?;
        file.persist_noclobber(path).map_err(err)?;
        Ok(movements.len())
    }
}
fn csv_cell(s: &str, protect: bool) -> String {
    let prefix = if protect
        && s.trim_start()
            .starts_with(['=', '+', '-', '@', '\t', '\r', '\n'])
    {
        "'"
    } else {
        ""
    };
    format!("\"{prefix}{}\"", s.replace('"', "\"\""))
}

#[cfg(test)]
mod integrity_tests;
#[cfg(test)]
mod tests;
