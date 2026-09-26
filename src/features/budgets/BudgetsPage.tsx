import { Badge } from "../../components/Surface";
import {
  useCallback,
  useEffect,
  useState,
  useRef,
  type FormEvent,
} from "react";
import { useFormatting } from "../../app/SettingsContext";
import { financialMonth } from "../../domain/settings";
import { localDate } from "../../domain/transactions";
import { categoryPath, type Category } from "../../domain/catalog";
import { barPercent } from "../../domain/dashboard";
import { listCategories } from "../../services/catalog";
import {
  listBudgets,
  saveBudget,
  deleteBudget,
  copyBudgets,
  type Budget,
} from "../../services/budgets";
import { Editor } from "../../components/Editor";
import { useCatalog } from "../useCatalog";
export function BudgetsPage({
  initialMonth,
  initialCategoryId,
}: {
  initialMonth?: string;
  initialCategoryId?: number;
}) {
  const { settings } = useFormatting();
  const [month, setMonth] = useState(
    () =>
      initialMonth ?? financialMonth(localDate(), settings.financialMonthStart),
  );
  const monthControl = (
    <label className="budget-month">
      Mês do orçamento
      <input
        type="month"
        min="0001-01"
        max="9999-12"
        value={month}
        onChange={(e) => setMonth(e.target.value)}
      />
    </label>
  );
  return (
    <section className="budget-page" aria-label="Orçamento mensal">
      <div className="page-tools">
        <p className="intro">Planeje seus gastos por categoria.</p>
        {monthControl}
      </div>
      <p className="field-help">
        Período do dia {settings.financialMonthStart} do mês selecionado até
        antes do dia {settings.financialMonthStart} do mês seguinte. Cada
        categoria contabiliza apenas lançamentos próprios, sem somar
        subcategorias. Somente despesas efetivadas, inclusive de contas
        arquivadas.
      </p>
      {/^\d{4}-(0[1-9]|1[0-2])$/.test(month) && !month.startsWith("0000") ? (
        <BudgetList
          key={`${month}-${settings.financialMonthStart}`}
          month={month}
          initialCategoryId={initialCategoryId}
        />
      ) : (
        <p role="alert">Selecione um mês válido.</p>
      )}
    </section>
  );
}
function BudgetList({
  month,
  initialCategoryId,
}: {
  month: string;
  initialCategoryId?: number;
}) {
  const { formatMoney, parseMoney, moneyInput, currencyLabel, settings } =
    useFormatting();
  const load = useCallback(() => listBudgets(month), [month]);
  const catalog = useCatalog(load);
  const targetOpened = useRef(false);
  const [categories, setCategories] = useState<Category[]>([]),
    [categoryError, setCategoryError] = useState(""),
    [revision, setRevision] = useState(0),
    [editing, setEditing] = useState<Budget | null | undefined>(),
    [categoryId, setCategoryId] = useState(""),
    [limit, setLimit] = useState(""),
    [formError, setFormError] = useState(""),
    [deleting, setDeleting] = useState<Budget | null>(null);
  useEffect(() => {
    if (
      targetOpened.current ||
      initialCategoryId === undefined ||
      !catalog.items
    )
      return;
    const budget = catalog.items.find(
      (b) => b.categoryId === initialCategoryId,
    );
    if (budget) {
      targetOpened.current = true;
      setEditing(budget);
      setCategoryId(String(budget.categoryId));
      setLimit(moneyInput(budget.limitAmount));
    }
  }, [initialCategoryId, catalog.items, moneyInput]);
  useEffect(() => {
    let active = true;
    setCategoryError("");
    listCategories().then(
      (c) => {
        if (active) setCategories(c);
      },
      (e) => {
        if (active) setCategoryError(String(e));
      },
    );
    return () => {
      active = false;
    };
  }, [revision]);
  function edit(budget: Budget | null) {
    catalog.clearFeedback();
    setFormError("");
    setEditing(budget);
    setCategoryId(budget ? String(budget.categoryId) : "");
    setLimit(budget ? moneyInput(budget.limitAmount) : "");
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    setFormError("");
    try {
      const value = parseMoney(limit);
      if (value < 0) throw new Error("O limite não pode ser negativo.");
      if (
        await catalog.mutate(
          () => saveBudget(month, Number(categoryId), value),
          "Orçamento salvo.",
        )
      )
        setEditing(undefined);
    } catch (e) {
      setFormError(String(e instanceof Error ? e.message : e));
    }
  }
  return (
    <>
      <div className="list-tools budget-toolbar">
        <button
          className="action primary"
          disabled={catalog.busy || !!categoryError}
          onClick={() => edit(null)}
        >
          Definir limite
        </button>
        <button
          className="action"
          disabled={catalog.busy || month === "0001-01"}
          onClick={() =>
            void catalog.mutate(
              () => copyBudgets(month),
              "Cópia concluída. Apenas categorias ativas ainda não planejadas foram incluídas; limites existentes foram preservados.",
            )
          }
        >
          Copiar mês anterior
        </button>
        <button
          className="action"
          disabled={catalog.busy}
          onClick={() => {
            catalog.reload();
            setRevision((n) => n + 1);
          }}
        >
          Atualizar orçamento
        </button>
      </div>
      {catalog.notice && <p role="status">{catalog.notice}</p>}
      {categoryError && <p role="alert">{categoryError}</p>}
      {catalog.error && editing === undefined && !deleting && (
        <p className="form-error" role="alert">
          {catalog.error}
        </p>
      )}
      {catalog.busy && !catalog.items && (
        <p role="status">Carregando orçamento…</p>
      )}
      <div className="table-scroll">
        <table>
          <caption className="sr-only">Limites por categoria</caption>
          <thead>
            <tr>
              <th>Categoria</th>
              <th>Planejado</th>
              <th>Utilizado</th>
              <th>Restante</th>
              <th>Utilização</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {catalog.items?.map((b) => (
              <tr key={b.categoryId}>
                <th scope="row">
                  {b.name}
                  {!b.active && " (arquivada)"}
                </th>
                <td className="money">{formatMoney(b.limitAmount)}</td>
                <td className="money">{formatMoney(BigInt(b.spent))}</td>
                <td className="money">{formatMoney(BigInt(b.remaining))}</td>
                <td className={`budget-${b.state}`}>
                  <div className="budget-utilization">
                    <span className="budget-percentage">
                      {b.percent === null
                        ? "Limite zero excedido"
                        : `${settings.locale === "en-US" ? b.percent : b.percent.replace(".", ",")}%`}
                    </span>
                    <Badge
                      tone={
                        b.state === "exceeded"
                          ? "negative"
                          : b.state === "near"
                            ? "warning"
                            : "positive"
                      }
                    >
                      {b.state === "exceeded"
                        ? "Acima do limite"
                        : b.state === "near"
                          ? "Próximo do limite"
                          : "Dentro do limite"}
                    </Badge>
                    <span className="chart-track" aria-hidden="true">
                      <span
                        className="expense-bar"
                        style={{
                          width: `${b.limitAmount === 0 && BigInt(b.spent) > 0n ? 100 : barPercent(b.spent, String(b.limitAmount))}%`,
                        }}
                      />
                    </span>
                  </div>
                </td>
                <td>
                  <button
                    className="text-action"
                    disabled={catalog.busy}
                    aria-label={`Editar limite de ${b.name}`}
                    onClick={() => edit(b)}
                  >
                    Editar
                  </button>
                  <button
                    className="text-action"
                    disabled={catalog.busy}
                    aria-label={`Remover limite de ${b.name}`}
                    onClick={() => {
                      catalog.clearFeedback();
                      setDeleting(b);
                    }}
                  >
                    Remover
                  </button>
                </td>
              </tr>
            ))}
            {catalog.items?.length === 0 && (
              <tr>
                <td colSpan={6} className="empty-row">
                  Nenhum limite definido. Defina um limite ou copie o mês
                  anterior.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {editing !== undefined && (
        <Editor
          modal={false}
          title={editing ? "Editar limite" : "Definir limite"}
          busy={catalog.busy}
          error={catalog.error || formError}
          onClose={() => setEditing(undefined)}
        >
          <form onSubmit={save}>
            <fieldset disabled={catalog.busy}>
              <label htmlFor="budget-category">Categoria de despesa</label>
              <select
                id="budget-category"
                required
                disabled={!!editing}
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
              >
                <option value="">Selecione</option>
                {categories
                  .filter(
                    (c) =>
                      c.kind === "expense" &&
                      (c.active || c.id === editing?.categoryId),
                  )
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {categoryPath(c, categories)}
                    </option>
                  ))}
              </select>
              <label htmlFor="budget-limit">Limite ({currencyLabel})</label>
              <input
                id="budget-limit"
                required
                maxLength={40}
                inputMode="decimal"
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
              />
              <p className="field-help">
                Definir um limite para uma categoria já planejada atualiza seu
                valor. Zero significa que nenhum gasto foi planejado.
              </p>
              <button className="action primary" type="submit">
                Salvar limite
              </button>
            </fieldset>
          </form>
        </Editor>
      )}
      {deleting && (
        <Editor
          title="Remover limite"
          busy={catalog.busy}
          error={catalog.error}
          onClose={() => setDeleting(null)}
        >
          <p>
            Remover o limite de {deleting.name} deste mês? As transações serão
            preservadas.
          </p>
          <button
            className="action"
            disabled={catalog.busy}
            onClick={async () => {
              if (
                await catalog.mutate(
                  () => deleteBudget(month, deleting.categoryId),
                  "Limite removido.",
                )
              )
                setDeleting(null);
            }}
          >
            Confirmar remoção
          </button>
        </Editor>
      )}
    </>
  );
}
