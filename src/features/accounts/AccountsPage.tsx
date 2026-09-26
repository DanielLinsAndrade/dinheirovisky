import { Badge } from "../../components/Surface";
import { sumMoney } from "../../domain/money";
import { useEffect, useState } from "react";
import { Editor } from "../../components/Editor";
import {
  accountTypes,
  type Account,
  type AccountInput,
} from "../../domain/catalog";
import { useFormatting } from "../../app/SettingsContext";
import { getBalances } from "../../services/transactions";
import {
  listAccounts,
  saveAccount,
  setAccountActive,
} from "../../services/catalog";
import { useCatalog } from "../useCatalog";
import { AccountForm } from "./AccountForm";

export function AccountsPage({
  onHistory,
}: {
  onHistory?: (id: number) => void;
}) {
  const catalog = useCatalog(listAccounts);
  const { formatMoney } = useFormatting();
  const [filter, setFilter] = useState("active");
  const [editing, setEditing] = useState<Account | null | undefined>(undefined);
  const accounts = catalog.items ?? [];
  const [balances, setBalances] = useState<
    { accountId: number; cents: string }[] | null
  >(null);
  const [balanceError, setBalanceError] = useState("");
  useEffect(() => {
    let active = true;
    setBalances(null);
    setBalanceError("");
    getBalances().then(
      (rows) => {
        if (active) setBalances(rows);
      },
      (e) => {
        if (active) setBalanceError(String(e));
      },
    );
    return () => {
      active = false;
    };
  }, [catalog.items]);
  const visible = accounts.filter(
    (account) => filter === "all" || account.active === (filter === "active"),
  );
  function edit(account: Account | null) {
    catalog.clearFeedback();
    setEditing(account);
  }
  async function save(input: AccountInput) {
    if (await catalog.mutate(() => saveAccount(input), "Conta salva."))
      setEditing(undefined);
  }
  return (
    <section aria-label="Cadastro de contas">
      <div className="page-tools">
        <p className="intro">Cadastre onde você mantém seu dinheiro.</p>
        <button
          className="action primary"
          disabled={catalog.busy || !catalog.items}
          onClick={() => edit(null)}
        >
          Nova conta
        </button>
      </div>
      {catalog.items && (
        <div className="balance-summary">
          <span>Saldo atual consolidado · contas ativas</span>
          <strong>
            {balances
              ? formatMoney(
                  sumMoney(
                    balances
                      .filter((b) =>
                        accounts.some((a) => a.id === b.accountId && a.active),
                      )
                      .map((b) => b.cents),
                  ),
                )
              : "—"}
          </strong>
          <small>
            Saldo inicial + receitas − despesas e transferências efetivadas.
            Pendentes e programados não alteram o saldo.
          </small>
        </div>
      )}
      {balanceError && (
        <p role="alert" className="form-error">
          Não foi possível carregar os saldos. {balanceError}
        </p>
      )}
      <div className="list-tools">
        <label>
          Exibir{" "}
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          >
            <option value="active">Ativas</option>
            <option value="archived">Arquivadas</option>
            <option value="all">Todas</option>
          </select>
        </label>
        <button
          className="action"
          disabled={catalog.busy}
          onClick={catalog.reload}
        >
          Atualizar contas
        </button>
      </div>
      {catalog.notice && (
        <p role="status" className="success-message">
          {catalog.notice}
        </p>
      )}
      {catalog.error && editing === undefined && (
        <p role="alert" className="form-error">
          {catalog.error}
        </p>
      )}
      {catalog.busy && !catalog.items && (
        <p role="status">Carregando contas…</p>
      )}
      {catalog.items && (
        <div className="table-scroll">
          <table>
            <caption className="sr-only">Contas cadastradas</caption>
            <thead>
              <tr>
                <th>Nome</th>
                <th>Tipo</th>
                <th className="money">Saldo inicial</th>
                <th className="money">Saldo atual</th>
                <th>Situação</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((account) => (
                <tr key={account.id}>
                  <th scope="row">{account.name}</th>
                  <td>{accountTypes[account.kind]}</td>
                  <td className="money">
                    {formatMoney(account.initialBalance)}
                  </td>
                  <td className="money">
                    {balances
                      ? formatMoney(
                          BigInt(
                            balances.find((b) => b.accountId === account.id)
                              ?.cents ?? "0",
                          ),
                        )
                      : "—"}
                  </td>
                  <td>
                    <Badge tone={account.active ? "positive" : "neutral"}>
                      {account.active ? "Ativa" : "Arquivada"}
                    </Badge>
                  </td>
                  <td className="row-actions">
                    {onHistory && (
                      <button
                        className="text-action"
                        onClick={() => onHistory(account.id)}
                      >
                        Movimentações
                      </button>
                    )}
                    <button
                      className="text-action"
                      disabled={catalog.busy}
                      aria-label={`Editar ${account.name}`}
                      onClick={() => edit(account)}
                    >
                      Editar
                    </button>
                    <button
                      className="text-action"
                      disabled={catalog.busy}
                      aria-label={`${account.active ? "Arquivar" : "Reativar"} ${account.name}`}
                      onClick={() =>
                        void catalog.mutate(
                          () => setAccountActive(account.id, !account.active),
                          account.active
                            ? "Conta arquivada. Consulte Arquivadas para reativar."
                            : "Conta reativada.",
                        )
                      }
                    >
                      {account.active ? "Arquivar" : "Reativar"}
                    </button>
                  </td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={6} className="empty-row">
                    {accounts.length === 0
                      ? "Nenhuma conta cadastrada. Use Nova conta para começar."
                      : "Nenhuma conta neste filtro."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {editing !== undefined && (
        <Editor
          modal={false}
          title={editing ? "Editar conta" : "Nova conta"}
          busy={catalog.busy}
          error={catalog.error}
          onClose={() => {
            setEditing(undefined);
            catalog.clearFeedback();
          }}
        >
          <AccountForm account={editing} busy={catalog.busy} onSave={save} />
        </Editor>
      )}
    </section>
  );
}
