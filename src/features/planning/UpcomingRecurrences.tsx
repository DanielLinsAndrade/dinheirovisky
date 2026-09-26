import { useEffect, useRef, useState } from "react";
import { useFormatting } from "../../app/SettingsContext";
import { localDate } from "../../domain/transactions";
import { DuePayments } from "../dashboard/DuePayments";
import type { PlanningOrigin } from "../../services/commitments";
import {
  listRecurrences,
  materializeRecurrences,
  type Recurrence,
} from "../../services/planning";

export function UpcomingRecurrences({
  onTransactions,
  onGenerated,
  onOrigin,
}: {
  onTransactions: () => void;
  onGenerated?: () => void;
  onOrigin?: (origin: PlanningOrigin) => void;
}) {
  const { formatMoney, displayDate } = useFormatting();

  const [rows, setRows] = useState<Recurrence[] | null>(null),
    [error, setError] = useState(""),
    [attempt, setAttempt] = useState(0),
    [generated, setGenerated] = useState(0),
    [busy, setBusy] = useState(true);
  const request = useRef<{
    attempt: number;
    promise: Promise<{
      count: number;
      rows: Recurrence[];
    }>;
  } | null>(null);
  useEffect(() => {
    let active = true;
    setBusy(true);
    setError("");
    // Reutiliza o lote durante a repetição de efeitos do StrictMode.
    if (!request.current || request.current.attempt !== attempt) {
      request.current = {
        attempt,
        promise: (async () => {
          const count = await materializeRecurrences();
          const rows = await listRecurrences();
          return { count, rows };
        })(),
      };
    }
    request.current.promise
      .then(({ count, rows }) => {
        if (active) {
          setGenerated(count);

          if (count > 0) onGenerated?.();
          setRows(
            rows
              .filter((r) => r.active && !r.ended && r.nextDate)
              .sort((a, b) => a.nextDate!.localeCompare(b.nextDate!)),
          );
        }
      })
      .catch((e) => {
        if (active) setError(String(e));
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [attempt, onGenerated]);
  return (
    <section
      id="commitments"
      tabIndex={-1}
      className="dashboard-section commitments"
      aria-label="Vencimentos e recorrências"
    >
      <h2 id="commitments-heading">Compromissos</h2>
      {error && <p role="alert">{error}</p>}
      {busy && <p role="status">Verificando vencimentos…</p>}
      {generated > 0 && (
        <p role="status">{generated} lançamento(s) programado(s) gerado(s).</p>
      )}
      {!busy && !error && (
        <DuePayments onTransactions={onTransactions} onOrigin={onOrigin} />
      )}
      <details className="recurrence-preview">
        <summary>Estado das séries recorrentes</summary>

        <p className="field-help">
          Próxima ocorrência de cada série ativa, a partir de hoje; independente
          do mês do dashboard. Vencimentos gerados ficam programados até você
          efetivá-los em Transações. Esta lista informa o estado das séries; não
          deve ser somada aos compromissos acima.
        </p>
        {!busy && !error && rows?.length === 0 && (
          <p>
            Nenhuma próxima recorrência ativa. Cadastre ou reative uma série na
            tela Recorrências. Confira em Transações os lançamentos já gerados.
          </p>
        )}
        {rows?.some((r) => r.nextDate! <= localDate() && !r.blocked) && (
          <p role="status">
            Há vencimentos antigos a processar. Atualize para gerar outro lote.
          </p>
        )}
        <ul>
          {rows?.slice(0, 8).map((r) => (
            <li key={r.id}>
              {displayDate(r.nextDate!)} · {r.description} ·{" "}
              {r.kind === "income" ? "Receita" : "Despesa"} ·{" "}
              {formatMoney(r.amount)}
              {r.blocked && " — reative a conta/categoria para gerar"}
            </li>
          ))}
        </ul>
        {rows && rows.length > 8 && (
          <p>
            Mostrando 8 de {rows.length} séries. Consulte todas em Recorrências.
          </p>
        )}
      </details>
      <div className="list-tools">
        <button
          className="text-action"
          disabled={busy}
          onClick={() => setAttempt((n) => n + 1)}
        >
          Atualizar vencimentos
        </button>
      </div>
    </section>
  );
}
