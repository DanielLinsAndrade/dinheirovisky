import { useState } from "react";
import { useFormatting } from "../../app/SettingsContext";
import type { PurchaseInput } from "../../domain/purchases";
import type { Category } from "../../domain/catalog";
import { localDate } from "../../domain/transactions";
import { NameAutocomplete } from "../metadata/NameAutocomplete";
export function PurchaseForm({
  cardId,
  purchase,
  categories,
  busy,
  onSave,
}: {
  cardId: number;
  purchase: PurchaseInput | null;
  categories: Category[];
  busy: boolean;
  onSave: (p: PurchaseInput) => Promise<void>;
}) {
  const { moneyInput, parseMoney, currencyLabel } = useFormatting();
  const [draft, setDraft] = useState<PurchaseInput>(
    purchase ?? {
      id: null,
      cardId,
      description: "",
      date: localDate(),
      amount: 0,
      installmentCount: 1,
      categoryId: null,
      merchant: null,
      intermediary: null,
      channel: null,
      notes: null,
    },
  );
  const [amount, setAmount] = useState(
    purchase ? moneyInput(purchase.amount) : "",
  );
  const [error, setError] = useState("");
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setError("");
        try {
          const cents = parseMoney(amount);
          if (cents <= 0 || draft.installmentCount > cents)
            throw new Error(
              "Informe valor positivo, sem parcelas de zero centavos.",
            );
          await onSave({ ...draft, amount: cents });
        } catch (e) {
          setError(String(e));
        }
      }}
    >
      {error && <p role="alert">{error}</p>}
      <fieldset disabled={busy}>
        <label htmlFor="purchase-description">Descrição da compra</label>
        <input
          id="purchase-description"
          required
          maxLength={240}
          value={draft.description}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
        />
        <label htmlFor="purchase-date">Data da compra</label>
        <input
          id="purchase-date"
          type="date"
          min="0001-01-01"
          max="9999-12-31"
          required
          value={draft.date}
          onChange={(e) => setDraft({ ...draft, date: e.target.value })}
        />
        <label htmlFor="purchase-amount">
          Total da compra ({currencyLabel})
        </label>
        <input
          id="purchase-amount"
          inputMode="decimal"
          required
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <label htmlFor="purchase-count">Número de parcelas</label>
        <input
          id="purchase-count"
          type="number"
          min={1}
          max={120}
          step={1}
          required
          value={draft.installmentCount}
          onChange={(e) =>
            setDraft({ ...draft, installmentCount: Number(e.target.value) })
          }
        />
        <p>
          O total é reconhecido uma vez na data da compra. Centavos restantes
          vão para as primeiras parcelas. O saldo da conta não muda.
        </p>
        <label htmlFor="purchase-category">Categoria da compra</label>
        <select
          id="purchase-category"
          value={draft.categoryId ?? ""}
          onChange={(e) =>
            setDraft({ ...draft, categoryId: Number(e.target.value) || null })
          }
        >
          <option value="">Sem categoria</option>
          {categories
            .filter(
              (c) =>
                c.kind === "expense" && (c.active || c.id === draft.categoryId),
            )
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {!c.active ? " (arquivada)" : ""}
              </option>
            ))}
        </select>
        <details>
          <summary>Mais detalhes da compra</summary>
          <NameAutocomplete
            kind="merchant"
            label="Estabelecimento da compra"
            value={draft.merchant ?? ""}
            onChange={(merchant) =>
              setDraft({ ...draft, merchant: merchant || null })
            }
          />
          <label htmlFor="purchase-channel">Modalidade da compra</label>
          <select
            id="purchase-channel"
            value={draft.channel ?? ""}
            onChange={(e) =>
              setDraft({ ...draft, channel: e.target.value || null })
            }
          >
            <option value="">Não informada</option>
            <option value="in_person">Presencial</option>
            <option value="online">Online</option>
          </select>
          <NameAutocomplete
            kind="intermediary"
            label="Intermediário da compra"
            value={draft.intermediary ?? ""}
            onChange={(intermediary) =>
              setDraft({ ...draft, intermediary: intermediary || null })
            }
          />
          <label htmlFor="purchase-notes">Observações da compra</label>
          <textarea
            id="purchase-notes"
            maxLength={4000}
            value={draft.notes ?? ""}
            onChange={(e) =>
              setDraft({ ...draft, notes: e.target.value || null })
            }
          />
        </details>
        <button className="action primary" type="submit">
          Salvar compra
        </button>
      </fieldset>
    </form>
  );
}
