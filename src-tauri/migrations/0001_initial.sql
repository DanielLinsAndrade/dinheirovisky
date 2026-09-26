-- Apenas schema: sem cadastros, operações financeiras ou dados de demonstração.
-- Valores monetários em centavos, limitados ao intervalo inteiro seguro do JS.
CREATE TABLE accounts (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
    type TEXT NOT NULL CHECK (type IN ('wallet', 'checking', 'savings', 'digital', 'investment', 'other')),
    initial_balance INTEGER NOT NULL DEFAULT 0 CHECK (initial_balance BETWEEN -9007199254740991 AND 9007199254740991),
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE categories (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
    type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
    parent_id INTEGER REFERENCES categories(id) ON DELETE RESTRICT CHECK (parent_id != id),
    icon TEXT NOT NULL DEFAULT 'tag',
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;
CREATE INDEX idx_categories_parent ON categories(parent_id);

CREATE TABLE recurrences (
    id INTEGER PRIMARY KEY,
    frequency TEXT NOT NULL CHECK (frequency IN ('weekly', 'monthly', 'yearly')),
    interval INTEGER NOT NULL DEFAULT 1 CHECK (interval > 0),
    start_date TEXT NOT NULL CHECK (length(start_date) = 10 AND date(start_date, '+0 days') IS start_date),
    end_date TEXT CHECK (end_date IS NULL OR (length(end_date) = 10 AND date(end_date, '+0 days') IS end_date AND end_date >= start_date)),
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE transactions (
    id INTEGER PRIMARY KEY,
    description TEXT NOT NULL CHECK (length(trim(description)) BETWEEN 1 AND 240),
    amount INTEGER NOT NULL CHECK (amount BETWEEN 1 AND 9007199254740991),
    type TEXT NOT NULL CHECK (type IN ('income', 'expense', 'transfer')),
    date TEXT NOT NULL CHECK (length(date) = 10 AND date(date, '+0 days') IS date),
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    destination_account_id INTEGER REFERENCES accounts(id) ON DELETE RESTRICT,
    category_id INTEGER REFERENCES categories(id) ON DELETE RESTRICT,
    status TEXT NOT NULL CHECK (status IN ('posted', 'pending', 'scheduled')),
    notes TEXT,
    recurrence_id INTEGER REFERENCES recurrences(id) ON DELETE RESTRICT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CHECK (
        (type = 'transfer' AND destination_account_id IS NOT NULL AND destination_account_id != account_id AND category_id IS NULL)
        OR (type IN ('income', 'expense') AND destination_account_id IS NULL)
    )
) STRICT;
CREATE INDEX idx_transactions_account_date ON transactions(account_id, date);
CREATE INDEX idx_transactions_destination_date ON transactions(destination_account_id, date);
CREATE INDEX idx_transactions_date ON transactions(date);
CREATE INDEX idx_transactions_category_date ON transactions(category_id, date);
CREATE INDEX idx_transactions_recurrence ON transactions(recurrence_id);

CREATE TABLE budgets (
    id INTEGER PRIMARY KEY,
    month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
    year INTEGER NOT NULL CHECK (year BETWEEN 1 AND 9999),
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
    limit_amount INTEGER NOT NULL CHECK (limit_amount BETWEEN 0 AND 9007199254740991),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (category_id, year, month)
) STRICT;

CREATE TABLE goals (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
    target_amount INTEGER NOT NULL CHECK (target_amount BETWEEN 1 AND 9007199254740991),
    current_amount INTEGER NOT NULL DEFAULT 0 CHECK (current_amount BETWEEN 0 AND 9007199254740991),
    target_date TEXT CHECK (target_date IS NULL OR (length(target_date) = 10 AND date(target_date, '+0 days') IS target_date)),
    completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE app_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    currency TEXT NOT NULL DEFAULT 'BRL' CHECK (length(currency) = 3),
    locale TEXT NOT NULL DEFAULT 'pt-BR' CHECK (length(trim(locale)) > 0),
    date_format TEXT NOT NULL DEFAULT 'dd/MM/yyyy' CHECK (date_format IN ('dd/MM/yyyy', 'MM/dd/yyyy', 'yyyy-MM-dd')),
    theme TEXT NOT NULL DEFAULT 'system' CHECK (theme IN ('light', 'dark', 'system')),
    financial_month_start INTEGER NOT NULL DEFAULT 1 CHECK (financial_month_start BETWEEN 1 AND 28)
) STRICT;
INSERT INTO app_settings (id) VALUES (1);
