use super::{
    metadata::{self, Details},
    transactions::Movement,
    Database,
};
use crate::domain::import::{parse_csv, parse_ofx, CsvOptions, MAX_ROWS};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImportRow {
    pub line: usize,
    pub source_account_id: i64,
    pub movement: Movement,
    pub external_id: Option<String>,
    pub raw_amount: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewedRow {
    pub row: ImportRow,
    pub error: Option<String>,
    pub duplicate: bool,
    pub already_imported: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    pub currency: String,
    pub source: String,
    pub rows: Vec<ReviewedRow>,
}
#[derive(Serialize)]
pub struct ImportResult {
    pub imported: usize,
    pub repeated: bool,
}

fn fingerprint(m: &Movement) -> (i64, String, i64, String, String, Option<i64>) {
    (
        m.account_id,
        m.date.clone(),
        m.amount,
        m.kind.clone(),
        m.description
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .to_lowercase(),
        m.destination_account_id,
    )
}
impl Database {
    pub fn prepare_import(
        &self,
        content: String,
        format: String,
        options: Option<CsvOptions>,
        account_id: i64,
    ) -> Result<ImportPreview, String> {
        let file = match format.as_str() {
            "csv" => parse_csv(&content, &options.ok_or("Configure as colunas do CSV.")?)?,
            "ofx" => parse_ofx(&content)?,
            _ => return Err("Use CSV ou OFX.".into()),
        };
        if file.card_statement {
            return Err("OFX de cartão deve ser revisado em Compras no cartão; não gera despesas bancárias automaticamente.".into());
        }
        if file.rows.iter().any(|r| {
            ["card", "invoice", "installments"]
                .iter()
                .any(|key| r.metadata.get(*key).is_some_and(|v| !v.is_empty()))
        }) {
            return Err("Este arquivo contém dados de cartão, fatura ou parcelas. Use a importação de compras no cartão para evitar lançar uma despesa bancária indevida.".into());
        }
        let currency = self.settings()?.currency;
        if file.currency.as_ref().is_some_and(|c| c != &currency) {
            return Err(format!("A moeda do OFX ({}) difere da moeda da aplicação ({currency}). Não há conversão automática.",file.currency.unwrap()));
        }
        let rows = file
            .rows
            .into_iter()
            .map(|r| {
                let incoming_transfer = r.external_id.is_some()
                    && r.kind == "transfer"
                    && !r.raw_amount.trim().starts_with('-');
                let get = |key: &str| r.metadata.get(key).filter(|v| !v.is_empty()).cloned();
                let method = get("method");
                let method_id = if let Some(value) = &method {
                    let key = metadata::name(value)?.to_lowercase();
                    Some(self.connection.query_row("SELECT id FROM financial_metadata WHERE kind='method' AND name_key=?1 AND active=1", [&key], |r| r.get(0)).optional().map_err(|e| e.to_string())?.unwrap_or(-1))
                } else { None };
                let channel = get("channel").map(|v| match v.to_lowercase().as_str() { "presencial" | "in_person" => "in_person".into(), "online" => "online".into(), _ => v });
                let details = (!r.metadata.is_empty()).then(|| Details { method_id, method_name: method, merchant: get("merchant"), intermediary: get("intermediary"), channel });
                Ok(ImportRow {
                    line: r.line,
                    source_account_id: account_id,
                    movement: Movement {
                        details,
                        id: None,
                        description: r.description,
                        amount: r.amount,
                        kind: r.kind,
                        date: r.date,
                        account_id: if incoming_transfer { 0 } else { account_id },
                        destination_account_id: incoming_transfer.then_some(account_id),
                        category_id: None,
                        status: "posted".into(),
                        notes: r.notes,
                    },
                    external_id: r.external_id,
                    raw_amount: r.raw_amount,
                })
            })
            .collect::<Result<Vec<_>, String>>()?;
        Ok(ImportPreview {
            rows: self.review_import(rows, currency.clone())?,
            currency,
            source: file.source,
        })
    }
    pub fn review_import(
        &self,
        rows: Vec<ImportRow>,
        currency: String,
    ) -> Result<Vec<ReviewedRow>, String> {
        if rows.is_empty() || rows.len() > MAX_ROWS {
            return Err("Selecione de 1 a 2000 registros.".into());
        }
        if self.settings()?.currency != currency {
            return Err("A moeda mudou. Gere uma nova pré-visualização.".into());
        }
        let accounts = self.list_accounts()?;
        let categories = self.list_categories()?;
        let mut seen = HashSet::new();
        let mut ids = HashSet::new();
        // Query only candidates for each fingerprint; do not materialize the ledger or notes.
        let mut candidates = self.connection.prepare_cached("SELECT description FROM transactions WHERE account_id=?1 AND date=?2 AND amount=?3 AND type=?4 AND destination_account_id IS ?5").map_err(|e| e.to_string())?;
        let mut external = self.connection.prepare_cached("SELECT EXISTS(SELECT 1 FROM import_entries WHERE account_id=?1 AND external_id=?2)").map_err(|e| e.to_string())?;
        let mut result = Vec::new();
        for mut row in rows {
            let error = if !accounts
                .iter()
                .any(|a| a.id == row.source_account_id && a.active)
            {
                Some("Conta do extrato inválida ou arquivada.".into())
            } else if row.movement.id.is_some() {
                Some("Importação não pode editar uma transação existente.".into())
            } else if row
                .external_id
                .as_ref()
                .is_some_and(|s| s.is_empty() || s.len() > 2048)
                || row.raw_amount.len() > 1000
            {
                Some("Metadados da importação inválidos.".into())
            } else {
                self.validate_movement_with_catalog(&mut row.movement, &accounts, &categories)
                    .and_then(|_| {
                        row.movement.details.as_ref().map_or(Ok(()), |d| {
                            metadata::validate_new_details(&self.connection, d)
                        })
                    })
                    .err()
            };
            let key = fingerprint(&row.movement);
            let mut duplicate = !seen.insert(key.clone());
            if !duplicate {
                let descriptions = candidates
                    .query_map(params![key.0, key.1, key.2, key.3, key.5], |r| {
                        r.get::<_, String>(0)
                    })
                    .map_err(|e| e.to_string())?;
                for description in descriptions {
                    let normalized = description
                        .map_err(|e| e.to_string())?
                        .split_whitespace()
                        .collect::<Vec<_>>()
                        .join(" ")
                        .to_lowercase();
                    if normalized == key.4 {
                        duplicate = true;
                        break;
                    }
                }
            }
            let already_imported = if let Some(id) = &row.external_id {
                !ids.insert((row.source_account_id, id.clone()))
                    || external
                        .query_row(params![row.source_account_id, id], |r| r.get::<_, bool>(0))
                        .map_err(|e| e.to_string())?
            } else {
                false
            };
            result.push(ReviewedRow {
                row,
                error,
                duplicate,
                already_imported,
            });
        }
        Ok(result)
    }
    pub fn commit_import(
        &mut self,
        request_id: String,
        rows: Vec<ImportRow>,
        currency: String,
        allow_duplicates: bool,
    ) -> Result<ImportResult, String> {
        if !(16..=100).contains(&request_id.len())
            || !request_id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-')
        {
            return Err("Identificador de confirmação inválido.".into());
        }
        let bytes =
            serde_json::to_vec(&(&rows, &currency, allow_duplicates)).map_err(|e| e.to_string())?;
        if bytes.len() > 8_000_000 {
            return Err("Lote de importação muito grande.".into());
        }
        let hash = format!("{:x}", Sha256::digest(bytes));
        let tx = self
            .connection
            .unchecked_transaction()
            .map_err(|e| e.to_string())?;
        let previous: Option<(String, i64)> = tx
            .query_row(
                "SELECT payload_hash,imported_count FROM import_batches WHERE request_id=?1",
                [&request_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if let Some((saved, count)) = previous {
            if saved != hash {
                return Err(
                    "Esta confirmação já foi usada com outro conteúdo. Gere uma nova revisão."
                        .into(),
                );
            }
            return Ok(ImportResult {
                imported: usize::try_from(count).map_err(|_| "Contagem de importação inválida.")?,
                repeated: true,
            });
        }
        let reviewed = self.review_import(rows, currency)?;
        for row in &reviewed {
            if let Some(e) = &row.error {
                return Err(format!("Registro {}: {e}", row.row.line));
            }
            if row.already_imported {
                return Err(format!(
                    "Registro {}: FITID já importado ou repetido no lote. Exclua-o da seleção.",
                    row.row.line
                ));
            }
            if row.duplicate && !allow_duplicates {
                return Err("Há possíveis duplicatas. Revise novamente ou confirme explicitamente sua inclusão.".into());
            }
        }
        tx.execute(
            "INSERT INTO import_batches(request_id,payload_hash,imported_count) VALUES(?1,?2,?3)",
            params![request_id, hash, reviewed.len() as i64],
        )
        .map_err(|e| e.to_string())?;
        for row in &reviewed {
            let m = &row.row.movement;
            tx.execute("INSERT INTO transactions(description,amount,type,date,account_id,destination_account_id,category_id,status,notes) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",params![m.description,m.amount,m.kind,m.date,m.account_id,m.destination_account_id,m.category_id,m.status,m.notes]).map_err(|e|e.to_string())?;
            let id = tx.last_insert_rowid();
            if let Some(details) = &m.details {
                metadata::write_details(&tx, id, details)?;
            }
            tx.execute("INSERT INTO import_entries(batch_id,account_id,external_id,transaction_id) VALUES(?1,?2,?3,?4)",params![request_id,row.row.source_account_id,row.row.external_id,id]).map_err(|e|e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(ImportResult {
            imported: reviewed.len(),
            repeated: false,
        })
    }
}

#[cfg(test)]
mod tests;
