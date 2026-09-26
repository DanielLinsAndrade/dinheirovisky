import { useEffect, useState } from "react";
import { Button } from "../../components/Button";
import { useFormatting } from "../../app/SettingsContext";
import { localDate } from "../../domain/transactions";
import {
  queryFinancialAlerts,
  type AlertPage,
  type PlanningOrigin,
} from "../../services/commitments";
export function FinancialAlerts({
  onOrigin,
  revision = 0,
}: {
  onOrigin?: (origin: PlanningOrigin) => void;
  revision?: number;
}) {
  const { formatMoney, displayDate } = useFormatting();
  const [comparison, setComparison] = useState("");
  const [page, setPage] = useState(0),
    [attempt, setAttempt] = useState(0);
  const [data, setData] = useState<AlertPage | null>(null),
    [error, setError] = useState("");
  const today = localDate();
  useEffect(() => {
    let active = true;
    setData(null);
    setError("");
    queryFinancialAlerts(today, comparison || null, page).then(
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
  }, [today, comparison, page, attempt, revision]);
  return (
    <section
      className="dashboard-section financial-alerts"
      aria-label="Alertas financeiros"
    >
      <h2>Alertas financeiros</h2>
      <p className="field-help">
        Regras locais de vencimento, orçamento e consumo. Nenhum alerta efetiva
        pagamentos ou altera dados.
      </p>
      <label htmlFor="alert-comparison">
        Mês financeiro de comparação (opcional)
      </label>
      <input
        id="alert-comparison"
        type="month"
        min="0001-01"
        max="9999-12"
        value={comparison}
        onChange={(e) => {
          setComparison(e.target.value);
          setPage(0);
        }}
      />
      {error ? (
        <div role="alert">
          <p>{error}</p>
          <Button onClick={() => setAttempt((n) => n + 1)}>
            Tentar alertas novamente
          </Button>
        </div>
      ) : !data ? (
        <p role="status">Consultando alertas…</p>
      ) : (
        <>
          <p className="field-help">
            Mês atual: {data.month}. Comparação:{" "}
            {data.comparisonMonth ?? "sem mês anterior disponível"}.
          </p>
          {data.total === 0 ? (
            <p>Nenhum alerta para estas regras.</p>
          ) : (
            <ul className="due-list">
              {data.items.map((a) => (
                <li key={a.key}>
                  <div>
                    <strong>{a.title}</strong>
                    <p>{a.reason}</p>
                    <small>
                      {displayDate(a.date)} · {formatMoney(BigInt(a.amount))}
                      {a.reference !== null &&
                        ` · Referência: ${formatMoney(BigInt(a.reference))}`}
                    </small>
                    {onOrigin && (
                      <Button
                        variant="quiet"
                        aria-label={`Abrir origem de ${a.title}`}
                        onClick={() => onOrigin(a.origin)}
                      >
                        Abrir origem
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {data.total > 0 && (
            <div className="list-tools">
              <span role="status">
                {data.total} alerta(s) · página {data.page + 1}
              </span>
              <Button
                disabled={data.page === 0}
                onClick={() => setPage(data.page - 1)}
              >
                Alertas anteriores
              </Button>
              <Button
                disabled={(data.page + 1) * 5 >= data.total}
                onClick={() => setPage(data.page + 1)}
              >
                Mais alertas
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
