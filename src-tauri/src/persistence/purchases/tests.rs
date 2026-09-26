use super::*;
use crate::domain::MAX_CENTS;
fn setup() -> (tempfile::TempDir, Database) {
    let dir = tempfile::tempdir().unwrap();
    let db = Database::open(&dir.path().join("db.sqlite")).unwrap();
    db.connection.execute_batch("INSERT INTO accounts(id,name,type,initial_balance) VALUES(1,'Conta','checking',10000); INSERT INTO credit_cards(id,name,institution,credit_limit,closing_day,due_day) VALUES(1,'Cartão','Banco',10000,31,10);").unwrap();
    (dir, db)
}
fn input() -> PurchaseInput {
    PurchaseInput {
        id: None,
        card_id: 1,
        description: "Compra".into(),
        date: "2024-02-29".into(),
        amount: 10000,
        installment_count: 3,
        category_id: Some(1),
        merchant: Some("Loja".into()),
        intermediary: None,
        channel: Some("online".into()),
        notes: None,
    }
}
#[test]
fn exact_split_calendar_consumption_and_cancellation() {
    let (_dir, mut db) = setup();
    let id = db.save_purchase(input()).unwrap();
    assert_eq!(split(10000, 3).unwrap(), vec![3334, 3333, 3333]);
    let invoices = db.invoices(1, "2024-03-11", 0).unwrap();
    assert_eq!(invoices.items.len(), 3);
    assert_eq!(invoices.committed, "10000");
    assert_eq!(invoices.available, "0");
    let first = invoices
        .items
        .iter()
        .find(|i| i.month == "2024-02")
        .unwrap();
    assert_eq!(first.closing_date, "2024-02-29");
    assert_eq!(first.due_date, "2024-03-10");
    assert_eq!(first.state, "overdue");
    assert_eq!(first.net, "3334");
    assert_eq!(
        db.dashboard("2024-02".into()).unwrap().current.expense,
        "10000"
    );
    assert_eq!(db.dashboard("2024-03".into()).unwrap().current.expense, "0");
    assert_eq!(db.balances().unwrap()[0].cents, "10000");
    assert!(db.list_transactions().unwrap().is_empty());
    db.save_budget("2024-02".into(), 1, 20000).unwrap();
    assert_eq!(db.budgets("2024-02".into()).unwrap()[0].spent, "10000");
    db.cancel_purchase(id).unwrap();
    assert_eq!(db.dashboard("2024-02".into()).unwrap().current.expense, "0");
    assert_eq!(db.invoices(1, "2024-03-11", 0).unwrap().committed, "0");
    assert_eq!(
        db.invoice_detail(first.id, "2024-03-11").unwrap().items[0].status,
        "cancelled"
    );
    assert_eq!(db.purchases(1, 0).unwrap().items[0].status, "cancelled");
    assert!(db.delete_card(1).is_err());
    validate_backup(&db.connection).unwrap();
}
#[test]
fn edits_preserve_invoice_dates_and_rollback_bad_inputs() {
    let (_dir, mut db) = setup();
    let id = db.save_purchase(input()).unwrap();
    db.connection
        .execute(
            "UPDATE credit_cards SET closing_day=5,due_day=15 WHERE id=1",
            [],
        )
        .unwrap();
    let mut p = input();
    p.id = Some(id);
    p.amount = 101;
    p.installment_count = 2;
    db.save_purchase(p.clone()).unwrap();
    let inv = db.invoices(1, "2024-02-29", 0).unwrap();
    let feb = inv.items.iter().find(|i| i.month == "2024-02").unwrap();
    assert_eq!(feb.closing_date, "2024-02-29");
    assert_eq!(feb.due_date, "2024-03-10");
    assert_eq!(feb.charges, "51");
    p.date = "9999-12-31".into();
    p.merchant = Some("Não persistir".into());
    assert!(db.save_purchase(p).is_err());
    assert_eq!(db.purchases(1, 0).unwrap().items[0].input.amount, 101);
    assert!(db
        .metadata("merchant", "Não persistir", false)
        .unwrap()
        .is_empty());
    db.set_card_active(1, false).unwrap();
    assert!(db.save_purchase(input()).is_err());
    let mut edit = input();
    edit.id = Some(id);
    db.save_purchase(edit).unwrap();
    assert!(db
        .connection
        .execute("UPDATE categories SET type='income' WHERE id=1", [])
        .is_err());
    validate_backup(&db.connection).unwrap();
}
#[test]
fn extremes_backup_and_rejected_tampering() {
    let (dir, mut db) = setup();
    for count in [1, 2, 3, 120] {
        let values = split(MAX_CENTS, count).unwrap();
        assert_eq!(
            values.iter().map(|v| i128::from(*v)).sum::<i128>(),
            i128::from(MAX_CENTS)
        );
    }
    for (amount, count) in [(0, 1), (1, 2), (100, 121), (-1, 1)] {
        assert!(split(amount, count).is_err());
    }
    let mut p = input();
    p.amount = MAX_CENTS;
    p.installment_count = 120;
    let id = db.save_purchase(p.clone()).unwrap();
    db.save_purchase(p).unwrap();
    assert_eq!(
        db.invoices(1, "2024-01-01", 0).unwrap().committed,
        (i128::from(MAX_CENTS) * 2).to_string()
    );
    assert_eq!(
        db.dashboard("2024-02".into()).unwrap().current.expense,
        (i128::from(MAX_CENTS) * 2).to_string()
    );
    let backup = dir.path().join("backup.sqlite");
    db.export_backup(&backup).unwrap();
    db.cancel_purchase(id).unwrap();
    let preview = db.prepare_restore(&backup).unwrap();
    db.confirm_restore(&preview.token, true).unwrap();
    assert_eq!(
        db.purchases(1, 0)
            .unwrap()
            .items
            .iter()
            .filter(|p| p.status == "active")
            .count(),
        2
    );
    let bad = Connection::open(&backup).unwrap();
    bad.execute(
        "UPDATE card_installments SET amount=amount+1 WHERE id=1",
        [],
    )
    .unwrap();
    drop(bad);
    assert!(db.prepare_restore(&backup).is_err());
    assert_eq!(db.purchases(1, 0).unwrap().items.len(), 2);
}
