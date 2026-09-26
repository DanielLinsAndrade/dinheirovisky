import { useEffect, useState } from "react";
import { queryInvoices } from "../../services/purchases";
import type { InvoicePage } from "../../domain/purchases";
import { localDate } from "../../domain/transactions";
import { Button } from "../../components/Button";
export function InvoiceFilter({
  cardId,
  value,
  onChange,
}: {
  cardId: number;
  value: number | null;
  onChange: (id: number | null) => void;
}) {
  const [page, setPage] = useState(0),
    [attempt, setAttempt] = useState(0);
  const [data, setData] = useState<InvoicePage | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setData(null);
    setError("");
    queryInvoices(cardId, localDate(), page).then(
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
  }, [cardId, page, attempt]);
  return (
    <div className="metadata-field">
      <label htmlFor="analysis-invoice">Fatura</label>
      <select
        id="analysis-invoice"
        value={value ?? ""}
        onChange={(e) =>
          onChange(e.target.value ? Number(e.target.value) : null)
        }
      >
        <option value="">Todas</option>
        {value !== null && !data?.items.some((i) => i.id === value) && (
          <option value={value}>Fatura selecionada #{value}</option>
        )}
        {data?.items.map((i) => (
          <option key={i.id} value={i.id}>
            {i.month} · vencimento {i.dueDate}
          </option>
        ))}
      </select>
      {error ? (
        <div role="alert">
          {error}
          <Button type="button" onClick={() => setAttempt((n) => n + 1)}>
            Tentar faturas novamente
          </Button>
        </div>
      ) : !data ? (
        <p role="status">Consultando faturas…</p>
      ) : (
        <div className="list-tools">
          <Button
            type="button"
            disabled={data.page === 0}
            onClick={() => setPage(data.page - 1)}
          >
            Faturas anteriores
          </Button>
          <Button
            type="button"
            disabled={(data.page + 1) * 24 >= data.total}
            onClick={() => setPage(data.page + 1)}
          >
            Mais faturas
          </Button>
        </div>
      )}
    </div>
  );
}
