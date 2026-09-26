CREATE TABLE invoice_events (
 id INTEGER PRIMARY KEY CHECK(id BETWEEN 1 AND 9007199254740991),
 request_key TEXT NOT NULL UNIQUE CHECK(length(request_key) BETWEEN 8 AND 120),
 invoice_id INTEGER NOT NULL REFERENCES card_invoices(id) ON DELETE RESTRICT,
 kind TEXT NOT NULL CHECK(kind IN ('payment','refund','credit','charge')),
 account_id INTEGER REFERENCES accounts(id) ON DELETE RESTRICT,
 purchase_id INTEGER REFERENCES card_purchases(id) ON DELETE RESTRICT,
 amount INTEGER NOT NULL CHECK(amount BETWEEN 1 AND 9007199254740991),
 date TEXT NOT NULL CHECK(length(date)=10 AND date BETWEEN '0001-01-01' AND '9999-12-31' AND date(date,'+0 days') IS NOT NULL AND date(date,'+0 days')=date),
 description TEXT NOT NULL CHECK(length(trim(description)) BETWEEN 1 AND 240),
 voided INTEGER NOT NULL DEFAULT 0 CHECK(voided IN (0,1)),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 CHECK((kind='payment' AND account_id IS NOT NULL AND purchase_id IS NULL) OR
       (kind='refund' AND account_id IS NULL AND purchase_id IS NOT NULL) OR
       (kind IN ('credit','charge') AND account_id IS NULL AND purchase_id IS NULL))
) STRICT;
CREATE INDEX invoice_events_invoice ON invoice_events(invoice_id,voided);
CREATE INDEX invoice_events_account ON invoice_events(account_id,date) WHERE voided=0;
CREATE INDEX invoice_events_purchase ON invoice_events(purchase_id) WHERE voided=0;
CREATE TRIGGER invoice_event_insert BEFORE INSERT ON invoice_events WHEN NEW.purchase_id IS NOT NULL BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM card_purchases p JOIN card_invoices i ON i.card_id=p.card_id WHERE p.id=NEW.purchase_id AND i.id=NEW.invoice_id AND p.status='active' AND NEW.date>=p.date) THEN RAISE(ABORT,'Estorno incompatível com compra') END;
END;
CREATE TRIGGER invoice_event_update BEFORE UPDATE ON invoice_events WHEN NEW.purchase_id IS NOT NULL AND NEW.voided=0 BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM card_purchases p JOIN card_invoices i ON i.card_id=p.card_id WHERE p.id=NEW.purchase_id AND i.id=NEW.invoice_id AND p.status='active' AND NEW.date>=p.date) THEN RAISE(ABORT,'Estorno incompatível com compra') END;
END;
CREATE TRIGGER invoice_event_created AFTER INSERT ON invoice_events BEGIN
 UPDATE card_invoices SET updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=NEW.invoice_id;
END;
CREATE TRIGGER invoice_event_changed AFTER UPDATE ON invoice_events BEGIN
 UPDATE card_invoices SET updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id IN (OLD.invoice_id,NEW.invoice_id);
END;
DROP VIEW economic_movements;
CREATE VIEW economic_movements AS
 SELECT amount,type,date,category_id FROM transactions WHERE status='posted' AND type IN ('income','expense')
 UNION ALL SELECT amount,'expense',date,category_id FROM card_purchases WHERE status='active'
 UNION ALL SELECT CASE WHEN e.kind='charge' THEN e.amount ELSE -e.amount END,'expense',e.date,p.category_id
 FROM invoice_events e LEFT JOIN card_purchases p ON p.id=e.purchase_id WHERE e.voided=0 AND e.kind!='payment';
CREATE VIEW cash_movements AS
 SELECT type,amount,date,account_id,destination_account_id,category_id FROM transactions WHERE status='posted'
 UNION ALL SELECT 'invoice_payment',amount,date,account_id,NULL,NULL FROM invoice_events WHERE kind='payment' AND voided=0;
