use super::*;
fn input() -> CardInput {
    CardInput {
        id: None,
        name: "Principal".into(),
        institution: "Banco".into(),
        last_four: Some("0123".into()),
        brand: Some("Visa".into()),
        credit_limit: MAX_CENTS,
        closing_day: 31,
        due_day: 10,
        default_account_id: Some(1),
    }
}
fn setup() -> (tempfile::TempDir, Database) {
    let dir = tempfile::tempdir().unwrap();
    let db = Database::open(&dir.path().join("db.sqlite")).unwrap();
    db.connection
        .execute(
            "INSERT INTO accounts(id,name,type,initial_balance) VALUES(1,'Conta','checking',12345)",
            [],
        )
        .unwrap();
    (dir, db)
}
#[test]
fn lifecycle_backup_and_money_are_independent() {
    let (dir, mut db) = setup();
    let cards = db.save_card(input()).unwrap();
    let id = cards[0].input.id.unwrap();
    assert_eq!(cards[0].input.credit_limit, MAX_CENTS);
    assert_eq!(db.balances().unwrap()[0].cents, "12345");
    assert!(db.list_transactions().unwrap().is_empty());
    db.set_card_active(id, false).unwrap();
    let mut edit = input();
    edit.id = Some(id);
    edit.name = "Renomeado".into();
    db.save_card(edit).unwrap();
    assert!(!db.list_cards().unwrap()[0].active);
    db.connection
        .execute("UPDATE accounts SET active=0 WHERE id=1", [])
        .unwrap();
    let mut edit = input();
    edit.id = Some(id);
    db.save_card(edit).unwrap();
    assert!(db.save_card(input()).is_err());
    let path = dir.path().join("backup.sqlite");
    db.export_backup(&path).unwrap();
    db.delete_card(id).unwrap();
    assert!(db.list_cards().unwrap().is_empty());
    let preview = db.prepare_restore(&path).unwrap();
    db.confirm_restore(&preview.token, true).unwrap();
    assert_eq!(db.list_cards().unwrap()[0].input.id, Some(id));
    assert!(!db.list_cards().unwrap()[0].active);
    assert_eq!(db.balances().unwrap()[0].cents, "12345");
    assert_eq!(
        db.card_calendar(id, "2024-02").unwrap()[0].closing_date,
        "2024-02-29"
    );
    db.set_card_active(id, true).unwrap();
    assert!(db.list_cards().unwrap()[0].active);
    db.connection.execute_batch("CREATE TABLE linked_history(card_id INTEGER REFERENCES credit_cards(id)); INSERT INTO linked_history VALUES(1);").unwrap();
    assert!(db.delete_card(id).is_err());
    assert_eq!(db.list_cards().unwrap().len(), 1);
}
#[test]
fn invalid_inputs_and_corrupt_backups_preserve_data() {
    let (dir, mut db) = setup();
    for change in 0..7 {
        let mut card = input();
        match change {
            0 => card.credit_limit = -1,
            1 => card.closing_day = 0,
            2 => card.due_day = 32,
            3 => card.last_four = Some("12345".into()),
            4 => card.institution = "\n".into(),
            5 => card.default_account_id = Some(999),
            _ => card.name = "bad\nname".into(),
        };
        assert!(db.save_card(card).is_err());
        assert!(db.list_cards().unwrap().is_empty());
    }
    db.save_card(input()).unwrap();
    let path = dir.path().join("bad.sqlite");
    db.export_backup(&path).unwrap();
    let c = Connection::open(&path).unwrap();
    c.execute("UPDATE credit_cards SET name='bad'||char(10)||'name'", [])
        .unwrap();
    drop(c);
    assert!(db.prepare_restore(&path).is_err());
    assert_eq!(db.list_cards().unwrap()[0].input.name, "Principal");
    assert!(db
        .connection
        .execute("UPDATE credit_cards SET credit_limit=1.5", [])
        .is_err());
    assert!(db
        .connection
        .execute("UPDATE credit_cards SET default_account_id=999", [])
        .is_err());
    assert!(db.delete_card(999).is_err());
}
