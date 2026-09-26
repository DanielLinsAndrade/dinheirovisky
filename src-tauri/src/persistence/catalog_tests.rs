use super::*;
use crate::domain::{AccountInput, CategoryInput, MAX_CENTS};

fn account(id: Option<i64>, name: &str, balance: i64) -> AccountInput {
    AccountInput {
        id,
        name: name.into(),
        kind: "checking".into(),
        initial_balance: balance,
    }
}
fn category(id: Option<i64>, name: &str, kind: &str, parent_id: Option<i64>) -> CategoryInput {
    CategoryInput {
        id,
        name: name.into(),
        kind: kind.into(),
        parent_id,
        icon: "tag".into(),
    }
}

#[test]
fn account_lifecycle_preserves_ids_history_and_persistence() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("accounts.sqlite3");
    let mut db = Database::open(&path).unwrap();
    let rows = db
        .save_account(account(None, "  Principal  ", 1050))
        .unwrap();
    let original = &rows[0];
    assert_eq!(original.name, "Principal");
    assert_eq!(original.initial_balance, 1050);
    let id = original.id;
    // Apenas fixture de integridade referencial; não implementa transações.
    db.connection.execute("INSERT INTO transactions(description,amount,type,date,account_id,status) VALUES ('Fixture',1,'expense','2026-09-10',?1,'posted')", [id]).unwrap();
    let rows = db
        .save_account(account(Some(id), "Principal editada", -12345))
        .unwrap();
    assert_eq!(rows[0].id, id);
    assert_eq!(rows[0].created_at, original.created_at);
    assert_eq!(rows[0].initial_balance, -12345);
    assert!(!db.set_account_active(id, false).unwrap()[0].active);
    assert_eq!(
        db.connection
            .query_row("SELECT account_id FROM transactions", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        id
    );
    assert!(db
        .save_account(account(None, "PRINCIPAL EDITADA", 0))
        .unwrap_err()
        .contains("Já existe"));
    drop(db);
    let mut db = Database::open(&path).unwrap();
    assert!(!db.list_accounts().unwrap()[0].active);
    assert!(db.set_account_active(id, true).unwrap()[0].active);
    assert_eq!(db.list_accounts().unwrap()[0].initial_balance, -12345);
}

#[test]
fn account_validations_reject_bad_inputs_without_changes() {
    let directory = tempfile::tempdir().unwrap();
    let mut db = Database::open(&directory.path().join("test.sqlite3")).unwrap();
    for name in [" ", "Conta\nquebrada", &"a".repeat(121)] {
        assert!(db.save_account(account(None, name, 0)).is_err());
    }
    assert!(db.save_account(account(None, "X", MAX_CENTS + 1)).is_err());
    assert!(db.save_account(account(None, "X", -MAX_CENTS - 1)).is_err());
    assert!(db.save_account(account(Some(999), "X", 0)).is_err());
    assert!(db.set_account_active(999, false).is_err());
    assert!(db.set_account_active(0, false).is_err());
    let mut invalid = account(None, "X", 0);
    invalid.kind = "invalid".into();
    assert!(db.save_account(invalid).is_err());
    assert!(db.list_accounts().unwrap().is_empty());
    for kind in [
        "wallet",
        "checking",
        "savings",
        "digital",
        "investment",
        "other",
    ] {
        let mut input = account(None, kind, MAX_CENTS);
        input.kind = kind.into();
        db.save_account(input).unwrap();
    }
    db.save_account(account(None, "Árvore ' de teste", -MAX_CENTS))
        .unwrap();
    assert!(db
        .save_account(account(None, "ÁRVORE ' DE TESTE", 0))
        .is_err());
    assert_eq!(db.list_accounts().unwrap().len(), 7);
}

#[test]
fn categories_validate_cycles_types_and_archive_order() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("categories.sqlite3");
    let mut db = Database::open(&path).unwrap();
    let parent = db
        .list_categories()
        .unwrap()
        .into_iter()
        .find(|item| item.name == "Moradia")
        .unwrap();
    let rows = db
        .save_category(category(None, "Internet", "expense", Some(parent.id)))
        .unwrap();
    let child = rows
        .iter()
        .find(|item| item.name == "Internet")
        .unwrap()
        .clone();
    let rows = db
        .save_category(category(None, "Fibra", "expense", Some(child.id)))
        .unwrap();
    let leaf = rows
        .iter()
        .find(|item| item.name == "Fibra")
        .unwrap()
        .clone();
    assert!(db
        .save_category(category(
            Some(parent.id),
            "Moradia",
            "expense",
            Some(leaf.id)
        ))
        .unwrap_err()
        .contains("ancestral"));
    assert!(db
        .save_category(category(
            Some(child.id),
            "Internet",
            "expense",
            Some(child.id)
        ))
        .is_err());
    assert!(db
        .save_category(category(Some(parent.id), "Moradia", "income", None))
        .is_err());
    assert!(db
        .save_category(category(None, "Teste", "income", Some(parent.id)))
        .is_err());
    assert!(db
        .save_category(category(None, "Teste", "expense", Some(999)))
        .is_err());
    assert!(db
        .save_category(category(None, "INTERNET", "expense", Some(parent.id)))
        .is_err());
    assert!(db.set_category_active(parent.id, false).is_err());
    db.set_category_active(leaf.id, false).unwrap();
    db.set_category_active(child.id, false).unwrap();
    db.set_category_active(parent.id, false).unwrap();
    assert!(db.set_category_active(child.id, true).is_err());
    assert!(db
        .save_category(category(None, "Nova", "expense", Some(parent.id)))
        .is_err());
    drop(db);
    let mut db = Database::open(&path).unwrap();
    assert!(
        !db.list_categories()
            .unwrap()
            .iter()
            .find(|item| item.id == parent.id)
            .unwrap()
            .active
    );
    db.set_category_active(parent.id, true).unwrap();
    db.set_category_active(child.id, true).unwrap();
    db.set_category_active(leaf.id, true).unwrap();
    let mut edit = category(Some(leaf.id), "Fibra editada", "expense", Some(child.id));
    edit.icon = "home".into();
    let rows = db.save_category(edit).unwrap();
    let saved = rows.iter().find(|item| item.id == leaf.id).unwrap();
    assert_eq!(saved.icon, "home");
    assert_eq!(saved.created_at, leaf.created_at);
}

#[test]
fn category_validation_and_sql_triggers_protect_the_tree() {
    let directory = tempfile::tempdir().unwrap();
    let mut db = Database::open(&directory.path().join("test.sqlite3")).unwrap();
    assert!(db
        .save_category(category(None, " ", "expense", None))
        .is_err());
    assert!(db
        .save_category(category(Some(999), "X", "expense", None))
        .is_err());
    assert!(db
        .save_category(category(None, "X", "transfer", None))
        .is_err());
    let mut invalid = category(None, "X", "expense", None);
    invalid.icon = "<script>".into();
    assert!(db.save_category(invalid).is_err());
    let rows = db.list_categories().unwrap();
    let parent = rows.iter().find(|item| item.name == "Moradia").unwrap();
    let rows = db
        .save_category(category(None, "Sub", "expense", Some(parent.id)))
        .unwrap();
    let child = rows.iter().find(|item| item.name == "Sub").unwrap();
    assert!(db
        .connection
        .execute(
            "UPDATE categories SET parent_id=?1 WHERE id=?2",
            rusqlite::params![child.id, parent.id]
        )
        .is_err());
    assert!(db
        .connection
        .execute("UPDATE categories SET active=0 WHERE id=?1", [parent.id])
        .is_err());
    assert!(db
        .connection
        .execute(
            "UPDATE categories SET type='income' WHERE id=?1",
            [parent.id]
        )
        .is_err());
    assert_eq!(db.list_categories().unwrap().len(), 15);
    assert_eq!(
        db.connection
            .query_row("PRAGMA integrity_check", [], |row| row.get::<_, String>(0))
            .unwrap(),
        "ok"
    );
}

#[test]
fn stage_one_database_upgrades_without_reset_or_duplicate_seeds() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("old.sqlite3");
    {
        let mut connection = Connection::open(&path).unwrap();
        connection.execute_batch("PRAGMA foreign_keys=ON").unwrap();
        migrations::migrate(&mut connection, &migrations::MIGRATIONS[..1]).unwrap();
        connection.execute("INSERT INTO accounts(name,type,initial_balance) VALUES ('Preservada','wallet',12345)", []).unwrap();
        connection
            .execute(
                "INSERT INTO categories(name,type,active) VALUES ('Moradia','expense',0)",
                [],
            )
            .unwrap();
        connection
            .execute("UPDATE app_settings SET locale='en-US'", [])
            .unwrap();
    }
    for _ in 0..2 {
        let db = Database::open(&path).unwrap();
        assert_eq!(
            db.status().unwrap().0,
            crate::persistence::migrations::MIGRATIONS.len() as i64
        );
        assert_eq!(db.list_accounts().unwrap()[0].initial_balance, 12345);
        let categories = db.list_categories().unwrap();
        assert_eq!(categories.len(), 14);
        assert!(
            !categories
                .iter()
                .find(|item| item.name == "Moradia")
                .unwrap()
                .active
        );
        assert_eq!(
            categories
                .iter()
                .filter(|item| item.kind == "expense")
                .count(),
            9
        );
        assert_eq!(
            categories
                .iter()
                .filter(|item| item.kind == "income")
                .count(),
            5
        );
        assert_eq!(
            db.connection
                .query_row("SELECT locale FROM app_settings", [], |row| row
                    .get::<_, String>(0))
                .unwrap(),
            "en-US"
        );
    }
}
