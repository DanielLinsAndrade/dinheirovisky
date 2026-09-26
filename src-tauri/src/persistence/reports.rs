use super::Database;
use crate::domain::money::movement_delta;
use crate::domain::period::{financial_month, month_index, month_name};
use crate::domain::validate_id;
use serde::Serialize;
use std::collections::{BTreeMap, HashSet};

#[derive(Default)]
struct Totals {
    income: i128,
    expense: i128,
    transfers: i128,
    payments: i128,
}
impl Totals {
    fn result(&self) -> i128 {
        self.income - self.expense - self.payments
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportMonth {
    pub month: String,
    pub income: String,
    pub expense: String,
    pub result: String,
    pub transfers: String,
    pub invoice_payments: String,
    pub closing_balance: String,
    pub cumulative_savings: String,
    pub result_change: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportCategory {
    pub id: Option<i64>,
    pub name: String,
    pub expense: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub start_date: String,
    pub end_date: String,
    pub account_name: Option<String>,
    pub opening_balance: String,
    pub closing_balance: String,
    pub income: String,
    pub expense: String,
    pub savings: String,
    pub transfers: String,
    pub invoice_payments: String,
    pub movement_count: usize,
    pub months: Vec<ReportMonth>,
    pub categories: Vec<ReportCategory>,
}

impl Database {
    pub fn report(
        &self,
        from: String,
        to: String,
        account_id: Option<i64>,
    ) -> Result<Report, String> {
        let first = month_index(&from)?;
        let last = month_index(&to)?;
        if first > last || last - first >= 120 {
            return Err("Selecione um intervalo ordenado de até 120 meses.".into());
        }
        if let Some(id) = account_id {
            validate_id(id)?;
        }
        let snapshot = self
            .connection
            .unchecked_transaction()
            .map_err(|e| e.to_string())?;
        let accounts = self.list_accounts()?;
        let account_name = if let Some(id) = account_id {
            Some(
                accounts
                    .iter()
                    .find(|a| a.id == id)
                    .ok_or("Conta não encontrada. Atualize os filtros.")?
                    .name
                    .clone(),
            )
        } else {
            None
        };
        let start = self.settings()?.financial_month_start;
        let start_date = format!("{from}-{start:02}");
        let end_date = if last == 119987 {
            "9999-12-31".into()
        } else {
            self.connection
                .query_row(
                    "SELECT date(?1,'-1 day')",
                    [format!("{}-{start:02}", month_name(last + 1))],
                    |r| r.get::<_, String>(0),
                )
                .map_err(|e| e.to_string())?
        };
        let categories = self.list_categories()?;
        let mut opening: i128 = accounts
            .iter()
            .filter(|a| account_id.is_none_or(|id| a.id == id))
            .map(|a| i128::from(a.initial_balance))
            .sum();
        let mut totals: BTreeMap<String, Totals> = ((first - 1).max(0)..=last)
            .map(|i| (month_name(i), Totals::default()))
            .collect();
        let mut category_totals: BTreeMap<Option<i64>, i128> = BTreeMap::new();
        let mut movement_count = 0;
        // Lê apenas campos necessários e movimentos efetivados até o fim do filtro.
        // The all-account opening balance reads almost all history. A date index
        // caused scattered table reads (measured with the 50k acceptance fixture).
        // Keep the identical cash sources and exact i128 aggregation below.
        let cash_source = if account_id.is_none() {
            "(SELECT type,amount,date,account_id,destination_account_id,category_id FROM transactions NOT INDEXED WHERE status='posted'
              UNION ALL SELECT 'invoice_payment',amount,date,account_id,NULL,NULL FROM invoice_events WHERE kind='payment' AND voided=0)"
        } else {
            "cash_movements"
        };
        let mut query=self.connection.prepare(&format!("SELECT type,amount,date,account_id,destination_account_id,category_id FROM {cash_source} WHERE date<=?1 AND (?2 IS NULL OR account_id=?2 OR destination_account_id=?2)")).map_err(|e|e.to_string())?;
        let mut rows = query
            .query(rusqlite::params![end_date, account_id])
            .map_err(|e| e.to_string())?;
        while let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let kind: String = row.get(0).map_err(|e| e.to_string())?;
            let amount: i64 = row.get(1).map_err(|e| e.to_string())?;
            let date: String = row.get(2).map_err(|e| e.to_string())?;
            let source: i64 = row.get(3).map_err(|e| e.to_string())?;
            let destination: Option<i64> = row.get(4).map_err(|e| e.to_string())?;
            let category: Option<i64> = row.get(5).map_err(|e| e.to_string())?;
            let delta = movement_delta(
                &kind,
                "posted",
                amount,
                account_id.is_none_or(|id| id == source),
                destination.is_some_and(|dest| account_id.is_none_or(|id| id == dest)),
            );
            if date < start_date {
                opening += delta;
            } else {
                movement_count += 1;
            }
            if let Some(total) = financial_month(&date, start).and_then(|key| totals.get_mut(&key))
            {
                match kind.as_str() {
                    "income" => total.income += i128::from(amount),
                    "expense" => total.expense += i128::from(amount),
                    "invoice_payment" => total.payments += i128::from(amount),
                    _ => total.transfers += delta,
                }
            }
            if date >= start_date && kind == "expense" {
                *category_totals.entry(category).or_default() += i128::from(amount);
            }
        }
        drop(rows);
        drop(query);
        let (mut balance, mut savings, mut income, mut expense, mut transfers) =
            (opening, 0, 0, 0, 0);
        let mut months = Vec::new();
        for index in first..=last {
            let month = month_name(index);
            let t = &totals[&month];
            balance += t.result() + t.transfers;
            savings += t.result();
            income += t.income;
            expense += t.expense;
            transfers += t.transfers;
            months.push(ReportMonth {
                month,
                income: t.income.to_string(),
                expense: t.expense.to_string(),
                result: t.result().to_string(),
                transfers: t.transfers.to_string(),
                invoice_payments: t.payments.to_string(),
                closing_balance: balance.to_string(),
                cumulative_savings: savings.to_string(),
                result_change: (index > 0)
                    .then(|| (t.result() - totals[&month_name(index - 1)].result()).to_string()),
            });
        }
        let mut ranked: Vec<_> = category_totals.into_iter().collect();
        ranked.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
        let result = Report {
            start_date,
            end_date,
            account_name,
            opening_balance: opening.to_string(),
            closing_balance: balance.to_string(),
            income: income.to_string(),
            expense: expense.to_string(),
            savings: savings.to_string(),
            transfers: transfers.to_string(),
            invoice_payments: (first..=last)
                .map(|i| totals[&month_name(i)].payments)
                .sum::<i128>()
                .to_string(),
            movement_count,
            months,
            categories: ranked
                .into_iter()
                .map(|(id, expense)| {
                    let mut names = Vec::new();
                    let mut current = id;
                    let mut seen = HashSet::new();
                    while let Some(c) =
                        current.and_then(|id| categories.iter().find(|c| c.id == id))
                    {
                        if !seen.insert(c.id) {
                            break;
                        }
                        names.push(c.name.clone());
                        current = c.parent_id;
                    }
                    names.reverse();
                    ReportCategory {
                        id,
                        name: if names.is_empty() {
                            "Sem categoria".into()
                        } else {
                            names.join(" › ")
                        },
                        expense: expense.to_string(),
                    }
                })
                .collect(),
        };
        snapshot.commit().map_err(|e| e.to_string())?;
        Ok(result)
    }
}

#[cfg(test)]
mod tests;
