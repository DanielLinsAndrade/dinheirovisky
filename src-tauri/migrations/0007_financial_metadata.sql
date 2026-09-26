CREATE TABLE financial_metadata (
 id INTEGER PRIMARY KEY CHECK(id BETWEEN 1 AND 9007199254740991),
 kind TEXT NOT NULL CHECK(kind IN ('method','merchant','intermediary')),
 name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
 name_key TEXT NOT NULL CHECK(length(name_key) BETWEEN 1 AND 120),
 code TEXT CHECK(code IN ('cash','pix','debit','credit','boleto','transfer','automatic_debit','other')),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 CHECK((kind='method' AND code IS NOT NULL) OR (kind!='method' AND code IS NULL)),
 UNIQUE(kind,name_key)
) STRICT;
INSERT INTO financial_metadata(kind,name,name_key,code) VALUES
 ('method','Dinheiro','dinheiro','cash'),('method','PIX','pix','pix'),
 ('method','Débito','débito','debit'),('method','Crédito','crédito','credit'),
 ('method','Boleto','boleto','boleto'),('method','Transferência','transferência','transfer'),
 ('method','Débito automático','débito automático','automatic_debit'),('method','Outro','outro','other');
ALTER TABLE transactions ADD COLUMN method_id INTEGER REFERENCES financial_metadata(id);
ALTER TABLE transactions ADD COLUMN merchant_id INTEGER REFERENCES financial_metadata(id);
ALTER TABLE transactions ADD COLUMN channel TEXT CHECK(channel IN ('in_person','online'));
ALTER TABLE transactions ADD COLUMN intermediary_id INTEGER REFERENCES financial_metadata(id);
CREATE INDEX transactions_method ON transactions(method_id);
CREATE INDEX transactions_merchant ON transactions(merchant_id);
CREATE INDEX transactions_intermediary ON transactions(intermediary_id);
CREATE TRIGGER transaction_metadata_insert BEFORE INSERT ON transactions BEGIN
 SELECT CASE WHEN (NEW.method_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM financial_metadata WHERE id=NEW.method_id AND kind='method')) OR (NEW.merchant_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM financial_metadata WHERE id=NEW.merchant_id AND kind='merchant')) OR (NEW.intermediary_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM financial_metadata WHERE id=NEW.intermediary_id AND kind='intermediary')) THEN RAISE(ABORT,'Referência de metadado incompatível') END;
END;
CREATE TRIGGER transaction_metadata_update BEFORE UPDATE OF method_id,merchant_id,intermediary_id ON transactions BEGIN
 SELECT CASE WHEN (NEW.method_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM financial_metadata WHERE id=NEW.method_id AND kind='method')) OR (NEW.merchant_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM financial_metadata WHERE id=NEW.merchant_id AND kind='merchant')) OR (NEW.intermediary_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM financial_metadata WHERE id=NEW.intermediary_id AND kind='intermediary')) THEN RAISE(ABORT,'Referência de metadado incompatível') END;
END;
CREATE TRIGGER metadata_kind_immutable BEFORE UPDATE OF kind ON financial_metadata WHEN NEW.kind!=OLD.kind BEGIN SELECT RAISE(ABORT,'Tipo de metadado imutável'); END;
