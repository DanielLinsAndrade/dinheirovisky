import { useState } from "react";
import type { CardInput, CreditCard } from "../../domain/cards";
import type { Account } from "../../domain/catalog";
import { useFormatting } from "../../app/SettingsContext";
export function CardForm({
  card,
  accounts,
  busy,
  onSave,
}: {
  card: CreditCard | null;
  accounts: Account[];
  busy: boolean;
  onSave: (input: CardInput) => Promise<void>;
}) {
  const { moneyInput, parseMoney, currencyLabel } = useFormatting();
  const [draft, setDraft] = useState<CardInput>(
    card ?? {
      id: null,
      name: "",
      institution: "",
      lastFour: null,
      brand: null,
      creditLimit: 0,
      closingDay: 5,
      dueDay: 10,
      defaultAccountId: null,
    },
  );
  const [amount, setAmount] = useState(moneyInput(draft.creditLimit));
  const [error, setError] = useState("");
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setError("");
        try {
          const creditLimit = parseMoney(amount);
          if (creditLimit < 0)
            throw new Error("O limite não pode ser negativo.");
          await onSave({ ...draft, creditLimit });
        } catch (e) {
          setError(String(e instanceof Error ? e.message : e));
        }
      }}
    >
      {error && <p role="alert">{error}</p>}
      <fieldset disabled={busy}>
        <label htmlFor="card-name">Nome do cartão</label>
        <input
          id="card-name"
          autoFocus
          required
          maxLength={120}
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
        <label htmlFor="card-institution">Instituição</label>
        <input
          id="card-institution"
          required
          maxLength={120}
          value={draft.institution}
          onChange={(e) => setDraft({ ...draft, institution: e.target.value })}
        />
        <label htmlFor="card-last">Final (opcional)</label>
        <input
          id="card-last"
          inputMode="numeric"
          maxLength={4}
          pattern="[0-9]{4}"
          value={draft.lastFour ?? ""}
          onChange={(e) =>
            setDraft({ ...draft, lastFour: e.target.value || null })
          }
        />
        <label htmlFor="card-brand">Bandeira (opcional)</label>
        <input
          id="card-brand"
          maxLength={120}
          value={draft.brand ?? ""}
          onChange={(e) =>
            setDraft({ ...draft, brand: e.target.value || null })
          }
        />
        <label htmlFor="card-limit">Limite ({currencyLabel})</label>
        <input
          id="card-limit"
          required
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <label htmlFor="card-close">Dia de fechamento</label>
        <input
          id="card-close"
          required
          type="number"
          min={1}
          max={31}
          value={draft.closingDay}
          onChange={(e) =>
            setDraft({ ...draft, closingDay: Number(e.target.value) })
          }
        />
        <label htmlFor="card-due">Dia de vencimento</label>
        <input
          id="card-due"
          required
          type="number"
          min={1}
          max={31}
          value={draft.dueDay}
          onChange={(e) =>
            setDraft({ ...draft, dueDay: Number(e.target.value) })
          }
        />
        <p className="field-help">
          Em meses curtos, usamos o último dia. O vencimento ocorre após o
          fechamento, no mês seguinte quando necessário.
        </p>
        <label htmlFor="card-account">
          Conta padrão de pagamento (opcional)
        </label>
        <select
          id="card-account"
          value={draft.defaultAccountId ?? ""}
          onChange={(e) =>
            setDraft({
              ...draft,
              defaultAccountId: Number(e.target.value) || null,
            })
          }
        >
          <option value="">Escolher depois</option>
          {accounts
            .filter((a) => a.active || a.id === draft.defaultAccountId)
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.active ? "" : " (arquivada)"}
              </option>
            ))}
        </select>
        <button className="action primary" type="submit">
          Salvar cartão
        </button>
      </fieldset>
    </form>
  );
}
