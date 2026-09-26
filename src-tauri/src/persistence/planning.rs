use super::Database;
use crate::domain::{validate_id, MAX_CENTS};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

// Mais que todas as semanas entre 0001 e 9999; também limita buscas de cursor.
pub(super) const MAX_OCCURRENCE_INDEX: i64 = 600_000;

pub(super) fn date_valid(db: &Connection, date: &str) -> Result<(), String> {
    let valid: bool = db.prepare_cached("SELECT length(?1)=10 AND ?1 GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(?1,'+0 days') IS ?1 AND substr(?1,1,4)!='0000'").map_err(|e|e.to_string())?.query_row([date], |r| r.get(0)).map_err(|e|e.to_string())?;
    if valid {
        Ok(())
    } else {
        Err("Informe uma data válida entre 0001 e 9999.".into())
    }
}
pub(super) fn name_valid(name: &str, max: usize) -> Result<(), String> {
    if name.trim().is_empty() || name.chars().count() > max || name.chars().any(char::is_control) {
        Err(format!(
            "Informe um nome/descrição de 1 a {max} caracteres."
        ))
    } else {
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecurrenceInput {
    pub id: Option<i64>,
    pub description: String,
    pub amount: i64,
    pub kind: String,
    pub account_id: i64,
    pub category_id: Option<i64>,
    pub notes: Option<String>,
    pub frequency: String,
    pub interval: i64,
    pub start_date: String,
    pub end_date: Option<String>,
    #[serde(default)]
    pub planning_class: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Recurrence {
    #[serde(flatten)]
    pub input: RecurrenceInput,
    pub active: bool,
    pub ended: bool,
    pub next_date: Option<String>,
    pub blocked: bool,
}

// Calculada sempre a partir da âncora original: 31/jan → 28/fev → 31/mar.
pub(super) fn occurrence(
    db: &Connection,
    r: &RecurrenceInput,
    index: i64,
) -> Result<Option<String>, String> {
    if !(1..=120).contains(&r.interval)
        || !(0..=MAX_OCCURRENCE_INDEX).contains(&index)
        || !["weekly", "monthly", "yearly"].contains(&r.frequency.as_str())
    {
        return Err("Calendário de recorrência inválido.".into());
    }
    let step = r
        .interval
        .checked_mul(index)
        .ok_or("Intervalo fora do limite.")?;
    let result: Option<String> = if r.frequency == "weekly" {
        let days = step.checked_mul(7).ok_or("Intervalo fora do limite.")?;
        db.query_row("SELECT date(?1,?2)", params![r.start_date,format!("+{days} days")], |row|row.get(0))
    } else {
        let months = step.checked_mul(if r.frequency=="yearly" { 12 } else { 1 }).ok_or("Intervalo fora do limite.")?;
        // O calendário SQLite só admite anos até 9999; evita conversões internas
        // de modificadores enormes mesmo quando o produto ainda cabe em i64.
        if months > 119_988 { return Ok(None); }
        db.query_row("SELECT CASE WHEN date(?1,'start of month',?2) IS NULL THEN NULL ELSE printf('%s-%02d',strftime('%Y-%m',?1,'start of month',?2),min(CAST(substr(?1,9,2) AS INTEGER),CASE WHEN strftime('%m',?1,'start of month',?2)='12' THEN 31 ELSE CAST(strftime('%d',date(?1,'start of month',?2,'+1 month','-1 day')) AS INTEGER) END)) END",params![r.start_date,format!("+{months} months")],|row|row.get(0))
    }.map_err(|e|e.to_string())?;
    Ok(result.filter(|d| {
        d.len() == 10 && !d.starts_with("0000") && r.end_date.as_ref().is_none_or(|end| d <= end)
    }))
}
fn read_recurrences(db: &Connection) -> Result<Vec<Recurrence>, String> {
    let mut q=db.prepare("SELECT r.id,t.description,t.amount,t.type,t.account_id,t.category_id,t.notes,r.frequency,r.interval,r.start_date,r.end_date,r.active,t.ended,t.next_index, a.active=0 OR COALESCE(c.active=0,0),t.planning_class FROM recurrences r JOIN recurrence_templates t ON t.recurrence_id=r.id JOIN accounts a ON a.id=t.account_id LEFT JOIN categories c ON c.id=t.category_id ORDER BY r.id DESC").map_err(|e|e.to_string())?;
    let rows = q
        .query_map([], |row| {
            Ok((
                RecurrenceInput {
                    id: row.get(0)?,
                    description: row.get(1)?,
                    amount: row.get(2)?,
                    kind: row.get(3)?,
                    account_id: row.get(4)?,
                    category_id: row.get(5)?,
                    notes: row.get(6)?,
                    frequency: row.get(7)?,
                    interval: row.get(8)?,
                    start_date: row.get(9)?,
                    end_date: row.get(10)?,
                    planning_class: row.get(15)?,
                },
                row.get::<_, bool>(11)?,
                row.get::<_, bool>(12)?,
                row.get::<_, i64>(13)?,
                row.get::<_, bool>(14)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    rows.map(|row| {
        let (input, active, ended, index, blocked) = row.map_err(|e| e.to_string())?;
        let next_date = if ended {
            None
        } else {
            occurrence(db, &input, index)?
        };
        Ok(Recurrence {
            input,
            active,
            ended,
            next_date,
            blocked,
        })
    })
    .collect()
}
impl Database {
    pub fn list_recurrences(&self) -> Result<Vec<Recurrence>, String> {
        read_recurrences(&self.connection)
    }
    pub fn save_recurrence(
        &mut self,
        mut input: RecurrenceInput,
    ) -> Result<Vec<Recurrence>, String> {
        input.description = input.description.trim().into();
        name_valid(&input.description, 240)?;
        if input
            .planning_class
            .as_deref()
            .is_some_and(|v| !["fixed", "seasonal"].contains(&v))
        {
            return Err("Classificação de planejamento inválida.".into());
        }
        validate_id(input.account_id)?;
        if let Some(id) = input.id {
            validate_id(id)?;
        }
        if let Some(id) = input.category_id {
            validate_id(id)?;
        }
        if !(1..=MAX_CENTS).contains(&input.amount)
            || !["income", "expense"].contains(&input.kind.as_str())
        {
            return Err(
                "Informe receita/despesa e valor positivo dentro do limite monetário.".into(),
            );
        }
        if !["weekly", "monthly", "yearly"].contains(&input.frequency.as_str())
            || !(1..=120).contains(&input.interval)
        {
            return Err(
                "Use frequência semanal, mensal ou anual e intervalo entre 1 e 120.".into(),
            );
        }
        date_valid(&self.connection, &input.start_date)?;
        if let Some(end) = &input.end_date {
            date_valid(&self.connection, end)?;
            if end < &input.start_date {
                return Err("O término não pode anteceder o início.".into());
            }
        }
        if input
            .notes
            .as_ref()
            .is_some_and(|n| n.chars().count() > 4000)
        {
            return Err("Observações devem ter até 4000 caracteres.".into());
        }
        let previous = self
            .list_recurrences()?
            .into_iter()
            .find(|r| r.input.id == input.id);
        if input.id.is_some() && previous.is_none() {
            return Err("Recorrência não encontrada.".into());
        }
        if let Some(old) = &previous {
            if old.ended {
                return Err("Uma recorrência encerrada não pode ser editada.".into());
            }
            if old.input.frequency != input.frequency
                || old.input.interval != input.interval
                || old.input.start_date != input.start_date
                || old.input.end_date != input.end_date
            {
                return Err("O calendário é fixo. Encerre e crie outra recorrência para alterar as datas ou frequência.".into());
            }
        }
        if !self.list_accounts()?.iter().any(|a| {
            a.id == input.account_id
                && (a.active
                    || previous
                        .as_ref()
                        .is_some_and(|p| p.input.account_id == a.id))
        }) {
            return Err("Selecione uma conta ativa.".into());
        }
        if let Some(id) = input.category_id {
            if !self.list_categories()?.iter().any(|c| {
                c.id == id
                    && c.kind == input.kind
                    && (c.active
                        || previous
                            .as_ref()
                            .is_some_and(|p| p.input.category_id == Some(id)))
            }) {
                return Err("Selecione uma categoria ativa do mesmo tipo.".into());
            }
        }
        let tx = self.connection.transaction().map_err(|e| e.to_string())?;
        let id = if let Some(id) = input.id {
            id
        } else {
            tx.execute("INSERT INTO recurrences(frequency,interval,start_date,end_date) VALUES(?1,?2,?3,?4)",params![input.frequency,input.interval,input.start_date,input.end_date]).map_err(|e|e.to_string())?;
            tx.last_insert_rowid()
        };
        tx.execute("INSERT INTO recurrence_templates(recurrence_id,description,amount,type,account_id,category_id,notes) VALUES(?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(recurrence_id) DO UPDATE SET description=excluded.description,amount=excluded.amount,type=excluded.type,account_id=excluded.account_id,category_id=excluded.category_id,notes=excluded.notes",params![id,input.description,input.amount,input.kind,input.account_id,input.category_id,input.notes]).map_err(|e|e.to_string())?;
        tx.execute(
            "UPDATE recurrence_templates SET planning_class=?1 WHERE recurrence_id=?2",
            params![input.planning_class, id],
        )
        .map_err(|e| e.to_string())?;
        tx.execute(
            "UPDATE recurrences SET updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?1",
            [id],
        )
        .map_err(|e| e.to_string())?;
        let rows = read_recurrences(&tx)?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(rows)
    }
    pub fn set_recurrence_state(
        &mut self,
        id: i64,
        action: String,
        today: String,
    ) -> Result<Vec<Recurrence>, String> {
        validate_id(id)?;
        date_valid(&self.connection, &today)?;
        let r = self
            .list_recurrences()?
            .into_iter()
            .find(|r| r.input.id == Some(id))
            .ok_or("Recorrência não encontrada.")?;
        if r.ended {
            return Err("Recorrência já encerrada.".into());
        }
        if !["pause", "resume", "end"].contains(&action.as_str()) {
            return Err("Ação inválida.".into());
        }
        let tx = self.connection.transaction().map_err(|e| e.to_string())?;
        if action == "resume" && !r.active {
            if r.blocked {
                return Err("Reative a conta/categoria antes de retomar.".into());
            }
            // Busca limitada ao calendário suportado, sem percorrer anos de pausa.
            let (mut low, mut high) = (0, MAX_OCCURRENCE_INDEX);
            while low < high {
                let mid = (low + high) / 2;
                if occurrence(&tx, &r.input, mid)?.is_some_and(|d| d < today) {
                    low = mid + 1;
                } else {
                    high = mid;
                }
            }
            tx.execute("UPDATE recurrence_templates SET next_index=max(next_index,?1) WHERE recurrence_id=?2",params![low,id]).map_err(|e|e.to_string())?;
        }
        tx.execute("UPDATE recurrences SET active=?1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?2",params![action=="resume",id]).map_err(|e|e.to_string())?;
        if action == "end" {
            tx.execute(
                "UPDATE recurrence_templates SET ended=1 WHERE recurrence_id=?1",
                [id],
            )
            .map_err(|e| e.to_string())?;
        }
        let rows = read_recurrences(&tx)?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(rows)
    }
    pub fn materialize_recurrences(&mut self, today: String) -> Result<usize, String> {
        date_valid(&self.connection, &today)?;
        let tx = self.connection.transaction().map_err(|e| e.to_string())?;
        let mut count = 0;
        for r in read_recurrences(&tx)?
            .into_iter()
            .filter(|r| r.active && !r.ended && !r.blocked)
        {
            let id = r.input.id.unwrap();
            let mut index: i64 = tx
                .query_row(
                    "SELECT next_index FROM recurrence_templates WHERE recurrence_id=?1",
                    [id],
                    |row| row.get(0),
                )
                .map_err(|e| e.to_string())?;
            for _ in 0..500 {
                let Some(date) = occurrence(&tx, &r.input, index)? else {
                    break;
                };
                if date > today {
                    break;
                }
                let exists:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM recurrence_occurrences WHERE recurrence_id=?1 AND occurrence_date=?2)",params![id,date],|row|row.get(0)).map_err(|e|e.to_string())?;
                if !exists {
                    tx.execute("INSERT INTO transactions(description,amount,type,date,account_id,category_id,status,notes,recurrence_id) VALUES(?1,?2,?3,?4,?5,?6,'scheduled',?7,?8)",params![r.input.description,r.input.amount,r.input.kind,date,r.input.account_id,r.input.category_id,r.input.notes,id]).map_err(|e|e.to_string())?;
                    tx.execute("INSERT INTO recurrence_occurrences(recurrence_id,occurrence_date,transaction_id) VALUES(?1,?2,?3)",params![id,date,tx.last_insert_rowid()]).map_err(|e|e.to_string())?;
                    count += 1;
                }
                index = index
                    .checked_add(1)
                    .ok_or("Cursor de recorrência fora do limite.")?;
                if count >= 500 {
                    break;
                }
            }
            tx.execute(
                "UPDATE recurrence_templates SET next_index=?1 WHERE recurrence_id=?2",
                params![index, id],
            )
            .map_err(|e| e.to_string())?;
            if count >= 500 {
                break;
            }
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(count)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GoalInput {
    pub id: Option<i64>,
    pub name: String,
    pub target_amount: i64,
    pub target_date: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Contribution {
    pub id: i64,
    pub amount: i64,
    pub date: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Goal {
    pub id: i64,
    pub name: String,
    pub target_amount: i64,
    pub current_amount: i64,
    pub target_date: Option<String>,
    pub completed: bool,
    pub contributions: Vec<Contribution>,
}
fn read_goals(db: &Connection) -> Result<Vec<Goal>, String> {
    let mut q=db.prepare("SELECT id,name,target_amount,current_amount,target_date,completed FROM goals ORDER BY completed,id DESC").map_err(|e|e.to_string())?;
    let mut goals = q
        .query_map([], |r| {
            Ok(Goal {
                id: r.get(0)?,
                name: r.get(1)?,
                target_amount: r.get(2)?,
                current_amount: r.get(3)?,
                target_date: r.get(4)?,
                completed: r.get(5)?,
                contributions: vec![],
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    for g in &mut goals {
        let mut q=db.prepare("SELECT id,amount,date FROM goal_contributions WHERE goal_id=?1 ORDER BY date DESC,id DESC").map_err(|e|e.to_string())?;
        g.contributions = q
            .query_map([g.id], |r| {
                Ok(Contribution {
                    id: r.get(0)?,
                    amount: r.get(1)?,
                    date: r.get(2)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
    }
    Ok(goals)
}
impl Database {
    pub fn list_goals(&self) -> Result<Vec<Goal>, String> {
        read_goals(&self.connection)
    }
    pub fn save_goal(&mut self, mut input: GoalInput) -> Result<Vec<Goal>, String> {
        input.name = input.name.trim().into();
        name_valid(&input.name, 120)?;
        if !(1..=MAX_CENTS).contains(&input.target_amount) {
            return Err(
                "O valor alvo deve ser positivo e estar dentro do limite monetário.".into(),
            );
        }
        if let Some(id) = input.id {
            validate_id(id)?;
        }
        if let Some(date) = &input.target_date {
            date_valid(&self.connection, date)?;
        }
        let tx = self.connection.transaction().map_err(|e| e.to_string())?;
        if let Some(id) = input.id {
            if tx.execute("UPDATE goals SET name=?1,target_amount=?2,target_date=?3,completed=(current_amount>=?2),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?4",params![input.name,input.target_amount,input.target_date,id]).map_err(|e|e.to_string())?!=1{return Err("Meta não encontrada.".into());}
        } else {
            tx.execute(
                "INSERT INTO goals(name,target_amount,target_date) VALUES(?1,?2,?3)",
                params![input.name, input.target_amount, input.target_date],
            )
            .map_err(|e| e.to_string())?;
        }
        let rows = read_goals(&tx)?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(rows)
    }
    pub fn delete_goal(&mut self, id: i64) -> Result<Vec<Goal>, String> {
        validate_id(id)?;
        let tx = self.connection.transaction().map_err(|e| e.to_string())?;
        if tx
            .execute("DELETE FROM goals WHERE id=?1", [id])
            .map_err(|e| e.to_string())?
            != 1
        {
            return Err("Meta não encontrada.".into());
        }
        let rows = read_goals(&tx)?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(rows)
    }
    pub fn add_contribution(
        &mut self,
        goal_id: i64,
        amount: i64,
        date: String,
    ) -> Result<Vec<Goal>, String> {
        validate_id(goal_id)?;
        date_valid(&self.connection, &date)?;
        if !(1..=MAX_CENTS).contains(&amount) {
            return Err(
                "A contribuição deve ser positiva e estar dentro do limite monetário.".into(),
            );
        }
        let tx = self.connection.transaction().map_err(|e| e.to_string())?;
        let current: i64 = tx
            .query_row(
                "SELECT current_amount FROM goals WHERE id=?1",
                [goal_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?
            .ok_or("Meta não encontrada.")?;
        if i128::from(current) + i128::from(amount) > i128::from(MAX_CENTS) {
            return Err("O total ultrapassa o limite monetário.".into());
        }
        tx.execute(
            "INSERT INTO goal_contributions(goal_id,amount,date) VALUES(?1,?2,?3)",
            params![goal_id, amount, date],
        )
        .map_err(|e| e.to_string())?;
        tx.execute("UPDATE goals SET current_amount=current_amount+?1,completed=(current_amount+?1>=target_amount),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?2",params![amount,goal_id]).map_err(|e|e.to_string())?;
        let rows = read_goals(&tx)?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(rows)
    }
    pub fn remove_contribution(&mut self, id: i64) -> Result<Vec<Goal>, String> {
        validate_id(id)?;
        let tx = self.connection.transaction().map_err(|e| e.to_string())?;
        let (goal, amount): (i64, i64) = tx
            .query_row(
                "SELECT goal_id,amount FROM goal_contributions WHERE id=?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(|e| e.to_string())?
            .ok_or("Contribuição não encontrada. Atualize a lista.")?;
        tx.execute("DELETE FROM goal_contributions WHERE id=?1", [id])
            .map_err(|e| e.to_string())?;
        tx.execute("UPDATE goals SET current_amount=current_amount-?1,completed=(current_amount-?1>=target_amount),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?2",params![amount,goal]).map_err(|e|e.to_string())?;
        let rows = read_goals(&tx)?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(rows)
    }
}

#[cfg(test)]
mod tests;
