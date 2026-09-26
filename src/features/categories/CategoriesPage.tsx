import { Badge } from "../../components/Surface";
import { useState } from "react";
import { Editor } from "../../components/Editor";
import { CategoryIcon } from "../../components/CategoryIcon";
import {
  categoryPath,
  categoryTypes,
  type Category,
  type CategoryInput,
} from "../../domain/catalog";
import {
  listCategories,
  saveCategory,
  setCategoryActive,
} from "../../services/catalog";
import { useCatalog } from "../useCatalog";
import { CategoryForm } from "./CategoryForm";

export function CategoriesPage() {
  const catalog = useCatalog(listCategories);
  const [filter, setFilter] = useState("active");
  const [kind, setKind] = useState("all");
  const [editor, setEditor] = useState<{
    item: Category | null;
    parent?: Category;
  } | null>(null);
  const categories = catalog.items ?? [];
  const visible = categories
    .filter(
      (item) =>
        (filter === "all" || item.active === (filter === "active")) &&
        (kind === "all" || item.kind === kind),
    )
    .sort((a, b) =>
      categoryPath(a, categories).localeCompare(
        categoryPath(b, categories),
        "pt-BR",
      ),
    );
  function edit(item: Category | null, parent?: Category) {
    catalog.clearFeedback();
    setEditor({ item, parent });
  }
  async function save(input: CategoryInput) {
    if (await catalog.mutate(() => saveCategory(input), "Categoria salva."))
      setEditor(null);
  }
  return (
    <section aria-label="Cadastro de categorias">
      <div className="page-tools">
        <p className="intro">Organize receitas e despesas por assunto.</p>
        <button
          className="action primary"
          disabled={catalog.busy || !catalog.items}
          onClick={() => edit(null)}
        >
          Nova categoria
        </button>
      </div>
      <div className="list-tools">
        <label>
          Exibir{" "}
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          >
            <option value="active">Ativas</option>
            <option value="archived">Arquivadas</option>
            <option value="all">Todas</option>
          </select>
        </label>
        <label>
          Tipo{" "}
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value)}
          >
            <option value="all">Receitas e despesas</option>
            <option value="income">Receitas</option>
            <option value="expense">Despesas</option>
          </select>
        </label>
        <button
          className="action"
          disabled={catalog.busy}
          onClick={catalog.reload}
        >
          Atualizar categorias
        </button>
      </div>
      {catalog.notice && (
        <p role="status" className="success-message">
          {catalog.notice}
        </p>
      )}
      {catalog.error && !editor && (
        <p role="alert" className="form-error">
          {catalog.error}
        </p>
      )}
      {catalog.busy && !catalog.items && (
        <p role="status">Carregando categorias…</p>
      )}
      {catalog.items && (
        <div className="table-scroll">
          <table>
            <caption className="sr-only">Categorias cadastradas</caption>
            <thead>
              <tr>
                <th>Nome</th>
                <th>Tipo</th>
                <th>Situação</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((item) => (
                <tr key={item.id}>
                  <th scope="row">
                    <span className="category-name">
                      <CategoryIcon name={item.icon} />
                      <span>
                        {item.name}
                        {item.parentId !== null && (
                          <small>{categoryPath(item, categories)}</small>
                        )}
                      </span>
                    </span>
                  </th>
                  <td>{categoryTypes[item.kind]}</td>
                  <td>
                    <Badge tone={item.active ? "positive" : "neutral"}>
                      {item.active ? "Ativa" : "Arquivada"}
                    </Badge>
                  </td>
                  <td className="row-actions">
                    <button
                      className="text-action"
                      disabled={catalog.busy}
                      aria-label={`Editar ${categoryPath(item, categories)} (${categoryTypes[item.kind]})`}
                      onClick={() => edit(item)}
                    >
                      Editar
                    </button>
                    {item.active && (
                      <button
                        className="text-action"
                        disabled={catalog.busy}
                        aria-label={`Criar subcategoria de ${categoryPath(item, categories)} (${categoryTypes[item.kind]})`}
                        onClick={() => edit(null, item)}
                      >
                        Subcategoria
                      </button>
                    )}
                    <button
                      className="text-action"
                      disabled={catalog.busy}
                      aria-label={`${item.active ? "Arquivar" : "Reativar"} ${categoryPath(item, categories)} (${categoryTypes[item.kind]})`}
                      onClick={() =>
                        void catalog.mutate(
                          () => setCategoryActive(item.id, !item.active),
                          item.active
                            ? "Categoria arquivada. Consulte Arquivadas para reativar."
                            : "Categoria reativada.",
                        )
                      }
                    >
                      {item.active ? "Arquivar" : "Reativar"}
                    </button>
                  </td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={4} className="empty-row">
                    Nenhuma categoria neste filtro.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {editor && (
        <Editor
          modal={false}
          title={
            editor.item
              ? "Editar categoria"
              : editor.parent
                ? "Nova subcategoria"
                : "Nova categoria"
          }
          busy={catalog.busy}
          error={catalog.error}
          onClose={() => {
            setEditor(null);
            catalog.clearFeedback();
          }}
        >
          <CategoryForm
            category={editor.item}
            parent={editor.parent}
            categories={categories}
            busy={catalog.busy}
            onSave={save}
          />
        </Editor>
      )}
    </section>
  );
}
