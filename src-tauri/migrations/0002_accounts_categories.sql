-- Categorias padrão são cadastros do produto, não transações de demonstração.
WITH defaults(name, type, icon) AS (VALUES
    ('Alimentação', 'expense', 'food'), ('Moradia', 'expense', 'home'),
    ('Transporte', 'expense', 'car'), ('Saúde', 'expense', 'heart'),
    ('Educação', 'expense', 'book'), ('Lazer', 'expense', 'sun'),
    ('Assinaturas', 'expense', 'repeat'), ('Compras', 'expense', 'bag'),
    ('Outros', 'expense', 'tag'), ('Salário', 'income', 'wallet'),
    ('Freelance', 'income', 'briefcase'), ('Rendimentos', 'income', 'chart'),
    ('Reembolso', 'income', 'refund'), ('Outros', 'income', 'tag')
)
INSERT INTO categories(name, type, icon)
SELECT name, type, icon FROM defaults d
WHERE NOT EXISTS (SELECT 1 FROM categories c WHERE c.name = d.name AND c.type = d.type AND c.parent_id IS NULL);

CREATE TRIGGER categories_parent_insert BEFORE INSERT ON categories
WHEN NEW.parent_id IS NOT NULL
BEGIN
    SELECT RAISE(ABORT, 'Categoria principal inexistente ou incompatível.')
    WHERE NOT EXISTS (SELECT 1 FROM categories p WHERE p.id = NEW.parent_id AND p.type = NEW.type AND (NEW.active = 0 OR p.active = 1));
END;

CREATE TRIGGER categories_tree_update BEFORE UPDATE OF parent_id, type, active ON categories
BEGIN
    SELECT RAISE(ABORT, 'Categoria principal inexistente ou incompatível.')
    WHERE NEW.parent_id IS NOT NULL AND NOT EXISTS
        (SELECT 1 FROM categories p WHERE p.id = NEW.parent_id AND p.type = NEW.type AND (NEW.active = 0 OR p.active = 1));
    SELECT RAISE(ABORT, 'A alteração é incompatível com as subcategorias.')
    WHERE EXISTS (SELECT 1 FROM categories c WHERE c.parent_id = NEW.id AND (c.type != NEW.type OR (c.active = 1 AND NEW.active = 0)));
    SELECT RAISE(ABORT, 'Ciclo de categorias não permitido.')
    WHERE NEW.parent_id IN (
        WITH RECURSIVE descendants(id) AS (
            SELECT NEW.id UNION SELECT c.id FROM categories c JOIN descendants d ON c.parent_id = d.id
        ) SELECT id FROM descendants
    );
END;
