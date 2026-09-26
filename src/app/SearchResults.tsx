import { useEffect, useState } from "react";
import {
  searchGlobal,
  searchLabels,
  type SearchPage,
  type SearchRecord,
} from "../services/search";
import { useFormatting } from "./SettingsContext";
import { Button } from "../components/Button";
export function SearchResults({
  query,
  onOpen,
}: {
  query: string;
  onOpen: (record: SearchRecord) => void;
}) {
  const [page, setPage] = useState(0),
    [retry, setRetry] = useState(0);
  const [result, setResult] = useState<SearchPage | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const { formatMoney, displayDate } = useFormatting();
  useEffect(() => {
    if (query.trim().length < 3) return;
    let active = true;
    setLoading(true);
    setError("");
    const timer = setTimeout(() => {
      searchGlobal(query, page)
        .then(
          (r) => {
            if (active) setResult(r);
          },
          (e) => {
            if (active) {
              setError(String(e));
              setResult(null);
            }
          },
        )
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 180);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, page, retry]);
  if (query.trim().length < 3)
    return (
      <li className="field-help">
        Digite pelo menos três caracteres para buscar registros.
      </li>
    );
  return (
    <>
      {loading && <li role="status">Buscando registros…</li>}
      {error && (
        <li>
          <p role="alert">{error}</p>
          <button onClick={() => setRetry((n) => n + 1)}>
            Tentar busca novamente
          </button>
        </li>
      )}
      {result?.items.length === 0 && (
        <li role="status">Nenhum registro encontrado.</li>
      )}
      {result?.items.map((r) => (
        <li key={`${r.kind}-${r.id}`}>
          <Button variant="quiet" disabled={loading} onClick={() => onOpen(r)}>
            <span>
              <strong>
                {searchLabels[r.kind]}: {r.title}
              </strong>
              <br />
              <small>
                {r.context}
                {r.date ? ` · ${displayDate(r.date)}` : ""}
                {r.amount ? ` · ${formatMoney(BigInt(r.amount))}` : ""}
                {r.state === "archived" ? " · Arquivado" : ""}
              </small>
            </span>
          </Button>
        </li>
      ))}
      {result && (page > 0 || result.hasMore) && (
        <li>
          <button
            disabled={loading || page === 0}
            onClick={() => setPage((n) => n - 1)}
          >
            Resultados anteriores
          </button>
          <span> Página {page + 1} </span>
          <button
            disabled={loading || !result.hasMore}
            onClick={() => setPage((n) => n + 1)}
          >
            Mais resultados
          </button>
        </li>
      )}
    </>
  );
}
