import { useState } from "react";
import { ImportPage } from "./ImportPage";
import { CardImportPage } from "./CardImportPage";
export function ImportWorkspace() {
  const [mode, setMode] = useState("bank");
  return (
    <>
      <div
        className="view-switcher"
        role="group"
        aria-label="Destino da importação"
      >
        <button
          className="action"
          aria-pressed={mode === "bank"}
          onClick={() => setMode("bank")}
        >
          Extrato de conta
        </button>
        <button
          className="action"
          aria-pressed={mode === "card"}
          onClick={() => setMode("card")}
        >
          Compras no cartão
        </button>
      </div>
      <p>Trocar o destino descarta a prévia ainda não confirmada.</p>
      {mode === "bank" ? <ImportPage /> : <CardImportPage />}
    </>
  );
}
