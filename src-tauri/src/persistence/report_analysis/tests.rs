use super::*;
use serde_json::json;
fn filter(view: &str) -> AnalysisFilter {
    serde_json::from_value(json!({"from":"2026-03","to":"2026-03","view":view,"groupBy":"method"}))
        .unwrap()
}
#[test]
fn reconciles_consumption_cash_installments_refunds_and_transfers() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Database::open(&dir.path().join("db.sqlite")).unwrap();
    db.connection.execute_batch("INSERT INTO accounts(id,name,type) VALUES(1,'Principal','checking'),(2,'Reserva','savings'); INSERT INTO categories(id,name,type) VALUES(991,'Compras','expense'); INSERT INTO transactions(description,amount,type,date,account_id,destination_account_id,status,category_id,method_id) VALUES('Receita',1000,'income','2026-03-01',1,NULL,'posted',NULL,NULL),('Despesa',200,'expense','2026-03-02',1,NULL,'posted',991,2),('Anterior',100,'expense','2026-02-02',1,NULL,'posted',991,2),('Transferência',500,'transfer','2026-03-02',1,2,'posted',NULL,NULL),('Pendente',999,'expense','2026-03-03',1,NULL,'pending',991,NULL)").unwrap();
    db.save_card(serde_json::from_value(json!({"name":"Cartão","institution":"Banco","creditLimit":10000,"closingDay":20,"dueDay":25})).unwrap()).unwrap();
    db.save_purchase(serde_json::from_value(json!({"cardId":1,"description":"Compra","date":"2026-03-01","amount":1201,"installmentCount":3,"categoryId":991,"merchant":"Loja","channel":"online"})).unwrap()).unwrap();
    let invoice = db
        .invoices(1, "2026-03-10", 0)
        .unwrap()
        .items
        .into_iter()
        .find(|i| i.month == "2026-03")
        .unwrap()
        .id;
    for (kind, amount, account, purchase) in [
        ("payment", 100, Some(1), None),
        ("refund", 100, None, Some(1)),
        ("credit", 25, None, None),
        ("charge", 50, None, None),
    ] {
        db.save_invoice_event(serde_json::from_value(json!({"requestKey":format!("analysis-{kind}"),"invoiceId":invoice,"kind":kind,"amount":amount,"accountId":account,"purchaseId":purchase,"date":"2026-03-10","description":kind})).unwrap()).unwrap();
    }
    let changes = db.connection.total_changes();
    let economic = db.report_analysis(filter("consumption")).unwrap();
    assert_eq!(economic.totals.expense, "1326");
    assert_eq!(economic.totals.income, "1000");
    assert_eq!(economic.totals.payments, "0");
    assert_eq!(economic.totals.transfers, "0");
    assert_eq!(economic.totals.result, "-326");
    assert_eq!(economic.comparison.unwrap().expense, "100");
    let cash = db.report_analysis(filter("cash")).unwrap();
    assert_eq!(cash.totals.expense, "200");
    assert_eq!(cash.totals.payments, "100");
    assert_eq!(cash.totals.result, "700");
    let mut f = filter("cash");
    f.account_id = Some(1);
    let individual = db.report_analysis(f).unwrap();
    assert_eq!(individual.totals.transfers, "-500");
    assert_eq!(individual.totals.result, "200");
    let mut f = filter("cash");
    f.account_id = Some(2);
    assert_eq!(db.report_analysis(f).unwrap().totals.transfers, "500");
    let mut f = filter("installments");
    f.group_by = "invoice".into();
    f.to = "2026-05".into();
    let installments = db.report_analysis(f).unwrap();
    assert_eq!(installments.totals.installments, "1201");
    assert_eq!(installments.totals.expense, "0");
    assert_eq!(
        installments
            .months
            .iter()
            .map(|m| m.totals.installments.as_str())
            .collect::<Vec<_>>(),
        ["401", "400", "400"]
    );
    let mut f = filter("consumption");
    f.invoice_id = Some(invoice);
    assert_eq!(db.report_analysis(f).unwrap().totals.expense, "1126");
    let mut f = filter("consumption");
    f.method = Some("pix".into());
    assert_eq!(db.report_analysis(f).unwrap().totals.expense, "200");
    let mut f = filter("consumption");
    f.channel = Some("online".into());
    assert_eq!(db.report_analysis(f).unwrap().totals.expense, "1101");
    let merchant = db.metadata("merchant", "Loja", true).unwrap()[0].id;
    let mut f = filter("consumption");
    f.merchant_id = Some(merchant);
    f.group_by = "merchant".into();
    let r = db.report_analysis(f).unwrap();
    assert_eq!(r.groups[0].name, "Loja");
    assert_eq!(r.totals.expense, "1101");
    let mut f = filter("cash");
    f.card_id = Some(1);
    f.group_by = "invoice".into();
    let r = db.report_analysis(f).unwrap();
    assert_eq!(r.totals.payments, "100");
    assert_eq!(r.groups[0].key, invoice.to_string());
    assert_eq!(db.connection.total_changes(), changes);
}
#[test]
fn exact_groups_pagination_classification_archived_and_financial_period() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Database::open(&dir.path().join("db.sqlite")).unwrap();
    db.connection.execute_batch("INSERT INTO accounts(id,name,type) VALUES(1,'Conta','checking'); WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<25) INSERT INTO categories(id,name,type) SELECT 990+x,'Categoria '||x,'expense' FROM n; INSERT INTO transactions(description,amount,type,date,account_id,status,category_id) SELECT 'Grande',9007199254740991,'expense','2026-03-10',1,'posted',id FROM categories WHERE id>990").unwrap();
    let mut f = filter("consumption");
    f.group_by = "category".into();
    let r = db.report_analysis(f.clone()).unwrap();
    assert_eq!(r.group_count, 25);
    assert_eq!(r.groups.len(), 20);
    assert_eq!(r.totals.expense, (9007199254740991_i128 * 25).to_string());
    f.page = 999;
    let r = db.report_analysis(f).unwrap();
    assert_eq!(r.page, 1);
    assert_eq!(r.groups.len(), 5);
    db.connection.execute_batch("INSERT INTO categories(id,name,type) VALUES(990,'Pai','expense'); UPDATE categories SET parent_id=990 WHERE id=991").unwrap();
    let mut f = filter("consumption");
    f.group_by = "category".into();
    f.category_id = Some(991);
    assert_eq!(
        db.report_analysis(f).unwrap().groups[0].name,
        "Pai › Categoria 1"
    );
    db.save_recurrence(serde_json::from_value(json!({"description":"Fixa","kind":"expense","amount":123,"accountId":1,"frequency":"monthly","interval":1,"startDate":"2026-03-15","planningClass":"fixed"})).unwrap()).unwrap();
    db.materialize_recurrences("2026-03-15".into()).unwrap();
    db.connection.execute_batch("UPDATE transactions SET status='posted' WHERE recurrence_id IS NOT NULL; UPDATE accounts SET active=0 WHERE id=1; UPDATE app_settings SET financial_month_start=15 WHERE id=1").unwrap();
    let mut f = filter("consumption");
    f.planning_class = Some("fixed".into());
    f.recurrence = Some("yes".into());
    f.group_by = "recurrence".into();
    let r = db.report_analysis(f).unwrap();
    assert_eq!(r.totals.expense, "123");
    assert_eq!(r.groups[0].name, "Fixa");
    assert_eq!(r.start_date, "2026-03-15");
    let mut f = filter("consumption");
    f.from = "0001-01".into();
    f.to = f.from.clone();
    assert!(db.report_analysis(f).unwrap().comparison.is_none());
    let mut f = filter("cash");
    f.from = "9999-12".into();
    f.to = f.from.clone();
    assert_eq!(db.report_analysis(f).unwrap().until_date, "9999-12-32");
}
#[test]
fn invalid_filters_are_errors_not_empty_reports() {
    let dir = tempfile::tempdir().unwrap();
    let db = Database::open(&dir.path().join("db.sqlite")).unwrap();
    let mut cases = vec![];
    let mut f = filter("consumption");
    f.group_by = "invoice".into();
    cases.push(f);
    let mut f = filter("consumption");
    f.comparison_from = Some("2026-03".into());
    cases.push(f);
    let mut f = filter("consumption");
    f.card_id = Some(999);
    cases.push(f);
    let mut f = filter("cash");
    f.method = Some("invalid".into());
    cases.push(f);
    let mut f = filter("cash");
    f.to = "2020-01".into();
    cases.push(f);
    let mut f = filter("cash");
    f.page = 100001;
    cases.push(f);
    for f in cases {
        assert!(db.report_analysis(f).is_err());
    }
}
