import { subtractMoney, remainingMoney, wholePercent } from "./money";
import { describe, expect, it } from "vitest";
import { formatMoney, moneyInput, parseMoney, sumMoney } from "./money";

describe("valores monetários em centavos", () => {
  it.each([
    ["0", 0],
    ["0,01", 1],
    ["10,50", 1050],
    ["1.234,56", 123456],
    ["-50,1", -5010],
    ["90.071.992.547.409,91", Number.MAX_SAFE_INTEGER],
  ])("converte %s exatamente", (text, cents) => {
    expect(parseMoney(text)).toBe(cents);
    expect(parseMoney(moneyInput(cents))).toBe(cents);
  });
  it.each([
    "",
    "1.23",
    "1,234",
    "1.23,45",
    "NaN",
    "1e3",
    "12abc",
    "1,2,3",
    "90.071.992.547.409,92",
    "-90.071.992.547.409,92",
  ])("rejeita %s sem arredondamento silencioso", (text) =>
    expect(() => parseMoney(text)).toThrow(),
  );
  it("soma inteiros sem perder centavos mesmo além do limite de Number", () => {
    expect(sumMoney([10, 20, -5])).toBe(25n);
    expect(
      formatMoney(sumMoney([Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER])),
    ).toBe("R$ 180.143.985.094.819,82");
    expect(formatMoney(-1)).toBe("-R$ 0,01");
    expect(() => formatMoney(1.5)).toThrow();
  });
});

it("sums exact persisted aggregates and rejects invalid representations", () => {
  expect(sumMoney(["90071992547409910000", -1n, 1])).toBe(
    90071992547409910000n,
  );
  for (const value of ["1.2", "", "1e3", Number.MAX_SAFE_INTEGER + 1])
    expect(() => sumMoney([value])).toThrow();
});

it("subtracts extreme totals and computes goal remainder without rounding", () => {
  expect(subtractMoney("90071992547409910000", "-90071992547409910000")).toBe(
    180143985094819820000n,
  );
  expect(remainingMoney(100, 101)).toBe(0n);
  expect(remainingMoney(101, 100)).toBe(1n);
  expect(wholePercent(101, 100)).toBe(101n);
  expect(() => wholePercent(100, 0)).toThrow();
});
