use super::Database;
use std::time::Instant;

#[test]
#[ignore = "Medição explícita: cargo test performance_profile -- --ignored --nocapture"]
fn performance_profile() {
    for size in [1_000, 50_000] {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("performance.sqlite3");
        let mut db = Database::open(&path).unwrap();
        let tx = db.connection.transaction().unwrap();
        for i in 1..=100 {
            tx.execute(
                "INSERT INTO accounts(id,name,type,initial_balance) VALUES(?1,?2,'checking',10000)",
                rusqlite::params![i, format!("Conta {i}")],
            )
            .unwrap();
        }
        for i in 0..size {
            tx.execute("INSERT INTO transactions(description,amount,type,date,account_id,status,notes) VALUES(?1,?2,?3,?4,?5,'posted',?6)",rusqlite::params![format!("Movimento {i}"),9007199254740991_i64-i,if i%2==0 {"income"} else {"expense"},format!("{:04}-{:02}-15",2020+i%7,1+i%12),1+i%100,"observações ".repeat(30)]).unwrap();
        }
        tx.commit().unwrap();
        drop(db);
        let start = Instant::now();
        let db = Database::open(&path).unwrap();
        let open_ms = start.elapsed().as_secs_f64() * 1000.;
        let start = Instant::now();
        let rows = db.list_transactions().unwrap();
        let list_ms = start.elapsed().as_secs_f64() * 1000.;
        let bytes = serde_json::to_vec(&rows).unwrap().len();
        let start = Instant::now();
        let balances = db.balances().unwrap();
        let balances_ms = start.elapsed().as_secs_f64() * 1000.;
        let start = Instant::now();
        let dashboard = db.dashboard("2026-09".into()).unwrap();
        let dashboard_ms = start.elapsed().as_secs_f64() * 1000.;
        assert_eq!(dashboard.balance, (1_000_000 + size / 2).to_string());
        let start = Instant::now();
        let page = db.query_transactions(Default::default()).unwrap();
        let page_ms = start.elapsed().as_secs_f64() * 1000.;
        let page_bytes = serde_json::to_vec(&page).unwrap().len();
        assert_eq!(page.items.len(), 50);
        assert_eq!(page.total, size);
        println!(
            "PERF {}",
            serde_json::json!({"rows":size,"accounts":100,"open_ms":open_ms,"list_ms":list_ms,"list_bytes":bytes,"balances_ms":balances_ms,"dashboard_ms":dashboard_ms,"balance":dashboard.balance,"balance_count":balances.len(),"page_ms":page_ms,"page_bytes":page_bytes})
        );

        // Additional independent workloads; kept after the comparable historical fixture.
        let tx = db.connection.unchecked_transaction().unwrap();
        for i in 1..=100 {
            tx.execute(
                "INSERT INTO categories(id,name,type) VALUES(?1,?2,'expense')",
                rusqlite::params![1000 + i, format!("Categoria {i}")],
            )
            .unwrap();
            tx.execute(
                "INSERT INTO budgets(category_id,year,month,limit_amount) VALUES(?1,2026,9,10000)",
                [1000 + i],
            )
            .unwrap();
            tx.execute(
                "INSERT INTO goals(id,name,target_amount,current_amount) VALUES(?1,?2,10000,1000)",
                rusqlite::params![i, format!("Meta {i}")],
            )
            .unwrap();
            for _ in 0..10 {
                tx.execute("INSERT INTO goal_contributions(goal_id,amount,date) VALUES(?1,100,'2026-09-12')",[i]).unwrap();
            }
        }
        tx.execute(
            "UPDATE transactions SET category_id=1000+account_id WHERE type='expense'",
            [],
        )
        .unwrap();
        tx.commit().unwrap();
        let start = Instant::now();
        let budgets = db.budgets("2026-09".into()).unwrap();
        let budgets_ms = start.elapsed().as_secs_f64() * 1000.;
        assert_eq!(budgets.len(), 100);
        let start = Instant::now();
        let goals = db.list_goals().unwrap();
        let goals_ms = start.elapsed().as_secs_f64() * 1000.;
        assert_eq!(goals.len(), 100);
        assert!(goals
            .iter()
            .all(|g| g.contributions.len() == 10 && g.current_amount == 1000));
        let batch = (0..2000)
            .map(|i| super::imports::ImportRow {
                line: i + 1,
                source_account_id: 1,
                external_id: None,
                raw_amount: "1.01".into(),
                movement: super::transactions::Movement {
                    details: None,
                    id: None,
                    description: format!("Perfil importação {i}"),
                    amount: 101,
                    kind: "expense".into(),
                    date: "2026-09-12".into(),
                    account_id: 1,
                    destination_account_id: None,
                    category_id: None,
                    status: "posted".into(),
                    notes: None,
                },
            })
            .collect();
        let start = Instant::now();
        let reviewed = db.review_import(batch, "BRL".into()).unwrap();
        let import_ms = start.elapsed().as_secs_f64() * 1000.;
        assert!(reviewed
            .iter()
            .all(|r| r.error.is_none() && !r.duplicate && !r.already_imported));
        println!(
            "PERF_ADDITIONAL {}",
            serde_json::json!({"rows":size,"budgets":100,"goals":100,"contributions":1000,"budgets_ms":budgets_ms,"goals_ms":goals_ms,"import_2000_ms":import_ms})
        );
    }
}
