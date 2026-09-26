use super::{
    imports::ImportResult,
    purchases::{validate_import_purchase, write_purchase_in, PurchaseInput},
    Database,
};
use crate::domain::import::{parse_csv, parse_ofx, CsvOptions, MAX_ROWS};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CardImportRow {
    pub line: usize,
    pub purchase: PurchaseInput,
    pub external_id: Option<String>,
    pub raw_amount: String,
    pub source_card: Option<String>,
    pub first_invoice: Option<String>,
    // Confirmation concerns the full original purchase, never an isolated installment.
    pub confirmed_purchase: bool,
    pub source_kind: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewedCardRow {
    pub row: CardImportRow,
    pub error: Option<String>,
    pub duplicate: bool,
    pub already_imported: bool,
    pub calculated_invoice: Option<String>,
}
#[derive(Serialize)]
pub struct CardImportPreview {
    pub currency: String,
    pub source: String,
    pub rows: Vec<ReviewedCardRow>,
}
fn normalized(s: &str) -> String {
    s.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}
impl Database {
    pub fn prepare_card_import(
        &self,
        content: String,
        format: String,
        options: Option<CsvOptions>,
        card_id: i64,
    ) -> Result<CardImportPreview, String> {
        let file = match format.as_str() {
            "csv" => parse_csv(&content, &options.ok_or("Configure as colunas do CSV.")?)?,
            "ofx" => parse_ofx(&content)?,
            _ => return Err("Use CSV ou OFX.".into()),
        };
        let currency = self.settings()?.currency;
        if file.currency.as_ref().is_some_and(|c| c != &currency) {
            return Err("A moeda do OFX difere da moeda da aplicação.".into());
        }
        if file
            .rows
            .iter()
            .any(|r| r.metadata.get("method").is_some_and(|v| !v.is_empty()))
        {
            return Err("Compras neste fluxo usam cartão de crédito. Remova o mapeamento de método e confira a origem.".into());
        }
        let rows = file
            .rows
            .into_iter()
            .map(|r| {
                let get = |key: &str| r.metadata.get(key).filter(|v| !v.is_empty()).cloned();
                CardImportRow {
                    line: r.line,
                    purchase: PurchaseInput {
                        id: None,
                        card_id,
                        description: r.description,
                        date: r.date,
                        amount: r.amount,
                        installment_count: get("installments")
                            .and_then(|v| v.parse().ok())
                            .unwrap_or(0),
                        category_id: None,
                        merchant: get("merchant"),
                        intermediary: get("intermediary"),
                        channel: get("channel").map(|v| match v.to_lowercase().as_str() {
                            "presencial" | "in_person" => "in_person".into(),
                            "online" => "online".into(),
                            _ => v,
                        }),
                        notes: r.notes,
                    },
                    external_id: r.external_id,
                    raw_amount: r.raw_amount,
                    source_card: get("card"),
                    first_invoice: get("invoice"),
                    confirmed_purchase: false,
                    source_kind: r.kind,
                }
            })
            .collect();
        Ok(CardImportPreview {
            rows: self.review_card_import(rows, currency.clone())?,
            currency,
            source: if format == "csv" {
                "CSV: cartão selecionado manualmente".into()
            } else {
                file.source
            },
        })
    }

    pub fn review_card_import(
        &self,
        rows: Vec<CardImportRow>,
        currency: String,
    ) -> Result<Vec<ReviewedCardRow>, String> {
        if rows.is_empty() || rows.len() > MAX_ROWS {
            return Err("Selecione de 1 a 2000 compras.".into());
        }
        if self.settings()?.currency != currency {
            return Err("A moeda mudou. Gere outra prévia.".into());
        }
        let mut seen = HashSet::new();
        let mut ids = HashSet::new();
        let mut candidates = self.connection.prepare_cached("SELECT description FROM card_purchases WHERE card_id=?1 AND date=?2 AND amount=?3 AND installment_count=?4").map_err(|e| e.to_string())?;
        let mut external = self.connection.prepare_cached("SELECT EXISTS(SELECT 1 FROM card_import_entries WHERE card_id=?1 AND external_id=?2)").map_err(|e| e.to_string())?;
        rows.into_iter().map(|mut row| {
            row.purchase.description = row.purchase.description.trim().into();
            let p = &row.purchase;
            let validated = validate_import_purchase(&self.connection, p);
            let calculated_invoice = validated.as_ref().ok().cloned();
            let error = (|| {
                let invoice = validated?;
                if row.external_id.as_ref().is_some_and(|v| v.is_empty() || v.len() > 2048) || row.raw_amount.len() > 1000 { return Err("Metadados da importação inválidos.".into()); }
                if row.source_kind != "expense" { return Err("Receita, pagamento, crédito ou transferência não é uma compra. Exclua esta linha e use o evento apropriado da fatura.".into()); }
                if let Some(label) = &row.source_card {
                    let card: String = self.connection.query_row("SELECT name FROM credit_cards WHERE id=?1", [p.card_id], |r| r.get(0)).map_err(|e| e.to_string())?;
                    if normalized(label) != normalized(&card) { return Err("Cartão do arquivo difere do selecionado. Confira e corrija a associação na revisão.".into()); }
                }
                if row.first_invoice.as_ref().is_some_and(|m| m != &invoice) { return Err(format!("Primeira fatura informada difere do calendário ({invoice}). Confira a data original da compra e a fatura antes de confirmar.")); }
                if !row.confirmed_purchase { return Err("Confirme que data, valor integral e quantidade total de parcelas representam a compra original, não uma parcela isolada.".into()); }
                Ok(())
            })().err();
            let key = (p.card_id, p.date.clone(), p.amount, p.installment_count, normalized(&p.description));
            let mut duplicate = !seen.insert(key.clone());
            if !duplicate {
                for description in candidates.query_map(params![key.0,key.1,key.2,key.3], |r| r.get::<_,String>(0)).map_err(|e| e.to_string())? {
                    if normalized(&description.map_err(|e| e.to_string())?) == key.4 { duplicate = true; break; }
                }
            }
            let already_imported = if let Some(id) = &row.external_id {
                !ids.insert((p.card_id, id.clone())) || external.query_row(params![p.card_id,id], |r| r.get::<_,bool>(0)).map_err(|e| e.to_string())?
            } else { false };
            Ok(ReviewedCardRow { row, error, duplicate, already_imported, calculated_invoice })
        }).collect()
    }

    pub fn commit_card_import(
        &mut self,
        request_id: String,
        rows: Vec<CardImportRow>,
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
        let payload = serde_json::to_vec(&("card", &rows, &currency, allow_duplicates))
            .map_err(|e| e.to_string())?;
        if payload.len() > 8_000_000 {
            return Err("Lote muito grande.".into());
        }
        let hash = format!("{:x}", Sha256::digest(payload));
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
        if let Some((saved, imported)) = previous {
            if saved != hash {
                return Err("Confirmação já usada com outro conteúdo.".into());
            }
            return Ok(ImportResult {
                imported: usize::try_from(imported)
                    .map_err(|_| "Contagem de importação inválida.")?,
                repeated: true,
            });
        }
        let reviewed = self.review_card_import(rows, currency)?;
        for r in &reviewed {
            if let Some(error) = &r.error {
                return Err(format!("Registro {}: {error}", r.row.line));
            }
            if r.already_imported {
                return Err("FITID já importado ou repetido no lote. Remova da seleção.".into());
            }
            if r.duplicate && !allow_duplicates {
                return Err("Possíveis duplicatas exigem confirmação explícita.".into());
            }
        }
        tx.execute(
            "INSERT INTO import_batches(request_id,payload_hash,imported_count) VALUES(?1,?2,?3)",
            params![request_id, hash, reviewed.len() as i64],
        )
        .map_err(|e| e.to_string())?;
        for r in &reviewed {
            let id = write_purchase_in(&tx, r.row.purchase.clone())?;
            tx.execute("INSERT INTO card_import_entries(batch_id,card_id,external_id,purchase_id) VALUES(?1,?2,?3,?4)", params![request_id,r.row.purchase.card_id,r.row.external_id,id]).map_err(|e| e.to_string())?;
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
