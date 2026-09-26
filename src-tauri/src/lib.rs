mod commands;
pub mod domain;
pub mod persistence;

use persistence::startup::Storage;
use std::sync::{Arc, Mutex};
use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let directory = app.path().app_local_data_dir().map_err(|e| e.to_string());
            let database = Storage::new(directory);
            app.manage(Arc::new(Mutex::new(database)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_attachments,
            commands::add_attachment,
            commands::read_attachment,
            commands::remove_attachment,
            commands::search_global,
            commands::get_search_record,
            commands::storage_status,
            commands::list_cards,
            commands::save_card,
            commands::set_card_active,
            commands::delete_card,
            commands::card_calendar,
            commands::save_purchase,
            commands::cancel_purchase,
            commands::query_purchases,
            commands::query_invoices,
            commands::invoice_detail,
            commands::save_invoice_event,
            commands::void_invoice_event,
            commands::query_metadata,
            commands::save_metadata,
            commands::get_due_payments,
            commands::query_due_payments,
            commands::query_commitments,
            commands::query_financial_alerts,
            commands::query_transactions,
            commands::prepare_recovery,
            commands::confirm_recovery,
            commands::cancel_recovery,
            commands::export_backup,
            commands::export_transactions,
            commands::prepare_restore,
            commands::cancel_restore,
            commands::confirm_restore,
            commands::import_csv_headers,
            commands::prepare_import,
            commands::review_import,
            commands::commit_import,
            commands::prepare_card_import,
            commands::review_card_import,
            commands::commit_card_import,
            commands::get_report,
            commands::get_report_analysis,
            commands::list_recurrences,
            commands::save_recurrence,
            commands::set_recurrence_state,
            commands::materialize_recurrences,
            commands::list_goals,
            commands::save_goal,
            commands::delete_goal,
            commands::add_contribution,
            commands::remove_contribution,
            commands::get_app_status,
            commands::get_dashboard,
            commands::get_settings,
            commands::save_settings,
            commands::list_budgets,
            commands::save_budget,
            commands::delete_budget,
            commands::copy_budgets,
            commands::list_transactions,
            commands::save_transaction,
            commands::delete_transaction,
            commands::get_balances,
            commands::list_accounts,
            commands::save_account,
            commands::set_account_active,
            commands::list_categories,
            commands::save_category,
            commands::set_category_active,
        ])
        .run(tauri::generate_context!())
        .expect("Não foi possível iniciar o Dinheirovisky. Verifique o acesso à pasta de dados.");
}
