use super::*;
use crate::domain::AccountInput;
fn setup() -> (tempfile::TempDir, Database) {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Database::open(&dir.path().join("import.sqlite")).unwrap();
    db.save_account(AccountInput {
        id: None,
        name: "Conta".into(),
        kind: "checking".into(),
        initial_balance: 10000,
    })
    .unwrap();
    (dir, db)
}
fn row(amount: i64) -> ImportRow {
    ImportRow {
        line: 2,
        source_account_id: 1,
        movement: Movement {
            details: None,
            id: None,
            description: "Mercado".into(),
            amount,
            kind: "expense".into(),
            date: "2026-09-11".into(),
            account_id: 1,
            destination_account_id: None,
            category_id: None,
            status: "posted".into(),
            notes: None,
        },
        external_id: None,
        raw_amount: "10.50".into(),
    }
}

#[test]
fn card_statement_cannot_be_mapped_to_bank_even_with_ofx_tag_whitespace() {
    let (_dir, db) = setup();
    for tag in ["CCSTMTRS", " ccstmtrs "] {
        let ofx = format!("<OFX><{tag}><CURDEF>BRL<CCACCTFROM><ACCTID>synthetic</CCACCTFROM><BANKTRANLIST><STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260921<TRNAMT>-12.34<FITID>card-test-1<NAME>Compra</STMTTRN></BANKTRANLIST></CCSTMTRS></OFX>");
        assert!(parse_ofx(&ofx).unwrap().card_statement);
        assert!(db
            .prepare_import(ofx, "ofx".into(), None, 1)
            .err()
            .unwrap()
            .contains("OFX de cartão"));
    }
    assert!(db.list_transactions().unwrap().is_empty());
}

#[test]
fn metadata_preview_is_readonly_and_commit_preserves_identity_and_rolls_back() {
    let (_dir, mut db) = setup();
    let options: CsvOptions = serde_json::from_value(serde_json::json!({"delimiter":";","decimal":",","dateFormat":"dd/MM/yyyy","dateColumn":0,"descriptionColumn":1,"amountColumn":2,"typeColumn":null,"metadataColumns":{"method":3,"merchant":4,"channel":5,"intermediary":6}})).unwrap();
    let csv = "Data;Descrição;Valor;Método;Loja;Modalidade;Intermediador\n11/09/2026;Compra;-10,51;Pix;Loja Nova;presencial;Entrega Nova";
    let preview = db
        .prepare_import(csv.into(), "csv".into(), Some(options.clone()), 1)
        .unwrap();
    // Method names are exact catalog names, case-insensitive, never inferred.
    assert!(
        preview.rows[0].error.is_none(),
        "{:?}",
        preview.rows[0].error
    );
    assert!(db.metadata("merchant", "", true).unwrap().is_empty());
    assert!(db.list_transactions().unwrap().is_empty());
    let rows = vec![preview.rows.into_iter().next().unwrap().row];
    db.commit_import(
        "metadata-import-0001".into(),
        rows.clone(),
        "BRL".into(),
        false,
    )
    .unwrap();
    assert!(
        db.commit_import("metadata-import-0001".into(), rows, "BRL".into(), false)
            .unwrap()
            .repeated
    );
    let saved = db.list_transactions().unwrap().remove(0);
    assert_eq!(
        saved.details.as_ref().unwrap().merchant.as_deref(),
        Some("Loja Nova")
    );
    assert_eq!(
        saved.details.as_ref().unwrap().channel.as_deref(),
        Some("in_person")
    );
    let linked: i64 = db
        .connection
        .query_row("SELECT transaction_id FROM import_entries", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(Some(linked), saved.id);
    let invalid = db
        .prepare_import(
            csv.replace("Pix", "Método inexistente"),
            "csv".into(),
            Some(options.clone()),
            1,
        )
        .unwrap();
    assert!(invalid.rows[0].error.is_some());
    let invalid = db
        .prepare_import(
            csv.replace("presencial", "ambígua"),
            "csv".into(),
            Some(options),
            1,
        )
        .unwrap();
    assert!(invalid.rows[0].error.is_some());
    let mut valid = row(500);
    valid.movement.details = Some(Details {
        merchant: Some("Não persistir".into()),
        ..Default::default()
    });
    let mut bad = row(600);
    bad.movement.details = Some(Details {
        intermediary: Some("inválido\ncontrole".into()),
        ..Default::default()
    });
    assert!(db
        .commit_import(
            "metadata-rollback-0001".into(),
            vec![valid, bad],
            "BRL".into(),
            false
        )
        .is_err());
    assert!(db
        .metadata("merchant", "Não persistir", true)
        .unwrap()
        .is_empty());
    assert_eq!(db.list_transactions().unwrap().len(), 1);
    assert_eq!(db.balances().unwrap()[0].cents, "8949");
}
#[test]
fn ofx_incoming_transfer_preserves_source_identity_and_currency() {
    let (_dir, mut db) = setup();
    db.save_account(AccountInput {
        id: None,
        name: "Origem".into(),
        kind: "checking".into(),
        initial_balance: 10000,
    })
    .unwrap();
    let ofx = "<OFX><STMTRS><CURDEF>BRL<BANKACCTFROM><BANKID>001<ACCTID>123</BANKACCTFROM><BANKTRANLIST><STMTTRN><TRNTYPE>XFER<DTPOSTED>20260911<TRNAMT>10.50<FITID>transfer-1<NAME>Recebida</STMTTRN></BANKTRANLIST></STMTRS></OFX>";
    assert!(db
        .prepare_import(ofx.replace("BRL", "USD"), "ofx".into(), None, 1)
        .is_err());
    let mut preview = db
        .prepare_import(ofx.into(), "ofx".into(), None, 1)
        .unwrap();
    assert!(preview.rows[0].error.is_some());
    assert_eq!(preview.rows[0].row.movement.destination_account_id, Some(1));
    preview.rows[0].row.movement.account_id = 2;
    db.commit_import(
        "transfer-confirm-0001".into(),
        vec![preview.rows.remove(0).row],
        "BRL".into(),
        false,
    )
    .unwrap();
    let preview = db
        .prepare_import(ofx.into(), "ofx".into(), None, 1)
        .unwrap();
    assert!(preview.rows[0].already_imported);
    let balances = db.balances().unwrap();
    assert_eq!(
        balances.iter().find(|b| b.account_id == 1).unwrap().cents,
        "11050"
    );
    assert_eq!(
        balances.iter().find(|b| b.account_id == 2).unwrap().cents,
        "8950"
    );
}
#[test]
fn preview_never_writes_and_commit_is_atomic_idempotent() {
    let (_dir, mut db) = setup();
    let rows = vec![row(1050)];
    assert!(db.review_import(rows.clone(), "BRL".into()).unwrap()[0]
        .error
        .is_none());
    assert!(db.list_transactions().unwrap().is_empty());
    let request = "confirmation-00001".to_owned();
    let result = db
        .commit_import(request.clone(), rows.clone(), "BRL".into(), false)
        .unwrap();
    assert_eq!(result.imported, 1);
    assert_eq!(db.balances().unwrap()[0].cents, "8950");
    assert!(
        db.commit_import(request, rows, "BRL".into(), false)
            .unwrap()
            .repeated
    );
    assert_eq!(db.list_transactions().unwrap().len(), 1);
    assert!(db
        .commit_import(
            "confirmation-00001".into(),
            vec![row(200)],
            "BRL".into(),
            false
        )
        .is_err());
    let mut invalid = row(100);
    invalid.movement.date = "2026-02-30".into();
    assert!(db
        .commit_import(
            "confirmation-00002".into(),
            vec![row(100), invalid],
            "BRL".into(),
            true
        )
        .is_err());
    assert_eq!(db.list_transactions().unwrap().len(), 1);
    db.connection.execute_batch("CREATE TRIGGER fail_import BEFORE INSERT ON transactions WHEN NEW.amount=777 BEGIN SELECT RAISE(ABORT,'injected failure'); END;").unwrap();
    assert!(db
        .commit_import(
            "confirmation-00003".into(),
            vec![row(200), row(777)],
            "BRL".into(),
            true
        )
        .is_err());
    assert_eq!(db.list_transactions().unwrap().len(), 1);
    assert_eq!(
        db.connection
            .query_row("SELECT count(*) FROM import_batches", [], |r| r
                .get::<_, i64>(0))
            .unwrap(),
        1
    );
}
#[test]
fn duplicates_inside_batch_existing_and_fitid_after_deletion() {
    let (_dir, mut db) = setup();
    let rows = vec![row(1050), row(1050)];
    let preview = db.review_import(rows.clone(), "BRL".into()).unwrap();
    assert!(!preview[0].duplicate);
    assert!(preview[1].duplicate);
    assert!(db
        .commit_import(
            "confirmation-00004".into(),
            rows.clone(),
            "BRL".into(),
            false
        )
        .is_err());
    db.commit_import("confirmation-00004".into(), rows, "BRL".into(), true)
        .unwrap();
    assert!(db.review_import(vec![row(1050)], "BRL".into()).unwrap()[0].duplicate);
    let mut ofx = row(400);
    ofx.external_id = Some("bank/account/fitid".into());
    db.commit_import(
        "confirmation-00005".into(),
        vec![ofx.clone()],
        "BRL".into(),
        false,
    )
    .unwrap();
    let id = db
        .list_transactions()
        .unwrap()
        .iter()
        .find(|m| m.amount == 400)
        .unwrap()
        .id
        .unwrap();
    db.delete_transaction(id).unwrap();
    assert!(db.review_import(vec![ofx.clone()], "BRL".into()).unwrap()[0].already_imported);
    assert!(db
        .commit_import("confirmation-00006".into(), vec![ofx], "BRL".into(), true)
        .is_err());
}
#[test]
fn revalidates_changed_currency_accounts_categories_and_transfers() {
    let (_dir, mut db) = setup();
    db.review_import(vec![row(100)], "BRL".into()).unwrap();
    db.set_account_active(1, false).unwrap();
    assert!(db
        .commit_import(
            "confirmation-00007".into(),
            vec![row(100)],
            "BRL".into(),
            false
        )
        .is_err());
    db.set_account_active(1, true).unwrap();
    let mut s = db.settings().unwrap();
    s.currency = "USD".into();
    db.save_settings(s, true).unwrap();
    assert!(db
        .commit_import(
            "confirmation-00008".into(),
            vec![row(100)],
            "BRL".into(),
            false
        )
        .is_err());
    db.save_account(AccountInput {
        id: None,
        name: "Destino".into(),
        kind: "wallet".into(),
        initial_balance: 0,
    })
    .unwrap();
    let mut transfer = row(300);
    transfer.movement.kind = "transfer".into();
    assert!(db
        .review_import(vec![transfer.clone()], "USD".into())
        .unwrap()[0]
        .error
        .is_some());
    transfer.movement.destination_account_id = Some(2);
    db.commit_import(
        "confirmation-00009".into(),
        vec![transfer],
        "USD".into(),
        false,
    )
    .unwrap();
    let balances = db.balances().unwrap();
    assert_eq!(balances[0].cents, "9700");
    assert_eq!(balances[1].cents, "300");
    let mut invalid = row(100);
    invalid.movement.category_id = Some(
        db.list_categories()
            .unwrap()
            .iter()
            .find(|c| c.kind == "income")
            .unwrap()
            .id,
    );
    assert!(db.review_import(vec![invalid], "USD".into()).unwrap()[0]
        .error
        .is_some());
}
#[test]
fn migration_six_preserves_history_and_integrity() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("upgrade.sqlite");
    let mut c = rusqlite::Connection::open(&path).unwrap();
    super::super::migrations::migrate(&mut c, &super::super::migrations::MIGRATIONS[..5]).unwrap();
    c.execute_batch(
        "INSERT INTO accounts(name,type,initial_balance) VALUES('Original','checking',12345);",
    )
    .unwrap();
    drop(c);
    for _ in 0..2 {
        let db = Database::open(&path).unwrap();
        assert_eq!(
            db.status().unwrap().0,
            crate::persistence::migrations::MIGRATIONS.len() as i64
        );
        assert_eq!(db.balances().unwrap()[0].cents, "12345");
        assert_eq!(
            db.connection
                .query_row("PRAGMA integrity_check", [], |r| r.get::<_, String>(0))
                .unwrap(),
            "ok"
        );
        assert!(!db
            .connection
            .prepare("PRAGMA foreign_key_check")
            .unwrap()
            .exists([])
            .unwrap());
    }
}
