import { useId, useState } from "react";
import { useFormatting } from "../../app/SettingsContext";
import { lineGeometry } from "../../domain/reports";
import { methodCodes } from "../../domain/metadata";
import type {
  AnalysisGrouping,
  AnalysisReport,
  AnalysisTotals,
} from "../../services/reportAnalysis";
import { Metric } from "../../components/Surface";
import { Button } from "../../components/Button";
const groupLabels: Record<string, string> = {
  ...methodCodes,
  online: "Online",
  in_person: "Presencial",
  fixed: "Fixa",
  seasonal: "Sazonal",
};
export function AnalysisResults({
  data,
  grouping,
  onPage,
}: {
  data: AnalysisReport;
  grouping: AnalysisGrouping;
  onPage: (page: number) => void;
}) {
  const { formatMoney } = useFormatting();
  const money = (v: string) => formatMoney(BigInt(v));
  const contract = data.view === "installments",
    cash = data.view === "cash";
  const [selected, setSelected] = useState<"result" | "expense" | "income">(
    "expense",
  );
  const series = contract ? "installments" : selected;
  const geometry = lineGeometry(data.months.map((m) => m.totals[series]));
  const chartId = useId();
  const magnitude = (v: string) => {
    const n = BigInt(v);
    return n < 0n ? -n : n;
  };
  const maximum =
    data.groups.reduce((n, g) => {
      const v = magnitude(g.totals[series]);
      return v > n ? v : n;
    }, 0n) || 1n;
  const columns = contract
    ? ["Parcelas contratuais"]
    : cash
      ? [
          "Receitas",
          "Despesas nas contas",
          "Pagamentos de fatura",
          "Transferências líquidas",
          "Variação de caixa",
        ]
      : ["Receitas", "Consumo líquido", "Resultado econômico"];
  const values = (t: AnalysisTotals) =>
    contract
      ? [t.installments]
      : cash
        ? [t.income, t.expense, t.payments, t.transfers, t.result]
        : [t.income, t.expense, t.result];
  const groupName = (key: string, name: string) =>
    ["method", "channel", "classification"].includes(grouping)
      ? (groupLabels[key] ?? name)
      : name;
  return (
    <>
      <p role="status">{data.totals.count} registro(s) no recorte aplicado.</p>
      {contract && (
        <p>
          Valores contratuais, inclusive parcelas já quitadas. Não são saldo
          restante nem nova despesa; pagamentos e créditos são conferidos em
          Faturas.
        </p>
      )}
      {data.totals.count === 0 && (
        <p className="empty-row">
          Nenhum registro corresponde a este período e aos filtros. Isso não
          remove dados nem altera saldos.
        </p>
      )}
      <div className="report-metrics">
        {contract ? (
          <Metric
            label="Parcelas contratuais"
            value={money(data.totals.installments)}
            icon="cards"
          />
        ) : (
          <>
            <Metric
              label="Receitas no recorte"
              value={money(data.totals.income)}
              icon="income"
              tone="positive"
            />
            <Metric
              label={cash ? "Despesas nas contas" : "Consumo líquido"}
              value={money(data.totals.expense)}
              icon="expense"
              tone="negative"
            />
            <Metric
              label={
                cash ? "Variação de caixa no recorte" : "Resultado econômico"
              }
              value={money(data.totals.result)}
              icon="equal"
            />
          </>
        )}
      </div>
      {cash && (
        <p>
          Pagamentos de fatura: {money(data.totals.payments)}. Transferências
          líquidas: {money(data.totals.transfers)}. Variação = receitas −
          despesas − pagamentos + transferências; não é saldo da conta. Saldos
          históricos estão na visão preservada.
        </p>
      )}
      <section
        className="dashboard-section"
        aria-label="Comparação de períodos"
      >
        <h2>Comparação de períodos</h2>
        {data.comparison ? (
          <>
            <p>
              Referência: {data.comparisonFrom} a {data.comparisonTo}, com os
              mesmos filtros e duração. Meses atuais podem estar em andamento;
              os intervalos são comparados integralmente.
            </p>
            <div
              className="table-scroll"
              tabIndex={0}
              role="region"
              aria-label="Rolagem da comparação"
            >
              <table className="report-table">
                <caption>Valores exatos da comparação</caption>
                <thead>
                  <tr>
                    <th>Medida</th>
                    <th>Atual</th>
                    <th>Referência</th>
                    <th>Diferença</th>
                  </tr>
                </thead>
                <tbody>
                  {columns.map((label, i) => (
                    <tr key={label}>
                      <th scope="row">{label}</th>
                      <td>{money(values(data.totals)[i])}</td>
                      <td>{money(values(data.comparison!)[i])}</td>
                      <td>
                        {formatMoney(
                          BigInt(values(data.totals)[i]) -
                            BigInt(values(data.comparison!)[i]),
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p>Não há período anterior representável para esta duração.</p>
        )}
      </section>
      <section className="dashboard-section" aria-label="Evolução do recorte">
        <h2>Evolução do recorte</h2>
        {!contract && (
          <label>
            Medida do gráfico
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value as typeof selected)}
            >
              <option value="expense">
                {cash ? "Despesas nas contas" : "Consumo líquido"}
              </option>
              <option value="income">Receitas</option>
              <option value="result">
                {cash ? "Variação de caixa" : "Resultado econômico"}
              </option>
            </select>
          </label>
        )}
        <figure className="report-chart">
          <div className="report-axis">
            <span>{formatMoney(geometry.max)}</span>
            <span>{formatMoney(geometry.min)}</span>
          </div>
          <svg viewBox="0 0 700 200" role="img" aria-labelledby={chartId}>
            <title id={chartId}>
              Evolução mensal; valores exatos na tabela abaixo.
            </title>
            <line
              x1="20"
              x2="680"
              y1={geometry.zero}
              y2={geometry.zero}
              className="report-zero"
            />
            <polyline
              points={geometry.points.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none"
              className="report-line"
            />
            {geometry.points.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r="4" className="report-dot" />
            ))}
          </svg>
          <figcaption>
            <span>{data.months[0]?.month}</span>
            <span>{data.months.at(-1)?.month}</span>
          </figcaption>
        </figure>
        <div
          className="table-scroll"
          tabIndex={0}
          role="region"
          aria-label="Rolagem da evolução mensal"
        >
          <table className="report-table">
            <caption>Totais mensais exatos do recorte</caption>
            <thead>
              <tr>
                <th>Mês financeiro</th>
                {columns.map((c) => (
                  <th key={c}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.months.map((m) => (
                <tr key={m.month}>
                  <th scope="row">{m.month}</th>
                  {values(m.totals).map((v, i) => (
                    <td key={i}>{money(v)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section
        className="dashboard-section"
        aria-label="Distribuição do recorte"
      >
        <h2>Distribuição do recorte</h2>
        <p>
          Grupos mutuamente exclusivos. Barras mostram magnitude; o sinal e
          todas as medidas estão na tabela. Página {data.page + 1} de{" "}
          {Math.max(1, Math.ceil(data.groupCount / 20))}.
        </p>
        <div
          className="table-scroll"
          tabIndex={0}
          role="region"
          aria-label="Rolagem da distribuição"
        >
          <table className="report-table">
            <caption>Grupos e valores exatos do recorte</caption>
            <thead>
              <tr>
                <th>Grupo</th>
                {columns.map((c) => (
                  <th key={c}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.groups.map((g) => (
                <tr key={g.key}>
                  <th scope="row">
                    {groupName(g.key, g.name)}
                    <span className="chart-track" aria-hidden="true">
                      <span
                        className="expense-bar"
                        style={{
                          width: `${Number((magnitude(g.totals[series]) * 10000n) / maximum) / 100}%`,
                        }}
                      />
                    </span>
                  </th>
                  {values(g.totals).map((v, i) => (
                    <td key={i}>{money(v)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.groupCount === 0 && <p>Nenhum grupo neste recorte.</p>}
        <div className="list-tools">
          <Button
            disabled={data.page === 0}
            onClick={() => onPage(data.page - 1)}
          >
            Grupos anteriores
          </Button>
          <Button
            disabled={(data.page + 1) * 20 >= data.groupCount}
            onClick={() => onPage(data.page + 1)}
          >
            Mais grupos
          </Button>
        </div>
      </section>
    </>
  );
}
