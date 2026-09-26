use super::{
    planning::{date_valid, occurrence, MAX_OCCURRENCE_INDEX},
    Database,
};
use crate::domain::period::{financial_month, month_bounds, month_index, month_name};
use rusqlite::params;
use serde::Serialize;
#[cfg(test)]
mod tests;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Commitment {
    pub kind: String,
    pub id: i64,
    pub card_id: Option<i64>,
    pub description: String,
    pub date: String,
    pub amount: String,
    pub state: String,
    pub context: String,
    pub planning_class: Option<String>,
    pub installments: i64,
    pub partial: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitmentPage {
    pub items: Vec<Commitment>,
    pub total: usize,
    pub page: usize,
    pub committed: String,
    pub estimated: String,
    pub from: String,
    pub until: String,
}
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
fn key(c: &Commitment) -> (&str, &str, i64) {
    (&c.date, &c.kind, c.id)
}
struct Collected {
    items: Vec<Commitment>,
    total: usize,
    committed: i128,
    estimated: i128,
    limit: usize,
}
impl Collected {
    fn add(&mut self, item: Commitment, amount: i128) {
        self.total += 1;
        if item.kind == "recurrence" {
            self.estimated += amount;
        } else {
            self.committed += amount;
        }
        let index = self
            .items
            .binary_search_by(|c| key(c).cmp(&key(&item)))
            .unwrap_or_else(|i| i);
        if index < self.limit {
            self.items.insert(index, item);
            self.items.truncate(self.limit);
        }
    }
}
impl Database {
    pub fn commitments(
        &self,
        today: &str,
        horizon: &str,
        page: usize,
    ) -> Result<CommitmentPage, String> {
        date_valid(&self.connection, today)?;
        if page > 100_000 {
            return Err("Página de compromissos inválida.".into());
        }
        let snapshot = self.connection.unchecked_transaction().map_err(err)?;
        let (from, until) = self.commitment_bounds(today, horizon)?;
        let mut found = Collected {
            items: Vec::new(),
            total: 0,
            committed: 0,
            estimated: 0,
            limit: (page + 1) * 5,
        };
        if horizon != "next_invoice" {
            let mut query=self.connection.prepare("SELECT t.id,t.description,t.date,t.amount,t.status,a.name,r.planning_class FROM transactions t NOT INDEXED JOIN accounts a ON a.id=t.account_id LEFT JOIN recurrence_templates r ON r.recurrence_id=t.recurrence_id WHERE t.type='expense' AND t.status IN ('pending','scheduled') AND t.date>=?1 AND t.date<?2 ORDER BY t.date,t.id").map_err(err)?;
            let mut rows = query.query(params![from, until]).map_err(err)?;
            while let Some(r) = rows.next().map_err(err)? {
                let amount: i64 = r.get(3).map_err(err)?;
                found.add(
                    Commitment {
                        kind: "transaction".into(),
                        id: r.get(0).map_err(err)?,
                        card_id: None,
                        description: r.get(1).map_err(err)?,
                        date: r.get(2).map_err(err)?,
                        amount: amount.to_string(),
                        state: r.get(4).map_err(err)?,
                        context: r.get(5).map_err(err)?,
                        planning_class: r.get(6).map_err(err)?,
                        installments: 0,
                        partial: false,
                    },
                    i128::from(amount),
                );
            }
            drop(rows);
            drop(query);
        }
        let mut next_cards = std::collections::HashSet::new();
        let mut invoice_totals =
            super::invoice_events::totals_in_period(&self.connection, &from, &until)?;
        let mut query=self.connection.prepare("SELECT i.id,i.card_id,c.name,i.month,i.due_date FROM card_invoices i JOIN credit_cards c ON c.id=i.card_id WHERE i.due_date>=?1 AND i.due_date<?2 ORDER BY i.due_date,i.id").map_err(err)?;
        let mut rows = query.query(params![from, until]).map_err(err)?;
        while let Some(r) = rows.next().map_err(err)? {
            let id = r.get(0).map_err(err)?;
            let card_id: i64 = r.get(1).map_err(err)?;
            if horizon == "next_invoice" && next_cards.contains(&card_id) {
                continue;
            }
            let total = invoice_totals.remove(&id).unwrap_or_default();
            if total.remaining() == 0 {
                continue;
            }
            next_cards.insert(card_id);
            let count = total.installments;
            let date: String = r.get(4).map_err(err)?;
            found.add(
                Commitment {
                    kind: "invoice".into(),
                    id,
                    card_id: Some(r.get(1).map_err(err)?),
                    description: format!("Fatura {}", r.get::<_, String>(2).map_err(err)?),
                    date: date.clone(),
                    amount: total.remaining().to_string(),
                    state: if date.as_str() < today {
                        "overdue"
                    } else {
                        "committed"
                    }
                    .into(),
                    context: format!(
                        "Ciclo {} · {count} parcela(s) já incluída(s)",
                        r.get::<_, String>(3).map_err(err)?
                    ),
                    planning_class: None,
                    installments: count,
                    partial: total.paid > 0,
                },
                total.remaining(),
            );
        }
        drop(rows);
        drop(query);
        // Same anchored calendar and ledger as materialization, without writing
        // future transactions or moving its cursor. Deleted occurrences stay skipped.
        if horizon != "overdue" && horizon != "next_invoice" {
            for r in self
                .list_recurrences()?
                .into_iter()
                .filter(|r| r.active && !r.ended && !r.blocked && r.input.kind == "expense")
            {
                let id = r.input.id.ok_or("Recorrência sem identidade.")?;
                let cursor: i64 = self
                    .connection
                    .query_row(
                        "SELECT next_index FROM recurrence_templates WHERE recurrence_id=?1",
                        [id],
                        |r| r.get(0),
                    )
                    .map_err(err)?;
                let (mut low, mut high) = (cursor, MAX_OCCURRENCE_INDEX);
                while low < high {
                    let mid = (low + high) / 2;
                    if occurrence(&self.connection, &r.input, mid)?
                        .is_some_and(|d| d.as_str() < today || d < from)
                    {
                        low = mid + 1;
                    } else {
                        high = mid;
                    }
                }
                let mut index = low;
                while index <= MAX_OCCURRENCE_INDEX {
                    let Some(date) = occurrence(&self.connection, &r.input, index)? else {
                        break;
                    };
                    if date >= until {
                        break;
                    }
                    let exists:bool=self.connection.query_row("SELECT EXISTS(SELECT 1 FROM recurrence_occurrences WHERE recurrence_id=?1 AND occurrence_date=?2)",params![id,date],|r|r.get(0)).map_err(err)?;
                    if !exists {
                        found.add(Commitment {kind:"recurrence".into(),id,card_id:None,description:r.input.description.clone(),date,amount:r.input.amount.to_string(),state:"estimated".into(),context:"Previsão da recorrência; ainda não gera lançamento nem altera saldo.".into(),planning_class:r.input.planning_class.clone(),installments:0,partial:false},i128::from(r.input.amount));
                    }
                    index += 1;
                }
            }
        }
        let actual_page = page.min(found.total.saturating_sub(1) / 5);
        let result = CommitmentPage {
            items: found
                .items
                .into_iter()
                .skip(actual_page * 5)
                .take(5)
                .collect(),
            total: found.total,
            page: actual_page,
            committed: found.committed.to_string(),
            estimated: found.estimated.to_string(),
            from,
            until,
        };
        snapshot.commit().map_err(err)?;
        Ok(result)
    }
    fn commitment_bounds(&self, today: &str, horizon: &str) -> Result<(String, String), String> {
        match horizon {
            "overdue" => Ok(("0001-01-01".into(), today.into())),
            "next_invoice" => Ok((today.into(), "9999-12-32".into())),
            "week" | "month" | "all" => {
                let until = self
                    .connection
                    .query_row(
                        "SELECT COALESCE(date(?1,?2),'9999-12-32')",
                        params![
                            today,
                            if horizon == "week" {
                                "+8 days"
                            } else {
                                "+31 days"
                            }
                        ],
                        |r| r.get(0),
                    )
                    .map_err(err)?;
                Ok((
                    if horizon == "all" {
                        "0001-01-01".into()
                    } else {
                        today.into()
                    },
                    until,
                ))
            }
            "next_month" => {
                let start = self.settings()?.financial_month_start;
                let current = financial_month(today, start).unwrap_or_else(|| "0001-01".into());
                let index = month_index(&current)?;
                if index == 119987 {
                    return Ok(("9999-12-32".into(), "9999-12-32".into()));
                }
                month_bounds(&month_name(index + 1), start)
            }
            _ => Err("Horizonte inválido.".into()),
        }
    }
}
