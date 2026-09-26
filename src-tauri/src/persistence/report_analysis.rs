use super::Database;
use crate::domain::{
    period::{financial_month, month_bounds, month_index, month_name},
    validate_id,
};
use rusqlite::{named_params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
#[cfg(test)]
mod tests;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnalysisFilter {
    pub from: String,
    pub to: String,
    pub view: String,
    pub group_by: String,
    pub account_id: Option<i64>,
    pub card_id: Option<i64>,
    pub invoice_id: Option<i64>,
    pub category_id: Option<i64>,
    pub merchant_id: Option<i64>,
    pub method: Option<String>,
    pub channel: Option<String>,
    pub recurrence: Option<String>,
    pub planning_class: Option<String>,
    pub comparison_from: Option<String>,
    #[serde(default)]
    pub page: usize,
}
#[derive(Default)]
struct Sum {
    income: i128,
    expense: i128,
    payments: i128,
    transfers: i128,
    installments: i128,
    count: usize,
}
impl Sum {
    fn add(&mut self, kind: &str, amount: i128, transfer: i128) {
        self.count += 1;
        match kind {
            "income" => self.income += amount,
            "expense" => self.expense += amount,
            "payment" => self.payments += amount,
            "installment" => self.installments += amount,
            "transfer" => self.transfers += transfer,
            _ => unreachable!("Only authoritative source kinds"),
        }
    }
    fn output(&self) -> AnalysisTotals {
        AnalysisTotals {
            income: self.income.to_string(),
            expense: self.expense.to_string(),
            payments: self.payments.to_string(),
            transfers: self.transfers.to_string(),
            installments: self.installments.to_string(),
            result: (self.income - self.expense - self.payments + self.transfers).to_string(),
            count: self.count,
        }
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisTotals {
    pub income: String,
    pub expense: String,
    pub payments: String,
    pub transfers: String,
    pub installments: String,
    pub result: String,
    pub count: usize,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisGroup {
    pub key: String,
    pub name: String,
    pub totals: AnalysisTotals,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisMonth {
    pub month: String,
    pub totals: AnalysisTotals,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisReport {
    pub view: String,
    pub start_date: String,
    pub until_date: String,
    pub totals: AnalysisTotals,
    pub comparison_from: Option<String>,
    pub comparison_to: Option<String>,
    pub comparison: Option<AnalysisTotals>,
    pub months: Vec<AnalysisMonth>,
    pub groups: Vec<AnalysisGroup>,
    pub group_count: usize,
    pub page: usize,
}
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

// Same economic/cash sources as the normative views. Extra columns retain
// metadata for filtering; no installment is joined to multiply a purchase.
const TRANSACTIONS: &str = "SELECT t.type kind,t.amount,t.date,t.account_id,t.destination_account_id,t.category_id,m.code method,NULL card_id,NULL invoice_id,NULL purchase_id,t.merchant_id,t.channel,t.recurrence_id,r.planning_class FROM transactions t NOT INDEXED LEFT JOIN financial_metadata m ON m.id=t.method_id LEFT JOIN recurrence_templates r ON r.recurrence_id=t.recurrence_id WHERE t.status='posted'";
const PURCHASES: &str = "SELECT 'expense',p.amount,p.date,NULL,NULL,p.category_id,'credit',p.card_id,NULL,p.id,p.merchant_id,p.channel,NULL,NULL FROM card_purchases p WHERE p.status='active'";
const ECONOMIC_EVENTS: &str = "SELECT 'expense',CASE WHEN e.kind='charge' THEN e.amount ELSE -e.amount END,e.date,NULL,NULL,p.category_id,'credit',i.card_id,e.invoice_id,e.purchase_id,p.merchant_id,p.channel,NULL,NULL FROM invoice_events e JOIN card_invoices i ON i.id=e.invoice_id LEFT JOIN card_purchases p ON p.id=e.purchase_id WHERE e.voided=0 AND e.kind!='payment'";
const PAYMENTS: &str = "SELECT 'payment',e.amount,e.date,e.account_id,NULL,NULL,NULL,i.card_id,e.invoice_id,NULL,NULL,NULL,NULL,NULL FROM invoice_events e JOIN card_invoices i ON i.id=e.invoice_id WHERE e.voided=0 AND e.kind='payment'";
const INSTALLMENTS: &str = "SELECT 'installment' kind,s.amount,i.due_date date,NULL account_id,NULL destination_account_id,p.category_id,'credit' method,p.card_id,s.invoice_id,p.id purchase_id,p.merchant_id,p.channel,NULL recurrence_id,NULL planning_class FROM card_installments s JOIN card_purchases p ON p.id=s.purchase_id JOIN card_invoices i ON i.id=s.invoice_id WHERE p.status='active'";
impl Database {
    pub fn report_analysis(&self, f: AnalysisFilter) -> Result<AnalysisReport, String> {
        let first = month_index(&f.from)?;
        let last = month_index(&f.to)?;
        if first > last || last - first >= 120 || f.page > 100_000 {
            return Err("Selecione até 120 meses ordenados e uma página válida.".into());
        }
        if !["consumption", "cash", "installments"].contains(&f.view.as_str()) {
            return Err("Visão de relatório inválida.".into());
        }
        let (group_key,group_name)= match f.group_by.as_str() {
            "method" => ("COALESCE(x.method,'none')","COALESCE(x.method,'Não informado')"),
            "card" => ("COALESCE(CAST(x.card_id AS TEXT),'none')","COALESCE((SELECT name FROM credit_cards WHERE id=x.card_id),'Sem cartão')"),
            "invoice" if f.view!="consumption" => ("COALESCE(CAST(x.invoice_id AS TEXT),'none')","COALESCE((SELECT c.name||' · '||i.month FROM card_invoices i JOIN credit_cards c ON c.id=i.card_id WHERE i.id=x.invoice_id),'Sem fatura')"),
            "merchant" => ("COALESCE(CAST(x.merchant_id AS TEXT),'none')","COALESCE((SELECT name FROM financial_metadata WHERE id=x.merchant_id),'Sem estabelecimento')"),
            "channel" => ("COALESCE(x.channel,'none')","COALESCE(x.channel,'Não informada')"),
            "classification" => ("COALESCE(x.planning_class,'none')","COALESCE(x.planning_class,'Sem classificação')"),
            "recurrence" => ("COALESCE(CAST(x.recurrence_id AS TEXT),'none')","COALESCE((SELECT description FROM recurrence_templates WHERE recurrence_id=x.recurrence_id),'Sem recorrência')"),
            "category" => ("COALESCE(CAST(x.category_id AS TEXT),'none')","COALESCE((SELECT name FROM categories WHERE id=x.category_id),'Sem categoria')"),
            _=>return Err("Agrupamento inválido. Consumo não é repartido entre faturas; use cartão ou a visão de parcelas.".into()),
        };
        if f.method.as_deref().is_some_and(|s| {
            ![
                "cash",
                "pix",
                "debit",
                "credit",
                "boleto",
                "transfer",
                "automatic_debit",
                "other",
                "none",
            ]
            .contains(&s)
        }) || f
            .channel
            .as_deref()
            .is_some_and(|s| !["online", "in_person", "none"].contains(&s))
            || f.recurrence
                .as_deref()
                .is_some_and(|s| !["yes", "no"].contains(&s))
            || f.planning_class
                .as_deref()
                .is_some_and(|s| !["fixed", "seasonal", "none"].contains(&s))
        {
            return Err("Filtro de metadados inválido.".into());
        }
        let snapshot = self.connection.unchecked_transaction().map_err(err)?;
        for (table, id) in [
            ("accounts", f.account_id),
            ("credit_cards", f.card_id),
            ("card_invoices", f.invoice_id),
            ("categories", f.category_id),
            ("financial_metadata", f.merchant_id),
        ] {
            if let Some(id) = id {
                validate_id(id)?;
                let clause = if table == "financial_metadata" {
                    " AND kind='merchant'"
                } else {
                    ""
                };
                let found = self
                    .connection
                    .query_row(
                        &format!("SELECT 1 FROM {table} WHERE id=?1{clause}"),
                        [id],
                        |r| r.get::<_, i64>(0),
                    )
                    .optional()
                    .map_err(err)?;
                if found.is_none() {
                    return Err("Registro do filtro não encontrado. Atualize os filtros.".into());
                }
            }
        }
        if let (Some(card), Some(invoice)) = (f.card_id, f.invoice_id) {
            let owner: i64 = self
                .connection
                .query_row(
                    "SELECT card_id FROM card_invoices WHERE id=?1",
                    [invoice],
                    |r| r.get(0),
                )
                .map_err(err)?;
            if owner != card {
                return Err("Fatura não pertence ao cartão selecionado.".into());
            }
        }
        let start = self.settings()?.financial_month_start;
        let (from, _) = month_bounds(&f.from, start)?;
        let (_, until) = month_bounds(&f.to, start)?;
        let length = last - first + 1;
        let comparison_first = match &f.comparison_from {
            Some(s) => Some(month_index(s)?),
            None => (first >= length).then_some(first - length),
        };
        if comparison_first.is_some_and(|n| n + length > first) {
            return Err("A comparação deve terminar antes do período principal.".into());
        }
        let comparison_from = comparison_first.map(month_name);
        let comparison_to = comparison_first.map(|n| month_name(n + length - 1));
        let comparison_bounds = match (&comparison_from, &comparison_to) {
            (Some(a), Some(b)) => (
                Some(month_bounds(a, start)?.0),
                Some(month_bounds(b, start)?.1),
            ),
            _ => (None, None),
        };
        let source=match f.view.as_str() {
            "consumption"=>format!("{TRANSACTIONS} AND t.type IN ('income','expense') UNION ALL {PURCHASES} UNION ALL {ECONOMIC_EVENTS}"),
            "cash"=>format!("{TRANSACTIONS} UNION ALL {PAYMENTS}"),
            _=>INSTALLMENTS.into(),
        };
        let sql=format!("WITH x AS ({source}) SELECT x.kind,x.amount,x.date,x.account_id,x.destination_account_id,{group_key},{group_name} FROM x
          WHERE ((x.date>=:from AND x.date<:until) OR (:compare_from IS NOT NULL AND x.date>=:compare_from AND x.date<:compare_until))
          AND (:account IS NULL OR x.account_id=:account OR x.destination_account_id=:account)
          AND (:card IS NULL OR x.card_id=:card)
          AND (:invoice IS NULL OR x.invoice_id=:invoice OR (x.kind='expense' AND x.invoice_id IS NULL AND EXISTS(SELECT 1 FROM card_installments s WHERE s.purchase_id=x.purchase_id AND s.invoice_id=:invoice)))
          AND (:category IS NULL OR x.category_id=:category)
          AND (:merchant IS NULL OR x.merchant_id=:merchant)
          AND (:method IS NULL OR COALESCE(x.method,'none')=:method)
          AND (:channel IS NULL OR COALESCE(x.channel,'none')=:channel)
          AND (:class IS NULL OR COALESCE(x.planning_class,'none')=:class)
          AND (:recurrence IS NULL OR (:recurrence='yes' AND x.recurrence_id IS NOT NULL) OR (:recurrence='no' AND x.recurrence_id IS NULL))");
        let mut q = self.connection.prepare(&sql).map_err(err)?;
        let mut rows=q.query(named_params!{":from":from,":until":until,":compare_from":comparison_bounds.0,":compare_until":comparison_bounds.1,":account":f.account_id,":card":f.card_id,":invoice":f.invoice_id,":category":f.category_id,":merchant":f.merchant_id,":method":f.method,":channel":f.channel,":class":f.planning_class,":recurrence":f.recurrence}).map_err(err)?;
        let mut total = Sum::default();
        let mut comparison = Sum::default();
        let mut months: BTreeMap<String, Sum> = (first..=last)
            .map(|n| (month_name(n), Sum::default()))
            .collect();
        let mut groups: BTreeMap<String, (String, Sum)> = BTreeMap::new();
        while let Some(r) = rows.next().map_err(err)? {
            let kind: String = r.get(0).map_err(err)?;
            let amount = i128::from(r.get::<_, i64>(1).map_err(err)?);
            let date: String = r.get(2).map_err(err)?;
            let source: Option<i64> = r.get(3).map_err(err)?;
            let destination: Option<i64> = r.get(4).map_err(err)?;
            let transfer = if kind == "transfer" {
                f.account_id.map_or(0, |id| {
                    if destination == Some(id) {
                        amount
                    } else if source == Some(id) {
                        -amount
                    } else {
                        0
                    }
                })
            } else {
                0
            };
            if date < from {
                comparison.add(&kind, amount, transfer);
                continue;
            }
            total.add(&kind, amount, transfer);
            if let Some(m) = financial_month(&date, start).and_then(|k| months.get_mut(&k)) {
                m.add(&kind, amount, transfer);
            }
            let key: String = r.get(5).map_err(err)?;
            let label: String = r.get(6).map_err(err)?;
            groups
                .entry(key)
                .or_insert_with(|| (label, Sum::default()))
                .1
                .add(&kind, amount, transfer);
        }
        drop(rows);
        drop(q);
        if f.group_by == "category" {
            let categories = self.list_categories()?;
            let by_id: BTreeMap<_, _> = categories.iter().map(|c| (c.id, c)).collect();
            for (key, (name, _)) in &mut groups {
                let mut current = key.parse::<i64>().ok();
                let mut names = Vec::new();
                let mut seen = std::collections::HashSet::new();
                while let Some(category) = current.and_then(|id| by_id.get(&id)) {
                    if !seen.insert(category.id) {
                        break;
                    }
                    names.push(category.name.as_str());
                    current = category.parent_id;
                }
                if !names.is_empty() {
                    names.reverse();
                    *name = names.join(" › ");
                }
            }
        }
        let group_count = groups.len();
        let page = f.page.min(group_count.saturating_sub(1) / 20);
        let mut groups: Vec<_> = groups.into_iter().collect();
        groups.sort_by(|a, b| a.1 .0.cmp(&b.1 .0).then(a.0.cmp(&b.0)));
        let result = AnalysisReport {
            view: f.view,
            start_date: from,
            until_date: until,
            totals: total.output(),
            comparison_from,
            comparison_to,
            comparison: comparison_first.map(|_| comparison.output()),
            months: months
                .into_iter()
                .map(|(month, t)| AnalysisMonth {
                    month,
                    totals: t.output(),
                })
                .collect(),
            groups: groups
                .into_iter()
                .skip(page * 20)
                .take(20)
                .map(|(key, (name, t))| AnalysisGroup {
                    key,
                    name,
                    totals: t.output(),
                })
                .collect(),
            group_count,
            page,
        };
        snapshot.commit().map_err(err)?;
        Ok(result)
    }
}
