use super::*;
use crate::domain::{AccountInput, MAX_CENTS};
use crate::persistence::transactions::Movement;
fn setup() -> (tempfile::TempDir, Database) {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Database::open(&dir.path().join("reports.sqlite")).unwrap();
    for (name, initial_balance) in [("A", 1000), ("B", 2000)] {
        db.save_account(AccountInput {
            id: None,
            name: name.into(),
            kind: "checking".into(),
            initial_balance,
        })
        .unwrap();
    }
    (dir, db)
}
fn add(db: &mut Database, kind: &str, amount: i64, date: &str, status: &str) -> Movement {
    db.save_transaction(Movement {
        details: None,
        id: None,
        description: "Teste".into(),
        kind: kind.into(),
        amount,
        date: date.into(),
        status: status.into(),
        account_id: 1,
        destination_account_id: if kind == "transfer" { Some(2) } else { None },
        category_id: None,
        notes: None,
    })
    .unwrap()
    .into_iter()
    .find(|m| m.kind == kind && m.date == date && m.amount == amount)
    .unwrap()
}
#[test]
fn balances_flows_archived_accounts_and_transfers_reconcile() {
    let (_dir, mut db) = setup();
    add(&mut db, "income", 500, "2025-12-31", "posted");
    add(&mut db, "expense", 100, "2026-01-10", "posted");
    add(&mut db, "income", 300, "2026-02-01", "posted");
    add(&mut db, "transfer", 200, "2026-02-03", "posted");
    add(&mut db, "expense", 999, "2026-02-04", "pending");
    add(&mut db, "income", 999, "2026-02-04", "scheduled");
    add(&mut db, "income", 999, "2027-01-01", "posted");
    db.set_account_active(2, false).unwrap();
    let r = db.report("2026-01".into(), "2026-03".into(), None).unwrap();
    assert_eq!(r.opening_balance, "3500");
    assert_eq!(r.closing_balance, "3700");
    assert_eq!(r.income, "300");
    assert_eq!(r.expense, "100");
    assert_eq!(r.savings, "200");
    assert_eq!(r.transfers, "0");
    assert_eq!(r.movement_count, 3);
    assert_eq!(r.months[0].result_change.as_deref(), Some("-600"));
    assert_eq!(r.months[1].result_change.as_deref(), Some("400"));
    assert_eq!(r.months[2].income, "0");
    assert_eq!(r.months[2].cumulative_savings, "200");
    assert_eq!(r.categories[0].expense, "100");
    let a = db
        .report("2026-01".into(), "2026-03".into(), Some(1))
        .unwrap();
    let b = db
        .report("2026-01".into(), "2026-03".into(), Some(2))
        .unwrap();
    assert_eq!(a.closing_balance, "1500");
    assert_eq!(b.closing_balance, "2200");
    assert_eq!(a.transfers, "-200");
    assert_eq!(b.transfers, "200");
    assert_eq!(b.income, "0");
    assert_eq!(b.savings, "0");
}
#[test]
fn financial_months_leap_year_extremes_and_filter_validation() {
    let (_dir, mut db) = setup();
    let mut s = db.settings().unwrap();
    s.financial_month_start = 15;
    db.save_settings(s, false).unwrap();
    add(&mut db, "expense", 10, "2024-02-14", "posted");
    add(&mut db, "expense", 20, "2024-02-15", "posted");
    add(&mut db, "expense", 30, "2024-02-29", "posted");
    add(&mut db, "expense", 40, "2024-03-14", "posted");
    add(&mut db, "expense", 99, "2024-03-15", "posted");
    let r = db.report("2024-02".into(), "2024-02".into(), None).unwrap();
    assert_eq!(r.start_date, "2024-02-15");
    assert_eq!(r.end_date, "2024-03-14");
    assert_eq!(r.opening_balance, "2990");
    assert_eq!(r.expense, "90");
    assert_eq!(r.months[0].result_change.as_deref(), Some("-80"));
    assert_eq!(
        db.report("0001-01".into(), "0001-01".into(), None)
            .unwrap()
            .months[0]
            .result_change,
        None
    );
    assert_eq!(
        db.report("9999-12".into(), "9999-12".into(), None)
            .unwrap()
            .end_date,
        "9999-12-31"
    );
    for (from, to) in [
        ("2026-02", "2026-01"),
        ("0000-01", "2026-01"),
        ("2026-13", "2026-13"),
        ("2026-01", "2036-01"),
        ("oops", "2026-01"),
    ] {
        assert!(db.report(from.into(), to.into(), None).is_err());
    }
    assert!(db.report("2026-01".into(), "2035-12".into(), None).is_ok());
    assert!(db
        .report("2026-01".into(), "2026-01".into(), Some(999))
        .is_err());
}
#[test]
fn category_paths_reconcile_and_edits_deletions_refresh() {
    let (_dir, mut db) = setup();
    let parent = db
        .list_categories()
        .unwrap()
        .into_iter()
        .find(|c| c.name == "Moradia")
        .unwrap()
        .id;
    let child = db
        .save_category(crate::domain::CategoryInput {
            id: None,
            name: "Aluguel".into(),
            kind: "expense".into(),
            parent_id: Some(parent),
            icon: "home".into(),
        })
        .unwrap()
        .into_iter()
        .find(|c| c.name == "Aluguel")
        .unwrap()
        .id;
    let mut movement = add(&mut db, "expense", 100, "2026-01-10", "posted");
    movement.category_id = Some(child);
    db.save_transaction(movement.clone()).unwrap();
    add(&mut db, "expense", 200, "2026-01-11", "posted");
    db.set_category_active(child, false).unwrap();
    let r = db.report("2026-01".into(), "2026-01".into(), None).unwrap();
    assert_eq!(r.categories[0].name, "Sem categoria");
    assert_eq!(r.categories[1].name, "Moradia › Aluguel");
    assert_eq!(
        r.categories
            .iter()
            .map(|c| c.expense.parse::<i128>().unwrap())
            .sum::<i128>(),
        300
    );
    movement.amount = 500;
    db.save_transaction(movement.clone()).unwrap();
    assert_eq!(
        db.report("2026-01".into(), "2026-01".into(), None)
            .unwrap()
            .expense,
        "700"
    );
    db.delete_transaction(movement.id.unwrap()).unwrap();
    assert_eq!(
        db.report("2026-01".into(), "2026-01".into(), None)
            .unwrap()
            .expense,
        "200"
    );
}
#[test]
fn exact_large_negative_totals_and_read_only_snapshot() {
    let (_dir, mut db) = setup();
    for day in ["2026-01-01", "2026-01-02"] {
        add(&mut db, "expense", MAX_CENTS, day, "posted");
    }
    let before = db.connection.total_changes();
    let r = db.report("2026-01".into(), "2026-02".into(), None).unwrap();
    let total = 2 * i128::from(MAX_CENTS);
    assert_eq!(r.expense, total.to_string());
    assert_eq!(r.closing_balance, (3000 - total).to_string());
    assert_eq!(r.months[1].cumulative_savings, (-total).to_string());
    assert_eq!(before, db.connection.total_changes());
    assert_eq!(
        db.status().unwrap().0,
        crate::persistence::migrations::MIGRATIONS.len() as i64
    );
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
