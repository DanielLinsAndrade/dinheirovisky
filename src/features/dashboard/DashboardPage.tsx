import { useCallback, useEffect, useState } from "react";
import { getDashboard, type Dashboard } from "../../services/dashboard";
import { barPercent } from "../../domain/dashboard";
import { DashboardTrend } from "./DashboardTrend";
import { DashboardSummary } from "./DashboardSummary";
import { DashboardGoals } from "./DashboardGoals";
import { CategoryDistribution } from "./CategoryDistribution";
import { Button } from "../../components/Button";
import { useFormatting } from "../../app/SettingsContext";
import { financialMonth } from "../../domain/settings";
import {
  localDate,
  movementTypes,
  movementStatuses,
} from "../../domain/transactions";
import "./dashboard.css";
import { UpcomingRecurrences } from "../planning/UpcomingRecurrences";
import { FinancialAlerts } from "../planning/FinancialAlerts";
import type { PlanningOrigin } from "../../services/commitments";

export function DashboardPage({
  onAccounts,
  onTransactions,
  onNewTransaction,
  onGoals,
  onReports,
  onOrigin,
}: {
  onAccounts: () => void;
  onTransactions: () => void;
  onNewTransaction?: () => void;
  onGoals?: () => void;
  onReports?: () => void;
  onOrigin?: (origin: PlanningOrigin) => void;
}) {
  const { formatMoney, displayDate, settings } = useFormatting();
  const money = (value: string) => formatMoney(BigInt(value));
  const [month, setMonth] = useState(() =>
    financialMonth(localDate(), settings.financialMonthStart),
  );
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setData(null);
    setError("");
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month.startsWith("0000")) {
      setError("Selecione um mês válido.");
      setBusy(false);
      return;
    }
    setBusy(true);
    getDashboard(month)
      .then(
        (value) => {
          if (active) setData(value);
        },
        (e) => {
          if (active) setError(e instanceof Error ? e.message : String(e));
        },
      )
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [month, attempt, settings.financialMonthStart]);
  const refreshGenerated = useCallback(() => setAttempt((n) => n + 1), []);
  return (
    <section className="dashboard-home" aria-label="Dashboard financeiro">
      <div className="page-tools dashboard-toolbar">
        <label className="dashboard-month">
          Mês de referência
          <input
            aria-label="Mês de referência"
            type="month"
            min="0001-01"
            max="9999-12"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
        </label>
        <button
          className="action"
          disabled={busy}
          onClick={() => setAttempt((n) => n + 1)}
        >
          Atualizar dashboard
        </button>
        <a className="text-action" href="#commitments">
          Abrir compromissos
        </a>
        {onNewTransaction && (
          <Button
            variant="primary"
            disabled={!data || data.activeAccounts === 0 || busy}
            onClick={onNewTransaction}
          >
            Nova transação
          </Button>
        )}
      </div>
      {busy && <p role="status">Carregando dashboard…</p>}
      {error && (
        <p role="alert" className="form-error">
          Não foi possível carregar o dashboard. {error}
        </p>
      )}
      {data && <DashboardSummary data={data} onAccounts={onAccounts} />}
      <div className="dashboard-workspace">
        <div className="dashboard-analysis">
          {data && (
            <>
              <DashboardTrend data={data} />
              <div className="dashboard-categories">
                <CategoryDistribution data={data} />
                <section
                  className="dashboard-section"
                  aria-labelledby="categories-heading"
                >
                  <h2 id="categories-heading">Principais despesas</h2>
                  <p className="field-help">
                    Até cinco categorias com maior gasto no mês. Subcategorias
                    aparecem separadamente.
                  </p>
                  {data.categories.length === 0 ? (
                    <p>Nenhuma despesa efetivada neste mês.</p>
                  ) : (
                    <ol className="category-ranking">
                      {data.categories.map((c, index) => (
                        <li key={`${index}-${c.name}`}>
                          <div>
                            <span>{c.name}</span>
                            <strong>{money(c.cents)}</strong>
                          </div>
                          <span className="chart-track" aria-hidden="true">
                            <span
                              className="expense-bar"
                              style={{
                                width: `${barPercent(c.cents, data.current.expense)}%`,
                              }}
                            />
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                </section>
              </div>
            </>
          )}
        </div>
        <div className="dashboard-planning">
          <UpcomingRecurrences
            onTransactions={onTransactions}
            onGenerated={refreshGenerated}
            onOrigin={onOrigin}
          />
          <DashboardGoals onGoals={onGoals} />
        </div>
      </div>
      <FinancialAlerts onOrigin={onOrigin} revision={attempt} />
      {data && (
        <>
          <section
            className="dashboard-section"
            aria-labelledby="recent-heading"
          >
            <div className="page-tools dashboard-toolbar">
              <h2 id="recent-heading">Últimas transações do mês</h2>
              <button className="text-action" onClick={onTransactions}>
                Ver todas as transações
              </button>
            </div>
            <p className="field-help">
              Até seis lançamentos por data, incluindo transferências e todos os
              estados.
            </p>
            {data.recent.length === 0 ? (
              <p>
                Nenhuma transação neste mês. Registre uma receita ou despesa em
                Transações.
              </p>
            ) : (
              <div
                className="table-scroll"
                tabIndex={0}
                role="region"
                aria-label="Rolagem das últimas transações"
              >
                <table>
                  <caption className="sr-only">
                    Últimas transações do mês selecionado
                  </caption>
                  <thead>
                    <tr>
                      <th>Data / descrição</th>
                      <th>Conta</th>
                      <th>Tipo / situação</th>
                      <th className="money">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent.map(
                      ({ movement: m, accountName, destinationName }) => (
                        <tr key={m.id}>
                          <th scope="row">
                            <small>{displayDate(m.date)}</small>
                            <br />
                            {m.description}
                          </th>
                          <td>
                            {accountName}
                            {destinationName && ` → ${destinationName}`}
                          </td>
                          <td>
                            {movementTypes[m.kind]}
                            <br />
                            {movementStatuses[m.status]}
                          </td>
                          <td className="money">{formatMoney(m.amount)}</td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <div className="dashboard-insight">
            <strong>
              {BigInt(data.current.result) >= 0n
                ? "Seu resultado está equilibrado ou positivo."
                : "As despesas superaram as receitas no período."}
            </strong>
            <p>
              Resultado registrado: {money(data.current.result)}. Considere
              também seus compromissos em aberto.
            </p>
            {onReports && (
              <Button onClick={onReports}>Ver relatório completo</Button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
