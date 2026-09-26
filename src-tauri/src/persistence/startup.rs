use super::{backup::BackupPreview, Database};
use serde::Serialize;
use std::{fs, io::Write, path::PathBuf};

pub struct Storage {
    directory: Result<PathBuf, String>,
    pub database: Option<Database>,
    error: Option<String>,
    recovery: Option<(Database, tempfile::TempDir)>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageStatus {
    ready: bool,
    error: Option<String>,
    directory: Option<String>,
}

pub fn message(error: impl std::fmt::Display) -> String {
    let detail = error.to_string();
    let lower = detail.to_lowercase();
    let guidance = if lower.contains("locked") || lower.contains("busy") {
        "O banco está ocupado. Feche outras operações e tente novamente."
    } else if lower.contains("readonly")
        || lower.contains("permission")
        || lower.contains("access")
        || lower.contains("unable to open")
    {
        "Não foi possível acessar o banco. Verifique as permissões e a disponibilidade da pasta de dados e tente novamente."
    } else if lower.contains("disk") || lower.contains("i/o") {
        "Falha de armazenamento. Verifique o espaço livre e a disponibilidade do disco antes de tentar novamente."
    } else if lower.contains("malformed") || lower.contains("not a database") {
        "O arquivo do banco está inválido. Preserve os arquivos originais e recupere um backup válido."
    } else {
        return detail;
    };
    format!("{guidance} Detalhe: {detail}")
}

impl Storage {
    pub fn new(directory: Result<PathBuf, String>) -> Self {
        Self {
            directory,
            database: None,
            error: None,
            recovery: None,
        }
    }
    pub fn retry(&mut self) -> StorageStatus {
        self.recovery = None;
        if self.database.is_none() {
            let result = (|| {
                let directory = self.directory.as_ref().map_err(Clone::clone)?;
                let marker = directory.join("active-database.txt");
                let name = match fs::read_to_string(marker) {
                    Ok(name) if name.starts_with("recovered-") && name.ends_with(".sqlite3") && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'.') => name,
                    Ok(_) => return Err("Referência do banco inválida. Recupere um backup; os arquivos existentes serão preservados.".into()),
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => "dinheirovisk.sqlite3".into(),
                    Err(e) => return Err(message(e)),
                };
                let path = directory.join(&name);
                if name != "dinheirovisk.sqlite3" && !path.is_file() {
                    return Err("O banco recuperado não foi encontrado. Verifique a pasta ou recupere outro backup.".into());
                }
                Database::open(&path).map_err(message)
            })();
            match result {
                Ok(db) => {
                    self.database = Some(db);
                    self.error = None;
                }
                Err(e) => self.error = Some(e),
            }
        }
        StorageStatus {
            ready: self.database.is_some(),
            error: self.error.clone(),
            directory: self
                .directory
                .as_ref()
                .ok()
                .map(|p| p.display().to_string()),
        }
    }
    pub fn prepare(&mut self, path: &std::path::Path) -> Result<BackupPreview, String> {
        self.recovery = None;
        if self.database.is_some() {
            return Err("Use a tela Backup para restaurar um banco aberto.".into());
        }
        let temporary = tempfile::tempdir().map_err(message)?;
        let mut db = Database::open(&temporary.path().join("staging.sqlite3")).map_err(message)?;
        let preview = db.prepare_restore(path).map_err(message)?;
        self.recovery = Some((db, temporary));
        Ok(preview)
    }
    pub fn cancel(&mut self) {
        self.recovery = None;
    }
    pub fn confirm(&mut self, token: &str, confirmed: bool) -> Result<(), String> {
        if self.database.is_some() {
            return Err("O banco já está aberto.".into());
        }
        let (db, _) = self
            .recovery
            .as_mut()
            .ok_or("Selecione e valide um backup primeiro.")?;
        db.confirm_restore(token, confirmed).map_err(message)?;
        let directory = self.directory.as_ref().map_err(Clone::clone)?;
        fs::create_dir_all(directory).map_err(message)?;
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(message)?
            .as_nanos();
        let name = format!("recovered-{stamp}.sqlite3");
        let path = directory.join(&name);
        db.export_backup(&path).map_err(message)?;
        let opened = Database::open(&path).map_err(message)?;
        // Publicar só após validar, gravar e abrir a nova cópia. Nunca tocar no
        // banco anterior ou seus WAL/SHM, inclusive se a publicação falhar.
        let mut marker = tempfile::NamedTempFile::new_in(directory).map_err(message)?;
        marker.write_all(name.as_bytes()).map_err(message)?;
        marker.as_file().sync_all().map_err(message)?;
        marker
            .persist(directory.join("active-database.txt"))
            .map_err(message)?;
        self.database = Some(opened);
        self.error = None;
        self.recovery = None;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn recovery_preserves_invalid_original_and_reopens_new_database() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("dinheirovisk.sqlite3");
        fs::write(&path, b"invalid original").unwrap();
        let mut storage = Storage::new(Ok(dir.path().into()));
        assert!(!storage.retry().ready);
        assert_eq!(fs::read(&path).unwrap(), b"invalid original");
        // Sidecars must remain untouched by recovery, even when not valid SQLite.
        fs::write(dir.path().join("dinheirovisk.sqlite3-wal"), b"original wal").unwrap();
        fs::write(dir.path().join("dinheirovisk.sqlite3-shm"), b"original shm").unwrap();
        let source_dir = tempfile::tempdir().unwrap();
        let source = Database::open(&source_dir.path().join("source.sqlite3")).unwrap();
        let backup = source_dir.path().join("backup.sqlite3");
        source.export_backup(&backup).unwrap();
        let bytes = fs::read(&backup).unwrap();
        assert!(storage.prepare(&path).is_err());
        let preview = storage.prepare(&backup).unwrap();
        assert!(storage.confirm(&preview.token, false).is_err());
        storage.cancel();
        assert!(storage.confirm(&preview.token, true).is_err());
        assert!(!dir.path().join("active-database.txt").exists());
        let preview = storage.prepare(&backup).unwrap();
        storage.confirm(&preview.token, true).unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"invalid original");
        assert_eq!(
            fs::read(dir.path().join("dinheirovisk.sqlite3-wal")).unwrap(),
            b"original wal"
        );
        assert_eq!(
            fs::read(dir.path().join("dinheirovisk.sqlite3-shm")).unwrap(),
            b"original shm"
        );
        assert_eq!(fs::read(&backup).unwrap(), bytes);
        drop(storage);
        let mut reopened = Storage::new(Ok(dir.path().into()));
        assert!(reopened.retry().ready);
        assert_ne!(reopened.database.unwrap().path(), path);
    }
    #[test]
    fn inaccessible_directory_and_invalid_pointer_do_not_create_empty_database() {
        let dir = tempfile::tempdir().unwrap();
        let blocked = dir.path().join("file");
        fs::write(&blocked, b"preserve").unwrap();
        let mut storage = Storage::new(Ok(blocked.clone()));
        assert!(!storage.retry().ready);
        assert_eq!(fs::read(blocked).unwrap(), b"preserve");
        fs::write(dir.path().join("active-database.txt"), "../outside.sqlite3").unwrap();
        let mut storage = Storage::new(Ok(dir.path().into()));
        assert!(!storage.retry().ready);
        assert!(!dir.path().join("dinheirovisk.sqlite3").exists());
        fs::write(
            dir.path().join("active-database.txt"),
            "recovered-missing.sqlite3",
        )
        .unwrap();
        assert!(!storage.retry().ready);
        assert!(!dir.path().join("recovered-missing.sqlite3").exists());
    }
    #[test]
    fn storage_messages_offer_actions() {
        assert!(message("database is locked").contains("tente novamente"));
        assert!(message("database disk image is malformed").contains("Verifique"));
        assert!(message("unable to open database file").contains("permissões"));
        assert_eq!(message("Informe um nome."), "Informe um nome.");
    }

    #[test]
    fn failed_publication_preserves_original_and_can_be_retried() {
        let dir = tempfile::tempdir().unwrap();
        let original = dir.path().join("dinheirovisk.sqlite3");
        fs::write(&original, b"original").unwrap();
        let source_dir = tempfile::tempdir().unwrap();
        let source = Database::open(&source_dir.path().join("source.sqlite3")).unwrap();
        let backup = source_dir.path().join("backup.sqlite3");
        source.export_backup(&backup).unwrap();
        let marker = dir.path().join("active-database.txt");
        fs::create_dir(&marker).unwrap();
        let mut storage = Storage::new(Ok(dir.path().into()));
        assert!(!storage.retry().ready);
        let preview = storage.prepare(&backup).unwrap();
        assert!(storage.confirm(&preview.token, true).is_err());
        assert!(storage.database.is_none());
        assert_eq!(fs::read(&original).unwrap(), b"original");
        assert!(marker.is_dir());
        fs::remove_dir(&marker).unwrap();
        let preview = storage.prepare(&backup).unwrap();
        storage.confirm(&preview.token, true).unwrap();
        assert!(storage.database.is_some());
        assert_eq!(fs::read(&original).unwrap(), b"original");
    }
}
