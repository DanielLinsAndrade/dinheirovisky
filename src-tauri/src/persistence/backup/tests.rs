use super::*;
use crate::domain::AccountInput;
fn setup() -> (TempDir, Database) {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Database::open(&dir.path().join("live.sqlite3")).unwrap();
    db.save_account(AccountInput {
        id: None,
        name: "Original".into(),
        kind: "checking".into(),
        initial_balance: 12345,
    })
    .unwrap();
    (dir, db)
}
#[test]
fn snapshot_restore_recovery_and_reopen() {
    let (dir, mut db) = setup();
    let path = dir.path().join("backup.sqlite3");
    db.export_backup(&path).unwrap();
    db.save_account(AccountInput {
        id: None,
        name: "Depois".into(),
        kind: "wallet".into(),
        initial_balance: 222,
    })
    .unwrap();
    let preview = db.prepare_restore(&path).unwrap();
    assert_eq!(preview.accounts, 1);
    assert_eq!(db.list_accounts().unwrap().len(), 2);
    assert!(db.confirm_restore(&preview.token, false).is_err());
    assert!(db.confirm_restore("wrong", true).is_err());
    let recovery = db.confirm_restore(&preview.token, true).unwrap();
    assert_eq!(db.list_accounts().unwrap().len(), 1);
    assert_eq!(db.balances().unwrap()[0].cents, "12345");
    assert!(db.confirm_restore(&preview.token, true).is_err());
    let before = Database::open(Path::new(&recovery)).unwrap();
    assert_eq!(before.list_accounts().unwrap().len(), 2);
    drop(before);
    drop(db);
    let db = Database::open(&dir.path().join("live.sqlite3")).unwrap();
    assert_eq!(db.list_accounts().unwrap().len(), 1);
}
#[test]
fn rejects_invalid_and_tampered_backups_without_touching_current() {
    let (dir, mut db) = setup();
    assert!(db
        .prepare_restore(&dir.path().join("live.sqlite3"))
        .is_err());
    let bad = dir.path().join("bad.sqlite3");
    fs::write(&bad, b"not a database").unwrap();
    assert!(db.prepare_restore(&bad).is_err());
    for sql in ["CREATE TABLE alien(id INTEGER);","UPDATE schema_migrations SET source='tampered' WHERE version=1;","PRAGMA foreign_keys=OFF; INSERT INTO transactions(description,amount,type,date,account_id,status) VALUES('bad',100,'income','2026-09-11',999,'posted');", "UPDATE app_settings SET currency='ZZZ';"] {
        let candidate=tempfile::NamedTempFile::new_in(dir.path()).unwrap();
        let mut c=Connection::open(candidate.path()).unwrap(); copy_database(&db.connection,&mut c).unwrap(); c.execute_batch(sql).unwrap(); drop(c);
        assert!(db.prepare_restore(candidate.path()).is_err(),"{sql}"); assert_eq!(db.list_accounts().unwrap().len(),1);
    }
    let c = Connection::open(dir.path().join("evil.sqlite3")).unwrap();
    c.execute_batch("CREATE VIEW schema_migrations AS WITH RECURSIVE x(a) AS (VALUES(1) UNION ALL SELECT a+1 FROM x) SELECT a AS version, 'x' AS source FROM x;").unwrap();
    drop(c);
    assert!(db
        .prepare_restore(&dir.path().join("evil.sqlite3"))
        .is_err());
}
#[test]
fn old_backup_upgrades_only_staging_copy_and_newer_is_rejected() {
    let (dir, mut db) = setup();
    let path = dir.path().join("old.sqlite3");
    let mut old = Connection::open(&path).unwrap();
    migrations::migrate(&mut old, &migrations::MIGRATIONS[..1]).unwrap();
    drop(old);
    let p = db.prepare_restore(&path).unwrap();
    assert_eq!(p.original_version, 1);
    let old = Connection::open(&path).unwrap();
    assert_eq!(
        old.query_row("SELECT count(*) FROM schema_migrations", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        1
    );
    drop(old);
    db.cancel_restore();
    assert!(db.confirm_restore(&p.token, true).is_err());
    let c = Connection::open(&path).unwrap();
    c.execute(
        "INSERT INTO schema_migrations(version,source) VALUES(99,'future')",
        [],
    )
    .unwrap();
    drop(c);
    assert!(db.prepare_restore(&path).is_err());
}
#[test]
fn refuses_changed_live_data_overwrites_and_missing_recovery_location() {
    let (dir, mut db) = setup();
    let path = dir.path().join("backup.sqlite3");
    db.export_backup(&path).unwrap();
    let original = fs::read(&path).unwrap();
    assert!(db.export_backup(&path).is_err());
    assert_eq!(fs::read(&path).unwrap(), original);
    let p = db.prepare_restore(&path).unwrap();
    db.save_account(AccountInput {
        id: None,
        name: "Nova".into(),
        kind: "wallet".into(),
        initial_balance: 0,
    })
    .unwrap();
    assert!(db.confirm_restore(&p.token, true).is_err());
    let p = db.prepare_restore(&path).unwrap();
    fs::write(dir.path().join("backups"), "file prevents directory").unwrap();
    assert!(db.confirm_restore(&p.token, true).is_err());
    assert_eq!(db.list_accounts().unwrap().len(), 2);
}
#[test]
fn sqlite_aborted_backup_preserves_destination() {
    let (_dir, db) = setup();
    let mut destination = Connection::open_in_memory().unwrap();
    destination
        .execute_batch("CREATE TABLE original(id); INSERT INTO original VALUES(42);")
        .unwrap();
    {
        let backup = Backup::new(&db.connection, &mut destination).unwrap();
        assert!(matches!(backup.step(1).unwrap(), StepResult::More));
    }
    assert_eq!(
        destination
            .query_row("SELECT id FROM original", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        42
    );
}
#[test]
fn csv_exact_values_escaping_formula_protection_and_no_overwrite() {
    let (dir, mut db) = setup();
    db.save_transaction(super::super::transactions::Movement {
        details: None,
        id: None,
        description: "=HYPERLINK(\"bad\")".into(),
        amount: 9007199254740991,
        kind: "expense".into(),
        date: "2026-09-11".into(),
        account_id: 1,
        destination_account_id: None,
        category_id: None,
        status: "posted".into(),
        notes: Some("line;1\nline2".into()),
    })
    .unwrap();
    let path = dir.path().join("export.csv");
    assert_eq!(db.export_transactions(&path).unwrap(), 1);
    let csv = fs::read_to_string(&path).unwrap();
    assert!(csv.contains("-90071992547409.91"));
    assert!(csv.contains("\"'=HYPERLINK(\"\"bad\"\")\""));
    assert!(csv.contains("\"line;1\nline2\""));
    assert!(db.export_transactions(&path).is_err());
    assert_eq!(db.list_transactions().unwrap().len(), 1);
}

#[test]
fn complete_history_roundtrip_and_volume_smoke() {
    let (dir, mut db) = setup();
    db.connection.execute_batch("BEGIN;
      INSERT INTO recurrences(id,frequency,interval,start_date) VALUES(1,'monthly',1,'2026-01-01');
      INSERT INTO recurrence_templates(recurrence_id,description,amount,type,account_id,next_index) VALUES(1,'Recorrente',100,'expense',1,1);
      INSERT INTO transactions(id,description,amount,type,date,account_id,status,recurrence_id) VALUES(1,'Recorrente',100,'expense','2026-01-01',1,'scheduled',1);
      INSERT INTO recurrence_occurrences VALUES(1,'2026-01-01',1);
      INSERT INTO goals(id,name,target_amount,current_amount) VALUES(1,'Reserva',500,100);
      INSERT INTO goal_contributions(goal_id,amount,date) VALUES(1,100,'2026-01-01');
      INSERT INTO import_batches(request_id,payload_hash,imported_count) VALUES('confirmation-0001','0000000000000000000000000000000000000000000000000000000000000000',1);
      INSERT INTO import_entries(batch_id,account_id,external_id,transaction_id) VALUES('confirmation-0001',1,'fitid',1);
      COMMIT;").unwrap();
    let tx = db.connection.unchecked_transaction().unwrap();
    for _ in 0..10000 {
        tx.execute("INSERT INTO transactions(description,amount,type,date,account_id,status) VALUES('Volume',100,'expense','2026-01-02',1,'posted')",[]).unwrap();
    }
    tx.commit().unwrap();
    let started = std::time::Instant::now();
    assert_eq!(db.balances().unwrap()[0].cents, "-987655");
    eprintln!("Volume 10001 transações: saldos em {:?}", started.elapsed());
    let snapshot = dir.path().join("complete.sqlite3");
    db.export_backup(&snapshot).unwrap();
    db.connection
        .execute("UPDATE goals SET name='Alterado' WHERE id=1", [])
        .unwrap();
    let p = db.prepare_restore(&snapshot).unwrap();
    assert_eq!(p.transactions, 10001);
    db.confirm_restore(&p.token, true).unwrap();
    for table in [
        "recurrences",
        "recurrence_templates",
        "recurrence_occurrences",
        "goals",
        "goal_contributions",
        "import_batches",
        "import_entries",
    ] {
        assert_eq!(
            db.connection
                .query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            1
        );
    }
    assert_eq!(
        db.connection
            .query_row("SELECT name FROM goals", [], |r| r.get::<_, String>(0))
            .unwrap(),
        "Reserva"
    );
    integrity(&db.connection).unwrap();
}
