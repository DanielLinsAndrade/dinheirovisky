use super::err;
use crate::domain::{normalized_name, validate_id, ICONS};
use crate::persistence::planning::{
    date_valid, name_valid, occurrence, RecurrenceInput, MAX_OCCURRENCE_INDEX,
};
use rusqlite::Connection;
use std::collections::HashSet;

// Executado somente após comparar schema e verificar constraints/FKs. As listas
// de tabelas/colunas abaixo são constantes do produto, nunca dados do arquivo.
pub(super) fn domain(c: &Connection) -> Result<(), String> {
    crate::persistence::attachments::validate(c)?;
    crate::persistence::cards::validate_backup(c)?;
    crate::persistence::purchases::validate_backup(c)?;
    crate::persistence::invoice_events::validate_backup(c)?;
    for table in [
        "accounts",
        "categories",
        "transactions",
        "recurrences",
        "budgets",
        "goals",
        "goal_contributions",
        "import_entries",
        "card_import_entries",
        "financial_metadata",
        "credit_cards",
        "card_purchases",
        "card_invoices",
        "card_installments",
        "invoice_events",
    ] {
        let mut q = c.prepare(&format!("SELECT id FROM {table}")).map_err(err)?;
        let mut rows = q.query([]).map_err(err)?;
        while let Some(row) = rows.next().map_err(err)? {
            validate_id(row.get(0).map_err(err)?)?;
        }
    }
    for (table, column, max) in [
        ("accounts", "name", 120),
        ("categories", "name", 120),
        ("goals", "name", 120),
        ("transactions", "description", 240),
        ("recurrence_templates", "description", 240),
    ] {
        let mut q = c
            .prepare(&format!("SELECT {column} FROM {table}"))
            .map_err(err)?;
        let mut rows = q.query([]).map_err(err)?;
        while let Some(row) = rows.next().map_err(err)? {
            let value: String = row.get(0).map_err(err)?;
            name_valid(&value, max)?;
        }
    }
    for table in ["transactions", "recurrence_templates"] {
        let mut q = c
            .prepare(&format!(
                "SELECT notes FROM {table} WHERE notes IS NOT NULL"
            ))
            .map_err(err)?;
        let mut rows = q.query([]).map_err(err)?;
        while let Some(row) = rows.next().map_err(err)? {
            let value: String = row.get(0).map_err(err)?;
            if value.chars().count() > 4000 {
                return Err("Observações do backup excedem 4000 caracteres.".into());
            }
        }
    }
    for (table, column) in [
        ("transactions", "date"),
        ("recurrences", "start_date"),
        ("recurrences", "end_date"),
        ("goals", "target_date"),
        ("goal_contributions", "date"),
        ("recurrence_occurrences", "occurrence_date"),
    ] {
        let mut q = c
            .prepare(&format!(
                "SELECT {column} FROM {table} WHERE {column} IS NOT NULL"
            ))
            .map_err(err)?;
        let mut rows = q.query([]).map_err(err)?;
        while let Some(row) = rows.next().map_err(err)? {
            date_valid(c, &row.get::<_, String>(0).map_err(err)?)?;
        }
    }
    let mut names = HashSet::new();
    let mut q = c.prepare("SELECT name FROM accounts").map_err(err)?;
    for row in q.query_map([], |r| r.get::<_, String>(0)).map_err(err)? {
        if !names.insert(normalized_name(&row.map_err(err)?)?.to_lowercase()) {
            return Err("Backup com nomes de contas duplicados.".into());
        }
    }
    let mut categories = HashSet::new();
    let mut q = c
        .prepare("SELECT name,type,parent_id,icon FROM categories")
        .map_err(err)?;
    let mut rows = q.query([]).map_err(err)?;
    while let Some(row) = rows.next().map_err(err)? {
        let name: String = row.get(0).map_err(err)?;
        let kind: String = row.get(1).map_err(err)?;
        let parent: Option<i64> = row.get(2).map_err(err)?;
        let icon: String = row.get(3).map_err(err)?;
        if !ICONS.contains(&icon.as_str())
            || !categories.insert((normalized_name(&name)?.to_lowercase(), kind, parent))
        {
            return Err("Categoria do backup inválida ou duplicada.".into());
        }
    }
    for sql in [
        "SELECT 1 FROM categories c JOIN categories p ON p.id=c.parent_id WHERE c.active=1 AND p.active=0",
        "SELECT 1 FROM recurrences WHERE interval NOT BETWEEN 1 AND 120",
        "SELECT 1 FROM recurrence_templates t JOIN recurrences r ON r.id=t.recurrence_id WHERE t.ended=1 AND r.active=1",
        "SELECT 1 FROM recurrence_occurrences o LEFT JOIN recurrence_templates t ON t.recurrence_id=o.recurrence_id WHERE t.recurrence_id IS NULL",
        "SELECT 1 FROM recurrence_occurrences o JOIN transactions t ON t.id=o.transaction_id WHERE t.recurrence_id IS NOT o.recurrence_id",
        "SELECT 1 FROM recurrence_occurrences WHERE transaction_id IS NOT NULL GROUP BY transaction_id HAVING count(*)!=1",
        "SELECT 1 FROM transactions t JOIN recurrence_templates r ON r.recurrence_id=t.recurrence_id LEFT JOIN recurrence_occurrences o ON o.transaction_id=t.id WHERE o.transaction_id IS NULL",
    ] {
        if c.prepare(sql).map_err(err)?.exists([]).map_err(err)? {
            return Err("Backup com vínculos ou estados de domínio inconsistentes.".into());
        }
    }
    super::super::metadata::validate_backup(c)?;
    calendars(c)?;
    imports(c)
}

fn calendars(c: &Connection) -> Result<(), String> {
    let mut q = c.prepare("SELECT r.id,r.frequency,r.interval,r.start_date,r.end_date,t.next_index FROM recurrences r JOIN recurrence_templates t ON t.recurrence_id=r.id").map_err(err)?;
    let mut rows = q.query([]).map_err(err)?;
    while let Some(row) = rows.next().map_err(err)? {
        let id: i64 = row.get(0).map_err(err)?;
        // occurrence usa apenas o calendário; não revalida referências arquivadas
        // como se fossem novos lançamentos, nem compara transações já editadas.
        let r = RecurrenceInput {
            id: Some(id),
            frequency: row.get(1).map_err(err)?,
            interval: row.get(2).map_err(err)?,
            start_date: row.get(3).map_err(err)?,
            end_date: row.get(4).map_err(err)?,
            description: String::new(),
            amount: 0,
            kind: String::new(),
            account_id: 0,
            category_id: None,
            notes: None,
            planning_class: None,
        };
        let cursor: i64 = row.get(5).map_err(err)?;
        if !(0..=MAX_OCCURRENCE_INDEX).contains(&cursor) {
            return Err("Cursor de recorrência inválido no backup.".into());
        }
        // O cursor pode apontar para a primeira data após o término (série
        // esgotada), mas nunca além dela. Pausas permitem lacunas no ledger.
        let (mut low, mut high) = (0, MAX_OCCURRENCE_INDEX);
        while low < high {
            let mid = (low + high) / 2;
            if occurrence(c, &r, mid)?.is_some() {
                low = mid + 1;
            } else {
                high = mid;
            }
        }
        if cursor > low {
            return Err("Cursor além do calendário da recorrência.".into());
        }
        let mut ledger = c
            .prepare("SELECT occurrence_date FROM recurrence_occurrences WHERE recurrence_id=?1")
            .map_err(err)?;
        let mut entries = ledger.query([id]).map_err(err)?;
        while let Some(entry) = entries.next().map_err(err)? {
            let date: String = entry.get(0).map_err(err)?;
            let (mut left, mut right) = (0, cursor);
            while left < right {
                let mid = (left + right) / 2;
                if occurrence(c, &r, mid)?.is_some_and(|d| d < date) {
                    left = mid + 1;
                } else {
                    right = mid;
                }
            }
            if left >= cursor || occurrence(c, &r, left)?.as_deref() != Some(date.as_str()) {
                return Err("Ocorrência fora do calendário ou adiante do cursor.".into());
            }
        }
    }
    Ok(())
}

fn imports(c: &Connection) -> Result<(), String> {
    let mut q = c
        .prepare("SELECT request_id,payload_hash,imported_count FROM import_batches")
        .map_err(err)?;
    let mut rows = q.query([]).map_err(err)?;
    while let Some(row) = rows.next().map_err(err)? {
        let request: String = row.get(0).map_err(err)?;
        let hash: String = row.get(1).map_err(err)?;
        let count: i64 = row.get(2).map_err(err)?;
        if !(16..=100).contains(&request.len())
            || !request
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-')
            || hash.len() != 64
            || !hash.bytes().all(|b| b.is_ascii_hexdigit())
            || !(1..=2000).contains(&count)
        {
            return Err("Histórico de importação inválido no backup.".into());
        }
    }
    let mut q = c
        .prepare("SELECT external_id FROM import_entries WHERE external_id IS NOT NULL UNION ALL SELECT external_id FROM card_import_entries WHERE external_id IS NOT NULL")
        .map_err(err)?;
    for row in q.query_map([], |r| r.get::<_, String>(0)).map_err(err)? {
        let id = row.map_err(err)?;
        if id.is_empty() || id.len() > 2048 {
            return Err("Identificador externo inválido no backup.".into());
        }
    }
    Ok(())
}
