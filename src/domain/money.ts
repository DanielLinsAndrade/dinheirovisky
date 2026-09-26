const MAX_CENTS = 9_007_199_254_740_991n;

export function parseMoney(text: string, locale = "pt-BR"): number {
  const value = text.trim();
  const pattern =
    locale === "en-US"
      ? /^-?(?:\d+|[1-9]\d{0,2}(?:,\d{3})+)(?:\.\d{1,2})?$/
      : /^-?(?:\d+|[1-9]\d{0,2}(?:\.\d{3})+)(?:,\d{1,2})?$/;
  if (!pattern.test(value)) {
    throw new Error(
      `Informe um valor válido, como ${locale === "en-US" ? "1,234.56" : "1.234,56"}.`,
    );
  }
  const negative = value.startsWith("-");
  const normalized = value
    .replace(/^-/, "")
    .split(locale === "en-US" ? "," : ".")
    .join("");
  const [whole, fraction = ""] = normalized.split(
    locale === "en-US" ? "." : ",",
  );
  const cents =
    (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"))) *
    (negative ? -1n : 1n);
  if (cents < -MAX_CENTS || cents > MAX_CENTS)
    throw new Error("Valor fora do intervalo permitido.");
  return Number(cents);
}

export type MoneyValue = number | bigint | string;

function centsInteger(value: MoneyValue): bigint {
  if (typeof value === "string" && !/^-?\d+$/.test(value))
    throw new Error("Valor monetário inválido.");
  if (typeof value === "number" && !Number.isSafeInteger(value))
    throw new Error("Valor monetário inválido.");
  return BigInt(value);
}

export function moneyInput(value: number, locale = "pt-BR"): string {
  const cents = centsInteger(value);
  const absolute = cents < 0n ? -cents : cents;
  return `${cents < 0n ? "-" : ""}${absolute / 100n}${locale === "en-US" ? "." : ","}${String(absolute % 100n).padStart(2, "0")}`;
}

export function formatMoney(
  value: number | bigint,
  locale = "pt-BR",
  currency = "BRL",
): string {
  const cents = centsInteger(value);
  const absolute = cents < 0n ? -cents : cents;
  const parts = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).formatToParts(absolute / 100n);
  return `${cents < 0n ? "-" : ""}${parts
    .map((part) =>
      part.type === "fraction"
        ? String(absolute % 100n).padStart(2, "0")
        : part.value,
    )
    .join("")
    .replace(/[\u00a0\u202f]/g, " ")}`;
}

export function sumMoney(values: MoneyValue[]): bigint {
  return values.reduce<bigint>((sum, value) => sum + centsInteger(value), 0n);
}

export function subtractMoney(value: MoneyValue, other: MoneyValue): bigint {
  return centsInteger(value) - centsInteger(other);
}

export function remainingMoney(
  target: MoneyValue,
  current: MoneyValue,
): bigint {
  const remaining = subtractMoney(target, current);
  return remaining > 0n ? remaining : 0n;
}

export function wholePercent(value: MoneyValue, target: MoneyValue): bigint {
  const denominator = centsInteger(target);
  if (denominator <= 0n) throw new Error("Meta deve ser positiva.");
  return (centsInteger(value) * 100n) / denominator;
}
