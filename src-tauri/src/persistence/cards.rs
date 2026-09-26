use super::Database;
use crate::domain::{normalized_name, validate_id, MAX_CENTS};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CardInput {
    pub id: Option<i64>,
    pub name: String,
    pub institution: String,
    pub last_four: Option<String>,
    pub brand: Option<String>,
    pub credit_limit: i64,
    pub closing_day: i64,
    pub due_day: i64,
    pub default_account_id: Option<i64>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Card {
    #[serde(flatten)]
    pub input: CardInput,
    pub active: bool,
    pub created_at: String,
    pub updated_at: String,
}
fn optional(value: Option<String>) -> Result<Option<String>, String> {
    value
        .filter(|s| !s.trim().is_empty())
        .map(|s| normalized_name(&s))
        .transpose()
}
fn validate(input: &mut CardInput) -> Result<(), String> {
    if let Some(id) = input.id {
        validate_id(id)?;
    }
    if let Some(id) = input.default_account_id {
        validate_id(id)?;
    }
    input.name = normalized_name(&input.name)?;
    input.institution = normalized_name(&input.institution)?;
    input.brand = optional(input.brand.take())?;
    input.last_four = optional(input.last_four.take())?;
    if input
        .last_four
        .as_ref()
        .is_some_and(|s| s.len() != 4 || !s.bytes().all(|b| b.is_ascii_digit()))
    {
        return Err("Informe somente os quatro últimos dígitos do cartão.".into());
    }
    if !(0..=MAX_CENTS).contains(&input.credit_limit) {
        return Err("Limite monetário inválido.".into());
    }
    if !(1..=31).contains(&input.closing_day) || !(1..=31).contains(&input.due_day) {
        return Err("Fechamento e vencimento devem estar entre 1 e 31.".into());
    }
    Ok(())
}
fn read(c: &Connection) -> Result<Vec<Card>, String> {
    let mut q=c.prepare("SELECT id,name,institution,last_four,brand,credit_limit,closing_day,due_day,default_account_id,active,created_at,updated_at FROM credit_cards ORDER BY active DESC,name,id").map_err(|e|e.to_string())?;
    let result = q
        .query_map([], |r| {
            Ok(Card {
                input: CardInput {
                    id: Some(r.get(0)?),
                    name: r.get(1)?,
                    institution: r.get(2)?,
                    last_four: r.get(3)?,
                    brand: r.get(4)?,
                    credit_limit: r.get(5)?,
                    closing_day: r.get(6)?,
                    due_day: r.get(7)?,
                    default_account_id: r.get(8)?,
                },
                active: r.get(9)?,
                created_at: r.get(10)?,
                updated_at: r.get(11)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string());
    result
}
impl Database {
    pub fn list_cards(&self) -> Result<Vec<Card>, String> {
        read(&self.connection)
    }
    pub fn save_card(&mut self, mut input: CardInput) -> Result<Vec<Card>, String> {
        validate(&mut input)?;
        let tx = self.connection.transaction().map_err(|e| e.to_string())?;
        if let Some(account) = input.default_account_id {
            let allowed:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM accounts WHERE id=?1 AND (active=1 OR id=(SELECT default_account_id FROM credit_cards WHERE id=?2)))",params![account,input.id],|r|r.get(0)).map_err(|e|e.to_string())?;
            if !allowed {
                return Err(
                    "Escolha uma conta ativa para pagamento ou preserve a conta já vinculada."
                        .into(),
                );
            }
        }
        if let Some(id) = input.id {
            let changed=tx.execute("UPDATE credit_cards SET name=?1,institution=?2,last_four=?3,brand=?4,credit_limit=?5,closing_day=?6,due_day=?7,default_account_id=?8,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?9",params![input.name,input.institution,input.last_four,input.brand,input.credit_limit,input.closing_day,input.due_day,input.default_account_id,id]).map_err(|e|e.to_string())?;
            if changed != 1 {
                return Err("Cartão não encontrado.".into());
            }
        } else {
            tx.execute("INSERT INTO credit_cards(name,institution,last_four,brand,credit_limit,closing_day,due_day,default_account_id) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",params![input.name,input.institution,input.last_four,input.brand,input.credit_limit,input.closing_day,input.due_day,input.default_account_id]).map_err(|e|e.to_string())?;
        }
        let result = read(&tx)?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(result)
    }
    pub fn set_card_active(&mut self, id: i64, active: bool) -> Result<Vec<Card>, String> {
        validate_id(id)?;
        let tx = self.connection.transaction().map_err(|e| e.to_string())?;
        if tx.execute("UPDATE credit_cards SET active=?1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?2",params![active,id]).map_err(|e|e.to_string())?!=1{return Err("Cartão não encontrado.".into());}
        let result = read(&tx)?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(result)
    }
    pub fn delete_card(&mut self, id: i64) -> Result<Vec<Card>, String> {
        validate_id(id)?;
        let tx = self.connection.transaction().map_err(|e| e.to_string())?;
        if tx
            .execute("DELETE FROM credit_cards WHERE id=?1", [id])
            .map_err(|_| "Não é possível excluir cartão com vínculos. Arquive-o.")?
            != 1
        {
            return Err("Cartão não encontrado.".into());
        }
        let result = read(&tx)?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(result)
    }
    pub fn card_calendar(
        &self,
        id: i64,
        month: &str,
    ) -> Result<Vec<crate::domain::cards::CardDates>, String> {
        validate_id(id)?;
        let card = self
            .list_cards()?
            .into_iter()
            .find(|c| c.input.id == Some(id))
            .ok_or("Cartão não encontrado.")?;
        crate::domain::cards::calendar(month, card.input.closing_day, card.input.due_day)
    }
}
pub(super) fn validate_backup(c: &Connection) -> Result<(), String> {
    for card in read(c)? {
        let original = serde_json::to_value(&card.input).map_err(|e| e.to_string())?;
        let mut input = card.input;
        validate(&mut input)?;
        if serde_json::to_value(input).map_err(|e| e.to_string())? != original {
            return Err("Dados de cartão não normalizados no backup.".into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests;
