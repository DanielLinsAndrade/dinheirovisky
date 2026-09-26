use super::{
    transactions::{read_matching, Movement},
    Database,
};
use serde::{Deserialize, Serialize};
#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TransactionQuery {
    #[serde(default)]
    pub search: String,
    pub account_id: Option<i64>,
    pub category_id: Option<i64>,
    pub method_id: Option<i64>,
    pub merchant_id: Option<i64>,
    pub intermediary_id: Option<i64>,
    #[serde(default)]
    pub channel: String,
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub from: String,
    #[serde(default)]
    pub to: String,
    #[serde(default)]
    pub sort: String,
    #[serde(default)]
    pub page: i64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactionPage {
    pub items: Vec<Movement>,
    pub total: i64,
    pub page: i64,
}
impl Database {
    pub fn query_transactions(&self, q: TransactionQuery) -> Result<TransactionPage, String> {
        if q.search.chars().count() > 4000 || !(0..=1_000_000_000).contains(&q.page) {
            return Err("Filtro fora do limite.".into());
        }
        for id in [
            q.account_id,
            q.category_id,
            q.method_id,
            q.merchant_id,
            q.intermediary_id,
        ]
        .into_iter()
        .flatten()
        {
            crate::domain::validate_id(id)?;
        }
        for date in [&q.from, &q.to].into_iter().filter(|s| !s.is_empty()) {
            super::planning::date_valid(&self.connection, date)?;
        }
        if !["", "income", "expense", "transfer"].contains(&q.kind.as_str())
            || !["", "posted", "pending", "scheduled"].contains(&q.status.as_str())
        {
            return Err("Filtro inválido.".into());
        }
        if !["", "unknown", "in_person", "online"].contains(&q.channel.as_str()) {
            return Err("Modalidade inválida.".into());
        }
        let order = match q.sort.as_str() {
            "" | "newest" => "date DESC,id DESC",
            "oldest" => "date,id",
            "amount" => "amount DESC,date DESC,id DESC",
            "description" => "dv_casefold(description),id",
            _ => return Err("Ordenação inválida.".into()),
        };
        let condition="WHERE (?1 IS NULL OR account_id=?1 OR destination_account_id=?1) AND (?2 IS NULL OR category_id=?2) AND (?3='' OR type=?3) AND (?4='' OR status=?4) AND (?5='' OR date>=?5) AND (?6='' OR date<=?6) AND (?7='' OR instr(dv_casefold(description || ' ' || COALESCE(notes,'')),dv_casefold(?7))>0) AND (?8 IS NULL OR method_id=?8) AND (?9 IS NULL OR merchant_id=?9) AND (?10 IS NULL OR intermediary_id=?10) AND (?11='' OR channel=?11 OR (?11='unknown' AND channel IS NULL))";
        let values: [&dyn rusqlite::ToSql; 11] = [
            &q.account_id,
            &q.category_id,
            &q.kind,
            &q.status,
            &q.from,
            &q.to,
            &q.search,
            &q.method_id,
            &q.merchant_id,
            &q.intermediary_id,
            &q.channel,
        ];
        let snapshot = self
            .connection
            .unchecked_transaction()
            .map_err(|e| e.to_string())?;
        let total: i64 = snapshot
            .query_row(
                &format!("SELECT count(*) FROM transactions {condition}"),
                values,
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        let page = q.page.min(((total - 1) / 50).max(0));
        let offset = page * 50;
        let mut args = values.to_vec();
        args.push(&offset);
        let items = read_matching(
            &snapshot,
            &format!("{condition} ORDER BY {order} LIMIT 50 OFFSET ?12"),
            &args,
        )?;
        snapshot.commit().map_err(|e| e.to_string())?;
        Ok(TransactionPage { items, total, page })
    }
}
