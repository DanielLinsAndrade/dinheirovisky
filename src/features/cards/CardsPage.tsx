import { useEffect, useState, useRef } from "react";
import { Editor } from "../../components/Editor";
import { Badge } from "../../components/Surface";
import { useFormatting } from "../../app/SettingsContext";
import { listAccounts } from "../../services/catalog";
import type { Account } from "../../domain/catalog";
import type { CreditCard, CardInput } from "../../domain/cards";
import {
  listCards,
  saveCard,
  setCardActive,
  deleteCard,
} from "../../services/cards";
import { useCatalog } from "../useCatalog";
import { CardForm } from "./CardForm";
import { CardCalendar } from "./CardCalendar";
import { PurchasesPanel } from "./PurchasesPanel";
export function CardsPage({
  initialCardId,
  initialInvoiceId,
}: {
  initialCardId?: number;
  initialInvoiceId?: number;
}) {
  const catalog = useCatalog(listCards);
  const { formatMoney } = useFormatting();
  const [editing, setEditing] = useState<CreditCard | null | undefined>();
  const [calendar, setCalendar] = useState<CreditCard | null>(null);
  const [deleting, setDeleting] = useState<CreditCard | null>(null);
  const [accounts, setAccounts] = useState<Account[] | null>(null),
    [accountError, setAccountError] = useState(""),
    [attempt, setAttempt] = useState(0);
  const [filter, setFilter] = useState("active");
  const [selected, setSelected] = useState<CreditCard | null>(null);
  const targetOpened = useRef(false);
  useEffect(() => {
    if (targetOpened.current || initialCardId === undefined || !catalog.items)
      return;
    const card = catalog.items.find((c) => c.id === initialCardId);
    if (card) {
      targetOpened.current = true;
      setSelected(card);
    }
  }, [initialCardId, catalog.items]);
  useEffect(() => {
    let active = true;
    setAccounts(null);
    setAccountError("");
    listAccounts().then(
      (r) => {
        if (active) setAccounts(r);
      },
      (e) => {
        if (active) setAccountError(String(e));
      },
    );
    return () => {
      active = false;
    };
  }, [attempt]);
  async function save(input: CardInput) {
    if (await catalog.mutate(() => saveCard(input), "Cartão salvo."))
      setEditing(undefined);
  }
  const visible = (catalog.items ?? []).filter(
    (c) => filter === "all" || c.active === (filter === "active"),
  );
  if (selected)
    return (
      <PurchasesPanel
        key={selected.id}
        card={selected}
        initialInvoiceId={initialInvoiceId}
        onBack={() => setSelected(null)}
      />
    );
  return (
    <section aria-label="Cadastro de cartões">
      <div className="page-tools">
        <p className="intro">
          Organize limites e datas dos seus cartões. Limite de crédito não é
          saldo em conta.
        </p>
        <button
          className="action primary"
          disabled={
            catalog.busy || !catalog.items || !accounts || editing !== undefined
          }
          onClick={() => {
            catalog.clearFeedback();
            setEditing(null);
          }}
        >
          Novo cartão
        </button>
      </div>
      {accountError && (
        <p role="alert">
          {accountError}{" "}
          <button className="action" onClick={() => setAttempt((n) => n + 1)}>
            Tentar contas novamente
          </button>
        </p>
      )}
      {catalog.error && (
        <p role="alert">
          {catalog.error}{" "}
          <button
            className="action"
            disabled={catalog.busy}
            onClick={catalog.reload}
          >
            Atualizar cartões
          </button>
        </p>
      )}
      {catalog.notice && (
        <p role="status" className="notice">
          {catalog.notice}
        </p>
      )}
      <div className="list-tools">
        <label htmlFor="cards-filter">Exibir cartões</label>
        <select
          id="cards-filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="active">Ativos</option>
          <option value="archived">Arquivados</option>
          <option value="all">Todos</option>
        </select>
      </div>
      {catalog.busy && !catalog.items ? (
        <p role="status">Carregando cartões…</p>
      ) : catalog.items && !visible.length ? (
        <p className="empty-state">
          {catalog.items.length
            ? "Nenhum cartão neste filtro."
            : "Cadastre seu primeiro cartão para organizar limite, fechamento e vencimento."}
        </p>
      ) : (
        catalog.items && (
          <div
            className="table-scroll"
            tabIndex={0}
            role="region"
            aria-label="Rolagem dos cartões cadastrados"
          >
            <table>
              <caption>Cartões cadastrados</caption>
              <thead>
                <tr>
                  <th>Cartão</th>
                  <th>Limite cadastrado</th>
                  <th>Datas</th>
                  <th>Conta padrão</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((card) => (
                  <tr key={card.id}>
                    <th scope="row">
                      {card.name}
                      <small className="movement-metadata">
                        {card.institution}
                        {card.brand ? ` · ${card.brand}` : ""}
                        {card.lastFour ? ` · final ${card.lastFour}` : ""}
                      </small>
                      <Badge>{card.active ? "Ativo" : "Arquivado"}</Badge>
                    </th>
                    <td className="money">{formatMoney(card.creditLimit)}</td>
                    <td>
                      Fecha dia {card.closingDay}
                      <br />
                      Vence dia {card.dueDay}
                    </td>
                    <td>
                      {card.defaultAccountId === null
                        ? "Não definida"
                        : (accounts?.find((a) => a.id === card.defaultAccountId)
                            ?.name ?? "Conta vinculada")}
                    </td>
                    <td className="row-actions">
                      <button
                        className="text-action"
                        aria-label={`Compras e faturas de ${card.name}`}
                        onClick={() => setSelected(card)}
                      >
                        Compras e faturas
                      </button>
                      <button
                        className="text-action"
                        aria-label={`Editar ${card.name}`}
                        disabled={catalog.busy || !accounts}
                        onClick={() => {
                          catalog.clearFeedback();
                          setEditing(card);
                        }}
                      >
                        Editar
                      </button>
                      <button
                        className="text-action"
                        aria-label={`Calendário de ${card.name}`}
                        onClick={() => setCalendar(card)}
                      >
                        Calendário
                      </button>
                      <button
                        className="text-action"
                        aria-label={`${card.active ? "Arquivar" : "Reativar"} ${card.name}`}
                        disabled={catalog.busy}
                        onClick={() =>
                          void catalog.mutate(
                            () => setCardActive(card.id!, !card.active),
                            card.active
                              ? "Cartão arquivado. Cadastro preservado."
                              : "Cartão reativado.",
                          )
                        }
                      >
                        {card.active ? "Arquivar" : "Reativar"}
                      </button>
                      <button
                        className="text-action"
                        aria-label={`Excluir ${card.name}`}
                        disabled={catalog.busy}
                        onClick={() => {
                          catalog.clearFeedback();
                          setDeleting(card);
                        }}
                      >
                        Excluir
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
      {editing !== undefined && accounts && (
        <Editor
          title={editing ? "Editar cartão" : "Novo cartão"}
          busy={catalog.busy}
          error={catalog.error}
          onClose={() => setEditing(undefined)}
        >
          <CardForm
            card={editing}
            accounts={accounts}
            busy={catalog.busy}
            onSave={save}
          />
        </Editor>
      )}
      {calendar && (
        <Editor
          title={`Calendário de ${calendar.name}`}
          busy={false}
          error=""
          onClose={() => setCalendar(null)}
        >
          <CardCalendar card={calendar} />
        </Editor>
      )}
      {deleting && (
        <Editor
          title="Excluir cartão"
          busy={catalog.busy}
          error={catalog.error}
          onClose={() => setDeleting(null)}
        >
          <p>
            Excluir “{deleting.name}”? A exclusão é definitiva. Para manter o
            cadastro, prefira arquivar.
          </p>
          <button
            className="action"
            disabled={catalog.busy}
            onClick={async () => {
              if (
                await catalog.mutate(
                  () => deleteCard(deleting.id!),
                  "Cartão excluído.",
                )
              )
                setDeleting(null);
            }}
          >
            Confirmar exclusão do cartão
          </button>
        </Editor>
      )}
    </section>
  );
}
