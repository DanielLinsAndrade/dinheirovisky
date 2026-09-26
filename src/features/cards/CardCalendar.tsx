import { useEffect, useState } from "react";
import { cardCalendar } from "../../services/cards";
import type { CardDates, CreditCard } from "../../domain/cards";
import { localDate } from "../../domain/transactions";
import { useFormatting } from "../../app/SettingsContext";
export function CardCalendar({ card }: { card: CreditCard }) {
  const { displayDate } = useFormatting();
  const [month, setMonth] = useState(localDate().slice(0, 7));
  const [rows, setRows] = useState<CardDates[] | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setRows(null);
    setError("");
    cardCalendar(card.id!, month).then(
      (r) => {
        if (active) setRows(r);
      },
      (e) => {
        if (active) setError(String(e));
      },
    );
    return () => {
      active = false;
    };
  }, [card.id, month, attempt]);
  return (
    <section aria-label={`Calendário de ${card.name}`}>
      <p>
        Previsão de datas pelas regras atuais do cartão. Este calendário não
        cria faturas.
      </p>
      <label htmlFor="card-month">Mês inicial</label>
      <input
        id="card-month"
        type="month"
        min="0001-01"
        max="9998-12"
        value={month}
        onChange={(e) => setMonth(e.target.value)}
      />
      {error ? (
        <p role="alert">
          {error}{" "}
          <button className="action" onClick={() => setAttempt((n) => n + 1)}>
            Tentar calendário novamente
          </button>
        </p>
      ) : !rows ? (
        <p role="status">Carregando calendário…</p>
      ) : (
        <div
          className="table-scroll"
          tabIndex={0}
          role="region"
          aria-label="Rolagem do calendário de faturas"
        >
          <table>
            <caption>Próximos 12 fechamentos e vencimentos</caption>
            <thead>
              <tr>
                <th>Mês</th>
                <th>Fechamento</th>
                <th>Vencimento</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.month}>
                  <th scope="row">{row.month}</th>
                  <td>{displayDate(row.closingDate)}</td>
                  <td>{displayDate(row.dueDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
