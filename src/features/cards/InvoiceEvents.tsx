import { useEffect, useState } from "react";
import type {
  InvoiceDetail,
  InvoiceEvent,
  InvoiceEventInput,
} from "../../domain/purchases";
import type { Account } from "../../domain/catalog";
import { listAccounts } from "../../services/catalog";
import { saveInvoiceEvent, voidInvoiceEvent } from "../../services/purchases";
import { useFormatting } from "../../app/SettingsContext";
import { localDate } from "../../domain/transactions";
const labels = {
  payment: "Pagamento",
  refund: "Estorno da compra",
  credit: "Crédito de fatura",
  charge: "Ajuste de cobrança",
};
export function InvoiceEvents({
  detail,
  defaultAccount,
  onChange,
}: {
  detail: InvoiceDetail;
  defaultAccount: number | null;
  onChange: () => void;
}) {
  const { formatMoney, displayDate, moneyInput, parseMoney, currencyLabel } =
    useFormatting();
  const [accounts, setAccounts] = useState<Account[] | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [attempt, setAttempt] = useState(0);
  const [draft, setDraft] = useState<InvoiceEventInput | null>(null),
    [amount, setAmount] = useState(""),
    [confirm, setConfirm] = useState<InvoiceEvent | null>(null);
  useEffect(() => {
    let active = true;
    setError("");
    listAccounts().then(
      (a) => {
        if (active) setAccounts(a);
      },
      (e) => {
        if (active) setError(String(e));
      },
    );
    return () => {
      active = false;
    };
  }, [attempt]);
  function edit(e?: InvoiceEvent) {
    setError("");
    setConfirm(null);
    const p: InvoiceEventInput = e ?? {
      requestKey: crypto.randomUUID(),
      id: null,
      invoiceId: detail.invoice.id,
      kind: "payment",
      accountId:
        accounts?.find((a) => a.active && a.id === defaultAccount)?.id ??
        accounts?.find((a) => a.active)?.id ??
        null,
      purchaseId: null,
      amount: Number(
        BigInt(detail.invoice.remaining) > BigInt(Number.MAX_SAFE_INTEGER)
          ? BigInt(Number.MAX_SAFE_INTEGER)
          : BigInt(detail.invoice.remaining),
      ),
      date: localDate(),
      description: "Pagamento da fatura",
    };
    setDraft(p);
    setAmount(moneyInput(p.amount));
  }
  async function save() {
    if (!draft) return;
    setBusy(true);
    setError("");
    try {
      await saveInvoiceEvent({ ...draft, amount: parseMoney(amount) });
      setDraft(null);
      onChange();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Pagamentos e ajustes da fatura">
      <h3>Pagamentos e ajustes</h3>
      <p>
        Pagamento movimenta a conta, sem nova despesa. Estorno reduz o consumo
        na data informada. Créditos e cobranças avulsos ajustam o consumo sem
        categoria.
      </p>
      {error && (
        <p role="alert">
          {error}
          {!accounts && (
            <button onClick={() => setAttempt((n) => n + 1)}>
              Tentar contas novamente
            </button>
          )}
        </p>
      )}
      {!draft && (
        <button
          className="action"
          disabled={!accounts || busy}
          onClick={() => edit()}
        >
          Registrar pagamento ou ajuste
        </button>
      )}
      {draft && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <fieldset disabled={busy}>
            <label htmlFor="event-kind">Tipo de evento</label>
            <select
              id="event-kind"
              disabled={draft.id !== null}
              value={draft.kind}
              onChange={(e) => {
                const kind = e.target.value as InvoiceEventInput["kind"];
                setDraft({
                  ...draft,
                  kind,
                  accountId:
                    kind === "payment"
                      ? (accounts?.find((a) => a.active)?.id ?? null)
                      : null,
                  purchaseId:
                    kind === "refund"
                      ? (detail.items.find((p) => p.status === "active")
                          ?.purchaseId ?? null)
                      : null,
                  description: labels[kind],
                });
              }}
            >
              {Object.entries(labels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
            {draft.kind === "payment" && (
              <>
                <label htmlFor="event-account">Conta de pagamento</label>
                <select
                  id="event-account"
                  required
                  value={draft.accountId ?? ""}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      accountId: Number(e.target.value) || null,
                    })
                  }
                >
                  <option value="">Escolha a conta</option>
                  {accounts
                    ?.filter((a) => a.active || a.id === draft.accountId)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                        {!a.active ? " (arquivada)" : ""}
                      </option>
                    ))}
                </select>
              </>
            )}
            {draft.kind === "refund" && (
              <>
                <label htmlFor="event-purchase">
                  Compra de origem do estorno
                </label>
                <select
                  id="event-purchase"
                  required
                  disabled={draft.id !== null}
                  value={draft.purchaseId ?? ""}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      purchaseId: Number(e.target.value) || null,
                    })
                  }
                >
                  <option value="">Escolha a compra</option>
                  {detail.items
                    .filter(
                      (p, i, all) =>
                        p.status === "active" &&
                        all.findIndex((x) => x.purchaseId === p.purchaseId) ===
                          i,
                    )
                    .map((p) => (
                      <option key={p.purchaseId} value={p.purchaseId}>
                        {p.description}
                      </option>
                    ))}
                </select>
              </>
            )}
            <label htmlFor="event-amount">
              Valor do evento ({currencyLabel})
            </label>
            <input
              id="event-amount"
              inputMode="decimal"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <label htmlFor="event-date">Data do evento</label>
            <input
              id="event-date"
              type="date"
              required
              min="0001-01-01"
              max="9999-12-31"
              value={draft.date}
              onChange={(e) => setDraft({ ...draft, date: e.target.value })}
            />
            <label htmlFor="event-description">Descrição / motivo</label>
            <input
              id="event-description"
              required
              maxLength={240}
              value={draft.description}
              onChange={(e) =>
                setDraft({ ...draft, description: e.target.value })
              }
            />
            <button className="action primary" type="submit">
              Salvar evento
            </button>
            <button
              className="action"
              type="button"
              onClick={() => setDraft(null)}
            >
              Cancelar edição do evento
            </button>
          </fieldset>
        </form>
      )}
      {!detail.events.length ? (
        <p>Nenhum pagamento ou ajuste registrado.</p>
      ) : (
        <div
          className="table-scroll"
          tabIndex={0}
          role="region"
          aria-label="Rolagem dos pagamentos e ajustes"
        >
          <table>
            <caption>Histórico de pagamentos e ajustes</caption>
            <thead>
              <tr>
                <th>Evento</th>
                <th>Data</th>
                <th>Valor</th>
                <th>Estado</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {detail.events.map((e) => (
                <tr key={e.id}>
                  <th scope="row">
                    {labels[e.kind]} — {e.description}
                    {e.accountName && <small>{e.accountName}</small>}
                  </th>
                  <td>{displayDate(e.date)}</td>
                  <td>{formatMoney(e.amount)}</td>
                  <td>{e.voided ? "Desfeito" : "Ativo"}</td>
                  <td>
                    <button
                      className="text-action"
                      disabled={busy || e.voided}
                      onClick={() => edit(e)}
                    >
                      Editar evento {e.id}
                    </button>
                    <button
                      className="text-action"
                      disabled={busy || e.voided}
                      onClick={() => {
                        setDraft(null);
                        setConfirm(e);
                      }}
                    >
                      Desfazer evento {e.id}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {confirm && (
        <section aria-label="Confirmação de desfazer evento">
          <p>
            Desfazer {labels[confirm.kind]} de {formatMoney(confirm.amount)}? O
            efeito financeiro será revertido e o registro preservado.
          </p>
          <button
            className="action"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await voidInvoiceEvent(confirm.id!);
                setConfirm(null);
                onChange();
              } catch (e) {
                setError(String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Confirmar desfazer evento
          </button>
          <button disabled={busy} onClick={() => setConfirm(null)}>
            Manter evento
          </button>
        </section>
      )}
    </section>
  );
}
