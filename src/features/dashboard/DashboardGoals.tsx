import { useEffect, useState } from "react";
import { useFormatting } from "../../app/SettingsContext";
import { Surface } from "../../components/Surface";
import { Icon } from "../../components/Icon";
import { listGoals, type Goal } from "../../services/planning";
import { barPercent } from "../../domain/dashboard";
export function DashboardGoals({ onGoals }: { onGoals?: () => void }) {
  const { formatMoney } = useFormatting();
  const [goals, setGoals] = useState<Goal[] | null>(null),
    [error, setError] = useState(""),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setError("");
    listGoals().then(
      (rows) => {
        if (active) setGoals(rows);
      },
      (e) => {
        if (active) setError(String(e));
      },
    );
    return () => {
      active = false;
    };
  }, [attempt]);
  return (
    <Surface className="dashboard-goals" aria-label="Metas financeiras">
      <div className="surface-heading">
        <h2>
          <Icon name="goals" />
          Metas financeiras
        </h2>
        {onGoals && (
          <button className="text-action" onClick={onGoals}>
            Ver metas
          </button>
        )}
      </div>
      {error ? (
        <div role="alert">
          <p>Não foi possível consultar metas. {error}</p>
          <button className="action" onClick={() => setAttempt((n) => n + 1)}>
            Tentar consultar metas
          </button>
        </div>
      ) : goals === null ? (
        <p role="status">Carregando metas…</p>
      ) : goals.length === 0 ? (
        <p className="empty-state-inline">
          Nenhuma meta cadastrada. Defina um objetivo na tela Metas.
        </p>
      ) : (
        <ul className="goal-preview-list">
          {[...goals]
            .sort(
              (a, b) =>
                Number(a.completed) - Number(b.completed) || a.id - b.id,
            )
            .slice(0, 3)
            .map((g) => {
              const percentage = barPercent(
                String(g.currentAmount),
                String(g.targetAmount),
              );
              return (
                <li key={g.id}>
                  <span className="goal-symbol">
                    <Icon name="goals" />
                  </span>
                  <div>
                    <strong>{g.name}</strong>
                    <progress
                      aria-label={`Progresso de ${g.name}`}
                      value={percentage}
                      max={100}
                    />
                    <small>
                      {formatMoney(g.currentAmount)} /{" "}
                      {formatMoney(g.targetAmount)} · {percentage}%
                      {g.completed ? " · Concluída" : ""}
                    </small>
                  </div>
                </li>
              );
            })}
        </ul>
      )}
    </Surface>
  );
}
