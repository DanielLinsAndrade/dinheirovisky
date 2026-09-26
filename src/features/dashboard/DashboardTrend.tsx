import { useState } from "react";
import { useFormatting } from "../../app/SettingsContext";
import { barPercent } from "../../domain/dashboard";
import type { Dashboard } from "../../services/dashboard";
export function DashboardTrend({ data }: { data: Dashboard }) {
  const { formatMoney, settings } = useFormatting();
  const [selected, setSelected] = useState<number | null>(null);
  const money = (value: string) => formatMoney(BigInt(value));
  const minimum = data.trend.reduce(
    (min, m) =>
      [m.income, m.expense].reduce(
        (n, v) => (BigInt(v) < n ? BigInt(v) : n),
        min,
      ),
    0n,
  );
  const maximum =
    data?.trend
      .reduce(
        (max, m) =>
          [m.income, m.expense].reduce(
            (n, v) => (BigInt(v) > n ? BigInt(v) : n),
            max,
          ),
        0n,
      )
      .toString() ?? "0";
  const x = (i: number) =>
    data.trend.length === 1 ? 340 : 70 + (i * 540) / (data.trend.length - 1);
  const range = (BigInt(maximum) - minimum).toString();
  const y = (value: string) =>
    190 - barPercent((BigInt(value) - minimum).toString(), range) * 1.56;
  return (
    <section className="dashboard-section" aria-labelledby="trend-heading">
      <h2 id="trend-heading">Evolução do período</h2>
      <p className="field-help">
        Até seis meses, terminando no mês selecionado.
      </p>
      <div className="trend-legend">
        <span>— Receitas</span>
        <span>┄ Despesas</span>
      </div>
      <div className="financial-chart">
        <svg className="trend-lines" viewBox="0 0 640 230" aria-hidden="true">
          {[0, 1, 2, 3].map((t) => (
            <g key={t}>
              <line
                x1="70"
                x2="610"
                y1={190 - t * 52}
                y2={190 - t * 52}
                className="trend-grid"
              />
              <text x="62" y={194 - t * 52} textAnchor="end">
                {new Intl.NumberFormat(settings.locale, {
                  notation: "compact",
                  maximumFractionDigits: 1,
                }).format((minimum + (BigInt(range) * BigInt(t)) / 3n) / 100n)}
              </text>
            </g>
          ))}
          <text x="70" y="16">
            {settings.currency}
          </text>
          {(["income", "expense"] as const).map((kind) => (
            <g key={kind} className={`trend-${kind}`}>
              <polygon
                points={`70,${y("0")} ${data.trend.map((m, i) => `${x(i)},${y(m[kind])}`).join(" ")} 610,${y("0")}`}
                fillOpacity="0.08"
                stroke="none"
              />
              <polyline
                fill="none"
                strokeWidth="2.5"
                points={data.trend
                  .map((m, i) => `${x(i)},${y(m[kind])}`)
                  .join(" ")}
              />
              {data.trend.map((m, i) => (
                <circle
                  key={m.month}
                  cx={x(i)}
                  cy={y(m[kind])}
                  r={selected === i ? 5 : 3}
                />
              ))}
            </g>
          ))}
          {data.trend.map((m, i) => (
            <text key={m.month} x={x(i)} y="217" textAnchor="middle">
              {m.month.slice(5)}/{m.month.slice(2, 4)}
            </text>
          ))}
        </svg>
        <div
          className="chart-targets"
          style={{ gridTemplateColumns: `repeat(${data.trend.length},1fr)` }}
        >
          {data.trend.map((m, i) => (
            <button
              key={m.month}
              type="button"
              aria-label={`Ver valores de ${m.month}`}
              onFocus={() => setSelected(i)}
              onMouseEnter={() => setSelected(i)}
              onClick={() => setSelected(i)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setSelected(null);
              }}
            >
              <span className="sr-only">{m.month}</span>
            </button>
          ))}
        </div>
        {selected !== null && data.trend[selected] && (
          <div className="chart-tooltip" role="status">
            <strong>{data.trend[selected].month}</strong>
            <span>Receitas {money(data.trend[selected].income)}</span>
            <span>Despesas {money(data.trend[selected].expense)}</span>
          </div>
        )}
      </div>
      <details className="trend-values">
        <summary>Ver valores mensais</summary>
        <table className="trend-table">
          <caption className="sr-only">
            Evolução mensal de receitas e despesas efetivadas
          </caption>
          <thead>
            <tr>
              <th>Mês</th>
              <th>Receitas</th>
              <th>Despesas</th>
            </tr>
          </thead>
          <tbody>
            {data.trend.map((m) => (
              <tr key={m.month}>
                <th scope="row">
                  {m.month.slice(5)}/{m.month.slice(0, 4)}
                </th>
                <td>
                  <span>{money(m.income)}</span>
                  <span className="chart-track" aria-hidden="true">
                    <span
                      className="income-bar"
                      style={{
                        width: `${barPercent(m.income, maximum)}%`,
                      }}
                    />
                  </span>
                </td>
                <td>
                  <span>{money(m.expense)}</span>
                  <span className="chart-track" aria-hidden="true">
                    <span
                      className="expense-bar"
                      style={{
                        width: `${barPercent(m.expense, maximum)}%`,
                      }}
                    />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}
