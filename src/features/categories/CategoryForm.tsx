import { useState, type FormEvent } from "react";
import { CategoryIcon } from "../../components/CategoryIcon";
import {
  availableParents,
  categoryIcons,
  categoryPath,
  categoryTypes,
  type Category,
  type CategoryInput,
  type CategoryKind,
  type CategoryIconName,
} from "../../domain/catalog";

export function CategoryForm({
  category,
  parent,
  categories,
  busy,
  onSave,
}: {
  category: Category | null;
  parent?: Category;
  categories: Category[];
  busy: boolean;
  onSave: (input: CategoryInput) => Promise<void>;
}) {
  const [name, setName] = useState(category?.name ?? "");
  const [kind, setKind] = useState<CategoryKind>(
    category?.kind ?? parent?.kind ?? "expense",
  );
  const [parentId, setParentId] = useState(
    category?.parentId ?? parent?.id ?? null,
  );
  const [icon, setIcon] = useState<CategoryIconName>(category?.icon ?? "tag");
  const parents = availableParents(
    categories,
    kind,
    category?.id,
    category?.active ?? true,
  );
  async function submit(event: FormEvent) {
    event.preventDefault();
    await onSave({
      id: category?.id ?? null,
      name: name.trim(),
      kind,
      parentId,
      icon,
    });
  }
  return (
    <form onSubmit={submit}>
      <fieldset disabled={busy}>
        <label htmlFor="category-name">Nome da categoria</label>
        <input
          id="category-name"
          required
          maxLength={120}
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoFocus
          autoComplete="off"
        />
        <label htmlFor="category-kind">Tipo de categoria</label>
        <select
          id="category-kind"
          value={kind}
          onChange={(event) => {
            setKind(event.target.value as CategoryKind);
            setParentId(null);
          }}
        >
          {Object.entries(categoryTypes).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <label htmlFor="category-parent">Categoria principal</label>
        <select
          id="category-parent"
          value={parentId ?? ""}
          onChange={(event) =>
            setParentId(
              event.target.value === "" ? null : Number(event.target.value),
            )
          }
        >
          <option value="">Nenhuma — categoria principal</option>
          {parents.map((item) => (
            <option key={item.id} value={item.id}>
              {categoryPath(item, categories)}
              {!item.active ? " (arquivada)" : ""}
            </option>
          ))}
        </select>
        <p className="field-help">
          Subcategorias devem ter o mesmo tipo da categoria principal.
        </p>
        <label htmlFor="category-icon">Ícone</label>
        <div className="icon-picker">
          <CategoryIcon name={icon} />
          <select
            id="category-icon"
            value={icon}
            onChange={(event) =>
              setIcon(event.target.value as CategoryIconName)
            }
          >
            {Object.entries(categoryIcons).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <button className="action primary" type="submit">
          {busy ? "Salvando…" : "Salvar categoria"}
        </button>
      </fieldset>
    </form>
  );
}
