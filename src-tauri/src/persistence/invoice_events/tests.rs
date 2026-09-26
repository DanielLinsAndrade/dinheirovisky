use super::*;
use crate::persistence::purchases::PurchaseInput;
fn setup() -> (tempfile::TempDir, Database, i64, i64) {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Database::open(&dir.path().join("db.sqlite")).unwrap();
    db.connection.execute_batch("INSERT INTO accounts(id,name,type,initial_balance) VALUES(1,'Conta','checking',100000),(2,'Outra','checking',200000); INSERT INTO credit_cards(id,name,institution,credit_limit,closing_day,due_day) VALUES(1,'Cartão','Banco',100000,31,10)").unwrap();
    let p = db
        .save_purchase(PurchaseInput {
            id: None,
            card_id: 1,
            description: "Compra".into(),
            date: "2024-02-29".into(),
            amount: 10000,
            installment_count: 1,
            category_id: Some(1),
            merchant: None,
            intermediary: None,
            channel: None,
            notes: None,
        })
        .unwrap();
    let invoice = db.invoices(1, "2024-03-01", 0).unwrap().items[0].id;
    (dir, db, p, invoice)
}
fn event(i: i64, key: &str, kind: &str, amount: i64) -> EventInput {
    EventInput {
        id: None,
        request_key: key.into(),
        invoice_id: i,
        kind: kind.into(),
        account_id: if kind == "payment" { Some(1) } else { None },
        purchase_id: None,
        amount,
        date: "2024-03-01".into(),
        description: kind.into(),
    }
}

#[test]
fn bulk_invoice_totals_match_single_invoice_with_events_and_date_bounds() {
    let (_dir, mut db, purchase, invoice) = setup();
    db.save_invoice_event(event(invoice, "bulk-payment", "payment", 1234))
        .unwrap();
    db.save_invoice_event(event(invoice, "bulk-charge", "charge", 123))
        .unwrap();
    db.save_invoice_event(event(invoice, "bulk-credit", "credit", 23))
        .unwrap();
    let mut refund = event(invoice, "bulk-refund", "refund", 100);
    refund.purchase_id = Some(purchase);
    db.save_invoice_event(refund).unwrap();
    let voided = db
        .save_invoice_event(event(invoice, "bulk-voided", "charge", 200))
        .unwrap();
    db.void_invoice_event(voided).unwrap();
    let single = totals(&db.connection, invoice).unwrap();
    let mut batch = totals_in_period(&db.connection, "2024-03-10", "2024-03-11").unwrap();
    let bulk = batch.remove(&invoice).unwrap();
    assert_eq!(
        (bulk.charges, bulk.credits, bulk.paid, bulk.installments),
        (single.charges, single.credits, single.paid, 1)
    );
    assert_eq!(bulk.remaining(), 8766);
    assert!(totals_in_period(&db.connection, "2024-03-01", "2024-03-10")
        .unwrap()
        .is_empty());
    assert!(totals_in_period(&db.connection, "2024-03-11", "2024-04-01")
        .unwrap()
        .is_empty());
}
#[test]
fn partial_multiple_full_edit_void_and_retry_without_double_expense() {
    let (_dir, mut db, p, i) = setup();
    let pay = event(i, "payment-1", "payment", 3000);
    let id = db.save_invoice_event(pay.clone()).unwrap();
    assert_eq!(db.save_invoice_event(pay.clone()).unwrap(), id);
    assert_eq!(read(&db.connection, i).unwrap().len(), 1);
    assert_eq!(db.balances().unwrap()[0].cents, "97000");
    assert_eq!(
        db.invoice_detail(i, "2024-03-01").unwrap().invoice.state,
        "partial"
    );
    assert_eq!(
        db.invoice_detail(i, "2024-03-11").unwrap().invoice.state,
        "overdue"
    );
    assert!(db.cancel_purchase(p).is_err());
    let second = db
        .save_invoice_event(event(i, "payment-2", "payment", 7000))
        .unwrap();
    assert_eq!(
        db.invoice_detail(i, "2024-03-01").unwrap().invoice.state,
        "paid"
    );
    assert!(db
        .save_invoice_event(event(i, "payment-3", "payment", 1))
        .is_err());
    assert_eq!(
        db.dashboard("2024-02".into()).unwrap().current.expense,
        "10000"
    );
    assert_eq!(db.dashboard("2024-03".into()).unwrap().current.expense, "0");
    let report = db
        .report("2024-03".into(), "2024-03".into(), Some(1))
        .unwrap();
    assert_eq!(report.expense, "0");
    assert_eq!(report.invoice_payments, "10000");
    assert_eq!(report.closing_balance, "90000");
    assert_eq!(report.savings, "-10000");
    db.void_invoice_event(second).unwrap();
    let mut edited = pay;
    edited.id = Some(id);
    edited.amount = 2000;
    edited.account_id = Some(2);
    db.save_invoice_event(edited).unwrap();
    assert_eq!(db.balances().unwrap()[0].cents, "100000");
    assert_eq!(db.balances().unwrap()[1].cents, "198000");
    db.void_invoice_event(id).unwrap();
    assert_eq!(db.balances().unwrap()[1].cents, "200000");
    assert_eq!(
        read(&db.connection, i)
            .unwrap()
            .iter()
            .filter(|e| e.voided)
            .count(),
        2
    );
    db.cancel_purchase(p).unwrap();
}
#[test]
fn refunds_after_payment_preserve_origin_and_credit_balance() {
    let (_dir, mut db, p, i) = setup();
    db.save_invoice_event(event(i, "payment-1", "payment", 10000))
        .unwrap();
    let mut refund = event(i, "refund-01", "refund", 4000);
    refund.purchase_id = Some(p);
    let id = db.save_invoice_event(refund.clone()).unwrap();
    let detail = db.invoice_detail(i, "2024-03-11").unwrap();
    assert_eq!(detail.invoice.credit_balance, "4000");
    assert_eq!(detail.invoice.remaining, "0");
    assert_eq!(db.balances().unwrap()[0].cents, "90000");
    assert_eq!(
        db.dashboard("2024-03".into()).unwrap().current.expense,
        "-4000"
    );
    db.save_budget("2024-03".into(), 1, 30000).unwrap();
    assert_eq!(
        db.budgets("2024-03".into()).unwrap()[0].percent.as_deref(),
        Some("-13.3")
    );
    assert_eq!(db.purchases(1, 0).unwrap().items[0].status, "active");
    refund.request_key = "refund-02".into();
    refund.amount = 6001;
    assert!(db.save_invoice_event(refund.clone()).is_err());
    refund.amount = 6000;
    db.save_invoice_event(refund).unwrap();
    assert_eq!(
        db.invoice_detail(i, "2024-03-11")
            .unwrap()
            .invoice
            .credit_balance,
        "10000"
    );
    db.void_invoice_event(id).unwrap();
    assert_eq!(
        db.invoice_detail(i, "2024-03-11")
            .unwrap()
            .invoice
            .credit_balance,
        "6000"
    );
    validate_backup(&db.connection).unwrap();
}
#[test]
fn adjustments_archived_accounts_backup_and_invalid_data() {
    let (dir, mut db, p, i) = setup();
    let mut charge = event(i, "charge-01", "charge", 500);
    let id = db.save_invoice_event(charge.clone()).unwrap();
    charge.id = Some(id);
    charge.amount = 600;
    db.save_invoice_event(charge).unwrap();
    let credit = db
        .save_invoice_event(event(i, "credit-01", "credit", 100))
        .unwrap();
    assert_eq!(totals(&db.connection, i).unwrap().remaining(), 10500);
    db.void_invoice_event(credit).unwrap();
    assert_eq!(totals(&db.connection, i).unwrap().remaining(), 10600);
    let mut pay = event(i, "payment-1", "payment", 1000);
    let pay_id = db.save_invoice_event(pay.clone()).unwrap();
    db.connection
        .execute("UPDATE accounts SET active=0 WHERE id=1", [])
        .unwrap();
    pay.id = Some(pay_id);
    pay.amount = 1100;
    db.save_invoice_event(pay).unwrap();
    assert!(db
        .save_invoice_event(event(i, "payment-2", "payment", 1))
        .is_err());
    let mut refund = event(i, "refund-01", "refund", 1);
    refund.purchase_id = Some(p);
    refund.date = "2024-02-28".into();
    assert!(db.save_invoice_event(refund).is_err());
    let mut bad = event(i, "negative-1", "payment", -1);
    assert!(db.save_invoice_event(bad.clone()).is_err());
    bad.amount = 1;
    bad.invoice_id = 999;
    assert!(db.save_invoice_event(bad).is_err());
    let backup = dir.path().join("backup.sqlite");
    db.export_backup(&backup).unwrap();
    db.void_invoice_event(pay_id).unwrap();
    let preview = db.prepare_restore(&backup).unwrap();
    db.confirm_restore(&preview.token, true).unwrap();
    assert_eq!(db.balances().unwrap()[0].cents, "98900");
    validate_backup(&db.connection).unwrap();
    let corrupt = Connection::open(&backup).unwrap();
    corrupt
        .execute(
            "UPDATE invoice_events SET description=char(1) WHERE id=?1",
            [pay_id],
        )
        .unwrap();
    drop(corrupt);
    assert!(db.prepare_restore(&backup).is_err());
    assert_eq!(db.balances().unwrap()[0].cents, "98900");
}
