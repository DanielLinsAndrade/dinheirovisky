import { TransactionDetails } from "../metadata/TransactionDetails";
import { useState, type FormEvent } from "react";
import {
  categoryPath,
  type Account,
  type Category,
} from "../../domain/catalog";
import {
  localDate,
  movementTypes,
  movementStatuses,
  type Movement,
} from "../../domain/transactions";
import { useFormatting } from "../../app/SettingsContext";

export function TransactionForm({
  movement,
  accounts,
  categories,
  busy,
  onSave,
  metadataEnabled = true,
}: {
  metadataEnabled?: boolean;
  movement: Movement | null;
  accounts: Account[];
  categories: Category[];
  busy: boolean;
  onSave: (m: Movement) => Promise<void>;
}) {
  const { moneyInput, parseMoney, currencyLabel, decimal } = useFormatting();
  const [draft, setDraft] = useState<Movement>(
    movement ?? {
      id: null,
      description: "",
      amount: 0,
      kind: "expense",
      date: localDate(),
      accountId: accounts.find((a) => a.active)?.id ?? 0,
      destinationAccountId: null,
      categoryId: null,
      status: "posted",
      notes: "",
    },
  );
  const [amount, setAmount] = useState(
    movement ? moneyInput(movement.amount) : "",
  );
  const [error, setError] = useState("");
  const usable = accounts.filter(
    (a) =>
      a.active ||
      a.id === movement?.accountId ||
      a.id === movement?.destinationAccountId,
  );
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const cents = parseMoney(amount);
      if (cents <= 0) throw new Error("Informe um valor maior que zero.");
      await onSave({ ...draft, amount: cents });
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
  }
  return (
    <form onSubmit={submit}>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <fieldset disabled={busy}>
        <label htmlFor="movement-description">Descrição</label>
        <input
          id="movement-description"
          autoFocus
          required
          maxLength={240}
          value={draft.description}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
        />
        <label htmlFor="movement-kind">Tipo</label>
        <select
          id="movement-kind"
          value={draft.kind}
          onChange={(e) =>
            setDraft({
              ...draft,
              kind: e.target.value as Movement["kind"],
              categoryId: null,
              destinationAccountId: null,
            })
          }
        >
          {Object.entries(movementTypes).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <label htmlFor="movement-amount">Valor ({currencyLabel})</label>
        <input
          id="movement-amount"
          inputMode="decimal"
          required
          maxLength={40}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <label htmlFor="movement-date">Data</label>
        <p className="field-help">
          Use {decimal} como separador decimal para o valor.
        </p>
        <input
          id="movement-date"
          type="date"
          min="0001-01-01"
          max="9999-12-31"
          required
          value={draft.date}
          onChange={(e) => setDraft({ ...draft, date: e.target.value })}
        />
        <label htmlFor="movement-account">Conta de origem</label>
        <select
          id="movement-account"
          required
          value={draft.accountId || ""}
          onChange={(e) =>
            setDraft({ ...draft, accountId: Number(e.target.value) })
          }
        >
          <option value="">Selecione</option>
          {usable.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
              {!a.active ? " (arquivada)" : ""}
            </option>
          ))}
        </select>
        {draft.kind === "transfer" ? (
          <>
            <label htmlFor="movement-destination">Conta de destino</label>
            <select
              id="movement-destination"
              required
              value={draft.destinationAccountId ?? ""}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  destinationAccountId: Number(e.target.value) || null,
                })
              }
            >
              <option value="">Selecione</option>
              {usable
                .filter((a) => a.id !== draft.accountId)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </select>
          </>
        ) : (
          <>
            <label htmlFor="movement-category">Categoria</label>
            <select
              id="movement-category"
              value={draft.categoryId ?? ""}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  categoryId: Number(e.target.value) || null,
                })
              }
            >
              <option value="">Sem categoria</option>
              {categories
                .filter(
                  (c) =>
                    c.kind === draft.kind &&
                    (c.active || c.id === movement?.categoryId),
                )
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {categoryPath(c, categories)}
                    {!c.active ? " (arquivada)" : ""}
                  </option>
                ))}
            </select>
          </>
        )}
        <label htmlFor="movement-status">Situação</label>
        <select
          id="movement-status"
          value={draft.status}
          onChange={(e) =>
            setDraft({ ...draft, status: e.target.value as Movement["status"] })
          }
        >
          {Object.entries(movementStatuses).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <p className="field-help">
          Somente efetivados alteram o saldo, independentemente da data.
          Programados e pendentes exigem efetivação manual.
        </p>
        {metadataEnabled && (
          <TransactionDetails
            value={draft.details}
            onChange={(details) => setDraft({ ...draft, details })}
          />
        )}
        <label htmlFor="movement-notes">Observações</label>
        <textarea
          id="movement-notes"
          rows={4}
          maxLength={4000}
          value={draft.notes ?? ""}
          onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
        />
        <button className="action primary" type="submit">
          {busy ? "Salvando…" : "Salvar transação"}
        </button>
      </fieldset>
    </form>
  );
}
