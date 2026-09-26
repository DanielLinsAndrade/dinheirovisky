export interface Settings {
  currency: "BRL" | "USD" | "EUR" | "GBP";
  locale: "pt-BR" | "en-US" | "de-DE";
  dateFormat: "dd/MM/yyyy" | "MM/dd/yyyy" | "yyyy-MM-dd";
  theme: "light" | "dark" | "system";
  financialMonthStart: number;
}
export const defaultSettings: Settings = {
  currency: "BRL",
  locale: "pt-BR",
  dateFormat: "dd/MM/yyyy",
  theme: "system",
  financialMonthStart: 1,
};
export function financialMonth(date: string, start: number): string {
  let year = Number(date.slice(0, 4)),
    month = Number(date.slice(5, 7));
  if (Number(date.slice(8, 10)) < start) {
    month--;
    if (month === 0) {
      year--;
      month = 12;
    }
  }
  if (year < 1) return "0001-01";
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}
export function formatDate(
  date: string,
  format: Settings["dateFormat"],
): string {
  const [y, m, d] = date.split("-");
  return format === "yyyy-MM-dd"
    ? date
    : format === "MM/dd/yyyy"
      ? `${m}/${d}/${y}`
      : `${d}/${m}/${y}`;
}
