use super::*;
#[test]
fn deterministic_budget_overdue_and_selected_comparison_are_read_only() {
    let dir = tempfile::tempdir().unwrap();
    let db = Database::open(&dir.path().join("db.sqlite")).unwrap();
    db.connection.execute_batch("INSERT INTO accounts(id,name,type) VALUES(1,'Conta','checking'); INSERT INTO categories(id,name,type) VALUES(991,'Mercado','expense'); INSERT INTO budgets(category_id,year,month,limit_amount) VALUES(991,2026,9,1000); INSERT INTO transactions(description,amount,type,date,account_id,category_id,status) VALUES('Atual',900,'expense','2026-09-10',1,991,'posted'),('Anterior',1000,'expense','2026-08-10',1,991,'posted'),('Vencida',200,'expense','2026-09-19',1,NULL,'pending')").unwrap();
    let changes = db.connection.total_changes();
    let current = db.financial_alerts("2026-09-20", None, 0).unwrap();
    assert_eq!(current.total, 2);
    assert_eq!(current.comparison_month.as_deref(), Some("2026-08"));
    assert_eq!(current.items[0].title, "Despesa vencida");
    assert_eq!(current.items[0].origin.kind, "transaction");
    let budget = current
        .items
        .iter()
        .find(|a| a.origin.kind == "budget")
        .unwrap();
    assert_eq!(budget.amount, "900");
    assert_eq!(budget.reference.as_deref(), Some("1000"));
    assert_eq!(budget.origin.id, Some(991));
    assert!(budget.reason.contains("90%"));
    let changed = db
        .financial_alerts("2026-09-20", Some("2026-07".into()), 0)
        .unwrap();
    assert_eq!(changed.total, 3);
    let comparison = changed
        .items
        .iter()
        .find(|a| a.origin.kind == "report")
        .unwrap();
    assert_eq!(comparison.reference.as_deref(), Some("0"));
    assert_eq!(
        comparison.origin.comparison_month.as_deref(),
        Some("2026-07")
    );
    assert_eq!(db.connection.total_changes(), changes);
    assert!(db
        .financial_alerts("2026-09-20", Some("2026-09".into()), 0)
        .is_err());
    assert!(db.financial_alerts("2026-02-30", None, 0).is_err());
    assert!(db.financial_alerts("2026-09-20", None, 100001).is_err());
}
