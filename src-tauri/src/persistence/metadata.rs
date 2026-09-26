use super::Database;
use crate::domain::{normalized_name, validate_id};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Details {
    pub method_id: Option<i64>,
    // Display-only; writes resolve the authoritative name from method_id.
    #[serde(default)]
    pub method_name: Option<String>,
    pub merchant: Option<String>,
    pub channel: Option<String>,
    pub intermediary: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Metadata {
    pub id: i64,
    pub kind: String,
    pub name: String,
    pub code: Option<String>,
    pub active: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MetadataInput {
    pub id: Option<i64>,
    pub kind: String,
    pub name: String,
    pub code: Option<String>,
    pub active: bool,
}
fn kind_valid(kind: &str) -> Result<(), String> {
    if !["method", "merchant", "intermediary"].contains(&kind) {
        return Err("Tipo de metadado inválido.".into());
    }
    Ok(())
}
pub(super) fn name(value: &str) -> Result<String, String> {
    let value = normalized_name(value)?;
    Ok(value.split_whitespace().collect::<Vec<_>>().join(" "))
}
impl Database {
    pub fn metadata(
        &self,
        kind: &str,
        search: &str,
        archived: bool,
    ) -> Result<Vec<Metadata>, String> {
        kind_valid(kind)?;
        if search.chars().count() > 120 {
            return Err("Pesquisa deve ter até 120 caracteres.".into());
        }
        let mut q=self.connection.prepare("SELECT id,kind,name,code,active FROM financial_metadata WHERE kind=?1 AND (?2 OR active=1) AND instr(name_key,?3)>0 ORDER BY active DESC,name_key,id LIMIT 100").map_err(|e|e.to_string())?;
        let rows = q
            .query_map(
                params![
                    kind,
                    archived,
                    search
                        .split_whitespace()
                        .collect::<Vec<_>>()
                        .join(" ")
                        .to_lowercase()
                ],
                |r| {
                    Ok(Metadata {
                        id: r.get(0)?,
                        kind: r.get(1)?,
                        name: r.get(2)?,
                        code: r.get(3)?,
                        active: r.get(4)?,
                    })
                },
            )
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
    }
    pub fn save_metadata(&mut self, input: MetadataInput) -> Result<(), String> {
        kind_valid(&input.kind)?;
        let label = name(&input.name)?;
        if let Some(id) = input.id {
            validate_id(id)?;
        }
        if (input.kind == "method"
            && ![
                "cash",
                "pix",
                "debit",
                "credit",
                "boleto",
                "transfer",
                "automatic_debit",
                "other",
            ]
            .contains(&input.code.as_deref().unwrap_or("")))
            || (input.kind != "method" && input.code.is_some())
        {
            return Err("Código do método inválido.".into());
        }
        let tx = self.connection.transaction().map_err(|e| e.to_string())?;
        let duplicate:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM financial_metadata WHERE kind=?1 AND name_key=?2 AND (?3 IS NULL OR id!=?3))",params![input.kind,label.to_lowercase(),input.id],|r|r.get(0)).map_err(|e|e.to_string())?;
        if duplicate {
            return Err("Esse nome já existe, inclusive entre arquivados. Edite ou reative o cadastro existente.".into());
        }
        if let Some(id) = input.id {
            if tx.execute("UPDATE financial_metadata SET name=?1,name_key=?2,code=?3,active=?4,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?5 AND kind=?6",params![label,label.to_lowercase(),input.code,input.active,id,input.kind]).map_err(|e|e.to_string())?!=1{return Err("Cadastro não encontrado.".into());}
        } else {
            tx.execute("INSERT INTO financial_metadata(kind,name,name_key,code,active) VALUES(?1,?2,?3,?4,?5)",params![input.kind,label,label.to_lowercase(),input.code,input.active]).map_err(|e|e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())
    }
}
// Names are resolved within the same transaction as the movement. A failed save
// cannot leave newly created merchants or intermediaries behind.
pub(super) fn resolve(
    c: &Connection,
    kind: &str,
    value: &Option<String>,
    previous: Option<i64>,
) -> Result<Option<i64>, String> {
    let Some(value) = value.as_ref().filter(|s| !s.trim().is_empty()) else {
        return Ok(None);
    };
    let label = name(value)?;
    let found: Option<(i64, bool)> = c
        .query_row(
            "SELECT id,active FROM financial_metadata WHERE kind=?1 AND name_key=?2",
            params![kind, label.to_lowercase()],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some((id, active)) = found {
        if !active && previous != Some(id) {
            return Err("Cadastro arquivado. Reative-o antes de usar em outro lançamento.".into());
        }
        return Ok(Some(id));
    }
    c.execute(
        "INSERT INTO financial_metadata(kind,name,name_key) VALUES(?1,?2,?3)",
        params![kind, label, label.to_lowercase()],
    )
    .map_err(|e| e.to_string())?;
    Ok(Some(c.last_insert_rowid()))
}
pub(super) fn write_details(c: &Connection, id: i64, details: &Details) -> Result<(), String> {
    let previous: (Option<i64>, Option<i64>, Option<i64>) = c
        .query_row(
            "SELECT method_id,merchant_id,intermediary_id FROM transactions WHERE id=?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(|e| e.to_string())?;
    if let Some(method) = details.method_id {
        validate_id(method)?;
        let active: Option<bool> = c
            .query_row(
                "SELECT active FROM financial_metadata WHERE id=?1 AND kind='method'",
                [method],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if active.is_none() || (active == Some(false) && previous.0 != Some(method)) {
            return Err("Método inválido ou arquivado. Reative-o antes de usar.".into());
        }
    }
    if details
        .channel
        .as_deref()
        .is_some_and(|s| !["in_person", "online"].contains(&s))
    {
        return Err("Modalidade inválida.".into());
    }
    let merchant = resolve(c, "merchant", &details.merchant, previous.1)?;
    let intermediary = resolve(c, "intermediary", &details.intermediary, previous.2)?;
    c.execute("UPDATE transactions SET method_id=?1,merchant_id=?2,channel=?3,intermediary_id=?4 WHERE id=?5",params![details.method_id,merchant,details.channel,intermediary,id]).map_err(|e|e.to_string())?;
    Ok(())
}

// Read-only validation for new imported records. Catalog creation remains inside
// the final transaction; preview must never create a merchant or intermediary.
pub(super) fn validate_new_details(c: &Connection, details: &Details) -> Result<(), String> {
    if let Some(id) = details.method_id {
        let valid: bool = c.query_row("SELECT EXISTS(SELECT 1 FROM financial_metadata WHERE id=?1 AND kind='method' AND active=1)", [id], |r| r.get(0)).map_err(|e| e.to_string())?;
        if !valid {
            return Err("Método inválido ou arquivado. Escolha um método ativo na revisão.".into());
        }
    }
    if details
        .channel
        .as_deref()
        .is_some_and(|s| !["in_person", "online"].contains(&s))
    {
        return Err("Modalidade inválida. Escolha Presencial ou Online na revisão.".into());
    }
    for (kind, value) in [
        ("merchant", &details.merchant),
        ("intermediary", &details.intermediary),
    ] {
        if let Some(value) = value.as_ref().filter(|v| !v.trim().is_empty()) {
            let label = name(value)?;
            let archived: bool = c.query_row("SELECT EXISTS(SELECT 1 FROM financial_metadata WHERE kind=?1 AND name_key=?2 AND active=0)", params![kind, label.to_lowercase()], |r| r.get(0)).map_err(|e| e.to_string())?;
            if archived {
                return Err("Cadastro arquivado. Reative-o antes de importar.".into());
            }
        }
    }
    Ok(())
}

pub(super) fn validate_backup(c: &Connection) -> Result<(), String> {
    let mut q = c
        .prepare("SELECT name,name_key FROM financial_metadata")
        .map_err(|e| e.to_string())?;
    let mut rows = q.query([]).map_err(|e| e.to_string())?;
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let label: String = row.get(0).map_err(|e| e.to_string())?;
        let key: String = row.get(1).map_err(|e| e.to_string())?;
        if name(&label)? != label || label.to_lowercase() != key {
            return Err("Nome ou chave de metadado incompatível no backup.".into());
        }
    }
    for (column, kind) in [
        ("method_id", "method"),
        ("merchant_id", "merchant"),
        ("intermediary_id", "intermediary"),
    ] {
        if c.prepare(&format!("SELECT 1 FROM transactions t JOIN financial_metadata m ON m.id=t.{column} WHERE m.kind!=?1")).map_err(|e|e.to_string())?.exists([kind]).map_err(|e|e.to_string())? {return Err("Vínculo de metadado incompatível no backup.".into());}
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::persistence::{transaction_query::TransactionQuery, transactions::Movement};
    fn movement() -> Movement {
        Movement {
            id: None,
            description: "Compra".into(),
            amount: 1050,
            kind: "expense".into(),
            date: "2026-09-13".into(),
            account_id: 1,
            destination_account_id: None,
            category_id: None,
            status: "posted".into(),
            notes: None,
            details: Some(Details {
                method_id: Some(2),
                method_name: None,
                merchant: Some("  Mercado   Árvore ".into()),
                channel: Some("online".into()),
                intermediary: Some("Entrega".into()),
            }),
        }
    }
    #[test]
    fn metadata_is_atomic_reusable_filterable_and_archive_safe() {
        let dir = tempfile::tempdir().unwrap();
        let mut db = Database::open(&dir.path().join("db.sqlite")).unwrap();
        db.connection.execute("INSERT INTO accounts(id,name,type,initial_balance) VALUES(1,'Conta','checking',10000)",[]).unwrap();
        db.write_transaction(movement()).unwrap();
        let mut second = movement();
        second.details.as_mut().unwrap().merchant = Some("mercado árvore".into());
        db.write_transaction(second).unwrap();
        let merchants = db.metadata("merchant", "", true).unwrap();
        assert_eq!(merchants.len(), 1);
        assert_eq!(merchants[0].name, "Mercado Árvore");
        assert_eq!(db.balances().unwrap()[0].cents, "7900");
        let filtered = db
            .query_transactions(TransactionQuery {
                merchant_id: Some(merchants[0].id),
                channel: "online".into(),
                ..Default::default()
            })
            .unwrap();
        assert_eq!(filtered.total, 2);
        db.save_metadata(MetadataInput {
            id: Some(merchants[0].id),
            kind: "merchant".into(),
            name: "Mercado Árvore".into(),
            code: None,
            active: false,
        })
        .unwrap();
        let mut old = filtered.items[0].clone();
        old.description = "Editada".into();
        db.write_transaction(old).unwrap();
        assert!(db.write_transaction(movement()).is_err());
        let mut invalid = movement();
        invalid.details.as_mut().unwrap().merchant = Some("Não deve persistir".into());
        // Internal newline is forbidden; transaction and inline catalog creation roll back.
        invalid.details.as_mut().unwrap().intermediary = Some("inválido\nnome".into());
        assert!(db.write_transaction(invalid).is_err());
        assert!(db
            .metadata("merchant", "Não deve persistir", true)
            .unwrap()
            .is_empty());
        assert_eq!(db.list_transactions().unwrap().len(), 2);
        assert_eq!(db.balances().unwrap()[0].cents, "7900");
        validate_backup(&db.connection).unwrap();
    }
    #[test]
    fn migration_seven_preserves_legacy_and_constraints() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("old.sqlite");
        let mut c = Connection::open(&path).unwrap();
        super::super::migrations::migrate(&mut c, &super::super::migrations::MIGRATIONS[..6])
            .unwrap();
        c.execute_batch("INSERT INTO accounts(id,name,type,initial_balance) VALUES(1,'A','checking',100); INSERT INTO transactions(id,description,amount,type,date,account_id,status) VALUES(1,'Antiga',10,'expense','2026-01-01',1,'posted');").unwrap();
        drop(c);
        let db = Database::open(&path).unwrap();
        assert_eq!(
            db.status().unwrap().0,
            crate::persistence::migrations::MIGRATIONS.len() as i64
        );
        assert_eq!(db.balances().unwrap()[0].cents, "90");
        assert!(db.list_transactions().unwrap()[0]
            .details
            .as_ref()
            .unwrap()
            .method_id
            .is_none());
        assert_eq!(db.metadata("method", "", false).unwrap().len(), 8);
        assert!(db
            .connection
            .execute("UPDATE transactions SET merchant_id=2 WHERE id=1", [])
            .is_err());
        assert!(db
            .connection
            .execute("UPDATE transactions SET channel='fake' WHERE id=1", [])
            .is_err());
    }

    #[test]
    fn edits_clear_or_preserve_details_and_filters_paginate_in_sql() {
        let dir = tempfile::tempdir().unwrap();
        let mut db = Database::open(&dir.path().join("db.sqlite")).unwrap();
        db.connection.execute("INSERT INTO accounts(id,name,type,initial_balance) VALUES(1,'Conta','checking',100000)",[]).unwrap();
        for _ in 0..53 {
            db.write_transaction(movement()).unwrap();
        }
        let merchant = db
            .metadata("merchant", "mercado   ÁRVORE", false)
            .unwrap()
            .remove(0);
        let intermediary = db.metadata("intermediary", "", false).unwrap().remove(0);
        let query = || TransactionQuery {
            method_id: Some(2),
            merchant_id: Some(merchant.id),
            intermediary_id: Some(intermediary.id),
            channel: "online".into(),
            ..Default::default()
        };
        let first = db.query_transactions(query()).unwrap();
        assert_eq!((first.total, first.items.len()), (53, 50));
        assert_eq!(
            db.query_transactions(TransactionQuery { page: 1, ..query() })
                .unwrap()
                .items
                .len(),
            3
        );
        assert_eq!(
            db.query_transactions(TransactionQuery {
                method_id: Some(1),
                ..query()
            })
            .unwrap()
            .total,
            0
        );
        assert!(db
            .query_transactions(TransactionQuery {
                method_id: Some(-1),
                ..query()
            })
            .is_err());
        assert!(db
            .query_transactions(TransactionQuery {
                channel: "invalid".into(),
                ..query()
            })
            .is_err());
        db.save_metadata(MetadataInput {
            id: Some(merchant.id),
            kind: "merchant".into(),
            name: "Renomeado".into(),
            code: None,
            active: true,
        })
        .unwrap();
        assert_eq!(
            db.list_transactions().unwrap()[0]
                .details
                .as_ref()
                .unwrap()
                .merchant
                .as_deref(),
            Some("Renomeado")
        );
        assert!(db
            .save_metadata(MetadataInput {
                id: None,
                kind: "merchant".into(),
                name: " RENOMEADO ".into(),
                code: None,
                active: true
            })
            .is_err());
        let balance = db.balances().unwrap()[0].cents.clone();
        let mut edit = db.list_transactions().unwrap()[0].clone();
        edit.details = None;
        db.write_transaction(edit.clone()).unwrap();
        assert_eq!(
            db.list_transactions().unwrap()[0]
                .details
                .as_ref()
                .unwrap()
                .method_id,
            Some(2)
        );
        edit.details = Some(Details::default());
        db.write_transaction(edit).unwrap();
        assert_eq!(
            db.query_transactions(TransactionQuery {
                channel: "unknown".into(),
                ..Default::default()
            })
            .unwrap()
            .total,
            1
        );
        assert_eq!(db.balances().unwrap()[0].cents, balance);
        db.save_metadata(MetadataInput {
            id: Some(2),
            kind: "method".into(),
            name: "PIX pessoal".into(),
            code: Some("pix".into()),
            active: false,
        })
        .unwrap();
        assert!(db.write_transaction(movement()).is_err());
        let mut old = db.list_transactions().unwrap()[1].clone();
        assert_eq!(
            old.details.as_ref().unwrap().method_name.as_deref(),
            Some("PIX pessoal")
        );
        old.description = "Preservada".into();
        db.write_transaction(old).unwrap();
        let invalid:Details=serde_json::from_str(r#"{"methodId":2,"methodName":"Forged","merchant":null,"channel":null,"intermediary":null}"#).unwrap();
        let mut current = db.list_transactions().unwrap()[1].clone();
        current.details = Some(invalid);
        db.write_transaction(current).unwrap();
        assert_eq!(
            db.list_transactions().unwrap()[1]
                .details
                .as_ref()
                .unwrap()
                .method_name
                .as_deref(),
            Some("PIX pessoal")
        );
    }
    #[test]
    fn backup_roundtrip_preserves_metadata_and_rejects_noncanonical_names() {
        let dir = tempfile::tempdir().unwrap();
        let mut db = Database::open(&dir.path().join("live.sqlite")).unwrap();
        db.connection.execute("INSERT INTO accounts(id,name,type,initial_balance) VALUES(1,'Conta','checking',10000)",[]).unwrap();
        db.write_transaction(movement()).unwrap();
        let merchant = db.metadata("merchant", "", true).unwrap().remove(0);
        db.save_metadata(MetadataInput {
            id: Some(merchant.id),
            kind: "merchant".into(),
            name: merchant.name,
            code: None,
            active: false,
        })
        .unwrap();
        let before = serde_json::to_value(db.list_transactions().unwrap()).unwrap();
        let path = dir.path().join("backup.sqlite");
        db.export_backup(&path).unwrap();
        db.delete_transaction(1).unwrap();
        let preview = db.prepare_restore(&path).unwrap();
        db.confirm_restore(&preview.token, true).unwrap();
        assert_eq!(
            serde_json::to_value(db.list_transactions().unwrap()).unwrap(),
            before
        );
        assert!(!db.metadata("merchant", "", true).unwrap()[0].active);
        assert_eq!(db.balances().unwrap()[0].cents, "8950");
        for (i,sql) in ["UPDATE financial_metadata SET name_key='incorrect' WHERE id=1", "UPDATE financial_metadata SET name='bad'||char(10)||'name',name_key='bad'||char(10)||'name' WHERE id=1"].iter().enumerate() {
            let bad=dir.path().join(format!("bad{i}.sqlite"));std::fs::copy(&path,&bad).unwrap();
            let c=Connection::open(&bad).unwrap();c.execute_batch(sql).unwrap();drop(c);
            assert!(db.prepare_restore(&bad).is_err());
            assert_eq!(serde_json::to_value(db.list_transactions().unwrap()).unwrap(),before);
        }
    }
}
