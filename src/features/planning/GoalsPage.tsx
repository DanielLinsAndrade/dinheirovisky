import { Badge } from "../../components/Surface";
import { remainingMoney, wholePercent } from "../../domain/money";
import { useState, type FormEvent } from "react";
import { useFormatting } from "../../app/SettingsContext";
import { Editor } from "../../components/Editor";
import { localDate } from "../../domain/transactions";
import { barPercent } from "../../domain/dashboard";
import { useCatalog } from "../useCatalog";
import {
  listGoals,
  saveGoal,
  deleteGoal,
  addContribution,
  removeContribution,
  type Goal,
} from "../../services/planning";

export function GoalsPage() {
  const catalog = useCatalog(listGoals);
  const { formatMoney, displayDate, parseMoney, moneyInput, currencyLabel } =
    useFormatting();
  const [editing, setEditing] = useState<Goal | null | undefined>(),
    [contributing, setContributing] = useState<Goal | null>(null);
  const [removing, setRemoving] = useState<{
    goal: Goal;
    contribution?: number;
  } | null>(null);
  const [name, setName] = useState(""),
    [amount, setAmount] = useState(""),
    [date, setDate] = useState(""),
    [error, setError] = useState("");
  function edit(goal: Goal | null) {
    catalog.clearFeedback();
    setError("");
    setEditing(goal);
    setName(goal?.name ?? "");
    setAmount(goal ? moneyInput(goal.targetAmount) : "");
    setDate(goal?.targetDate ?? "");
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const cents = parseMoney(amount);
      if (cents <= 0) throw new Error("Informe um valor positivo.");
      const ok = await catalog.mutate(
        () =>
          contributing
            ? addContribution(contributing.id, cents, date)
            : saveGoal({
                id: editing?.id ?? null,
                name,
                targetAmount: cents,
                targetDate: date || null,
              }),
        contributing ? "Contribuição adicionada." : "Meta salva.",
      );
      if (ok) {
        setEditing(undefined);
        setContributing(null);
      }
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
  }
  return (
    <section aria-label="Metas financeiras">
      <p className="intro">
        Acompanhe valores reservados para seus objetivos. Contribuições são
        registros de acompanhamento e não movimentam dinheiro entre contas.
      </p>
      <div className="list-tools">
        <button
          className="action primary"
          disabled={catalog.busy}
          onClick={() => edit(null)}
        >
          Nova meta
        </button>
        <button
          className="action"
          disabled={catalog.busy}
          onClick={catalog.reload}
        >
          Atualizar metas
        </button>
      </div>
      {catalog.notice && <p role="status">{catalog.notice}</p>}
      {catalog.error && editing === undefined && !contributing && !removing && (
        <p role="alert">{catalog.error}</p>
      )}
      {catalog.busy && !catalog.items && <p role="status">Carregando metas…</p>}
      {catalog.items?.length === 0 && (
        <p className="empty-row">
          Nenhuma meta cadastrada. Crie sua primeira meta.
        </p>
      )}
      {catalog.items?.map((g) => (
        <section className="goal-section" key={g.id} aria-label={g.name}>
          <h2>{g.name}</h2>
          <p>
            {formatMoney(g.currentAmount)} de {formatMoney(g.targetAmount)} ·{" "}
            <Badge tone={g.completed ? "positive" : "neutral"}>
              {g.completed ? "Concluída" : "Em andamento"}
            </Badge>
            {g.targetDate && ` · Prazo: ${displayDate(g.targetDate)}`}
          </p>
          <progress
            aria-label={`Progresso de ${g.name}`}
            max={100}
            value={barPercent(String(g.currentAmount), String(g.targetAmount))}
          />
          <p>
            {wholePercent(g.currentAmount, g.targetAmount).toString()}% · Faltam{" "}
            {formatMoney(remainingMoney(g.targetAmount, g.currentAmount))}
          </p>
          <div className="list-tools">
            <button
              className="text-action"
              disabled={catalog.busy}
              onClick={() => {
                catalog.clearFeedback();
                setError("");
                setContributing(g);
                setAmount("");
                setDate(localDate());
              }}
            >
              Adicionar contribuição
            </button>
            <button
              className="text-action"
              disabled={catalog.busy}
              onClick={() => edit(g)}
            >
              Editar meta
            </button>
            <button
              className="text-action"
              disabled={catalog.busy}
              onClick={() => {
                catalog.clearFeedback();
                setRemoving({ goal: g });
              }}
            >
              Excluir meta
            </button>
          </div>
          <details>
            <summary>Contribuições ({g.contributions.length})</summary>
            {g.contributions.length === 0 ? (
              <p>Nenhuma contribuição registrada.</p>
            ) : (
              <ul>
                {g.contributions.map((c) => (
                  <li key={c.id}>
                    {displayDate(c.date)} · {formatMoney(c.amount)}{" "}
                    <button
                      className="text-action"
                      aria-label={`Remover contribuição de ${formatMoney(c.amount)} em ${displayDate(c.date)}`}
                      disabled={catalog.busy}
                      onClick={() => {
                        catalog.clearFeedback();
                        setRemoving({ goal: g, contribution: c.id });
                      }}
                    >
                      Remover
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </details>
        </section>
      ))}
      {(editing !== undefined || contributing) && (
        <Editor
          modal={false}
          title={
            contributing
              ? `Contribuir para ${contributing.name}`
              : editing
                ? "Editar meta"
                : "Nova meta"
          }
          busy={catalog.busy}
          error={catalog.error || error}
          onClose={() => {
            setEditing(undefined);
            setContributing(null);
          }}
        >
          <form onSubmit={submit}>
            <fieldset disabled={catalog.busy}>
              {!contributing && (
                <>
                  <label htmlFor="goal-name">Nome da meta</label>
                  <input
                    id="goal-name"
                    required
                    maxLength={120}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </>
              )}
              <label htmlFor="goal-amount">
                {contributing ? "Contribuição" : "Valor alvo"} ({currencyLabel})
              </label>
              <input
                id="goal-amount"
                required
                inputMode="decimal"
                maxLength={40}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <label htmlFor="goal-date">
                {contributing ? "Data da contribuição" : "Prazo (opcional)"}
              </label>
              <input
                id="goal-date"
                type="date"
                min="0001-01-01"
                max="9999-12-31"
                required={!!contributing}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
              <button className="action primary" type="submit">
                {contributing ? "Salvar contribuição" : "Salvar meta"}
              </button>
            </fieldset>
          </form>
        </Editor>
      )}
      {removing && (
        <Editor
          title={
            removing.contribution ? "Remover contribuição" : "Excluir meta"
          }
          busy={catalog.busy}
          error={catalog.error}
          onClose={() => setRemoving(null)}
        >
          <p>
            {removing.contribution
              ? `Remover esta contribuição de ${removing.goal.name}? O progresso será recalculado.`
              : `Excluir ${removing.goal.name} e todo seu histórico de contribuições? Essa ação não pode ser desfeita.`}
          </p>
          <button
            className="action"
            disabled={catalog.busy}
            onClick={async () => {
              if (
                await catalog.mutate(
                  () =>
                    removing.contribution
                      ? removeContribution(removing.contribution)
                      : deleteGoal(removing.goal.id),
                  "Remoção concluída.",
                )
              )
                setRemoving(null);
            }}
          >
            Confirmar remoção
          </button>
        </Editor>
      )}
    </section>
  );
}
