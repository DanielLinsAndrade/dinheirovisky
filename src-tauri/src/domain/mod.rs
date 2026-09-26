pub mod cards;
use serde::{Deserialize, Serialize};
pub mod import;
pub mod money;
pub mod period;

pub const MAX_CENTS: i64 = 9_007_199_254_740_991;
pub const ICONS: &[&str] = &[
    "tag",
    "food",
    "home",
    "car",
    "heart",
    "book",
    "sun",
    "repeat",
    "bag",
    "briefcase",
    "chart",
    "refund",
    "wallet",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: i64,
    pub name: String,
    pub kind: String,
    pub initial_balance: i64,
    pub active: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AccountInput {
    pub id: Option<i64>,
    pub name: String,
    pub kind: String,
    pub initial_balance: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Category {
    pub id: i64,
    pub name: String,
    pub kind: String,
    pub parent_id: Option<i64>,
    pub icon: String,
    pub active: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CategoryInput {
    pub id: Option<i64>,
    pub name: String,
    pub kind: String,
    pub parent_id: Option<i64>,
    pub icon: String,
}

pub fn validate_id(id: i64) -> Result<(), String> {
    if !(1..=MAX_CENTS).contains(&id) {
        return Err("Identificador inválido.".into());
    }
    Ok(())
}

pub fn normalized_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 120 || name.chars().any(char::is_control) {
        return Err("Informe um nome entre 1 e 120 caracteres, sem quebras de linha.".into());
    }
    Ok(name.to_owned())
}

impl AccountInput {
    pub fn validate(&mut self) -> Result<(), String> {
        self.name = normalized_name(&self.name)?;
        if let Some(id) = self.id {
            validate_id(id)?;
        }
        if ![
            "wallet",
            "checking",
            "savings",
            "digital",
            "investment",
            "other",
        ]
        .contains(&self.kind.as_str())
        {
            return Err("Tipo de conta inválido.".into());
        }
        if !(-MAX_CENTS..=MAX_CENTS).contains(&self.initial_balance) {
            return Err("Saldo inicial fora do intervalo permitido.".into());
        }
        Ok(())
    }
}

impl CategoryInput {
    pub fn validate(&mut self) -> Result<(), String> {
        self.name = normalized_name(&self.name)?;
        if let Some(id) = self.id {
            validate_id(id)?;
        }
        if let Some(id) = self.parent_id {
            validate_id(id)?;
        }
        if !["income", "expense"].contains(&self.kind.as_str()) {
            return Err("Tipo de categoria inválido.".into());
        }
        if !ICONS.contains(&self.icon.as_str()) {
            return Err("Ícone de categoria inválido.".into());
        }
        Ok(())
    }
}

// Valida a árvore inteira para preservar também os filhos ao editar um nó.
pub fn validate_category_tree(categories: &[Category]) -> Result<(), String> {
    for category in categories {
        let mut seen = std::collections::HashSet::new();
        seen.insert(category.id);
        let mut current = category;
        while let Some(parent_id) = current.parent_id {
            if !seen.insert(parent_id) {
                return Err("Uma categoria não pode ser sua própria ancestral.".into());
            }
            let parent = categories
                .iter()
                .find(|item| item.id == parent_id)
                .ok_or("A categoria principal não existe.")?;
            if current.kind != parent.kind {
                return Err("Categoria e subcategorias precisam ter o mesmo tipo. Ajuste os vínculos antes de alterar o tipo.".into());
            }
            if current.active && !parent.active {
                return Err("Uma subcategoria ativa precisa de uma categoria principal ativa. Arquive as subcategorias primeiro ou reative a categoria principal.".into());
            }
            current = parent;
        }
    }
    Ok(())
}
