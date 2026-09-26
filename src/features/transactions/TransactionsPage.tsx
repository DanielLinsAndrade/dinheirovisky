import { MetadataManager } from "../metadata/MetadataManager";
import { Attachments } from "../attachments/Attachments";
import { MetadataFilter } from "../metadata/MetadataFilter";
import { Badge } from "../../components/Surface";
import { useEffect, useState } from "react";
import { Editor } from "../../components/Editor";
import {
  categoryPath,
  type Account,
  type Category,
} from "../../domain/catalog";
import {
  movementTypes,
  movementStatuses,
  type Movement,
} from "../../domain/transactions";
import { useFormatting } from "../../app/SettingsContext";
import { listAccounts, listCategories } from "../../services/catalog";
import {
  saveTransaction,
  deleteTransaction,
} from "../../services/transactions";
import { useTransactions } from "./useTransactions";
import { TransactionForm } from "./TransactionForm";

export function TransactionsPage({
  accountId,
  createRequested = false,
  onRequestHandled,
}: {
  accountId?: number;
  createRequested?: boolean;
  onRequestHandled?: () => void;
}) {
  const { formatMoney, displayDate } = useFormatting();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [referenceError, setReferenceError] = useState("");
  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [editing, setEditing] = useState<Movement | null | undefined>();
  const [deleting, setDeleting] = useState<Movement | null>(null);
  const [attachmentTarget, setAttachmentTarget] = useState<Movement | null>(
    null,
  );
  const [managing, setManaging] = useState(false);
  const [metadataBusy, setMetadataBusy] = useState(false);
  const [metadataRevision, setMetadataRevision] = useState(0);
  const [method, setMethod] = useState("");
  const [merchant, setMerchant] = useState("");
  const [intermediary, setIntermediary] = useState("");
  const [channel, setChannel] = useState("");
  const [search, setSearch] = useState("");
  const [account, setAccount] = useState(String(accountId ?? ""));
  const [kind, setKind] = useState("");
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sort, setSort] = useState("newest");
  const [page, setPage] = useState(0);
  const catalog = useTransactions({
    methodId: Number(method) || null,
    merchantId: Number(merchant) || null,
    intermediaryId: Number(intermediary) || null,
    channel,
    search,
    accountId: account ? Number(account) : null,
    categoryId: category ? Number(category) : null,
    kind,
    status,
    from,
    to,
    sort,
    page,
  });
  const canCreate =
    ready &&
    !!catalog.items &&
    !catalog.busy &&
    accounts.some((a) => a.active) &&
    editing === undefined &&
    !deleting;
  useEffect(() => {
    if (createRequested && ready && catalog.items && !catalog.busy) {
      onRequestHandled?.();
      if (canCreate) setEditing(null);
    }
  }, [
    createRequested,
    ready,
    catalog.items,
    catalog.busy,
    canCreate,
    onRequestHandled,
  ]);
  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if (
        event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey &&
        !event.metaKey &&
        !event.repeat &&
        event.key.toLowerCase() === "n" &&
        canCreate &&
        !document.querySelector("dialog[open]")
      ) {
        event.preventDefault();
        catalog.clearFeedback();
        setEditing(null);
      }
    }
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [canCreate]);
  useEffect(() => {
    let active = true;
    setReady(false);
    setReferenceError("");
    Promise.all([listAccounts(), listCategories()]).then(
      ([a, c]) => {
        if (active) {
          setAccounts(a);
          setCategories(c);
          setReady(true);
        }
      },
      (e) => {
        if (active) setReferenceError(String(e));
      },
    );
    return () => {
      active = false;
    };
  }, [attempt]);
  useEffect(
    () => setPage(0),
    [search, account, kind, status, category, from, to, sort],
  );
  const filtered = catalog.items ?? [];
  const currentPage = catalog.page;
  const accountName = (id: number) =>
    accounts.find((a) => a.id === id)?.name ?? "Conta";
  async function save(input: Movement) {
    if (
      await catalog.mutate(
        () => saveTransaction(input),
        "Transação salva. Saldos atualizados.",
      )
    ) {
      setEditing(undefined);
      setMetadataRevision((n) => n + 1);
    }
  }
  return (
    <section aria-label="Movimentações financeiras">
      <div className="page-tools">
        <p className="intro">
          Receitas, despesas e transferências entre suas contas.
        </p>
        <div className="page-actions">
          <button
            className="action primary"
            disabled={!canCreate}
            aria-keyshortcuts="Control+n"
            aria-describedby="new-transaction-shortcut"
            onClick={() => {
              catalog.clearFeedback();
              setEditing(null);
            }}
          >
            Nova transação
          </button>
          <small id="new-transaction-shortcut">
            Atalho: Ctrl+N. Escape fecha o editor.
          </small>
        </div>
      </div>
      {ready && !accounts.some((a) => a.active) && (
        <p>Cadastre ou reative uma conta para adicionar transações.</p>
      )}
      <button
        className="text-action"
        disabled={editing !== undefined || deleting !== null || catalog.busy}
        onClick={() => setManaging(true)}
      >
        Gerenciar métodos e estabelecimentos
      </button>
      <details className="metadata-filters">
        <summary>Filtros de pagamento e compra</summary>
        <div className="metadata-filter-grid">
          <MetadataFilter
            revision={metadataRevision}
            kind="method"
            label="Método de pagamento"
            value={method}
            onChange={(v) => {
              setMethod(v);
              setPage(0);
            }}
          />
          <MetadataFilter
            revision={metadataRevision}
            kind="merchant"
            label="Estabelecimento"
            value={merchant}
            onChange={(v) => {
              setMerchant(v);
              setPage(0);
            }}
          />
          <MetadataFilter
            revision={metadataRevision}
            kind="intermediary"
            label="Intermediário"
            value={intermediary}
            onChange={(v) => {
              setIntermediary(v);
              setPage(0);
            }}
          />
          <div className="metadata-field">
            <label htmlFor="metadata-channel-filter">Modalidade</label>
            <select
              id="metadata-channel-filter"
              value={channel}
              onChange={(e) => {
                setChannel(e.target.value);
                setPage(0);
              }}
            >
              <option value="">Todas</option>
              <option value="unknown">Não informado</option>
              <option value="in_person">Presencial</option>
              <option value="online">Online</option>
            </select>
          </div>
        </div>
      </details>
      {managing && (
        <Editor
          title="Métodos, estabelecimentos e intermediários"
          busy={metadataBusy}
          error=""
          onClose={() => {
            setManaging(false);
            setMetadataRevision((n) => n + 1);
            catalog.reload();
          }}
        >
          <MetadataManager onBusy={setMetadataBusy} />
        </Editor>
      )}
      <div className="list-tools">
        <label>
          Pesquisar
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Descrição ou observações"
          />
        </label>
        <label>
          Conta
          <select value={account} onChange={(e) => setAccount(e.target.value)}>
            <option value="">Todas</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {!a.active ? " (arquivada)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          Tipo
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">Todos</option>
            {Object.entries(movementTypes).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label>
          Situação
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Todas</option>
            {Object.entries(movementStatuses).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label>
          Categoria
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">Todas</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {categoryPath(c, categories)} · {movementTypes[c.kind]}
              </option>
            ))}
          </select>
        </label>
        <label>
          De
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          Até
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <label>
          Ordenar
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="newest">Mais recentes</option>
            <option value="oldest">Mais antigas</option>
            <option value="amount">Maior valor</option>
            <option value="description">Descrição</option>
          </select>
        </label>
        <button
          className="action"
          disabled={catalog.busy}
          onClick={() => {
            catalog.reload();
            setAttempt((a) => a + 1);
          }}
        >
          Atualizar transações
        </button>
      </div>
      {referenceError && (
        <p role="alert" className="form-error">
          {referenceError}
        </p>
      )}
      {catalog.error && editing === undefined && !deleting && (
        <p role="alert" className="form-error">
          {catalog.error}
        </p>
      )}
      {catalog.notice && <p role="status">{catalog.notice}</p>}
      {!catalog.items && catalog.busy && (
        <p role="status">Carregando transações…</p>
      )}
      <div className="table-scroll">
        <table>
          <caption className="sr-only">Transações cadastradas</caption>
          <thead>
            <tr>
              <th>Data</th>
              <th>Descrição</th>
              <th>Conta / categoria</th>
              <th>Tipo / situação</th>
              <th className="money">Valor</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((m) => (
              <tr key={m.id}>
                <td>{displayDate(m.date)}</td>
                <th scope="row">
                  {m.description}
                  {m.notes && (
                    <details>
                      <summary>Observações</summary>
                      <p>{m.notes}</p>
                    </details>
                  )}
                </th>
                <td>
                  {accountName(m.accountId)}
                  {m.destinationAccountId !== null && (
                    <> → {accountName(m.destinationAccountId)}</>
                  )}
                  <br />
                  {categories.find((c) => c.id === m.categoryId)?.name ??
                    (m.kind === "transfer" ? "Entre contas" : "Sem categoria")}
                </td>
                <td>
                  {m.details?.methodName && (
                    <small className="movement-metadata">
                      {m.details.methodName}
                    </small>
                  )}
                  {m.details?.merchant && (
                    <small className="movement-metadata">
                      {m.details.merchant}
                    </small>
                  )}
                  {m.details?.intermediary && (
                    <small className="movement-metadata">
                      Via {m.details.intermediary}
                    </small>
                  )}
                  {m.details?.channel && (
                    <small className="movement-metadata">
                      {m.details.channel === "online" ? "Online" : "Presencial"}
                    </small>
                  )}
                  {movementTypes[m.kind]}
                  <br />
                  <Badge tone={m.status === "posted" ? "positive" : "neutral"}>
                    {movementStatuses[m.status]}
                  </Badge>
                </td>
                <td
                  className={`money money-${m.kind === "income" ? "positive" : m.kind === "expense" ? "negative" : "neutral"}`}
                >
                  {formatMoney(m.amount)}
                </td>
                <td>
                  <button
                    className="text-action"
                    disabled={catalog.busy || !ready}
                    aria-label={`Editar ${m.description}`}
                    onClick={() => {
                      catalog.clearFeedback();
                      setEditing(m);
                    }}
                  >
                    Editar
                  </button>
                  <button
                    className="text-action"
                    disabled={catalog.busy}
                    onClick={() => setAttachmentTarget(m)}
                  >
                    Anexos de {m.description}
                  </button>
                  <button
                    className="text-action"
                    disabled={catalog.busy}
                    aria-label={`Excluir ${m.description}`}
                    onClick={() => {
                      catalog.clearFeedback();
                      setDeleting(m);
                    }}
                  >
                    Excluir
                  </button>
                </td>
              </tr>
            ))}
            {catalog.items && filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="empty-row">
                  Nenhuma transação encontrada. Ajuste os filtros ou adicione
                  uma transação.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="list-tools">
        <span>
          {catalog.total} transações · página {currentPage + 1}
        </span>
        <button
          className="action"
          disabled={catalog.busy || currentPage === 0}
          onClick={() => setPage(currentPage - 1)}
        >
          Anterior
        </button>
        <button
          className="action"
          disabled={catalog.busy || (currentPage + 1) * 50 >= catalog.total}
          onClick={() => setPage(currentPage + 1)}
        >
          Próxima
        </button>
      </div>
      {attachmentTarget && (
        <Attachments
          kind="transaction"
          id={attachmentTarget.id!}
          name={attachmentTarget.description}
          onClose={() => setAttachmentTarget(null)}
        />
      )}
      {editing !== undefined && (
        <Editor
          modal={false}
          title={editing ? "Editar transação" : "Nova transação"}
          busy={catalog.busy}
          error={catalog.error}
          onClose={() => {
            setEditing(undefined);
            catalog.clearFeedback();
          }}
        >
          <TransactionForm
            movement={editing}
            accounts={accounts}
            categories={categories}
            busy={catalog.busy}
            onSave={save}
          />
        </Editor>
      )}
      {deleting && (
        <Editor
          title="Excluir transação"
          busy={catalog.busy}
          error={catalog.error}
          onClose={() => {
            setDeleting(null);
            catalog.clearFeedback();
          }}
        >
          <p>
            Excluir “{deleting.description}” ({formatMoney(deleting.amount)})?
            Os anexos vinculados também serão removidos. Esta ação é definitiva
            e remove seu efeito dos saldos das contas envolvidas.
          </p>
          <button
            className="action"
            disabled={catalog.busy}
            onClick={async () => {
              if (
                await catalog.mutate(
                  () => deleteTransaction(deleting.id!),
                  "Transação excluída. Saldos atualizados.",
                )
              )
                setDeleting(null);
            }}
          >
            Confirmar exclusão
          </button>
        </Editor>
      )}
    </section>
  );
}
