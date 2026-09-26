use super::Database;
use crate::domain::money::movement_delta;
use crate::domain::{validate_id, MAX_CENTS};
use rusqlite::params;
use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Movement {
    pub id: Option<i64>,
    pub description: String,
    pub amount: i64,
    pub kind: String,
    pub date: String,
    pub account_id: i64,
    pub destination_account_id: Option<i64>,
    pub category_id: Option<i64>,
    pub status: String,
    pub notes: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub details: Option<super::metadata::Details>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Balance {
    pub account_id: i64,
    pub cents: String,
}

pub(super) fn read_matching(
    connection: &rusqlite::Connection,
    suffix: &str,
    values: &[&dyn rusqlite::ToSql],
) -> Result<Vec<Movement>, String> {
    let sql = format!("SELECT id,description,amount,type,date,account_id,destination_account_id,category_id,status,notes,method_id,(SELECT name FROM financial_metadata WHERE id=merchant_id),channel,(SELECT name FROM financial_metadata WHERE id=intermediary_id),(SELECT name FROM financial_metadata WHERE id=method_id) FROM transactions {suffix}");
    let mut query = connection.prepare(&sql).map_err(|e| e.to_string())?;
    let result = query
        .query_map(values, |r| {
            Ok(Movement {
                id: r.get(0)?,
                description: r.get(1)?,
                amount: r.get(2)?,
                kind: r.get(3)?,
                date: r.get(4)?,
                account_id: r.get(5)?,
                destination_account_id: r.get(6)?,
                category_id: r.get(7)?,
                status: r.get(8)?,
                notes: r.get(9)?,
                details: Some(super::metadata::Details {
                    method_id: r.get(10)?,
                    method_name: r.get(14)?,
                    merchant: r.get(11)?,
                    channel: r.get(12)?,
                    intermediary: r.get(13)?,
                }),
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string());
    result
}
fn read_transactions(connection: &rusqlite::Connection) -> Result<Vec<Movement>, String> {
    read_matching(connection, "ORDER BY date DESC,id DESC", &[])
}

impl Database {
    pub fn list_transactions(&self) -> Result<Vec<Movement>, String> {
        read_transactions(&self.connection)
    }

    pub fn balances(&self) -> Result<Vec<Balance>, String> {
        let mut totals: std::collections::BTreeMap<i64, i128> = self
            .list_accounts()?
            .into_iter()
            .map(|a| (a.id, i128::from(a.initial_balance)))
            .collect();
        let mut query = self
            .connection
            .prepare("SELECT type,amount,account_id,destination_account_id FROM cash_movements")
            .map_err(|e| e.to_string())?;
        let mut rows = query.query([]).map_err(|e| e.to_string())?;
        while let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let kind: String = row.get(0).map_err(|e| e.to_string())?;
            let amount: i64 = row.get(1).map_err(|e| e.to_string())?;
            let source: i64 = row.get(2).map_err(|e| e.to_string())?;
            let destination: Option<i64> = row.get(3).map_err(|e| e.to_string())?;
            if let Some(total) = totals.get_mut(&source) {
                *total += movement_delta(&kind, "posted", amount, true, false);
            }
            if let Some(total) = destination.and_then(|id| totals.get_mut(&id)) {
                *total += movement_delta(&kind, "posted", amount, false, true);
            }
        }
        Ok(totals
            .into_iter()
            .map(|(account_id, total)| Balance {
                account_id,
                cents: total.to_string(),
            })
            .collect())
    }

    pub(super) fn validate_movement(&self, input: &mut Movement) -> Result<(), String> {
        self.validate_movement_with_catalog(input, &self.list_accounts()?, &self.list_categories()?)
    }

    pub(super) fn validate_movement_with_catalog(
        &self,
        input: &mut Movement,
        accounts: &[crate::domain::Account],
        categories: &[crate::domain::Category],
    ) -> Result<(), String> {
        input.description = input.description.trim().to_owned();
        if input.description.is_empty()
            || input.description.chars().count() > 240
            || input.description.chars().any(char::is_control)
        {
            return Err("Informe uma descrição de 1 a 240 caracteres.".into());
        }
        if !(1..=MAX_CENTS).contains(&input.amount) {
            return Err("O valor deve ser positivo e estar dentro do limite monetário.".into());
        }
        validate_id(input.account_id)?;
        for id in [input.id, input.destination_account_id, input.category_id]
            .into_iter()
            .flatten()
        {
            validate_id(id)?;
        }
        if !["income", "expense", "transfer"].contains(&input.kind.as_str())
            || !["posted", "pending", "scheduled"].contains(&input.status.as_str())
        {
            return Err("Tipo ou situação inválida.".into());
        }
        let valid_date: bool = self.connection.query_row("SELECT length(?1)=10 AND ?1 GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(?1,'+0 days') IS ?1 AND substr(?1,1,4) != '0000'", [&input.date], |r| r.get(0)).map_err(|e|e.to_string())?;
        if !valid_date {
            return Err("Informe uma data válida.".into());
        }
        if input
            .notes
            .as_ref()
            .is_some_and(|s| s.chars().count() > 4000)
        {
            return Err("Observações devem ter até 4000 caracteres.".into());
        }
        if (input.kind == "transfer"
            && (input.destination_account_id.is_none()
                || input.destination_account_id == Some(input.account_id)
                || input.category_id.is_some()))
            || (input.kind != "transfer" && input.destination_account_id.is_some())
        {
            return Err("Transferência exige duas contas diferentes e não usa categoria.".into());
        }
        let previous = if input.id.is_some() {
            read_matching(&self.connection, "WHERE id=?1", &[&input.id])?
                .into_iter()
                .next()
        } else {
            None
        };
        if input.id.is_some() && previous.is_none() {
            return Err("Transação não encontrada. Atualize a lista.".into());
        }
        for id in [Some(input.account_id), input.destination_account_id]
            .into_iter()
            .flatten()
        {
            let account = accounts
                .iter()
                .find(|a| a.id == id)
                .ok_or("Conta não encontrada.")?;
            let retained = previous
                .as_ref()
                .is_some_and(|m| m.account_id == id || m.destination_account_id == Some(id));
            if !account.active && !retained {
                return Err("Reative a conta antes de usá-la em um novo lançamento.".into());
            }
        }
        if let Some(id) = input.category_id {
            let category = categories
                .iter()
                .find(|c| c.id == id)
                .ok_or("Categoria não encontrada.")?;
            if category.kind != input.kind {
                return Err("A categoria deve ter o mesmo tipo do lançamento.".into());
            }
            if !category.active && !previous.as_ref().is_some_and(|m| m.category_id == Some(id)) {
                return Err("Reative a categoria antes de usá-la.".into());
            }
        }
        Ok(())
    }

    pub fn save_transaction(&mut self, input: Movement) -> Result<Vec<Movement>, String> {
        self.write_transaction(input)?;
        self.list_transactions()
    }
    pub fn write_transaction(&mut self, mut input: Movement) -> Result<(), String> {
        self.validate_movement(&mut input)?;
        let tx = self.connection.transaction().map_err(|e| e.to_string())?;
        let values = params![
            input.description,
            input.amount,
            input.kind,
            input.date,
            input.account_id,
            input.destination_account_id,
            input.category_id,
            input.status,
            input.notes,
            input.id
        ];
        if input.id.is_some() {
            tx.execute("UPDATE transactions SET description=?1,amount=?2,type=?3,date=?4,account_id=?5,destination_account_id=?6,category_id=?7,status=?8,notes=?9,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?10",values)
        } else {
            tx.execute("INSERT INTO transactions(description,amount,type,date,account_id,destination_account_id,category_id,status,notes,id) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",values)
        }.map_err(|e|e.to_string())?;
        if let Some(details) = &input.details {
            let id = input.id.unwrap_or_else(|| tx.last_insert_rowid());
            super::metadata::write_details(&tx, id, details)?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete_transaction(&mut self, id: i64) -> Result<Vec<Movement>, String> {
        self.remove_transaction(id)?;
        self.list_transactions()
    }
    pub fn remove_transaction(&mut self, id: i64) -> Result<(), String> {
        validate_id(id)?;
        let tx = self.connection.transaction().map_err(|e| e.to_string())?;
        if tx
            .execute("DELETE FROM transactions WHERE id=?1", [id])
            .map_err(|e| e.to_string())?
            != 1
        {
            return Err("Transação não encontrada. Atualize a lista.".into());
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    }
}
