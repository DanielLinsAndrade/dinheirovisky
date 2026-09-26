import { Badge } from "../../components/Surface";
import { useEffect, useState, useRef, type FormEvent } from "react";
import { useFormatting } from "../../app/SettingsContext";
import { Editor } from "../../components/Editor";
import { localDate } from "../../domain/transactions";
import {
  categoryPath,
  type Account,
  type Category,
} from "../../domain/catalog";
import { listAccounts, listCategories } from "../../services/catalog";
import { useCatalog } from "../useCatalog";
import {
  listRecurrences,
  saveRecurrence,
  setRecurrenceState,
  materializeRecurrences,
  type Recurrence,
  type RecurrenceInput,
} from "../../services/planning";

const frequencies = { weekly: "Semanal", monthly: "Mensal", yearly: "Anual" };
export function RecurrencesPage({
  onTransactions,
  initialId,
}: {
  onTransactions: () => void;
  initialId?: number;
}) {
  const catalog = useCatalog(listRecurrences);
  const targetOpened = useRef(false);
  const { formatMoney, displayDate } = useFormatting();
  useEffect(() => {
    if (targetOpened.current || initialId === undefined || !catalog.items)
      return;
    const item = catalog.items.find((r) => r.id === initialId);
    if (item) {
      targetOpened.current = true;
      setEditing(item);
    }
  }, [initialId, catalog.items]);
  const [editing, setEditing] = useState<Recurrence | null | undefined>(),
    [ending, setEnding] = useState<Recurrence | null>(null);
  return (
    <section aria-label="Receitas e despesas recorrentes">
      <p className="intro">
        Cadastre receitas e despesas que se repetem. Cada vencimento gera uma
        transação programada; efetive-a em Transações quando o pagamento ou
        recebimento ocorrer.
      </p>
      <p className="field-help">
        Ao abrir o dashboard ou gerar vencimentos, são criados até 500
        lançamentos por vez, somente até hoje. Pausar e encerrar preservam os já
        gerados. Retomar pula datas anteriores a hoje durante a pausa.
      </p>
      <div className="list-tools">
        <button
          className="action primary"
          disabled={catalog.busy}
          onClick={() => {
            catalog.clearFeedback();
            setEditing(null);
          }}
        >
          Nova recorrência
        </button>
        <button
          className="action"
          disabled={catalog.busy}
          onClick={() =>
            void catalog.mutate(async () => {
              await materializeRecurrences();
              return listRecurrences();
            }, "Vencimentos processados. Se a próxima data ainda estiver vencida, processe outro lote.")
          }
        >
          Gerar vencimentos até hoje
        </button>
        <button
          className="action"
          disabled={catalog.busy}
          onClick={catalog.reload}
        >
          Atualizar recorrências
        </button>
        <button className="text-action" onClick={onTransactions}>
          Ver transações
        </button>
      </div>
      {catalog.notice && <p role="status">{catalog.notice}</p>}
      {catalog.error && editing === undefined && !ending && (
        <p role="alert">{catalog.error}</p>
      )}
      {catalog.busy && !catalog.items && (
        <p role="status">Carregando recorrências…</p>
      )}
      <div className="table-scroll">
        <table>
          <caption className="sr-only">Recorrências cadastradas</caption>
          <thead>
            <tr>
              <th>Descrição</th>
              <th>Valor</th>
              <th>Calendário</th>
              <th>Próxima data</th>
              <th>Situação</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {catalog.items?.map((r) => (
              <tr key={r.id}>
                <th scope="row">
                  {r.description}
                  <br />
                  <small>{r.kind === "income" ? "Receita" : "Despesa"}</small>
                </th>
                <td className="money">{formatMoney(r.amount)}</td>
                <td>
                  {frequencies[r.frequency]} · a cada {r.interval}
                  <br />
                  <small>
                    {displayDate(r.startDate)}
                    {r.endDate && ` até ${displayDate(r.endDate)}`}
                  </small>
                </td>
                <td>
                  {r.nextDate ? displayDate(r.nextDate) : "Sem próximas datas"}
                </td>
                <td>
                  <Badge
                    tone={
                      r.active && !r.ended && !r.blocked
                        ? "positive"
                        : "neutral"
                    }
                  >
                    {r.ended
                      ? "Encerrada"
                      : !r.active
                        ? "Pausada"
                        : r.blocked
                          ? "Conta/categoria arquivada"
                          : !r.nextDate
                            ? "Calendário concluído"
                            : "Ativa"}
                  </Badge>
                </td>
                <td>
                  {!r.ended && (
                    <>
                      <button
                        className="text-action"
                        disabled={catalog.busy}
                        aria-label={`Editar ${r.description}`}
                        onClick={() => {
                          catalog.clearFeedback();
                          setEditing(r);
                        }}
                      >
                        Editar
                      </button>
                      <button
                        className="text-action"
                        disabled={catalog.busy || (!r.active && r.blocked)}
                        onClick={() =>
                          void catalog.mutate(
                            () =>
                              setRecurrenceState(
                                r.id!,
                                r.active ? "pause" : "resume",
                              ),
                            r.active
                              ? "Recorrência pausada."
                              : "Recorrência retomada a partir de hoje.",
                          )
                        }
                      >
                        {r.active ? "Pausar" : "Retomar"}
                      </button>
                      <button
                        className="text-action"
                        disabled={catalog.busy}
                        onClick={() => {
                          catalog.clearFeedback();
                          setEnding(r);
                        }}
                      >
                        Encerrar
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {catalog.items?.length === 0 && (
              <tr>
                <td colSpan={6} className="empty-row">
                  Nenhuma recorrência cadastrada. Cadastre uma receita ou
                  despesa que se repete.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {editing !== undefined && (
        <Editor
          modal={false}
          title={editing ? "Editar recorrência" : "Nova recorrência"}
          busy={catalog.busy}
          error={catalog.error}
          onClose={() => setEditing(undefined)}
        >
          <RecurrenceForm
            item={editing}
            busy={catalog.busy}
            onSave={async (input) => {
              if (
                await catalog.mutate(
                  () => saveRecurrence(input),
                  "Recorrência salva. Alterações valem apenas para lançamentos ainda não gerados.",
                )
              )
                setEditing(undefined);
            }}
          />
        </Editor>
      )}
      {ending && (
        <Editor
          title="Encerrar recorrência"
          busy={catalog.busy}
          error={catalog.error}
          onClose={() => setEnding(null)}
        >
          <p>
            Encerrar {ending.description} definitivamente? Os lançamentos já
            gerados serão preservados. Para voltar, será necessário criar outra
            recorrência.
          </p>
          <button
            className="action"
            disabled={catalog.busy}
            onClick={async () => {
              if (
                await catalog.mutate(
                  () => setRecurrenceState(ending.id!, "end"),
                  "Recorrência encerrada.",
                )
              )
                setEnding(null);
            }}
          >
            Confirmar encerramento
          </button>
        </Editor>
      )}
    </section>
  );
}
function RecurrenceForm({
  item,
  busy,
  onSave,
}: {
  item: Recurrence | null;
  busy: boolean;
  onSave: (input: RecurrenceInput) => Promise<void>;
}) {
  const { parseMoney, moneyInput, currencyLabel } = useFormatting();
  const [description, setDescription] = useState(item?.description ?? ""),
    [amount, setAmount] = useState(item ? moneyInput(item.amount) : ""),
    [kind, setKind] = useState<"income" | "expense">(item?.kind ?? "expense");
  const [accountId, setAccountId] = useState(String(item?.accountId ?? "")),
    [categoryId, setCategoryId] = useState(String(item?.categoryId ?? "")),
    [notes, setNotes] = useState(item?.notes ?? "");
  const [planningClass, setPlanningClass] = useState<
    RecurrenceInput["planningClass"]
  >(item?.planningClass ?? null);
  const [frequency, setFrequency] = useState<RecurrenceInput["frequency"]>(
      item?.frequency ?? "monthly",
    ),
    [interval, setInterval] = useState(item?.interval ?? 1),
    [start, setStart] = useState(item?.startDate ?? localDate()),
    [end, setEnd] = useState(item?.endDate ?? "");
  const [accounts, setAccounts] = useState<Account[]>([]),
    [categories, setCategories] = useState<Category[]>([]),
    [error, setError] = useState(""),
    [loadError, setLoadError] = useState(""),
    [loaded, setLoaded] = useState(false),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setLoadError("");
    Promise.all([listAccounts(), listCategories()]).then(
      ([a, c]) => {
        if (active) {
          setAccounts(a);
          setCategories(c);
          setLoaded(true);
        }
      },
      (e) => {
        if (active) setLoadError(String(e));
      },
    );
    return () => {
      active = false;
    };
  }, [attempt]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const cents = parseMoney(amount);
      if (cents <= 0) throw new Error("Informe um valor positivo.");
      await onSave({
        id: item?.id ?? null,
        description,
        amount: cents,
        kind,
        accountId: Number(accountId),
        categoryId: categoryId ? Number(categoryId) : null,
        notes: notes || null,
        frequency,
        interval,
        startDate: start,
        endDate: end || null,
        planningClass,
      });
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
  }
  return (
    <form onSubmit={submit}>
      {loadError && (
        <>
          <p role="alert">{loadError}</p>
          <button type="button" onClick={() => setAttempt((n) => n + 1)}>
            Tentar carregar cadastros
          </button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      <fieldset disabled={busy || !loaded}>
        <label htmlFor="rec-description">Descrição</label>
        <input
          id="rec-description"
          required
          maxLength={240}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <label htmlFor="rec-kind">Tipo</label>
        <select
          id="rec-kind"
          value={kind}
          onChange={(e) => {
            setKind(e.target.value as typeof kind);
            setCategoryId("");
          }}
        >
          <option value="expense">Despesa</option>
          <option value="income">Receita</option>
        </select>
        <label htmlFor="rec-amount">Valor ({currencyLabel})</label>
        <input
          id="rec-amount"
          required
          inputMode="decimal"
          maxLength={40}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <label htmlFor="rec-account">Conta</label>
        <select
          id="rec-account"
          required
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
        >
          <option value="">Selecione</option>
          {accounts
            .filter((a) => a.active || a.id === item?.accountId)
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {!a.active && " (arquivada)"}
              </option>
            ))}
        </select>
        <label htmlFor="rec-category">Categoria (opcional)</label>
        <select
          id="rec-category"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
        >
          <option value="">Sem categoria</option>
          {categories
            .filter(
              (c) => c.kind === kind && (c.active || c.id === item?.categoryId),
            )
            .map((c) => (
              <option key={c.id} value={c.id}>
                {categoryPath(c, categories)}
              </option>
            ))}
        </select>
        {item && (
          <p className="field-help">
            O calendário é fixo. Para alterar frequência ou datas, encerre esta
            recorrência e crie outra. Lançamentos já gerados são editados em
            Transações.
          </p>
        )}
        <label htmlFor="rec-frequency">Frequência</label>
        <select
          id="rec-frequency"
          disabled={!!item}
          value={frequency}
          onChange={(e) => setFrequency(e.target.value as typeof frequency)}
        >
          {Object.entries(frequencies).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <label htmlFor="rec-interval">
          Intervalo (a cada quantas semanas, meses ou anos)
        </label>
        <input
          id="rec-interval"
          disabled={!!item}
          required
          type="number"
          min={1}
          max={120}
          step={1}
          value={interval}
          onChange={(e) => setInterval(Number(e.target.value))}
        />
        <label htmlFor="rec-start">Primeiro vencimento</label>
        <input
          id="rec-start"
          disabled={!!item}
          required
          type="date"
          min="0001-01-01"
          max="9999-12-31"
          value={start}
          onChange={(e) => setStart(e.target.value)}
        />
        <label htmlFor="rec-end">Última data (opcional, inclusive)</label>
        <input
          id="rec-end"
          disabled={!!item}
          type="date"
          min={start}
          max="9999-12-31"
          value={end}
          onChange={(e) => setEnd(e.target.value)}
        />
        <label htmlFor="rec-planning">Classificação de planejamento</label>
        <select
          id="rec-planning"
          value={planningClass ?? ""}
          onChange={(e) =>
            setPlanningClass(
              (e.target.value || null) as RecurrenceInput["planningClass"],
            )
          }
        >
          <option value="">Sem classificação</option>
          <option value="fixed">Fixa</option>
          <option value="seasonal">Sazonal</option>
        </select>
        <label htmlFor="rec-notes">Observações (opcional)</label>
        <textarea
          id="rec-notes"
          maxLength={4000}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        <button className="action primary" type="submit">
          Salvar recorrência
        </button>
      </fieldset>
    </form>
  );
}
