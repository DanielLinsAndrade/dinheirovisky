import { useEffect, useState } from "react";
import { useFormatting } from "../../app/SettingsContext";
import { Editor } from "../../components/Editor";
import type { CreditCard } from "../../domain/cards";
import type { Category } from "../../domain/catalog";
import type {
  Purchase,
  PurchasePage,
  InvoicePage,
  InvoiceDetail,
} from "../../domain/purchases";
import { localDate } from "../../domain/transactions";
import { listCategories } from "../../services/catalog";
import {
  queryPurchases,
  queryInvoices,
  invoiceDetail,
  savePurchase,
  cancelPurchase,
} from "../../services/purchases";
import { PurchaseForm } from "./PurchaseForm";
import { InvoiceEvents } from "./InvoiceEvents";
import { Attachments } from "../attachments/Attachments";
const states = {
  open: "Aberta",
  closed: "Fechada",
  overdue: "Vencida",
  partial: "Parcialmente paga",
  paid: "Paga",
};
export function PurchasesPanel({
  card,
  onBack,
  initialInvoiceId,
}: {
  card: CreditCard;
  onBack: () => void;
  initialInvoiceId?: number;
}) {
  const { formatMoney, displayDate } = useFormatting();
  const [page, setPage] = useState(0),
    [invoicePage, setInvoicePage] = useState(0),
    [revision, setRevision] = useState(0);
  const [data, setData] = useState<{
    purchases: PurchasePage;
    invoices: InvoicePage;
    categories: Category[];
  } | null>(null);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Purchase | null | undefined>(),
    [cancelling, setCancelling] = useState<Purchase | null>(null),
    [detail, setDetail] = useState<InvoiceDetail | null>(null);
  const [detailId, setDetailId] = useState<number | null>(
      initialInvoiceId ?? null,
    ),
    [detailError, setDetailError] = useState("");
  const [attachmentTarget, setAttachmentTarget] = useState<Purchase | null>(
    null,
  );
  useEffect(() => {
    let active = true;
    setData(null);
    setError("");
    Promise.all([
      queryPurchases(card.id!, page),
      queryInvoices(card.id!, localDate(), invoicePage),
      listCategories(),
    ]).then(
      ([purchases, invoices, categories]) => {
        if (active) setData({ purchases, invoices, categories });
      },
      (e) => {
        if (active) setError(String(e));
      },
    );
    return () => {
      active = false;
    };
  }, [card.id, page, invoicePage, revision]);
  useEffect(() => {
    if (detailId === null) return;
    let active = true;
    setDetail(null);
    setDetailError("");
    invoiceDetail(detailId, localDate()).then(
      (d) => {
        if (active) setDetail(d);
      },
      (e) => {
        if (active) setDetailError(String(e));
      },
    );
    return () => {
      active = false;
    };
  }, [detailId, revision]);
  async function mutate(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      setNotice(message);
      setRevision((n) => n + 1);
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label={`Compras e faturas de ${card.name}`}>
      <div className="page-tools">
        <button className="action" onClick={onBack} disabled={busy}>
          Voltar aos cartões
        </button>
        <h2>{card.name} — compras e faturas</h2>
        <button
          className="action primary"
          disabled={!card.active || !data || busy}
          onClick={() => {
            setError("");
            setEditing(null);
          }}
        >
          Nova compra no cartão
        </button>
      </div>
      <p>
        Consumo: total da compra na data em que ocorreu. Faturas: obrigações
        parceladas. Nenhuma compra movimenta o saldo bancário.
      </p>
      {!card.active && (
        <p>
          Cartão arquivado: histórico preservado. Reative-o para novas compras.
        </p>
      )}
      {error && (
        <p role="alert">
          {error}{" "}
          <button onClick={() => setRevision((n) => n + 1)} disabled={busy}>
            Tentar compras novamente
          </button>
        </p>
      )}
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      {!data && !error && <p role="status">Carregando compras e faturas…</p>}
      {data && (
        <>
          <p>
            Limite comprometido:{" "}
            <strong>{formatMoney(BigInt(data.invoices.committed))}</strong> ·
            Disponível:{" "}
            <strong>{formatMoney(BigInt(data.invoices.available))}</strong>
          </p>
          <h3>Compras — consumo</h3>
          {!data.purchases.total ? (
            <p className="empty-state">
              Nenhuma compra. Registre uma compra à vista ou parcelada neste
              cartão.
            </p>
          ) : (
            <div
              className="table-scroll"
              tabIndex={0}
              role="region"
              aria-label="Rolagem das compras do cartão"
            >
              <table>
                <caption>Compras do cartão</caption>
                <thead>
                  <tr>
                    <th>Descrição</th>
                    <th>Data</th>
                    <th>Total</th>
                    <th>Parcelas</th>
                    <th>Estado</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {data.purchases.items.map((p) => (
                    <tr key={p.id}>
                      <th scope="row">{p.description}</th>
                      <td>{displayDate(p.date)}</td>
                      <td className="money">{formatMoney(p.amount)}</td>
                      <td>{p.installmentCount}</td>
                      <td>{p.status === "active" ? "Ativa" : "Cancelada"}</td>
                      <td>
                        <button
                          className="text-action"
                          disabled={busy || p.status !== "active"}
                          onClick={() => {
                            setError("");
                            setEditing(p);
                          }}
                        >
                          Editar compra {p.description}
                        </button>
                        <button
                          className="text-action"
                          disabled={busy}
                          onClick={() => setAttachmentTarget(p)}
                        >
                          Anexos de {p.description}
                        </button>
                        <button
                          className="text-action"
                          disabled={busy || p.status !== "active"}
                          onClick={() => {
                            setError("");
                            setCancelling(p);
                          }}
                        >
                          Cancelar compra {p.description}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="list-tools">
            <button
              disabled={data.purchases.page === 0}
              onClick={() => setPage(data.purchases.page - 1)}
            >
              Compras anteriores
            </button>
            <span>
              Página {data.purchases.page + 1} · {data.purchases.total} compras
            </span>
            <button
              disabled={(data.purchases.page + 1) * 50 >= data.purchases.total}
              onClick={() => setPage(data.purchases.page + 1)}
            >
              Próximas compras
            </button>
          </div>
          <h3>Faturas — obrigações</h3>
          {!data.invoices.total ? (
            <p className="empty-state">
              As faturas são criadas pelas parcelas das compras.
            </p>
          ) : (
            <div
              className="table-scroll"
              tabIndex={0}
              role="region"
              aria-label="Rolagem das faturas do cartão"
            >
              <table>
                <caption>Faturas do cartão</caption>
                <thead>
                  <tr>
                    <th>Ciclo</th>
                    <th>Fechamento</th>
                    <th>Vencimento</th>
                    <th>Restante</th>
                    <th>Estado</th>
                    <th>Detalhes</th>
                  </tr>
                </thead>
                <tbody>
                  {data.invoices.items.map((i) => (
                    <tr key={i.id}>
                      <th scope="row">{i.month}</th>
                      <td>{displayDate(i.closingDate)}</td>
                      <td>{displayDate(i.dueDate)}</td>
                      <td className="money">
                        {formatMoney(BigInt(i.remaining))}
                      </td>
                      <td>{states[i.state]}</td>
                      <td>
                        <button
                          className="text-action"
                          onClick={() => setDetailId(i.id)}
                        >
                          Ver fatura {i.month}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="list-tools">
            <button
              disabled={data.invoices.page === 0}
              onClick={() => setInvoicePage(data.invoices.page - 1)}
            >
              Faturas anteriores
            </button>
            <span>
              Página {data.invoices.page + 1} · {data.invoices.total} faturas
            </span>
            <button
              disabled={(data.invoices.page + 1) * 24 >= data.invoices.total}
              onClick={() => setInvoicePage(data.invoices.page + 1)}
            >
              Próximas faturas
            </button>
            <button onClick={() => setRevision((n) => n + 1)}>
              Atualizar faturas
            </button>
          </div>
        </>
      )}
      {attachmentTarget && (
        <Attachments
          kind="purchase"
          id={attachmentTarget.id!}
          name={attachmentTarget.description}
          onClose={() => setAttachmentTarget(null)}
        />
      )}
      {editing !== undefined && data && (
        <Editor
          title={editing ? "Editar compra" : "Nova compra no cartão"}
          busy={busy}
          error={error}
          onClose={() => setEditing(undefined)}
        >
          <PurchaseForm
            cardId={card.id!}
            purchase={editing}
            categories={data.categories}
            busy={busy}
            onSave={async (p) => {
              if (
                await mutate(
                  () => savePurchase(p),
                  "Compra salva; parcelas e faturas atualizadas.",
                )
              )
                setEditing(undefined);
            }}
          />
        </Editor>
      )}
      {cancelling && (
        <Editor
          title="Cancelar compra"
          busy={busy}
          error={error}
          onClose={() => setCancelling(null)}
        >
          <p>
            Cancelar “{cancelling.description}”? O consumo e o compromisso das
            parcelas serão removidos dos totais. A compra e suas parcelas
            permanecem no histórico. Esta ação não é um estorno.
          </p>
          <button
            className="action"
            disabled={busy}
            onClick={async () => {
              if (
                await mutate(
                  () => cancelPurchase(cancelling.id!),
                  "Compra cancelada. Histórico preservado.",
                )
              )
                setCancelling(null);
            }}
          >
            Confirmar cancelamento da compra
          </button>
        </Editor>
      )}
      {detailId !== null && (
        <Editor
          title="Detalhes da fatura"
          busy={false}
          error={detailError}
          onClose={() => setDetailId(null)}
        >
          {!detail && !detailError && <p role="status">Carregando fatura…</p>}
          {detailError && (
            <button onClick={() => setRevision((n) => n + 1)}>
              Tentar fatura novamente
            </button>
          )}
          {detail && (
            <>
              <p>
                Ciclo {detail.invoice.month} · {states[detail.invoice.state]}
              </p>
              <dl>
                <dt>Cobranças</dt>
                <dd>{formatMoney(BigInt(detail.invoice.charges))}</dd>
                <dt>Créditos</dt>
                <dd>{formatMoney(BigInt(detail.invoice.credits))}</dd>
                <dt>Total líquido</dt>
                <dd>{formatMoney(BigInt(detail.invoice.net))}</dd>
                <dt>Pago</dt>
                <dd>{formatMoney(BigInt(detail.invoice.paid))}</dd>
                <dt>Restante</dt>
                <dd>{formatMoney(BigInt(detail.invoice.remaining))}</dd>
                <dt>Crédito remanescente na fatura</dt>
                <dd>{formatMoney(BigInt(detail.invoice.creditBalance))}</dd>
              </dl>
              <div
                className="table-scroll"
                tabIndex={0}
                role="region"
                aria-label="Rolagem das parcelas da fatura"
              >
                <table>
                  <caption>Parcelas desta fatura</caption>
                  <thead>
                    <tr>
                      <th>Compra</th>
                      <th>Parcela</th>
                      <th>Valor</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.items.map((p) => (
                      <tr key={`${p.purchaseId}-${p.number}`}>
                        <th scope="row">{p.description}</th>
                        <td>
                          {p.number}/{p.count}
                        </td>
                        <td>{formatMoney(p.amount)}</td>
                        <td>{p.status === "active" ? "Ativa" : "Cancelada"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!detail.items.length && <p>Nenhuma parcela neste ciclo.</p>}
              <InvoiceEvents
                detail={detail}
                defaultAccount={card.defaultAccountId}
                onChange={() => setRevision((n) => n + 1)}
              />
            </>
          )}
        </Editor>
      )}
    </section>
  );
}
