const fields = [
  ["method", "Método de pagamento"],
  ["merchant", "Estabelecimento"],
  ["channel", "Modalidade"],
  ["intermediary", "Intermediador"],
] as const;

export function MetadataColumns({
  headers,
  value,
  onChange,
  card = false,
}: {
  headers: string[];
  value: Record<string, number>;
  onChange: (value: Record<string, number>) => void;
  card?: boolean;
}) {
  const columns = card
    ? [
        ...fields.filter(([key]) => key !== "method"),
        ["card", "Cartão"],
        ["invoice", "Primeira fatura (AAAA-MM)"],
        ["installments", "Quantidade total de parcelas"],
      ]
    : fields;
  return (
    <fieldset className="import-metadata-columns">
      <legend>Colunas opcionais</legend>
      <p>
        {!card && "Método: nome exato cadastrado. "}Modalidade: online ou
        presencial. Campos não mapeados ficam sem informação; nenhum dado será
        adivinhado.
      </p>
      <div className="form-grid">
        {columns.map(([key, label]) => (
          <label key={key}>
            Coluna de {label.toLowerCase()}
            <select
              aria-label={`Coluna de ${label.toLowerCase()}`}
              value={value[key] ?? -1}
              onChange={(event) => {
                const next = { ...value };
                if (Number(event.target.value) < 0) delete next[key];
                else next[key] = Number(event.target.value);
                onChange(next);
              }}
            >
              <option value={-1}>Não informada</option>
              {headers.map((header, index) => (
                <option key={index} value={index}>
                  {index + 1}: {header || "(sem nome)"}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
