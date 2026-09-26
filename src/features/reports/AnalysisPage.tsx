import { useEffect, useState, type FormEvent } from "react";
import { useFormatting } from "../../app/SettingsContext";
import { localDate } from "../../domain/transactions";
import { financialMonth } from "../../domain/settings";
import { earlierMonth, validateReportPeriod } from "../../domain/reports";
import { methodCodes } from "../../domain/metadata";
import { listAccounts, listCategories } from "../../services/catalog";
import { listCards } from "../../services/cards";
import {
  getReportAnalysis,
  type AnalysisFilter,
  type AnalysisReport,
} from "../../services/reportAnalysis";
import { MetadataFilter } from "../metadata/MetadataFilter";
import { Button } from "../../components/Button";
import { AnalysisResults } from "./AnalysisResults";
import { InvoiceFilter } from "./InvoiceFilter";
import "./reports.css";
const groups = {
  category: "Categoria",
  method: "Método",
  card: "Cartão",
  invoice: "Fatura",
  merchant: "Estabelecimento",
  channel: "Modalidade",
  recurrence: "Recorrência",
  classification: "Classificação fixa/sazonal",
};
type Catalogs = {
  accounts: Awaited<ReturnType<typeof listAccounts>>;
  cards: Awaited<ReturnType<typeof listCards>>;
  categories: Awaited<ReturnType<typeof listCategories>>;
};
export function AnalysisPage() {
  const { settings } = useFormatting();
  const current = financialMonth(localDate(), settings.financialMonthStart);
  const [draft, setDraft] = useState<AnalysisFilter>({
    from: earlierMonth(current, 5),
    to: current,
    view: "consumption",
    groupBy: "category",
    page: 0,
  });
  const [filter, setFilter] = useState(draft),
    [data, setData] = useState<AnalysisReport | null>(null),
    [error, setError] = useState(""),
    [formError, setFormError] = useState(""),
    [attempt, setAttempt] = useState(0);
  const [catalog, setCatalog] = useState<Catalogs | null>(null),
    [catalogError, setCatalogError] = useState("");
  useEffect(() => {
    let active = true;
    setCatalogError("");
    Promise.all([listAccounts(), listCards(), listCategories()]).then(
      ([accounts, cards, categories]) => {
        if (active) setCatalog({ accounts, cards, categories });
      },
      (e) => {
        if (active) setCatalogError(String(e));
      },
    );
    return () => {
      active = false;
    };
  }, [attempt]);
  useEffect(() => {
    let active = true;
    setData(null);
    setError("");
    getReportAnalysis(filter).then(
      (r) => {
        if (active) setData(r);
      },
      (e) => {
        if (active) setError(String(e));
      },
    );
    return () => {
      active = false;
    };
  }, [filter, attempt, settings.financialMonthStart]);
  const change = <K extends keyof AnalysisFilter>(k: K, v: AnalysisFilter[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));
  function apply(e: FormEvent) {
    e.preventDefault();
    try {
      validateReportPeriod(draft.from, draft.to);
      setFormError("");
      setFilter({ ...draft, page: 0 });
    } catch (e) {
      setFormError(String(e));
    }
  }
  const numeric = (s: string) => (s ? Number(s) : null);
  return (
    <section aria-label="Análise de consumo, caixa e parcelas">
      <p className="intro">
        Consumo mede receitas e despesas econômicas. Caixa mede movimentos
        efetivados nas contas. Parcelas mostram valores contratuais por
        vencimento, separados das duas visões.
      </p>
      <form className="report-filters" onSubmit={apply}>
        <label>
          Visão financeira
          <select
            aria-label="Visão financeira"
            value={draft.view}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                view: e.target.value as AnalysisFilter["view"],
                groupBy:
                  e.target.value === "consumption" && d.groupBy === "invoice"
                    ? "card"
                    : d.groupBy,
              }))
            }
          >
            <option value="consumption">Consumo</option>
            <option value="cash">Caixa</option>
            <option value="installments">Parcelas por vencimento</option>
          </select>
        </label>
        <label>
          Mês inicial da análise
          <input
            type="month"
            required
            min="0001-01"
            max="9999-12"
            value={draft.from}
            onChange={(e) => change("from", e.target.value)}
          />
        </label>
        <label>
          Mês final da análise
          <input
            type="month"
            required
            min="0001-01"
            max="9999-12"
            value={draft.to}
            onChange={(e) => change("to", e.target.value)}
          />
        </label>
        <label>
          Início da comparação (opcional)
          <input
            type="month"
            min="0001-01"
            max="9999-12"
            value={draft.comparisonFrom ?? ""}
            onChange={(e) => change("comparisonFrom", e.target.value || null)}
          />
        </label>
        <label>
          Agrupar por
          <select
            aria-label="Agrupar por"
            value={draft.groupBy}
            onChange={(e) =>
              change("groupBy", e.target.value as AnalysisFilter["groupBy"])
            }
          >
            {Object.entries(groups)
              .filter(
                ([key]) => draft.view !== "consumption" || key !== "invoice",
              )
              .map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
          </select>
        </label>
        <label>
          Conta do recorte
          <select
            value={draft.accountId ?? ""}
            onChange={(e) => change("accountId", numeric(e.target.value))}
          >
            <option value="">Todas</option>
            {catalog?.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {!a.active && " (arquivada)"}
              </option>
            ))}
          </select>
        </label>
        <label>
          Cartão do recorte
          <select
            value={draft.cardId ?? ""}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                cardId: numeric(e.target.value),
                invoiceId: null,
              }))
            }
          >
            <option value="">Todos</option>
            {catalog?.cards
              .filter((c) => c.id !== null)
              .map((c) => (
                <option key={c.id} value={c.id ?? ""}>
                  {c.name}
                  {!c.active && " (arquivado)"}
                </option>
              ))}
          </select>
        </label>
        {draft.cardId && (
          <InvoiceFilter
            key={draft.cardId}
            cardId={draft.cardId}
            value={draft.invoiceId ?? null}
            onChange={(v) => change("invoiceId", v)}
          />
        )}
        <label>
          Categoria do recorte
          <select
            value={draft.categoryId ?? ""}
            onChange={(e) => change("categoryId", numeric(e.target.value))}
          >
            <option value="">Todas</option>
            {catalog?.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {!c.active && " (arquivada)"}
              </option>
            ))}
          </select>
        </label>
        <label>
          Método do recorte
          <select
            value={draft.method ?? ""}
            onChange={(e) => change("method", e.target.value || null)}
          >
            <option value="">Todos</option>
            <option value="none">Não informado</option>
            {Object.entries(methodCodes).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <MetadataFilter
          revision={attempt}
          kind="merchant"
          label="Estabelecimento do recorte"
          value={draft.merchantId?.toString() ?? ""}
          onChange={(v) => change("merchantId", numeric(v))}
        />
        <label>
          Modalidade do recorte
          <select
            value={draft.channel ?? ""}
            onChange={(e) => change("channel", e.target.value || null)}
          >
            <option value="">Todas</option>
            <option value="online">Online</option>
            <option value="in_person">Presencial</option>
            <option value="none">Não informada</option>
          </select>
        </label>
        <label>
          Origem recorrente
          <select
            value={draft.recurrence ?? ""}
            onChange={(e) => change("recurrence", e.target.value || null)}
          >
            <option value="">Todas</option>
            <option value="yes">Com recorrência</option>
            <option value="no">Sem recorrência</option>
          </select>
        </label>
        <label>
          Classificação do recorte
          <select
            value={draft.planningClass ?? ""}
            onChange={(e) => change("planningClass", e.target.value || null)}
          >
            <option value="">Todas</option>
            <option value="fixed">Fixa</option>
            <option value="seasonal">Sazonal</option>
            <option value="none">Sem classificação</option>
          </select>
        </label>
        <div className="filter-actions">
          <Button type="submit" variant="primary">
            Aplicar análise
          </Button>
          <Button type="button" onClick={() => setAttempt((n) => n + 1)}>
            Atualizar análise
          </Button>
        </div>
      </form>
      {formError && <p role="alert">{formError}</p>}
      {catalogError && (
        <p role="alert">
          Não foi possível carregar opções. {catalogError} Use Atualizar análise
          para tentar novamente.
        </p>
      )}
      <details>
        <summary>Critérios e limites dos recortes</summary>
        <p>
          Meses financeiros começam no dia {settings.financialMonthStart}.
          Somente dados registrados; pendentes e programados não entram em
          consumo ou caixa. Contas e cartões arquivados preservam histórico.
          Comparação tem a mesma duração e termina antes do intervalo principal;
          vazia usa o período imediatamente anterior.
        </p>
        <p>
          Compras entram uma única vez no consumo, na data da compra. Estornos e
          ajustes entram na data do evento. Pagamentos de fatura são saída de
          caixa separada. Transferências são zero no consolidado e mostram
          efeito líquido na conta filtrada. Saldo inicial não entra na variação
          do recorte.
        </p>
        <p>
          Parcelas são valores contratuais de compras ativas pelo vencimento,
          inclusive parcelas já quitadas. Não representam saldo restante nem
          nova despesa. Pagamentos/créditos não são rateados; consulte Faturas
          para o saldo a pagar.
        </p>
        <p>
          Filtro de conta exclui compras sem vínculo com conta; conta padrão do
          cartão não é usada como atribuição. Pagamentos de fatura não têm
          estabelecimento, categoria ou modalidade próprios e ficam fora desses
          filtros. Crédito é o método das compras/ajustes no cartão; método do
          pagamento da fatura é não informado.
        </p>
        <p>
          Em consumo, selecionar fatura inclui o valor integral de cada compra
          associada uma vez, na data da compra, e eventos vinculados à fatura.
          Não é o total da fatura. Para distribuir por fatura, use caixa ou
          parcelas. Classificação reflete o template atual; não reescreve o
          valor do lançamento.
        </p>
      </details>
      <h2>
        {filter.view === "consumption"
          ? "Consumo"
          : filter.view === "cash"
            ? "Caixa"
            : "Parcelas contratuais por vencimento"}{" "}
        · {filter.from} a {filter.to}
      </h2>
      <p>
        Filtros alterados acima só entram ao aplicar. Agrupamento aplicado:{" "}
        {groups[filter.groupBy]}.
      </p>
      {filter.view === "consumption" && filter.invoiceId && (
        <p>
          Este recorte inclui cada compra associada à fatura pelo valor
          integral, na data da compra. Não representa o valor das parcelas nem o
          saldo a pagar da fatura.
        </p>
      )}
      {error ? (
        <div role="alert">
          <p>{error}</p>
          <Button onClick={() => setAttempt((n) => n + 1)}>
            Tentar análise novamente
          </Button>
        </div>
      ) : !data ? (
        <p role="status">Calculando análise…</p>
      ) : (
        <AnalysisResults
          data={data}
          grouping={filter.groupBy}
          onPage={(page) => setFilter((f) => ({ ...f, page }))}
        />
      )}
    </section>
  );
}
