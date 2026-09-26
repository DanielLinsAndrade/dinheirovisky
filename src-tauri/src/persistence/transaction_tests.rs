use super::{transactions::Movement, Database};
use crate::domain::{AccountInput, MAX_CENTS};

fn setup() -> (tempfile::TempDir, Database) {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Database::open(&dir.path().join("test.sqlite")).unwrap();
    for (name, balance) in [("A", 10000), ("B", 20000)] {
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
fn movement(kind: &str, amount: i64) -> Movement {
    Movement {
        details: None,
        id: None,
        description: "Teste".into(),
        amount,
        kind: kind.into(),
        date: "2026-09-11".into(),
        account_id: 1,
        destination_account_id: if kind == "transfer" { Some(2) } else { None },
        category_id: None,
        status: "posted".into(),
        notes: None,
    }
}
fn balances(db: &Database) -> Vec<i128> {
    db.balances()
        .unwrap()
        .iter()
        .map(|b| b.cents.parse().unwrap())
        .collect()
}

#[test]
fn income_expense_transfer_edit_delete_and_reopen() {
    let (dir, mut db) = setup();
    db.save_transaction(movement("income", 5000)).unwrap();
    db.save_transaction(movement("expense", 1200)).unwrap();
    let rows = db.save_transaction(movement("transfer", 2300)).unwrap();
    assert_eq!(balances(&db), [11500, 22300]);
    assert_eq!(balances(&db).iter().sum::<i128>(), 33800);
    let mut transfer = rows.iter().find(|m| m.kind == "transfer").unwrap().clone();
    transfer.amount = 1000;
    transfer.account_id = 2;
    transfer.destination_account_id = Some(1);
    db.save_transaction(transfer.clone()).unwrap();
    assert_eq!(balances(&db), [14800, 19000]);
    transfer.kind = "expense".into();
    transfer.destination_account_id = None;
    db.save_transaction(transfer.clone()).unwrap();
    assert_eq!(balances(&db), [13800, 19000]);
    db.delete_transaction(transfer.id.unwrap()).unwrap();
    assert_eq!(balances(&db), [13800, 20000]);
    drop(db);
    let db = Database::open(&dir.path().join("test.sqlite")).unwrap();
    assert_eq!(balances(&db), [13800, 20000]);
}
#[test]
fn pending_and_scheduled_require_manual_posting() {
    let (_dir, mut db) = setup();
    for status in ["pending", "scheduled"] {
        let mut m = movement("transfer", 500);
        m.status = status.into();
        db.save_transaction(m).unwrap();
    }
    assert_eq!(balances(&db), [10000, 20000]);
    let mut m = db.list_transactions().unwrap()[0].clone();
    m.status = "posted".into();
    db.save_transaction(m.clone()).unwrap();
    assert_eq!(balances(&db), [9500, 20500]);
    m.status = "pending".into();
    db.save_transaction(m).unwrap();
    assert_eq!(balances(&db), [10000, 20000]);
}
#[test]
fn rejects_invalid_input_without_changing_balances() {
    let (_dir, mut db) = setup();
    for date in [
        "2025-02-29",
        "2026-04-31",
        "2026-13-01",
        "0000-01-01",
        "2026-1-01",
        "invalid",
    ] {
        let mut m = movement("income", 1);
        m.date = date.into();
        assert!(db.save_transaction(m).is_err());
    }
    for amount in [0, -1, MAX_CENTS + 1] {
        assert!(db.save_transaction(movement("income", amount)).is_err());
    }
    let mut m = movement("transfer", 100);
    m.destination_account_id = Some(1);
    assert!(db.save_transaction(m).is_err());
    let mut m = movement("expense", 1);
    m.account_id = 99;
    assert!(db.save_transaction(m).is_err());
    let mut m = movement("income", 1);
    m.date = "2024-02-29".into();
    db.save_transaction(m).unwrap();
    assert_eq!(balances(&db), [10001, 20000]);
}
#[test]
fn preserves_archived_history_and_category_type() {
    let (_dir, mut db) = setup();
    let category = db
        .list_categories()
        .unwrap()
        .into_iter()
        .find(|c| c.kind == "expense")
        .unwrap();
    let mut m = movement("expense", 100);
    m.category_id = Some(category.id);
    let rows = db.save_transaction(m).unwrap();
    db.set_account_active(1, false).unwrap();
    db.set_category_active(category.id, false).unwrap();
    assert!(db.save_transaction(movement("expense", 10)).is_err());
    let mut m = rows[0].clone();
    m.amount = 200;
    db.save_transaction(m.clone()).unwrap();
    assert_eq!(balances(&db), [9800, 20000]);
    m.kind = "income".into();
    assert!(db.save_transaction(m).is_err());
    assert!(db
        .connection
        .execute(
            "UPDATE categories SET type='income' WHERE id=?1",
            [category.id]
        )
        .is_err());
    assert!(db
        .connection
        .execute("UPDATE transactions SET type='income'", [])
        .is_err());
}
#[test]
fn exact_aggregates_beyond_javascript_and_sql_sum_limits() {
    let (_dir, mut db) = setup();
    for _ in 0..1025 {
        db.save_transaction(movement("income", MAX_CENTS)).unwrap();
    }
    assert_eq!(balances(&db)[0], 10000 + 1025 * i128::from(MAX_CENTS));
    db.save_account(AccountInput {
        id: Some(1),
        name: "A".into(),
        kind: "checking".into(),
        initial_balance: -100,
    })
    .unwrap();
    assert_eq!(balances(&db)[0], -100 + 1025 * i128::from(MAX_CENTS));
}

#[test]
fn deleting_transfer_reverses_both_sides_and_missing_ids_are_rejected() {
    let (_dir, mut db) = setup();
    let rows = db.save_transaction(movement("transfer", 10001)).unwrap();
    assert_eq!(balances(&db), [-1, 30001]);
    db.delete_transaction(rows[0].id.unwrap()).unwrap();
    assert_eq!(balances(&db), [10000, 20000]);
    assert!(db.delete_transaction(rows[0].id.unwrap()).is_err());
    assert!(db.save_transaction(rows[0].clone()).is_err());
}

#[test]
fn stage_two_upgrade_preserves_movements_and_integrity() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("upgrade.sqlite");
    let mut connection = rusqlite::Connection::open(&path).unwrap();
    super::migrations::migrate(&mut connection, &super::migrations::MIGRATIONS[..2]).unwrap();
    connection.execute_batch("INSERT INTO accounts(id,name,type,initial_balance) VALUES(1,'A','checking',100),(2,'B','savings',200); INSERT INTO transactions(description,amount,type,date,account_id,destination_account_id,status) VALUES('Preservada',55,'transfer','2026-09-11',1,2,'posted');").unwrap();
    drop(connection);
    for _ in 0..2 {
        let db = Database::open(&path).unwrap();
        assert_eq!(
            db.status().unwrap().0,
            crate::persistence::migrations::MIGRATIONS.len() as i64
        );
        assert_eq!(db.list_transactions().unwrap().len(), 1);
        assert_eq!(balances(&db), [45, 255]);
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

#[test]
fn paginated_queries_preserve_order_filters_and_clamp_after_deletion() {
    use super::transaction_query::TransactionQuery;
    let (_dir, mut db) = setup();
    for i in 0..123 {
        let mut m = movement(
            if i % 2 == 0 { "transfer" } else { "expense" },
            MAX_CENTS - i,
        );
        m.description = format!("Registro {i}");
        m.notes = Some("AÇÃO mensal".into());
        db.write_transaction(m).unwrap();
    }
    let all = db.list_transactions().unwrap();
    let mut ids = Vec::new();
    for page in 0..3 {
        let result = db
            .query_transactions(TransactionQuery {
                page,
                ..Default::default()
            })
            .unwrap();
        assert_eq!(result.total, 123);
        assert!(result.items.len() <= 50);
        ids.extend(result.items.into_iter().map(|m| m.id));
    }
    assert_eq!(ids, all.iter().map(|m| m.id).collect::<Vec<_>>());
    let result = db
        .query_transactions(TransactionQuery {
            account_id: Some(2),
            search: "ação".into(),
            kind: "transfer".into(),
            from: "2026-09-11".into(),
            to: "2026-09-11".into(),
            sort: "amount".into(),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(result.total, 62);
    assert_eq!(result.items[0].amount, MAX_CENTS);
    let empty = db
        .query_transactions(TransactionQuery {
            search: "' OR 1=1 --".into(),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(empty.total, 0);
    for m in all.iter().take(24) {
        db.remove_transaction(m.id.unwrap()).unwrap();
    }
    let result = db
        .query_transactions(TransactionQuery {
            page: 999,
            ..Default::default()
        })
        .unwrap();
    assert_eq!((result.total, result.page, result.items.len()), (99, 1, 49));
    assert!(db
        .query_transactions(TransactionQuery {
            sort: "id; DELETE FROM transactions".into(),
            ..Default::default()
        })
        .is_err());
    assert!(db
        .query_transactions(TransactionQuery {
            from: "2026-02-30".into(),
            ..Default::default()
        })
        .is_err());
}
