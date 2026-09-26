CREATE TABLE card_import_entries (
    id INTEGER PRIMARY KEY CHECK(id > 0),
    batch_id TEXT NOT NULL REFERENCES import_batches(request_id) ON DELETE RESTRICT,
    card_id INTEGER NOT NULL REFERENCES credit_cards(id) ON DELETE RESTRICT,
    external_id TEXT CHECK(external_id IS NULL OR length(external_id) BETWEEN 1 AND 2048),
    purchase_id INTEGER REFERENCES card_purchases(id) ON DELETE SET NULL
) STRICT;
CREATE UNIQUE INDEX idx_card_import_external ON card_import_entries(card_id, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX idx_card_import_batch ON card_import_entries(batch_id);
CREATE INDEX idx_purchase_import_match ON card_purchases(card_id, date, amount, installment_count);
