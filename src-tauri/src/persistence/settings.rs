use super::Database;
use rusqlite::params;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Settings {
    pub currency: String,
    pub locale: String,
    pub date_format: String,
    pub theme: String,
    pub financial_month_start: i64,
}
impl Settings {
    pub fn validate(&self) -> Result<(), String> {
        if !["BRL", "USD", "EUR", "GBP"].contains(&self.currency.as_str()) {
            return Err("Moeda não suportada. Use BRL, USD, EUR ou GBP.".into());
        }
        if !["pt-BR", "en-US", "de-DE"].contains(&self.locale.as_str()) {
            return Err("Formato regional não suportado.".into());
        }
        if !["dd/MM/yyyy", "MM/dd/yyyy", "yyyy-MM-dd"].contains(&self.date_format.as_str()) {
            return Err("Formato de data inválido.".into());
        }
        if !["light", "dark", "system"].contains(&self.theme.as_str()) {
            return Err("Tema inválido.".into());
        }
        if !(1..=28).contains(&self.financial_month_start) {
            return Err("O início do mês financeiro deve estar entre 1 e 28.".into());
        }
        Ok(())
    }
}
impl Database {
    pub fn settings(&self) -> Result<Settings, String> {
        let result=self.connection.query_row("SELECT currency,locale,date_format,theme,financial_month_start FROM app_settings WHERE id=1",[],|r|Ok(Settings{currency:r.get(0)?,locale:r.get(1)?,date_format:r.get(2)?,theme:r.get(3)?,financial_month_start:r.get(4)?})).map_err(|e|e.to_string())?;
        result.validate()?;
        Ok(result)
    }
    pub fn save_settings(
        &mut self,
        input: Settings,
        confirm_currency_change: bool,
    ) -> Result<Settings, String> {
        input.validate()?;
        let tx = self
            .connection
            .unchecked_transaction()
            .map_err(|e| e.to_string())?;
        if self.settings()?.currency != input.currency && !confirm_currency_change {
            return Err(
                "Confirme a mudança de moeda: os valores existentes não serão convertidos.".into(),
            );
        }
        tx.execute("UPDATE app_settings SET currency=?1,locale=?2,date_format=?3,theme=?4,financial_month_start=?5 WHERE id=1",params![input.currency,input.locale,input.date_format,input.theme,input.financial_month_start]).map_err(|e|e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(input)
    }
}
