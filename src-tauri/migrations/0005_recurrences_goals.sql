-- Modelos separados preservam as recorrências e vínculos do schema original.
CREATE TABLE recurrence_templates (
    recurrence_id INTEGER PRIMARY KEY REFERENCES recurrences(id) ON DELETE RESTRICT,
    description TEXT NOT NULL CHECK(length(trim(description)) BETWEEN 1 AND 240),
    amount INTEGER NOT NULL CHECK(amount BETWEEN 1 AND 9007199254740991),
    type TEXT NOT NULL CHECK(type IN ('income','expense')),
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    category_id INTEGER REFERENCES categories(id) ON DELETE RESTRICT,
    notes TEXT CHECK(notes IS NULL OR length(notes) <= 4000),
    next_index INTEGER NOT NULL DEFAULT 0 CHECK(next_index >= 0),
    ended INTEGER NOT NULL DEFAULT 0 CHECK(ended IN (0,1))
) STRICT;
CREATE TRIGGER recurrence_category_insert BEFORE INSERT ON recurrence_templates
WHEN NEW.category_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM categories WHERE id=NEW.category_id AND type=NEW.type)
BEGIN SELECT RAISE(ABORT,'A categoria deve ter o mesmo tipo da recorrência.'); END;
CREATE TRIGGER recurrence_category_update BEFORE UPDATE ON recurrence_templates
WHEN NEW.category_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM categories WHERE id=NEW.category_id AND type=NEW.type)
BEGIN SELECT RAISE(ABORT,'A categoria deve ter o mesmo tipo da recorrência.'); END;
CREATE TRIGGER category_recurrence_type BEFORE UPDATE OF type ON categories
WHEN EXISTS(SELECT 1 FROM recurrence_templates WHERE category_id=NEW.id AND type!=NEW.type)
BEGIN SELECT RAISE(ABORT,'Categoria utilizada por recorrência de outro tipo.'); END;

-- O registro sobrevive à exclusão/edição da transação e impede recriação.
CREATE TABLE recurrence_occurrences (
    recurrence_id INTEGER NOT NULL REFERENCES recurrences(id) ON DELETE RESTRICT,
    occurrence_date TEXT NOT NULL CHECK(length(occurrence_date)=10 AND date(occurrence_date,'+0 days') IS occurrence_date),
    transaction_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
    PRIMARY KEY(recurrence_id, occurrence_date)
) STRICT;
CREATE TABLE goal_contributions (
    id INTEGER PRIMARY KEY,
    goal_id INTEGER NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    amount INTEGER NOT NULL CHECK(amount BETWEEN 1 AND 9007199254740991),
    date TEXT NOT NULL CHECK(length(date)=10 AND date(date,'+0 days') IS date AND substr(date,1,4)!='0000'),
    created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;
CREATE INDEX idx_goal_contributions_goal ON goal_contributions(goal_id);
INSERT INTO goal_contributions(goal_id,amount,date)
SELECT id,current_amount,date('now') FROM goals WHERE current_amount>0;
UPDATE goals SET completed=(current_amount>=target_amount);
