import { useState } from "react";
import { emptyDetails, type MovementDetails } from "../../services/metadata";
import { NameAutocomplete, useMetadata } from "./NameAutocomplete";
export function TransactionDetails({
  value,
  onChange,
}: {
  value: MovementDetails | undefined;
  onChange: (value: MovementDetails) => void;
}) {
  const details = value ?? emptyDetails;
  const [search, setSearch] = useState("");
  const { items, error, retry } = useMetadata("method", search, true);
  return (
    <details className="transaction-details">
      <summary>Mais detalhes</summary>
      <div className="metadata-fields">
        <label htmlFor="method-search">Buscar método</label>
        <input
          id="method-search"
          maxLength={120}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Pesquisar métodos de pagamento"
        />
        <label htmlFor="movement-method">Método de pagamento</label>
        <select
          id="movement-method"
          value={details.methodId ?? ""}
          onChange={(e) =>
            onChange({ ...details, methodId: Number(e.target.value) || null })
          }
        >
          <option value="">Não informado</option>
          {details.methodId &&
            !items.some((m) => m.id === details.methodId) && (
              <option value={details.methodId}>
                {details.methodName ?? `Método atual #${details.methodId}`}
              </option>
            )}
          {items
            .filter((m) => m.active || m.id === details.methodId)
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {!m.active ? " (arquivado)" : ""}
              </option>
            ))}
        </select>
        {error && (
          <div role="alert">
            Não foi possível consultar métodos.{" "}
            <button type="button" onClick={retry}>
              Tentar métodos novamente
            </button>
          </div>
        )}
        <NameAutocomplete
          kind="merchant"
          label="Estabelecimento"
          value={details.merchant ?? ""}
          onChange={(merchant) =>
            onChange({ ...details, merchant: merchant || null })
          }
        />
        <label htmlFor="movement-channel">Modalidade</label>
        <select
          id="movement-channel"
          value={details.channel ?? ""}
          onChange={(e) =>
            onChange({
              ...details,
              channel: (e.target.value || null) as MovementDetails["channel"],
            })
          }
        >
          <option value="">Não informado</option>
          <option value="in_person">Presencial</option>
          <option value="online">Online</option>
        </select>
        <NameAutocomplete
          kind="intermediary"
          label="Intermediário / plataforma"
          value={details.intermediary ?? ""}
          onChange={(intermediary) =>
            onChange({ ...details, intermediary: intermediary || null })
          }
        />
        <p className="field-help">
          Opcionais. Novos nomes são criados ao salvar; nomes existentes são
          reutilizados. O método descreve o pagamento e não altera o saldo nem
          cria cartão ou fatura.
        </p>
      </div>
    </details>
  );
}
