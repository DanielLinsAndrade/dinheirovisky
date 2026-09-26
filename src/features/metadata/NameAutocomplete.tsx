import { useEffect, useId, useState } from "react";
import {
  queryMetadata,
  type MetadataKind,
  type Metadata,
} from "../../services/metadata";
export function useMetadata(
  kind: MetadataKind,
  search: string,
  archived = false,
  revision = 0,
) {
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify([kind, search, archived, attempt, revision]);
  const [result, setResult] = useState<{
    key: string;
    items: Metadata[];
    error: string;
  } | null>(null);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      queryMetadata(kind, search, archived).then(
        (items) => {
          if (active) setResult({ key, items, error: "" });
        },
        (error) => {
          if (active) setResult({ key, items: [], error: String(error) });
        },
      );
    }, 150);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [kind, search, archived, key]);
  const current = result?.key === key ? result : null;
  return {
    items: current?.items ?? [],
    error: current?.error ?? "",
    loading: !current,
    retry: () => setAttempt((n) => n + 1),
  };
}
export function NameAutocomplete({
  kind,
  label,
  value,
  onChange,
}: {
  kind: MetadataKind;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const { items, error, retry } = useMetadata(kind, value);
  return (
    <div className="metadata-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        maxLength={120}
        list={`${id}-suggestions`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <datalist id={`${id}-suggestions`}>
        {items.map((item) => (
          <option key={item.id} value={item.name} />
        ))}
      </datalist>
      {error && (
        <div role="alert">
          Não foi possível consultar sugestões.{" "}
          <button type="button" className="text-action" onClick={retry}>
            Tentar sugestões de {label.toLowerCase()}
          </button>
        </div>
      )}
    </div>
  );
}
