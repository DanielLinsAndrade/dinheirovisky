CREATE TABLE credit_cards (
 id INTEGER PRIMARY KEY CHECK(id BETWEEN 1 AND 9007199254740991),
 name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
 institution TEXT NOT NULL CHECK(length(trim(institution)) BETWEEN 1 AND 120),
 last_four TEXT CHECK(last_four IS NULL OR (length(last_four)=4 AND last_four NOT GLOB '*[^0-9]*')),
 brand TEXT CHECK(brand IS NULL OR length(trim(brand)) BETWEEN 1 AND 120),
 credit_limit INTEGER NOT NULL CHECK(credit_limit BETWEEN 0 AND 9007199254740991),
 closing_day INTEGER NOT NULL CHECK(closing_day BETWEEN 1 AND 31),
 due_day INTEGER NOT NULL CHECK(due_day BETWEEN 1 AND 31),
 default_account_id INTEGER REFERENCES accounts(id) ON DELETE RESTRICT,
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;
CREATE INDEX credit_cards_account ON credit_cards(default_account_id);
