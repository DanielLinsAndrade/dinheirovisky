// Ratios are for drawing only; money remains exact integer cents.
export function barPercent(value: string, maximum: string): number {
  const total = BigInt(maximum),
    cents = BigInt(value);
  if (total <= 0n || cents <= 0n) return 0;
  return Math.min(100, Number((cents * 10000n) / total) / 100);
}
export function monthLabel(month: string, locale = "pt-BR"): string {
  const label = new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${month}-01T12:00:00Z`));
  return label.charAt(0).toLocaleUpperCase(locale) + label.slice(1);
}
