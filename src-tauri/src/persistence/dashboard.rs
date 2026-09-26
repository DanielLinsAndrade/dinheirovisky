use super::{transactions::Movement, Database};
use crate::domain::period::{financial_month, month_bounds, month_index, month_name};
use serde::Serialize;
use std::collections::BTreeMap;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuePayment {
    pub id: i64,
    pub description: String,
    pub date: String,
    pub amount: i64,
    pub account_name: String,
    pub status: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuePaymentPage {
    pub items: Vec<DuePayment>,
    pub total: i64,
    pub page: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonthTotals {
    pub month: String,
    pub income: String,
    pub expense: String,
    pub result: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryTotal {
    pub name: String,
    pub cents: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentMovement {
    pub movement: Movement,
    pub account_name: String,
    pub destination_name: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Dashboard {
    pub balance: String,
    pub active_accounts: usize,
    pub current: MonthTotals,
    pub previous: Option<MonthTotals>,
    pub result_change: Option<String>,
    pub trend: Vec<MonthTotals>,
    pub categories: Vec<CategoryTotal>,
    pub recent: Vec<RecentMovement>,
}

impl Database {
    pub fn due_payment_page(
        &self,
        today: &str,
        horizon: &str,
        page: i64,
    ) -> Result<DuePaymentPage, String> {
        super::planning::date_valid(&self.connection, today)?;
        if page < 0 {
            return Err("Página inválida.".into());
        }
        let (from, until): (String, String) = match horizon {
            "overdue" => ("0001-01-01".into(), today.into()),
            "week" | "month" | "all" => {
                let days = if horizon == "week" {
                    "+8 days"
                } else {
                    "+31 days"
                };
                let end = self
                    .connection
                    .query_row(
                        "SELECT COALESCE(date(?1,?2),'9999-12-32')",
                        rusqlite::params![today, days],
                        |r| r.get(0),
                    )
                    .map_err(|e| e.to_string())?;
                (
                    if horizon == "all" {
                        "0001-01-01".into()
                    } else {
                        today.into()
                    },
                    end,
                )
            }
            _ => return Err("Horizonte inválido.".into()),
        };
        let snapshot = self
            .connection
            .unchecked_transaction()
            .map_err(|e| e.to_string())?;
        // O índice de data causa leituras dispersas de quase todo o histórico no
        // horizonte de vencidos. A varredura sequencial foi medida no cenário 50k;
        // filtros e LIMIT continuam no SQLite, sem carregar o histórico no React.
        let predicate = "FROM transactions t NOT INDEXED JOIN accounts a ON a.id=t.account_id WHERE t.type='expense' AND t.status IN ('pending','scheduled') AND t.date>=?1 AND t.date<?2";
        let total: i64 = self
            .connection
            .query_row(
                &format!("SELECT COUNT(*) {predicate}"),
                rusqlite::params![from, until],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        let page = page.min((total.saturating_sub(1) / 5).max(0));
        let items = self.connection.prepare(&format!("SELECT t.id,t.description,t.date,t.amount,a.name,t.status {predicate} ORDER BY t.date,t.id LIMIT 5 OFFSET ?3"))
            .map_err(|e|e.to_string())?
            .query_map(rusqlite::params![from,until,page*5], |r| Ok(DuePayment { id:r.get(0)?,description:r.get(1)?,date:r.get(2)?,amount:r.get(3)?,account_name:r.get(4)?,status:r.get(5)? }))
            .map_err(|e|e.to_string())?.collect::<Result<_,_>>().map_err(|e|e.to_string())?;
        snapshot.commit().map_err(|e| e.to_string())?;
        Ok(DuePaymentPage { items, total, page })
    }

    pub fn due_payments(&self, today: &str) -> Result<Vec<DuePayment>, String> {
        super::planning::date_valid(&self.connection, today)?;
        // Consulta somente despesas reais em aberto; não materializa séries.
        // COALESCE mantém o limite válido na extremidade do calendário (9999).
        self.connection.prepare("SELECT t.id,t.description,t.date,t.amount,a.name,t.status FROM transactions t JOIN accounts a ON a.id=t.account_id WHERE t.type='expense' AND t.status IN ('pending','scheduled') AND t.date<=COALESCE(date(?1,'+30 days'),'9999-12-31') ORDER BY t.date,t.id")
            .map_err(|e|e.to_string())?
            .query_map([today], |r| Ok(DuePayment { id:r.get(0)?,description:r.get(1)?,date:r.get(2)?,amount:r.get(3)?,account_name:r.get(4)?,status:r.get(5)? }))
            .map_err(|e|e.to_string())?.collect::<Result<_,_>>().map_err(|e|e.to_string())
    }

    pub fn dashboard(&self, month: String) -> Result<Dashboard, String> {
        let index = month_index(&month)?;
        // One SQLite read snapshot keeps accounts, movements and labels consistent.
        let snapshot = self
            .connection
            .unchecked_transaction()
            .map_err(|e| e.to_string())?;
        let accounts = self.list_accounts()?;
        let start = self.settings()?.financial_month_start;
        let categories = self.list_categories()?;
        let active: std::collections::HashSet<i64> =
            accounts.iter().filter(|a| a.active).map(|a| a.id).collect();
        let balances = self.balances()?;
        let (from, _) = month_bounds(&month_name(index.saturating_sub(5).max(0)), start)?;
        let (_, until) = month_bounds(&month, start)?;
        let mut query=self.connection.prepare("SELECT amount,type,date,category_id FROM economic_movements WHERE date>=?1 AND date<?2").map_err(|e|e.to_string())?;
        let mut movements = query
            .query(rusqlite::params![from, until])
            .map_err(|e| e.to_string())?;
        let mut totals: BTreeMap<String, (i128, i128)> = (index.saturating_sub(5).max(0)..=index)
            .map(|i| (month_name(i), (0, 0)))
            .collect();
        let mut category_totals: BTreeMap<Option<i64>, i128> = BTreeMap::new();
        while let Some(row) = movements.next().map_err(|e| e.to_string())? {
            let amount: i64 = row.get(0).map_err(|e| e.to_string())?;
            let kind: String = row.get(1).map_err(|e| e.to_string())?;
            let date: String = row.get(2).map_err(|e| e.to_string())?;
            let category_id: Option<i64> = row.get(3).map_err(|e| e.to_string())?;
            if let Some((income, expense)) =
                financial_month(&date, start).and_then(|key| totals.get_mut(&key))
            {
                if kind == "income" {
                    *income += i128::from(amount);
                } else {
                    *expense += i128::from(amount);
                }
            }
            if kind == "expense" && financial_month(&date, start).as_deref() == Some(&month) {
                *category_totals.entry(category_id).or_default() += i128::from(amount);
            }
        }
        let make_total = |key: String| {
            let (income, expense) = totals.get(&key).copied().unwrap_or_default();
            MonthTotals {
                month: key,
                income: income.to_string(),
                expense: expense.to_string(),
                result: (income - expense).to_string(),
            }
        };
        let current = make_total(month.clone());
        let previous = (index > 0).then(|| make_total(month_name(index - 1)));
        let result_change = previous.as_ref().map(|p| {
            let (income, expense) = totals[&month];
            let (old_income, old_expense) = totals[&p.month];
            (income - expense - old_income + old_expense).to_string()
        });
        let mut ranked: Vec<_> = category_totals.into_iter().collect();
        ranked.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
        let category_path = |id: Option<i64>| {
            let mut names = Vec::new();
            let mut current = id;
            let mut visited = std::collections::HashSet::new();
            while let Some(c) = current.and_then(|id| categories.iter().find(|c| c.id == id)) {
                if !visited.insert(c.id) {
                    break;
                }
                names.push(c.name.clone());
                current = c.parent_id;
            }
            names.reverse();
            if names.is_empty() {
                "Sem categoria".to_owned()
            } else {
                names.join(" › ")
            }
        };
        let (from, until) = month_bounds(&month, start)?;
        let recent_rows = super::transactions::read_matching(
            &self.connection,
            "WHERE date>=?1 AND date<?2 ORDER BY date DESC,id DESC LIMIT 6",
            &[&from, &until],
        )?;
        let recent = recent_rows
            .iter()
            .map(|m| RecentMovement {
                movement: m.clone(),
                account_name: accounts
                    .iter()
                    .find(|a| a.id == m.account_id)
                    .map(|a| a.name.clone())
                    .unwrap_or_default(),
                destination_name: m
                    .destination_account_id
                    .and_then(|id| accounts.iter().find(|a| a.id == id).map(|a| a.name.clone())),
            })
            .collect();
        let result = Dashboard {
            balance: balances
                .iter()
                .filter(|b| active.contains(&b.account_id))
                .map(|b| b.cents.parse::<i128>().expect("integer balance"))
                .sum::<i128>()
                .to_string(),
            active_accounts: active.len(),
            current,
            previous,
            result_change,
            trend: totals.keys().map(|key| make_total(key.clone())).collect(),
            categories: ranked
                .into_iter()
                .take(5)
                .map(|(id, cents)| CategoryTotal {
                    name: category_path(id),
                    cents: cents.to_string(),
                })
                .collect(),
            recent,
        };
        snapshot.commit().map_err(|e| e.to_string())?;
        Ok(result)
    }
}
