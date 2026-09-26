use super::*;

fn fixture() -> (TempDir, Database) {
    let dir = tempfile::tempdir().unwrap();
    let db = Database::open(&dir.path().join("live.sqlite3")).unwrap();
    db.connection.execute_batch("INSERT INTO accounts(name,type,initial_balance) VALUES('Preservar','checking',12345);
        INSERT INTO transactions(description,amount,type,date,account_id,status) VALUES('Preservar',100,'income','2026-01-01',1,'posted');").unwrap();
    (dir, db)
}

fn rejects_without_changes(sql: &str) {
    let (dir, mut db) = fixture();
    let valid = dir.path().join("valid.sqlite3");
    db.export_backup(&valid).unwrap();
    let stale = db.prepare_restore(&valid).unwrap();
    let path = dir.path().join("candidate.sqlite3");
    fs::copy(&valid, &path).unwrap();
    let candidate = Connection::open(&path).unwrap();
    candidate.execute_batch(sql).unwrap();
    drop(candidate);
    let bytes = fs::read(&path).unwrap();
    assert!(db.prepare_restore(&path).is_err(), "Aceitou: {sql}");
    assert!(db.confirm_restore(&stale.token, true).is_err());
    assert_eq!(fs::read(&path).unwrap(), bytes, "Alterou a origem");
    assert_eq!(db.balances().unwrap()[0].cents, "12445");
    assert_eq!(db.list_transactions().unwrap().len(), 1);
    integrity(&db.connection).unwrap();
    drop(db);
    let reopened = Database::open(&dir.path().join("live.sqlite3")).unwrap();
    assert_eq!(reopened.balances().unwrap()[0].cents, "12445");
}

#[test]
fn rejects_schema_prefix_lookalikes_before_any_restore() {
    for sql in [
        "CREATE TRIGGER sqliteXaudit AFTER INSERT ON transactions BEGIN DELETE FROM transactions WHERE id!=NEW.id; END;",
        "CREATE TABLE sqliteXtable(id INTEGER);",
        "CREATE VIEW sqliteXview AS SELECT * FROM transactions;",
        "CREATE INDEX sqliteXindex ON transactions(description);",
        "CREATE TRIGGER SQLITEXaudit AFTER INSERT ON accounts BEGIN DELETE FROM transactions; END;",
    ] {
        rejects_without_changes(sql);
    }
}

#[test]
fn rejects_invalid_ids_text_dates_and_catalog_rules() {
    for sql in [
        "INSERT INTO accounts(id,name,type) VALUES(9007199254740993,'Unsafe','wallet');",
        "INSERT INTO categories(id,name,type) VALUES(-1,'Negative','expense');",
        "UPDATE transactions SET id=0;",
        "INSERT INTO goals(id,name,target_amount) VALUES(9007199254740992,'Unsafe',100);",
        "INSERT INTO budgets(id,month,year,category_id,limit_amount) VALUES(-1,1,2026,1,100);",
        "INSERT INTO recurrences(id,frequency,start_date) VALUES(-1,'monthly','2026-01-01');",
        "INSERT INTO goals(id,name,target_amount,current_amount,completed) VALUES(1,'Goal',100,100,1); INSERT INTO goal_contributions(id,goal_id,amount,date) VALUES(-1,1,100,'2026-01-01');",
        "UPDATE accounts SET name='bad'||char(10)||'name';",
        "UPDATE transactions SET description='bad'||char(0)||'text';",
        "UPDATE transactions SET notes=printf('%04001d',0);",
        "UPDATE transactions SET date='0000-01-01';",
        "INSERT INTO goals(name,target_amount,target_date) VALUES('Goal',100,'0000-01-01');",
        "INSERT INTO recurrences(frequency,start_date) VALUES('monthly','0000-01-01');",
        "UPDATE categories SET icon='unknown';",
        "INSERT INTO accounts(name,type) VALUES('PRESERVAR','wallet');",
        "INSERT INTO categories(name,type) VALUES('Alimentação','expense');",
    ] { rejects_without_changes(sql); }
}

const SERIES: &str = "INSERT INTO recurrences(id,frequency,interval,start_date) VALUES(1,'monthly',1,'2026-01-31');
    INSERT INTO recurrence_templates(recurrence_id,description,amount,type,account_id,next_index) VALUES(1,'Series',100,'expense',1,1);
    UPDATE transactions SET recurrence_id=1;
    INSERT INTO recurrence_occurrences VALUES(1,'2026-01-31',1);";

#[test]
fn rejects_invalid_recurrence_calendars_cursors_and_ledger_links() {
    for mutation in [
        "UPDATE recurrences SET interval=121;",
        "UPDATE recurrences SET interval=9223372036854775807;",
        "UPDATE recurrence_templates SET next_index=9223372036854775807;",
        "UPDATE recurrence_templates SET next_index=0;",
        "UPDATE recurrence_templates SET next_index=600000;",
        "UPDATE recurrence_templates SET ended=1;",
        "UPDATE recurrence_templates SET description='bad'||char(9);",
        "UPDATE recurrence_occurrences SET occurrence_date='2026-01-30';",
        "UPDATE recurrence_occurrences SET occurrence_date='2026-02-28';",
        "UPDATE transactions SET recurrence_id=NULL;",
        "DELETE FROM recurrence_occurrences;",
        "DELETE FROM recurrence_templates;",
        "INSERT INTO recurrence_occurrences VALUES(1,'2026-02-28',1); UPDATE recurrence_templates SET next_index=2;",
    ] { rejects_without_changes(&format!("{SERIES}{mutation}")); }
}

#[test]
fn rejects_invalid_import_metadata_and_entry_ids() {
    let base = "INSERT INTO import_batches VALUES('confirmation-0001','0000000000000000000000000000000000000000000000000000000000000000',1,'2026-01-01');
        INSERT INTO import_entries(id,batch_id,account_id,external_id,transaction_id) VALUES(1,'confirmation-0001',1,'external',1);";
    for mutation in [
        "UPDATE import_entries SET id=9007199254740992;",
        "UPDATE import_entries SET external_id='';",
        "UPDATE import_entries SET external_id=printf('%02049d',0);",
        "UPDATE import_batches SET payload_hash='bad';",
        "UPDATE import_batches SET imported_count=2001;",
        "PRAGMA foreign_keys=OFF; UPDATE import_entries SET batch_id='confirmation-000!'; UPDATE import_batches SET request_id='confirmation-000!';",
    ] { rejects_without_changes(&format!("{base}{mutation}")); }
}

#[test]
fn restores_every_official_schema_version_without_changing_the_source() {
    for version in 1..=migrations::MIGRATIONS.len() {
        let (dir, mut db) = fixture();
        let path = dir.path().join("old.sqlite3");
        let mut old = Connection::open(&path).unwrap();
        migrations::migrate(&mut old, &migrations::MIGRATIONS[..version]).unwrap();
        old.execute_batch("INSERT INTO accounts(id,name,type,initial_balance,active) VALUES(1,'Archived','wallet',12345,0);
            INSERT INTO recurrences(id,frequency,interval,start_date) VALUES(1,'monthly',1,'2024-01-31');
            INSERT INTO transactions(description,amount,type,date,account_id,status,recurrence_id) VALUES('Legacy',100,'expense','2024-01-31',1,'posted',1);").unwrap();
        if version < 5 {
            old.execute_batch("INSERT INTO goals(name,target_amount,current_amount) VALUES('Legacy goal',100,120);").unwrap();
        }
        drop(old);
        let bytes = fs::read(&path).unwrap();
        let preview = db.prepare_restore(&path).unwrap();
        assert_eq!(preview.original_version, version);
        db.confirm_restore(&preview.token, true).unwrap();
        assert_eq!(fs::read(&path).unwrap(), bytes);
        assert_eq!(db.balances().unwrap()[0].cents, "12245");
        assert_eq!(db.list_transactions().unwrap().len(), 1);
        if version < 5 {
            assert_eq!(db.list_goals().unwrap()[0].current_amount, 120);
        }
        assert_eq!(
            db.status().unwrap().0,
            crate::persistence::migrations::MIGRATIONS.len() as i64
        );
        integrity(&db.connection).unwrap();
    }
}

#[test]
fn valid_edited_deleted_paused_and_exhausted_series_roundtrip() {
    use crate::persistence::planning::RecurrenceInput;
    let (dir, mut db) = fixture();
    let input = RecurrenceInput {
        id: None,
        description: "Series".into(),
        amount: 100,
        kind: "expense".into(),
        account_id: 1,
        category_id: None,
        notes: None,
        frequency: "monthly".into(),
        interval: 1,
        start_date: "2024-01-31".into(),
        end_date: Some("2024-03-31".into()),
        planning_class: None,
    };
    let id = db.save_recurrence(input.clone()).unwrap()[0]
        .input
        .id
        .unwrap();
    db.materialize_recurrences("2024-02-29".into()).unwrap();
    let generated = db.list_transactions().unwrap();
    let mut edited = generated
        .iter()
        .find(|m| m.date == "2024-01-31")
        .unwrap()
        .clone();
    edited.date = "2025-01-01".into();
    edited.kind = "income".into();
    edited.amount = 500;
    db.save_transaction(edited).unwrap();
    db.delete_transaction(
        generated
            .iter()
            .find(|m| m.date == "2024-02-29")
            .unwrap()
            .id
            .unwrap(),
    )
    .unwrap();
    db.set_recurrence_state(id, "pause".into(), "2024-03-01".into())
        .unwrap();
    db.set_recurrence_state(id, "resume".into(), "2025-01-01".into())
        .unwrap();
    let mut ended = input;
    ended.start_date = "9999-12-31".into();
    ended.end_date = None;
    let ended_id = db.save_recurrence(ended).unwrap()[0].input.id.unwrap();
    db.materialize_recurrences("9999-12-31".into()).unwrap();
    db.set_recurrence_state(ended_id, "end".into(), "9999-12-31".into())
        .unwrap();
    db.set_account_active(1, false).unwrap();
    let path = dir.path().join("valid.sqlite3");
    db.export_backup(&path).unwrap();
    let p = db.prepare_restore(&path).unwrap();
    db.confirm_restore(&p.token, true).unwrap();
    assert_eq!(db.materialize_recurrences("9999-12-31".into()).unwrap(), 0);
    assert_eq!(db.list_recurrences().unwrap().len(), 2);
    assert!(db
        .list_transactions()
        .unwrap()
        .iter()
        .any(|m| m.date == "2025-01-01" && m.amount == 500));
}
