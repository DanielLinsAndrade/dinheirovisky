use super::*;
fn setup() -> (tempfile::TempDir, Database) {
    let dir = tempfile::tempdir().unwrap();
    let db = Database::open(&dir.path().join("db.sqlite")).unwrap();
    db.connection.execute_batch("INSERT INTO accounts(id,name,type,initial_balance) VALUES(1,'Conta','checking',10000); INSERT INTO credit_cards(id,name,institution,credit_limit,closing_day,due_day) VALUES(1,'Cartão','Banco',100000,20,28);").unwrap();
    (dir, db)
}
fn row() -> CardImportRow {
    CardImportRow {
        line: 1,
        purchase: PurchaseInput {
            id: None,
            card_id: 1,
            description: "Compra".into(),
            date: "2026-09-21".into(),
            amount: 1001,
            installment_count: 3,
            category_id: None,
            merchant: Some("Loja Nova".into()),
            intermediary: None,
            channel: Some("online".into()),
            notes: None,
        },
        external_id: Some("source-fitid-1".into()),
        raw_amount: "-10.01".into(),
        source_card: Some("Cartão".into()),
        first_invoice: Some("2026-10".into()),
        confirmed_purchase: true,
        source_kind: "expense".into(),
    }
}
#[test]
fn card_import_is_atomic_exact_readonly_and_idempotent_even_after_cancellation() {
    let (_dir, mut db) = setup();
    assert!(db.review_card_import(vec![row()], "BRL".into()).unwrap()[0]
        .error
        .is_none());
    assert!(db.metadata("merchant", "", true).unwrap().is_empty());
    assert_eq!(db.purchases(1, 0).unwrap().total, 0);
    let request = "card-confirmation-001";
    assert_eq!(
        db.commit_card_import(request.into(), vec![row()], "BRL".into(), false)
            .unwrap()
            .imported,
        1
    );
    assert!(
        db.commit_card_import(request.into(), vec![row()], "BRL".into(), false)
            .unwrap()
            .repeated
    );
    assert_eq!(db.balances().unwrap()[0].cents, "10000");
    assert_eq!(
        db.dashboard("2026-09".into()).unwrap().current.expense,
        "1001"
    );
    assert_eq!(db.invoices(1, "2026-09-22", 0).unwrap().committed, "1001");
    let amounts: Vec<i64> = db
        .connection
        .prepare("SELECT amount FROM card_installments ORDER BY number")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    assert_eq!(amounts, vec![334, 334, 333]);
    let id = db.purchases(1, 0).unwrap().items[0].input.id.unwrap();
    db.cancel_purchase(id).unwrap();
    assert!(db.review_card_import(vec![row()], "BRL".into()).unwrap()[0].already_imported);
    assert!(db
        .commit_card_import(
            "card-confirmation-002".into(),
            vec![row()],
            "BRL".into(),
            true
        )
        .is_err());
    let mut csv = row();
    csv.external_id = None;
    assert!(
        db.review_card_import(vec![csv.clone()], "BRL".into())
            .unwrap()[0]
            .duplicate
    );
    assert!(db
        .commit_card_import(
            "card-confirmation-003".into(),
            vec![csv.clone()],
            "BRL".into(),
            false
        )
        .is_err());
    db.commit_card_import(
        "card-confirmation-003".into(),
        vec![csv],
        "BRL".into(),
        true,
    )
    .unwrap();
}
#[test]
fn card_import_rejects_ambiguity_mismatch_and_invalid_lot_without_writes() {
    let (_dir, mut db) = setup();
    for case in 0..7 {
        let mut r = row();
        match case {
            0 => r.confirmed_purchase = false,
            1 => r.purchase.installment_count = 0,
            2 => r.first_invoice = Some("2026-09".into()),
            3 => r.source_card = Some("Outro".into()),
            4 => r.source_kind = "income".into(),
            5 => r.purchase.merchant = Some("bad\nname".into()),
            _ => r.purchase.id = Some(1),
        }
        assert!(
            db.review_card_import(vec![r.clone()], "BRL".into())
                .unwrap()[0]
                .error
                .is_some(),
            "case {case}"
        );
        assert!(db
            .commit_card_import(
                format!("card-invalid-lot-{case}"),
                vec![row(), r],
                "BRL".into(),
                true
            )
            .is_err());
        assert_eq!(db.purchases(1, 0).unwrap().total, 0);
        assert!(db.metadata("merchant", "", true).unwrap().is_empty());
    }
    assert!(db
        .commit_card_import(
            "card-duplicate-fitid".into(),
            vec![row(), row()],
            "BRL".into(),
            true
        )
        .is_err());
    let options: CsvOptions=serde_json::from_value(serde_json::json!({"delimiter":";","decimal":",","dateFormat":"dd/MM/yyyy","dateColumn":0,"descriptionColumn":1,"amountColumn":2,"typeColumn":null,"metadataColumns":{"installments":3,"invoice":4,"card":5}})).unwrap();
    let csv =
        "Data;Descrição;Valor;Parcelas;Fatura;Cartão\n21/09/2026;Compra;-10,01;3;2026-10;Cartão";
    assert!(db
        .prepare_import(csv.into(), "csv".into(), Some(options.clone()), 1)
        .is_err());
    let mut preview = db
        .prepare_card_import(csv.into(), "csv".into(), Some(options), 1)
        .unwrap();
    let r = &mut preview.rows[0].row;
    assert!(!r.confirmed_purchase);
    assert_eq!(r.purchase.installment_count, 3);
    r.confirmed_purchase = true;
    db.commit_card_import(
        "csv-card-confirm-001".into(),
        vec![r.clone()],
        "BRL".into(),
        false,
    )
    .unwrap();
}
#[test]
fn card_import_backup_roundtrip_and_upgrade_preserve_ledger() {
    let (dir, mut db) = setup();
    db.commit_card_import(
        "backup-card-confirm1".into(),
        vec![row()],
        "BRL".into(),
        false,
    )
    .unwrap();
    let path = dir.path().join("backup.sqlite");
    db.export_backup(&path).unwrap();
    db.cancel_purchase(1).unwrap();
    let preview = db.prepare_restore(&path).unwrap();
    db.confirm_restore(&preview.token, true).unwrap();
    assert_eq!(db.purchases(1, 0).unwrap().items[0].status, "active");
    assert!(db.review_card_import(vec![row()], "BRL".into()).unwrap()[0].already_imported);
    let old = dir.path().join("old.sqlite");
    let mut c = rusqlite::Connection::open(&old).unwrap();
    super::super::migrations::migrate(&mut c, &super::super::migrations::MIGRATIONS[..13]).unwrap();
    drop(c);
    let upgraded = Database::open(&old).unwrap();
    assert_eq!(upgraded.status().unwrap().0, 14);
}
