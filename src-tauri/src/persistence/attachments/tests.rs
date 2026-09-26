use super::*;
const PDF: &[u8] = b"%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF\n";
fn setup() -> (tempfile::TempDir, Database) {
    let dir = tempfile::tempdir().unwrap();
    let db = Database::open(&dir.path().join("db.sqlite")).unwrap();
    db.connection.execute_batch("INSERT INTO accounts(id,name,type,initial_balance) VALUES(1,'Conta','checking',1000);INSERT INTO transactions(id,description,type,amount,date,account_id,status) VALUES(1,'Compra','expense',100,'2026-09-01',1,'posted')").unwrap();
    (dir, db)
}
#[test]
fn copy_remove_source_validate_types_and_atomic_legacy_v2_restore() {
    let (dir, mut db) = setup();
    let source = dir.path().join("recibo.pdf");
    std::fs::write(&source, PDF).unwrap();
    let id = db
        .add_attachment("transaction", 1, "receipt", &source)
        .unwrap();
    std::fs::remove_file(&source).unwrap();
    assert!(db
        .add_attachment("transaction", 1, "receipt", &source)
        .is_err());
    assert!(db
        .add_attachment("transaction", 1, "receipt", dir.path())
        .is_err());
    assert_eq!(db.attachment_data(id).unwrap().bytes, PDF);
    assert_eq!(
        db.store_attachment("transaction", 1, "receipt", "recibo.pdf", PDF)
            .unwrap(),
        id
    );
    for name in [
        "../recibo.pdf",
        "C:\\recibo.pdf",
        "/recibo.pdf",
        "recibo.exe",
        "recibo.svg",
    ] {
        assert!(db
            .store_attachment("transaction", 1, "receipt", name, PDF)
            .is_err());
    }
    assert!(db
        .store_attachment(
            "transaction",
            1,
            "receipt",
            "recibo.pdf",
            b"<script>bad</script>"
        )
        .is_err());
    assert!(db
        .store_attachment(
            "transaction",
            1,
            "receipt",
            "recibo.pdf",
            &vec![0; MAX_FILE + 1]
        )
        .is_err());
    assert!(db
        .store_attachment("transaction", 999, "receipt", "recibo.pdf", PDF)
        .is_err());
    let package = dir.path().join("complete.dvbackup");
    db.export_backup_v2(&package).unwrap();
    assert!(db.export_backup_v2(&package).is_err());
    let legacy = dir.path().join("legacy.sqlite3");
    db.export_backup(&legacy).unwrap();
    db.remove_attachment(id).unwrap();
    assert!(db.attachment_data(id).is_err());
    let p = db.prepare_restore(&package).unwrap();
    assert_eq!(p.attachments, 1);
    assert!(db.confirm_restore(&p.token, false).is_err());
    assert!(db.attachments("transaction", 1, 0).unwrap().is_empty());
    db.confirm_restore(&p.token, true).unwrap();
    assert_eq!(db.attachment_data(id).unwrap().bytes, PDF);
    db.remove_attachment(id).unwrap();
    let p = db.prepare_restore(&legacy).unwrap();
    db.confirm_restore(&p.token, true).unwrap();
    assert_eq!(db.attachment_data(id).unwrap().bytes, PDF);
    assert_eq!(db.balances().unwrap()[0].cents, "900");
    // A failed recovery copy must leave both financial rows and attachments intact.
    let pending = db.prepare_restore(&package).unwrap();
    let backups = dir.path().join("backups");
    std::fs::rename(&backups, dir.path().join("saved-backups")).unwrap();
    std::fs::write(&backups, b"blocked").unwrap();
    assert!(db.confirm_restore(&pending.token, true).is_err());
    assert_eq!(db.attachment_data(id).unwrap().bytes, PDF);
}
#[test]
fn corrupted_or_incomplete_manifest_never_changes_current() {
    let (dir, mut db) = setup();
    let id = db
        .store_attachment("transaction", 1, "proof", "recibo.pdf", PDF)
        .unwrap();
    let package = dir.path().join("complete.dvbackup");
    db.export_backup_v2(&package).unwrap();
    let original = std::fs::read(&package).unwrap();
    let manifest_len = u64::from_le_bytes(original[10..18].try_into().unwrap()) as usize;
    let manifest: serde_json::Value =
        serde_json::from_slice(&original[18..18 + manifest_len]).unwrap();
    let bad = dir.path().join("bad.dvbackup");
    for mutation in 0..5 {
        let mut value = manifest.clone();
        match mutation {
            0 => value["snapshotName"] = "../escape.sqlite3".into(),
            1 => value["attachments"][0]["internalName"] = "C:\\escape.pdf".into(),
            2 => value["attachments"][0]["size"] = 1.into(),
            3 => value["attachments"] = serde_json::json!([]),
            _ => value["formatVersion"] = 99.into(),
        }
        let json = serde_json::to_vec(&value).unwrap();
        let mut bytes = b"DVBACKUP2\n".to_vec();
        bytes.extend((json.len() as u64).to_le_bytes());
        bytes.extend(json);
        bytes.extend(&original[18 + manifest_len..]);
        std::fs::write(&bad, bytes).unwrap();
        assert!(db.prepare_restore(&bad).is_err());
        assert_eq!(db.attachment_data(id).unwrap().bytes, PDF);
    }
    let mut corrupt = original.clone();
    *corrupt.last_mut().unwrap() ^= 1;
    std::fs::write(&bad, corrupt).unwrap();
    assert!(db.prepare_restore(&bad).is_err());
    std::fs::write(&bad, &original[..original.len() - 5]).unwrap();
    assert!(db.prepare_restore(&bad).is_err());
    assert_eq!(db.balances().unwrap()[0].cents, "900");
    assert_eq!(db.attachment_data(id).unwrap().bytes, PDF);
}
#[test]
fn backup_rejects_changed_blob_and_metadata() {
    let (dir, mut db) = setup();
    let id = db
        .store_attachment("transaction", 1, "proof", "recibo.pdf", PDF)
        .unwrap();
    let backup = dir.path().join("copy.sqlite3");
    db.export_backup(&backup).unwrap();
    let c = Connection::open(&backup).unwrap();
    c.execute("UPDATE attachments SET sha256=?1", ["a".repeat(64)])
        .unwrap();
    drop(c);
    assert!(db.prepare_restore(&backup).is_err());
    assert_eq!(db.attachment_data(id).unwrap().bytes, PDF);
}

#[test]
fn attachment_links_pages_and_cascade_are_consistent() {
    let (_dir, mut db) = setup();
    db.connection.execute_batch("INSERT INTO credit_cards(id,name,institution,credit_limit,closing_day,due_day) VALUES(1,'Cartão','Banco',10000,20,10)").unwrap();
    // Purchase insertion follows the actual schema defaults; attachment identity is separate.
    db.connection.execute_batch("INSERT INTO card_purchases(id,card_id,description,date,amount,installment_count) VALUES(1,1,'Compra','2026-09-01',100,1)").unwrap();
    let tx_id = db
        .store_attachment("transaction", 1, "proof", "recibo.pdf", PDF)
        .unwrap();
    let purchase_id = db
        .store_attachment("purchase", 1, "invoice", "recibo.pdf", PDF)
        .unwrap();
    assert_ne!(tx_id, purchase_id);
    assert_eq!(db.attachments("purchase", 1, 0).unwrap().len(), 1);
    assert!(db.attachments("purchase", 1, -1).is_err());
    assert!(db.attachments("purchase", 1, 21).is_err());
    assert!(db
        .store_attachment("purchase", 1, "unknown", "recibo.pdf", PDF)
        .is_err());
    db.connection
        .execute("DELETE FROM transactions WHERE id=1", [])
        .unwrap();
    assert!(db.attachment_data(tx_id).is_err());
    assert_eq!(db.attachment_data(purchase_id).unwrap().bytes, PDF);
    assert!(db
        .connection
        .execute("DELETE FROM card_purchases WHERE id=1", [])
        .is_err());
}
