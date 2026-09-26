import { useId, useState } from "react";
import { type MetadataKind } from "../../services/metadata";
import { useMetadata } from "./NameAutocomplete";
export function MetadataFilter({
  revision,
  kind,
  label,
  value,
  onChange,
}: {
  revision: number;
  kind: MetadataKind;
  label: string;
  value: string;
  onChange: (id: string) => void;
}) {
  const id = useId();
  const [search, setSearch] = useState("");
  const { items, error, retry } = useMetadata(kind, search, true, revision);
  return (
    <div className="metadata-field">
      <label htmlFor={id}>{label}</label>
      <input
        aria-label={`Buscar opções de ${label.toLowerCase()}`}
        value={search}
        maxLength={120}
        placeholder="Buscar opções"
        onChange={(e) => setSearch(e.target.value)}
      />
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Todos</option>
        {value && !items.some((m) => String(m.id) === value) && (
          <option value={value}>Seleção #{value}</option>
        )}
        {items.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
            {m.active ? "" : " (arquivado)"}
          </option>
        ))}
      </select>
      {error && (
        <div role="alert">
          {error}
          <button type="button" onClick={retry}>
            Tentar filtro de {label.toLowerCase()}
          </button>
        </div>
      )}
    </div>
  );
}
