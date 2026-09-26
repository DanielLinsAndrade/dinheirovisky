import { useFormatting } from "../../app/SettingsContext";
import { Metric, Badge } from "../../components/Surface";
import type { Dashboard } from "../../services/dashboard";
import { monthLabel } from "../../domain/dashboard";

export function DashboardSummary({
  data,
  onAccounts,
}: {
  data: Dashboard;
  onAccounts: () => void;
}) {
  const { formatMoney, settings } = useFormatting();
  const money = (v: string) => formatMoney(BigInt(v));
  return (
    <div className="dashboard-summary">
      <p className="dashboard-context">
        <strong>Consumo:</strong> compras no cartão entram na data da compra.{" "}
        <strong>Saldo disponível:</strong> dinheiro em contas.
      </p>
      <p className="summary-period">
        {monthLabel(data.current.month, settings.locale)}
      </p>
      <div className="summary-metrics">
        <Metric
          label="Receitas"
          value={money(data.current.income)}
          icon="income"
          tone="positive"
          testId="dashboard-income"
        >
          <span>Efetivadas no período</span>
        </Metric>
        <Metric
          label="Despesas"
          value={money(data.current.expense)}
          icon="expense"
          tone="negative"
          testId="dashboard-expense"
        >
          <span>Efetivadas no período</span>
        </Metric>
        <Metric
          label="Resultado do mês"
          value={money(data.current.result)}
          icon="equal"
          testId="dashboard-result"
        >
          <Badge
            tone={BigInt(data.current.result) < 0n ? "negative" : "positive"}
          >
            {BigInt(data.current.result) > 0n
              ? "Positivo"
              : BigInt(data.current.result) < 0n
                ? "Negativo"
                : "Equilibrado"}
          </Badge>
        </Metric>
        <Metric
          label="Saldo disponível"
          value={money(data.balance)}
          icon="accounts"
          tone="brand"
          testId="dashboard-balance"
        >
          <button className="text-action" onClick={onAccounts}>
            Ver contas
          </button>
          <span>{data.activeAccounts} contas ativas</span>
        </Metric>
      </div>
      <details className="summary-context">
        <summary>Como os valores são calculados</summary>
        <p>
          Saldo atual de contas ativas em todos os períodos. Receitas e despesas
          efetivadas no mês financeiro, inclusive de contas arquivadas.
          Transferências, pendentes e programados não entram nos totais do
          período.
        </p>
        <p>
          Período do dia {settings.financialMonthStart} até antes do mesmo dia
          do mês seguinte.
        </p>
        {data.previous && data.resultChange !== null && (
          <p>
            Resultado anterior ({data.previous.month}):{" "}
            {money(data.previous.result)}. Variação:{" "}
            {BigInt(data.resultChange) > 0n ? "+" : ""}
            {money(data.resultChange)}. Comparação de períodos completos
            registrados; o mês em andamento pode estar incompleto.
          </p>
        )}
      </details>
      {data.activeAccounts === 0 && (
        <p>
          Cadastre ou reative uma conta para começar. Seu histórico permanece
          disponível.
        </p>
      )}
    </div>
  );
}
