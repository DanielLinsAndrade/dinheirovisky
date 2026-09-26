import { Metric } from "../../components/Surface";
import { useEffect, useState, useId, type FormEvent } from "react";
import { useFormatting } from "../../app/SettingsContext";
import { financialMonth } from "../../domain/settings";
import { localDate } from "../../domain/transactions";
import { barPercent } from "../../domain/dashboard";
import {
  earlierMonth,
  validateReportPeriod,
  lineGeometry,
} from "../../domain/reports";
import { listAccounts } from "../../services/catalog";
import type { Account } from "../../domain/catalog";
import {
  getReport,
  type Report,
  type ReportFilter,
} from "../../services/reports";
import "../dashboard/dashboard.css";
import "./reports.css";

export function ReportsPage() {
  const { formatMoney, displayDate, settings } = useFormatting();
  const current = financialMonth(localDate(), settings.financialMonthStart);
  const [draft, setDraft] = useState<ReportFilter>(() => ({
    from: earlierMonth(current, 5),
    to: current,
    accountId: null,
  }));
  const [filter, setFilter] = useState(draft),
    [attempt, setAttempt] = useState(0),
    [data, setData] = useState<Report | null>(null),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(""),
    [formError, setFormError] = useState("");
  const [accounts, setAccounts] = useState<Account[]>([]),
    [accountError, setAccountError] = useState("");
  const [series, setSeries] = useState<"closingBalance" | "cumulativeSavings">(
    "closingBalance",
  );
  const chartId = useId();
  useEffect(() => {
    let active = true;
    setAccountError("");
    listAccounts().then(
      (a) => {
        if (active) setAccounts(a);
      },
      (e) => {
        if (active) setAccountError(String(e));
      },
    );
    return () => {
      active = false;
    };
  }, [attempt]);
  useEffect(() => {
    let active = true;
    setBusy(true);
    setData(null);
    setError("");
    getReport(filter)
      .then(
        (r) => {
          if (active) setData(r);
        },
        (e) => {
          if (active) setError(String(e instanceof Error ? e.message : e));
        },
      )
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [filter, attempt, settings.financialMonthStart]);
  function apply(e: FormEvent) {
    e.preventDefault();
    setFormError("");
    try {
      validateReportPeriod(draft.from, draft.to);
      setFilter({ ...draft });
      setAttempt((n) => n + 1);
    } catch (e) {
      setFormError(String(e instanceof Error ? e.message : e));
    }
  }
  function recent(count: number) {
    const next = {
      ...draft,
      from: earlierMonth(current, count - 1),
      to: current,
    };
    setDraft(next);
    setFilter(next);
    setFormError("");
  }
  const money = (value: string) => formatMoney(BigInt(value));
  const monthLabel = (month: string) =>
    new Intl.DateTimeFormat(settings.locale, {
      month: "short",
      year: "numeric",
    }).format(new Date(`${month}-15T12:00:00`));
  const graph = lineGeometry(data?.months.map((m) => m[series]) ?? []);
  const maxFlow =
    data?.months
      .reduce(
        (n, m) =>
          [BigInt(m.income), BigInt(m.expense)].reduce(
            (a, b) => (b > a ? b : a),
            n,
          ),
        0n,
      )
      .toString() ?? "0";
  return (
    <section aria-label="Relatórios financeiros">
      <p className="intro">
        Visão de caixa: movimentos efetivados nas contas. Compras no cartão são
        consumo e podem ser consultadas em Cartões e no Dashboard.
      </p>
      <form className="report-filters" onSubmit={apply}>
        <label>
          Mês inicial
          <input
            type="month"
            required
            min="0001-01"
            max="9999-12"
            value={draft.from}
            onChange={(e) => setDraft({ ...draft, from: e.target.value })}
          />
        </label>
        <label>
          Mês final
          <input
            type="month"
            required
            min="0001-01"
            max="9999-12"
            value={draft.to}
            onChange={(e) => setDraft({ ...draft, to: e.target.value })}
          />
        </label>
        <label>
          Conta do relatório
          <select
            value={draft.accountId ?? ""}
            onChange={(e) =>
              setDraft({
                ...draft,
                accountId: e.target.value ? Number(e.target.value) : null,
              })
            }
          >
            <option value="">Todas, incluindo arquivadas</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {!a.active && " (arquivada)"}
              </option>
            ))}
          </select>
        </label>
        <button className="action primary" type="submit">
          Aplicar filtros
        </button>
      </form>
      <div className="report-shortcuts">
        <button className="text-action" onClick={() => recent(6)}>
          Últimos 6 meses
        </button>
        <button className="text-action" onClick={() => recent(12)}>
          Últimos 12 meses
        </button>
        <button
          className="text-action"
          disabled={busy}
          onClick={() => setAttempt((n) => n + 1)}
        >
          Atualizar relatório
        </button>
      </div>
      {formError && <p role="alert">{formError}</p>}
      {accountError && (
        <p role="alert">
          Não foi possível carregar as contas. {accountError} Use Atualizar
          relatório para tentar novamente.
        </p>
      )}
      <p className="field-help">
        Meses financeiros começam no dia {settings.financialMonthStart}. Somente
        lançamentos efetivados; pendentes, programados e contribuições de metas
        não entram. Transferências não são receita nem despesa.
      </p>
      {busy && <p role="status">Calculando relatório…</p>}
      {error && (
        <p className="form-error" role="alert">
          Não foi possível consultar o relatório. {error}
        </p>
      )}
      {data && (
        <>
          <h2>{data.accountName ?? "Todas as contas, incluindo arquivadas"}</h2>
          <p>
            De {displayDate(data.startDate)} a {displayDate(data.endDate)} ·{" "}
            {data.movementCount} lançamento(s) efetivado(s).
          </p>
          {data.movementCount === 0 && (
            <p className="empty-row">
              Nenhum lançamento efetivado neste período. O saldo transportado
              pode incluir movimentos anteriores e saldos iniciais.
            </p>
          )}
          <div className="report-metrics">
            <Metric
              label="Receitas no período"
              value={money(data.income)}
              icon="income"
              tone="positive"
              testId="report-income"
            />
            <Metric
              label="Despesas no período"
              value={money(data.expense)}
              icon="expense"
              tone="negative"
              testId="report-expense"
            />
            <Metric
              label="Economia no período"
              value={money(data.savings)}
              icon="equal"
              testId="report-savings"
            />
          </div>
          <p className="field-help">
            Pagamentos de fatura: {money(data.invoicePayments ?? "0")}. Economia
            = receitas − despesas − pagamentos de fatura; pode ser negativa. É
            independente dos aportes em metas e investimentos.
          </p>
          <section
            className="dashboard-section"
            aria-label="Evolução financeira"
          >
            <h2>Evolução financeira</h2>
            <div className="report-filters">
              <label>
                Visualizar evolução
                <select
                  value={series}
                  onChange={(e) => setSeries(e.target.value as typeof series)}
                >
                  <option value="closingBalance">
                    Saldo ao fim de cada mês
                  </option>
                  <option value="cumulativeSavings">
                    Economia acumulada no período
                  </option>
                </select>
              </label>
            </div>
            <p>
              Saldo antes do período:{" "}
              <strong data-testid="report-opening">
                {money(data.openingBalance)}
              </strong>{" "}
              · Saldo ao final:{" "}
              <strong data-testid="report-closing">
                {money(data.closingBalance)}
              </strong>
            </p>
            {filter.accountId !== null && (
              <p>
                Transferências líquidas no período:{" "}
                <strong>{money(data.transfers)}</strong>. Entradas e saídas por
                transferência alteram o saldo desta conta, sem mudar a economia.
              </p>
            )}
            <p className="field-help">
              Saldo reconstruído com os saldos iniciais atuais das contas e
              lançamentos efetivados até cada data. Saldos iniciais não possuem
              data histórica; alterar um saldo inicial recalcula toda a série.
              Meses em andamento ou futuros refletem apenas o que já está
              registrado, sem projeção.
            </p>
            <figure className="report-chart">
              <div className="report-axis">
                <span>{formatMoney(graph.max)}</span>
                <span>{formatMoney(graph.min)}</span>
              </div>
              <svg viewBox="0 0 700 200" role="img" aria-labelledby={chartId}>
                <title id={chartId}>
                  {series === "closingBalance"
                    ? "Evolução do saldo ao fim de cada mês"
                    : "Economia acumulada desde o início do período"}
                  . Valores exatos na tabela mensal abaixo.
                </title>
                <line
                  x1="20"
                  x2="680"
                  y1={graph.zero}
                  y2={graph.zero}
                  className="report-zero"
                />
                <polyline
                  fill="none"
                  points={graph.points.map((p) => `${p.x},${p.y}`).join(" ")}
                  className="report-line"
                />
                {graph.points.map((p, i) => (
                  <circle
                    key={data.months[i].month}
                    cx={p.x}
                    cy={p.y}
                    r="3"
                    className="report-dot"
                  >
                    <title>
                      {monthLabel(data.months[i].month)}:{" "}
                      {money(data.months[i][series])}
                    </title>
                  </circle>
                ))}
              </svg>
              <figcaption>
                <span>{monthLabel(data.months[0].month)}</span>
                <span>
                  {monthLabel(data.months[data.months.length - 1].month)}
                </span>
              </figcaption>
            </figure>
          </section>
          <section className="dashboard-section" aria-label="Comparação mensal">
            <h2>Receitas, despesas e comparação mensal</h2>
            <p className="field-help">
              Variação compara a economia de cada mês com o mês financeiro
              anterior, mesmo quando ele está fora do filtro. Economia acumulada
              começa em zero no início do período. Meses sem lançamentos
              aparecem com valores zero.
            </p>
            <div
              className="table-scroll"
              tabIndex={0}
              role="region"
              aria-label="Rolagem dos totais mensais"
            >
              <table className="report-table">
                <caption className="sr-only">
                  Totais e evolução por mês financeiro
                </caption>
                <thead>
                  <tr>
                    <th>Mês</th>
                    <th>Receitas</th>
                    <th>Despesas</th>
                    <th>Economia</th>
                    <th>Variação mensal da economia</th>
                    <th>Economia acumulada</th>
                    <th>Saldo final</th>
                    {filter.accountId !== null && (
                      <th>Transferências líquidas</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {data.months.map((m) => (
                    <tr key={m.month}>
                      <th scope="row">{monthLabel(m.month)}</th>
                      <td>
                        {money(m.income)}
                        <span className="chart-track" aria-hidden="true">
                          <span
                            className="income-bar"
                            style={{
                              width: `${barPercent(m.income, maxFlow)}%`,
                            }}
                          />
                        </span>
                      </td>
                      <td>
                        {money(m.expense)}
                        <span className="chart-track" aria-hidden="true">
                          <span
                            className="expense-bar"
                            style={{
                              width: `${barPercent(m.expense, maxFlow)}%`,
                            }}
                          />
                        </span>
                      </td>
                      <td>{money(m.result)}</td>
                      <td>
                        {m.resultChange === null
                          ? "Sem mês anterior"
                          : money(m.resultChange)}
                      </td>
                      <td>{money(m.cumulativeSavings)}</td>
                      <td>{money(m.closingBalance)}</td>
                      {filter.accountId !== null && (
                        <td>{money(m.transfers)}</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section
            className="dashboard-section"
            aria-label="Despesas por categoria"
          >
            <h2>Despesas por categoria no período</h2>
            <p className="field-help">
              Categorias e subcategorias contabilizam apenas seus próprios
              lançamentos. O histórico arquivado é preservado; todas as
              categorias com gasto aparecem.
            </p>
            {data.categories.length === 0 ? (
              <p>Nenhuma despesa efetivada no período.</p>
            ) : (
              <ul className="category-ranking">
                {data.categories.map((c) => (
                  <li key={c.id ?? "none"}>
                    <div>
                      <span>{c.name}</span>
                      <strong>
                        {money(c.expense)} ·{" "}
                        {new Intl.NumberFormat(settings.locale, {
                          maximumFractionDigits: 2,
                        }).format(barPercent(c.expense, data.expense))}
                        %
                      </strong>
                    </div>
                    <span className="chart-track" aria-hidden="true">
                      <span
                        className="expense-bar"
                        style={{
                          width: `${barPercent(c.expense, data.expense)}%`,
                        }}
                      />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </section>
  );
}
