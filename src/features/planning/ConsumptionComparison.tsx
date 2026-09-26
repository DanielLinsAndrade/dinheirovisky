import { useEffect, useState } from "react";
import { Editor } from "../../components/Editor";
import { Button } from "../../components/Button";
import { getDashboard, type Dashboard } from "../../services/dashboard";
import { useFormatting } from "../../app/SettingsContext";
export function ConsumptionComparison({
  month,
  comparison,
  onClose,
}: {
  month: string;
  comparison: string;
  onClose: () => void;
}) {
  const { formatMoney } = useFormatting();
  const [data, setData] = useState<[Dashboard, Dashboard] | null>(null),
    [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setData(null);
    setError("");
    Promise.all([getDashboard(month), getDashboard(comparison)]).then(
      (r) => {
        if (active) setData(r);
      },
      (e) => {
        if (active) setError(String(e));
      },
    );
    return () => {
      active = false;
    };
  }, [month, comparison, attempt]);
  return (
    <Editor
      title="Origem do alerta — comparação de consumo"
      busy={false}
      error={error}
      onClose={onClose}
    >
      <p>
        Despesas econômicas dos meses financeiros. Compras entram na data da
        compra; parcelas e pagamentos de fatura não duplicam consumo. Estornos
        reduzem o consumo na data registrada.
      </p>
      {error ? (
        <Button onClick={() => setAttempt((n) => n + 1)}>
          Tentar comparação novamente
        </Button>
      ) : !data ? (
        <p role="status">Consultando origem…</p>
      ) : (
        <>
          <dl>
            <dt>{month}</dt>
            <dd>{formatMoney(BigInt(data[0].current.expense))}</dd>
            <dt>{comparison}</dt>
            <dd>{formatMoney(BigInt(data[1].current.expense))}</dd>
            <dt>Diferença</dt>
            <dd>
              {formatMoney(
                BigInt(data[0].current.expense) -
                  BigInt(data[1].current.expense),
              )}
            </dd>
          </dl>
          <p>
            Valores relidos do banco ao abrir. O mês atual pode estar em
            andamento.
          </p>
        </>
      )}
    </Editor>
  );
}
