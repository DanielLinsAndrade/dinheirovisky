use super::Database;
use crate::domain::{
    period::{month_bounds, month_index, month_name},
    validate_id, MAX_CENTS,
};
use rusqlite::params;
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Budget {
    pub category_id: i64,
    pub name: String,
    pub active: bool,
    pub limit_amount: i64,
    pub spent: String,
    pub remaining: String,
    pub percent: Option<String>,
    pub state: String,
}

impl Database {
    pub fn budget_snapshot(&self, month: String) -> Result<Vec<Budget>, String> {
        let snapshot = self
            .connection
            .unchecked_transaction()
            .map_err(|e| e.to_string())?;
        let result = self.budgets(month)?;
        snapshot.commit().map_err(|e| e.to_string())?;
        Ok(result)
    }
    pub fn budgets(&self, month: String) -> Result<Vec<Budget>, String> {
        let index = month_index(&month)?;
        let start = self.settings()?.financial_month_start;
        let categories = self.list_categories()?;
        let (from, to) = month_bounds(&month, start)?;
        let mut spent_by_category = std::collections::HashMap::<i64, i128>::new();
        let mut q=self.connection.prepare("SELECT category_id,amount FROM economic_movements WHERE type='expense' AND date>=?1 AND date<?2 AND category_id IS NOT NULL").map_err(|e|e.to_string())?;
        let mut amounts = q.query(params![from, to]).map_err(|e| e.to_string())?;
        while let Some(row) = amounts.next().map_err(|e| e.to_string())? {
            *spent_by_category
                .entry(row.get(0).map_err(|e| e.to_string())?)
                .or_default() += i128::from(row.get::<_, i64>(1).map_err(|e| e.to_string())?);
        }
        let mut query=self.connection.prepare("SELECT category_id,limit_amount FROM budgets WHERE year=?1 AND month=?2 ORDER BY category_id").map_err(|e|e.to_string())?;
        let rows = query
            .query_map(params![index / 12 + 1, index % 12 + 1], |r| {
                Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?))
            })
            .map_err(|e| e.to_string())?;
        let mut result = Vec::new();
        for row in rows {
            let (id, limit) = row.map_err(|e| e.to_string())?;
            let category = categories
                .iter()
                .find(|c| c.id == id)
                .ok_or("Categoria do orçamento não encontrada.")?;
            let spent = spent_by_category.get(&id).copied().unwrap_or_default();
            let limit128 = i128::from(limit);
            let remaining = limit128 - spent;
            let percent = if limit == 0 {
                if spent == 0 {
                    Some("0.0".into())
                } else {
                    None
                }
            } else {
                let tenths = spent * 1000 / limit128;
                Some(format!(
                    "{}{}.{:01}",
                    if tenths < 0 { "-" } else { "" },
                    tenths.abs() / 10,
                    tenths.abs() % 10
                ))
            };
            let state = if spent > limit128 {
                "exceeded"
            } else if limit > 0 && spent * 100 >= limit128 * 90 {
                "near"
            } else {
                "within"
            };
            let mut names = vec![category.name.clone()];
            let mut parent = category.parent_id;
            let mut seen = std::collections::HashSet::from([id]);
            while let Some(c) = parent.and_then(|id| categories.iter().find(|c| c.id == id)) {
                if !seen.insert(c.id) {
                    break;
                }
                names.push(c.name.clone());
                parent = c.parent_id;
            }
            names.reverse();
            result.push(Budget {
                category_id: id,
                name: names.join(" › "),
                active: category.active,
                limit_amount: limit,
                spent: spent.to_string(),
                remaining: remaining.to_string(),
                percent,
                state: state.into(),
            });
        }
        Ok(result)
    }
    pub fn save_budget(
        &mut self,
        month: String,
        category_id: i64,
        limit_amount: i64,
    ) -> Result<Vec<Budget>, String> {
        let index = month_index(&month)?;
        validate_id(category_id)?;
        if !(0..=MAX_CENTS).contains(&limit_amount) {
            return Err("Limite fora do intervalo permitido.".into());
        }
        let tx = self
            .connection
            .unchecked_transaction()
            .map_err(|e| e.to_string())?;
        let existing:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM budgets WHERE category_id=?1 AND year=?2 AND month=?3)",params![category_id,index/12+1,index%12+1],|r|r.get(0)).map_err(|e|e.to_string())?;
        let categories = self.list_categories()?;
        let category = categories
            .iter()
            .find(|c| c.id == category_id)
            .ok_or("Categoria não encontrada.")?;
        if category.kind != "expense" || (!category.active && !existing) {
            return Err("Escolha uma categoria de despesa ativa.".into());
        }
        tx.execute("INSERT INTO budgets(year,month,category_id,limit_amount) VALUES(?1,?2,?3,?4) ON CONFLICT(category_id,year,month) DO UPDATE SET limit_amount=excluded.limit_amount,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')",params![index/12+1,index%12+1,category_id,limit_amount]).map_err(|e|e.to_string())?;
        let result = self.budgets(month)?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(result)
    }
    pub fn delete_budget(
        &mut self,
        month: String,
        category_id: i64,
    ) -> Result<Vec<Budget>, String> {
        let index = month_index(&month)?;
        validate_id(category_id)?;
        let tx = self
            .connection
            .unchecked_transaction()
            .map_err(|e| e.to_string())?;
        if tx
            .execute(
                "DELETE FROM budgets WHERE category_id=?1 AND year=?2 AND month=?3",
                params![category_id, index / 12 + 1, index % 12 + 1],
            )
            .map_err(|e| e.to_string())?
            != 1
        {
            return Err("Orçamento não encontrado. Atualize a lista.".into());
        }
        let result = self.budgets(month)?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(result)
    }
    pub fn copy_budgets(&mut self, month: String) -> Result<Vec<Budget>, String> {
        let index = month_index(&month)?;
        if index == 0 {
            return Err("Não existe mês anterior neste período.".into());
        }
        let previous = index - 1;
        let tx = self
            .connection
            .unchecked_transaction()
            .map_err(|e| e.to_string())?;
        tx.execute("INSERT INTO budgets(year,month,category_id,limit_amount) SELECT ?1,?2,b.category_id,b.limit_amount FROM budgets b JOIN categories c ON c.id=b.category_id WHERE b.year=?3 AND b.month=?4 AND c.active=1 AND c.type='expense' ON CONFLICT(category_id,year,month) DO NOTHING",params![index/12+1,index%12+1,previous/12+1,previous%12+1]).map_err(|e|e.to_string())?;
        let result = self.budgets(month_name(index))?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(result)
    }
}
