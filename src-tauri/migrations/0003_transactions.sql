CREATE TRIGGER transaction_category_insert BEFORE INSERT ON transactions
WHEN NEW.category_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM categories WHERE id=NEW.category_id AND type=NEW.type)
BEGIN SELECT RAISE(ABORT, 'Categoria incompatível com o tipo da transação.'); END;

CREATE TRIGGER transaction_category_update BEFORE UPDATE OF category_id,type ON transactions
WHEN NEW.category_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM categories WHERE id=NEW.category_id AND type=NEW.type)
BEGIN SELECT RAISE(ABORT, 'Categoria incompatível com o tipo da transação.'); END;

CREATE TRIGGER category_transactions_type BEFORE UPDATE OF type ON categories
WHEN EXISTS (SELECT 1 FROM transactions WHERE category_id=OLD.id AND type!=NEW.type)
BEGIN SELECT RAISE(ABORT, 'Categoria utilizada em transações: o tipo deve ser preservado.'); END;
