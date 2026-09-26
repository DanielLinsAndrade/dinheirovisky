import { it, expect } from "vitest";
import { formatMoney, moneyInput, parseMoney } from "./money";
import { financialMonth, formatDate } from "./settings";
it("parses and formats configured separators without rounding", () => {
  for (const locale of ["pt-BR", "en-US", "de-DE"]) {
    for (const cents of [0, -1, 123456, Number.MAX_SAFE_INTEGER])
      expect(parseMoney(moneyInput(cents, locale), locale)).toBe(cents);
  }
  expect(parseMoney("1,234.56", "en-US")).toBe(123456);
  expect(() => parseMoney("1.234,56", "en-US")).toThrow();
  expect(() => parseMoney("1,234.567", "en-US")).toThrow();
  expect(formatMoney(123456, "en-US", "USD")).toBe("$1,234.56");
  expect(formatMoney(-1, "de-DE", "EUR")).toBe("-0,01 €");
  expect(formatMoney(18014398509481982n, "en-US", "USD")).toBe(
    "$180,143,985,094,819.82",
  );
});
it("dates use civil values and financial month rolls across years", () => {
  expect(formatDate("2024-02-29", "MM/dd/yyyy")).toBe("02/29/2024");
  expect(formatDate("2024-02-29", "dd/MM/yyyy")).toBe("29/02/2024");
  expect(formatDate("2024-02-29", "yyyy-MM-dd")).toBe("2024-02-29");
  expect(financialMonth("2026-01-14", 15)).toBe("2025-12");
  expect(financialMonth("2026-01-15", 15)).toBe("2026-01");
  expect(financialMonth("2024-03-01", 28)).toBe("2024-02");
});
