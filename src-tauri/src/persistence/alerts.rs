use super::{planning::date_valid, Database};
use crate::domain::period::{financial_month, month_bounds, month_index, month_name};
use rusqlite::params;
use serde::Serialize;
#[cfg(test)]
mod tests;
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlertOrigin {
    pub kind: String,
    pub id: Option<i64>,
    pub card_id: Option<i64>,
    pub month: Option<String>,
    pub comparison_month: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinancialAlert {
    pub key: String,
    pub severity: String,
    pub title: String,
    pub reason: String,
    pub date: String,
    pub amount: String,
    pub reference: Option<String>,
    pub origin: AlertOrigin,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlertPage {
    pub items: Vec<FinancialAlert>,
    pub total: usize,
    pub page: usize,
    pub month: String,
    pub comparison_month: Option<String>,
}
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
fn key(a: &FinancialAlert) -> (u8, &str, &str) {
    (if a.severity == "danger" { 0 } else { 1 }, &a.date, &a.key)
}
fn keep(items: &mut Vec<FinancialAlert>, total: &mut usize, limit: usize, item: FinancialAlert) {
    *total += 1;
    let index = items
        .binary_search_by(|a| key(a).cmp(&key(&item)))
        .unwrap_or_else(|i| i);
    if index < limit {
        items.insert(index, item);
        items.truncate(limit);
    }
}
impl Database {
    pub fn financial_alerts(
        &self,
        today: &str,
        comparison: Option<String>,
        page: usize,
    ) -> Result<AlertPage, String> {
        date_valid(&self.connection, today)?;
        if page > 100_000 {
            return Err("Página inválida.".into());
        }
        let snapshot = self.connection.unchecked_transaction().map_err(err)?;
        let start = self.settings()?.financial_month_start;
        let month = financial_month(today, start).unwrap_or_else(|| "0001-01".into());
        let index = month_index(&month)?;
        let comparison = match comparison {
            Some(value) => {
                if month_index(&value)? >= index {
                    return Err("Compare com um mês financeiro anterior ao atual.".into());
                }
                Some(value)
            }
            None => (index > 0).then(|| month_name(index - 1)),
        };
        let mut items = Vec::new();
        let mut total = 0;
        let limit = (page + 1) * 5;
        let mut add = |item| keep(&mut items, &mut total, limit, item);
        let mut query=self.connection.prepare("SELECT id,description,date,amount FROM transactions NOT INDEXED WHERE type='expense' AND status IN ('pending','scheduled') AND date<?1 ORDER BY date,id").map_err(err)?;
        let mut rows = query.query([today]).map_err(err)?;
        while let Some(r) = rows.next().map_err(err)? {
            let id: i64 = r.get(0).map_err(err)?;
            add(FinancialAlert {
                key: format!("overdue:{id}"),
                severity: "danger".into(),
                title: "Despesa vencida".into(),
                reason: format!(
                    "{} continua pendente/programada após a data informada.",
                    r.get::<_, String>(1).map_err(err)?
                ),
                date: r.get(2).map_err(err)?,
                amount: r.get::<_, i64>(3).map_err(err)?.to_string(),
                reference: None,
                origin: AlertOrigin {
                    kind: "transaction".into(),
                    id: Some(id),
                    card_id: None,
                    month: None,
                    comparison_month: None,
                },
            });
        }
        drop(rows);
        drop(query);
        let week_end: String = self
            .connection
            .query_row(
                "SELECT COALESCE(date(?1,'+7 days'),'9999-12-31')",
                [today],
                |r| r.get(0),
            )
            .map_err(err)?;
        let next_end = if index == 119987 {
            "9999-12-32".into()
        } else {
            month_bounds(&month_name(index + 1), start)?.1
        };
        let mut invoice_totals =
            super::invoice_events::totals_in_period(&self.connection, "0001-01-01", &next_end)?;
        let mut query=self.connection.prepare("SELECT i.id,i.card_id,c.name,i.due_date,c.credit_limit FROM card_invoices i JOIN credit_cards c ON c.id=i.card_id WHERE i.due_date<?1 ORDER BY i.due_date,i.id").map_err(err)?;
        let mut rows = query.query([next_end]).map_err(err)?;
        while let Some(r) = rows.next().map_err(err)? {
            let id: i64 = r.get(0).map_err(err)?;
            let amounts = invoice_totals.remove(&id).unwrap_or_default();
            let remaining = amounts.remaining();
            if remaining == 0 {
                continue;
            }
            let date: String = r.get(3).map_err(err)?;
            let credit_limit: i64 = r.get(4).map_err(err)?;
            let due = date <= week_end;
            let count = amounts.installments;
            let significant = count > 0 && remaining * 100 >= i128::from(credit_limit) * 30;
            if !due && !significant {
                continue;
            }
            let title = if date.as_str() < today {
                "Fatura vencida"
            } else if due && amounts.paid > 0 {
                "Pagamento parcial perto do vencimento"
            } else if due {
                "Fatura vence nos próximos 7 dias"
            } else {
                "Compromisso relevante em fatura futura"
            };
            let name: String = r.get(2).map_err(err)?;
            add(FinancialAlert {
                key: format!("invoice:{id}"),
                severity: if date.as_str() < today {
                    "danger"
                } else {
                    "warning"
                }
                .into(),
                title: title.into(),
                reason: if due {
                    format!("{name}: ainda há saldo a pagar. Pagamentos já registrados foram descontados; parcelas não são somadas novamente.")
                } else {
                    format!("{name}: a fatura tem {count} parcela(s) e saldo a pagar de pelo menos 30% do limite cadastrado. Valores já gastos, não previsão de nova despesa.")
                },
                date,
                amount: remaining.to_string(),
                reference: (!due).then(|| credit_limit.to_string()),
                origin: AlertOrigin {
                    kind: "invoice".into(),
                    id: Some(id),
                    card_id: Some(r.get(1).map_err(err)?),
                    month: None,
                    comparison_month: None,
                },
            });
        }
        drop(rows);
        drop(query);
        for budget in self.budgets(month.clone())? {
            if budget.state == "within" {
                continue;
            }
            add(FinancialAlert {key:format!("budget:{}",budget.category_id),severity:if budget.state=="exceeded" {"danger"}else{"warning"}.into(),title:if budget.state=="exceeded" {"Orçamento acima do limite"}else{"Orçamento próximo do limite"}.into(),reason:format!("{}: consumo do mês financeiro {} atingiu pelo menos 90% do limite ou o excedeu. Estornos e compras seguem a visão de consumo.",budget.name,month),date:format!("{month}-{start:02}"),amount:budget.spent,reference:Some(budget.limit_amount.to_string()),origin:AlertOrigin {kind:"budget".into(),id:Some(budget.category_id),card_id:None,month:Some(month.clone()),comparison_month:None}});
        }
        if let Some(previous) = &comparison {
            let expense = |month: &str| -> Result<i128, String> {
                let (from, to) = month_bounds(month, start)?;
                let mut q=self.connection.prepare("SELECT amount FROM economic_movements WHERE type='expense' AND date>=?1 AND date<?2").map_err(err)?;
                let mut total = 0i128;
                for amount in q
                    .query_map(params![from, to], |r| r.get::<_, i64>(0))
                    .map_err(err)?
                {
                    total += i128::from(amount.map_err(err)?);
                }
                Ok(total)
            };
            let current = expense(&month)?;
            let before = expense(previous)?;
            if current > before {
                add(FinancialAlert {key:"expense-comparison".into(),severity:"warning".into(),title:"Consumo acima do mês comparado".into(),reason:format!("Despesas econômicas registradas em {month} superam {previous}. São meses financeiros completos; o mês atual pode estar em andamento. Pagamento de fatura não é nova despesa."),date:format!("{month}-{start:02}"),amount:current.to_string(),reference:Some(before.to_string()),origin:AlertOrigin {kind:"report".into(),id:None,card_id:None,month:Some(month.clone()),comparison_month:Some(previous.clone())}});
            }
        }
        let page = page.min(total.saturating_sub(1) / 5);
        let result = AlertPage {
            items: items.into_iter().skip(page * 5).take(5).collect(),
            total,
            page,
            month,
            comparison_month: comparison,
        };
        snapshot.commit().map_err(err)?;
        Ok(result)
    }
}
