import { useEffect, useState } from "react";
import { useFormatting } from "../../app/SettingsContext";
import { Button } from "../../components/Button";
import { localDate } from "../../domain/transactions";
import {
  queryCommitments,
  type CommitmentHorizon,
  type CommitmentPage,
  type PlanningOrigin,
} from "../../services/commitments";

const horizons: [CommitmentHorizon, string][] = [
  ["all", "Todos"],
  ["overdue", "Vencidos"],
  ["week", "Próximos 7 dias"],
  ["month", "Próximos 30 dias"],
  ["next_month", "Próximo mês financeiro"],
  ["next_invoice", "Próximas faturas"],
];

export function DuePayments({
  onTransactions,
  onOrigin,
}: {
  onTransactions: () => void;
  onOrigin?: (origin: PlanningOrigin) => void;
}) {
  const { displayDate, formatMoney } = useFormatting();
  const [horizon, setHorizon] = useState<CommitmentHorizon>("all");
  const [page, setPage] = useState(0);
  const [data, setData] = useState<CommitmentPage | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const today = localDate();
  useEffect(() => {
    let active = true;
    setData(null);
    setError("");
    queryCommitments(today, horizon, page).then(
      (value) => {
        if (active) setData(value);
      },
      (e) => {
        if (active) setError(String(e));
      },
    );
    return () => {
      active = false;
    };
  }, [today, horizon, page, attempt]);
  return (
    <div className="due-payments">
      <div
        className="due-horizons"
        role="group"
        aria-label="Horizonte dos compromissos"
      >
        {horizons.map(([value, label]) => (
          <Button
            key={value}
            variant="quiet"
            aria-pressed={horizon === value}
            onClick={() => {
              setHorizon(value);
              setPage(0);
            }}
          >
            {label}
          </Button>
        ))}
      </div>
      <p className="field-help">
        Saídas em aberto e previstas. “Todos” inclui vencidas e próximos 30
        dias. Parcelas já estão no saldo da fatura e não são somadas novamente.
        Previsões não alteram saldo nem representam despesas realizadas.
      </p>
      {error ? (
        <div role="alert">
          <p>Não foi possível consultar os compromissos. {error}</p>
          <Button onClick={() => setAttempt((n) => n + 1)}>
            Tentar novamente
          </Button>
        </div>
      ) : !data ? (
        <p role="status">Carregando compromissos…</p>
      ) : (
        <>
          <p>
            Em aberto/comprometido:{" "}
            <strong>{formatMoney(BigInt(data.committed))}</strong> · Previsão
            estimada: <strong>{formatMoney(BigInt(data.estimated))}</strong>
          </p>
          {data.items.length === 0 ? (
            <p>Nenhum compromisso neste horizonte.</p>
          ) : (
            <ul className="due-list">
              {data.items.map((p) => (
                <li key={`${p.kind}:${p.id}:${p.date}`}>
                  <div>
                    <strong>{p.description}</strong>
                    <small>
                      {p.context} · {displayDate(p.date)}
                    </small>
                  </div>
                  <div className="due-amount">
                    <strong>{formatMoney(BigInt(p.amount))}</strong>
                    <small>
                      {p.date < today
                        ? "Vencida"
                        : p.date === today
                          ? "Vence hoje"
                          : "A vencer"}{" "}
                      ·{" "}
                      {p.kind === "recurrence"
                        ? "Previsão estimada"
                        : p.kind === "invoice"
                          ? "Já gasto · ainda não pago"
                          : p.state === "pending"
                            ? "Pendente"
                            : "Programada"}
                      {p.partial && " · Pagamento parcial"}
                      {p.planningClass === "fixed"
                        ? " · Fixa"
                        : p.planningClass === "seasonal"
                          ? " · Sazonal"
                          : ""}
                    </small>
                    {onOrigin && (
                      <Button
                        variant="quiet"
                        aria-label={`Abrir origem de ${p.description}`}
                        onClick={() =>
                          onOrigin({ kind: p.kind, id: p.id, cardId: p.cardId })
                        }
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
            <div className="due-pagination">
              <span role="status">
                {data.total} compromisso(s) · página {data.page + 1} de{" "}
                {Math.ceil(data.total / 5)}
              </span>
              <Button
                variant="quiet"
                disabled={data.page === 0}
                onClick={() => setPage(data.page - 1)}
              >
                Compromissos anteriores
              </Button>
              <Button
                variant="quiet"
                disabled={(data.page + 1) * 5 >= data.total}
                onClick={() => setPage(data.page + 1)}
              >
                Mais compromissos
              </Button>
            </div>
          )}
        </>
      )}
      <Button variant="quiet" onClick={onTransactions}>
        Conferir transações programadas
      </Button>
    </div>
  );
}
