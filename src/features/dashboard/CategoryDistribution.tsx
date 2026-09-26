import { useFormatting } from "../../app/SettingsContext";
import { Surface } from "../../components/Surface";
import { Icon } from "../../components/Icon";
import { barPercent } from "../../domain/dashboard";
import type { Dashboard } from "../../services/dashboard";
const colors = [
  "#589be0",
  "#e36b79",
  "#dfa75d",
  "#74b9a2",
  "#a28dcc",
  "#91a2b0",
];
export function CategoryDistribution({ data }: { data: Dashboard }) {
  const { formatMoney } = useFormatting();
  const categories = [...data.categories];
  const remainder =
    BigInt(data.current.expense) -
    categories.reduce((n, c) => n + BigInt(c.cents), 0n);
  if (remainder !== 0n)
    categories.push({ name: "Outras categorias", cents: String(remainder) });
  let offset = 0;
  const stops = categories.map((c, i) => {
    const start = offset;
    offset += barPercent(c.cents, data.current.expense);
    return `${colors[i % colors.length]} ${start}% ${offset}%`;
  });
  return (
    <Surface
      className="category-distribution"
      aria-label="Distribuição de gastos"
    >
      <h2>
        <Icon name="categories" />
        Gastos por categoria
      </h2>
      {categories.some((c) => BigInt(c.cents) < 0n) ? (
        <div>
          <p>
            Consumo líquido: {formatMoney(BigInt(data.current.expense))}.
            Valores negativos representam créditos ou estornos no período.
          </p>
          <ul>
            {categories.map((c, i) => (
              <li key={i}>
                {c.name}: {formatMoney(BigInt(c.cents))}
              </li>
            ))}
          </ul>
        </div>
      ) : BigInt(data.current.expense) === 0n ? (
        <p className="empty-state-inline">
          Sem despesas efetivadas no período.
        </p>
      ) : (
        <div className="distribution-content">
          <div
            className="category-donut"
            aria-hidden="true"
            style={{ background: `conic-gradient(${stops.join(",")})` }}
          >
            <div>
              <strong>{formatMoney(BigInt(data.current.expense))}</strong>
              <small>em despesas</small>
            </div>
          </div>
          <ul>
            {categories.map((c, i) => (
              <li key={i}>
                <span
                  className="legend-dot"
                  style={{ background: colors[i % colors.length] }}
                />
                <span>
                  {c.name}
                  <small>{formatMoney(BigInt(c.cents))}</small>
                </span>
                <strong>{barPercent(c.cents, data.current.expense)}%</strong>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Surface>
  );
}
