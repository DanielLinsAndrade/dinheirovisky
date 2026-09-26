use crate::domain::{Account, AccountInput, Category, CategoryInput};
use crate::persistence::transactions::{Balance, Movement};
use crate::persistence::{budgets::Budget, settings::Settings};
use crate::persistence::{Database, SharedDatabase};
use serde::Serialize;
use tauri::State;
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub async fn list_attachments(
    database: State<'_, SharedDatabase>,
    kind: String,
    id: i64,
    page: i64,
) -> Result<Vec<crate::persistence::attachments::Attachment>, String> {
    with_database(database, move |db| db.attachments(&kind, id, page)).await
}
#[tauri::command]
pub async fn read_attachment(
    database: State<'_, SharedDatabase>,
    id: i64,
) -> Result<crate::persistence::attachments::AttachmentData, String> {
    with_database(database, move |db| db.attachment_data(id)).await
}
#[tauri::command]
pub async fn remove_attachment(database: State<'_, SharedDatabase>, id: i64) -> Result<(), String> {
    with_database(database, move |db| db.remove_attachment(id)).await
}
#[tauri::command]
pub async fn add_attachment(
    app: tauri::AppHandle,
    database: State<'_, SharedDatabase>,
    kind: String,
    id: i64,
    document_type: String,
) -> Result<Option<i64>, String> {
    let path = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .add_filter("Imagem ou PDF", &["png", "jpg", "jpeg", "webp", "pdf"])
            .blocking_pick_file()
            .map(|f| f.into_path().map_err(|e| e.to_string()))
            .transpose()
    })
    .await
    .map_err(|e| e.to_string())??;
    let Some(path) = path else { return Ok(None) };
    with_database(database, move |db| {
        db.add_attachment(&kind, id, &document_type, &path)
            .map(Some)
    })
    .await
}

#[tauri::command]
pub async fn search_global(
    database: State<'_, SharedDatabase>,
    query: String,
    page: i64,
) -> Result<crate::persistence::search::SearchPage, String> {
    with_database(database, move |db| db.search(&query, page)).await
}
#[tauri::command]
pub async fn get_search_record(
    database: State<'_, SharedDatabase>,
    kind: String,
    id: i64,
) -> Result<crate::persistence::search::SearchRecord, String> {
    with_database(database, move |db| db.search_record(&kind, id)).await
}

#[tauri::command]
pub async fn query_transactions(
    database: State<'_, SharedDatabase>,
    query: crate::persistence::transaction_query::TransactionQuery,
) -> Result<crate::persistence::transaction_query::TransactionPage, String> {
    with_database(database, move |db| db.query_transactions(query)).await
}

#[tauri::command]
pub async fn query_due_payments(
    database: State<'_, SharedDatabase>,
    today: String,
    horizon: String,
    page: i64,
) -> Result<crate::persistence::dashboard::DuePaymentPage, String> {
    with_database(database, move |db| {
        db.due_payment_page(&today, &horizon, page)
    })
    .await
}

#[tauri::command]
pub async fn query_commitments(
    database: State<'_, SharedDatabase>,
    today: String,
    horizon: String,
    page: usize,
) -> Result<crate::persistence::commitments::CommitmentPage, String> {
    with_database(database, move |db| db.commitments(&today, &horizon, page)).await
}

#[tauri::command]
pub async fn query_financial_alerts(
    database: State<'_, SharedDatabase>,
    today: String,
    comparison_month: Option<String>,
    page: usize,
) -> Result<crate::persistence::alerts::AlertPage, String> {
    with_database(database, move |db| {
        db.financial_alerts(&today, comparison_month, page)
    })
    .await
}

#[tauri::command]
pub async fn get_due_payments(
    database: State<'_, SharedDatabase>,
    today: String,
) -> Result<Vec<crate::persistence::dashboard::DuePayment>, String> {
    with_database(database, move |db| db.due_payments(&today)).await
}

#[tauri::command]
pub async fn storage_status(
    database: State<'_, SharedDatabase>,
) -> Result<crate::persistence::startup::StorageStatus, String> {
    let state = database.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        Ok(state
            .lock()
            .map_err(|_| "Acesso interrompido. Reinicie a aplicação.")?
            .retry())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn prepare_recovery(
    app: tauri::AppHandle,
    database: State<'_, SharedDatabase>,
) -> Result<Option<crate::persistence::backup::BackupPreview>, String> {
    let state = database.inner().clone();
    state.lock().map_err(|_| "Acesso interrompido.")?.cancel();
    let Some(path) = choose_file(app, false, "dvbackup").await? else {
        return Ok(None);
    };
    tauri::async_runtime::spawn_blocking(move || {
        state
            .lock()
            .map_err(|_| "Acesso interrompido.")?
            .prepare(&path)
            .map(Some)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn confirm_recovery(
    database: State<'_, SharedDatabase>,
    token: String,
    confirmed: bool,
) -> Result<(), String> {
    let state = database.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        state
            .lock()
            .map_err(|_| "Acesso interrompido.")?
            .confirm(&token, confirmed)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn cancel_recovery(database: State<'_, SharedDatabase>) -> Result<(), String> {
    database
        .lock()
        .map_err(|_| "Acesso interrompido.")?
        .cancel();
    Ok(())
}

async fn choose_file(
    app: tauri::AppHandle,
    save: bool,
    extension: &'static str,
) -> Result<Option<std::path::PathBuf>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dialog = app.dialog().file().add_filter(
            "Dinheirovisky",
            if extension == "dvbackup" {
                &["dvbackup", "sqlite3"]
            } else {
                std::slice::from_ref(&extension)
            },
        );
        let file = if save {
            dialog
                .set_file_name(format!(
                    "dinheirovisky-{}.{}",
                    std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_secs(),
                    extension
                ))
                .blocking_save_file()
        } else {
            dialog.blocking_pick_file()
        };
        file.map(|f| f.into_path().map_err(|e| e.to_string()))
            .transpose()
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn export_backup(
    app: tauri::AppHandle,
    database: State<'_, SharedDatabase>,
) -> Result<Option<String>, String> {
    let Some(path) = choose_file(app, true, "dvbackup").await? else {
        return Ok(None);
    };
    with_database(database, move |db| {
        db.export_backup_v2(&path)?;
        Ok(Some(path.display().to_string()))
    })
    .await
}
#[tauri::command]
pub async fn export_transactions(
    app: tauri::AppHandle,
    database: State<'_, SharedDatabase>,
) -> Result<Option<String>, String> {
    let Some(path) = choose_file(app, true, "csv").await? else {
        return Ok(None);
    };
    with_database(database, move |db| {
        let count = db.export_transactions(&path)?;
        Ok(Some(format!(
            "{count} transações exportadas para {}",
            path.display()
        )))
    })
    .await
}
#[tauri::command]
pub async fn prepare_restore(
    app: tauri::AppHandle,
    database: State<'_, SharedDatabase>,
) -> Result<Option<crate::persistence::backup::BackupPreview>, String> {
    let Some(path) = choose_file(app, false, "dvbackup").await? else {
        return Ok(None);
    };
    with_database(database, move |db| db.prepare_restore(&path).map(Some)).await
}
#[tauri::command]
pub async fn cancel_restore(database: State<'_, SharedDatabase>) -> Result<(), String> {
    with_database(database, |db| {
        db.cancel_restore();
        Ok(())
    })
    .await
}
#[tauri::command]
pub async fn confirm_restore(
    database: State<'_, SharedDatabase>,
    token: String,
    confirmed: bool,
) -> Result<String, String> {
    with_database(database, move |db| db.confirm_restore(&token, confirmed)).await
}
#[tauri::command]
pub async fn import_csv_headers(content: String, delimiter: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::domain::import::csv_records(&content, &delimiter).map(|r| r[0].clone())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn prepare_import(
    database: State<'_, SharedDatabase>,
    content: String,
    format: String,
    options: Option<crate::domain::import::CsvOptions>,
    account_id: i64,
) -> Result<crate::persistence::imports::ImportPreview, String> {
    with_database(database, move |db| {
        db.prepare_import(content, format, options, account_id)
    })
    .await
}
#[tauri::command]
pub async fn review_import(
    database: State<'_, SharedDatabase>,
    rows: Vec<crate::persistence::imports::ImportRow>,
    currency: String,
) -> Result<Vec<crate::persistence::imports::ReviewedRow>, String> {
    with_database(database, move |db| db.review_import(rows, currency)).await
}
#[tauri::command]
pub async fn commit_import(
    database: State<'_, SharedDatabase>,
    request_id: String,
    rows: Vec<crate::persistence::imports::ImportRow>,
    currency: String,
    allow_duplicates: bool,
) -> Result<crate::persistence::imports::ImportResult, String> {
    with_database(database, move |db| {
        db.commit_import(request_id, rows, currency, allow_duplicates)
    })
    .await
}
#[tauri::command]
pub async fn prepare_card_import(
    database: State<'_, SharedDatabase>,
    content: String,
    format: String,
    options: Option<crate::domain::import::CsvOptions>,
    card_id: i64,
) -> Result<crate::persistence::card_imports::CardImportPreview, String> {
    with_database(database, move |db| {
        db.prepare_card_import(content, format, options, card_id)
    })
    .await
}
#[tauri::command]
pub async fn review_card_import(
    database: State<'_, SharedDatabase>,
    rows: Vec<crate::persistence::card_imports::CardImportRow>,
    currency: String,
) -> Result<Vec<crate::persistence::card_imports::ReviewedCardRow>, String> {
    with_database(database, move |db| db.review_card_import(rows, currency)).await
}
#[tauri::command]
pub async fn commit_card_import(
    database: State<'_, SharedDatabase>,
    request_id: String,
    rows: Vec<crate::persistence::card_imports::CardImportRow>,
    currency: String,
    allow_duplicates: bool,
) -> Result<crate::persistence::imports::ImportResult, String> {
    with_database(database, move |db| {
        db.commit_card_import(request_id, rows, currency, allow_duplicates)
    })
    .await
}
#[tauri::command]
pub async fn get_report(
    database: State<'_, SharedDatabase>,
    from: String,
    to: String,
    account_id: Option<i64>,
) -> Result<crate::persistence::reports::Report, String> {
    with_database(database, move |db| db.report(from, to, account_id)).await
}
#[tauri::command]
pub async fn get_report_analysis(
    database: State<'_, SharedDatabase>,
    filter: crate::persistence::report_analysis::AnalysisFilter,
) -> Result<crate::persistence::report_analysis::AnalysisReport, String> {
    with_database(database, move |db| db.report_analysis(filter)).await
}
#[tauri::command]
pub async fn list_recurrences(
    database: State<'_, SharedDatabase>,
) -> Result<Vec<crate::persistence::planning::Recurrence>, String> {
    with_database(database, |db| db.list_recurrences()).await
}
#[tauri::command]
pub async fn save_recurrence(
    database: State<'_, SharedDatabase>,
    input: crate::persistence::planning::RecurrenceInput,
) -> Result<Vec<crate::persistence::planning::Recurrence>, String> {
    with_database(database, |db| db.save_recurrence(input)).await
}
#[tauri::command]
pub async fn set_recurrence_state(
    database: State<'_, SharedDatabase>,
    id: i64,
    action: String,
    today: String,
) -> Result<Vec<crate::persistence::planning::Recurrence>, String> {
    with_database(database, move |db| {
        db.set_recurrence_state(id, action, today)
    })
    .await
}
#[tauri::command]
pub async fn materialize_recurrences(
    database: State<'_, SharedDatabase>,
    today: String,
) -> Result<usize, String> {
    with_database(database, |db| db.materialize_recurrences(today)).await
}
#[tauri::command]
pub async fn list_goals(
    database: State<'_, SharedDatabase>,
) -> Result<Vec<crate::persistence::planning::Goal>, String> {
    with_database(database, |db| db.list_goals()).await
}
#[tauri::command]
pub async fn save_goal(
    database: State<'_, SharedDatabase>,
    input: crate::persistence::planning::GoalInput,
) -> Result<Vec<crate::persistence::planning::Goal>, String> {
    with_database(database, |db| db.save_goal(input)).await
}
#[tauri::command]
pub async fn delete_goal(
    database: State<'_, SharedDatabase>,
    id: i64,
) -> Result<Vec<crate::persistence::planning::Goal>, String> {
    with_database(database, move |db| db.delete_goal(id)).await
}
#[tauri::command]
pub async fn add_contribution(
    database: State<'_, SharedDatabase>,
    goal_id: i64,
    amount: i64,
    date: String,
) -> Result<Vec<crate::persistence::planning::Goal>, String> {
    with_database(database, move |db| {
        db.add_contribution(goal_id, amount, date)
    })
    .await
}
#[tauri::command]
pub async fn remove_contribution(
    database: State<'_, SharedDatabase>,
    id: i64,
) -> Result<Vec<crate::persistence::planning::Goal>, String> {
    with_database(database, move |db| db.remove_contribution(id)).await
}

#[tauri::command]
pub async fn get_settings(database: State<'_, SharedDatabase>) -> Result<Settings, String> {
    with_database(database, |db| db.settings()).await
}
#[tauri::command]
pub async fn save_settings(
    database: State<'_, SharedDatabase>,
    input: Settings,
    confirm_currency_change: bool,
) -> Result<Settings, String> {
    with_database(database, move |db| {
        db.save_settings(input, confirm_currency_change)
    })
    .await
}
#[tauri::command]
pub async fn list_budgets(
    database: State<'_, SharedDatabase>,
    month: String,
) -> Result<Vec<Budget>, String> {
    with_database(database, |db| db.budget_snapshot(month)).await
}
#[tauri::command]
pub async fn save_budget(
    database: State<'_, SharedDatabase>,
    month: String,
    category_id: i64,
    limit_amount: i64,
) -> Result<Vec<Budget>, String> {
    with_database(database, move |db| {
        db.save_budget(month, category_id, limit_amount)
    })
    .await
}
#[tauri::command]
pub async fn delete_budget(
    database: State<'_, SharedDatabase>,
    month: String,
    category_id: i64,
) -> Result<Vec<Budget>, String> {
    with_database(database, move |db| db.delete_budget(month, category_id)).await
}
#[tauri::command]
pub async fn copy_budgets(
    database: State<'_, SharedDatabase>,
    month: String,
) -> Result<Vec<Budget>, String> {
    with_database(database, |db| db.copy_budgets(month)).await
}

#[tauri::command]
pub async fn get_dashboard(
    database: State<'_, SharedDatabase>,
    month: String,
) -> Result<crate::persistence::dashboard::Dashboard, String> {
    with_database(database, |db| db.dashboard(month)).await
}

#[tauri::command]
pub async fn list_transactions(
    database: State<'_, SharedDatabase>,
) -> Result<Vec<Movement>, String> {
    with_database(database, |db| db.list_transactions()).await
}
#[tauri::command]
pub async fn save_transaction(
    database: State<'_, SharedDatabase>,
    input: Movement,
) -> Result<(), String> {
    with_database(database, |db| db.write_transaction(input)).await
}
#[tauri::command]
pub async fn delete_transaction(
    database: State<'_, SharedDatabase>,
    id: i64,
) -> Result<(), String> {
    with_database(database, move |db| db.remove_transaction(id)).await
}
#[tauri::command]
pub async fn get_balances(database: State<'_, SharedDatabase>) -> Result<Vec<Balance>, String> {
    with_database(database, |db| db.balances()).await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppStatus {
    app_version: &'static str,
    schema_version: i64,
    sqlite_version: String,
    database_path: String,
}

#[tauri::command]
pub fn get_app_status(database: State<'_, SharedDatabase>) -> Result<AppStatus, String> {
    let database = database
        .lock()
        .map_err(|_| "O acesso ao banco foi interrompido. Reinicie a aplicação.")?;
    let database = database
        .database
        .as_ref()
        .ok_or("Armazenamento indisponível. Use a recuperação na tela inicial.")?;
    let (schema_version, sqlite_version) = database
        .status()
        .map_err(|error| format!("Falha ao consultar SQLite: {error}"))?;
    Ok(AppStatus {
        app_version: env!("CARGO_PKG_VERSION"),
        schema_version,
        sqlite_version,
        database_path: database.path().display().to_string(),
    })
}

// As operações SQLite rodam fora da thread da janela e do executor assíncrono.
async fn with_database<T: Send + 'static>(
    database: State<'_, SharedDatabase>,
    operation: impl FnOnce(&mut Database) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let database = database.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut database = database
            .lock()
            .map_err(|_| "O acesso ao banco foi interrompido. Reinicie a aplicação.")?;
        operation(
            database
                .database
                .as_mut()
                .ok_or("Armazenamento indisponível. Use a recuperação na tela inicial.")?,
        )
        .map_err(crate::persistence::startup::message)
    })
    .await
    .map_err(|_| {
        "A operação foi interrompida. Atualize a lista antes de tentar novamente.".to_owned()
    })?
}

#[tauri::command]
pub async fn list_accounts(database: State<'_, SharedDatabase>) -> Result<Vec<Account>, String> {
    with_database(database, |db| db.list_accounts()).await
}
#[tauri::command]
pub async fn save_account(
    database: State<'_, SharedDatabase>,
    input: AccountInput,
) -> Result<Vec<Account>, String> {
    with_database(database, |db| db.save_account(input)).await
}
#[tauri::command]
pub async fn set_account_active(
    database: State<'_, SharedDatabase>,
    id: i64,
    active: bool,
) -> Result<Vec<Account>, String> {
    with_database(database, move |db| db.set_account_active(id, active)).await
}
#[tauri::command]
pub async fn list_categories(database: State<'_, SharedDatabase>) -> Result<Vec<Category>, String> {
    with_database(database, |db| db.list_categories()).await
}
#[tauri::command]
pub async fn save_category(
    database: State<'_, SharedDatabase>,
    input: CategoryInput,
) -> Result<Vec<Category>, String> {
    with_database(database, |db| db.save_category(input)).await
}
#[tauri::command]
pub async fn set_category_active(
    database: State<'_, SharedDatabase>,
    id: i64,
    active: bool,
) -> Result<Vec<Category>, String> {
    with_database(database, move |db| db.set_category_active(id, active)).await
}

#[tauri::command]
pub async fn query_metadata(
    database: State<'_, SharedDatabase>,
    kind: String,
    search: String,
    archived: bool,
) -> Result<Vec<crate::persistence::metadata::Metadata>, String> {
    with_database(database, move |db| db.metadata(&kind, &search, archived)).await
}
#[tauri::command]
pub async fn save_metadata(
    database: State<'_, SharedDatabase>,
    input: crate::persistence::metadata::MetadataInput,
) -> Result<(), String> {
    with_database(database, move |db| db.save_metadata(input)).await
}

#[tauri::command]
pub async fn list_cards(
    database: tauri::State<'_, crate::persistence::SharedDatabase>,
) -> Result<Vec<crate::persistence::cards::Card>, String> {
    with_database(database, |db| db.list_cards()).await
}
#[tauri::command]
pub async fn save_card(
    database: tauri::State<'_, crate::persistence::SharedDatabase>,
    input: crate::persistence::cards::CardInput,
) -> Result<Vec<crate::persistence::cards::Card>, String> {
    with_database(database, move |db| db.save_card(input)).await
}
#[tauri::command]
pub async fn set_card_active(
    database: tauri::State<'_, crate::persistence::SharedDatabase>,
    id: i64,
    active: bool,
) -> Result<Vec<crate::persistence::cards::Card>, String> {
    with_database(database, move |db| db.set_card_active(id, active)).await
}
#[tauri::command]
pub async fn delete_card(
    database: tauri::State<'_, crate::persistence::SharedDatabase>,
    id: i64,
) -> Result<Vec<crate::persistence::cards::Card>, String> {
    with_database(database, move |db| db.delete_card(id)).await
}
#[tauri::command]
pub async fn card_calendar(
    database: tauri::State<'_, crate::persistence::SharedDatabase>,
    id: i64,
    month: String,
) -> Result<Vec<crate::domain::cards::CardDates>, String> {
    with_database(database, move |db| db.card_calendar(id, &month)).await
}

#[tauri::command]
pub async fn save_purchase(
    database: State<'_, SharedDatabase>,
    input: crate::persistence::purchases::PurchaseInput,
) -> Result<i64, String> {
    with_database(database, move |db| db.save_purchase(input)).await
}
#[tauri::command]
pub async fn cancel_purchase(database: State<'_, SharedDatabase>, id: i64) -> Result<(), String> {
    with_database(database, move |db| db.cancel_purchase(id)).await
}
#[tauri::command]
pub async fn query_purchases(
    database: State<'_, SharedDatabase>,
    card_id: i64,
    page: i64,
) -> Result<crate::persistence::purchases::PurchasePage, String> {
    with_database(database, move |db| db.purchases(card_id, page)).await
}
#[tauri::command]
pub async fn query_invoices(
    database: State<'_, SharedDatabase>,
    card_id: i64,
    today: String,
    page: i64,
) -> Result<crate::persistence::purchases::InvoicePage, String> {
    with_database(database, move |db| db.invoices(card_id, &today, page)).await
}
#[tauri::command]
pub async fn invoice_detail(
    database: State<'_, SharedDatabase>,
    id: i64,
    today: String,
) -> Result<crate::persistence::purchases::InvoiceDetail, String> {
    with_database(database, move |db| db.invoice_detail(id, &today)).await
}

#[tauri::command]
pub async fn save_invoice_event(
    database: State<'_, SharedDatabase>,
    input: crate::persistence::invoice_events::EventInput,
) -> Result<i64, String> {
    with_database(database, move |db| db.save_invoice_event(input)).await
}
#[tauri::command]
pub async fn void_invoice_event(
    database: State<'_, SharedDatabase>,
    id: i64,
) -> Result<(), String> {
    with_database(database, move |db| db.void_invoice_event(id)).await
}
