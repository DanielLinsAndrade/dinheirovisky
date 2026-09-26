use super::Database;
use rusqlite::{params, OptionalExtension};
use serde::Serialize;

pub fn normalize(value: &str) -> String {
    value
        .to_lowercase()
        .chars()
        .filter_map(|c| match c {
            '\u{0300}'..='\u{036f}' => None,
            'á' | 'à' | 'â' | 'ã' | 'ä' => Some('a'),
            'é' | 'è' | 'ê' | 'ë' => Some('e'),
            'í' | 'ì' | 'î' | 'ï' => Some('i'),
            'ó' | 'ò' | 'ô' | 'õ' | 'ö' => Some('o'),
            'ú' | 'ù' | 'û' | 'ü' => Some('u'),
            'ç' => Some('c'),
            'ñ' => Some('n'),
            _ => Some(c),
        })
        .collect()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchRecord {
    pub kind: String,
    pub id: i64,
    pub title: String,
    pub context: String,
    pub date: Option<String>,
    pub amount: Option<String>,
    pub state: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchPage {
    pub items: Vec<SearchRecord>,
    pub page: i64,
    pub has_more: bool,
}

const RECORDS: &str = "
SELECT 'transaction' kind,t.id,t.description title,
 a.name || COALESCE(' → ' || d.name,'') || COALESCE(' · ' || c.name,'') || COALESCE(' · ' || m.name,'') || COALESCE(' · ' || t.notes,'') context,
 t.date,CAST(t.amount AS TEXT) amount,t.status state
FROM transactions t JOIN accounts a ON a.id=t.account_id LEFT JOIN accounts d ON d.id=t.destination_account_id LEFT JOIN categories c ON c.id=t.category_id LEFT JOIN financial_metadata m ON m.id=t.merchant_id
UNION ALL SELECT 'account',id,name,type,NULL,NULL,CASE active WHEN 1 THEN 'active' ELSE 'archived' END FROM accounts
UNION ALL SELECT 'category',c.id,c.name,c.type || COALESCE(' · ' || p.name,''),NULL,NULL,CASE c.active WHEN 1 THEN 'active' ELSE 'archived' END FROM categories c LEFT JOIN categories p ON p.id=c.parent_id
UNION ALL SELECT 'card',id,name,institution || COALESCE(' · ' || last_four,''),NULL,NULL,CASE active WHEN 1 THEN 'active' ELSE 'archived' END FROM credit_cards
UNION ALL SELECT 'merchant',id,name,'Estabelecimento',NULL,NULL,CASE active WHEN 1 THEN 'active' ELSE 'archived' END FROM financial_metadata WHERE kind='merchant'";
fn record(r: &rusqlite::Row<'_>) -> rusqlite::Result<SearchRecord> {
    Ok(SearchRecord {
        kind: r.get(0)?,
        id: r.get(1)?,
        title: r.get(2)?,
        context: r.get(3)?,
        date: r.get(4)?,
        amount: r.get(5)?,
        state: r.get(6)?,
    })
}
impl Database {
    pub fn search(&self, query: &str, page: i64) -> Result<SearchPage, String> {
        let query = normalize(query.trim());
        if query.chars().count() > 120
            || query.chars().any(char::is_control)
            || !(0..=1000000).contains(&page)
        {
            return Err("Busca inválida: até 120 caracteres e página válida.".into());
        }
        if query.chars().count() < 3 {
            return Ok(SearchPage {
                items: vec![],
                page: 0,
                has_more: false,
            });
        }
        // instr treats %, _ and quotes literally; all input stays parameterized.
        let indexed = format!("\"{}\"", query.replace('"', "\"\""));
        // Filter IDs before building joined context. Filtering the outer UNION
        // made SQLite construct context for the entire transaction history.
        let records = RECORDS.replacen("UNION ALL SELECT 'account'", "WHERE t.id IN (
            SELECT rowid AS id FROM transaction_search WHERE transaction_search MATCH ?3
            UNION SELECT id FROM transactions WHERE account_id IN (SELECT id FROM accounts WHERE instr(dv_search(name),?1)>0)
            UNION SELECT id FROM transactions WHERE destination_account_id IN (SELECT id FROM accounts WHERE instr(dv_search(name),?1)>0)
            UNION SELECT id FROM transactions WHERE category_id IN (SELECT id FROM categories WHERE instr(dv_search(name),?1)>0)
            UNION SELECT id FROM transactions WHERE merchant_id IN (SELECT id FROM financial_metadata WHERE kind='merchant' AND instr(dv_search(name),?1)>0)
            ORDER BY id DESC LIMIT ?4
        ) UNION ALL SELECT 'account'", 1);
        let sql=format!("SELECT * FROM ({records}) WHERE kind='transaction' OR instr(dv_search(title || ' ' || context),?1)>0 ORDER BY kind,id DESC LIMIT 21 OFFSET ?2");
        let mut statement = self.connection.prepare(&sql).map_err(|e| e.to_string())?;
        let mut items = statement
            .query_map(params![query, page * 20, indexed, page * 20 + 21], record)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        let has_more = items.len() > 20;
        items.truncate(20);
        Ok(SearchPage {
            items,
            page,
            has_more,
        })
    }
    pub fn search_record(&self, kind: &str, id: i64) -> Result<SearchRecord, String> {
        crate::domain::validate_id(id)?;
        self.connection
            .query_row(
                &format!("SELECT * FROM ({RECORDS}) WHERE kind=?1 AND id=?2"),
                params![kind, id],
                record,
            )
            .optional()
            .map_err(|e| e.to_string())?
            .ok_or("Registro não encontrado. Ele pode ter sido excluído.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn upgrade_index_tracks_edits_deletes_and_backup() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("old.sqlite");
        let mut c = rusqlite::Connection::open(&path).unwrap();
        super::super::migrations::migrate(&mut c, &super::super::migrations::MIGRATIONS[..10])
            .unwrap();
        c.execute_batch("INSERT INTO accounts(id,name,type,initial_balance) VALUES(1,'Conta','checking',0); INSERT INTO transactions(id,description,type,amount,date,account_id,status,notes) VALUES(1,'Compra original','expense',123,'2026-09-01',1,'posted','observação antiga')").unwrap();
        drop(c);
        let mut db = Database::open(&path).unwrap();
        assert_eq!(db.search("original", 0).unwrap().items.len(), 1);
        db.connection.execute("UPDATE transactions SET description='Compra atualizada',notes='anotação nova' WHERE id=1",[]).unwrap();
        assert!(db.search("original", 0).unwrap().items.is_empty());
        assert_eq!(db.search("anotacao", 0).unwrap().items.len(), 1);
        let backup = dir.path().join("backup.sqlite3");
        db.export_backup(&backup).unwrap();
        db.connection
            .execute("DELETE FROM transactions WHERE id=1", [])
            .unwrap();
        assert!(db.search("atualizada", 0).unwrap().items.is_empty());
        let preview = db.prepare_restore(&backup).unwrap();
        db.confirm_restore(&preview.token, true).unwrap();
        assert_eq!(db.search("atualizada", 0).unwrap().items.len(), 1);
        let corrupt = rusqlite::Connection::open(&backup).unwrap();
        corrupt.execute("INSERT INTO transaction_search(transaction_search,rowid,description,notes) VALUES('delete',1,'Compra atualizada','anotação nova')",[]).unwrap();
        drop(corrupt);
        assert!(db.prepare_restore(&backup).is_err());
        assert_eq!(db.balances().unwrap()[0].cents, "-123");
    }
    #[test]
    fn search_is_bounded_literal_contextual_and_resolves_exact_record() {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open(&dir.path().join("test.sqlite")).unwrap();
        db.connection.execute_batch("INSERT INTO accounts(id,name,type,initial_balance) VALUES(1,'São conta','checking',0); INSERT INTO credit_cards(name,institution,credit_limit,closing_day,due_day) VALUES('São cartão','Banco',10000,10,20); INSERT INTO financial_metadata(kind,name,name_key) VALUES('merchant','São loja','são loja'); INSERT INTO categories(name,type) VALUES('São categoria','expense'); WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<45) INSERT INTO transactions(description,type,amount,date,account_id,status) SELECT 'São compra '||x,'expense',x,'2026-09-01',1,'posted' FROM n;").unwrap();
        let first = db.search("SAO", 0).unwrap();
        assert_eq!(first.items.len(), 20);
        assert!(first.has_more);
        let second = db.search("sao", 1).unwrap();
        assert!(second.has_more);
        let third = db.search("sao", 2).unwrap();
        assert!(!third.has_more);
        let all = first
            .items
            .iter()
            .chain(&second.items)
            .chain(&third.items)
            .collect::<Vec<_>>();
        assert_eq!(all.len(), 49);
        for kind in ["transaction", "account", "category", "card", "merchant"] {
            assert!(all.iter().any(|r| r.kind == kind));
        }
        for r in all {
            let found = db.search_record(&r.kind, r.id).unwrap();
            assert_eq!(found.title, r.title);
        }
        assert!(db.search("%' OR 1=1 --", 0).unwrap().items.is_empty());
        assert!(db.search("s", 0).unwrap().items.is_empty());
        assert!(db.search("sao", -1).is_err());
        assert!(db.search_record("transaction", 9999).is_err());
        assert_eq!(db.balances().unwrap()[0].cents, "-1035");
    }
}
