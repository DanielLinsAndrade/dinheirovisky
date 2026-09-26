use super::{
    planning::{date_valid, name_valid},
    Database,
};
use crate::domain::{validate_id, MAX_CENTS};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
#[cfg(test)]
mod tests;
#[derive(Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EventInput {
    pub request_key: String,
    pub id: Option<i64>,
    pub invoice_id: i64,
    pub kind: String,
    pub account_id: Option<i64>,
    pub purchase_id: Option<i64>,
    pub amount: i64,
    pub date: String,
    pub description: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    #[serde(flatten)]
    pub input: EventInput,
    pub voided: bool,
    pub account_name: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}
#[derive(Default)]
pub(super) struct Totals {
    pub charges: i128,
    pub credits: i128,
    pub paid: i128,
    pub installments: i64,
}
impl Totals {
    fn add(&mut self, kind: &str, amount: i64) {
        let amount = i128::from(amount);
        match kind {
            "installment" => {
                self.charges += amount;
                self.installments += 1;
            }
            "charge" => self.charges += amount,
            "payment" => self.paid += amount,
            _ => self.credits += amount,
        }
    }
    pub fn net(&self) -> i128 {
        self.charges - self.credits
    }
    pub fn remaining(&self) -> i128 {
        (self.net() - self.paid).max(0)
    }
    pub fn credit_balance(&self) -> i128 {
        (self.paid - self.net()).max(0)
    }
}
fn err(e: rusqlite::Error) -> String {
    e.to_string()
}
pub(super) fn totals(c: &Connection, id: i64) -> Result<Totals, String> {
    let mut t = Totals::default();
    let mut q=c.prepare("SELECT s.amount FROM card_installments s JOIN card_purchases p ON p.id=s.purchase_id WHERE s.invoice_id=?1 AND p.status='active'").map_err(err)?;
    for a in q.query_map([id], |r| r.get::<_, i64>(0)).map_err(err)? {
        t.add("installment", a.map_err(err)?);
    }
    let mut q = c
        .prepare("SELECT kind,amount FROM invoice_events WHERE invoice_id=?1 AND voided=0")
        .map_err(err)?;
    for row in q
        .query_map([id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))
        .map_err(err)?
    {
        let (k, a) = row.map_err(err)?;
        t.add(&k, a);
    }
    Ok(t)
}
// Bulk consumers need totals for a period, not three queries per invoice.
// Stream only the monetary facts and invoice IDs; sums remain exact in i128.
pub(super) fn totals_in_period(
    c: &Connection,
    from: &str,
    until: &str,
) -> Result<std::collections::HashMap<i64, Totals>, String> {
    let mut totals = std::collections::HashMap::<i64, Totals>::new();
    let mut q = c.prepare("SELECT s.invoice_id,s.amount,'installment' FROM card_installments s JOIN card_purchases p ON p.id=s.purchase_id JOIN card_invoices i ON i.id=s.invoice_id WHERE p.status='active' AND i.due_date>=?1 AND i.due_date<?2 UNION ALL SELECT e.invoice_id,e.amount,e.kind FROM invoice_events e JOIN card_invoices i ON i.id=e.invoice_id WHERE e.voided=0 AND i.due_date>=?1 AND i.due_date<?2").map_err(err)?;
    let mut rows = q.query(params![from, until]).map_err(err)?;
    while let Some(r) = rows.next().map_err(err)? {
        let id = r.get(0).map_err(err)?;
        let kind: String = r.get(2).map_err(err)?;
        totals
            .entry(id)
            .or_default()
            .add(&kind, r.get(1).map_err(err)?);
    }
    Ok(totals)
}
pub(super) fn protect_purchase(c: &Connection, id: i64) -> Result<(), String> {
    let linked:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM invoice_events e WHERE e.voided=0 AND (e.purchase_id=?1 OR e.invoice_id IN (SELECT invoice_id FROM card_installments WHERE purchase_id=?1)))",[id],|r|r.get(0)).map_err(err)?;
    if linked {
        return Err("Compra vinculada a pagamentos ou ajustes. Desfaça os eventos antes de editar/cancelar, ou registre um estorno para preservar a liquidação.".into());
    }
    Ok(())
}
fn validate(c: &Connection, p: &EventInput) -> Result<(), String> {
    name_valid(&p.request_key, 120)?;
    if p.request_key.len() < 8 {
        return Err("Identificador de operação inválido.".into());
    }
    validate_id(p.invoice_id)?;
    if let Some(id) = p.id {
        validate_id(id)?;
    }
    if let Some(id) = p.account_id {
        validate_id(id)?;
    }
    if let Some(id) = p.purchase_id {
        validate_id(id)?;
    }
    date_valid(c, &p.date)?;
    name_valid(&p.description, 240)?;
    if !(1..=MAX_CENTS).contains(&p.amount) {
        return Err("Valor deve ser positivo e estar no limite monetário.".into());
    }
    let valid = match p.kind.as_str() {
        "payment" => p.account_id.is_some() && p.purchase_id.is_none(),
        "refund" => p.account_id.is_none() && p.purchase_id.is_some(),
        "credit" | "charge" => p.account_id.is_none() && p.purchase_id.is_none(),
        _ => false,
    };
    if !valid {
        return Err("Tipo ou referências do evento inválidos.".into());
    }
    Ok(())
}
pub(super) fn read(c: &Connection, id: i64) -> Result<Vec<Event>, String> {
    let mut q=c.prepare("SELECT e.id,e.kind,e.account_id,e.purchase_id,e.amount,e.date,e.description,e.voided,a.name,e.created_at,e.updated_at,e.request_key FROM invoice_events e LEFT JOIN accounts a ON a.id=e.account_id WHERE e.invoice_id=?1 ORDER BY e.date,e.id").map_err(err)?;
    let rows = q
        .query_map([id], |r| {
            Ok(Event {
                input: EventInput {
                    id: Some(r.get(0)?),
                    invoice_id: id,
                    kind: r.get(1)?,
                    account_id: r.get(2)?,
                    purchase_id: r.get(3)?,
                    amount: r.get(4)?,
                    date: r.get(5)?,
                    description: r.get(6)?,
                    request_key: r.get(11)?,
                },
                voided: r.get(7)?,
                account_name: r.get(8)?,
                created_at: r.get(9)?,
                updated_at: r.get(10)?,
            })
        })
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    Ok(rows)
}
impl Database {
    pub fn save_invoice_event(&mut self, mut p: EventInput) -> Result<i64, String> {
        p.description = p.description.trim().into();
        validate(&self.connection, &p)?;
        let tx = self.connection.transaction().map_err(err)?;
        if p.id.is_none() {
            let existing: Option<i64> = tx
                .query_row(
                    "SELECT invoice_id FROM invoice_events WHERE request_key=?1",
                    [&p.request_key],
                    |r| r.get(0),
                )
                .optional()
                .map_err(err)?;
            if let Some(invoice_id) = existing {
                let mut event = read(&tx, invoice_id)?
                    .into_iter()
                    .find(|e| e.input.request_key == p.request_key)
                    .ok_or("Operação não encontrada.")?;
                let id = event.input.id.take().ok_or("Evento sem identificador.")?;
                if event.input != p {
                    return Err(
                        "Esta operação já foi registrada com outros dados. Atualize a fatura."
                            .into(),
                    );
                }
                return Ok(id);
            }
        }
        let invoice_card: i64 = tx
            .query_row(
                "SELECT card_id FROM card_invoices WHERE id=?1",
                [p.invoice_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)?
            .ok_or("Fatura não encontrada.")?;
        let old = if let Some(id) = p.id {
            Some(
                read(&tx, p.invoice_id)?
                    .into_iter()
                    .find(|e| e.input.id == Some(id))
                    .ok_or("Evento não encontrado.")?,
            )
        } else {
            None
        };
        if old.as_ref().is_some_and(|e| {
            e.voided
                || e.input.kind != p.kind
                || e.input.purchase_id != p.purchase_id
                || e.input.request_key != p.request_key
        }) {
            return Err("Não altere o tipo/origem de um evento nem edite evento desfeito.".into());
        }
        if let Some(account) = p.account_id {
            let active: Option<bool> = tx
                .query_row("SELECT active FROM accounts WHERE id=?1", [account], |r| {
                    r.get(0)
                })
                .optional()
                .map_err(err)?;
            if active.is_none()
                || (active == Some(false)
                    && old
                        .as_ref()
                        .is_none_or(|e| e.input.account_id != Some(account)))
            {
                return Err("Escolha uma conta ativa ou preserve a conta original.".into());
            }
            let t = totals(&tx, p.invoice_id)?;
            let old_amount = old.as_ref().map_or(0, |e| i128::from(e.input.amount));
            if i128::from(p.amount) > (t.net() - t.paid + old_amount).max(0) {
                return Err("Pagamento excede o restante da fatura. Atualize os valores.".into());
            }
        }
        if let Some(purchase) = p.purchase_id {
            let (card, amount, date, status): (i64, i64, String, String) = tx
                .query_row(
                    "SELECT card_id,amount,date,status FROM card_purchases WHERE id=?1",
                    [purchase],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
                )
                .optional()
                .map_err(err)?
                .ok_or("Compra não encontrada.")?;
            if card != invoice_card || status != "active" || p.date < date {
                return Err("Estorno deve pertencer a compra ativa do mesmo cartão e não anteceder sua data.".into());
            }
            let mut refunded = 0i128;
            let mut q=tx.prepare("SELECT amount FROM invoice_events WHERE purchase_id=?1 AND kind='refund' AND voided=0 AND (?2 IS NULL OR id!=?2)").map_err(err)?;
            for a in q
                .query_map(params![purchase, p.id], |r| r.get::<_, i64>(0))
                .map_err(err)?
            {
                refunded += i128::from(a.map_err(err)?);
            }
            if refunded + i128::from(p.amount) > i128::from(amount) {
                return Err("Estornos somados excedem o total da compra.".into());
            }
        }
        let id = if let Some(id) = p.id {
            tx.execute("UPDATE invoice_events SET account_id=?1,amount=?2,date=?3,description=?4,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?5",params![p.account_id,p.amount,p.date,p.description,id]).map_err(err)?;
            id
        } else {
            tx.execute("INSERT INTO invoice_events(invoice_id,kind,account_id,purchase_id,amount,date,description,request_key) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",params![p.invoice_id,p.kind,p.account_id,p.purchase_id,p.amount,p.date,p.description,p.request_key]).map_err(err)?;
            tx.last_insert_rowid()
        };
        tx.commit().map_err(err)?;
        Ok(id)
    }
    pub fn void_invoice_event(&mut self, id: i64) -> Result<(), String> {
        validate_id(id)?;
        if self.connection.execute("UPDATE invoice_events SET voided=1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?1 AND voided=0",[id]).map_err(err)?!=1{return Err("Evento inexistente ou já desfeito.".into());}
        Ok(())
    }
}
pub(super) fn validate_backup(c: &Connection) -> Result<(), String> {
    let mut q = c.prepare("SELECT id FROM card_invoices").map_err(err)?;
    let ids = q
        .query_map([], |r| r.get::<_, i64>(0))
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    let mut refunds = std::collections::HashMap::<i64, i128>::new();
    for id in ids {
        for e in read(c, id)? {
            validate(c, &e.input)?;
            if !e.voided {
                if let Some(p) = e.input.purchase_id {
                    let valid:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM card_purchases p JOIN card_invoices i ON i.card_id=p.card_id WHERE p.id=?1 AND i.id=?2 AND p.status='active' AND p.date<=?3)",params![p,id,e.input.date],|r|r.get(0)).map_err(err)?;
                    if !valid {
                        return Err("Estorno inconsistente no backup.".into());
                    }
                    *refunds.entry(p).or_default() += i128::from(e.input.amount);
                }
            }
        }
    }
    for (id, refunded) in refunds {
        let amount: i64 = c
            .query_row("SELECT amount FROM card_purchases WHERE id=?1", [id], |r| {
                r.get(0)
            })
            .map_err(err)?;
        if refunded > i128::from(amount) {
            return Err("Estornos excedem a compra no backup.".into());
        }
    }
    Ok(())
}
