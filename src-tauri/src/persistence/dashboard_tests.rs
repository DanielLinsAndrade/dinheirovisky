use super::{transactions::Movement, Database};
use crate::domain::{AccountInput, MAX_CENTS};

#[test]
fn daily_obligations_include_overdue_generated_and_archived_without_writing() {
    let (_dir, mut db) = database();
    let overdue = add(&mut db, "expense", 101, "2025-01-01", "pending");
    add(&mut db, "expense", 202, "2026-09-12", "scheduled");
    add(&mut db, "expense", MAX_CENTS, "2026-10-12", "pending");
    add(&mut db, "expense", 404, "2026-10-13", "pending");
    add(&mut db, "expense", 505, "2026-09-10", "posted");
    add(&mut db, "income", 606, "2026-09-11", "pending");
    add(&mut db, "transfer", 707, "2026-09-11", "scheduled");
    db.save_recurrence(super::planning::RecurrenceInput {
        id: None,
        description: "Recorrente diária".into(),
        amount: 808,
        kind: "expense".into(),
        account_id: 1,
        category_id: None,
        notes: None,
        frequency: "monthly".into(),
        interval: 1,
        start_date: "2026-09-01".into(),
        end_date: None,
        planning_class: None,
    })
    .unwrap();
    assert_eq!(db.materialize_recurrences("2026-09-12".into()).unwrap(), 1);
    db.set_account_active(1, false).unwrap();
    let before = db.connection.total_changes();
    let rows = db.due_payments("2026-09-12").unwrap();
    assert_eq!(rows.len(), 4);
    assert_eq!(rows[0].id, overdue.id.unwrap());
    assert_eq!(rows[1].description, "Recorrente diária");
    assert_eq!(rows[3].amount, MAX_CENTS);
    assert!(rows.iter().all(|r| r.account_name == "Principal"));
    assert_eq!(db.due_payments("2026-09-12").unwrap().len(), 4);
    assert_eq!(db.connection.total_changes(), before);
    let mut paid = overdue;
    paid.status = "posted".into();
    db.save_transaction(paid).unwrap();
    assert_eq!(db.due_payments("2026-09-12").unwrap().len(), 3);
    assert!(db.due_payments("2026-02-30").is_err());
    assert!(db.due_payments("0000-01-01").is_err());
    assert_eq!(db.due_payments("9999-12-31").unwrap().len(), 4);
}

fn database() -> (tempfile::TempDir, Database) {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Database::open(&dir.path().join("dashboard.sqlite")).unwrap();
    for (name, balance) in [("Principal", 10000), ("Reserva", 20000)] {
        db.save_account(AccountInput {
            id: None,
            name: name.into(),
            kind: "checking".into(),
            initial_balance: balance,
        })
        .unwrap();
    }
    (dir, db)
}

#[test]
fn obligation_windows_paginate_exact_boundaries_without_writes() {
    let (_dir, mut db) = database();
    for day in [
        "2026-09-11",
        "2026-09-12",
        "2026-09-19",
        "2026-09-20",
        "2026-10-12",
        "2026-10-13",
    ] {
        add(&mut db, "expense", MAX_CENTS, day, "pending");
    }
    add(&mut db, "income", 123, "2026-09-12", "pending");
    add(&mut db, "transfer", 456, "2026-09-12", "scheduled");
    add(&mut db, "expense", 789, "2026-09-12", "posted");
    db.set_account_active(1, false).unwrap();
    let before = db.connection.total_changes();
    let overdue = db.due_payment_page("2026-09-12", "overdue", 0).unwrap();
    assert_eq!(overdue.total, 1);
    assert_eq!(overdue.items[0].date, "2026-09-11");
    let week = db.due_payment_page("2026-09-12", "week", 0).unwrap();
    assert_eq!(week.total, 2);
    assert_eq!(week.items[1].date, "2026-09-19");
    assert_eq!(week.items[1].amount, MAX_CENTS);
    assert_eq!(
        db.due_payment_page("2026-09-12", "month", 0).unwrap().total,
        4
    );
    assert_eq!(
        db.due_payment_page("2026-09-12", "all", 0).unwrap().total,
        5
    );
    let empty = db
        .due_payment_page("0001-01-01", "overdue", i64::MAX)
        .unwrap();
    assert_eq!(empty.page, 0);
    assert!(empty.items.is_empty());
    assert_eq!(db.connection.total_changes(), before);
    assert!(db.due_payment_page("2026-02-30", "all", 0).is_err());
    assert!(db.due_payment_page("2026-09-12", "invalid", 0).is_err());
    assert!(db.due_payment_page("2026-09-12", "all", -1).is_err());
    db.set_account_active(1, true).unwrap();
    add(&mut db, "expense", 1, "2026-09-12", "scheduled");
    let last = db.due_payment_page("2026-09-12", "all", i64::MAX).unwrap();
    assert_eq!(last.page, 1);
    assert_eq!(last.items.len(), 1);
    assert_eq!(last.items[0].date, "2026-10-12");
    add(&mut db, "expense", 2, "9999-12-31", "scheduled");
    assert_eq!(
        db.due_payment_page("9999-12-31", "week", 0).unwrap().items[0].amount,
        2
    );
}
fn add(db: &mut Database, kind: &str, amount: i64, date: &str, status: &str) -> Movement {
    db.save_transaction(Movement {
        details: None,
        id: None,
        description: format!("{kind} {date}"),
        amount,
        kind: kind.into(),
        date: date.into(),
        account_id: 1,
        destination_account_id: if kind == "transfer" { Some(2) } else { None },
        category_id: None,
        status: status.into(),
        notes: None,
    })
    .unwrap()
    .into_iter()
    .find(|m| m.description == format!("{kind} {date}"))
    .unwrap()
}

#[test]
fn monthly_totals_exclude_transfers_pending_and_scheduled_and_keep_archived_history() {
    let (_dir, mut db) = database();
    add(&mut db, "income", 5000, "2026-09-01", "posted");
    add(&mut db, "expense", 1200, "2026-09-30", "posted");
    add(&mut db, "transfer", 2000, "2026-09-10", "posted");
    add(&mut db, "income", 99999, "2026-09-12", "pending");
    add(&mut db, "expense", 99999, "2026-09-13", "scheduled");
    add(&mut db, "income", 3000, "2026-08-31", "posted");
    add(&mut db, "expense", 1000, "2026-08-01", "posted");
    add(&mut db, "expense", 10, "2026-10-01", "posted");
    let summary = db.dashboard("2026-09".into()).unwrap();
    assert_eq!(summary.current.income, "5000");
    assert_eq!(summary.current.expense, "1200");
    assert_eq!(summary.current.result, "3800");
    assert_eq!(summary.previous.unwrap().result, "2000");
    assert_eq!(summary.result_change.as_deref(), Some("1800"));
    assert_eq!(summary.balance, "35790");
    assert_eq!(summary.recent.len(), 5);
    assert_eq!(summary.categories[0].name, "Sem categoria");
    assert_eq!(summary.categories[0].cents, "1200");
    db.set_account_active(1, false).unwrap();
    let archived = db.dashboard("2026-09".into()).unwrap();
    assert_eq!(archived.balance, "22000");
    assert_eq!(archived.active_accounts, 1);
    assert_eq!(archived.current.income, "5000");
    assert_eq!(archived.recent[0].account_name, "Principal");
}

#[test]
fn changes_and_deletions_are_reflected_without_cached_totals() {
    let (_dir, mut db) = database();
    let mut m = add(&mut db, "income", 100, "2026-09-11", "posted");
    m.amount = 250;
    db.save_transaction(m.clone()).unwrap();
    assert_eq!(
        db.dashboard("2026-09".into()).unwrap().current.result,
        "250"
    );
    m.date = "2026-08-11".into();
    db.save_transaction(m.clone()).unwrap();
    let result = db.dashboard("2026-09".into()).unwrap();
    assert_eq!(result.current.income, "0");
    assert_eq!(result.previous.unwrap().income, "250");
    db.delete_transaction(m.id.unwrap()).unwrap();
    assert_eq!(db.dashboard("2026-09".into()).unwrap().balance, "30000");
}

#[test]
fn month_boundaries_leap_year_and_empty_months() {
    let (_dir, mut db) = database();
    add(&mut db, "income", 123, "2023-12-31", "posted");
    add(&mut db, "expense", 50, "2024-01-01", "posted");
    add(&mut db, "income", 77, "2024-02-29", "posted");
    let january = db.dashboard("2024-01".into()).unwrap();
    assert_eq!(january.previous.unwrap().income, "123");
    assert_eq!(january.trend[0].month, "2023-08");
    assert_eq!(january.current.expense, "50");
    assert_eq!(db.dashboard("2024-02".into()).unwrap().current.income, "77");
    let empty = db.dashboard("2025-03".into()).unwrap();
    assert_eq!(empty.current.result, "0");
    assert_eq!(empty.trend.len(), 6);
    assert!(empty.categories.is_empty());
    assert!(empty.recent.is_empty());
    let first = db.dashboard("0001-01".into()).unwrap();
    assert!(first.previous.is_none());
    assert_eq!(first.trend.len(), 1);
    assert!(db.dashboard("9999-12".into()).is_ok());
    for invalid in [
        "0000-01",
        "2026-00",
        "2026-13",
        "2026-1",
        "2026-09-01",
        "éééé",
        "99999-12",
    ] {
        assert!(db.dashboard(invalid.into()).is_err());
    }
}

#[test]
fn large_totals_are_exact_and_latest_rows_are_bounded() {
    let (_dir, mut db) = database();
    for day in 1..=8 {
        add(
            &mut db,
            "income",
            MAX_CENTS,
            &format!("2026-09-{day:02}"),
            "posted",
        );
    }
    let result = db.dashboard("2026-09".into()).unwrap();
    assert_eq!(
        result.current.income,
        (i128::from(MAX_CENTS) * 8).to_string()
    );
    assert_eq!(
        result.balance,
        (30000 + i128::from(MAX_CENTS) * 8).to_string()
    );
    assert_eq!(result.recent.len(), 6);
    assert_eq!(result.recent[0].movement.date, "2026-09-08");
}

#[test]
fn category_ranking_keeps_real_names_and_reconciles_uncategorized() {
    let (_dir, mut db) = database();
    let categories = db.list_categories().unwrap();
    let category = categories.iter().find(|c| c.name == "Moradia").unwrap();
    let mut m = add(&mut db, "expense", 999, "2026-09-01", "posted");
    m.category_id = Some(category.id);
    db.save_transaction(m).unwrap();
    add(&mut db, "expense", 100, "2026-09-02", "posted");
    db.set_category_active(category.id, false).unwrap();
    let result = db.dashboard("2026-09".into()).unwrap();
    assert_eq!(result.categories[0].name, "Moradia");
    assert_eq!(result.categories[0].cents, "999");
    assert_eq!(result.categories[1].name, "Sem categoria");
    assert_eq!(result.current.expense, "1099");
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
}
