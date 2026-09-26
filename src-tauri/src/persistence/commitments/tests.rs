use super::*;
use serde_json::json;
#[test]
fn combines_obligations_without_duplicate_installments_or_generated_recurrences() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Database::open(&dir.path().join("db.sqlite")).unwrap();
    db.connection.execute_batch("INSERT INTO accounts(id,name,type,initial_balance) VALUES(1,'Conta','checking',10000); INSERT INTO transactions(description,amount,type,date,account_id,status) VALUES('Pendente',500,'expense','2026-09-21',1,'pending')").unwrap();
    let saved=db.save_recurrence(serde_json::from_value(json!({"id":null,"description":"Fixa","amount":100,"kind":"expense","accountId":1,"frequency":"weekly","interval":1,"startDate":"2026-09-20","planningClass":"fixed"})).unwrap()).unwrap();
    let recurrence = saved[0].input.id.unwrap();
    db.materialize_recurrences("2026-09-20".into()).unwrap();
    db.save_card(serde_json::from_value(json!({"id":null,"name":"Cartão","institution":"Banco","creditLimit":10000,"closingDay":20,"dueDay":25})).unwrap()).unwrap();
    db.save_purchase(serde_json::from_value(json!({"id":null,"cardId":1,"description":"Parcelada","date":"2026-09-01","amount":1201,"installmentCount":3})).unwrap()).unwrap();
    let invoice = db
        .invoices(1, "2026-09-20", 0)
        .unwrap()
        .items
        .into_iter()
        .find(|i| i.month == "2026-09")
        .unwrap();
    db.save_invoice_event(serde_json::from_value(json!({"requestKey":"commitment-test-payment","id":null,"invoiceId":invoice.id,"kind":"payment","accountId":1,"amount":100,"date":"2026-09-20","description":"Parcial"})).unwrap()).unwrap();
    let changes = db.connection.total_changes();
    let result = db.commitments("2026-09-20", "week", 0).unwrap();
    assert_eq!(result.total, 4);
    assert_eq!(result.committed, "901");
    assert_eq!(result.estimated, "100");
    let future = result
        .items
        .iter()
        .find(|i| i.kind == "recurrence")
        .unwrap();
    assert_eq!(future.id, recurrence);
    assert_eq!(future.date, "2026-09-27");
    assert_eq!(future.planning_class.as_deref(), Some("fixed"));
    let invoice = result.items.iter().find(|i| i.kind == "invoice").unwrap();
    assert_eq!(invoice.amount, "301");
    assert_eq!(invoice.installments, 1);
    assert!(invoice.partial);
    assert_eq!(db.connection.total_changes(), changes);
    assert_eq!(db.balances().unwrap()[0].cents, "9900");
    let nearest = db.commitments("2026-09-20", "next_invoice", 0).unwrap();
    assert_eq!(nearest.total, 1);
    assert_eq!(nearest.committed, "301");
    assert_eq!(nearest.estimated, "0");
    let alerts = db.financial_alerts("2026-09-20", None, 0).unwrap();
    assert!(alerts
        .items
        .iter()
        .any(|a| a.title == "Pagamento parcial perto do vencimento"
            && a.amount == "301"
            && a.origin.card_id == Some(1)));
    db.connection
        .execute("UPDATE credit_cards SET credit_limit=1000 WHERE id=1", [])
        .unwrap();
    let alerts = db.financial_alerts("2026-09-20", None, 0).unwrap();
    assert!(alerts
        .items
        .iter()
        .any(|a| a.title == "Compromisso relevante em fatura futura"
            && a.amount == "400"
            && a.reason.contains("30%")));
    let next = db.commitments("2026-09-20", "next_month", 0).unwrap();
    assert_eq!(next.committed, "400");
    assert!(next.items.iter().all(|i| i.date.starts_with("2026-10")));
    let overdue = db.commitments("2026-09-22", "overdue", 0).unwrap();
    assert_eq!(overdue.total, 2);
    assert_eq!(overdue.estimated, "0");
    db.set_recurrence_state(recurrence, "pause".into(), "2026-09-20".into())
        .unwrap();
    assert_eq!(
        db.commitments("2026-09-20", "month", 0).unwrap().estimated,
        "0"
    );
}
#[test]
fn horizon_edges_pagination_and_exact_large_totals() {
    let dir = tempfile::tempdir().unwrap();
    let db = Database::open(&dir.path().join("db.sqlite")).unwrap();
    db.connection.execute_batch("INSERT INTO accounts(id,name,type) VALUES(1,'Conta','checking'); WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<11) INSERT INTO transactions(description,amount,type,date,account_id,status) SELECT 'Conta '||x,9007199254740991,'expense','2024-02-29',1,'pending' FROM n").unwrap();
    let r = db.commitments("2024-02-22", "week", 0).unwrap();
    assert_eq!(r.total, 11);
    assert_eq!(r.items.len(), 5);
    assert_eq!(r.committed, (9007199254740991_i128 * 11).to_string());
    let last = db.commitments("2024-02-22", "week", 999).unwrap();
    assert_eq!(last.page, 2);
    assert_eq!(last.items.len(), 1);
    assert_eq!(db.commitments("2024-02-21", "week", 0).unwrap().total, 0);
    assert_eq!(
        db.commitments("9999-12-31", "next_month", 0).unwrap().total,
        0
    );
    assert!(db.commitments("2024-02-30", "week", 0).is_err());
    assert!(db.commitments("2024-02-22", "unknown", 0).is_err());
}
