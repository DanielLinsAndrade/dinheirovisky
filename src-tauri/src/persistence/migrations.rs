use rusqlite::{Connection, TransactionBehavior};
use std::error::Error;

pub(super) const MIGRATIONS: &[&str] = &[
    include_str!("../../migrations/0001_initial.sql"),
    include_str!("../../migrations/0002_accounts_categories.sql"),
    include_str!("../../migrations/0003_transactions.sql"),
    include_str!("../../migrations/0004_budgets.sql"),
    include_str!("../../migrations/0005_recurrences_goals.sql"),
    include_str!("../../migrations/0006_imports.sql"),
    include_str!("../../migrations/0007_financial_metadata.sql"),
    include_str!("../../migrations/0008_credit_cards.sql"),
    include_str!("../../migrations/0009_card_purchases.sql"),
    include_str!("../../migrations/0010_invoice_events.sql"),
    include_str!("../../migrations/0011_transaction_search.sql"),
    include_str!("../../migrations/0012_attachments.sql"),
    include_str!("../../migrations/0013_planning_class.sql"),
    include_str!("../../migrations/0014_card_imports.sql"),
];

pub(super) fn migrate(
    connection: &mut Connection,
    migrations: &[&str],
) -> Result<(), Box<dyn Error>> {
    // A falha em qualquer migração reverte o lote inteiro, incluindo seu histórico.
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    transaction.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY CHECK (version > 0),
            source TEXT NOT NULL,
            applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        ) STRICT;",
    )?;
    let applied = {
        let mut statement = transaction
            .prepare("SELECT version, source FROM schema_migrations ORDER BY version")?;
        let rows = statement.query_map([], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })?;
        rows.collect::<Result<Vec<_>, _>>()?
    };
    for (index, (version, source)) in applied.iter().enumerate() {
        if *version != i64::try_from(index + 1)?
            || migrations.get(index).copied() != Some(source.as_str())
        {
            return Err("Histórico de migrações incompatível. Use a versão correta da aplicação; não edite migrações já aplicadas.".into());
        }
    }
    for (index, source) in migrations.iter().enumerate().skip(applied.len()) {
        transaction.execute_batch(source)?;
        transaction.execute(
            "INSERT INTO schema_migrations (version, source) VALUES (?1, ?2)",
            rusqlite::params![i64::try_from(index + 1)?, source],
        )?;
    }
    transaction.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn failed_migration_rolls_back_schema_and_history() {
        let mut connection = Connection::open_in_memory().unwrap();
        let mut broken = MIGRATIONS.to_vec();
        broken.push("CREATE TABLE temporary_table (id INTEGER); INVALID SQL;");
        assert!(migrate(&mut connection, &broken).is_err());
        let count: i64 = connection
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type = 'table'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);
        migrate(&mut connection, MIGRATIONS).unwrap();
    }

    #[test]
    fn upgrades_preserve_data_and_reject_modified_or_newer_history() {
        let mut connection = Connection::open_in_memory().unwrap();
        migrate(&mut connection, MIGRATIONS).unwrap();
        connection
            .execute("UPDATE app_settings SET locale = 'en-US'", [])
            .unwrap();
        let mut upgraded = MIGRATIONS.to_vec();
        upgraded.push("CREATE TABLE upgrade_probe (id INTEGER) STRICT;");
        migrate(&mut connection, &upgraded).unwrap();
        assert_eq!(
            connection
                .query_row("SELECT locale FROM app_settings", [], |row| row
                    .get::<_, String>(0))
                .unwrap(),
            "en-US"
        );
        assert!(migrate(&mut connection, MIGRATIONS).is_err());
        let mut modified = upgraded.clone();
        modified[0] = "SELECT 1";
        assert!(migrate(&mut connection, &modified).is_err());
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM schema_migrations", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            MIGRATIONS.len() as i64 + 1
        );
    }
}
