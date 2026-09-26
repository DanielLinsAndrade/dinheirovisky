CREATE TRIGGER budget_expense_insert BEFORE INSERT ON budgets
WHEN NOT EXISTS (SELECT 1 FROM categories WHERE id=NEW.category_id AND type='expense')
BEGIN SELECT RAISE(ABORT, 'Orçamento exige categoria de despesa.'); END;
CREATE TRIGGER budget_expense_update BEFORE UPDATE OF category_id ON budgets
WHEN NOT EXISTS (SELECT 1 FROM categories WHERE id=NEW.category_id AND type='expense')
BEGIN SELECT RAISE(ABORT, 'Orçamento exige categoria de despesa.'); END;
CREATE TRIGGER category_budget_type BEFORE UPDATE OF type ON categories
WHEN NEW.type!='expense' AND EXISTS (SELECT 1 FROM budgets WHERE category_id=OLD.id)
BEGIN SELECT RAISE(ABORT, 'Categoria com orçamento deve permanecer como despesa.'); END;
