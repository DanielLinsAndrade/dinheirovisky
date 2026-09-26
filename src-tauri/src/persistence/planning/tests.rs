use super::*;
fn setup() -> (tempfile::TempDir, Database, RecurrenceInput) {
    let dir = tempfile::tempdir().unwrap();
    let db = Database::open(&dir.path().join("test.sqlite")).unwrap();
    db.connection
        .execute(
            "INSERT INTO accounts(id,name,type) VALUES(1,'Conta','checking')",
            [],
        )
        .unwrap();
    let r = RecurrenceInput {
        id: None,
        description: "Aluguel".into(),
        amount: 12345,
        kind: "expense".into(),
        account_id: 1,
        category_id: None,
        notes: None,
        frequency: "monthly".into(),
        interval: 1,
        start_date: "2024-01-31".into(),
        end_date: None,
        planning_class: None,
    };
    (dir, db, r)
}
#[test]
fn planning_class_is_metadata_preserves_occurrences_and_roundtrips() {
    let (dir, mut db, mut input) = setup();
    input.planning_class = Some("fixed".into());
    let saved = db.save_recurrence(input.clone()).unwrap();
    input.id = saved[0].input.id;
    assert_eq!(saved[0].input.planning_class.as_deref(), Some("fixed"));
    assert_eq!(db.materialize_recurrences("2024-01-31".into()).unwrap(), 1);
    let before = serde_json::to_value(db.list_transactions().unwrap()).unwrap();
    input.planning_class = Some("seasonal".into());
    db.save_recurrence(input.clone()).unwrap();
    assert_eq!(db.materialize_recurrences("2024-01-31".into()).unwrap(), 0);
    assert_eq!(
        serde_json::to_value(db.list_transactions().unwrap()).unwrap(),
        before
    );
    input.planning_class = Some("invalid".into());
    assert!(db.save_recurrence(input).is_err());
    let backup = dir.path().join("planning.dvbackup");
    db.export_backup_v2(&backup).unwrap();
    let preview = db.prepare_restore(&backup).unwrap();
    db.confirm_restore(&preview.token, true).unwrap();
    assert_eq!(
        db.list_recurrences().unwrap()[0]
            .input
            .planning_class
            .as_deref(),
        Some("seasonal")
    );
}

#[test]
fn anchored_calendar_leap_year_custom_intervals_and_bounds() {
    let (_dir, db, mut r) = setup();
    assert_eq!(
        occurrence(&db.connection, &r, 1).unwrap().as_deref(),
        Some("2024-02-29")
    );
    assert_eq!(
        occurrence(&db.connection, &r, 2).unwrap().as_deref(),
        Some("2024-03-31")
    );
    r.start_date = "2024-02-29".into();
    r.frequency = "yearly".into();
    assert_eq!(
        occurrence(&db.connection, &r, 1).unwrap().as_deref(),
        Some("2025-02-28")
    );
    assert_eq!(
        occurrence(&db.connection, &r, 4).unwrap().as_deref(),
        Some("2028-02-29")
    );
    r.frequency = "weekly".into();
    r.interval = 2;
    assert_eq!(
        occurrence(&db.connection, &r, 1).unwrap().as_deref(),
        Some("2024-03-14")
    );
    r.end_date = Some("2024-03-14".into());
    assert!(occurrence(&db.connection, &r, 2).unwrap().is_none());
    r.end_date = None;
    r.start_date = "9999-12-31".into();
    assert!(occurrence(&db.connection, &r, 1).unwrap().is_none());
    r.frequency = "monthly".into();
    assert!(occurrence(&db.connection, &r, 1).unwrap().is_none());
    assert_eq!(
        occurrence(&db.connection, &r, 0).unwrap().as_deref(),
        Some("9999-12-31")
    );
    r.start_date = "9999-11-30".into();
    r.interval = 1;
    assert_eq!(
        occurrence(&db.connection, &r, 1).unwrap().as_deref(),
        Some("9999-12-30")
    );
}

#[test]
fn invalid_calendar_arithmetic_returns_errors_without_panicking() {
    let (_dir, db, mut r) = setup();
    for frequency in ["weekly", "monthly", "yearly"] {
        r.frequency = frequency.into();
        assert!(occurrence(&db.connection, &r, i64::MAX).is_err());
        assert!(occurrence(&db.connection, &r, -1).is_err());
    }
    for interval in [0, -1, 121, i64::MAX] {
        r.interval = interval;
        assert!(occurrence(&db.connection, &r, 1).is_err());
    }
}
#[test]
fn materialization_is_idempotent_preserves_edits_deletions_and_balances() {
    let (_dir, mut db, r) = setup();
    db.save_recurrence(r).unwrap();
    assert_eq!(db.materialize_recurrences("2024-03-31".into()).unwrap(), 3);
    assert_eq!(db.materialize_recurrences("2024-03-31".into()).unwrap(), 0);
    assert_eq!(db.balances().unwrap()[0].cents, "0");
    let rows = db.list_transactions().unwrap();
    let mut edited = rows[0].clone();
    edited.status = "posted".into();
    edited.amount = 100;
    edited.date = "2024-04-01".into();
    db.save_transaction(edited).unwrap();
    db.delete_transaction(rows[1].id.unwrap()).unwrap();
    assert_eq!(db.materialize_recurrences("2024-03-31".into()).unwrap(), 0);
    assert_eq!(db.balances().unwrap()[0].cents, "-100");
    assert_eq!(db.list_transactions().unwrap().len(), 2);
    assert_eq!(
        db.connection
            .query_row(
                "SELECT count(*) FROM recurrence_occurrences WHERE transaction_id IS NULL",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        1
    );
}
#[test]
fn pause_resume_end_and_template_changes_preserve_existing_movements() {
    let (_dir, mut db, r) = setup();
    let mut saved = db.save_recurrence(r).unwrap().remove(0).input;
    let id = saved.id.unwrap();
    db.materialize_recurrences("2024-01-31".into()).unwrap();
    db.set_recurrence_state(id, "pause".into(), "2024-02-01".into())
        .unwrap();
    assert_eq!(db.materialize_recurrences("2024-03-31".into()).unwrap(), 0);
    db.set_recurrence_state(id, "resume".into(), "2024-03-15".into())
        .unwrap();
    assert_eq!(
        db.list_recurrences().unwrap()[0].next_date.as_deref(),
        Some("2024-03-31")
    );
    saved.amount = 500;
    db.save_recurrence(saved.clone()).unwrap();
    assert_eq!(db.materialize_recurrences("2024-03-31".into()).unwrap(), 1);
    let amounts: Vec<i64> = db
        .list_transactions()
        .unwrap()
        .iter()
        .map(|m| m.amount)
        .collect();
    assert_eq!(amounts, vec![500, 12345]);
    saved.interval = 2;
    assert!(db.save_recurrence(saved).is_err());
    db.set_recurrence_state(id, "end".into(), "2024-04-01".into())
        .unwrap();
    assert_eq!(db.materialize_recurrences("2025-12-31".into()).unwrap(), 0);
    assert!(db
        .set_recurrence_state(id, "resume".into(), "2025-01-01".into())
        .is_err());
}
#[test]
fn bounded_batches_archived_references_and_validation() {
    let (_dir, mut db, mut r) = setup();
    r.frequency = "weekly".into();
    r.start_date = "2000-01-01".into();
    let mut invalid = r.clone();
    invalid.amount = 0;
    assert!(db.save_recurrence(invalid).is_err());
    let mut invalid = r.clone();
    invalid.start_date = "2025-02-29".into();
    assert!(db.save_recurrence(invalid).is_err());
    let mut invalid = r.clone();
    invalid.interval = 0;
    assert!(db.save_recurrence(invalid).is_err());
    let mut invalid = r.clone();
    invalid.category_id = Some(
        db.list_categories()
            .unwrap()
            .into_iter()
            .find(|c| c.kind == "income")
            .unwrap()
            .id,
    );
    assert!(db.save_recurrence(invalid).is_err());
    db.save_recurrence(r).unwrap();
    db.set_account_active(1, false).unwrap();
    assert_eq!(db.materialize_recurrences("2026-01-01".into()).unwrap(), 0);
    db.set_account_active(1, true).unwrap();
    assert_eq!(
        db.materialize_recurrences("2026-01-01".into()).unwrap(),
        500
    );
    assert_eq!(
        db.materialize_recurrences("2026-01-01".into()).unwrap(),
        500
    );
    assert!(db.materialize_recurrences("0000-01-01".into()).is_err());
}
#[test]
fn contributions_are_exact_atomic_and_completion_reopens() {
    let (_dir, mut db, _) = setup();
    let id = db
        .save_goal(GoalInput {
            id: None,
            name: "Reserva".into(),
            target_amount: 100,
            target_date: None,
        })
        .unwrap()[0]
        .id;
    let rows = db.add_contribution(id, 100, "2026-09-11".into()).unwrap();
    assert!(rows[0].completed);
    let contribution = rows[0].contributions[0].id;
    db.save_goal(GoalInput {
        id: Some(id),
        name: "Reserva".into(),
        target_amount: 200,
        target_date: None,
    })
    .unwrap();
    assert!(!db.list_goals().unwrap()[0].completed);
    db.add_contribution(id, MAX_CENTS - 100, "2026-09-11".into())
        .unwrap();
    assert!(db.add_contribution(id, 1, "2026-09-11".into()).is_err());
    assert_eq!(db.list_goals().unwrap()[0].current_amount, MAX_CENTS);
    let rows = db.remove_contribution(contribution).unwrap();
    assert_eq!(rows[0].current_amount, MAX_CENTS - 100);
    assert!(db.remove_contribution(contribution).is_err());
    let id2 = rows[0].contributions[0].id;
    assert!(!db.remove_contribution(id2).unwrap()[0].completed);
    assert_eq!(db.list_goals().unwrap()[0].current_amount, 0);
    assert_eq!(db.balances().unwrap()[0].cents, "0");
    assert!(db.add_contribution(id, -1, "2026-09-11".into()).is_err());
    assert!(db.add_contribution(id, 1, "2026-02-30".into()).is_err());
    db.add_contribution(id, 5, "2026-09-11".into()).unwrap();
    assert!(db.delete_goal(id).unwrap().is_empty());
    assert_eq!(
        db.connection
            .query_row("SELECT count(*) FROM goal_contributions", [], |r| r
                .get::<_, i64>(0))
            .unwrap(),
        0
    );
}
#[test]
fn upgrade_preserves_legacy_data_and_reopens_with_integrity() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("upgrade.sqlite");
    let mut conn = Connection::open(&path).unwrap();
    super::super::migrations::migrate(&mut conn, &super::super::migrations::MIGRATIONS[..4])
        .unwrap();
    conn.execute_batch("INSERT INTO goals(name,target_amount,current_amount) VALUES('Antiga',100,120); INSERT INTO accounts(name,type,initial_balance) VALUES('Existente','wallet',12345); INSERT INTO recurrences(frequency,start_date) VALUES('monthly','2026-01-01');").unwrap();
    drop(conn);
    for _ in 0..2 {
        let db = Database::open(&path).unwrap();
        assert_eq!(
            db.status().unwrap().0,
            crate::persistence::migrations::MIGRATIONS.len() as i64
        );
        let rows = db.list_goals().unwrap();
        assert_eq!(rows[0].current_amount, 120);
        assert!(rows[0].completed);
        assert_eq!(rows[0].contributions.len(), 1);
        assert_eq!(db.balances().unwrap()[0].cents, "12345");
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
