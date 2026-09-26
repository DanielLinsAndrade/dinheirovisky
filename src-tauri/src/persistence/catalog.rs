use super::Database;
use crate::domain::{
    validate_category_tree, validate_id, Account, AccountInput, Category, CategoryInput,
};
use rusqlite::{params, Connection, TransactionBehavior};

fn storage_error(error: rusqlite::Error) -> String {
    format!("Não foi possível acessar o banco local: {error}")
}

fn accounts(connection: &Connection) -> Result<Vec<Account>, String> {
    let mut statement = connection.prepare("SELECT id, name, type, initial_balance, active, created_at, updated_at FROM accounts ORDER BY name COLLATE NOCASE, id").map_err(storage_error)?;
    let result = statement
        .query_map([], |row| {
            Ok(Account {
                id: row.get(0)?,
                name: row.get(1)?,
                kind: row.get(2)?,
                initial_balance: row.get(3)?,
                active: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })
        .map_err(storage_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(storage_error);
    result
}

fn categories(connection: &Connection) -> Result<Vec<Category>, String> {
    let mut statement = connection.prepare("SELECT id, name, type, parent_id, icon, active, created_at, updated_at FROM categories ORDER BY name COLLATE NOCASE, id").map_err(storage_error)?;
    let result = statement
        .query_map([], |row| {
            Ok(Category {
                id: row.get(0)?,
                name: row.get(1)?,
                kind: row.get(2)?,
                parent_id: row.get(3)?,
                icon: row.get(4)?,
                active: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })
        .map_err(storage_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(storage_error);
    result
}

impl Database {
    pub fn list_accounts(&self) -> Result<Vec<Account>, String> {
        accounts(&self.connection)
    }
    pub fn list_categories(&self) -> Result<Vec<Category>, String> {
        categories(&self.connection)
    }

    pub fn save_account(&mut self, mut input: AccountInput) -> Result<Vec<Account>, String> {
        input.validate()?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage_error)?;
        let existing = accounts(&transaction)?;
        if let Some(id) = input.id {
            if !existing.iter().any(|account| account.id == id) {
                return Err("Conta não encontrada. Atualize a lista.".into());
            }
        }
        if existing.iter().any(|account| {
            Some(account.id) != input.id && account.name.to_lowercase() == input.name.to_lowercase()
        }) {
            return Err("Já existe uma conta com esse nome, inclusive entre as arquivadas.".into());
        }
        if let Some(id) = input.id {
            transaction.execute("UPDATE accounts SET name=?1, type=?2, initial_balance=?3, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?4", params![input.name, input.kind, input.initial_balance, id]).map_err(storage_error)?;
        } else {
            transaction
                .execute(
                    "INSERT INTO accounts(name, type, initial_balance) VALUES (?1, ?2, ?3)",
                    params![input.name, input.kind, input.initial_balance],
                )
                .map_err(storage_error)?;
        }
        let result = accounts(&transaction)?;
        transaction.commit().map_err(storage_error)?;
        Ok(result)
    }

    pub fn set_account_active(&mut self, id: i64, active: bool) -> Result<Vec<Account>, String> {
        validate_id(id)?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage_error)?;
        let changed = transaction.execute("UPDATE accounts SET active=?1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?2", params![active, id]).map_err(storage_error)?;
        if changed != 1 {
            return Err("Conta não encontrada. Atualize a lista.".into());
        }
        let result = accounts(&transaction)?;
        transaction.commit().map_err(storage_error)?;
        Ok(result)
    }

    pub fn save_category(&mut self, mut input: CategoryInput) -> Result<Vec<Category>, String> {
        input.validate()?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage_error)?;
        let mut existing = categories(&transaction)?;
        if existing.iter().any(|category| {
            Some(category.id) != input.id
                && category.name.to_lowercase() == input.name.to_lowercase()
                && category.kind == input.kind
                && category.parent_id == input.parent_id
        }) {
            return Err("Já existe uma categoria com esse nome, tipo e categoria principal, inclusive entre as arquivadas.".into());
        }
        if let Some(id) = input.id {
            let item = existing
                .iter_mut()
                .find(|category| category.id == id)
                .ok_or("Categoria não encontrada. Atualize a lista.")?;
            item.name = input.name.clone();
            item.kind = input.kind.clone();
            item.parent_id = input.parent_id;
            item.icon = input.icon.clone();
        } else {
            // Identificador temporário negativo apenas para validar o novo nó em memória.
            existing.push(Category {
                id: -1,
                name: input.name.clone(),
                kind: input.kind.clone(),
                parent_id: input.parent_id,
                icon: input.icon.clone(),
                active: true,
                created_at: String::new(),
                updated_at: String::new(),
            });
        }
        validate_category_tree(&existing)?;
        if let Some(id) = input.id {
            transaction.execute("UPDATE categories SET name=?1, type=?2, parent_id=?3, icon=?4, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?5", params![input.name, input.kind, input.parent_id, input.icon, id]).map_err(storage_error)?;
        } else {
            transaction
                .execute(
                    "INSERT INTO categories(name, type, parent_id, icon) VALUES (?1, ?2, ?3, ?4)",
                    params![input.name, input.kind, input.parent_id, input.icon],
                )
                .map_err(storage_error)?;
        }
        let result = categories(&transaction)?;
        transaction.commit().map_err(storage_error)?;
        Ok(result)
    }

    pub fn set_category_active(&mut self, id: i64, active: bool) -> Result<Vec<Category>, String> {
        validate_id(id)?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage_error)?;
        let mut existing = categories(&transaction)?;
        let item = existing
            .iter_mut()
            .find(|category| category.id == id)
            .ok_or("Categoria não encontrada. Atualize a lista.")?;
        item.active = active;
        validate_category_tree(&existing)?;
        transaction.execute("UPDATE categories SET active=?1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?2", params![active, id]).map_err(storage_error)?;
        let result = categories(&transaction)?;
        transaction.commit().map_err(storage_error)?;
        Ok(result)
    }
}
