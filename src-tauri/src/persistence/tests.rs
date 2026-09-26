use super::*;

#[test]
fn creates_schema_and_reopens_without_resetting_data() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("nested/test.sqlite3");
    {
        let database = Database::open(&path).unwrap();
        assert_eq!(
            database.status().unwrap().0,
            crate::persistence::migrations::MIGRATIONS.len() as i64
        );
        let connection = &database.connection;
        assert_eq!(
            connection
                .query_row("PRAGMA foreign_keys", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            1
        );
        assert_eq!(
            connection
                .query_row("PRAGMA journal_mode", [], |row| row.get::<_, String>(0))
                .unwrap(),
            "wal"
        );
        let tables: i64 = connection
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(tables, 26);
        for table in [
            "accounts",
            "transactions",
            "recurrences",
            "budgets",
            "goals",
        ] {
            assert_eq!(
                connection
                    .query_row(&format!("SELECT count(*) FROM {table}"), [], |row| row
                        .get::<_, i64>(0))
                    .unwrap(),
                0
            );
        }
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM categories", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            14
        );
        connection
            .execute("UPDATE app_settings SET locale = 'en-US'", [])
            .unwrap();
    }
    let reopened = Database::open(&path).unwrap();
    assert_eq!(
        reopened
            .connection
            .query_row("SELECT locale FROM app_settings", [], |row| row
                .get::<_, String>(0))
            .unwrap(),
        "en-US"
    );
    assert_eq!(
        reopened
            .connection
            .query_row("SELECT count(*) FROM schema_migrations", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        crate::persistence::migrations::MIGRATIONS.len() as i64
    );
    assert_eq!(
        reopened
            .connection
            .query_row("PRAGMA integrity_check", [], |row| row.get::<_, String>(0))
            .unwrap(),
        "ok"
    );
}

#[test]
fn schema_rejects_invalid_money_dates_and_references() {
    let directory = tempfile::tempdir().unwrap();
    let database = Database::open(&directory.path().join("test.sqlite3")).unwrap();
    let connection = &database.connection;
    connection
        .execute(
            "INSERT INTO accounts (id, name, type) VALUES (1, 'Teste', 'wallet')",
            [],
        )
        .unwrap();
    for sql in [
        "INSERT INTO accounts (name, type, initial_balance) VALUES ('X', 'wallet', 10.5)",
        "INSERT INTO accounts (name, type, initial_balance) VALUES ('X', 'wallet', 9007199254740992)",
        "INSERT INTO accounts (name, type) VALUES (' ', 'wallet')",
        "INSERT INTO categories (name, type, parent_id) VALUES ('X', 'expense', 999)",
        "INSERT INTO app_settings (id) VALUES (2)",
        "UPDATE app_settings SET financial_month_start = 0",
    ] { assert!(connection.execute(sql, []).is_err(), "Aceitou SQL inválido: {sql}"); }
    for (amount, date, account) in [
        (0.0, "2026-09-10", 1),
        (10.5, "2026-09-10", 1),
        (10.0, "2026-02-30", 1),
        (10.0, "inválida", 1),
        (10.0, "2026-09-10", 999),
    ] {
        assert!(connection.execute("INSERT INTO transactions (description, amount, type, date, account_id, status) VALUES ('Teste', ?1, 'expense', ?2, ?3, 'posted')", rusqlite::params![amount, date, account]).is_err());
    }
    connection.execute("INSERT INTO transactions (description, amount, type, date, account_id, status) VALUES ('Teste', 1050, 'expense', '2026-09-10', 1, 'posted')", []).unwrap();
    assert!(connection
        .execute("DELETE FROM accounts WHERE id = 1", [])
        .is_err());
}

#[test]
fn corrupt_file_is_rejected_without_replacement() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("corrupt.sqlite3");
    let content = b"this is not a SQLite database";
    std::fs::write(&path, content).unwrap();
    assert!(Database::open(&path).is_err());
    assert_eq!(std::fs::read(&path).unwrap(), content);
}
