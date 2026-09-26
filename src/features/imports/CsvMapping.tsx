import type { CsvOptions } from "../../services/imports";
import { MetadataColumns } from "./MetadataColumns";

export const defaultCsvOptions: CsvOptions = {
  delimiter: ";",
  decimal: ",",
  dateFormat: "dd/MM/yyyy",
  dateColumn: 0,
  descriptionColumn: 1,
  amountColumn: 2,
  typeColumn: null,
};
export function CsvMapping({
  options,
  headers,
  onChange,
  onRead,
  canRead,
  card = false,
}: {
  options: CsvOptions;
  headers: string[];
  onChange: (options: CsvOptions) => void;
  onRead: () => void;
  canRead: boolean;
  card?: boolean;
}) {
  return (
    <>
      <label>
        Separador{" "}
        <select
          value={options.delimiter}
          onChange={(e) => onChange({ ...options, delimiter: e.target.value })}
        >
          <option value=";">Ponto e vírgula</option>
          <option value=",">Vírgula</option>
          <option value={"\t"}>Tabulação</option>
        </select>
      </label>
      <label>
        Separador decimal{" "}
        <select
          value={options.decimal}
          onChange={(e) => onChange({ ...options, decimal: e.target.value })}
        >
          <option value=",">Vírgula (12,34)</option>
          <option value=".">Ponto (12.34)</option>
        </select>
      </label>
      <label>
        Formato da data{" "}
        <select
          value={options.dateFormat}
          onChange={(e) => onChange({ ...options, dateFormat: e.target.value })}
        >
          {["dd/MM/yyyy", "MM/dd/yyyy", "yyyy-MM-dd"].map((f) => (
            <option key={f}>{f}</option>
          ))}
        </select>
      </label>
      <p>
        CSV precisa de cabeçalho. Valores sem separador de milhar. Sem coluna de
        tipo, negativos são despesas e positivos são receitas. Com tipo, ele
        define a direção do valor absoluto.
      </p>
      <button
        type="button"
        className="action"
        disabled={!canRead}
        onClick={onRead}
      >
        Ler colunas
      </button>
      {!!headers.length && (
        <>
          <div className="form-grid">
            {(
              [
                ["dateColumn", "Coluna de data"],
                ["descriptionColumn", "Coluna de descrição"],
                ["amountColumn", "Coluna de valor"],
                ["typeColumn", "Coluna de tipo"],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                {label}
                <select
                  value={options[key] ?? -1}
                  onChange={(e) =>
                    onChange({
                      ...options,
                      [key]:
                        Number(e.target.value) < 0
                          ? null
                          : Number(e.target.value),
                    })
                  }
                >
                  {key === "typeColumn" && (
                    <option value={-1}>Usar sinal do valor</option>
                  )}
                  {headers.map((h, i) => (
                    <option key={i} value={i}>
                      {i + 1}: {h || "(sem nome)"}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <MetadataColumns
            headers={headers}
            value={options.metadataColumns ?? {}}
            onChange={(metadataColumns) =>
              onChange({ ...options, metadataColumns })
            }
            card={card}
          />
        </>
      )}
    </>
  );
}
