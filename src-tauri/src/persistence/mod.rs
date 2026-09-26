pub mod alerts;
pub mod attachments;
pub mod backup;
pub mod budgets;
pub mod card_imports;
pub mod cards;
mod catalog;
pub mod commitments;
pub mod dashboard;
pub mod imports;
pub mod invoice_events;
pub mod metadata;
mod migrations;
#[cfg(test)]
mod performance_tests;
pub mod planning;
pub mod purchases;
pub mod report_analysis;
pub mod reports;
pub mod search;
pub mod settings;
pub mod startup;
pub mod transaction_query;
pub mod transactions;

use rusqlite::Connection;
pub type SharedDatabase = std::sync::Arc<std::sync::Mutex<startup::Storage>>;
use std::{
    error::Error,
    path::{Path, PathBuf},
    time::Duration,
};

pub struct Database {
    connection: Connection,
    path: PathBuf,
    pending_restore: Option<backup::PendingRestore>,
}

impl Database {
    pub fn open(path: &Path) -> Result<Self, Box<dyn Error>> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut connection = Connection::open(path)?;
        connection.create_scalar_function(
            "dv_search",
            1,
            rusqlite::functions::FunctionFlags::SQLITE_UTF8
                | rusqlite::functions::FunctionFlags::SQLITE_DETERMINISTIC,
            |ctx| Ok(search::normalize(&ctx.get::<String>(0)?)),
        )?;
        connection.create_scalar_function(
            "dv_casefold",
            1,
            rusqlite::functions::FunctionFlags::SQLITE_UTF8
                | rusqlite::functions::FunctionFlags::SQLITE_DETERMINISTIC,
            |ctx| Ok(ctx.get::<String>(0)?.to_lowercase()),
        )?;
        connection.busy_timeout(Duration::from_secs(5))?;
        connection.execute_batch(
            "PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;",
        )?;
        migrations::migrate(&mut connection, migrations::MIGRATIONS)?;
        let integrity: String = connection.query_row("PRAGMA quick_check", [], |row| row.get(0))?;
        if integrity != "ok"
            || connection
                .prepare("PRAGMA foreign_key_check")?
                .query([])?
                .next()?
                .is_some()
        {
            return Err("O banco falhou na verificação de integridade. Preserve o arquivo para recuperação.".into());
        }
        Ok(Self {
            connection,
            path: path.to_path_buf(),
            pending_restore: None,
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn status(&self) -> rusqlite::Result<(i64, String)> {
        self.connection.query_row(
            "SELECT COALESCE(MAX(version), 0), sqlite_version() FROM schema_migrations",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
    }
}

#[cfg(test)]
mod budget_settings_tests;
#[cfg(test)]
mod catalog_tests;
#[cfg(test)]
mod dashboard_tests;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod transaction_tests;
