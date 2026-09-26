CREATE TABLE card_purchases (
 id INTEGER PRIMARY KEY CHECK(id BETWEEN 1 AND 9007199254740991),
 card_id INTEGER NOT NULL REFERENCES credit_cards(id) ON DELETE RESTRICT,
 description TEXT NOT NULL CHECK(length(trim(description)) BETWEEN 1 AND 240),
 date TEXT NOT NULL CHECK(length(date)=10 AND date BETWEEN '0001-01-01' AND '9999-12-31' AND date(date,'+0 days') IS NOT NULL AND date(date,'+0 days')=date),
 amount INTEGER NOT NULL CHECK(amount BETWEEN 1 AND 9007199254740991),
 installment_count INTEGER NOT NULL CHECK(installment_count BETWEEN 1 AND 120 AND installment_count<=amount),
 category_id INTEGER REFERENCES categories(id) ON DELETE RESTRICT,
 merchant_id INTEGER REFERENCES financial_metadata(id) ON DELETE RESTRICT,
 intermediary_id INTEGER REFERENCES financial_metadata(id) ON DELETE RESTRICT,
 channel TEXT CHECK(channel IN ('in_person','online')),
 notes TEXT CHECK(notes IS NULL OR length(notes)<=4000),
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','cancelled')),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;
CREATE INDEX card_purchases_card_date ON card_purchases(card_id,date DESC,id DESC);
CREATE INDEX card_purchases_consumption ON card_purchases(date,category_id) WHERE status='active';
CREATE TRIGGER card_purchase_category_insert BEFORE INSERT ON card_purchases BEGIN
 SELECT CASE WHEN NEW.category_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM categories WHERE id=NEW.category_id AND type='expense') THEN RAISE(ABORT,'Categoria de compra inválida') END;
 SELECT CASE WHEN NEW.merchant_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM financial_metadata WHERE id=NEW.merchant_id AND kind='merchant') THEN RAISE(ABORT,'Estabelecimento inválido') END;
 SELECT CASE WHEN NEW.intermediary_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM financial_metadata WHERE id=NEW.intermediary_id AND kind='intermediary') THEN RAISE(ABORT,'Intermediário inválido') END;
END;
CREATE TRIGGER card_purchase_category_update BEFORE UPDATE ON card_purchases BEGIN
 SELECT CASE WHEN NEW.category_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM categories WHERE id=NEW.category_id AND type='expense') THEN RAISE(ABORT,'Categoria de compra inválida') END;
 SELECT CASE WHEN NEW.merchant_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM financial_metadata WHERE id=NEW.merchant_id AND kind='merchant') THEN RAISE(ABORT,'Estabelecimento inválido') END;
 SELECT CASE WHEN NEW.intermediary_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM financial_metadata WHERE id=NEW.intermediary_id AND kind='intermediary') THEN RAISE(ABORT,'Intermediário inválido') END;
END;
CREATE TRIGGER card_category_preserve BEFORE UPDATE OF type ON categories
WHEN NEW.type!='expense' AND EXISTS(SELECT 1 FROM card_purchases WHERE category_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'Categoria possui histórico de compras'); END;
CREATE TABLE card_invoices (
 id INTEGER PRIMARY KEY CHECK(id BETWEEN 1 AND 9007199254740991),
 card_id INTEGER NOT NULL REFERENCES credit_cards(id) ON DELETE RESTRICT,
 month TEXT NOT NULL CHECK(length(month)=7 AND month BETWEEN '0001-01' AND '9999-12' AND substr(month,6,2) BETWEEN '01' AND '12'),
 closing_day INTEGER NOT NULL CHECK(closing_day BETWEEN 1 AND 31),
 due_day INTEGER NOT NULL CHECK(due_day BETWEEN 1 AND 31),
 closing_date TEXT NOT NULL CHECK(length(closing_date)=10 AND date(closing_date,'+0 days') IS NOT NULL AND date(closing_date,'+0 days')=closing_date AND substr(closing_date,1,7)=month),
 due_date TEXT NOT NULL CHECK(length(due_date)=10 AND date(due_date,'+0 days') IS NOT NULL AND date(due_date,'+0 days')=due_date AND due_date>closing_date AND due_date<='9999-12-31'),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 UNIQUE(card_id,month), UNIQUE(id,card_id)
) STRICT;
CREATE TABLE card_installments (
 id INTEGER PRIMARY KEY CHECK(id BETWEEN 1 AND 9007199254740991),
 purchase_id INTEGER NOT NULL REFERENCES card_purchases(id) ON DELETE RESTRICT,
 invoice_id INTEGER NOT NULL REFERENCES card_invoices(id) ON DELETE RESTRICT,
 number INTEGER NOT NULL CHECK(number BETWEEN 1 AND 120),
 amount INTEGER NOT NULL CHECK(amount BETWEEN 1 AND 9007199254740991),
 UNIQUE(purchase_id,number)
) STRICT;
CREATE INDEX card_installments_invoice ON card_installments(invoice_id);
CREATE TRIGGER card_purchase_preserve_links BEFORE UPDATE OF card_id,installment_count ON card_purchases BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM card_installments s JOIN card_invoices i ON i.id=s.invoice_id WHERE s.purchase_id=OLD.id AND (i.card_id!=NEW.card_id OR s.number>NEW.installment_count)) THEN RAISE(ABORT,'Compra possui parcelas incompatíveis') END;
END;
CREATE TRIGGER card_invoice_preserve_links BEFORE UPDATE OF card_id ON card_invoices BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM card_installments s JOIN card_purchases p ON p.id=s.purchase_id WHERE s.invoice_id=OLD.id AND p.card_id!=NEW.card_id) THEN RAISE(ABORT,'Fatura possui parcelas incompatíveis') END;
END;
CREATE TRIGGER card_installment_insert BEFORE INSERT ON card_installments BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM card_purchases p JOIN card_invoices i ON i.id=NEW.invoice_id WHERE p.id=NEW.purchase_id AND p.card_id=i.card_id AND NEW.number<=p.installment_count) THEN RAISE(ABORT,'Parcela incompatível com compra/fatura') END;
END;
CREATE TRIGGER card_installment_update BEFORE UPDATE ON card_installments BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM card_purchases p JOIN card_invoices i ON i.id=NEW.invoice_id WHERE p.id=NEW.purchase_id AND p.card_id=i.card_id AND NEW.number<=p.installment_count) THEN RAISE(ABORT,'Parcela incompatível com compra/fatura') END;
END;
CREATE TRIGGER card_installment_created AFTER INSERT ON card_installments BEGIN
 UPDATE card_invoices SET updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=NEW.invoice_id;
END;
CREATE TRIGGER card_installment_removed AFTER DELETE ON card_installments BEGIN
 UPDATE card_invoices SET updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=OLD.invoice_id;
END;
CREATE TRIGGER card_purchase_cancelled AFTER UPDATE OF status ON card_purchases BEGIN
 UPDATE card_invoices SET updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id IN (SELECT invoice_id FROM card_installments WHERE purchase_id=NEW.id);
END;
CREATE VIEW economic_movements AS
 SELECT amount,type,date,category_id FROM transactions WHERE status='posted' AND type IN ('income','expense')
 UNION ALL SELECT amount,'expense',date,category_id FROM card_purchases WHERE status='active';
