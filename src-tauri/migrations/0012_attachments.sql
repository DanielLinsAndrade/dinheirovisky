CREATE TABLE attachments (
 id INTEGER PRIMARY KEY CHECK(id BETWEEN 1 AND 9007199254740991),
 transaction_id INTEGER REFERENCES transactions(id) ON DELETE CASCADE,
 purchase_id INTEGER REFERENCES card_purchases(id) ON DELETE RESTRICT,
 document_type TEXT NOT NULL CHECK(document_type IN ('proof','receipt','invoice','other')),
 original_name TEXT NOT NULL CHECK(length(original_name) BETWEEN 1 AND 180),
 internal_name TEXT NOT NULL UNIQUE,
 mime TEXT NOT NULL CHECK(mime IN ('image/png','image/jpeg','image/webp','application/pdf')),
 size INTEGER NOT NULL CHECK(size BETWEEN 1 AND 10485760),
 sha256 TEXT NOT NULL CHECK(length(sha256)=64),
 content BLOB NOT NULL CHECK(length(content)=size),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 CHECK((transaction_id IS NOT NULL AND purchase_id IS NULL) OR (transaction_id IS NULL AND purchase_id IS NOT NULL))
) STRICT;
CREATE INDEX attachments_transaction ON attachments(transaction_id,id);
CREATE INDEX attachments_purchase ON attachments(purchase_id,id);
CREATE UNIQUE INDEX attachments_dedup ON attachments(COALESCE(transaction_id,0),COALESCE(purchase_id,0),sha256);
