CREATE TABLE import_batches (
    request_id TEXT PRIMARY KEY CHECK(length(request_id) BETWEEN 16 AND 100),
    payload_hash TEXT NOT NULL,
    imported_count INTEGER NOT NULL CHECK(imported_count>0),
    created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;
CREATE TABLE import_entries (
    id INTEGER PRIMARY KEY,
    batch_id TEXT NOT NULL REFERENCES import_batches(request_id) ON DELETE RESTRICT,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    external_id TEXT,
    transaction_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL
) STRICT;
CREATE UNIQUE INDEX idx_import_external ON import_entries(account_id,external_id) WHERE external_id IS NOT NULL;
