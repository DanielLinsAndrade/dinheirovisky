import { useState } from "react";
import { Button } from "../../components/Button";
import { ReportsPage } from "./ReportsPage";
import { AnalysisPage } from "./AnalysisPage";
export function ReportWorkspace() {
  const [analysis, setAnalysis] = useState(false);
  return (
    <>
      <div
        className="view-switcher"
        role="group"
        aria-label="Tipo de relatório"
      >
        <Button aria-pressed={!analysis} onClick={() => setAnalysis(false)}>
          Caixa histórico e saldos
        </Button>
        <Button aria-pressed={analysis} onClick={() => setAnalysis(true)}>
          Consumo, caixa e parcelas
        </Button>
      </div>
      {analysis ? <AnalysisPage /> : <ReportsPage />}
    </>
  );
}
