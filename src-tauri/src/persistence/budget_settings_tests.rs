use super::{transactions::Movement, Database};
use crate::domain::{period::financial_month, AccountInput, MAX_CENTS};
fn setup() -> (tempfile::TempDir, Database, i64) {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Database::open(&dir.path().join("test.sqlite")).unwrap();
    db.save_account(AccountInput {
        id: None,
        name: "Conta".into(),
        kind: "checking".into(),
        initial_balance: 1000,
    })
    .unwrap();
    let id = db
        .list_categories()
        .unwrap()
        .iter()
        .find(|c| c.name == "Moradia")
        .unwrap()
        .id;
    (dir, db, id)
}
fn expense(db: &mut Database, category: i64, amount: i64, date: &str, status: &str) -> Movement {
    db.save_transaction(Movement {
        details: None,
        id: None,
        description: format!("Gasto {date}"),
        amount,
        kind: "expense".into(),
        date: date.into(),
        account_id: 1,
        destination_account_id: None,
        category_id: Some(category),
        status: status.into(),
        notes: None,
    })
    .unwrap()
    .into_iter()
    .find(|m| m.date == date)
    .unwrap()
}
#[test]
fn settings_are_validated_confirmed_and_persisted() {
    let (dir, mut db, _) = setup();
    let original = db.settings().unwrap();
    let mut s = original.clone();
    s.currency = "USD".into();
    assert!(db.save_settings(s.clone(), false).is_err());
    assert_eq!(db.settings().unwrap(), original);
    s.locale = "en-US".into();
    s.date_format = "MM/dd/yyyy".into();
    s.theme = "dark".into();
    s.financial_month_start = 15;
    db.save_settings(s.clone(), true).unwrap();
    drop(db);
    let mut db = Database::open(&dir.path().join("test.sqlite")).unwrap();
    assert_eq!(db.settings().unwrap(), s);
    for start in [0, 29] {
        let mut bad = s.clone();
        bad.financial_month_start = start;
        assert!(db.save_settings(bad, true).is_err());
    }
    for (field, value) in [
        ("currency", "JPY"),
        ("locale", "unknown"),
        ("theme", "blue"),
        ("date", "invalid"),
    ] {
        let mut bad = s.clone();
        match field {
            "currency" => bad.currency = value.into(),
            "locale" => bad.locale = value.into(),
            "theme" => bad.theme = value.into(),
            _ => bad.date_format = value.into(),
        };
        assert!(db.save_settings(bad, true).is_err());
    }
    assert_eq!(db.settings().unwrap(), s);
}
#[test]
fn financial_period_is_shared_by_budget_and_dashboard() {
    let (_dir, mut db, id) = setup();
    let mut s = db.settings().unwrap();
    s.financial_month_start = 15;
    db.save_settings(s, false).unwrap();
    for (amount, date, status) in [
        (10, "2026-09-14", "posted"),
        (100, "2026-09-15", "posted"),
        (200, "2026-10-14", "posted"),
        (20, "2026-10-15", "posted"),
        (900, "2026-09-20", "pending"),
        (800, "2026-09-21", "scheduled"),
    ] {
        expense(&mut db, id, amount, date, status);
    }
    let rows = db.save_budget("2026-09".into(), id, 1000).unwrap();
    assert_eq!(rows[0].spent, "300");
    assert_eq!(rows[0].remaining, "700");
    assert_eq!(rows[0].percent.as_deref(), Some("30.0"));
    let dashboard = db.dashboard("2026-09".into()).unwrap();
    assert_eq!(dashboard.current.expense, "300");
    assert_eq!(dashboard.previous.unwrap().expense, "10");
    assert_eq!(dashboard.recent.len(), 4);
    assert_eq!(
        financial_month("2024-03-01", 28).as_deref(),
        Some("2024-02")
    );
    assert_eq!(
        financial_month("2024-01-01", 15).as_deref(),
        Some("2023-12")
    );
    assert_eq!(financial_month("0001-01-01", 2), None);
}
#[test]
fn spending_states_zero_limit_edits_and_deletes() {
    let (_dir, mut db, id) = setup();
    let mut m = expense(&mut db, id, 900, "2026-09-10", "posted");
    let rows = db.save_budget("2026-09".into(), id, 1000).unwrap();
    assert_eq!(rows[0].state, "near");
    m.amount = 1100;
    db.save_transaction(m.clone()).unwrap();
    let rows = db.budgets("2026-09".into()).unwrap();
    assert_eq!(rows[0].state, "exceeded");
    assert_eq!(rows[0].remaining, "-100");
    assert_eq!(rows[0].percent.as_deref(), Some("110.0"));
    let rows = db.save_budget("2026-09".into(), id, 0).unwrap();
    assert_eq!(rows[0].percent, None);
    db.delete_transaction(m.id.unwrap()).unwrap();
    let rows = db.budgets("2026-09".into()).unwrap();
    assert_eq!(rows[0].percent.as_deref(), Some("0.0"));
    assert_eq!(rows[0].state, "within");
    assert!(db.delete_budget("2026-09".into(), id).unwrap().is_empty());
    assert!(db.delete_budget("2026-09".into(), id).is_err());
}
#[test]
fn copy_previous_month_preserves_existing_and_skips_archived() {
    let (_dir, mut db, id) = setup();
    let other = db
        .list_categories()
        .unwrap()
        .iter()
        .find(|c| c.name == "Lazer")
        .unwrap()
        .id;
    db.save_budget("2025-12".into(), id, 100).unwrap();
    db.save_budget("2025-12".into(), other, 200).unwrap();
    db.save_budget("2026-01".into(), id, 999).unwrap();
    let rows = db.copy_budgets("2026-01".into()).unwrap();
    assert_eq!(rows.len(), 2);
    assert_eq!(
        rows.iter()
            .find(|r| r.category_id == id)
            .unwrap()
            .limit_amount,
        999
    );
    assert_eq!(db.copy_budgets("2026-01".into()).unwrap().len(), 2);
    db.set_category_active(other, false).unwrap();
    assert_eq!(db.copy_budgets("2026-02".into()).unwrap().len(), 1);
    assert!(db.copy_budgets("0001-01".into()).is_err());
}
#[test]
fn budget_constraints_and_exact_large_spending() {
    let (_dir, mut db, id) = setup();
    let income = db
        .list_categories()
        .unwrap()
        .iter()
        .find(|c| c.kind == "income")
        .unwrap()
        .id;
    assert!(db.save_budget("2026-09".into(), income, 1).is_err());
    assert!(db.save_budget("2026-09".into(), id, -1).is_err());
    assert!(db.save_budget("2026-09".into(), id, MAX_CENTS + 1).is_err());
    assert!(db.save_budget("2026-13".into(), id, 1).is_err());
    db.save_budget("2026-09".into(), id, MAX_CENTS).unwrap();
    assert!(db
        .connection
        .execute("UPDATE categories SET type='income' WHERE id=?1", [id])
        .is_err());
    assert!(db
        .connection
        .execute(
            "INSERT INTO budgets(year,month,category_id,limit_amount) VALUES(2026,9,?1,1)",
            [income]
        )
        .is_err());
    expense(&mut db, id, MAX_CENTS, "2026-09-01", "posted");
    expense(&mut db, id, MAX_CENTS, "2026-09-02", "posted");
    let rows = db.budgets("2026-09".into()).unwrap();
    assert_eq!(rows[0].spent, (2 * i128::from(MAX_CENTS)).to_string());
    assert_eq!(rows[0].percent.as_deref(), Some("200.0"));
    db.set_category_active(id, false).unwrap();
    assert!(db.save_budget("2026-10".into(), id, 1).is_err());
    assert!(db.save_budget("2026-09".into(), id, 1).is_ok());
}
#[test]
fn migration_four_preserves_existing_budgets_and_settings() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("upgrade.sqlite");
    let mut c = rusqlite::Connection::open(&path).unwrap();
    super::migrations::migrate(&mut c, &super::migrations::MIGRATIONS[..3]).unwrap();
    c.execute_batch("UPDATE app_settings SET financial_month_start=20,theme='dark'; INSERT INTO budgets(year,month,category_id,limit_amount) SELECT 2026,9,id,12345 FROM categories WHERE name='Moradia';").unwrap();
    drop(c);
    for _ in 0..2 {
        let db = Database::open(&path).unwrap();
        assert_eq!(db.settings().unwrap().financial_month_start, 20);
        assert_eq!(db.budgets("2026-09".into()).unwrap()[0].limit_amount, 12345);
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
}
