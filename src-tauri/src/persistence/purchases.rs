use super::{
    metadata,
    planning::{date_valid, name_valid},
    Database,
};
use crate::domain::{
    cards::{cycle, split},
    period::{month_index, month_name},
    validate_id,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
#[cfg(test)]
mod tests;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PurchaseInput {
    pub id: Option<i64>,
    pub card_id: i64,
    pub description: String,
    pub date: String,
    pub amount: i64,
    pub installment_count: i64,
    pub category_id: Option<i64>,
    pub merchant: Option<String>,
    pub intermediary: Option<String>,
    pub channel: Option<String>,
    pub notes: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Purchase {
    #[serde(flatten)]
    pub input: PurchaseInput,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PurchasePage {
    pub items: Vec<Purchase>,
    pub total: i64,
    pub page: i64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Invoice {
    pub id: i64,
    pub month: String,
    pub closing_date: String,
    pub due_date: String,
    pub charges: String,
    pub credits: String,
    pub net: String,
    pub paid: String,
    pub remaining: String,
    pub credit_balance: String,
    pub state: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Installment {
    pub purchase_id: i64,
    pub description: String,
    pub number: i64,
    pub count: i64,
    pub amount: i64,
    pub status: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceDetail {
    pub invoice: Invoice,
    pub items: Vec<Installment>,
    pub events: Vec<super::invoice_events::Event>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InvoicePage {
    pub items: Vec<Invoice>,
    pub total: i64,
    pub page: i64,
    pub committed: String,
    pub available: String,
}
fn err(e: rusqlite::Error) -> String {
    e.to_string()
}
fn validate(c: &Connection, p: &PurchaseInput) -> Result<(), String> {
    validate_id(p.card_id)?;
    if let Some(id) = p.id {
        validate_id(id)?;
    }
    if let Some(id) = p.category_id {
        validate_id(id)?;
    }
    name_valid(&p.description, 240)?;
    date_valid(c, &p.date)?;
    split(p.amount, p.installment_count)?;
    if p.notes.as_ref().is_some_and(|s| s.chars().count() > 4000) {
        return Err("Observações devem ter até 4000 caracteres.".into());
    }
    if p.channel
        .as_deref()
        .is_some_and(|s| !["in_person", "online"].contains(&s))
    {
        return Err("Modalidade inválida.".into());
    }
    Ok(())
}
fn dates(
    c: &Connection,
    card: i64,
    index: i32,
    closing: i64,
    due: i64,
) -> Result<crate::domain::cards::CardDates, String> {
    if !(0..=119987).contains(&index) {
        return Err("Parcelas ultrapassam o calendário suportado.".into());
    }
    let month = month_name(index);
    let existing = c
        .prepare_cached(
            "SELECT closing_date,due_date FROM card_invoices WHERE card_id=?1 AND month=?2",
        )
        .map_err(err)?
        .query_row(params![card, month], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })
        .optional()
        .map_err(err)?;
    match existing {
        Some((closing_date, due_date)) => Ok(crate::domain::cards::CardDates {
            month,
            closing_date,
            due_date,
        }),
        None => cycle(index, closing, due),
    }
}
pub(super) fn validate_import_purchase(
    c: &Connection,
    p: &PurchaseInput,
) -> Result<String, String> {
    validate(c, p)?;
    if p.id.is_some() {
        return Err("Importação não edita compras existentes.".into());
    }
    let (closing, due): (i64, i64) = c
        .prepare_cached("SELECT closing_day,due_day FROM credit_cards WHERE id=?1 AND active=1")
        .map_err(err)?
        .query_row([p.card_id], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()
        .map_err(err)?
        .ok_or("Escolha um cartão ativo.")?;
    if let Some(category) = p.category_id {
        let valid: bool = c.query_row("SELECT EXISTS(SELECT 1 FROM categories WHERE id=?1 AND active=1 AND type='expense')", [category], |r| r.get(0)).map_err(err)?;
        if !valid {
            return Err("Escolha uma categoria de despesa ativa.".into());
        }
    }
    metadata::validate_new_details(
        c,
        &metadata::Details {
            merchant: p.merchant.clone(),
            intermediary: p.intermediary.clone(),
            channel: p.channel.clone(),
            ..Default::default()
        },
    )?;
    let mut first = month_index(&p.date[..7])?;
    if p.date > dates(c, p.card_id, first, closing, due)?.closing_date {
        first += 1;
    }
    dates(
        c,
        p.card_id,
        first + p.installment_count as i32 - 1,
        closing,
        due,
    )?;
    Ok(dates(c, p.card_id, first, closing, due)?.month)
}
pub(super) fn write_purchase_in(tx: &Connection, mut p: PurchaseInput) -> Result<i64, String> {
    p.description = p.description.trim().into();
    validate(tx, &p)?;
    let previous = if let Some(id) = p.id {
        super::invoice_events::protect_purchase(tx, id)?;
        Some(tx.query_row("SELECT card_id,category_id,merchant_id,intermediary_id,status FROM card_purchases WHERE id=?1",[id],|r|Ok((r.get::<_,i64>(0)?,r.get::<_,Option<i64>>(1)?,r.get::<_,Option<i64>>(2)?,r.get::<_,Option<i64>>(3)?,r.get::<_,String>(4)?))).optional().map_err(err)?.ok_or("Compra não encontrada.")?)
    } else {
        None
    };
    if previous.as_ref().is_some_and(|v| v.4 != "active") {
        return Err("Compra cancelada não pode ser editada.".into());
    }
    let (active, closing, due): (bool, i64, i64) = tx
        .query_row(
            "SELECT active,closing_day,due_day FROM credit_cards WHERE id=?1",
            [p.card_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()
        .map_err(err)?
        .ok_or("Cartão não encontrado.")?;
    if !active && previous.as_ref().is_none_or(|v| v.0 != p.card_id) {
        return Err("Reative o cartão antes de registrar uma compra.".into());
    }
    if let Some(category) = p.category_id {
        let valid:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM categories WHERE id=?1 AND type='expense' AND (active=1 OR id=?2))",params![category,previous.as_ref().and_then(|v|v.1)],|r|r.get(0)).map_err(err)?;
        if !valid {
            return Err("Escolha uma categoria de despesa ativa ou preserve a atual.".into());
        }
    }
    let merchant = metadata::resolve(
        tx,
        "merchant",
        &p.merchant,
        previous.as_ref().and_then(|v| v.2),
    )?;
    let intermediary = metadata::resolve(
        tx,
        "intermediary",
        &p.intermediary,
        previous.as_ref().and_then(|v| v.3),
    )?;
    let mut first = month_index(&p.date[..7])?;
    if p.date > dates(tx, p.card_id, first, closing, due)?.closing_date {
        first += 1;
    }
    let schedule = split(p.amount, p.installment_count)?
        .into_iter()
        .enumerate()
        .map(|(n, amount)| {
            Ok((
                n as i64 + 1,
                amount,
                dates(tx, p.card_id, first + n as i32, closing, due)?,
            ))
        })
        .collect::<Result<Vec<_>, String>>()?;
    let id = if let Some(id) = p.id {
        // Only unpaid installments exist in this stage. Future payments must
        // add an explicit edit policy before modifying these obligations.
        tx.execute("DELETE FROM card_installments WHERE purchase_id=?1", [id])
            .map_err(err)?;
        tx.execute("UPDATE card_purchases SET card_id=?1,description=?2,date=?3,amount=?4,installment_count=?5,category_id=?6,merchant_id=?7,intermediary_id=?8,channel=?9,notes=?10,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?11",params![p.card_id,p.description,p.date,p.amount,p.installment_count,p.category_id,merchant,intermediary,p.channel,p.notes,id]).map_err(err)?;
        id
    } else {
        tx.execute("INSERT INTO card_purchases(card_id,description,date,amount,installment_count,category_id,merchant_id,intermediary_id,channel,notes) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",params![p.card_id,p.description,p.date,p.amount,p.installment_count,p.category_id,merchant,intermediary,p.channel,p.notes]).map_err(err)?;
        tx.last_insert_rowid()
    };
    for (number, amount, d) in schedule {
        tx.execute("INSERT INTO card_invoices(card_id,month,closing_day,due_day,closing_date,due_date) VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT(card_id,month) DO NOTHING",params![p.card_id,d.month,closing,due,d.closing_date,d.due_date]).map_err(err)?;
        let invoice: i64 = tx
            .query_row(
                "SELECT id FROM card_invoices WHERE card_id=?1 AND month=?2",
                params![p.card_id, d.month],
                |r| r.get(0),
            )
            .map_err(err)?;
        tx.execute("INSERT INTO card_installments(purchase_id,invoice_id,number,amount) VALUES(?1,?2,?3,?4)",params![id,invoice,number,amount]).map_err(err)?;
    }

    Ok(id)
}

impl Database {
    pub fn save_purchase(&mut self, p: PurchaseInput) -> Result<i64, String> {
        let tx = self.connection.transaction().map_err(err)?;
        let id = write_purchase_in(&tx, p)?;
        tx.commit().map_err(err)?;
        Ok(id)
    }
    pub fn cancel_purchase(&mut self, id: i64) -> Result<(), String> {
        validate_id(id)?;
        super::invoice_events::protect_purchase(&self.connection, id)?;
        if self.connection.execute("UPDATE card_purchases SET status='cancelled',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?1 AND status='active'",[id]).map_err(err)?!=1 { return Err("Compra inexistente ou já cancelada.".into()); }
        Ok(())
    }
    pub fn purchases(&self, card_id: i64, page: i64) -> Result<PurchasePage, String> {
        validate_id(card_id)?;
        if !(0..=1_000_000).contains(&page) {
            return Err("Página inválida.".into());
        }
        let snapshot = self.connection.unchecked_transaction().map_err(err)?;
        let total: i64 = snapshot
            .query_row(
                "SELECT count(*) FROM card_purchases WHERE card_id=?1",
                [card_id],
                |r| r.get(0),
            )
            .map_err(err)?;
        let page = page.min((total - 1).max(0) / 50);
        let mut q=snapshot.prepare("SELECT p.id,p.description,p.date,p.amount,p.installment_count,p.category_id,m.name,i.name,p.channel,p.notes,p.status,p.created_at,p.updated_at FROM card_purchases p LEFT JOIN financial_metadata m ON m.id=p.merchant_id LEFT JOIN financial_metadata i ON i.id=p.intermediary_id WHERE p.card_id=?1 ORDER BY p.date DESC,p.id DESC LIMIT 50 OFFSET ?2").map_err(err)?;
        let items = q
            .query_map(params![card_id, page * 50], |r| {
                Ok(Purchase {
                    input: PurchaseInput {
                        id: Some(r.get(0)?),
                        card_id,
                        description: r.get(1)?,
                        date: r.get(2)?,
                        amount: r.get(3)?,
                        installment_count: r.get(4)?,
                        category_id: r.get(5)?,
                        merchant: r.get(6)?,
                        intermediary: r.get(7)?,
                        channel: r.get(8)?,
                        notes: r.get(9)?,
                    },
                    status: r.get(10)?,
                    created_at: r.get(11)?,
                    updated_at: r.get(12)?,
                })
            })
            .map_err(err)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(err)?;
        drop(q);
        snapshot.commit().map_err(err)?;
        Ok(PurchasePage { items, total, page })
    }
    pub fn invoices(&self, card_id: i64, today: &str, page: i64) -> Result<InvoicePage, String> {
        validate_id(card_id)?;
        date_valid(&self.connection, today)?;
        if !(0..=1_000_000).contains(&page) {
            return Err("Página inválida.".into());
        }
        let snapshot = self.connection.unchecked_transaction().map_err(err)?;
        let limit: i64 = snapshot
            .query_row(
                "SELECT credit_limit FROM credit_cards WHERE id=?1",
                [card_id],
                |r| r.get(0),
            )
            .map_err(err)?;
        let total: i64 = snapshot
            .query_row(
                "SELECT count(*) FROM card_invoices WHERE card_id=?1",
                [card_id],
                |r| r.get(0),
            )
            .map_err(err)?;
        let page = page.min((total - 1).max(0) / 24);
        let mut q=snapshot.prepare("SELECT id FROM card_invoices WHERE card_id=?1 ORDER BY month DESC LIMIT 24 OFFSET ?2").map_err(err)?;
        let ids = q
            .query_map(params![card_id, page * 24], |r| r.get::<_, i64>(0))
            .map_err(err)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(err)?;
        let items = ids
            .into_iter()
            .map(|id| invoice(&snapshot, id, today))
            .collect::<Result<Vec<_>, _>>()?;
        drop(q);
        let mut q = snapshot
            .prepare("SELECT id FROM card_invoices WHERE card_id=?1")
            .map_err(err)?;
        let mut committed = 0i128;
        for amount in q
            .query_map([card_id], |r| r.get::<_, i64>(0))
            .map_err(err)?
        {
            committed +=
                super::invoice_events::totals(&snapshot, amount.map_err(err)?)?.remaining();
        }
        drop(q);
        snapshot.commit().map_err(err)?;
        Ok(InvoicePage {
            items,
            total,
            page,
            committed: committed.to_string(),
            available: (i128::from(limit) - committed).to_string(),
        })
    }
    pub fn invoice_detail(&self, id: i64, today: &str) -> Result<InvoiceDetail, String> {
        validate_id(id)?;
        date_valid(&self.connection, today)?;
        let snapshot = self.connection.unchecked_transaction().map_err(err)?;
        let invoice = invoice(&snapshot, id, today)?;
        let mut q=snapshot.prepare("SELECT p.id,p.description,s.number,p.installment_count,s.amount,p.status FROM card_installments s JOIN card_purchases p ON p.id=s.purchase_id WHERE s.invoice_id=?1 ORDER BY p.date,p.id,s.number").map_err(err)?;
        let items = q
            .query_map([id], |r| {
                Ok(Installment {
                    purchase_id: r.get(0)?,
                    description: r.get(1)?,
                    number: r.get(2)?,
                    count: r.get(3)?,
                    amount: r.get(4)?,
                    status: r.get(5)?,
                })
            })
            .map_err(err)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(err)?;
        drop(q);
        let events = super::invoice_events::read(&snapshot, id)?;
        snapshot.commit().map_err(err)?;
        Ok(InvoiceDetail {
            invoice,
            items,
            events,
        })
    }
}
fn invoice(c: &Connection, id: i64, today: &str) -> Result<Invoice, String> {
    let (month, closing_date, due_date): (String, String, String) = c
        .query_row(
            "SELECT month,closing_date,due_date FROM card_invoices WHERE id=?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(err)?;
    let total = super::invoice_events::totals(c, id)?;
    let state = if total.remaining() == 0 && (total.paid > 0 || total.credits > 0) {
        "paid"
    } else if total.remaining() > 0 && today > due_date.as_str() {
        "overdue"
    } else if total.paid > 0 {
        "partial"
    } else if today > closing_date.as_str() {
        "closed"
    } else {
        "open"
    }
    .into();
    Ok(Invoice {
        id,
        month,
        closing_date,
        due_date,
        charges: total.charges.to_string(),
        credits: total.credits.to_string(),
        net: total.net().to_string(),
        paid: total.paid.to_string(),
        remaining: total.remaining().to_string(),
        credit_balance: total.credit_balance().to_string(),
        state,
    })
}

pub(super) fn validate_backup(c: &Connection) -> Result<(), String> {
    let mut q=c.prepare("SELECT id,card_id,description,date,amount,installment_count,category_id,channel,notes FROM card_purchases").map_err(err)?;
    let mut rows = q.query([]).map_err(err)?;
    while let Some(r) = rows.next().map_err(err)? {
        let p = PurchaseInput {
            id: Some(r.get(0).map_err(err)?),
            card_id: r.get(1).map_err(err)?,
            description: r.get(2).map_err(err)?,
            date: r.get(3).map_err(err)?,
            amount: r.get(4).map_err(err)?,
            installment_count: r.get(5).map_err(err)?,
            category_id: r.get(6).map_err(err)?,
            channel: r.get(7).map_err(err)?,
            notes: r.get(8).map_err(err)?,
            merchant: None,
            intermediary: None,
        };
        validate(c, &p)?;
        let expected = split(p.amount, p.installment_count)?;
        let mut s=c.prepare("SELECT s.number,s.amount,i.card_id,i.month FROM card_installments s JOIN card_invoices i ON i.id=s.invoice_id WHERE s.purchase_id=?1 ORDER BY s.number").map_err(err)?;
        let parts = s
            .query_map([p.id], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, i64>(2)?,
                    r.get::<_, String>(3)?,
                ))
            })
            .map_err(err)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(err)?;
        if parts.len() != expected.len() {
            return Err("Quantidade de parcelas inconsistente.".into());
        }
        let first = month_index(&parts[0].3)?;
        let purchase_month = month_index(&p.date[..7])?;
        let first_closing:String=c.query_row("SELECT i.closing_date FROM card_installments s JOIN card_invoices i ON i.id=s.invoice_id WHERE s.purchase_id=?1 AND s.number=1",[p.id],|r|r.get(0)).map_err(err)?;
        if first < purchase_month || first > purchase_month + 1 || first_closing < p.date {
            return Err("Primeiro ciclo incompatível com a data da compra.".into());
        }
        for (n, part) in parts.iter().enumerate() {
            if part.0 != n as i64 + 1
                || part.1 != expected[n]
                || part.2 != p.card_id
                || month_index(&part.3)? != first + n as i32
            {
                return Err("Parcelamento inconsistente no backup.".into());
            }
        }
    }
    let mut q = c
        .prepare("SELECT month,closing_day,due_day,closing_date,due_date FROM card_invoices")
        .map_err(err)?;
    let mut rows = q.query([]).map_err(err)?;
    while let Some(r) = rows.next().map_err(err)? {
        let d = cycle(
            month_index(&r.get::<_, String>(0).map_err(err)?)?,
            r.get(1).map_err(err)?,
            r.get(2).map_err(err)?,
        )?;
        if d.closing_date != r.get::<_, String>(3).map_err(err)?
            || d.due_date != r.get::<_, String>(4).map_err(err)?
        {
            return Err("Calendário de fatura inconsistente.".into());
        }
    }
    let invalid:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM card_purchases p LEFT JOIN categories c ON c.id=p.category_id LEFT JOIN financial_metadata m ON m.id=p.merchant_id LEFT JOIN financial_metadata i ON i.id=p.intermediary_id WHERE (p.category_id IS NOT NULL AND c.type!='expense') OR (p.merchant_id IS NOT NULL AND m.kind!='merchant') OR (p.intermediary_id IS NOT NULL AND i.kind!='intermediary'))",[],|r|r.get(0)).map_err(err)?;
    if invalid {
        return Err("Referências da compra incompatíveis.".into());
    }
    Ok(())
}
