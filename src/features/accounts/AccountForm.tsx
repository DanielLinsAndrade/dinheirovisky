import { useState, type FormEvent } from "react";
import {
  accountTypes,
  type Account,
  type AccountInput,
  type AccountKind,
} from "../../domain/catalog";
import { useFormatting } from "../../app/SettingsContext";

export function AccountForm({
  account,
  busy,
  onSave,
}: {
  account: Account | null;
  busy: boolean;
  onSave: (input: AccountInput) => Promise<void>;
}) {
  const { moneyInput, parseMoney, currencyLabel, decimal } = useFormatting();
  const [name, setName] = useState(account?.name ?? "");
  const [kind, setKind] = useState<AccountKind>(account?.kind ?? "checking");
  const [balance, setBalance] = useState(
    moneyInput(account?.initialBalance ?? 0),
  );
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await onSave({
        id: account?.id ?? null,
        name: name.trim(),
        kind,
        initialBalance: parseMoney(balance),
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
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
        <label htmlFor="account-name">Nome da conta</label>
        <input
          id="account-name"
          required
          maxLength={120}
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoFocus
          autoComplete="off"
        />
        <label htmlFor="account-kind">Tipo de conta</label>
        <select
          id="account-kind"
          value={kind}
          onChange={(event) => setKind(event.target.value as AccountKind)}
        >
          {Object.entries(accountTypes).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <label htmlFor="account-balance">Saldo inicial ({currencyLabel})</label>
        <input
          id="account-balance"
          required
          maxLength={40}
          inputMode="decimal"
          aria-describedby="balance-help"
          value={balance}
          onChange={(event) => setBalance(event.target.value)}
        />
        <p id="balance-help" className="field-help">
          Use {decimal} como separador decimal. Valores negativos são
          permitidos. Este é o valor de partida da conta. Alterá-lo também
          ajusta o saldo atual.
        </p>
        <button className="action primary" type="submit">
          {busy ? "Salvando…" : "Salvar conta"}
        </button>
      </fieldset>
    </form>
  );
}
